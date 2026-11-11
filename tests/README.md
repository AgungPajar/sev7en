# Unit Test Suite — Star-Pou Games

Test lengkap untuk seluruh logika yang ada di project ini:

| File produksi | Yang diuji |
|---|---|
| `game.html` (inline script) | Bank soal, shuffle, spawn tangga, scoring, streak, jump/fall, animasi, HUD, audio, kontrol, VS client |
| `star_pou_sky_climber.html` (inline script) | Sama seperti core `game.html` (kedua file memakai logika identik) |
| `index.html` (inline script) | Dialog join: validasi kode/nama, prefill `?code=`, redirect ke game |
| `star_pou_vs.html` | Struktur situs: duplikat harus identik dengan `game.html` |
| `vs-server/server.js` | Protokol WebSocket: create/join/rejoin/start/score/finish/end, validasi, broadcast, cleanup, health |

## Cara menjalankan

```bash
npm test                 # semua test (game + landing + struktur + server)
npm run test:game        # hanya game HTML + landing + struktur
npm run test:server      # hanya WebSocket server
npm run test:watch       # mode watch
```

Tidak perlu install dependency tambahan — memakai **Node.js built-in test runner**
(`node:test` + `node:assert`) dan global `WebSocket` (Node >= 22). `ws` hanya dipakai
oleh `vs-server` (sudah ada di `vs-server/node_modules`).

## Struktur

```
tests/
├── helpers/
│   └── game-page.js       # sandbox DOM/canvas/audio/timer/WebSocket untuk menjalankan HTML asli
├── game-core.test.js      # 160 test core game (dijalankan untuk kedua file HTML)
├── game-vs-client.test.js # 51 test client multiplayer di game.html
├── landing.test.js        # 8 test dialog join di index.html
├── site-structure.test.js # 8 test struktur markup & sinkronisasi build
├── vs-server.test.js      # 42 test server WebSocket (unit + integrasi live)
└── README.md
```

Total: **269 test**, semuanya lulus.

## Pendekatan

### 1. Game HTML — tanpa mengubah file produksi

`tests/helpers/game-page.js` membaca file HTML, mengambil semua blok `<script>` inline,
lalu menjalankannya dengan `node:vm` di dalam sandbox yang meniru browser:

- **DOM** — `document.getElementById`, `querySelector`, `createElement`, `style`,
  `textContent`, `innerHTML`, event listener, dan `getBoundingClientRect`.
- **Canvas 2D** — semua method (`fillRect`, `arc`, `roundRect`, `measureText`, dst.)
  dicatat jumlah pemanggilannya, sehingga rendering bisa diuji tanpa GPU.
- **AudioContext** — oscillator/gain direkam untuk memverifikasi nada SFX.
- **Timer** — jam virtual (`setTimeout`/`setInterval`) sehingga jeda 550 ms / 900 ms
  dan countdown 180 detik bisa diuji seketika tanpa menunggu.
- **WebSocket** — socket palsu dengan `open()`, `receive()`, `sent`, `readyState`,
  dan `close()` untuk menguji client VS.
- **Math.random** — bisa di-seed (`mulberry32`) agar hasil deterministik.

Karena yang dieksekusi adalah kode asli dari HTML, test akan langsung gagal jika
logika game berubah/rusak — bukan menyalin implementasi ke file test.

Contoh menjalankan test core untuk kedua game:

```js
for (const file of GAME_FILES) {
  describe(`game core — ${file}`, () => { /* ... */ });
}
```

### 2. Server — importable + tetap bisa dijalankan langsung

`vs-server/server.js` di-refactor minimal agar bisa di-`import` oleh test:

- `createVsServer(options)` mengembalikan `{ server, wss, rooms, listen, close, cleanupNow, config }`.
- Helper murni diekspor: `genCode`, `roomPublic`, `broadcast`, `cleanupRooms`.
- Perilaku runtime tidak berubah: `node server.js` tetap listen di port `3001` (`/ws`)
  dengan `ADMIN_PASSWORD` dan `MAX_TEAMS` yang sama.

Test integrasi menjalankan server sungguhan di port acak (`listen(0)`) dan terhubung
memakai WebSocket client bawaan Node, sehingga protokol end-to-end benar-benar diuji.

## Cakupan penting

- **Bank soal** — 29 soal, 4 topik, tidak ada `correct === wrong`, tidak ada duplikat.
- **Shuffle** — permutation, tidak memutasi input, deterministik per seed.
- **Spawn tangga** — posisi kiri/kanan, satu jawaban benar, level, wrap pool, cloud extension.
- **Scoring** — `100 + min(streak-1, 5) * 20` (100, 120, …, 200, 200), history maks 8.
- **Jawaban salah** — streak reset, platform pecah, fall, kembali ke base setelah 900 ms.
- **Animasi** — kamera easing 8%, jump selesai ~19 frame, fisika fall, partikel, floating text.
- **HUD** — zona (0/4/8/12), format `mm:ss`, mode `♾️` (durasi >= 9000), modal akhir.
- **Audio** — sine sweep (jump), arpeggio 4 nada (correct), sawtooth (wrong), resume context.
- **Kontrol** — keyboard (`ArrowLeft/a/A`, `ArrowRight/d/D`) dan pointer kiri/kanan.
- **VS client** — URL lokal/produksi, reconnect 2 s, semua tipe pesan server, lobby, leaderboard,
  create/join validation, throttle score 400 ms, auto-join dari `?code=` & `#join`.
- **Landing** — dialog join, validasi, prefill kode, redirect ter-encode.
- **Struktur** — ID wajib ada, tidak ada script eksternal, build solo tanpa VS, `star_pou_vs.html` = `game.html`.
- **Server** — auth admin, kode 6 karakter tanpa `I/O/0/1`, validasi join (duplikat, penuh,
  sudah mulai), host-only start/end, clamp score/floor, sorting leaderboard, rejoin,
  disconnect, isolasi room, TTL cleanup, `/health`, pesan rusak/unknown.

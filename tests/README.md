# Unit Test Suite — Star-Pou Games

Test lengkap untuk seluruh logika yang ada di project ini:

| File produksi | Yang diuji |
|---|---|
| `game.html` (inline script) | Bank soal satu tema (50 soal), pemilihan berbobot anti-ulang, spawn tangga, scoring, streak, jump/fall, animasi, HUD, audio, kontrol, VS client (termasuk hasil resmi, ronde berulang, hapus room, spectator GAME OVER), renderer 3D |
| `star_pou_sky_climber.html` (inline script) | Sama seperti core `game.html` (kedua file memakai logika + renderer identik) |
| `index.html` (inline script) | Dialog join: validasi kode/nama, prefill `?code=`, redirect ke game |
| `star_pou_vs.html` | Struktur situs: duplikat harus identik dengan `game.html`, satu opsi tema di selector |
| `vs-server/room-manager.js` (via adapter `server.js`) | Protokol WebSocket: create/join/rejoin/start/score/finish/end/delete_room, hasil pertandingan & klasemen, ronde berulang, hapus room, validasi, broadcast, cleanup, health |

## Cara menjalankan

```bash
# Wajib pakai --test-isolation=none: sandbox spawn proses kena EPERM di
# lingkungan ini (tanpa flag itu node --test mencoba spawn worker dan gagal).
# Jalankan per file / sebutkan file-nya (import direktori `tests/` tidak didukung
# di sini karena package ESM, dan discovery default ikut memungut
# vs-server/server.bun.test.js milik `bun test`).
node --test --test-isolation=none \
  tests/game-core.test.js tests/game-3d.test.js tests/game-vs-client.test.js \
  tests/site-structure.test.js tests/landing.test.js        # 392 test (392 lulus)
node --test --test-isolation=none tests/vs-server.test.js    # 83 test (82 lulus, 1 gagal pre-existing; butuh `ws`)
```

Tidak perlu install dependency tambahan — memakai **Node.js built-in test runner**
(`node:test` + `node:assert`) dan global `WebSocket` (Node >= 22). `ws` hanya dipakai
oleh `vs-server` (sudah ada di `vs-server/node_modules`).

## Struktur

```
tests/
├── helpers/
│   └── game-page.js       # sandbox DOM/canvas/audio/timer/WebSocket untuk menjalankan HTML asli
├── game-core.test.js      # 182 test core game (dijalankan untuk kedua file HTML)
├── game-3d.test.js        # 82 test kontrak renderer 3D (dijalankan untuk kedua file HTML)
├── game-vs-client.test.js # 111 test client multiplayer + spectator/telemetri + jam match + hasil/pemenang + ronde berulang + delete_room
├── landing.test.js        # 8 test dialog join di index.html
├── site-structure.test.js # 9 test struktur markup, selector tema tunggal & sinkronisasi build
├── vs-server.test.js      # 83 test server WebSocket (unit + integrasi live + spectator + clock + hasil pertandingan + ronde + delete_room)
└── README.md
```

Total Node: **475 test** — **474 lulus**, **1 gagal pre-existing** di
`vs-server.test.js` ("supports rejoining a team after a disconnect", yang mengakses
`serverTeam.ws._teamId` internal; sengaja tidak diubah). Rinciannya: **392 test**
di 5 suite klien (game/renderer/struktur/landing, semuanya lulus; dari jumlah itu
`game-vs-client.test.js` menyumbang **111 test**) dan **83 test** di suite server
(**82 lulus, 1 pre-existing**).
Tambahan `bun test vs-server/server.bun.test.js`: **21 test**, semuanya lulus.

## Pendekatan

### 1. Game HTML — tanpa mengubah file produksi

`tests/helpers/game-page.js` membaca file HTML, mengambil semua blok `<script>` inline,
lalu menjalankannya dengan `node:vm` di dalam sandbox yang meniru browser:

- **DOM** — `document.getElementById`, `querySelector`, `createElement`, `style`,
  `className`/`classList`, `textContent`, `innerHTML`, event listener, dan `getBoundingClientRect`.
- **Canvas 2D / renderer 3D** — semua method (`fillRect`, `arc`, `roundRect`,
  `moveTo/lineTo`, `measureText`, `setTransform`, dst.) dicatat jumlah pemanggilannya,
  plus state `fillStyle`/`strokeStyle`/`globalAlpha` per paint (`page.ctxLog()`),
  sehingga warna zona/platform 3D bisa diuji tanpa GPU. `devicePixelRatio = 1`,
  `OffscreenCanvas`, dan sprite canvas ikut disediakan.
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

Logika room/protokol dipisah ke `vs-server/room-manager.js` (dipakai adapter Node
`vs-server/server.js` dan Bun `vs-server/server.bun.js`). Lapisan server tetap bisa
di-`import` oleh test:

- `createVsServer(options)` mengembalikan `{ server, wss, rooms, listen, close, cleanupNow, config }`.
- Helper murni diekspor dari `room-manager.js`: `genCode`, `roomPublic`, `publicTeam`,
  `rankTeams`, `matchResult`, `broadcast`, `cleanupRooms`, `remainingSeconds`,
  `remainingMs`, `sanitizePlayerState`, `MATCH_GRACE_MS`.
- Perilaku runtime tidak berubah: `node server.js` tetap listen di port `3001` (`/ws`)
  dengan `ADMIN_PASSWORD` dan `MAX_TEAMS` yang sama.

Test integrasi menjalankan server sungguhan di port acak (`listen(0)`) dan terhubung
memakai WebSocket client bawaan Node, sehingga protokol end-to-end benar-benar diuji.

## Cakupan penting

- **Bank soal** — 50 soal satu tema `living_room`, bentuk objek `{ id, topic, emoji, q, correct, wrong }`,
  `id` berurutan 1–50, tidak ada `correct === wrong`, tidak ada soal/teks duplikat.
- **Pemilihan soal anti-ulang** — bobot soal belum tampil `1`, bobot soal sudah tampil `0.03 × 0.20^(n−1)`,
  pengali `0.05` selama masih dalam jeda `QUESTION_RECENT_WINDOW` (6 soal), bobot turun tiap kemunculan,
  tidak pernah mengulang soal di tangga berikutnya, dan seluruh 50 soal tetap muncul dalam sesi panjang.
  Riwayat `questionStats`/`questionPickSeq` bertahan antar `startGame()` (rematch).
- **Shuffle** — permutation, tidak memutasi input, deterministik per seed.
- **Spawn tangga** — posisi kiri/kanan, satu jawaban benar, level, wrap pool, cloud extension.
- **Scoring** — `100 + min(streak-1, 5) * 20` (100, 120, …, 200, 200), history maks 8.
- **Jawaban salah** — streak reset, platform pecah, fall, kembali ke base setelah 900 ms.
- **Animasi** — kamera easing 8%, jump selesai ~19 frame, fisika fall, partikel (gerak + gravitasi + fade), floating text (naik + fade).
- **Renderer 3D** — kontrak `tools/3d-engine-spec.md`: `gameTo3D`, kamera rig (FOV 55°, near 20, focal, jarak adaptif, basis ortonormal, `cam` tetap 2D), proyeksi perspektif + skala ∝ 1/depth + null di belakang kamera, `clipPolygonNear`, `zonePalette` (ambang 900/1800/2700, alpha monoton, sunset), `shadeHex`/`mixHex`, `platformMesh` (cache `p._mesh3d`), `starMesh` (prisma bintang), `sortByDepth`, dan satu frame `animate()` (polygon, teks, `setTransform` DPR) tanpa throw.
- **HUD** — zona (0/4/8/12), format `mm:ss`, mode `♾️` (durasi >= 9000), modal akhir.
- **Audio** — sine sweep (jump), arpeggio 4 nada (correct), sawtooth (wrong), resume context.
- **Kontrol** — keyboard (`ArrowLeft/a/A`, `ArrowRight/d/D`) dan pointer kiri/kanan.
- **VS client** — URL lokal/produksi, reconnect 2 s, semua tipe pesan server, lobby, leaderboard,
  create/join validation, throttle score 400 ms, auto-join dari `?code=` & `#join`.
- **Hasil resmi & lobby berulang (client)** — `game_end` menampilkan pemenang atau **SERI**,
  alasan, dan klasemen ber-`rank`; tombol **KEMBALI KE LOBI**; `game_start` ronde berikutnya
  menyembunyikan hasil dan menaikkan `round`; timer lokal habis mengirim `finish{score,floor,streak}`
  lalu menampilkan layar **WAKTU HABIS** sampai hasil resmi datang; `room_deleted` menampilkan
  modal **ROOM DIHAPUS** dan membersihkan state VS.
- **Spectator GAME OVER** — `game_end` dan `lastResult` pada `spectate_ok` memunculkan kartu
  GAME OVER (pemenang/seri, alasan, klasemen); tombol **LIHAT KAMERA** menutup kartu tanpa
  menghapus snapshot kamera; **KELUAR**/`Esc` keluar; `game_start` mereset overlay dan snapshot.
- **Hasil pertandingan (server)** — `rankTeams` (skor → floor → nama), `matchResult`
  (`reason`, `endedAt`, `round`, `winner`, `tied`, `winners[]`, `teams[].rank`), seri
  (skor & floor sama), dan room tanpa tim.
- **Ronde berulang (server)** — akhir pertandingan mengembalikan status ke `lobby` (room
  tidak dihapus), `start_game` menaikkan `round` dan mereset skor/floor/streak/telemetri,
  `rejoined_host` & `spectate_ok` membawa `round` + `lastResult`.
- **delete_room** — hanya host; `room_deleted{code,message}` diterima tim, host, dan observer;
  room hilang dari Map sehingga kode tidak bisa dipakai; non-host dibalas error.
- **Timer server & grace** — akhir otomatis `duration × 1000 + 1200 ms`, durasi Tanpa Batas
  tidak auto-end, dan `end_game` di luar status `playing` dibalas `Tidak ada pertandingan yang berjalan`.
- **Telemetri pemain** — snapshot `vsCollectPlayerState` (field `f/sc/stk/cx/cy/sx/sy/ss/se/sr/sk/kx/ky/b/l/r/tr/q`,
  START rung level 0, soal aktif, berubah setelah naik), `player_state` ~8 Hz hanya saat mabar
  (`vsStartTelemetry`), berhenti lewat `vsStopTelemetry`/`endGame()`/`game_end`.
- **Spectator admin** — auto-start dari `?code=..&spectate=1` (body `spectate-mode`, `window.__spectator`),
  ingest `spectate_ok`/`player_state`/`team_offline`/`leaderboard`/`room_update`/`game_end`/`room_deleted`/`error`,
  layout grid 1/4/10 tim + mode fokus, clamp zoom 0.7–2.4 per tim, hit-test & kontrol
  pointer/wheel/keyboard, `vsSpecExit`, render multi-pane lewat renderer 3D asli tanpa merusak state pemain.
- **Landing** — dialog join, validasi, prefill kode, redirect ter-encode.
- **Struktur** — ID wajib ada, tidak ada script eksternal, build solo tanpa VS, `star_pou_vs.html` = `game.html`,
  selector tema hanya berisi opsi `living_room` (penjaga tema tunggal).
- **Server** — auth admin, kode 6 karakter tanpa `I/O/0/1`, validasi join (duplikat, penuh,
  sudah mulai), host-only start/end/delete, clamp score/floor, sorting leaderboard, rejoin,
  disconnect, isolasi room, TTL cleanup, `/health`, pesan rusak/unknown.

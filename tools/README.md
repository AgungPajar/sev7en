# tools/capture3d.mjs — harness screenshot sev7en

Harness Node 26 (ESM, **tanpa dependency**) yang menjalankan Microsoft Edge
headless lewat Chrome DevTools Protocol (CDP), membuka game di
`http://127.0.0.1:4173/game.html`, menjalankan skenario JS, menyimpan screenshot
PNG, dan mengumpulkan error halaman. Dipakai untuk verifikasi visual renderer 3D
dan mode penonton admin (lihat `tools/3d-engine-spec.md`).

Harness **tidak** menyentuh `game.html`, dan **tidak** menjalankan server.

## Prasyarat

1. **Node 22+** (diuji dengan Node 26 — global `WebSocket` wajib ada).
2. **Server statis** di port 4173, dijalankan dari root proyek:
   ```
   python -m http.server 4173
   ```
   Untuk skenario mode penonton yang benar-benar end-to-end (`spectate-live`,
   `admin-tonton-live`) pakai server Bun yang sekaligus melayani WebSocket:
   ```
   bun run vs-server/server.bun.js
   node tools/capture3d.mjs --url=http://127.0.0.1:3001/game.html --scenario=spectate-live
   ```
3. **Microsoft Edge** di
   `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
   (bisa di-override lewat `--edge=...` atau env `SEV7EN_EDGE`).
4. Izin spawn proses penuh untuk Edge. Di sandbox tertentu spawn Edge diblokir
   (named pipe) — jalankan harness di shell dengan izin penuh.

## Cara pakai

Dari root proyek `D:\projects\sev7en`:

```powershell
# Jalankan semua skenario (output default .shots/<timestamp>/)
node tools/capture3d.mjs

# Hanya beberapa skenario, viewport desktop lain
node tools/capture3d.mjs --scenario=play,wrong --viewport=1440x900

# Folder output khusus
node tools/capture3d.mjs --out=.shots/uji --scenario=mobile-portrait,mid

# Bantuan
node tools/capture3d.mjs --help
```

Verifikasi sintaks tanpa menjalankan Edge:

```powershell
node --check tools/capture3d.mjs
```

## Opsi CLI

Semua opsi bernilai memakai format `--kunci=nilai` (wajib `=`).

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `--url=URL` | `http://127.0.0.1:4173/game.html` | Halaman game yang dibuka |
| `--out=FOLDER` | `.shots` | Folder dasar; hasil masuk ke `FOLDER/<timestamp>/` |
| `--viewport=WxH` | `1280x800` | Viewport desktop dasar |
| `--scenario=all\|a,b` | `all` | Skenario yang dijalankan |
| `--edge=PATH` | Edge x86 default | Path `msedge.exe` |
| `--settle=MS` | `500` | Jeda setelah load sebelum langkah pertama |
| `--port=PORT` | acak bebas | Port remote debugging (hindari port yang sedang dipakai) |
| `--nav-timeout=MS` | `25000` | Timeout navigasi/load |
| `--eval-timeout=MS` | `15000` | Timeout `Runtime.evaluate` |
| `--strict` | mati | `console.error` ikut menggagalkan run (exit 1) |
| `--keep-open` | mati | Edge dibiarkan hidup setelah run; Ctrl+C menutupnya |
| `--quiet` | mati | Sembunyikan log progres (ringkasan JSON tetap dicetak) |

## Skenario

Semua skenario memuat ulang halaman untuk state yang bersih, lalu screenshot
default diambil sekali di akhir skenario.

| Nama | Aksi |
| --- | --- |
| `menu` | Buka `/game.html`, tanpa aksi (modal pengaturan tampil) |
| `solo-start` | `startGame()`, tunggu 900 ms |
| `play` | `startGame()`, jawab benar 2x: `triggerJump(leftOptionPlat.isCorrect ? 'left' : 'right')`, 800 ms tiap lompatan + tunggu `star.state === 'idle'` sebelum lompatan kedua |
| `wrong` | `startGame()`, jawab salah, screenshot 250 ms setelah lompatan (awan pecah, bintang jatuh) |
| `mid` | `startGame()`, lalu `floorLevel = 9; cam.y = -1800; cam.targetY = -1800; initEnvironment(); spawnNextStairOptions();` (zona senja) |
| `space` | `startGame()`, lalu `floorLevel = 12; cam.y = -3000; cam.targetY = -3000; initEnvironment(); spawnNextStairOptions();` (zona luar angkasa) |
| `mobile-portrait` | Viewport 390x844 (mobile), `startGame()`, tunggu 800 ms |
| `mobile-landscape` | Viewport 844x390 (mobile), `startGame()`, tunggu 800 ms |
| `spectate-grid` | Mode penonton: 4 tim sintetis di ketinggian berbeda → grid kamera 2×2, tab, bar info soal |
| `spectate-focus` | Mode penonton: fokus tim ke-3 + zoom 160% |
| `spectate-zoom` | Mode penonton: zoom per pemain berbeda (80% / 120% / 180% / 240%) |
| `spectate-lobby` | Mode penonton: room nyata masih lobby (2 tim join, belum mulai) |
| `spectate-live` | End-to-end: room nyata + 4 socket tim mengirim `player_state` → 4 kamera live + fokus |
| `spectate-real-player` | End-to-end paling nyata: iframe halaman pemain (`game.html`) auto-join & main sungguhan, spectator admin menonton kamera pemain itu |
| `spectate-fps` | Ukur fps rAF vs fps gambar mode penonton 4 kamera |
| `admin-tonton-live` | End-to-end panel admin: buat room, 4 tim join + telemetri, klik **Tonton Live**, iframe 4 kamera + fokus/zoom |

Catatan mode penonton:

- `spectate-grid/focus/zoom/fps` menyuntik snapshot sintetis langsung ke klien
  (tanpa room) supaya layout deterministic; cocok untuk screenshot dokumentasi.
- `spectate-live`, `spectate-real-player`, dan `admin-tonton-live` memakai
  protokol WebSocket sungguhan, jadi **wajib** pakai `--url=` ke server Bun/Node
  yang punya endpoint `/ws` (`http://127.0.0.1:3001/game.html`, atau
  `http://127.0.0.1:3001/admin/` untuk skenario panel admin). Password admin
  default `sev7en-admin` (bisa diganti lewat env `ADMIN_PASSWORD` di server).
- `spectate-real-player` menampilkan iframe halaman pemain di pojok kiri bawah
  sebagai bukti kamera pane berasal dari telemetri pemain sungguhan; screenshot
  keduanya diambil setelah pemain beberapa kali menjawab soal.
- Skenario `admin-tonton-live` menghasilkan 2 screenshot: `overlay-4-kamera` dan
  `overlay-fokus-zoom`.

### Menambah skenario

Sunting array `SCENARIOS` di bagian atas `tools/capture3d.mjs`. Satu langkah
berbentuk objek dengan kunci berikut (bisa digabung):

```js
{ eval: 'startGame()', wait: 800 }            // evaluasi JS, lalu jeda
{ waitFor: "star.state === 'idle'", timeout: 5000 } // tunggu ekspresi truthy
{ wait: 500 }                                 // jeda saja
{ shot: 'tambahan' }                          // screenshot <nama-skenario>--tambahan.png
```

Contoh skenario baru:

```js
{
  name: 'confetti',
  label: 'Konfeti setelah jawaban benar',
  steps: [
    { eval: 'startGame()', wait: 800 },
    { shot: 'awal' },
    { eval: "triggerJump(leftOptionPlat.isCorrect ? 'left' : 'right')", wait: 450 },
    { shot: 'mendarat' },
  ],
},
```

Nama skenario harus unik; `--scenario=...` memakai nama tersebut.

## Output

```
.shots/<YYYY-MM-DD_HH-MM-SS>/
  menu.png
  solo-start.png
  play.png
  wrong.png
  mid.png
  space.png
  mobile-portrait.png
  mobile-landscape.png
  summary.json          # ringkasan lengkap (state halaman, error, timing)
```

Ringkasan JSON juga dicetak ke stdout, berisi antara lain:

- `ok` — `true` bila tidak ada exception/log error/skenario gagal.
- `counts` — `uncaughtExceptions`, `consoleErrors`, `consoleWarnings`,
  `logErrors`, `harnessErrors`, `ignoredLogEntries`.
- `scenarios[]` — per skenario: `screenshots[]` (path relatif + ukuran byte),
  `steps[]` (ekspresi + durasi), `state` (snapshot `cam`, `floorLevel`,
  `star`, `leftOption`, `camera3D`, canvas, HUD), `errors[]`.
- `errors[]` — daftar mentah error yang dikumpulkan.

### Exit code

| Kode | Arti |
| --- | --- |
| `0` | Sukses; semua skenario jalan, tanpa exception/page error |
| `1` | Ada `uncaught exception`, `Log.entryAdded` level error (page error), atau kegagalan harness (eval/screenshot) |
| `2` | Setup gagal: argumen salah, server statis tidak reachable, Edge tidak ditemukan |

`console.error` dari halaman dicatat tetapi **tidak** menggagalkan run; pakai
`--strict` bila ingin ikut menggagalkan. `console.warning` dan 404 favicon
(diabaikan) tidak pernah menggagalkan.

## Catatan / risiko

- **Belum diuji end-to-end oleh pembuat harness**: pembuatan file ini dilakukan
  di sandbox yang memblokir spawn Edge (named pipe), jadi verifikasi yang
  dijalankan hanya `node --check` + uji jalur error (argumen, server mati, Edge
  hilang). Lead menjalankan run penuh sekali untuk memastikan `Page.enable`,
  screenshot, dan Emulation bekerja di Edge mesin ini.
- Harness mengandalkan global top-level `game.html` yang dapat dievaluasi dari
  `Runtime.evaluate` (`startGame`, `triggerJump`, `cam`, `floorLevel`, `star`,
  `initEnvironment`, `spawnNextStairOptions`, `leftOptionPlat`). Ini bekerja
  karena script utama adalah classic `<script>` (bukan module). Bila Lead
  membungkus game logic dalam IIFE/module, skenario `mid`/`space`/`play`/`wrong`
  akan gagal dan perlu ekspos global.
- Skenario `mid`/`space` memang memindahkan kamera tanpa mengubah platform,
  jadi yang tervalidasi adalah **palet langit/awan/bintang zona tersebut**,
  bukan platform di ketinggian itu.
- `Page.captureScreenshot` memakai viewport emulasi (`Emulation.setDeviceMetricsOverride`,
  deviceScaleFactor 1), sehingga ukuran PNG = ukuran viewport.
- Timing berbasis jeda; `play` sudah diberi penjaga `star.state === 'idle'`
  supaya lompatan kedua tidak terabaikan bila animasi pendaratan sedikit lebih
  lambat dari 800 ms.
- Harness tidak mengubah `game.html`, `tests/`, `docs/`, maupun `vs-server/`.

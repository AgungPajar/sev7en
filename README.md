# Sev7en Club — Star-Pou Sky Climber

Game kuis Bahasa Inggris bertema naik tangga awan ke luar angkasa. Pemain menjawab
soal dengan memilih tangga kiri/kanan; jawaban benar menaikkan bintang satu tingkat,
jawaban salah membuat awan hancur dan pemain jatuh ke pijakan aman terakhir.

Dunia permainan ditampilkan dalam **3D** memakai renderer software buatan sendiri:
proyeksi perspektif, painter's algorithm, dan shading toon digambar ke Canvas 2D —
tanpa WebGL, tanpa three.js, dan tanpa dependency. Tetap satu file HTML mandiri dan
jalan offline.

Ada dua mode: **solo** (satu perangkat) dan **mabar/VS** (maksimal 10 tim, satu kode
room, leaderboard live). Seluruh project berjalan **tanpa database** — state room
hanya di memori proses server.

- **Stack:** HTML + Canvas 2D dengan renderer 3D software buatan sendiri (vanilla JS,
  tanpa build step) + satu server WebSocket.
- **Runtime server:** Bun (satu proses: file statis + WebSocket) atau Node (`ws`).
- **Dependency npm:** 0 untuk runtime Bun. Node hanya butuh paket `ws`.

---

## Peta file

```
sev7en/
├── index.html                  # Landing: Main Sendiri / Gabung Room / Panel Admin
├── game.html                   # Game utama + mode mabar (VS)
├── star_pou_vs.html            # Harus identik dengan game.html (dijaga test)
├── star_pou_sky_climber.html   # Build solo tanpa blok VS
├── admin/index.html            # Panel admin: buat room, pantau tim & leaderboard
├── design/                     # Aset/eksperimen desain (disajikan di /design/)
├── tools/
│   ├── 3d-engine-spec.md       # Spesifikasi kerja renderer 3D (internal)
│   ├── capture3d.mjs           # Harness screenshot Edge headless untuk verifikasi visual
│   ├── sync-solo.mjs           # Bangun ulang build solo + salinan VS dari game.html
│   └── README.md               # Cara pakai harness screenshot
├── vs-server/
│   ├── server.bun.js           # Adapter Bun: static + WS (/ws, /vs-ws) + /health
│   ├── server.js               # Adapter Node: WS saja (fallback)
│   ├── room-manager.js         # Logika room/protokol (dipakai kedua adapter)
│   ├── config.js               # PORT & ADMIN_PASSWORD dari environment
│   └── server.bun.test.js      # Test integrasi Bun (19 test)
├── docs/                       # Dokumentasi rinci (lihat bagian akhir)
├── tests/                      # Unit test Node (node:test)
├── Dockerfile / docker-compose.yml
└── BUN.md / DOCKER.md
```

---

## Cara menjalankan

### Opsi A — Bun (disarankan, satu proses)

Prasyarat: [Bun](https://bun.sh) 1.1+ (`bun --version`).

```bash
bun run start
```

Keluaran yang diharapkan:

```
sev7en-vs (Bun) on http://0.0.0.0:3001  static + WS /ws & /vs-ws  admin pass=sev***  maxTeams=10
```

Satu proses ini sudah menyajikan file game **dan** WebSocket. Tidak ada `npm install`.

| Perintah | Fungsi |
| --- | --- |
| `bun run start` | Produksi. Pakai ini saat bermain. |
| `bun run dev` | Watch mode; server restart saat file berubah. **Jangan saat bermain** — room hilang. |
| `bun run test:bun` | Test integrasi server (19 test). |
| `bun run start:node` | Jalankan adapter Node (WS saja). |

### Opsi B — Docker

```bash
docker compose up -d --build
```

Image kecil (runtime Bun + 11 file project, tanpa `node_modules`). Detail lengkap:
[DOCKER.md](DOCKER.md).

### Opsi C — Node (fallback, dua proses)

Node hanya menyediakan WebSocket, jadi file statis butuh server terpisah:

```bash
# terminal 1 — server realtime (WS di /ws)
cd vs-server
npm install
npm start

# terminal 2 — file statis (dari root project)
npx serve . -l 4173
```

Buka `http://localhost:4173/`. Client otomatis mencari WS ke `ws://localhost:3001/ws`
walau halaman disajikan dari port lain.

### Konfigurasi environment

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3001` | Port HTTP + WebSocket |
| `ADMIN_PASSWORD` | `sev7en-admin` | Password pembuatan room VS |
| `NODE_ENV` | – | `production` mematikan dev mode Bun |

```powershell
# PowerShell
$env:PORT=3001; $env:ADMIN_PASSWORD='rahasia'; bun run start
```

```bash
# bash
PORT=3001 ADMIN_PASSWORD=rahasia bun run start
```

> `vs-server/.env` **tidak** dimuat otomatis (tidak ada `dotenv`). Set lewat shell,
> PM2, atau `docker compose` (Compose membaca `.env` di root, lihat `.env.example`).

---

## Peta URL

| Halaman | URL | Keterangan |
| --- | --- | --- |
| Landing | `/` | Tiga pilihan: solo, gabung room, admin |
| Game + VS | `/game.html` | Mode solo dan mabar |
| Game versi solo | `/star_pou_sky_climber.html` | Tanpa blok VS |
| Panel admin | `/admin/` | Buat room, lihat tim, leaderboard |
| Gabung via link | `/game.html?code=ABC123#join` | Dialog join terbuka, kode terisi |
| Gabung otomatis | `/game.html?code=ABC123&team=NAMA#join` | Kode + nama langsung join |
| WebSocket | `/ws` (lokal), `/vs-ws` (nginx) | Protokol JSON |
| Health check | `/health` | `{"ok":true,"rooms":N}` |

Server hanya menyajikan **allowlist**: `index.html`, `game.html`,
`star_pou_vs.html`, `star_pou_sky_climber.html`, folder `admin/`, dan `design/`.
Source server, test, `.git`, dan path traversal → `404`.

---

## Alur permainan

```
        ┌──────────────┐        WebSocket (JSON)        ┌─────────────────────────┐
        │  admin/      │◄──────────────────────────────►│                         │
        │  (host)      │                                │   vs-server             │
        └──────────────┘                                │   RoomManager           │
        ┌──────────────┐                                │   rooms: Map<code,room> │
        │  game.html   │◄──────────────────────────────►│   (hanya di memori)     │
        │  (tim 1..10) │                                │                         │
        └──────────────┘                                └─────────────────────────┘
```

### 1. Alur solo

1. Buka `/` → klik **Main Sendiri** → `/game.html`.
2. Isi nama tim, pilih **materi** (4 topik atau gabungan) dan **durasi**
   (2/3/5 menit atau tanpa batas).
3. Klik **MULAI NAIK TANGGA**. Kamera 3D menampilkan pulau bumi; bintang mulai dari
   tanah dan dua awan jawaban muncul di atasnya.
4. Pilih dengan panah kiri/kanan (atau `A`/`D`, atau klik/tap awan).
5. Jawaban **benar**: naik satu tangga, `+100` poin, ditambah bonus streak `+20`
   untuk tiap jawaban benar beruntun setelahnya (maksimal `+100`).
6. Jawaban **salah**: awan hancur, streak kembali `0`, bintang jatuh dan berputar
   ke pijakan aman terakhir, lalu soal baru muncul.
7. Ketinggian = `tangga × 100 m`. Zona berubah di tangga 4 (awan), 8 (senja),
   12 (luar angkasa); langit 3D bertransisi mengikuti ketinggian kamera, termasuk
   bintang, bulan, dan planet bercincin di zona paling atas.
8. Timer habis → modal hasil: total poin, ketinggian, jumlah tangga.

Mode solo tidak menyentuh WebSocket sama sekali.

### 2. Alur mabar (VS)

1. **Host** buka `/admin/`, isi password admin, pilih materi + durasi (3/5/10
   menit atau tanpa batas), klik **Buat Room**. Bisa juga dari `/game.html`
   (kartu VS).
2. Server membuat kode **6 karakter** (tanpa `I`, `O`, `0`, `1`), status room
   `lobby`, kapasitas **10 tim**.
3. Host membagikan kode atau link. Link dibuat dari `location.origin`, jadi host
   sebaiknya membuka game lewat IP/domain yang bisa diakses tim (bukan `localhost`).
4. **Tim** membuka link → dialog join → isi nama (maks 24 karakter, harus unik di
   room itu) → server membalas `joined` dan menyiarkan `room_update` ke host +
   semua tim, sehingga semua saling melihat.
5. Selama `lobby`, tim baru masih boleh join. Setelah host menekan
   **MULAI MABAR**, join ditolak (`Room sudah mulai`).
6. **Host** klik **MULAI MABAR** → server set status `playing`, lalu menyiarkan
   `game_start{materi, duration, serverTime}` ke **semua** client sekaligus.
7. Semua client memakai materi + durasi dari host (bukan pilihan lokal), tetapi
   **urutan soal diacak per tim**, jadi tidak ada saling contekan posisi.
8. Selama bermain, tiap client mengirim `score_update{score, floor, streak}`
   maksimal tiap **400 ms**. Server menyimpan (nilai diklem ≥ 0) lalu menyiarkan
   `leaderboard` terurut skor menurun ke host + semua tim.
9. Timer berjalan **di masing-masing client** (durasi sama, mulai hampir serentak).
   Saat habis, client menampilkan hasil akhirnya sendiri; status room tetap
   `playing` di server.
10. Room hilang otomatis setelah **2 jam** (TTL, dicek tiap 10 menit) atau saat
    server restart.

> Belum ada tombol "akhiri mabar" di UI. Server sudah mendukung pesan `end_game`
> dari host (`status → ended`, broadcast `game_end`), tinggal dipakai kalau perlu.

### 3. Alur koneksi WebSocket & reconnect

Client mencoba endpoint berurutan sampai ada yang tersambung:

1. `ws(s)://host:port/ws` — halaman & server satu origin (termasuk akses LAN)
2. `ws://localhost:3001/ws` — halaman dibuka via `file://` / static server terpisah
3. `ws(s)://host:3001/ws` lalu `ws(s)://host/vs-ws` — static di port lain / produksi

| Kejadian | Perilaku |
| --- | --- |
| Koneksi putus (Wi-Fi/server restart) | Client reconnect tiap 2 detik selama masih punya kode room |
| Tim reconnect | Kirim `rejoin{code, teamId}` → server ikat ulang; entry tim **tidak** dihapus saat disconnect |
| Game sudah jalan saat rejoin | Server mengirim ulang `game_start` agar tim langsung ikut bermain |
| Host reconnect | Kirim `rejoin_host{code, adminPassword}` → kontrol host pulih, room tidak dibuat ulang |
| Host disconnect | Room tetap hidup (tanpa host) sampai TTL |
| Server mati total | Room hilang; host harus buat room baru |

### 4. Siklus status room

```
create_room ──► lobby ──start_game──► playing ──end_game──► ended
                  │                      │
                  └── join_room (≤10)    └── score_update / finish / rejoin
                                     TTL 2 jam ──► dihapus
```

---

## Protokol singkat

Semua pesan JSON, satu field `type`.

| Client → server | Fungsi |
| --- | --- |
| `create_room` | `{adminPassword, materi, duration}` → `room_created{code, room}` |
| `join_room` | `{code, teamName}` → `joined{code, teamId, room}` |
| `rejoin` | `{code, teamId}` → `rejoined{room}` (+ `game_start` bila sedang main) |
| `rejoin_host` | `{code, adminPassword}` → `rejoined_host{room}` |
| `start_game` | Host saja → broadcast `game_start` |
| `score_update` | `{score, floor, streak}` → broadcast `leaderboard` |
| `finish` | Skor akhir tim → broadcast `leaderboard` |
| `end_game` | Host saja → broadcast `game_end` |

| Server → client | Fungsi |
| --- | --- |
| `room_created` / `joined` / `rejoined` / `rejoined_host` | Konfirmasi + snapshot room |
| `room_update` | Daftar tim berubah (join / disconnect) |
| `game_start` | Mulai bermain: `materi`, `duration`, `serverTime` |
| `leaderboard` | Tim terurut skor menurun |
| `game_end` | Sesi selesai |
| `error` | `{message}` — mis. `Password admin salah`, `Room penuh (10 tim)` |

Detail model data & pesan: [docs/08-arsitektur-dan-protokol.md](docs/08-arsitektur-dan-protokol.md).

---

## Testing

### Unit test (Node `node:test`)

Butuh **Node.js 22+** (global `WebSocket`). Jalankan semua dari root project:

```bash
npm test        # 5 file test game/renderer/struktur/landing (317 test), --test-isolation=none
npm run test:vs-server   # suite server WebSocket Node (42 test, legacy/WIP: 1 gagal pre-existing)
```

Atau per file:

```bash
node --test --test-isolation=none tests/game-core.test.js
node --test --test-isolation=none tests/game-3d.test.js
node --test --test-isolation=none tests/game-vs-client.test.js
node --test --test-isolation=none tests/site-structure.test.js
node --test --test-isolation=none tests/landing.test.js
node --test --test-isolation=none tests/vs-server.test.js
```

> Flag `--test-isolation=none` wajib di lingkungan yang membatasi spawn proses;
> tanpa flag itu `node --test` bisa gagal karena sandbox, bukan karena test.

Test HTML menjalankan script asli dari `game.html` di sandbox DOM/canvas
(`tests/helpers/game-page.js`), jadi perubahan renderer ikut teruji tanpa GPU.
Test server menjalankan `vs-server` sungguhan di port acak. Cakupan tiap file ada di
[tests/README.md](tests/README.md).

### Test integrasi server (Bun)

```bash
bun test vs-server/server.bun.test.js     # 19 test: static, health, WS flow, rejoin
```

Mencakup: allowlist statis, `/health`, alur room lewat `/ws` dan `/vs-ws`,
multi-tim saling melihat, create → join → start → score → finish, `rejoin`,
`rejoin_host`, resume saat game berjalan, dan resolusi URL WS di client.

### Verifikasi visual 3D (screenshot)

Renderer software tidak cukup diuji unit test — pakai harness Edge headless:

```bash
# terminal 1 — server statis di root project
python -m http.server 4173

# terminal 2 — ambil screenshot beberapa skenario
node tools/capture3d.mjs \
  --url=http://127.0.0.1:4173/game.html \
  --out=.shots \
  --scenario=all
```

Skenario: `menu`, `solo-start`, `play`, `wrong`, `mid`, `space`,
`climb-history`, `mobile-portrait`, `mobile-landscape`, `fps`. Hasil PNG masuk ke
`.shots/<timestamp>/` beserta `summary.json`. Skenario `fps` mengukur frame rate
renderer — pada mesin uji Edge headless tanpa GPU di 1280×800 hasilnya ±55–61 fps
(angka indikatif). Harness menggagalkan proses bila ada exception/page error;
`console.error` baru ikut menggagalkan dengan `--strict`. Panduan lengkap:
[10 · Renderer 3D](docs/10-renderer-3d.md#13-verifikasi-visual-dengan-screenshot)
dan [tools/README.md](tools/README.md).

> `game.html` adalah sumber kebenaran (`star_pou_vs.html` wajib identik, dan
> `star_pou_sky_climber.html` adalah build tanpa blok `@vs-only`). Setelah mengubah
> `game.html`, bangun ulang keduanya dengan `npm run sync:solo`
> (atau `node tools/sync-solo.mjs`); `--check` hanya memeriksa tanpa menulis.
> Ada test struktur yang memeriksa hasil build.

---

## Troubleshooting

| Gejala | Penyebab umum | Solusi |
| --- | --- | --- |
| `Tidak bisa konek ke server WS` | Server belum jalan / port beda | `bun run start`, cek `/health` |
| Tim saling tidak terlihat | Beda origin/server atau kode salah | Pastikan semua buka URL yang sama |
| HP tidak bisa join | Link dibagikan berisi `localhost` | Host buka game lewat IP LAN, mis. `http://192.168.100.17:3001/game.html` |
| Panel admin "Terputus" | Server tidak jalan / diblokir | Cek console browser (F12), pastikan port terbuka |
| Join ditolak `Room sudah mulai` | Game sudah dimulai | Tunggu room baru dari host |
| Room hilang sendiri | Restart server / `bun run dev` / TTL 2 jam | Pakai `bun run start`, buat room baru |
| Port 3001 dipakai | Proses lama masih jalan | Hentikan proses itu atau ganti `PORT` |
| Layar game hitam / gambar aneh | Exception di renderer 3D | Buka DevTools (F12), lihat console; panduan [renderer §14](docs/10-renderer-3d.md#14-troubleshooting-renderer) |
| Render tersendat / fps turun | Renderer software berjalan di CPU; jendela/zoom terlalu besar | Perkecil jendela, tutup tab berat; DPR otomatis dibatasi 2 |

Daftar lengkap: [docs/09-troubleshooting-faq.md](docs/09-troubleshooting-faq.md),
[BUN.md](BUN.md), [DOCKER.md](DOCKER.md).

---

## Batasan yang perlu diketahui

- **Tanpa database**: room, tim, dan skor hanya di memori. Restart = reset.
- **Renderer software**: dunia 3D dihitung di CPU lalu digambar ke Canvas 2D —
  tanpa WebGL, tekstur, atau bayangan real-time. DPR dibatasi maksimal 2, dan
  kualitas/fps mengikuti kemampuan perangkat. Tampilan 3D tidak mengubah gameplay,
  skor, soal, HUD, maupun protokol VS.
- **Skor dari client** (client-authoritative, diklem ≥ 0). Cocok untuk kelas /
  kelompok tertutup, bukan kompetisi publik berhadiah.
- **Maksimal 10 tim per room**, join hanya saat `lobby`.
- **Soal hardcoded** di HTML, belum ada CRUD di panel admin →
  [docs/05-menambah-soal.md](docs/05-menambah-soal.md).
- Panel admin bukan sistem login: halaman publik, tetapi `create_room` butuh
  password.
- Jangan scale vertikal >1 replika tanpa sticky session: room tidak dibagi antar
  proses.

---

## Dokumentasi lanjutan

| Dokumen | Isi |
| --- | --- |
| [docs/01 · Mulai Cepat](docs/01-mulai-cepat.md) | Prasyarat, dua terminal (Node), peta URL |
| [docs/02 · Cara Main Solo](docs/02-cara-main-solo.md) | Kontrol, HUD, akhir permainan |
| [docs/03 · Panel Admin](docs/03-panel-admin.md) | Password, buat room, mulai mabar |
| [docs/04 · Mabar Multiplayer](docs/04-mabar-multiplayer.md) | Alur tim, aturan, reconnect |
| [docs/05 · Menambah Soal](docs/05-menambah-soal.md) | Struktur bank soal |
| [docs/06 · Mekanik & Skor](docs/06-mekanik-dan-skor.md) | Rumus poin, streak, zona |
| [docs/07 · Deploy VPS](docs/07-deploy-vps.md) | PM2, Nginx, WSS |
| [docs/08 · Arsitektur & Protokol](docs/08-arsitektur-dan-protokol.md) | Model data, pesan WS, rendering klien |
| [docs/09 · Troubleshooting & FAQ](docs/09-troubleshooting-faq.md) | Error & solusi |
| [docs/10 · Renderer 3D](docs/10-renderer-3d.md) | Kamera, proyeksi, zona, geometri, performa, screenshot |
| [BUN.md](BUN.md) | Menjalankan dengan Bun, pm2, nginx |
| [DOCKER.md](DOCKER.md) | Build image, compose, LAN, healthcheck |

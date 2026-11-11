# 08 · Arsitektur & Protokol

Dokumen ini untuk developer yang perlu memahami atau mengubah sistem. Isinya:
peta file, model data, siklus room, dan protokol WebSocket.

---

## 1. Peta file dan tanggung jawab

| File | Tanggung jawab |
|---|---|
| `index.html` | Landing, modal join, redirect ke `game.html` |
| `game.html` | Bank soal, engine game solo, renderer 3D software, client mabar (VS) |
| `star_pou_sky_climber.html` | Versi solo tanpa blok VS |
| `star_pou_vs.html` | Duplikat lama `game.html` (identik saat ini) |
| `admin/index.html` | UI host: buat room, lobby, mulai, leaderboard |
| `vs-server/server.js` | HTTP health + WebSocket room server |
| `vs-server/ecosystem.config.cjs` | Konfigurasi PM2 |
| `nginx-vs-snippet.conf` | Contoh proxy WebSocket (lihat catatan path di deploy) |
| `deploy-vs.ps1` | Skrip deploy lama/legacy |
| `tools/3d-engine-spec.md` | Spesifikasi kerja renderer 3D (internal) |
| `tools/capture3d.mjs` | Harness screenshot Edge headless + CDP untuk verifikasi visual |
| `tools/sync-solo.mjs` | Membangun `star_pou_sky_climber.html` + salinan `star_pou_vs.html` dari `game.html` |
| `docs/` | Dokumentasi ini |

Arsitektur bersifat **static frontend + satu proses Node**. Tidak ada database,
message queue, atau API REST selain `/health`.

---

## 2. Diagram runtime

```
Browser admin ─┐
Browser tim 1 ─┤   WebSocket /ws        ┌──────────────────────────┐
Browser tim 2 ─┼───────────────────────►│ vs-server (single proc)  │
     ...       │                        │ rooms: Map<code, Room>   │
Browser tim 10─┘                        └──────────────────────────┘
                                                │
                                                ├─ room_created / joined
                                                ├─ room_update
                                                ├─ game_start
                                                ├─ leaderboard
                                                ├─ player_state (relay ke observer)
                                                └─ game_end
```

- Host dan tim memakai koneksi WebSocket yang sama.
- Server membedakan peran dari state socket (`_isHost`, `_teamId`, `_room`).
- Observer spectator juga lewat WebSocket yang sama. Server mendaftarkannya di
  `room.observers` (bukan `teams`), sehingga observer tidak dihitung sebagai tim
  dan tidak ikut menerima balasan untuk tim.
- Semua pesan berupa JSON teks.

---

## 3. Rendering klien (3D)

Tampilan game memakai renderer 3D **software** di Canvas 2D: proyeksi perspektif,
painter's algorithm, dan flat shading dihitung di JavaScript, tanpa WebGL/three.js.
Semua kode renderer ada di dalam `game.html` (satu file, tanpa build step). HUD,
modal, dan panel VS tetap **DOM HTML biasa** — renderer hanya mengurus `<canvas>`.

### 3.1 Lapisan kode renderer

| Lapisan | Fungsi utama | Tugas |
|---|---|---|
| Konversi koordinat | `gameTo3D` | world game `(wx, wy)` → world 3D `(x, -y, z)` |
| Kamera | `updateCameraRig` | menulis global `camera3D` (eye, basis, focal, near, dist, yaw) |
| Proyeksi | `projectPoint`, `projectGamePoint`, `clipPolygonNear` | world 3D → layar, potong di near plane |
| Warna | `shadeHex`, `mixHex`, `zonePalette` | shading toon, kabut, gradien langit per zona |
| Geometri | `platformMesh`, `starMesh` | mesh 3D platform dan prisma bintang |
| Urutan | `sortByDepth`, `drawPoly3` | sort jauh → dekat lalu gambar polygon |
| Gambar | `drawSkyAndEnvironment`, `drawPlatform`, `drawStarPou`, `animate` | komposisi satu frame |

### 3.2 Kamera dan proyeksi per frame

1. `animate(t)` dijalankan `requestAnimationFrame`.
2. `cam.x`/`cam.y` di-ease menuju `cam.targetX`/`cam.targetY` (target naik saat
   pemain mendarat di platform benar).
3. `updateCameraRig()` menghitung `camera3D`: titik bidik, posisi mata kamera, jarak
   adaptif terhadap viewport, FOV 55°, near plane 20, dan basis `fwd/right/up`.
4. Setiap titik world diproyeksikan dengan `projectGamePoint()`; hasilnya dipakai
   untuk menggambar polygon, teks, dan sprite. Objek di belakang kamera dipotong
   `clipPolygonNear()` atau dilewati (culling).

### 3.3 Depth sort dan zona

- Tidak ada depth buffer. `sortByDepth()` mengurutkan kumpulan objek berdasarkan
  `depth` proyeksi, lalu digambar jauh → dekat.
- Zona langit dihitung dari `altitudePx = max(0, -cam.y)` dengan ambang
  `[900, 1800, 2700]`; `zonePalette()` mengembalikan warna gradien, kabut, tint
  awan, alpha bintang/planet, intensitas `sunset`, flag `cosmic`, dan nama zona.

### 3.4 Cache dan ukuran canvas

- Sprite awan/glow digambar sekali ke canvas offscreen lalu dipakai ulang.
- Mesh platform di-cache lazy di `p._mesh3d`; prisma bintang dari `starMesh()`.
- Canvas memakai DPR maksimal 2:
  `dpr = min(devicePixelRatio, 2)`, backing store `W×dpr`/`H×dpr`,
  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Saat `resize`, `W`, `H`, `STEP_X`,
  ukuran canvas, dan rig kamera dihitung ulang.

### 3.5 Alur satu frame

| # | Langkah | Kode |
|---|---|---|
| 1 | Ease kamera world, hitung rig 3D | `cam`, `updateCameraRig()` |
| 2 | Langit, bintang, bulan/planet, awan latar | `drawSkyAndEnvironment(t)` |
| 3 | Pulau bumi (bila masih terlihat) | `drawGroundIsland()` |
| 4 | Panduan lompat (hanya saat idle) | `animate()` |
| 5 | Platform lampau + 2 pilihan jawaban, urut jauh → dekat | `sortByDepth`, `drawPlatform` |
| 6 | Fisika lompat/jatuh, shadow, karakter bintang | `animate()`, `drawStarPou(t)` |
| 7 | Konfeti + teks melayang | `particles`, `floatingTexts` |
| 8 | Awan foreground + vignette | penutup frame |

Physics, skor, soal, timer, dan protokol VS di luar langkah-langkah itu dan tidak
disentuh oleh renderer. Detail rumus proyeksi, geometri, dan tuning ada di
[10 · Renderer 3D](10-renderer-3d.md).

---

## 4. Model data

### Room (in-memory)

```js
{
  code: 'RQ7K2P',
  materi: 'all',
  duration: 180,
  status: 'lobby',        // 'lobby' | 'playing' | 'ended'
  hostId: 'abc1234',
  hostWs: WebSocket | null,
  createdAt: 1760000000000,
  startedAt: 1760000100000,
  teams: Map<teamId, Team>,
  observers: Set<Connection>   // observer spectator (bukan tim)
}
```

### Team

```js
{
  id: 'x9k2a',
  name: 'KELOMPOK BINTANG 2',
  score: 0,
  floor: 0,
  streak: 0,
  ws: WebSocket | null,
  state: { ... } | null,       // snapshot telemetri terakhir dari client
  stateAt: 1760000112345       // waktu snapshot diterima (ms)
}
```

### Bentuk publik yang dikirim ke client

`roomPublic(room)` hanya mengirim data aman (tanpa socket/host):

```json
{
  "code": "RQ7K2P",
  "materi": "all",
  "duration": 180,
  "status": "lobby",
  "teams": [
    { "id": "x9k2a", "name": "TIM A", "score": 0, "floor": 0, "streak": 0 }
  ]
}
```

### Telemetri pemain (`player_state`)

Data yang dikirim tim sekitar **8×/detik** khusus untuk spectator. Bentuk `s`
ditentukan client (state renderer), dan server tidak menghitung gameplay dari
sini. Isinya:

- posisi kamera dan posisi bintang,
- status lompat/jatuh,
- papan soal kiri/kanan,
- riwayat tangga,
- skor, streak, dan floor sebagai salinan tampilan, bukan sumber leaderboard.

Envelope yang diteruskan server ke observer:

```js
{ type: 'player_state', teamId: 'x9k2a', s: { /* state klien */ }, t: 1760000112345 }
```

Server menyimpan objek `s` terakhir di `team.state` bersama `team.stateAt`, lalu
mengirimnya ke observer yang baru bergabung. Sebelum disimpan, `s` disaring ke
field yang dikenal (angka dibatasi, teks dipotong, riwayat tangga maksimal 8
entri), jadi field asing tidak ikut diteruskan. `roomPublic()` tidak berubah, jadi
semua pesan room lama tetap kompatibel.

### Konstanta penting

| Konstanta | Nilai | Lokasi |
|---|---|---|
| `MAX_TEAMS` | 10 | `vs-server/server.js` |
| `ROOM_TTL_MS` | 2 jam | `vs-server/server.js` |
| Cleanup interval | 10 menit | `vs-server/server.js` |
| Alfabet kode | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 karakter) | server |
| Panjang kode | 6 | server |
| Panjang nama tim | 24 | server |
| `STEP_Y` | 210 px | `game.html` |
| `STEP_X` | `min(230, W × 0.23)` | `game.html` |
| `CAM_FOV_DEG` | 55° | `game.html` |
| `CAM_NEAR` | 20 | `game.html` |
| `ZONE_STEPS` | `[900, 1800, 2700]` px | `game.html` |
| `AU` | `STEP_Y × 0.86` (≈180,6) | `game.html` |
| `EYE_ABOVE` | 160 | `game.html` |
| Jarak kamera minimum | 340 | `game.html` |
| DPR maksimum | 2 | `game.html` |
| Throttle skor | 400 ms | `game.html` |
| Telemetri `player_state` | ±8×/detik (≈125 ms) | `game.html` |
| Target FPS spectator | ±30 | `game.html` |
| Rentang zoom pane spectator | 70%–240% (langkah 20%, reset 100%) | `game.html` |
| Reconnect VS | 2 detik | `game.html` |
| Delay benar / salah | 550 ms / 900 ms | `game.html` |
| Ambang tanpa batas | durasi ≥ 9000 | `game.html` |

---

## 5. Siklus hidup room

```
create_room
   │
   ▼
 lobby ──(join_room)──► lobby ──(start_game)──► playing
   │                                               │
   │                                               ├─ score_update → leaderboard
   │                                               ├─ player_state → observer
   │                                               ├─ finish → leaderboard
   │                                               └─ end_game → ended
   │
   ├─ spectate → observer (read-only)
   └─ TTL 2 jam / restart server → dihapus
```

| Aksi | Syarat | Efek |
|---|---|---|
| `create_room` | Password benar | Room baru, host terikat |
| `join_room` | Room ada, status lobby, <10 tim, nama unik | Tim baru, broadcast `room_update` |
| `rejoin` | Room & teamId ada | Socket tim diganti, kirim `rejoined` (+ `game_start` bila playing) |
| `rejoin_host` | Room ada & password benar | Socket host diganti, kirim `rejoined_host` (+ `game_start` bila playing) |
| `start_game` | Socket host, minimal 1 tim | Status playing, broadcast `game_start` |
| `score_update` | Room playing, socket terikat tim | Simpan + broadcast `leaderboard` |
| `finish` | Room ada, socket terikat tim | Update final + broadcast `leaderboard` |
| `end_game` | Socket host | Status ended, broadcast `game_end` |
| `spectate` | Password admin benar, room ada | Observer terdaftar di `observers`, balas `spectate_ok` + snapshot terakhir |
| `spectate_leave` | — | Observer dilepas dari room |
| `player_state` | Room playing, socket terikat tim | Simpan `team.state`/`stateAt`, relay ke observer room itu |
| Disconnect host | — | `hostWs = null`, room tetap hidup |
| Disconnect tim | — | `team.ws = null`, entry tetap, broadcast `room_update` + `team_offline` ke observer |
| Disconnect observer | — | Dihapus dari `observers`, room tetap hidup |

Catatan:

- `start_game` **tidak mengecek status**; host bisa memicu ulang dan merestart
  permainan.
- `game_start` dikirim lewat `broadcast` (termasuk host) lalu dikirim sekali lagi
  khusus ke host, sehingga host menerima dua pesan.
- `finish` belum dipakai UI client.
- Room `ended` tetap berada di Map sampai TTL.

### Alur spectator

```
ADMIN spectator ──spectate{code, adminPassword}──► RoomManager
                                                      │
                                    spectate_ok + snapshot ──► observer
                                                      │
TIM 1..10 ──player_state ±8 Hz──► simpan team.state ──┼──relay player_state──► observer
                                                      │
                                    team_offline ─────┘ (socket tim putus)
```

Observer hanya membaca: pesan `player_state` dari observer diabaikan karena
socket observer tidak punya `teamId`. Relay `player_state` tidak pernah dikirim
ke tim lain atau host biasa di room yang sama.

---

## 6. Endpoint

| Endpoint | Metode | Respons |
|---|---|---|
| `/ws` | WebSocket upgrade | Protokol di bawah |
| `/health` | GET | `{ "ok": true, "rooms": 0 }` |
| Path lain | GET | Teks `sev7en-vs ws at /ws` |

URL client:

| Lingkungan | URL |
|---|---|
| `localhost` / `127.0.0.1` | `ws://localhost:3001/ws` |
| Production HTTPS | `wss://<host>/vs-ws` |
| Production HTTP | `ws://<host>/vs-ws` |

---

## 7. Protokol client → server

Semua pesan berupa objek JSON dengan field `type`.

### `create_room`

```json
{
  "type": "create_room",
  "adminPassword": "sev7en-admin",
  "materi": "all",
  "duration": 180
}
```

- Password dibandingkan dengan `ADMIN_PASSWORD`.
- `materi` default `all`; `duration` default 180.
- Balasan sukses: `room_created`.

### `join_room`

```json
{ "type": "join_room", "code": "RQ7K2P", "teamName": "TIM A" }
```

- `code` di-uppercase dan di-trim.
- `teamName` di-trim dan dipotong maksimal 24 karakter.
- Balasan sukses: `joined` + broadcast `room_update`.

### `rejoin`

```json
{ "type": "rejoin", "code": "RQ7K2P", "teamId": "x9k2a" }
```

- Hanya berhasil jika room dan teamId masih ada.
- Tidak divalidasi password; bergantung pada kerahasiaan `teamId`.
- Client mengirimnya otomatis saat WebSocket tersambung ulang, selama `code` dan
  `teamId` masih ada di memori halaman. Identitas tidak disimpan di
  `localStorage`, jadi refresh halaman tetap menghilangkannya.
- Setelah rejoin sukses, server mengirim `game_start` lagi bila room sedang
  `playing`.

### `rejoin_host`

```json
{ "type": "rejoin_host", "code": "RQ7K2P", "adminPassword": "sev7en-admin" }
```

- Hanya berhasil bila room ada dan password benar; kegagalan tidak dibalas.
- Socket dijadikan host kembali (`hostWs`/`hostConn` diganti), lalu server
  mengirim `rejoined_host`. Bila room sedang `playing`, `game_start` dikirim ulang.
- Client mengirimnya otomatis saat WebSocket tersambung ulang selama kode room
  masih di memori (host membuat room dari `game.html`, atau panel admin yang
  tab-nya tidak di-refresh).

### `start_game`

```json
{ "type": "start_game" }
```

- Hanya socket host.
- Minimal 1 tim.
- Menyiarkan `game_start`.

### `score_update`

```json
{ "type": "score_update", "score": 520, "floor": 4, "streak": 4 }
```

- Hanya diterima saat status room `playing`.
- `score` dan `floor` di-clamp minimal 0.
- `streak` disimpan apa adanya.
- Menyiarkan `leaderboard` terurut.

### `finish`

```json
{ "type": "finish", "score": 1300, "floor": 8 }
```

- Update final; nilai 0 diabaikan (memakai nilai sebelumnya).
- Menyiarkan `leaderboard` (tanpa field `streak`).

### `end_game`

```json
{ "type": "end_game" }
```

- Hanya host.
- Status `ended`, siarkan `game_end`.

### `spectate`

```json
{ "type": "spectate", "code": "RQ7K2P", "adminPassword": "sev7en-admin" }
```

- Password dibandingkan dengan `ADMIN_PASSWORD`; password salah atau room tidak
  ada dibalas `error`.
- Socket yang lolos didaftarkan ke `room.observers`. Observer **tidak** masuk
  `teams`, tidak mengubah status room, dan tidak bisa memakai pesan host.
- Balasan: `spectate_ok` berisi snapshot room, `startedAt`, `duration`, jumlah
  observer, lalu `player_state` terakhir tiap tim (kalau ada).
- `startedAt` bernilai `null` selama room masih lobby; observer tetap bisa masuk
  dan menunggu sampai host memulai permainan.

### `spectate_leave`

```json
{ "type": "spectate_leave" }
```

- Mengeluarkan socket dari `room.observers`; room tetap hidup.
- Tidak wajib dikirim sebelum menutup koneksi: disconnect juga membersihkan
  observer.

### `player_state`

```json
{ "type": "player_state", "s": { "…": "state renderer klien" } }
```

- Hanya diproses bila socket terikat ke sebuah tim dan status room `playing`.
  Telemetri yang datang sebelum host menekan mulai diabaikan.
- Server menyimpan `team.state = msg.s` dan `team.stateAt = Date.now()`, lalu
  meneruskan `{ type: 'player_state', teamId, s, t }` ke observer room itu saja.
- Tidak disiarkan ke tim lain atau host yang bukan observer.
- `player_state` dari observer diabaikan (observer tidak punya `teamId`).
- Skor leaderboard tetap bersumber dari `score_update`, bukan dari `s`.

---

## 8. Protokol server → client

| Pesan | Field | Kapan |
|---|---|---|
| `room_created` | `code`, `room` | Setelah create sukses |
| `joined` | `code`, `teamId`, `room` | Setelah join sukses |
| `rejoined` | `room` | Setelah rejoin sukses |
| `rejoined_host` | `room` | Setelah rejoin_host sukses |
| `room_update` | `room` | Tim join atau disconnect |
| `game_start` | `materi`, `duration`, `serverTime` | Host memulai |
| `leaderboard` | `teams[]` | Skor berubah / finish |
| `game_end` | — | Host mengakhiri |
| `spectate_ok` | `code`, `room`, `startedAt`, `duration`, `observers` | Setelah `spectate` sukses |
| `player_state` | `teamId`, `s`, `t` | Relay telemetri tim ke observer |
| `team_offline` | `teamId` | Socket tim putus |
| `error` | `message` | Validasi gagal |

Pesan room lama (`room_update`, `leaderboard`, `game_start`, `game_end`,
`error`) juga disiarkan ke observer room itu; bentuknya tidak berubah. Relay
`player_state` hanya ke observer, tidak ke tim.

Contoh `game_start`:

```json
{
  "type": "game_start",
  "materi": "food_kitchen",
  "duration": 300,
  "serverTime": 1760000100000
}
```

Contoh `leaderboard`:

```json
{
  "type": "leaderboard",
  "teams": [
    { "id": "x9k2a", "name": "TIM A", "score": 520, "floor": 4, "streak": 4 },
    { "id": "p2m7q", "name": "TIM B", "score": 300, "floor": 3, "streak": 0 }
  ]
}
```

`teams` selalu diurutkan menurun berdasarkan `score`. Pada pesan dari `finish`,
field `streak` tidak disertakan.

Contoh `error`:

```json
{ "type": "error", "message": "Nama tim sudah dipakai" }
```

Contoh `spectate_ok`:

```json
{
  "type": "spectate_ok",
  "code": "RQ7K2P",
  "room": {
    "code": "RQ7K2P",
    "materi": "all",
    "duration": 180,
    "status": "playing",
    "teams": [
      { "id": "x9k2a", "name": "TIM A", "score": 520, "floor": 4, "streak": 4 }
    ]
  },
  "startedAt": 1760000100000,
  "duration": 180,
  "observers": 1
}
```

`observers` dihitung dari jumlah socket observer aktif di room itu. Snapshot
telemetri dikirim menyusul sebagai pesan `player_state` terpisah per tim.

Contoh `player_state` (relay ke observer):

```json
{
  "type": "player_state",
  "teamId": "x9k2a",
  "s": { "…": "state renderer klien" },
  "t": 1760000112345
}
```

Contoh `team_offline`:

```json
{ "type": "team_offline", "teamId": "x9k2a" }
```

---

## 9. Perilaku koneksi dan error

- JSON rusak diabaikan tanpa balasan.
- Tipe pesan tidak dikenal diabaikan.
- `broadcast()` melewati socket yang sudah tertutup dan socket yang dikecualikan.
- Error `send` ditelan (`try/catch`) agar satu socket bermasalah tidak
  menghentikan broadcast.
- Socket yang belum pernah join tidak memengaruhi room saat disconnect.
- Observer yang putus dihapus dari `room.observers`; relay ke room lain tidak
  terpengaruh.
- Server tidak mengirim heartbeat; koneksi mati terdeteksi lewat event `close`
  dari `ws`.

---

## 10. Batasan desain

| Area | Kondisi saat ini | Implikasi |
|---|---|---|
| Persistence | Memori proses | Restart = data hilang |
| Skor | Client-authoritative | Rawan manipulasi |
| Auth host | Hanya `_isHost` di socket | Refresh = kehilangan host |
| Rejoin | Otomatis saat socket tersambung ulang; identitas di memori halaman | Refresh tim = keluar permanen, tidak ada tombol rejoin manual |
| Soal | Hardcoded di HTML | Butuh deploy untuk ubah |
| Skala | Satu proses, satu instance | Tidak bisa horizontal scaling tanpa state sharing |
| Observability | Hanya `/health` + log | Tidak ada metrik/audit |
| Rate limit | Tidak ada | Rentan spam pesan |
| Telemetri spectator | Relay `player_state` ±8 Hz per tim, hanya snapshot terakhir | Tidak ada riwayat/playback; observer baru melihat kondisi terkini |
| Beban spectator | Semua pane dirender di browser admin, target ±30 fps | Beban CPU di perangkat admin, bukan di server |

---

## 11. Titik ekstensi yang masuk akal

Jika sistem dikembangkan, urutan prioritas yang wajar:

1. **Tombol end + podium** di admin, memakai `end_game` yang sudah ada.
2. **Rejoin tahan-refresh**: simpan `{code, teamId}` di `localStorage`, lalu kirim
   `rejoin` saat halaman dibuka. Saat ini rejoin hanya jalan untuk socket yang
   putus tanpa refresh.
3. **Host reconnect yang tahan-refresh**: `rejoin_host` sudah ada, tetapi kode
   room host hanya di memori tab; token host yang persisten belum ada.
4. **Soal dari server/API** agar guru bisa menambah soal tanpa deploy, sekaligus
   memungkinkan soal sama untuk semua tim.
5. **Validasi skor di server** (server menghitung poin dari jawaban, bukan
   menerima angka dari client).
6. **Penyimpanan hasil** ke database untuk rekap kelas.
7. **Rate limiting** dan autentikasi room.

Semua perubahan itu memerlukan penyesuaian client, server, dan dokumentasi ini.

---

## 12. Ringkasan keamanan

- Gunakan WSS/HTTPS.
- Ganti password default.
- Jangan membuka port 3001 langsung ke publik.
- Anggap kode room sebagai rahasia kelas, bukan kredensial kuat.
- Jangan memakai skor untuk penilaian formal tanpa pengawasan.
- Batasi akses panel admin di level jaringan bila perlu (VPN/IP allowlist).
- Observer spectator lolos hanya dengan password admin, dan telemetri pemain
  tidak pernah dikirim ke tim lain. Password observer tetap lewat WebSocket,
  jadi WSS wajib di production.
- Perhatikan `sessionStorage` di browser admin: key `sev7en-admin-pass` menyimpan
  password selama tab hidup. Jangan menonton dari perangkat bersama tanpa
  membersihkan sessionStorage setelah sesi selesai.

Lanjut ke [09 · Troubleshooting & FAQ](09-troubleshooting-faq.md).

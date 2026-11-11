# 08 · Arsitektur & Protokol

Dokumen ini untuk developer yang perlu memahami atau mengubah sistem. Isinya:
peta file, model data, siklus room, dan protokol WebSocket.

---

## 1. Peta file dan tanggung jawab

| File | Tanggung jawab |
|---|---|
| `index.html` | Landing, modal join, redirect ke `game.html` |
| `game.html` | Bank soal (50 soal tema `living_room`), engine game solo, renderer 3D software, client mabar (VS) |
| `star_pou_sky_climber.html` | Versi solo tanpa blok VS |
| `star_pou_vs.html` | Duplikat lama `game.html` (identik saat ini) |
| `admin/index.html` | UI host: buat room, lobby, mulai, leaderboard, hasil/pemenang, main lagi, hapus room |
| `vs-server/server.js` | Adapter Node: HTTP health + WebSocket (`/ws`) |
| `vs-server/server.bun.js` | Adapter Bun: file statis + WebSocket (`/ws`, `/vs-ws`) + health |
| `vs-server/room-manager.js` | Logika room/protokol, timer akhir pertandingan, hasil/pemenang (dipakai kedua adapter) |
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
                                                ├─ game_start (round)
                                                ├─ leaderboard
                                                ├─ player_state (relay ke observer)
                                                ├─ game_end (MatchResult)
                                                └─ room_deleted / team_offline
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
  materi: 'living_room',  // tema tunggal; server hanya meneruskan string
  duration: 180,
  status: 'lobby',        // 'lobby' | 'playing' (setelah selesai kembali 'lobby')
  hostId: 'abc1234',
  hostWs: WebSocket | null,
  createdAt: 1760000000000,
  startedAt: 1760000100000,      // null saat lobby / setelah pertandingan selesai
  round: 1,                      // ronde ke-n; 0 sebelum start pertama, +1 tiap start
  lastResult: MatchResult | null,// hasil ronde terakhir (untuk rejoin & spectate)
  endTimer: Timeout | null,      // timer akhir otomatis (duration*1000 + grace)
  teams: Map<teamId, Team>,
  observers: Set<Connection>   // observer spectator (bukan tim)
}
```

Status `ended` tidak lagi disimpan di room. Saat pertandingan berakhir, server
menyiarkan `game_end` lalu mengembalikan `status` ke `'lobby'` supaya kode room
dapat dipakai untuk ronde berikutnya.

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

### Hasil pertandingan (`MatchResult`)

Dihitung di server oleh `matchResult(room, reason)` dan disimpan di
`room.lastResult`:

```js
{
  reason: 'time',        // 'time' (timer server) | 'host' (end_game)
  endedAt: 1760000180000,
  round: 2,
  winner: { id, name, score, floor, streak, rank } | null, // null bila seri
  tied: false,           // true bila skor & floor posisi teratas sama
  winners: [ { ...team, rank: 1 } ],  // semua tim di posisi teratas
  teams: [ { ...team, rank: 1 }, { ...team, rank: 2 } ]
}
```

Urutan klasemen (`rankTeams`): skor menurun → `floor` menurun → nama (alfabetis)
→ id sebagai penentu terakhir agar deterministik. `winner` hanya diisi bila
posisi teratas tunggal; bila seri, `winner: null`, `tied: true`, dan `winners[]`
berisi semua tim yang berbagi posisi teratas. Room tanpa tim menghasilkan
`teams: []`, `winner: null`, `tied: false`.

### Bentuk publik yang dikirim ke client

`roomPublic(room)` hanya mengirim data aman (tanpa socket/host):

```json
{
  "code": "RQ7K2P",
  "materi": "living_room",
  "duration": 180,
  "status": "lobby",
  "teams": [
    { "id": "x9k2a", "name": "TIM A", "score": 0, "floor": 0, "streak": 0 }
  ]
}
```

`roomPublic()` **tidak berubah** pada fitur ronde berulang dan hapus room: field-nya
tetap `code`, `materi`, `duration`, `status`, dan `teams[]` (`id`, `name`, `score`,
`floor`, `streak`). Pemenang, klasemen, `round`, dan `lastResult` dikirim terpisah
di `game_end`, `rejoined`, `spectate_ok`, dan `rejoined_host`, bukan ditempel ke room publik.
Nilai `status` yang mungkin dikirim sekarang hanya `lobby` dan `playing` (tidak ada
`ended`).

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
| `MAX_TEAMS` | 10 | `vs-server/room-manager.js` |
| `ROOM_TTL_MS` | 2 jam | `vs-server/room-manager.js` |
| Cleanup interval | 10 menit | adapter Node & Bun (`server.js`, `server.bun.js`) |
| `MATCH_GRACE_MS` | 1200 ms | `vs-server/room-manager.js` |
| Akhir otomatis match | `duration × 1000 + MATCH_GRACE_MS` (kecuali durasi ≥ 9000) | `vs-server/room-manager.js` |
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
 lobby ──(join_room)──► lobby ──(start_game: round+1, reset skor)──► playing
   ▲                                                                  │
   │                                                                  ├─ score_update → leaderboard
   │                                                                  ├─ player_state → observer
   │                                                                  ├─ finish → leaderboard (saat grace)
   │                                                                  ├─ end_game (host) ─┐
   │                                                                  └─ timer server     ─┤
   │                                                                                        ▼
   │                        game_end (MatchResult) + room_update ◄───────────── _finishMatch
   │                        status kembali 'lobby', tim tetap terdaftar
   │
   ├─ delete_room (host) ──► room_deleted, room dihapus permanen
   └─ TTL 2 jam / restart server → dihapus
```

| Aksi | Syarat | Efek |
|---|---|---|
| `create_room` | Password benar | Room baru (`round: 0`, `lastResult: null`), host terikat |
| `join_room` | Room ada, status lobby, <10 tim, nama unik | Tim baru, broadcast `room_update` |
| `rejoin` | Room & teamId ada | Socket tim diganti, kirim `rejoined` (+ `game_start` bila playing) |
| `rejoin_host` | Room ada & password benar | Socket host diganti, kirim `rejoined_host` berisi `round` + `lastResult` (+ `game_start` bila playing) |
| `start_game` | Socket host, minimal 1 tim, room **bukan** `playing` | Status playing, `round` +1, skor/floor/streak/telemetri tim direset, broadcast `game_start{round}`, jadwalkan akhir otomatis (kecuali durasi ≥ 9000); bila `playing` dibalas error |
| `score_update` | Room playing, socket terikat tim | Simpan + broadcast `leaderboard` |
| `finish` | Room playing, socket terikat tim | Update nilai final (nilai 0 diabaikan) + broadcast `leaderboard` |
| `end_game` | Socket host, room **playing** | `_finishMatch('host')`: hitung hasil, status kembali lobby, broadcast `game_end` |
| Timer akhir otomatis | Room playing, `0 < duration < 9000` | `_finishMatch('time')` pada `duration × 1000 + MATCH_GRACE_MS` |
| `delete_room` | Socket host yang masih terikat room | Hentikan timer, hapus room, broadcast `room_deleted`, lepaskan semua socket |
| `spectate` | Password admin benar, room ada | Observer terdaftar di `observers`, balas `spectate_ok` (+ `round`, `lastResult`) + snapshot terakhir |
| `spectate_leave` | — | Observer dilepas dari room |
| `player_state` | Room playing, socket terikat tim | Simpan `team.state`/`stateAt`, relay ke observer room itu |
| Disconnect host | — | `hostWs = null`, room tetap hidup |
| Disconnect tim | — | `team.ws = null`, entry tetap, broadcast `room_update` + `team_offline` ke observer |
| Disconnect observer | — | Dihapus dari `observers`, room tetap hidup |

Catatan:

- `start_game` hanya diterima saat room **tidak** `playing`. Dari lobby (termasuk
  setelah ronde selesai) ia memulai ronde baru; bila dikirim saat `playing`,
  server membalas `Pertandingan sedang berjalan` dan tidak mereset ronde. UI
  panel admin juga menonaktifkan tombol selama bermain, jadi klik ganda aman.
- `game_start` dikirim lewat `broadcast` (termasuk host) lalu dikirim sekali lagi
  khusus ke host, sehingga host menerima dua pesan.
- `finish` kini dipakai UI client: dikirim saat timer lokal habis, masih diterima
  server selama masa grace sebelum akhir otomatis.
- `_finishMatch` menyiarkan `game_end` **dan** `room_update`, lalu room kembali ke
  `lobby`. Room tidak pernah berstatus `ended`; layar “SELESAI”/GAME OVER murni
  ditampilkan client dari `game_end` (dan dari `lastResult` saat rejoin/spectate).
- Room baru benar-benar hilang lewat `delete_room`, TTL, atau restart server; kode
  room yang sama dipakai untuk semua ronde.

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

Observer juga menerima `game_end` (kartu GAME OVER beserta pemenang dan klasemen)
dan `room_deleted` (room dihapus host). Saat ronde berikutnya dimulai,
`game_start` menghapus kartu hasil dan mereset snapshot kamera tim di layar
spectator.

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
  "materi": "living_room",
  "duration": 180
}
```

- Password dibandingkan dengan `ADMIN_PASSWORD`.
- `duration` default 180.
- `materi` default `all` di server, tetapi form admin/VS selalu mengirim
  `living_room` (satu-satunya tema). Server **tidak** memvalidasi/whitelist tema.
- Client menormalkan `materi` yang tidak ada di `QUESTION_BANK` (termasuk `all`
  dan kode tema lama) menjadi `living_room` saat menerima `game_start`.
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
- Balasan `rejoined` juga membawa `round` dan `lastResult` (hasil ronde terakhir
  atau `null`). Jika socket putus tepat saat ronde selesai, client pemain tetap
  bisa menampilkan layar pemenang dari `lastResult` meski `game_end` terlewat.

### `rejoin_host`

```json
{ "type": "rejoin_host", "code": "RQ7K2P", "adminPassword": "sev7en-admin" }
```

- Hanya berhasil bila room ada dan password benar; kegagalan tidak dibalas.
- Socket dijadikan host kembali (`hostWs`/`hostConn` diganti), lalu server
  mengirim `rejoined_host` berisi `room`, `round`, dan `lastResult` (hasil ronde
  terakhir, atau `null` bila belum ada pertandingan). Bila room sedang `playing`,
  `game_start` dikirim ulang.
- Client mengirimnya otomatis saat WebSocket tersambung ulang selama kode room
  masih di memori (host membuat room dari `game.html`, atau panel admin yang
  tab-nya tidak di-refresh).

### `start_game`

```json
{ "type": "start_game" }
```

- Hanya socket host; socket yang sudah terlepas dari room dibalas error
  `Hanya host yang bisa start`.
- Minimal 1 tim; bila kosong dibalas `Belum ada tim join`.
- Boleh dikirim dari lobby (memulai ronde baru) maupun saat `playing`.
- Efek: `round` bertambah, skor/floor/streak dan telemetri semua tim direset,
  status menjadi `playing`, `game_start` disiarkan (plus satu salinan ke host), dan
  akhir otomatis dijadwalkan bila durasi < 9000.

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
{ "type": "finish", "score": 1300, "floor": 8, "streak": 4 }
```

- Hanya diterima saat status room `playing` (termasuk selama masa grace sebelum
  akhir otomatis). Di luar itu pesan diabaikan.
- Update final; nilai 0 pada `score`/`floor` diabaikan (memakai nilai sebelumnya).
- Menyiarkan `leaderboard` (tanpa field `streak`).
- Dikirim client saat timer lokal tim habis, sebelum layar “WAKTU HABIS” sementara
  tampil menunggu hasil resmi.

### `end_game`

```json
{ "type": "end_game" }
```

- Hanya host; pesan dari socket non-host diabaikan. Hanya diproses saat status room
  `playing` — bila host mengirimnya saat tidak ada pertandingan, server membalas
  error `Tidak ada pertandingan yang berjalan`.
- Menghitung pemenang dari skor terakhir, menyimpan `lastResult`, mengembalikan
  status room ke `lobby`, lalu menyiarkan `game_end` + `room_update`.

### `delete_room`

```json
{ "type": "delete_room" }
```

- Hanya host yang masih terikat pada room. Socket non-host yang masih terikat
  dibalas error `Hanya host yang bisa menghapus room`; socket yang sudah terlepas
  dari room diabaikan.
- Server menghentikan `endTimer` pertandingan, menghapus room dari `rooms`, lalu
  menyiarkan `room_deleted{code, message}` ke tim, host, dan observer sebelum
  melepaskan semua socket dari room.
- Kode room tidak bisa dipakai lagi: `join_room` berikutnya dibalas
  `Room tidak ditemukan`.

### `spectate`

```json
{ "type": "spectate", "code": "RQ7K2P", "adminPassword": "sev7en-admin" }
```

- Password dibandingkan dengan `ADMIN_PASSWORD`; password salah atau room tidak
  ada dibalas `error`.
- Socket yang lolos didaftarkan ke `room.observers`. Observer **tidak** masuk
  `teams`, tidak mengubah status room, dan tidak bisa memakai pesan host.
- Balasan: `spectate_ok` berisi snapshot room, `startedAt`, `duration`, `round`,
  `lastResult`, jumlah observer, lalu `player_state` terakhir tiap tim (kalau ada).
- `lastResult` diisi hasil ronde terakhir (atau `null` bila belum ada), sehingga
  admin yang membuka **Tonton Live** setelah pertandingan selesai tetap melihat
  GAME OVER + pemenang.
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
| `rejoined` | `room`, `round`, `lastResult` | Setelah rejoin sukses |
| `rejoined_host` | `room`, `round`, `lastResult` | Setelah rejoin_host sukses |
| `room_update` | `room` | Tim join/disconnect, `start_game`, atau setelah `game_end` |
| `game_start` | `materi`, `duration`, `serverTime`, `remaining`, `remainingMs`, `round` | Host memulai ronde, rejoin, atau rejoin_host saat `playing` |
| `leaderboard` | `teams[]` | Skor berubah / finish |
| `game_end` | `reason`, `endedAt`, `round`, `winner`, `tied`, `winners[]`, `teams[]` | Host menekan AKHIRI atau timer server habis |
| `spectate_ok` | `code`, `room`, `startedAt`, `duration`, `remaining`, `remainingMs`, `round`, `lastResult`, `observers` | Setelah `spectate` sukses |
| `player_state` | `teamId`, `s`, `t` | Relay telemetri tim ke observer |
| `team_offline` | `teamId` | Socket tim putus |
| `room_deleted` | `code`, `message` | Host menghapus room |
| `error` | `message` | Validasi gagal |

Pesan room (`room_update`, `leaderboard`, `game_start`, `game_end`, `room_deleted`,
`error`) disiarkan ke tim, host, dan observer room itu. Bentuk `room_update`,
`leaderboard`, dan `error` tidak berubah; `game_end` sekarang berupa objek hasil
(MatchResult), bukan pesan kosong. Relay `player_state` dan `team_offline` hanya ke
observer, tidak ke tim.

### Jam pertandingan (`remaining` / `remainingMs`)

`remaining` adalah **sisa detik pertandingan saat pesan dibuat di server**
(dibulatkan ke atas, `null` saat lobby atau durasi "Tanpa Batas" >= 9000).
`remainingMs` adalah nilai yang sama dalam **milidetik** (lebih presisi).
Client tidak memakai jam absolut perangkatnya untuk menghitung sisa waktu:
nilai ini diubah menjadi deadline lokal `Date.now() + remainingMs`, lalu tick
dijadwalkan tepat di batas detik deadline. Hasilnya HUD pemain, timer
leaderboard, dan status **BERMAIN mm:ss** di layar spectator admin menunjuk
detik yang sama (bukan sekadar ±1 detik) meski jam antar perangkat berbeda dan
`game_start` datang terlambat. Saat tim rejoin/refresh di tengah pertandingan,
server mengirim ulang `remaining`/`remainingMs` yang sudah berjalan (bukan durasi
penuh), jadi timer tidak “mengulang”. Field `serverTime` (waktu mulai absolut)
tetap dikirim untuk kompatibilitas; client lama yang belum mengenal kedua field
itu tetap memakai hitungan lokalnya.

Server memakai jam yang sama untuk menjadwalkan akhir otomatis:
`startedAt + duration × 1000 + MATCH_GRACE_MS`. Artinya `remaining`/`remainingMs`
menyentuh 0 sekitar **1,2 detik sebelum `game_end`** — cukup untuk client
menampilkan layar sementara “WAKTU HABIS” dan mengirim `finish` skor akhir, lalu
`game_end` resmi menggantinya dengan pemenang + klasemen. Untuk durasi Tanpa Batas
(≥ 9000) tidak ada timer server; host memakai `end_game`.

Contoh `game_start`:

```json
{
  "type": "game_start",
  "materi": "living_room",
  "duration": 300,
  "serverTime": 1760000100000,
  "remaining": 297,
  "remainingMs": 296540,
  "round": 2
}
```

`materi` diteruskan apa adanya dari room. Client memakai tema tunggal: nilai yang
tidak ada di `QUESTION_BANK` (mis. `all` dari room lama) dinormalkan ke
`living_room` sebelum `startGame()` dijalankan.

`round` mulai dari 1 pada ronde pertama dan bertambah setiap `start_game`.

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

Contoh `game_end` (objek MatchResult lengkap):

```json
{
  "type": "game_end",
  "reason": "time",
  "endedAt": 1760000180000,
  "round": 2,
  "winner": {
    "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4, "rank": 1
  },
  "tied": false,
  "winners": [
    { "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4, "rank": 1 }
  ],
  "teams": [
    { "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4, "rank": 1 },
    { "id": "p2m7q", "name": "TIM B", "score": 700, "floor": 5, "streak": 0, "rank": 2 }
  ]
}
```

Bila posisi teratas seri, `winner` bernilai `null`, `tied: true`, dan `winners[]`
berisi semua tim yang berbagi posisi teratas (masing-masing `rank: 1`). Setelah
`game_end`, server mengirim `room_update` dengan `status: "lobby"`; room tidak
dihapus.

Contoh `rejoined_host`:

```json
{
  "type": "rejoined_host",
  "room": { "…": "roomPublic, status lobby atau playing" },
  "round": 2,
  "lastResult": { "…": "MatchResult ronde terakhir, atau null" }
}
```

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
    "materi": "living_room",
    "duration": 180,
    "status": "playing",
    "teams": [
      { "id": "x9k2a", "name": "TIM A", "score": 520, "floor": 4, "streak": 4 }
    ]
  },
  "startedAt": 1760000100000,
  "duration": 180,
  "remaining": 143,
  "remainingMs": 142600,
  "round": 2,
  "lastResult": null,
  "observers": 1
}
```

`observers` dihitung dari jumlah socket observer aktif di room itu. `remaining`
memakai jam server yang sama seperti `game_start` sehingga hitungan di tab admin
selaras dengan HUD para pemain; nilainya `null` saat room masih lobby. Snapshot
telemetri dikirim menyusul sebagai pesan `player_state` terpisah per tim.
`lastResult` berisi hasil ronde terakhir atau `null`; karena `start_game` mereset
`lastResult`, nilainya `null` selama pertandingan berjalan dan terisi lagi setelah
`game_end`.

Contoh `spectate_ok` saat room sudah selesai dan kembali ke lobby (admin membuka
Tonton Live setelah pertandingan):

```json
{
  "type": "spectate_ok",
  "code": "RQ7K2P",
  "room": {
    "code": "RQ7K2P",
    "materi": "living_room",
    "duration": 180,
    "status": "lobby",
    "teams": [
      { "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4 }
    ]
  },
  "startedAt": null,
  "duration": 180,
  "remaining": null,
  "remainingMs": null,
  "round": 2,
  "lastResult": {
    "reason": "time",
    "endedAt": 1760000180000,
    "round": 2,
    "winner": { "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4, "rank": 1 },
    "tied": false,
    "winners": [
      { "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4, "rank": 1 }
    ],
    "teams": [
      { "id": "x9k2a", "name": "TIM A", "score": 1300, "floor": 8, "streak": 4, "rank": 1 }
    ]
  },
  "observers": 1
}
```

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

Contoh `room_deleted`:

```json
{ "type": "room_deleted", "code": "RQ7K2P", "message": "Room dihapus oleh admin" }
```

Pesan ini dikirim tepat sebelum semua socket dilepas dari room. Client tim
menampilkan modal **ROOM DIHAPUS** lalu kembali ke menu; spectator keluar dari
room. Kode `RQ7K2P` tidak bisa dipakai lagi.

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
- `end_game` saat tidak ada pertandingan dibalas error
  `Tidak ada pertandingan yang berjalan`; `delete_room` dari non-host dibalas
  error `Hanya host yang bisa menghapus room`; `start_game` dari socket yang sudah
  terlepas dari room dibalas `Hanya host yang bisa start`.
- Timer akhir otomatis dibersihkan saat `end_game`, `delete_room`, cleanup TTL, dan
  shutdown server (`dispose`). Di Node timer di-`unref` agar tidak menahan proses.

---

## 10. Batasan desain

| Area | Kondisi saat ini | Implikasi |
|---|---|---|
| Persistence | Memori proses | Restart = data hilang |
| Skor | Client-authoritative | Rawan manipulasi |
| Pemenang | Dihitung server dari skor terakhir | Manipulasi skor client ikut menentukan pemenang |
| Hasil pertandingan | `room.lastResult`, hanya ronde terakhir | Restart = hasil hilang; riwayat multi-ronde tidak disimpan |
| Ronde | Satu room bisa dipakai banyak ronde | Skor direset tiap ronde; tidak ada podium lintas ronde |
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

Tombol **AKHIRI & UMUMKAN PEMENANG**, layar GAME OVER (pemain + spectator),
ronde berulang lewat `start_game`, dan **HAPUS ROOM** sudah tersedia. Jika sistem
dikembangkan lagi, urutan prioritas yang wajar:

1. **Riwayat hasil per ronde + podium lintas ronde**: saat ini `lastResult` hanya
   menyimpan ronde terakhir dan skor direset tiap ronde.
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

# 08 · Arsitektur & Protokol

Dokumen ini untuk developer yang perlu memahami atau mengubah sistem. Isinya:
peta file, model data, siklus room, dan protokol WebSocket.

---

## 1. Peta file dan tanggung jawab

| File | Tanggung jawab |
|---|---|
| `index.html` | Landing, modal join, redirect ke `game.html` |
| `game.html` | Bank soal, engine game solo, client mabar (VS) |
| `star_pou_sky_climber.html` | Versi solo tanpa blok VS |
| `star_pou_vs.html` | Duplikat lama `game.html` (identik saat ini) |
| `admin/index.html` | UI host: buat room, lobby, mulai, leaderboard |
| `vs-server/server.js` | HTTP health + WebSocket room server |
| `vs-server/ecosystem.config.cjs` | Konfigurasi PM2 |
| `nginx-vs-snippet.conf` | Contoh proxy WebSocket (lihat catatan path di deploy) |
| `deploy-vs.ps1` | Skrip deploy lama/legacy |
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
                                                └─ game_end
```

- Host dan tim memakai koneksi WebSocket yang sama.
- Server membedakan peran dari state socket (`_isHost`, `_teamId`, `_room`).
- Semua pesan berupa JSON teks.

---

## 3. Model data

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
  teams: Map<teamId, Team>
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
  ws: WebSocket | null
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
| Throttle skor | 400 ms | `game.html` |
| Reconnect VS | 2 detik | `game.html` |
| Delay benar / salah | 550 ms / 900 ms | `game.html` |
| Ambang tanpa batas | durasi ≥ 9000 | `game.html` |

---

## 4. Siklus hidup room

```
create_room
   │
   ▼
 lobby ──(join_room)──► lobby ──(start_game)──► playing
   │                                               │
   │                                               ├─ score_update → leaderboard
   │                                               ├─ finish → leaderboard
   │                                               └─ end_game → ended
   │
   └─ TTL 2 jam / restart server → dihapus
```

| Aksi | Syarat | Efek |
|---|---|---|
| `create_room` | Password benar | Room baru, host terikat |
| `join_room` | Room ada, status lobby, <10 tim, nama unik | Tim baru, broadcast `room_update` |
| `rejoin` | Room & teamId ada | Socket tim diganti, kirim `rejoined` |
| `start_game` | Socket host, minimal 1 tim | Status playing, broadcast `game_start` |
| `score_update` | Room playing, socket terikat tim | Simpan + broadcast `leaderboard` |
| `finish` | Room ada, socket terikat tim | Update final + broadcast `leaderboard` |
| `end_game` | Socket host | Status ended, broadcast `game_end` |
| Disconnect host | — | `hostWs = null`, room tetap hidup |
| Disconnect tim | — | `team.ws = null`, entry tetap, broadcast `room_update` |

Catatan:

- `start_game` **tidak mengecek status**; host bisa memicu ulang dan merestart
  permainan.
- `game_start` dikirim lewat `broadcast` (termasuk host) lalu dikirim sekali lagi
  khusus ke host, sehingga host menerima dua pesan.
- `finish` belum dipakai UI client.
- Room `ended` tetap berada di Map sampai TTL.

---

## 5. Endpoint

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

## 6. Protokol client → server

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
- Tidak ada UI untuk ini saat ini.

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

---

## 7. Protokol server → client

| Pesan | Field | Kapan |
|---|---|---|
| `room_created` | `code`, `room` | Setelah create sukses |
| `joined` | `code`, `teamId`, `room` | Setelah join sukses |
| `rejoined` | `room` | Setelah rejoin sukses |
| `room_update` | `room` | Tim join atau disconnect |
| `game_start` | `materi`, `duration`, `serverTime` | Host memulai |
| `leaderboard` | `teams[]` | Skor berubah / finish |
| `game_end` | — | Host mengakhiri |
| `error` | `message` | Validasi gagal |

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

---

## 8. Perilaku koneksi dan error

- JSON rusak diabaikan tanpa balasan.
- Tipe pesan tidak dikenal diabaikan.
- `broadcast()` melewati socket yang sudah tertutup dan socket yang dikecualikan.
- Error `send` ditelan (`try/catch`) agar satu socket bermasalah tidak
  menghentikan broadcast.
- Socket yang belum pernah join tidak memengaruhi room saat disconnect.
- Server tidak mengirim heartbeat; koneksi mati terdeteksi lewat event `close`
  dari `ws`.

---

## 9. Batasan desain

| Area | Kondisi saat ini | Implikasi |
|---|---|---|
| Persistence | Memori proses | Restart = data hilang |
| Skor | Client-authoritative | Rawan manipulasi |
| Auth host | Hanya `_isHost` di socket | Refresh = kehilangan host |
| Rejoin | Ada di protokol, tanpa UI | Refresh tim = keluar permanen |
| Soal | Hardcoded di HTML | Butuh deploy untuk ubah |
| Skala | Satu proses, satu instance | Tidak bisa horizontal scaling tanpa state sharing |
| Observability | Hanya `/health` + log | Tidak ada metrik/audit |
| Rate limit | Tidak ada | Rentan spam pesan |

---

## 10. Titik ekstensi yang masuk akal

Jika sistem dikembangkan, urutan prioritas yang wajar:

1. **Tombol end + podium** di admin, memakai `end_game` yang sudah ada.
2. **Rejoin UI** dengan menyimpan `{code, teamId}` di `localStorage` dan mengirim
   `rejoin` saat koneksi dibuka.
3. **Host reconnect** memakai token host, bukan hanya identitas socket.
4. **Soal dari server/API** agar guru bisa menambah soal tanpa deploy, sekaligus
   memungkinkan soal sama untuk semua tim.
5. **Validasi skor di server** (server menghitung poin dari jawaban, bukan
   menerima angka dari client).
6. **Penyimpanan hasil** ke database untuk rekap kelas.
7. **Rate limiting** dan autentikasi room.

Semua perubahan itu memerlukan penyesuaian client, server, dan dokumentasi ini.

---

## 11. Ringkasan keamanan

- Gunakan WSS/HTTPS.
- Ganti password default.
- Jangan membuka port 3001 langsung ke publik.
- Anggap kode room sebagai rahasia kelas, bukan kredensial kuat.
- Jangan memakai skor untuk penilaian formal tanpa pengawasan.
- Batasi akses panel admin di level jaringan bila perlu (VPN/IP allowlist).

Lanjut ke [09 · Troubleshooting & FAQ](09-troubleshooting-faq.md).

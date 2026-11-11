# 04 · Mabar Multiplayer (VS)

Mode mabar memungkinkan beberapa tim bermain bersamaan di perangkat masing-masing,
dengan kode room dari admin dan leaderboard live.

Aturan utama: **1 perangkat = 1 tim**, maksimal **10 tim** per room.

---

## 1. Peran

| Peran | Alat | Tugas |
|---|---|---|
| **Admin / host** | `/admin/` | Buat room, bagikan kode, mulai permainan, pantau skor, tonton semua tim live |
| **Tim** | `/game.html` atau link room | Join lobby, bermain, kirim skor |

Admin **tidak otomatis ikut bermain**. Admin yang ingin ikut bertanding harus
join sebagai tim dari tab/perangkat lain memakai nama tim. Menonton lewat
**🔴 Tonton Live** juga bukan bermain: halaman spectator tidak masuk daftar tim.

---

## 2. Alur lengkap

```
ADMIN                              TIM 1..10
  │                                  │
  ├─ buka /admin/                    │
  ├─ isi password + durasi (Living)  │
  ├─ Buat Room ──► kode 6 huruf      │
  ├─ bagikan kode/link ─────────────►│
  │                                  ├─ buka link
  │                                  ├─ isi nama tim
  │                                  ├─ join_room ──► lobby
  │◄──────── room_update ────────────┤
  ├─ lihat daftar tim                │
  ├─ MULAI MABAR ──► game_start ────►├─ mulai bermain (ronde 1)
  │                                  ├─ kirim skor tiap ±400 ms
  │◄──────── leaderboard ────────────┤
  ├─ pantau peringkat                ├─ timer habis → finish
  ├─ 🔴 Tonton Live ──► spectator    │   └─ WAKTU HABIS (menunggu hasil)
  │   ◄── player_state ±8 Hz ────────┤
  ├─ AKHIRI atau timer server        │
  │   ──► game_end + pemenang ──────►├─ pemenang + klasemen
  │◄──── room kembali LOBBY ──────────┤─ KEMBALI KE LOBI
  ├─ MAIN LAGI ──► game_start ronde 2┘  (kode & tim yang sama)
  └─ HAPUS ROOM ──► room_deleted ───► semua kembali ke menu
```

---

## 3. Cara tim join

### Opsi A — lewat landing page

1. Buka `/`.
2. Klik **👥 Gabung Room (Mabar)**.
3. Isi **kode 6 huruf** dan **nama tim**.
4. Klik **Gabung & Tunggu di Lobby**.
5. Browser diarahkan ke `game.html?code=...&team=...#join` dan otomatis join.

### Opsi B — lewat link dari admin

- Link hanya kode (`?code=ABC123#join`): dialog join terbuka, kode sudah terisi,
  tim tinggal mengetik nama.
- Link kode + nama (`?code=ABC123&team=NAMA#join`): dialog join terbuka dan
  otomatis join setelah ±0,5 detik.

### Opsi C — dari dalam game

1. Buka `/game.html`.
2. Klik **👥 GABUNG MABAR — Masuk Kode Room**.
3. Isi kode + nama, klik **Join Lobby**.

Setelah berhasil, tim masuk ke **waiting room** dan menunggu host memulai. Waiting
room ini dipakai berkali-kali: setelah satu ronde selesai, tim melihat hasil resmi
lalu menekan **KEMBALI KE LOBI** dan kembali ke waiting room yang sama. Label tombol
ghost menjadi **Keluar Lobby**, tetapi tombol itu belum benar-benar mengirim aksi
keluar; untuk keluar, muat ulang halaman lalu join dengan nama lain (atau tunggu
admin menekan **HAPUS ROOM**).

---

## 4. Aturan dan validasi

| Aturan | Detail |
|---|---|
| Kode room | 6 karakter, tidak membedakan huruf besar/kecil |
| Nama tim | Wajib, di-trim, maksimal 24 karakter |
| Keunikan nama | Case-insensitive; `Alpha` dan `alpha` dianggap sama |
| Kapasitas | Maksimal 10 tim per room |
| Waktu join | Hanya saat room berstatus **lobby** — termasuk di antara dua ronde |
| Kode salah | `Room tidak ditemukan` |
| Nama dobel | `Nama tim sudah dipakai` |
| Room penuh | `Room penuh (10 tim)` |
| Sudah mulai | `Room sudah mulai` |

Kode 6 karakter memakai alfabet 32 karakter tanpa `I`, `O`, `0`, `1` agar tidak
salah baca.

---

## 5. Di dalam permainan

- Semua tim memakai **materi dan durasi yang sama** dari room. Materi saat ini satu
  tema: **Talking about My Living Room** (50 soal).
- Setiap browser punya riwayat anti-ulang dan urutan soal sendiri, jadi urutan
  antar tim berbeda. Platform jawaban juga diacak kiri/kanan per soal.
- Progres, skor, streak, dan ketinggian dihitung **lokal di browser**.
- Browser mengirim `score_update` berisi `score`, `floor`, dan `streak` maksimal
  sekali per ±400 ms.
- Browser juga mengirim `player_state` (telemetri kamera) ±8×/detik. Server hanya
  meneruskannya ke observer admin di room itu, bukan ke tim lain.
- Server menyimpan nilai terakhir, mengurutkan, lalu menyiarkan `leaderboard` ke
  host dan semua tim.
- Pojok kanan atas game menampilkan kode room, jumlah tim, dan leaderboard.
- Timer di leaderboard dan status spectator dihitung dari `remainingMs` yang
  dikirim server (jam yang sama dengan HUD pemain), bukan dari jam masing-masing
  perangkat — jadi angkanya selaras.
- Setiap pertandingan adalah **satu ronde** bernomor (`round`). Saat host memulai
  ronde berikutnya di lobby yang sama, skor/floor/streak semua tim direset dan
  `round` bertambah; tim tidak perlu join ulang.

Perbedaan tampilan yang perlu diketahui:

- Di leaderboard VS, angka `floor` ditulis dengan akhiran `m`, padahal isinya
  jumlah tangga. Ketinggian sebenarnya = `floor × 100 m` (lihat HUD).
- Skor bersifat **client-authoritative**; server memercayai angka dari browser
  (hanya nilai negatif yang di-clamp ke 0).

---

## 6. Menonton tim secara live

Selama room aktif, panel admin punya tombol **🔴 Tonton Live**. Halaman spectator
menampilkan satu kamera 3D per tim, jadi kamu bisa melihat semua tim bergerak
sekaligus tanpa berpindah perangkat. Penonton tidak join sebagai tim dan tidak
mengirim skor.

Yang terlihat di layar spectator:

| Yang tampil | Sumber data |
|---|---|
| Top bar: status room (**LOBBY** / **BERMAIN mm:ss** / **SELESAI**), badge kode, tombol **FOKUS/GRID** dan **KELUAR** | `spectate_ok`, `room_update`, `game_start`, `game_end` |
| Kamera 3D tiap tim (bintang, awan, papan soal) | telemetri `player_state` dari browser tim, ±8×/detik |
| Header tiap pane: nama tim, skor, ketinggian (`floor × 100 m`), streak, status **LIVE** / **OFFLINE** | telemetri yang sama |
| Bar info bawah: teks soal, dua chip opsi kiri/kanan (✓/✗), chip kejadian **⬆ NAIK +N** / **💥 SALAH** | telemetri yang sama |
| Kartu **GAME OVER**: pemenang atau **SERI**, alasan, klasemen ber-`rank`, tombol **LIHAT KAMERA** / **KELUAR** | `game_end` dan `lastResult` pada `spectate_ok` |
| Grid, tab tim, fokus, dan zoom | kontrol halaman spectator; detail di [03 · Panel Admin §6](03-panel-admin.md) |

Saat ronde selesai, spectator otomatis menampilkan kartu **GAME OVER**. Tombol
**LIHAT KAMERA** menutup kartu dan kamera terakhir tetap tampil; **KELUAR**/`Esc`
keluar dari spectator. Bila admin baru membuka **Tonton Live** setelah pertandingan
usai, hasilnya tetap muncul karena `spectate_ok` membawa `round` + `lastResult`.
Ronde berikutnya (`game_start`) menghapus kartu dan mereset snapshot kamera.

Grid menyesuaikan jumlah tim: 2 tim = 2 kolom, 3–4 = 2×2, 5–6 = 3 kolom,
7–9 = 3×3, 10 = 4 kolom. Zoom tiap kamera 70%–240% dengan langkah 20%, reset ke
100% lewat tombol `R` atau klik angka persentase di header pane.

Alurnya:

```
TIM (browser) ──player_state ±8 Hz──► server ──relay──► tab spectator admin
                                        └─ snapshot terakhir (team.state)
```

Yang perlu diketahui saat memantau:

- Data telemetri **hanya** sampai ke observer ber-password admin di room itu.
  Tim lain tidak menerima posisi kamera tim lain, hanya leaderboard seperti biasa.
- Observer yang baru bergabung langsung dapat snapshot terakhir tiap tim.
- Tim putus atau telemetrinya berhenti > ±4 detik → pane berstatus **OFFLINE**
  dengan frame terakhir tetap terlihat. Kalau tim berhasil tersambung ulang
  (rejoin) dan telemetri masuk lagi, statusnya kembali **LIVE**.
- Spectator tidak memakan slot tim dan tidak mengganggu timer atau leaderboard.
- Gerakan di pane diinterpolasi dari 8 Hz, jadi halus tetapi bukan video.
- Tidak ada rekaman untuk diputar ulang. Kalau tab spectator ditutup, riwayat
  gerakan hilang.

Untuk performa: renderer software tanpa GPU, dan spectator merender beberapa
kamera sekaligus sehingga dibatasi sekitar **30 fps**. Kalau mulai tersendat,
kecilkan jendela, tutup tab lain, atau pakai mode fokus (tombol `F`).

---

## 7. Akhir permainan & pemenang

### 7.1 Jam pertandingan

- Timer mengikuti **jam server**: server mengirim `remaining` (detik) dan
  `remainingMs` (milidetik) pada `game_start` dan `spectate_ok`, lalu tiap
  browser memakai deadline lokal dan tick di batas detik. Jadi HUD pemain,
  timer leaderboard, dan status **BERMAIN mm:ss** di layar admin menunjuk detik
  yang sama (bukan hanya ±1 detik), termasuk bila pesan datang terlambat atau
  tim rejoin di tengah match.
- Saat timer lokal habis, client mengirim `finish` berisi skor akhir dan
  menampilkan layar sementara **WAKTU HABIS — menunggu hasil resmi dari server**.
  Server masih menerima `finish` selama masa tenggang sebelum menghitung pemenang.
- Durasi **Tanpa Batas** (≥ 9000 detik) tidak dihitung: HUD menampilkan ♾️ dan
  spectator menampilkan status `BERMAIN` tanpa hitungan. Pertandingan hanya
  berakhir lewat tombol host.

### 7.2 Akhir otomatis dan akhir manual

- Server mengakhiri pertandingan **otomatis** pada `duration × 1000 + 1200 ms`
  setelah `game_start`. Tambahan **1200 ms** adalah grace untuk menerima `finish`
  skor akhir dari pemain yang timer lokalnya baru saja habis.
- Untuk durasi **Tanpa Batas**, tidak ada akhir otomatis: host menekan
  **AKHIRI & UMUMKAN PEMENANG** di panel admin, yang mengirim `end_game`.
- `end_game` hanya diterima dari host (dari socket lain diabaikan) dan hanya saat
  status room `playing`. Bila host mengirimnya saat tidak ada pertandingan
  berjalan, server membalas `Tidak ada pertandingan yang berjalan`.

### 7.3 Pemenang resmi dan klasemen

Pemenang dihitung **server** dari skor terakhir, dengan urutan klasemen:

1. skor tertinggi,
2. bila skor sama — `floor` (jumlah tangga) lebih tinggi,
3. bila masih sama — nama tim (alfabetis).

`game_end` membawa `reason` (`"time"` atau `"host"`), `endedAt`, `round`,
`winner` (objek tim atau `null` bila seri), `tied`, `winners[]` (semua tim di
posisi teratas), dan `teams[]` terurut klasemen dengan field `rank` 1..n. Pesan
yang sama diterima tim, host, dan observer spectator.

Di browser tim, layar hasil menampilkan **pemenang** (atau **SERI**), alasan,
poin + ketinggian pemenang, dan klasemen akhir dengan medali. Tombol
**KEMBALI KE LOBI** mengembalikan tim ke waiting room.

### 7.4 Setelah hasil: lobby tetap hidup

- Room **tidak** menjadi `ended` dan **tidak** dihapus: setelah menyiarkan
  `game_end`, server mengembalikan status room ke **lobby**. Tim tetap terdaftar.
- Tim baru masih bisa join di antara ronde karena room kembali lobby.
- Host bisa menekan **🔁 MAIN LAGI** untuk ronde berikutnya. Saat `start_game`
  berikutnya, skor/floor/streak dan telemetri semua tim direset dan `round`
  bertambah; kode room tidak berubah.
- `lastResult` (hasil ronde terakhir) disimpan di room, jadi host yang
  `rejoin_host` atau admin yang membuka **Tonton Live** setelah match selesai tetap
  melihat pemenang dan klasemen.
- Room hanya hilang lewat **HAPUS ROOM**, TTL **2 jam**, atau restart server.

Praktik yang disarankan: biarkan server mengumumkan pemenang sendiri (timer atau
tombol AKHIRI), lalu gunakan **MAIN LAGI** untuk ronde berikutnya. Tidak perlu
membuat room baru atau menentukan pemenang manual dari leaderboard.

---

## 8. Ronde berulang & menghapus room

### 8.1 Satu lobby, banyak ronde

Setelah `game_end`, kode room yang sama masih berlaku. Alur singkatnya:

1. Ronde 1 berakhir (timer server atau tombol host) → semua tim melihat pemenang
   dan klasemen.
2. Tim menekan **KEMBALI KE LOBI**; host melihat banner hasil dan tombol
   **🔁 MAIN LAGI**.
3. Tim baru boleh join karena room kembali berstatus **lobby**.
4. Host menekan **MAIN LAGI** → `round` bertambah, skor/floor/streak/telemetri
   semua tim direset, lalu `game_start` baru dikirim.
5. Ronde 2 berjalan; hasil ronde 1 diganti hasil ronde 2.

Yang perlu diingat:

- Tim tidak perlu join ulang; identitas tim dan koneksinya tetap.
- Tim yang sempat disconnect di antara ronde tetap tercatat dan bisa rejoin
  lewat socket; refresh halaman tetap menghilangkan slot (lihat bagian 9).
- Riwayat skor per ronde tidak disimpan; `lastResult` hanya menyimpan hasil ronde
  terakhir sampai ronde berikutnya dimulai.

### 8.2 Menghapus room

Tombol **🗑 HAPUS ROOM** di panel admin (dengan dialog konfirmasi) mengirim
`delete_room`:

- server menghentikan timer pertandingan dan menghapus room dari memori,
- semua tim, host, dan observer menerima `room_deleted{code, message}`,
- browser tim menampilkan modal **ROOM DIHAPUS** lalu kembali ke menu; kode tidak
  bisa dipakai lagi (join berikutnya dibalas `Room tidak ditemukan`),
- panel admin menutup kartu Room Aktif dan kembali ke form **Buat Room Baru**.
- hanya host yang boleh menghapus; socket non-host yang masih terikat room dibalas
  error `Hanya host yang bisa menghapus room`.

Gunakan **HAPUS ROOM** saat sesi benar-benar selesai (mis. pergantian kelas).
Untuk ronde berikutnya di kelas yang sama, cukup **MAIN LAGI** — kode room dan
daftar tim tetap dipakai.

---

## 9. Disconnect, refresh, dan reconnect

Ini bagian paling penting untuk operator lapangan.

### Yang terjadi saat tim disconnect

- Entry tim **tidak dihapus** dari room; hanya koneksinya menjadi kosong.
- Host menerima `room_update` dan daftar tim tetap menampilkan tim tersebut.
- Skor terakhir dan snapshot telemetri terakhir tetap tersimpan di server sampai
  room dihapus.
- Observer spectator menerima `team_offline`; pane tim itu berubah **OFFLINE**
  tetapi frame terakhirnya tetap tampil.

### Reconnect otomatis (socket putus tanpa refresh)

Client VS mencoba menyambung ulang setiap **2 detik**. Selama halaman tidak
di-refresh, `code` dan `teamId` masih ada di memori, jadi begitu WebSocket terbuka
lagi client mengirim `rejoin{code, teamId}` dan server mengikat ulang socket itu
(membalas `rejoined`, plus `game_start` bila room sedang bermain). Skor, telemetri,
dan pane spectator pulih tanpa perlu join ulang. `game_start` yang dikirim ulang
membawa `remaining` yang sudah berjalan, sehingga timer tim tidak kembali penuh
dan tetap sama dengan admin. Host di `game.html` melakukan hal yang sama dengan
`rejoin_host`, termasuk memakai password admin yang diisi di form. Balasan
`rejoined` juga membawa `round` + `lastResult`, jadi bila socket putus tepat saat
ronde selesai, pemain tetap melihat pemenang meski `game_end` terlewat.

### Yang **tidak** terjadi

- Tidak ada rejoin setelah **refresh atau tab ditutup**: `teamId` hanya ada di
  memori halaman dan tidak disimpan di `localStorage`.
- Jika tim mencoba join lagi dengan nama yang sama, server menolak
  `Nama tim sudah dipakai` karena entry lama masih ada.

**Kesimpulan praktis: refresh/reload saat mabar = tim kehilangan tempat.**
Solusi cepat: gunakan nama baru (mis. `TIM A 2`) atau buat room baru. Memulihkan
slot lama hanya mungkin lewat console developer jika `teamId` masih diketahui
(kirim `{ type: 'rejoin', code, teamId }`).

### Yang terjadi saat admin disconnect

- Room tetap hidup, tetapi `hostWs` menjadi kosong.
- Socket host yang putus sebentar **pulih otomatis**: saat WebSocket tersambung
  ulang, panel admin mengirim `rejoin_host{code, adminPassword}` selama
  `roomCode` masih di memori tab. Password admin dipulihkan dari `sessionStorage`,
  tetapi kode room tidak.
- **Refresh/tutup tab admin** menghapus kode room dari memori, jadi kendali host
  (tombol mulai) hilang dan `rejoin_host` tidak terkirim otomatis.
- Room tetap bisa diakses tim yang sudah join; tidak ada tim baru setelah mulai.
  `rejoin_host` masih bisa dikirim manual dari console jika kode room diketahui.

**Praktik aman:** jangan refresh/tutup tab admin selama sesi; siapkan satu
perangkat khusus host.

### Reconnect socket game

Selama koneksi putus, permainan lokal tetap berjalan. Client terus mencoba
menyambung ulang tiap 2 detik; setelah tersambung, `rejoin` mengembalikan ikatan
tim sehingga update skor dan telemetri lanjut. Kalau server di-restart (room
hilang), rejoin tidak menemukan room dan host harus membuat room baru.

---

## 10. Tips operasional untuk kelas

- Tempel kode room di papan tulis; jangan hanya mengandalkan chat.
- Minta setiap tim menamai perangkatnya sesuai nama tim.
- Pastikan semua tim sudah muncul di panel admin **sebelum** menekan mulai.
- Tekan mulai **sekali per ronde**; jangan double-click.
- Setelah pemenang diumumkan, gunakan **🔁 MAIN LAGI** untuk ronde berikutnya —
  kode room dan daftar tim tetap sama.
- Tekan **🗑 HAPUS ROOM** hanya setelah sesi benar-benar selesai; kode tidak bisa
  dipakai lagi setelah itu.
- Siapkan link cadangan (kode saja) jika ada tim yang salah ketik nama.
- Buka **🔴 Tonton Live** di perangkat host setelah mabar mulai untuk melihat
  semua tim; jangan tutup tab admin selama sesi.
- Batasi 10 tim; jika lebih, buat dua room dengan jadwal bergilir.
- Gunakan Wi-Fi yang sama dan uji satu perangkat lebih dulu.

---

## 11. Batasan mode mabar

| Batasan | Dampak |
|---|---|
| Maksimal 10 tim | Tim ke-11 ditolak |
| Join hanya saat lobby | Tim terlambat harus menunggu ronde selesai; room kembali lobby di antara ronde |
| Rejoin hanya saat socket putus (tanpa refresh) | Refresh = kehilangan slot |
| Tanpa database | Restart server = room hilang |
| Pemenang resmi per ronde | Dihitung server dari skor terakhir; tidak ada podium/riwayat lintas ronde |
| HAPUS ROOM permanen | Kode room tidak bisa dipakai lagi |
| Skor dari client | Rawan manipulasi, termasuk memengaruhi pemenang |
| Telemetri spectator 8 Hz | Gerakan di pane diinterpolasi; bukan stream video |
| Spectator merender semua kamera | ±30 fps; beban CPU ada di tab admin |
| Satu proses server | Tidak ada scaling multi-instance |

Detail teknis pesan WebSocket ada di
[08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md).

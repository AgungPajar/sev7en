# 04 · Mabar Multiplayer (VS)

Mode mabar memungkinkan beberapa tim bermain bersamaan di perangkat masing-masing,
dengan kode room dari admin dan leaderboard live.

Aturan utama: **1 perangkat = 1 tim**, maksimal **10 tim** per room.

---

## 1. Peran

| Peran | Alat | Tugas |
|---|---|---|
| **Admin / host** | `/admin/` | Buat room, bagikan kode, mulai permainan, pantau skor |
| **Tim** | `/game.html` atau link room | Join lobby, bermain, kirim skor |

Admin **tidak otomatis ikut bermain**. Admin yang ingin ikut bertanding harus
join sebagai tim dari tab/perangkat lain memakai nama tim.

---

## 2. Alur lengkap

```
ADMIN                              TIM 1..10
  │                                  │
  ├─ buka /admin/                    │
  ├─ isi password + materi + durasi  │
  ├─ Buat Room ──► kode 6 huruf      │
  ├─ bagikan kode/link ─────────────►│
  │                                  ├─ buka link
  │                                  ├─ isi nama tim
  │                                  ├─ join_room ──► lobby
  │◄──────── room_update ────────────┤
  ├─ lihat daftar tim                │
  ├─ MULAI MABAR ──► game_start ────►├─ mulai bermain
  │                                  ├─ kirim skor tiap ±400 ms
  │◄──────── leaderboard ────────────┤
  ├─ pantau peringkat                ├─ timer habis → hasil lokal
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

Setelah berhasil, tim masuk ke **waiting room** dan tidak bisa kembali ke menu
selama sesi lobby masih aktif. Label tombol berubah menjadi **Keluar Lobby**,
tetapi saat ini tombol tersebut belum benar-benar mengirim aksi keluar; untuk
keluar, muat ulang halaman lalu join dengan nama lain.

---

## 4. Aturan dan validasi

| Aturan | Detail |
|---|---|
| Kode room | 6 karakter, tidak membedakan huruf besar/kecil |
| Nama tim | Wajib, di-trim, maksimal 24 karakter |
| Keunikan nama | Case-insensitive; `Alpha` dan `alpha` dianggap sama |
| Kapasitas | Maksimal 10 tim per room |
| Waktu join | Hanya saat room berstatus **lobby** |
| Kode salah | `Room tidak ditemukan` |
| Nama dobel | `Nama tim sudah dipakai` |
| Room penuh | `Room penuh (10 tim)` |
| Sudah mulai | `Room sudah mulai` |

Kode 6 karakter memakai alfabet 32 karakter tanpa `I`, `O`, `0`, `1` agar tidak
salah baca.

---

## 5. Di dalam permainan

- Semua tim memakai **materi dan durasi yang sama** dari room.
- Setiap browser tetap mengacak **urutan soal sendiri**, jadi tiap tim mendapat
  urutan berbeda. Platform jawaban juga diacak kiri/kanan per soal.
- Progres, skor, streak, dan ketinggian dihitung **lokal di browser**.
- Browser mengirim `score_update` berisi `score`, `floor`, dan `streak` maksimal
  sekali per ±400 ms.
- Server menyimpan nilai terakhir, mengurutkan, lalu menyiarkan `leaderboard` ke
  host dan semua tim.
- Pojok kanan atas game menampilkan kode room, jumlah tim, dan leaderboard.
- Timer di leaderboard mengikuti timer lokal tim yang sedang bermain.

Perbedaan tampilan yang perlu diketahui:

- Di leaderboard VS, angka `floor` ditulis dengan akhiran `m`, padahal isinya
  jumlah tangga. Ketinggian sebenarnya = `floor × 100 m` (lihat HUD).
- Skor bersifat **client-authoritative**; server memercayai angka dari browser
  (hanya nilai negatif yang di-clamp ke 0).

---

## 6. Akhir permainan

- Timer berjalan lokal di tiap browser. Saat habis, tim melihat modal hasilnya
  sendiri (poin, meter, jumlah tangga).
- Server **tidak** mengakhiri room otomatis dan tidak menghitung pemenang global.
- Leaderboard berhenti bergerak setelah tim berhenti mengirim skor.
- Room tetap ada sampai TTL **2 jam** atau server restart.
- `game_end` didukung protokol, tetapi belum ada tombol “akhiri” di panel admin.

Praktik yang disarankan: tetapkan pemenang secara manual dari leaderboard terakhir
sebelum timer habis, atau minta semua tim berhenti di waktu yang sama.

---

## 7. Disconnect, refresh, dan reconnect

Ini bagian paling penting untuk operator lapangan.

### Yang terjadi saat tim disconnect

- Entry tim **tidak dihapus** dari room; hanya koneksinya menjadi kosong.
- Host menerima `room_update` dan daftar tim tetap menampilkan tim tersebut.
- Skor terakhir tetap tersimpan di server sampai room dihapus.

### Yang **tidak** terjadi

- Tidak ada rejoin otomatis dari UI.
- Refresh halaman menghilangkan `teamId` di memori browser.
- Jika tim mencoba join lagi dengan nama yang sama, server menolak
  `Nama tim sudah dipakai` karena entry lama masih ada.

**Kesimpulan praktis: refresh/reload saat mabar = tim kehilangan tempat.**
Solusi cepat: gunakan nama baru (mis. `TIM A 2`) atau buat room baru.

Server sebenarnya mendukung pesan `rejoin` (`{ type: 'rejoin', code, teamId }`),
tetapi tombol/UI-nya belum ada dan `teamId` tidak disimpan di localStorage.
Pemulihan hanya mungkin lewat console developer jika `teamId` masih diketahui.

### Yang terjadi saat admin disconnect

- Room tetap hidup, tetapi `hostWs` menjadi kosong.
- Tidak ada mekanisme re-attach host.
- Tab admin yang di-refresh **kehilangan kendali** untuk memulai ulang room
  tersebut.
- Room tetap bisa diakses tim yang sudah join; tidak ada tim baru setelah mulai.

**Praktik aman:** jangan refresh/tutup tab admin selama sesi; siapkan satu
perangkat khusus host.

### Reconnect socket game

Client VS mencoba menyambung ulang setiap 2 detik jika koneksi putus saat sedang
bermain. Namun socket baru tidak otomatis dikaitkan ke tim (tidak mengirim
`rejoin`), sehingga update skor setelah reconnect akan diabaikan server. Permainan
lokal tetap berjalan, tetapi leaderboard bisa berhenti memperbarui tim tersebut.

---

## 8. Tips operasional untuk kelas

- Tempel kode room di papan tulis; jangan hanya mengandalkan chat.
- Minta setiap tim menamai perangkatnya sesuai nama tim.
- Pastikan semua tim sudah muncul di panel admin **sebelum** menekan mulai.
- Tekan mulai **sekali**; jangan double-click.
- Siapkan link cadangan (kode saja) jika ada tim yang salah ketik nama.
- Batasi 10 tim; jika lebih, buat dua room dengan jadwal bergilir.
- Gunakan Wi-Fi yang sama dan uji satu perangkat lebih dulu.

---

## 9. Batasan mode mabar

| Batasan | Dampak |
|---|---|
| Maksimal 10 tim | Tim ke-11 ditolak |
| Join hanya saat lobby | Tim terlambat tidak bisa masuk |
| Tanpa rejoin UI | Refresh = kehilangan slot |
| Tanpa database | Restart server = room hilang |
| Tanpa podium global | Pemenang ditentukan manual |
| Skor dari client | Rawan manipulasi |
| Satu proses server | Tidak ada scaling multi-instance |

Detail teknis pesan WebSocket ada di
[08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md).

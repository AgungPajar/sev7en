# 03 · Panel Admin

Panel admin dipakai untuk membuat room mabar, membagikan kode, memulai permainan,
dan memantau leaderboard live.

URL: **`/admin/`** (dari landing: kartu **🛡️ Panel Admin**).

---

## 1. Sebelum mulai

Yang harus siap:

1. `vs-server` sudah berjalan dan bisa diakses browser.
2. Password admin diketahui (default `sev7en-admin`).
3. Materi dan durasi sudah dipilih sesuai rencana pembelajaran.
4. Link game (`/game.html`) bisa dibuka dari perangkat tim.

> **Penting soal password:** panel admin tidak punya halaman login. Halaman bisa
> dibuka siapa saja, tetapi tombol **Buat Room** akan ditolak server jika password
> salah. Password yang dicek adalah environment `ADMIN_PASSWORD` di
> `vs-server`, **bukan** tulisan “admin” yang muncul sebagai petunjuk di sidebar.
>
> Default sebenarnya: **`sev7en-admin`**. Segera ganti untuk pemakaian nyata
> (lihat [07 · Deploy VPS](07-deploy-vps.md)).

---

## 2. Membuat room

Pada kartu **Buat Room Baru**:

| Field | Pilihan | Catatan |
|---|---|---|
| Materi | Semua Materi, There is/are & Ruangan, Food & Kitchen, Present Continuous + Hobby, Routine + Transport | Dikirim ke semua tim |
| Durasi | 3 Menit, 5 Menit, 10 Menit, Tanpa Batas | Dikirim ke semua tim; baca catatan timer di [06 · Mekanik & Skor](06-mekanik-dan-skor.md) |
| Password Admin | Input password | Wajib diisi |

Klik **✨ Buat Room + Dapatkan Kode**.

Jika berhasil:

- Muncul kartu **Room Aktif** dengan **kode 6 huruf** (contoh `RQ7K2P`).
- Kode memakai alfabet tanpa karakter ambigu: `I`, `O`, `0`, `1` tidak dipakai.
- Status room: **Lobby**.
- Tombol **Salin Kode** dan **Salin Link** tersedia.

Jika gagal, pesan error muncul di bawah tombol, misalnya
`Password admin salah` atau `Error koneksi WS`.

### Link yang dibagikan

- **Salin Kode** → hanya kode, mis. `RQ7K2P`.
- **Salin Link** → `https://domain/game.html?code=RQ7K2P#join`.

Tim yang membuka link hanya-kode akan melihat dialog join dengan kode terisi dan
harus mengetik nama tim. Jika Anda ingin tim langsung masuk lobby, tambahkan
parameter `team`, mis.:

```
https://domain/game.html?code=RQ7K2P&team=KELOMPOK%20BINTANG%202#join
```

---

## 3. Menunggu tim join

Di kartu **Room Aktif**:

- Bagian **Tim yang Sudah Join (n/10)** menampilkan daftar tim dan skornya.
- Daftar diperbarui otomatis setiap ada tim join atau koneksinya terputus.
- Maksimal **10 tim** per room.
- Nama tim unik tanpa membedakan huruf besar/kecil, maksimal 24 karakter.

Aturan join yang ditegakkan server:

| Kondisi | Hasil |
|---|---|
| Kode tidak ada | `Room tidak ditemukan` |
| Nama/kode kosong | `Kode & nama tim wajib` |
| Room sudah dimulai | `Room sudah mulai` |
| Sudah 10 tim | `Room penuh (10 tim)` |
| Nama sama (case-insensitive) | `Nama tim sudah dipakai` |

Selama masih **Lobby**, tim bisa join. Tidak ada aksi “keluar room” resmi: tim
yang menutup tab tetap tercatat (koneksinya kosong), dan namanya tetap dianggap
terpakai. Setelah host menekan mulai, tidak ada tim baru yang bisa join.

---

## 4. Memulai permainan

1. Pastikan minimal **1 tim** sudah join.
2. Klik **▶ MULAI MABAR**.
3. Server mengubah status menjadi **Sedang bermain** dan mengirim sinyal mulai ke
   semua tim + host.
4. Semua browser tim mulai bermain hampir bersamaan, dengan materi dan durasi
   sesuai room.

Hal yang perlu dijaga:

- **Tekan mulai sekali saja.** Server tidak menolak `start_game` kedua; menekan
  lagi akan mengulang permainan dari awal untuk semua tim.
- Jika belum ada tim, server menolak dengan `Belum ada tim join`.
- Hanya socket host yang boleh memulai. Kalau tab admin di-refresh, koneksi host
  hilang dan tombol mulai tidak lagi dianggap host.

---

## 5. Memantau leaderboard

Setelah permainan berjalan:

- Panel **Leaderboard Live** muncul di kolom kanan, di samping daftar tim.
- Data diurutkan dari skor tertinggi.
- Tiga teratas mendapat indikator 🥇🥈🥉.
- Update dikirim dari browser masing-masing tim (throttle ±400 ms), jadi hampir
  real-time tetapi tidak frame-perfect.
- Angka `floor` dari server ditampilkan sebagai “m” di leaderboard dalam game;
  nilainya sebenarnya **jumlah tangga**, bukan meter. Lihat catatan di
  [06 · Mekanik & Skor](06-mekanik-dan-skor.md).

Status room yang mungkin terlihat:

| Badge | Arti |
|---|---|
| **Lobby** | Room dibuat, menunggu tim |
| **▶ Sedang bermain** | `start_game` sudah dikirim |
| **■ Selesai** | Hanya jika server menerima `end_game` (tidak ada tombolnya di UI) |

---

## 6. Mengakhiri permainan

Saat ini panel admin **tidak punya tombol “Akhiri permainan”**. Yang terjadi:

- Setiap tim berhenti sendiri saat timer lokalnya habis dan melihat hasilnya
  masing-masing.
- Server tetap menganggap room `playing`; leaderboard berhenti diperbarui karena
  tim tidak lagi mengirim skor.
- Room otomatis dihapus setelah **2 jam** sejak dibuat, atau saat server restart.
- Pesan `game_end` didukung server, tetapi belum ada tombol di UI admin.

Jika perlu menutup sesi lebih cepat: buat room baru untuk sesi berikutnya, atau
restart `vs-server` (semua room hilang). Jangan menutup tab admin jika masih ingin
memulai ulang room yang sama.

---

## 7. Checklist sebelum kelas

- [ ] `vs-server` hidup dan `/health` merespons.
- [ ] Password admin sudah diganti dari default.
- [ ] Materi & durasi sudah dipilih.
- [ ] Room dibuat dan kode/link sudah dibagikan.
- [ ] Semua tim sudah muncul di daftar join (maks. 10).
- [ ] Nama tim tidak ada yang dobel.
- [ ] Perangkat tim memakai browser modern dan terhubung internet/intranet.
- [ ] Tab admin dibiarkan terbuka selama sesi.
- [ ] Tombol mulai ditekan **sekali** setelah semua tim siap.

---

## 8. Keamanan dan batasan

- Password dikirim lewat WebSocket. Gunakan **HTTPS/WSS** di production agar tidak
  terlihat di jaringan.
- Tidak ada sesi login, rate limit, atau audit log.
- Skor berasal dari browser tim dan hanya di-clamp agar tidak negatif; tim teknis
  bisa memanipulasi skor.
- Siapa pun yang tahu kode room bisa join selama lobby.
- Room disimpan di memori satu proses; tidak ada sinkronisasi antar-instance.

Untuk detail alur tim, lanjut ke [04 · Mabar Multiplayer](04-mabar-multiplayer.md).

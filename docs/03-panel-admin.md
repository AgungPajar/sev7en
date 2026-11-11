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

## 6. Menonton langsung (🔴 Tonton Live)

Setelah room dibuat, kamu bisa menonton semua tim tanpa ikut bermain. Halaman
spectator menampilkan satu kamera per tim berisi render 3D yang sama dengan yang
dilihat pemain (bintang, awan, papan soal), lengkap dengan skor dan status tiap
tim.

### 6.1 Membuka spectator

1. Buat room seperti di bagian 2. Tombol **🔴 Tonton Live** muncul di kartu
   **Room Aktif** setelah room berhasil dibuat.
2. Klik tombol itu. Panel admin memasang **overlay berisi iframe** halaman
   spectator. Overlay punya tombol **Reload**, **Buka Tab Baru**, dan **Tutup**.
3. Tutup overlay dengan **Esc** di dalam spectator (halaman mengirim
   `postMessage`, overlay menutup) atau tombol **Tutup**. **Esc** di panel admin
   juga menutup overlay. Menutup overlay memutus koneksi observer di iframe.

URL halaman spectator:

```
/game.html?code=RQ7K2P&spectate=1
```

- `code` = kode room yang sedang aktif.
- `spectate=1` menandai halaman sebagai penonton: tidak ada menu dan tidak ada
  dialog join.
- Butuh **password admin**. Panel admin menyimpan password yang kamu isi tadi di
  `sessionStorage` dengan key `sev7en-admin-pass`; spectator memakainya otomatis.
- Kalau key itu tidak ada (tab baru, sessionStorage dibersihkan, browser ditutup),
  spectator meminta password lewat prompt. Password salah → pesan error dan kamera
  tidak ditampilkan.

Penonton **bukan tim**: tidak join ke daftar tim, tidak mengirim skor, dan tidak
memengaruhi timer atau leaderboard. Kuota 10 tim tetap untuk tim sungguhan.

### 6.2 Tampilan layar dan grid kamera

Layar spectator terdiri dari empat bagian:

| Bagian | Isi |
|---|---|
| **Top bar** | titik **LIVE** merah berdenyut, badge **KODE** room, status room (**LOBBY** / **BERMAIN mm:ss** / **SELESAI**), tombol **⛶ FOKUS** / **▦ GRID**, tombol **✕ KELUAR** |
| **Strip tab tim** | satu tab per tim berisi nama, skor, dan ketinggian singkat; titik hijau/merah menandai online/offline |
| **Grid pane kamera** | satu pane per tim, disusun otomatis mengikuti jumlah tim |
| **Bar info bawah** | detail tim terpilih: nama, skor, ketinggian (`floor × 100 m`), streak, zoom, status **LIVE** / **OFFLINE**, teks soal, dua chip opsi kiri/kanan (**✓** untuk yang benar, **✗** yang salah), serta chip kejadian **⬆ NAIK +N** atau **💥 SALAH** yang muncul sebentar |

Tiap pane kamera berisi:

- render 3D dari sudut pandang tim itu (bintang, awan, papan soal kiri/kanan),
- header pane: nama tim, skor, ketinggian, streak, dan status online/offline,
- tombol zoom **− / persentase / +** di kanan header; angka persentase sekaligus
  tombol reset zoom ke 100%.

Jumlah pane mengikuti jumlah tim, dan grid menyesuaikan otomatis:

| Jumlah tim | Tata letak |
|---|---|
| 1 | Satu pane penuh |
| 2 | 2 kolom |
| 3–4 | Grid 2×2 |
| 5–6 | 3 kolom (2 baris) |
| 7–9 | Grid 3×3 |
| 10 | 4 kolom × 3 baris |

Klik tab tim atau klik salah satu pane untuk memilih tim. Tim yang dipilih diberi
border kuning dan jadi sasaran tombol zoom.

### 6.3 Mode fokus, zoom, dan keluar

| Kontrol | Fungsi |
|---|---|
| **F** | Mode fokus: satu kamera besar untuk tim terpilih |
| **G** | Mode grid: semua kamera tampil lagi |
| tombol **− / +** di header pane | Zoom kamera tim itu, langkah 20%, rentang 70%–240% |
| klik angka persentase di header pane | Reset zoom tim itu ke 100% |
| scroll mouse di atas pane | Zoom kamera tim itu, langkah 10% |
| **+ / −** saat sebuah tim dipilih | Zoom tim terpilih |
| **R** | Reset zoom tim terpilih ke 100% |
| **Esc** | Keluar; overlay di panel admin ikut tertutup |

Zoom disimpan **per tim**: memperbesar kamera tim A tidak mengubah zoom tim B.
Zoom awal selalu 100%, dan mode fokus mempertahankan zoom tim yang sedang
difokuskan.

### 6.4 Kontrol keyboard

| Tombol | Aksi |
|---|---|
| `1`–`9` | Pilih tim 1–9 sekaligus masuk mode fokus |
| `0` | Pilih tim ke-10 (hanya bila room berisi 10 tim) dan masuk mode fokus |
| `F` | Toggle mode fokus |
| `G` | Kembali ke grid |
| `+` / `-` | Zoom tim terpilih |
| `R` | Reset zoom tim terpilih |
| `Esc` | Keluar dari spectator |

Tab tim di layar juga bisa diklik; klik tab sama dengan memilih tim lalu
memfokuskannya.

### 6.5 Data yang dikirim tim

Spectator tidak menarik video. Tiap browser tim mengirim **telemetri** sekitar
**8×/detik** (≈125 ms) berisi posisi kamera, posisi bintang, status lompat/jatuh,
papan soal kiri/kanan, riwayat tangga, serta skor/streak/floor. Server menyimpan
snapshot terakhir tiap tim dan meneruskannya **hanya ke observer ber-password
admin** di room itu; tim lain tidak menerima data ini.

Yang perlu kamu tahu:

- Telemetri mulai mengalir setelah host menekan **MULAI MABAR** dan berhenti saat
  permainan selesai. Sebelum data pertama masuk, pane menampilkan status
  “menunggu”.
- Observer yang baru bergabung langsung menerima snapshot terakhir, lalu update
  berikutnya. Tidak ada riwayat gerakan sebelumnya.
- Pane ditandai **OFFLINE** kalau socket tim putus **atau** tidak ada telemetri
  masuk selama ±4 detik. Data terakhir tetap tampil; status kembali **LIVE**
  begitu telemetri masuk lagi (setelah tim rejoin).
- Gerakan di pane diinterpolasi dari 8 Hz, jadi terlihat halus tetapi bukan
  rekaman video. Lompatan posisi kecil masih mungkin terlihat.

### 6.6 Batasan performa

Renderer 3D berjalan di CPU tanpa GPU, dan halaman spectator merender beberapa
kamera sekaligus. Supaya laptop sekolah tetap aman, render halaman spectator
dibatasi **±30 fps**, bukan 60 fps seperti halaman pemain.

- Pane lebih banyak = beban CPU lebih besar. Kalau tersendat, kecilkan jendela
  atau tutup tab lain.
- Ini **bukan rekaman**. Kalau tab admin/spectator ditutup, tidak ada playback,
  tidak ada file hasil, dan riwayat posisi hilang.
- Zoom dan mode fokus mengubah tampilan kamera di browser admin, bukan data yang
  dikirim tim.

### 6.7 Troubleshooting spectator

| Gejala | Penyebab | Solusi |
|---|---|---|
| Pane kosong / “menunggu” | Tim belum mulai bermain atau telemetri belum masuk | Tekan **MULAI MABAR**; tunggu tim menjawab soal pertama |
| Pane berstatus **OFFLINE** | Socket tim putus atau tidak ada telemetri > ±4 detik | Cek Wi-Fi perangkat tim; data terakhir tetap tampil; status kembali LIVE setelah tim rejoin |
| Spectator minta password / `Password admin salah` | `sev7en-admin-pass` tidak ada atau beda dengan `ADMIN_PASSWORD` | Isi password yang sama dengan saat **Buat Room**; buka spectator dari tombol **Tonton Live** agar sessionStorage terisi |
| Overlay tidak muncul / halaman kosong | Halaman dibuka lewat `file://` atau server statis tanpa WS | Buka lewat server Bun/Docker; pastikan `/ws` atau `/vs-ws` bisa diakses |
| Pane diam walau tim bermain | Server WS mati atau terblokir | Cek `/health` dan console browser (F12) |
| Gerakan patah-patah | Telemetri 8 Hz | Normal; ini bukan stream video |
| FPS rendah | Terlalu banyak pane / jendela besar | Kecilkan jendela, pakai mode fokus, tutup tab lain |

---

## 7. Mengakhiri permainan

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

## 8. Checklist sebelum kelas

- [ ] `vs-server` hidup dan `/health` merespons.
- [ ] Password admin sudah diganti dari default.
- [ ] Materi & durasi sudah dipilih.
- [ ] Room dibuat dan kode/link sudah dibagikan.
- [ ] Semua tim sudah muncul di daftar join (maks. 10).
- [ ] Nama tim tidak ada yang dobel.
- [ ] Perangkat tim memakai browser modern dan terhubung internet/intranet.
- [ ] Tab admin dibiarkan terbuka selama sesi.
- [ ] Tombol mulai ditekan **sekali** setelah semua tim siap.
- [ ] Tombol **🔴 Tonton Live** sudah dicoba dan kamera tiap tim muncul.
- [ ] Password admin untuk spectator sama dengan password saat membuat room.
- [ ] Server WS (`/ws` atau `/vs-ws`) bisa diakses dari perangkat admin.
- [ ] Spectator dibuka lewat server, bukan `file://`.

---

## 9. Keamanan dan batasan

- Password dikirim lewat WebSocket. Gunakan **HTTPS/WSS** di production agar tidak
  terlihat di jaringan.
- Tidak ada sesi login, rate limit, atau audit log.
- Skor berasal dari browser tim dan hanya di-clamp agar tidak negatif; tim teknis
  bisa memanipulasi skor.
- Siapa pun yang tahu kode room bisa join selama lobby.
- Room disimpan di memori satu proses; tidak ada sinkronisasi antar-instance.
- Telemetri `player_state` hanya dikirim ke observer yang lolos password admin di
  room itu; tim biasa tidak menerima posisi kamera tim lain. Observer bisa melihat
  layar semua tim, jadi perlakukan tab spectator seperti tab admin.

Untuk detail alur tim, lanjut ke [04 · Mabar Multiplayer](04-mabar-multiplayer.md).

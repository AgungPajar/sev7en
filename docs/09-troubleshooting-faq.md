# 09 · Troubleshooting & FAQ

Panduan praktis saat ada masalah. Mulai dari bagian diagnosa cepat, lalu cocokkan
pesan error atau gejalanya.

---

## 1. Diagnosa cepat (urutan)

1. **File statis terbuka?**
   Buka `/`, `/game.html`, `/admin/`. Jika 404, masalah di web server / path.
2. **Server mabar hidup?**
   Di server: `curl http://127.0.0.1:3001/health` → harus `{"ok":true,...}`.
3. **WebSocket tersambung?**
   DevTools → Network → filter **WS** → status harus `101 Switching Protocols`.
   Jika `400`/`502`/pending, masalah path atau proxy.
4. **Password benar?**
   Coba buat room. `Password admin salah` berarti `ADMIN_PASSWORD` server berbeda.
5. **Room & tim valid?**
   Cek kode 6 karakter, status lobby, nama unik, dan jumlah tim < 10.

Halaman admin menampilkan indikator:

- Hijau: `✓ Terhubung ke server realtime`
- Merah: `✗ Terputus. Coba refresh.` atau `✗ Error koneksi WS.`

---

## 2. Pesan error server

| Pesan | Arti | Solusi |
|---|---|---|
| `Password admin salah` | `adminPassword` ≠ `ADMIN_PASSWORD` | Isi password yang benar; cek env/PM2; case-sensitive |
| `Kode & nama tim wajib` | Salah satu field kosong | Isi kode dan nama |
| `Room tidak ditemukan` | Kode salah, room sudah dihapus, atau server restart | Minta kode baru; cek `/health`; buat room baru |
| `Room sudah mulai` | Join setelah host menekan mulai | Tunggu ronde selesai (room kembali lobby) atau minta host **MAIN LAGI**; sementara itu main solo |
| `Room penuh (10 tim)` | Sudah 10 tim | Buat room kedua / giliran |
| `Nama tim sudah dipakai` | Nama sama (case-insensitive), termasuk entry tim yang disconnect | Pakai nama lain atau room baru |
| `Hanya host yang bisa start` | Socket bukan host, atau sudah terlepas dari room (mis. admin refresh / room sudah dihapus) | Buat room baru dari tab admin yang aktif, atau pulihkan host dengan `rejoin_host` |
| `Pertandingan sedang berjalan` | `start_game` dikirim saat room `playing` (mis. klik ganda) | Ronde yang sedang berjalan tidak direset; tunggu selesai atau tekan AKHIRI dulu |
| `Hanya host yang bisa menghapus room` | `delete_room` dikirim socket yang bukan host | Hapus room hanya dari tab admin host yang masih terikat room |
| `Tidak ada pertandingan yang berjalan` | `end_game` dikirim saat room tidak `playing` (mis. klik AKHIRI dua kali) | Tombol AKHIRI hanya muncul saat bermain; tunggu ronde berjalan dulu |
| `Belum ada tim join` | Start tanpa tim | Tunggu minimal 1 tim join |

Catatan: setelah password salah, socket tetap terbuka; Anda bisa memperbaiki
password dan mencoba lagi tanpa refresh.

---

## 3. Pesan error di client

| Pesan | Lokasi | Penyebab |
|---|---|---|
| `Kode & nama tim wajib` | Dialog join | Field kosong |
| `Kode harus 6 huruf` | Dialog join / landing | Panjang kode ≠ 6 |
| `Gagal konek — coba lagi` | Dialog join | `send()` gagal / socket belum siap |
| `Error koneksi WS.` | Panel admin | WebSocket gagal dibuka |
| `Terputus. Coba refresh.` | Panel admin | Socket tertutup |
| `Isi password admin` | Panel admin | Password kosong |
| `ROOM DIHAPUS` | Modal game (VS) | Host menekan **HAPUS ROOM**; kode tidak bisa dipakai lagi |
| `WAKTU HABIS — menunggu hasil resmi` | Layar hasil game (VS) | Timer lokal habis; `finish` terkirim, tunggu `game_end` dari server |
| `GAME OVER · RONDE n` | Spektator admin | Ronde selesai; kartu pemenang + klasemen tampil |
| `Loading question...` tidak berubah | Game | Pool soal kosong / error JS |

Tombol **Join Lobby** otomatis aktif kembali setelah 4 detik jika tidak ada
balasan, supaya bisa dicoba ulang.

---

## 4. Gejala umum dan solusinya

### Admin tidak bisa membuat room

- Pastikan `vs-server` berjalan.
- Buka DevTools console; cari error WebSocket.
- Pastikan halaman memakai URL yang benar:
  - lokal: `ws://localhost:3001/ws`
  - production: `wss://domain/vs-ws`
- Jika production, cek pemetaan Nginx `/vs-ws` → `/ws`
  (lihat [07 · Deploy VPS](07-deploy-vps.md)).

### Klik “Buat Room” berkali-kali

Setiap klik mengirim `create_room` baru. Room lama akan menjadi yatim (tanpa host
aktif). Cukup klik sekali; kalau ragu, refresh dan buat satu room baru.

### Tim tidak muncul di daftar admin

- Cek pesan error di dialog join tim.
- Pastikan kode sama persis (6 karakter).
- Pastikan room belum dimulai.
- Daftar hanya berubah saat server mengirim `room_update` (saat join atau
  disconnect). Tidak ada tombol refresh daftar; jika host kehilangan update,
  buat room baru.

### Leaderboard tidak muncul / tidak bergerak

- Leaderboard baru muncul setelah permainan dimulai dan ada `score_update`.
- Jika tim disconnect, update-nya berhenti.
- Jika admin refresh, host kehilangan kendali; leaderboard yang sudah tampil
  mungkin tetap, tetapi start ulang tidak bisa.
- Pastikan tab tim tetap aktif (lihat bagian background tab).

### Game berhenti di “Loading question...”

Bank soal sekarang **satu tema** (`living_room`), jadi pool kosong tidak lagi
disebabkan salah memilih topik di menu. Kalau soal tidak muncul:

1. Buka Console browser; cari `SyntaxError` atau error saat membaca `QUESTION_BANK`.
2. Pastikan `QUESTION_BANK` tidak kosong dan tiap soal punya `topic`, `emoji`,
   `q`, `correct`, dan `wrong`.
3. Pastikan `id` soal unik. `id` duplikat tidak membuat game crash, tetapi riwayat
   anti-ulang kedua soal bertabrakan.
4. Kalau baru menambah tema, pastikan kode `topic`-nya ada di bank **dan** opsi
   menu terdaftar; nilai `materi` yang tidak ada di bank dinormalkan ke
   `living_room`.

### Halaman blank setelah edit soal

Hampir pasti **SyntaxError**:

- Koma antar objek hilang.
- Apostrof tidak di-escape (`I don't` → `I don\'t`).
- Kurung `];` terhapus.

Buka DevTools → Console untuk melihat nomor baris, lalu perbaiki.

### Timer terasa melambat / berhenti saat pindah tab

Browser membatasi timer di tab background. Di **solo**, HUD bisa melambat karena
hitungan berjalan di browser. Di **mabar**, HUD memakai deadline dari
`remaining`/`remainingMs` server: tick yang tertunda akan menyusul saat tab aktif
lagi, dan server tetap mengakhiri pertandingan pada waktunya, jadi pemenang resmi
tetap keluar. Supaya adil:

- Minta semua tim tetap di tab game (jangan minimize / pindah tab).
- Gunakan mode tanpa batas untuk latihan santai.
- Hindari multitasking berat di perangkat tim.
- Jangan menentukan pemenang dari HUD; hasil resmi datang dari `game_end` server.

### Opsi “10 Menit” tidak menghitung mundur

Diketahui pada **menu solo**: `duration-select` tidak punya opsi `600`, sehingga
nilai select menjadi kosong dan timer lokal tidak berjalan. Di **mabar**, durasi
dikirim server lewat `game_start` (`remaining`/`remainingMs`), jadi ronde 10 menit
tetap menghitung di semua perangkat. Untuk solo, gunakan 5 menit atau tambahkan
opsi yang konsisten di client. Detail:
[06 · Mekanik & Skor](06-mekanik-dan-skor.md).

### Poin turun setelah jawaban salah

Itu aturan baru, bukan bug. Jawaban salah memotong poin **50%** bila skor saat itu
lebih dari 100: `skor baru = max(100, floor(skor × 0.5))`. Skor 0 tetap 0 dan skor
tepat 100 tetap 100. HUD langsung turun dan muncul teks melayang `-N POIN` bila ada
potongan. Contoh: 360 → 180, 300 → 150, 220 → 110. Detail:
[06 · Mekanik & Skor](06-mekanik-dan-skor.md).

### Leaderboard mengurutkan ketinggian lebih dulu, bukan poin

Leaderboard, panel admin, dan layar hasil menampilkan **ketinggian (meter) lebih
dulu**, lalu poin, dan diurutkan dengan aturan yang sama: ketinggian tertinggi,
baru poin. Tim dengan `500 m · 200 pts` bisa berada di atas tim `400 m · 520 pts`.
Ini bukan bug label maupun bug skor; pemenang memakai urutan yang sama (lihat
[06 §8](06-mekanik-dan-skor.md)).

### Soal terasa berulang / urutannya tidak seperti acak biasa

Pemilihan soal tidak lagi memakai queue yang diacak ulang saat habis, melainkan
**bobot + jeda anti-ulang**:

- soal yang belum pernah tampil → bobot `1`;
- soal yang sudah tampil → `0.03 × 0.20^(kemunculan − 1)` (3%, turun ×0.20 tiap
  kemunculan berikutnya);
- soal yang masih dalam jeda 6 soal terakhir → dikali `0.05` lagi;
- bobot minimum `1e-6`, jadi tidak ada soal yang mustahil muncul.

Riwayat disimpan per tab dan bertahan antar ronde/rematch; refresh halaman
meresetnya. Kalau satu soal terasa terlalu sering, tambah soal atau mulai sesi
baru lewat refresh. Detail:
[05 · Menambah Soal §6](05-menambah-soal.md).

### Tombol “Akhiri & Umumkan Pemenang” tidak muncul

Tombol ini hanya tampil saat status room **Sedang bermain**. Di lobby atau setelah
hasil tampil, yang tersedia adalah **MAIN LAGI**. Kalau room tidak sedang bermain,
server juga menolak `end_game` dengan `Tidak ada pertandingan yang berjalan`.

### Pemenang tidak muncul setelah waktu habis

- Tunggu ±1–2 detik: server mengakhiri pertandingan otomatis pada
  `duration × 1000 + 1200 ms` (grace 1200 ms untuk menerima `finish` skor akhir).
- Durasi **Tanpa Batas** tidak berakhir sendiri. Tekan **AKHIRI & UMUMKAN
  PEMENANG**.
- Kalau layar tim masih **WAKTU HABIS — menunggu hasil resmi**, berarti `game_end`
  belum diterima; cek koneksi WS (Network → WS) dan `/health`.
- Kalau spectator baru dibuka setelah pertandingan, hasil tetap muncul dari
  `lastResult` pada `spectate_ok`.

### Tombol mulai berubah jadi MAIN LAGI / ronde tidak bertambah

Itu normal setelah `game_end`: room kembali ke **Lobby** dan tombol menjadi
**🔁 MAIN LAGI**. Klik tombol itu untuk ronde berikutnya — `round` bertambah,
skor/floor/streak direset, tim tetap terdaftar. Kalau yang muncul kembali
**MULAI MABAR**, berarti panel belum menerima `game_end`; lihat console WS.

### Kode room tidak bisa dipakai lagi (`Room tidak ditemukan`)

Host sudah menekan **HAPUS ROOM** (`delete_room`), atau room kena TTL 2 jam /
server restart. Buat room baru. Tim yang masih terbuka menerima `room_deleted` dan
melihat modal **ROOM DIHAPUS** sebelum kembali ke menu.

### Skor antar-ronde dianggap hilang

Memang begitu: skor/floor/streak direset setiap `start_game` ronde baru, dan
`lastResult` hanya menyimpan hasil ronde terakhir. Tidak ada riwayat multi-ronde
di server.

### Tim refresh dan tidak bisa join lagi

Entry tim lama masih tersimpan dengan koneksi kosong, dan nama dianggap sudah
dipakai. Gunakan nama baru (mis. `TIM A 2`) atau buat room baru. Belum ada UI
rejoin.

### Admin refresh dan tidak bisa memulai

Host terikat pada socket. Refresh menghilangkan identitas host, room tetap hidup
tanpa kendali. Buat room baru. Jangan refresh tab admin saat sesi berlangsung.
Tanpa kendali host, tombol AKHIRI/HAPUS ROOM juga tidak berfungsi; `rejoin_host`
masih bisa dikirim manual dari console bila kode room dan password diketahui.

---

## 5. Masalah WebSocket / Nginx

| Gejala | Kemungkinan | Solusi |
|---|---|---|
| WS `400` | Path tidak cocok (`/vs-ws` vs `/ws`) | `proxy_pass http://127.0.0.1:3001/ws;` |
| WS `502` | Server mati / port salah | Cek `pm2 status`, `curl /health` |
| WS `pending` | Header upgrade tidak diteruskan | Tambah `Upgrade` & `Connection` |
| Putus tiap ±60 detik | Timeout proxy | Naikkan `proxy_read_timeout` |
| Mixed content | HTTPS + `ws://` | Pastikan client memakai `wss://` |
| WS jalan, HTTP health tidak | Health hanya di port 3001 | `curl` dari dalam VPS |

Perintah verifikasi:

```bash
sudo nginx -t
pm2 status
pm2 logs sev7en-vs --lines 100
curl -i http://127.0.0.1:3001/health
ss -ltnp | grep 3001
```

---

## 6. Masalah deploy

| Gejala | Penyebab | Solusi |
|---|---|---|
| `/admin/` 404 | `index` / `try_files` belum benar | Tambah `index index.html;` dan `try_files` |
| Perubahan soal tidak muncul | File salah / cache | Deploy file yang benar, hard refresh / purge cache |
| Room hilang setelah update | Server restart | Data in-memory; buat room baru |
| `npm ci` gagal | Lockfile tidak ikut ter-deploy | Sertakan `package-lock.json` |
| `pm2: command not found` | PM2 belum global | `npm i -g pm2` |
| Password berubah sendiri | Env lama di PM2 | `pm2 startOrReload ecosystem.config.cjs --update-env` |
| Script `deploy-vs.ps1` gagal | Path/port hardcoded mesin lain | Pakai langkah deploy manual |

Ingat: `.env` tidak dibaca otomatis. Set environment lewat PM2/shell.

---

## 7. Batasan yang diketahui

| Batasan | Dampak | Workaround |
|---|---|---|
| Maks. 10 tim | Tim ke-11 ditolak | Dua room bergilir |
| Tanpa rejoin UI | Refresh tim = keluar | Nama baru / room baru |
| Host tanpa reconnect | Refresh admin = kehilangan kendali | Jangan refresh; perangkat khusus host |
| Tanpa database | Restart = semua hilang | Selesaikan sesi sebelum deploy |
| Hasil hanya ronde terakhir | Riwayat antar-ronde tidak disimpan | Catat manual bila perlu rekap |
| Hapus room permanen | Kode tidak bisa dipakai lagi | **MAIN LAGI** untuk ronde berikutnya; buat room baru bila kode mati |
| Skor dari client | Bisa dimanipulasi | Pengawasan guru |
| Bank soal satu tema | Hanya Living Room (50 soal), tanpa pilihan topik | Tambah soal lewat `game.html`; lihat [05](05-menambah-soal.md) |
| Opsi 10 menit di menu solo | Select tidak punya `600` | Mabar tidak terpengaruh (jam dari server); solo pakai 5 menit |
| Pemenang dari ketinggian | Tim dengan poin lebih besar bisa kalah bila ketinggiannya lebih rendah | Bukan bug; urutannya ketinggian → poin → nama |
| Tab background | Timer melambat | Jaga tab tetap aktif |
| Satu instance | Tidak scaling | Cukup untuk satu kelas |

---

## 8. FAQ

**Apakah admin bisa menambah soal dari panel?**
Belum. Soal hardcoded di HTML. Ikuti
[05 · Menambah Soal](05-menambah-soal.md).

**Tema apa yang dipakai dan berapa jumlah soalnya?**
Satu tema: **Talking about My Living Room**, 50 soal (gabungan `quiz_a` nomor
1–25 dan `quiz_b` nomor 26–50). Empat topik lama sudah dihapus.

**Apakah bisa memilih tema lain atau mencampur beberapa topik?**
Tidak lewat UI. Menu solo, form VS, dan panel admin hanya punya opsi Living Room.
Nilai `materi` lama seperti `all` atau kode topik lama akan dinormalkan client
menjadi `living_room`. Menambah tema lain butuh perubahan kode (lihat
[05 §4](05-menambah-soal.md)).

**Kenapa soal yang sudah muncul bisa muncul lagi?**
Pemilihan soal memakai bobot: soal lama tetap punya peluang kecil dan bisa muncul
kembali setelah cukup lama, sementara soal baru diprioritaskan. Semua 50 soal tetap
bisa muncul dalam sesi panjang. Riwayat anti-ulang bertahan antar ronde/rematch
dan direset saat halaman di-refresh.

**Apakah bisa lebih dari 10 tim?**
Tidak tanpa mengubah konstanta `MAX_TEAMS` di server. Untuk kelas besar, buat
beberapa room dan bagi sesi.

**Apakah skor dan hasil tersimpan?**
Tidak ada database. Hasil ronde terakhir disimpan di memori room (`lastResult`)
selama room hidup, jadi host/observer yang menyambung ulang masih melihat
pemenang. Skor tiap tim direset saat ronde baru dimulai, dan semuanya hilang saat
server restart atau room dihapus.

**Bagaimana cara reset semua room?**
Restart `vs-server` (`pm2 restart sev7en-vs`) atau tunggu TTL 2 jam. Untuk satu
room saja, host menekan **HAPUS ROOM** di panel admin.

**Apakah bisa main tanpa internet?**
Mode solo bisa, selama file HTML/JS tersedia lokal. Font dan ikon eksternal
mungkin tidak tampil, tetapi game tetap berjalan. Mode mabar butuh akses ke
server WebSocket.

**Apakah bisa dijalankan di HP/tablet?**
Ya, lewat browser. Kontrol tap kiri/kanan layar. Untuk mabar, satu perangkat =
satu tim.

**Apakah dua kelas bisa mabar bersamaan?**
Bisa, dengan room berbeda. Keduanya memakai proses server yang sama dan saling
terisolasi.

**Apakah ada jeda (pause)?**
Tidak. Tombol **⚙️ Menu** menghentikan permainan dan membuka pengaturan; menekan
mulai akan mengulang dari awal.

**Bisakah memakai nama tim yang sama di perangkat berbeda?**
Tidak dalam satu room (case-insensitive). Gunakan nama unik.

**Apakah pemenang ditentukan otomatis?**
Ya. Server menghitung pemenang dari keadaan terakhir saat pertandingan berakhir
(timer otomatis atau tombol **AKHIRI & UMUMKAN PEMENANG**): **ketinggian (`floor`)
tertinggi**, lalu skor tertinggi, lalu nama. Tim dengan ketinggian lebih tinggi
menang walau poinnya lebih kecil; seri hanya bila `floor` dan skor sama. Hasilnya
dikirim ke semua pemain, host, dan spectator lewat `game_end`.

**Apakah jawaban salah mengurangi poin?**
Ya. Bila skor saat itu lebih dari 100, skor dipotong 50% dan tidak pernah turun di
bawah 100 (`max(100, floor(skor × 0.5))`). Skor 0 tetap 0 dan skor tepat 100 tetap
100. Contoh: 360 → 180, 300 → 150, 220 → 110. Ketinggian juga turun 1 tangga
(100 m) kecuali saat di tanah.

**Apakah satu kode room bisa dipakai untuk beberapa ronde?**
Ya. Setelah `game_end`, room kembali ke lobby dan tim tetap terdaftar. Host
menekan **🔁 MAIN LAGI** untuk ronde berikutnya; `round` bertambah dan
skor/floor/streak direset. Tim baru boleh join di antara ronde.

**Apa yang terjadi kalau host menekan HAPUS ROOM?**
Semua tim dan spectator menerima `room_deleted`; browser tim menampilkan modal
**ROOM DIHAPUS** lalu kembali ke menu, dan kode room tidak bisa dipakai lagi
(`Room tidak ditemukan`).

**Apakah skor ronde sebelumnya masih terlihat?**
Tidak. `lastResult` hanya menyimpan hasil ronde terakhir sampai ronde berikutnya
dimulai. Tidak ada riwayat multi-ronde di server.

**Kenapa tombol Mulai bisa ditekan dua kali?**
Selama bermain tombol dinonaktifkan (**⏳ SEDANG BERMAIN**), dan server juga
menolak `start_game` saat `playing` dengan error `Pertandingan sedang berjalan`;
ronde yang sedang berjalan tidak ikut direset. Tekan sekali per ronde.

**Apakah password admin terlihat di jaringan?**
Ya, jika memakai `ws://`. Gunakan `wss://` di production.

**Apakah room bisa diprediksi orang luar?**
Kode 6 karakter dari 32 alfabet (ruang sampel besar), tetapi tidak ada rate limit.
Untuk kelas tertutup, bagikan kode hanya ke peserta.

---

## 9. Informasi yang perlu dikumpulkan saat melapor bug

- URL halaman dan mode (solo/admin/tim).
- Waktu kejadian dan zona waktu.
- Pesan error persis (screenshot / copy).
- Console browser (DevTools → Console).
- Network → WS: status handshake dan pesan terakhir.
- Output `pm2 logs sev7en-vs --lines 100`.
- Hasil `curl http://127.0.0.1:3001/health`.
- Jumlah tim dan apakah ada refresh/disconnect sebelum masalah.

Kembali ke [Daftar Dokumentasi](README.md).

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
| `Room sudah mulai` | Join setelah host menekan mulai | Tidak bisa join; buat room baru atau main solo |
| `Room penuh (10 tim)` | Sudah 10 tim | Buat room kedua / giliran |
| `Nama tim sudah dipakai` | Nama sama (case-insensitive), termasuk entry tim yang disconnect | Pakai nama lain atau room baru |
| `Hanya host yang bisa start` | Socket bukan host (mis. admin refresh) | Buat room baru dari tab admin yang aktif |
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

Kemungkinan pool soal kosong karena `topic` tidak cocok dengan opsi `<select>`.
Cek:

1. Nilai `value` topik = `topic` di bank soal.
2. Console browser untuk error seperti `Cannot read properties of undefined`.
3. Tambahkan minimal satu soal untuk topik tersebut.

### Halaman blank setelah edit soal

Hampir pasti **SyntaxError**:

- Koma antar objek hilang.
- Apostrof tidak di-escape (`I don't` → `I don\'t`).
- Kurung `];` terhapus.

Buka DevTools → Console untuk melihat nomor baris, lalu perbaiki.

### Timer terasa melambat / berhenti saat pindah tab

Browser membatasi `setInterval` di tab background. Timer berbasis hitungan detik
lokal, bukan koreksi `serverTime`. Untuk penilaian yang adil:

- Minta semua tim tetap di tab game (jangan minimize / pindah tab).
- Gunakan mode tanpa batas untuk latihan santai.
- Hindari multitasking berat di perangkat tim.

### Opsi “10 Menit” tidak menghitung mundur

Diketahui: menu solo tidak memiliki opsi `600`, sehingga nilai select menjadi
kosong dan timer tidak berjalan. Efektif seperti tanpa batas. Gunakan 5 menit,
atau tambahkan opsi yang konsisten di client. Detail:
[06 · Mekanik & Skor](06-mekanik-dan-skor.md).

### Angka di leaderboard VS aneh (`5m`)

Leaderboard menampilkan jumlah tangga dengan akhiran `m`, bukan meter. HUD game
yang benar (`5 tangga = 500 m`). Ini bug label, bukan bug skor.

### Tidak ada tombol “Akhiri permainan” / podium

Belum diimplementasikan di UI. Server mendukung `end_game`, tetapi panel admin
belum menyediakan tombol. Tentukan pemenang manual dari leaderboard terakhir.

### Tim refresh dan tidak bisa join lagi

Entry tim lama masih tersimpan dengan koneksi kosong, dan nama dianggap sudah
dipakai. Gunakan nama baru (mis. `TIM A 2`) atau buat room baru. Belum ada UI
rejoin.

### Admin refresh dan tidak bisa memulai

Host terikat pada socket. Refresh menghilangkan identitas host, room tetap hidup
tanpa kendali. Buat room baru. Jangan refresh tab admin saat sesi berlangsung.

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
| Tanpa end/podium | Pemenang manual | Umumkan dari leaderboard |
| Skor dari client | Bisa dimanipulasi | Pengawasan guru |
| Opsi 10 menit admin | Tidak ada timer | Pakai 5 menit |
| Label `m` di leaderboard | Menyesatkan | Baca sebagai jumlah tangga |
| Tab background | Timer melambat | Jaga tab tetap aktif |
| Satu instance | Tidak scaling | Cukup untuk satu kelas |

---

## 8. FAQ

**Apakah admin bisa menambah soal dari panel?**
Belum. Soal hardcoded di HTML. Ikuti
[05 · Menambah Soal](05-menambah-soal.md).

**Apakah bisa lebih dari 10 tim?**
Tidak tanpa mengubah konstanta `MAX_TEAMS` di server. Untuk kelas besar, buat
beberapa room dan bagi sesi.

**Apakah skor dan hasil tersimpan?**
Tidak. Tidak ada database; hasil hanya tampil di layar dan leaderboard selama
room hidup.

**Bagaimana cara reset semua room?**
Restart `vs-server` (`pm2 restart sev7en-vs`) atau tunggu TTL 2 jam.

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
Tidak. Server hanya mengurutkan skor. Pemenang ditentukan manual.

**Kenapa tombol Mulai bisa ditekan dua kali?**
Server tidak memblokir `start_game` saat status sudah `playing`. Tekan sekali
saja; klik kedua akan merestart semua tim.

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

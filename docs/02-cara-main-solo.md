# 02 · Cara Main Solo

Mode solo adalah latihan individu: satu pemain menaiki tangga awan dengan menjawab
soal Bahasa Inggris. Tidak perlu server mabar.

---

## 1. Masuk ke mode solo

1. Buka landing page `/`.
2. Klik kartu **🎮 Main Sendiri**.
3. Isi form di menu:

| Field | Default | Keterangan |
|---|---|---|
| Nama Tim di Laptop Ini | `TIM BINTANG A` | Ditampilkan di HUD dan hasil akhir; otomatis uppercase |
| Pilih Tema | 🏠 Talking about My Living Room | Satu-satunya tema (50 soal) |
| Durasi 1 Match | 3 Menit | 2 menit, 3 menit, 5 menit, atau tanpa batas |

4. Klik **🚀 MULAI NAIK TANGGA! (Solo)**.

> Tombol **👥 GABUNG MABAR** di menu yang sama membuka dialog join room. Mode itu
> dibahas di [04 · Mabar Multiplayer](04-mabar-multiplayer.md).

### Pilihan materi

Bank soal kini hanya punya **satu tema**, jadi tidak ada lagi filter topik atau
mode gabungan:

| Value | Label di menu | Isi |
|---|---|---|
| `living_room` | 🏠 Talking about My Living Room (50 soal) | Seluruh bank: 50 soal ruang tamu |

> Menu hanya menyediakan opsi ini. Di mabar, kalau room mengirim `materi` lama
> (`all`, `there_prep`, `food_kitchen`, dan sebagainya), client menormalkannya
> menjadi `living_room` supaya permainan tetap berjalan.

### Pilihan durasi

| Value | Label | Perilaku |
|---|---|---|
| `120` | 2 Menit (Sprint) | Hitung mundur 120 detik |
| `180` | 3 Menit (Normal) | Hitung mundur 180 detik |
| `300` | 5 Menit (Marathon) | Hitung mundur 300 detik |
| `9999` | Tanpa Batas Waktu | Timer menampilkan `♾️`, tidak pernah habis |

Game berhenti hanya karena waktu habis. Tidak ada kondisi “menang” selain
mencapai setinggi mungkin sebelum waktu habis.

---

## 2. Tampilan saat bermain

Sejak konversi 3D, dunia permainan digambar sebagai **pemandangan 3D** dari kamera
perspektif: pulau bumi di bawah, tangga awan ber-volume yang menjulang ke atas, dan
langit yang berubah sesuai ketinggian. Karakter Star-Pou tampil sebagai bintang
kuning ber-volume (prisma bintang) dengan mata dan mulut yang mengikuti ekspresinya.
HUD dan kontrol **tidak berubah** — hanya lapisan gambarnya yang berubah.

### HUD atas

- **Nama tim** dan **skor**.
- **Ketinggian** dalam meter (`jumlah tangga × 100 m`).
- **Badge zona**: Bumi & Rumput, Langit Awan, Atmosfer Senja, Luar Angkasa.
- **Sisa waktu** dalam format `mm:ss`, atau `♾️`.
- Tombol **⚙️ Menu** untuk membuka pengaturan dan memulai ulang.

### Banner soal

- Label **TANGGA n** menunjukkan tangga yang sedang dituju.
- Emoji dan teks soal bahasa Inggris.
- Dua platform di atas karakter adalah dua pilihan jawaban: satu benar, satu salah,
  posisinya diacak setiap soal.
- Papan tanda jawaban digambar sebagai billboard 3D di atas platform. Di layar
  sempit, lebar papan dibatasi agar dua pilihan tetap muat.

### Dunia 3D

- **Pulau bumi** (piringan rumput low-poly dengan bukit dan pohon kecil) hanya
  terlihat saat permainan masih rendah; makin tinggi, pulau itu tertinggal di bawah.
- **Tangga awan**: tiap platform berupa slab 3D dengan puff awan di tepinya, label
  `TANGGA n` di permukaan atas, dan warna berbeda untuk start/benar/salah.
- **Kamera** berada sedikit di atas pemain dan bergoyang halus (orbit kecil). Kamera
  otomatis naik mengikuti platform terakhir yang benar; jaraknya menyesuaikan ukuran
  jendela supaya dua pilihan jawaban selalu muat.
- **Panduan lompat**: garis putus-putus melengkung dari platform saat ini ke kedua
  pilihan, hanya muncul saat karakter siap melompat.

### Kontrol

| Aksi | Keyboard | Mouse / sentuh |
|---|---|---|
| Lompat ke pilihan kiri | `←` atau `A` | Klik/tap separuh kiri layar |
| Lompat ke pilihan kanan | `→` atau `D` | Klik/tap separuh kanan layar |

Kontrol hanya aktif saat karakter dalam keadaan **idle**. Selama melompat,
merayakan, atau jatuh, input tambahan diabaikan. Perilaku kontrol ini sama persis
dengan versi 2D.

---

## 3. Alur satu soal

```
Soal muncul
   │
   ├── Pilih platform BENAR
   │      ├── +poin (100–200)
   │      ├── naik 1 tangga
   │      ├── streak +1
   │      └── 550 ms kemudian soal baru muncul
   │
   └── Pilih platform SALAH
          ├── skor dipotong 50% (minimum 100; skor 0 dan 100 tidak terpotong)
          ├── teks melayang “-N POIN” muncul bila ada potongan
          ├── streak kembali 0
          ├── awan pecah, karakter jatuh
          └── 900 ms kemudian turun 1 tangga (−100 m) ke platform aman sebelumnya
              & soal baru; di tanah (0 m) tetap di START
```

- Kamera otomatis mengikuti platform aman terakhir: naik saat jawaban benar, turun
  1 tangga saat jawaban salah.
- Riwayat platform yang ditampilkan dibatasi 8 tangga terakhir.
- Pemilihan soal memakai bobot: soal yang belum pernah tampil diprioritaskan, soal
  yang sudah tampil diberi bobot kecil (dikali 0.05 lagi bila masih dalam 6 soal
  terakhir). Semua soal tetap bisa muncul kembali dalam sesi panjang. Detail:
  [05 · Menambah Soal §6](05-menambah-soal.md).

Detail angka dan rumus ada di [06 · Mekanik & Skor](06-mekanik-dan-skor.md).

---

## 4. Zona ketinggian

Badge zona di HUD berubah mengikuti `floorLevel` (jumlah tangga):

| Tangga | Meter | Badge |
|---|---|---|
| 0–3 | 0–300 m | 🌱 Bumi & Rumput |
| 4–7 | 400–700 m | ☁️ Langit Awan |
| 8–11 | 800–1.100 m | 🌇 Atmosfer Senja |
| 12+ | 1.200 m+ | 🚀 Luar Angkasa! |

Latar langit 3D berubah mulus mengikuti **ketinggian kamera**, bukan langsung per
tangga. Di zona bumi, pulau rumput terlihat di bawah; awan latar berwarna putih.
Memasuki senja, awan menguning-oranye dan bintang mulai muncul. Di luar angkasa,
langit menjadi gelap, bintang berkelip, bulan dan planet bercincin tampil, dan pulau
bumi sudah jauh di bawah. Ambang perubahan langit dan warna tiap zona dijelaskan di
[10 · Renderer 3D](10-renderer-3d.md).

---

## 5. Skor singkat

- Jawaban benar: **100 poin**.
- Bonus streak: **+20 poin** per jawaban benar berturut-turut, maksimal **+100**.
- Jadi poin per jawaban benar: 100, 120, 140, 160, 180, lalu 200 (maksimal).
- Jawaban salah: poin dipotong **50%** dengan minimum **100** (skor 0 tetap 0 dan
  skor tepat 100 tetap 100), streak reset, ketinggian turun **100 m** (1 tangga),
  kecuali saat sudah di tanah (0 m) tetap di START. Contoh: 360 → 180, 300 → 150,
  220 → 110.

Contoh 8 jawaban benar berturut-turut:

| Benar ke- | Poin didapat | Total |
|---:|---:|---:|
| 1 | 100 | 100 |
| 2 | 120 | 220 |
| 3 | 140 | 360 |
| 4 | 160 | 520 |
| 5 | 180 | 700 |
| 6 | 200 | 900 |
| 7 | 200 | 1.100 |
| 8 | 200 | 1.300 |

---

## 6. Akhir permainan

Saat timer mencapai 0:

- Permainan berhenti dan modal hasil muncul.
- Modal menampilkan nama tim, total poin, ketinggian dalam meter, dan jumlah tangga.
- Klik **⚙️ Menu** / mulai ulang untuk bermain lagi. Skor, tangga, dan streak
  di-reset dari awal.

Di mode solo, tidak ada leaderboard dan tidak ada pengiriman skor ke server.

---

## 7. Tips untuk guru

- Gunakan **2–3 menit** untuk sesi cepat, **5 menit** untuk sesi latihan lebih
  tenang.
- Pilih durasi sesuai kebutuhan; materi selalu **Talking about My Living Room**
  (satu-satunya tema, 50 soal).
- Mainkan satu kali percobaan sebelum menilai, supaya siswa paham kontrol.
- Untuk kompetisi antar kelompok, gunakan mode mabar (maksimal 10 tim) — lihat
  [04 · Mabar Multiplayer](04-mabar-multiplayer.md).
- Jika ingin menambah atau mengganti soal, baca
  [05 · Menambah Soal](05-menambah-soal.md).

Lanjut: [03 · Panel Admin](03-panel-admin.md).

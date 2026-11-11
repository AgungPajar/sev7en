# 05 · Menambah Soal

Bank soal masih **hardcoded di dalam file HTML**. Belum ada menu CRUD soal di panel
admin. Menambah soal berarti mengedit array `QUESTION_BANK`, lalu men-deploy ulang
file HTML terkait.

---

## 1. Di file mana soal disimpan?

Cari `const QUESTION_BANK = [` di file berikut:

| File | Peran | Wajib diubah? |
|---|---|---|
| `game.html` | Game utama + mabar (VS). Ini yang dipakai landing. | **Ya** |
| `star_pou_sky_climber.html` | Versi solo tanpa blok VS | Ya, jika file ini masih dipakai/dibagikan |
| `star_pou_vs.html` | Duplikat lama `game.html` (isinya identik saat ini) | Hanya jika masih dipakai |

> Jika ragu, edit `game.html` dan `star_pou_sky_climber.html`. Jangan biarkan
> salinan yang masih dipakai tertinggal dengan soal lama.

---

## 2. Struktur satu soal

Setiap soal adalah satu objek:

```js
{ topic: 'there_prep', emoji: '🐱🪑', q: 'The cat is sleeping ______ the table. (Di bawah)', correct: 'under', wrong: 'behind' },
```

| Properti | Tipe | Aturan |
|---|---|---|
| `topic` | string | Harus salah satu dari 4 kode topik yang didukung |
| `emoji` | string | Wajib tidak kosong; tampil di banner soal |
| `q` | string | Teks soal; sebaiknya unik |
| `correct` | string | Jawaban benar, tidak boleh sama dengan `wrong` |
| `wrong` | string | Pengecoh; harus terlihat masuk akal |

Kode topik yang valid:

| Kode | Materi | Jumlah saat ini |
|---|---|---:|
| `there_prep` | There is/are, ruangan, preposisi | 8 |
| `food_kitchen` | Makanan, likes/dislikes, dapur | 8 |
| `continuous_hobby` | Present continuous, hobi | 6 |
| `routine_transport` | Rutinitas pagi, angka, transportasi | 7 |

Total bank saat ini: **29 soal**.

> Topik yang salah ketik tidak membuat game crash, tetapi soal hanya akan muncul
> di mode **Semua Materi** dan tidak pernah muncul di filter topik.

---

## 3. Cara menambah soal (langkah demi langkah)

### Langkah 1 — Backup

Pastikan perubahan lama sudah di-commit atau salin file:

```bash
git status
git diff
```

### Langkah 2 — Buka bank soal

Buka `game.html`, cari:

```js
const QUESTION_BANK = [
```

### Langkah 3 — Tambahkan objek baru

Tambahkan setelah soal terakhir di topik yang sesuai, **sebelum** penutup `];`.
Jangan lupa koma di akhir objek.

Contoh menambah soal `there_prep`:

```js
{ topic: 'there_prep', emoji: '🪟', q: 'There ______ a window in my bedroom.', correct: 'is', wrong: 'are' },
```

Hasilnya:

```js
  { topic: 'there_prep', emoji: '🎒', q: 'Where is the bag? It is ______ the chair. (Di atas)', correct: 'on', wrong: 'in' },

  // soal baru
  { topic: 'there_prep', emoji: '🪟', q: 'There ______ a window in my bedroom.', correct: 'is', wrong: 'are' },

  // Meals, Likes/Dislikes & Kitchen
  ...
];
```

### Langkah 4 — Ikuti aturan sintaks

- **Koma** di akhir setiap objek, kecuali objek terakhir (trailing comma masih
  valid di JavaScript modern, tetapi konsistenlah).
- **Apostrof** di dalam string single-quote harus di-escape:

```js
{ topic: 'food_kitchen', emoji: '🍗', q: 'Do you like chicken? Yes, ______.', correct: 'I do', wrong: 'I don\'t' },
```

Alternatif yang lebih aman: pakai tanda kutip ganda untuk string yang berisi
apostrof.

- Jangan memakai tanda kutip miring (`’`) sebagai pengganti `'` pemrograman.
- Jangan menambahkan `];` di tengah array.
- Pastikan `correct` dan `wrong` benar-benar berbeda.

### Langkah 5 — Samakan di file lain

Ulangi penambahan yang sama di `star_pou_sky_climber.html` dan, bila masih
dipakai, `star_pou_vs.html`.

### Langkah 6 — Uji di browser

1. Jalankan file statis (`npx serve . -l 4173`).
2. Buka `/game.html`, lakukan **hard refresh** (`Ctrl + F5`).
3. Pilih topik yang sesuai (bukan `all`).
4. Pastikan soal baru muncul dan kedua pilihan jawabannya benar/salah.
5. Buka console browser; tidak boleh ada `SyntaxError`.

> Soal diacak, jadi soal baru mungkin tidak muncul di percobaan pertama. Mainkan
> beberapa tangga atau perkecil dulu bank soal saat menguji.

### Langkah 7 — Deploy

Unggah file HTML yang berubah ke web server. Jika ada cache/CDN, lakukan cache
bust atau hard refresh. Lihat [07 · Deploy VPS](07-deploy-vps.md).

---

## 4. Menambah topik baru

Menambah topik butuh perubahan di beberapa tempat agar muncul di semua menu.

Contoh topik baru: `daily_activity`.

### a. Tambahkan soal dengan topik baru

```js
{ topic: 'daily_activity', emoji: '🦷', q: 'I ______ my teeth every morning.', correct: 'brush', wrong: 'wash' },
{ topic: 'daily_activity', emoji: '🛏️', q: 'I ______ my bed after waking up.', correct: 'make', wrong: 'do' },
```

### b. Daftarkan opsi di menu solo

`game.html`, di dalam `<select id="topic-select">`:

```html
<option value="daily_activity">🌞 Daily Activities</option>
```

Ulangi di `star_pou_sky_climber.html` jika file itu dipakai.

### c. Daftarkan opsi di form admin

`admin/index.html`, di dalam `<select id="materi">`:

```html
<option value="daily_activity"> Daily Activities</option>
```

### d. Daftarkan opsi di form VS dalam game

`game.html`, di dalam `<select id="vs-materi">`:

```html
<option value="daily_activity">Daily Activities</option>
```

> Nilai `value` di keempat tempat **harus sama persis** dengan `topic` di bank
> soal. Label boleh berbeda.

### e. Server tidak perlu diubah

`vs-server` hanya menyimpan dan meneruskan string `materi`; tidak ada whitelist
topik. Namun nilai yang tidak dikenal akan menghasilkan pool kosong di client.

### f. Uji filter

Buka game, pilih topik baru, pastikan hanya soal topik itu yang muncul. Jika pool
kosong, game akan gagal menampilkan soal — biasanya karena `value` tidak sama
dengan `topic`.

---

## 5. Panduan kualitas soal

- **Satu konsep per soal.** Hindari dua celah jawaban dalam satu kalimat.
- **Pengecoh harus masuk akal.** `under` vs `behind` lebih baik daripada
  `under` vs `banana`.
- **Panjang jawaban seimbang.** Jangan membuat jawaban benar selalu paling
  panjang; siswa bisa menebak dari bentuk.
- **Konsisten dengan kurikulum kelas 3–4.** Kalimat pendek, kosakata familiar.
- **Hindari jawaban ganda yang benar.** Contoh: “I go to school ___ bus” —
  `by` benar, `on` bisa diperdebatkan tergantung konteks.
- **Emoji relevan** agar siswa cepat memahami konteks.
- **Jangan menduplikasi teks `q`.** Soal duplikat membingungkan dan menyulitkan
  audit.
- **Minimal 10–12 soal per topik** agar tidak cepat berulang. Saat ini
  `continuous_hobby` hanya punya 6.

---

## 6. Cara pengacakan bekerja

- Saat mulai, client memfilter bank sesuai topik lalu mengacak urutannya.
- Untuk setiap soal, posisi jawaban benar diacak: kadang kiri, kadang kanan.
- Jika semua soal dalam pool sudah terpakai, pool diacak ulang dan permainan
  berlanjut. Artinya soal bisa terulang dalam satu sesi.
- Setiap tim di mode mabar mengacak sendiri, jadi urutan antar tim berbeda.
- Menambah soal tidak mengubah skor per jawaban; lihat
  [06 · Mekanik & Skor](06-mekanik-dan-skor.md).

---

## 7. Kesalahan umum

| Gejala | Kemungkinan penyebab | Perbaikan |
|---|---|---|
| Halaman game blank | `SyntaxError`: koma/kutip hilang | Buka DevTools → Console, cek baris |
| Soal baru tidak muncul di filter | `topic` salah ketik | Samakan dengan kode topik |
| Dua pilihan jawaban sama | `correct === wrong` | Ganti pengecoh |
| Teks terpotong setelah apostrof | `'` tidak di-escape | Pakai `\'` atau kutip ganda |
| Topik baru tidak ada di menu | Opsi `<select>` belum ditambah | Tambah di solo, admin, dan VS |
| Topik baru muncul tapi kosong | `value` ≠ `topic` | Samakan nilainya |
| Soal lama hilang | Objek tertimpa / kurung salah | Pulihkan dari git |
| Perubahan tidak terlihat | Cache browser / file salah | Hard refresh, cek file yang di-deploy |

---

## 8. Checklist

- [ ] Soal ditambahkan ke `game.html`.
- [ ] Soal disalin ke `star_pou_sky_climber.html` (dan `star_pou_vs.html` bila dipakai).
- [ ] `topic` valid dan konsisten.
- [ ] `correct` ≠ `wrong`.
- [ ] Apostrof di-escape dengan benar.
- [ ] `emoji` tidak kosong.
- [ ] Teks soal unik.
- [ ] Filter topik diuji di browser.
- [ ] Tidak ada error di console.
- [ ] File yang berubah sudah di-deploy dan cache dibersihkan.

> Catatan: folder `tests/` sedang WIP dan tidak dibahas di dokumentasi ini.

Lanjut ke [06 · Mekanik & Skor](06-mekanik-dan-skor.md).

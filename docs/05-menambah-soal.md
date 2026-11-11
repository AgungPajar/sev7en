# 05 · Menambah Soal

Bank soal masih **hardcoded di dalam file HTML**. Belum ada menu CRUD soal di panel
admin. Menambah soal berarti mengedit array `QUESTION_BANK`, lalu men-deploy ulang
file HTML terkait.

Sejak pembaruan terakhir, bank soal memakai **satu tema**:
**Talking about My Living Room** dengan **50 soal**. Empat topik lama
(`there_prep`, `food_kitchen`, `continuous_hobby`, `routine_transport`) sudah
dihapus, jadi tidak ada lagi pilihan topik atau mode gabungan.

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
{ id: 1, topic: 'living_room', emoji: '🛋️', q: 'We sit on a ___ in the living room.', correct: 'sofa', wrong: 'lamp' },
```

| Properti | Tipe | Aturan |
|---|---|---|
| `id` | number | Nomor unik (bank saat ini 1–50). Dipakai pelacak anti-ulang; jangan diduplikasi |
| `topic` | string | Selalu `living_room` |
| `emoji` | string | Wajib tidak kosong; tampil di banner soal |
| `q` | string | Teks soal; sebaiknya unik |
| `correct` | string | Jawaban benar, tidak boleh sama dengan `wrong` |
| `wrong` | string | Satu-satunya pengecoh; harus terlihat masuk akal |

Game hanya memakai **dua pilihan jawaban** (`correct` dan `wrong`). Struktur ini
diturunkan dari bank quiz di materi *05-Talking-about-My-Living-Room*
(posttest/pretest): `quiz_a.json` nomor **1–25** digabung dengan `quiz_b.json`
nomor **26–50**. Properti sumber seperti `level`, `type`, dan `explain` **tidak
dipakai** game dan tidak disalin; emoji dipetakan per nomor soal.

Kode tema yang valid saat ini:

| Kode | Tema | Jumlah saat ini |
|---|---|---:|
| `living_room` | Talking about My Living Room | 50 |

Total bank saat ini: **50 soal, satu tema**.

> Menu solo, form VS, dan panel admin hanya menyediakan opsi `living_room`. Server
> tetap menerima string `materi` apa pun, tetapi client menormalkan `all`, kode
> tema lama, atau nilai tak dikenal menjadi `living_room` supaya pool soal tidak
> pernah kosong. Konsekuensinya, soal yang `topic`-nya salah ketik tidak akan
> pernah terpilih (bukan membuat game crash).

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

Tambahkan setelah soal terakhir (saat ini `id: 50`), **sebelum** penutup `];`.
Gunakan `id` berikutnya yang belum dipakai dan `topic: 'living_room'`. Jangan lupa
koma di akhir objek.

Contoh menambah soal ke-51:

```js
{ id: 51, topic: 'living_room', emoji: '🪟', q: 'There ______ a big window in my living room.', correct: 'is', wrong: 'are' },
```

Hasilnya:

```js
  // soal terakhir saat ini
  { id: 50, topic: 'living_room', emoji: '🛋️', q: 'My living room ___ a big sofa.', correct: 'has', wrong: 'have' },

  // soal baru
  { id: 51, topic: 'living_room', emoji: '🪟', q: 'There ______ a big window in my living room.', correct: 'is', wrong: 'are' },
];
```

> `id` dipakai sebagai kunci riwayat anti-ulang. Dua soal dengan `id` sama akan
> berbagi riwayat (dianggap soal yang sama), jadi pastikan `id` unik.

### Langkah 4 — Ikuti aturan sintaks

- **Koma** di akhir setiap objek, kecuali objek terakhir (trailing comma masih
  valid di JavaScript modern, tetapi konsistenlah).
- **Apostrof** di dalam string single-quote harus di-escape:

```js
{ id: 52, topic: 'living_room', emoji: '🏠', q: 'There isn\'t a lamp in the living room.', correct: 'No, there isn\'t.', wrong: 'No, there aren\'t.' },
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
3. Materi otomatis **Talking about My Living Room** (satu-satunya opsi).
4. Pastikan soal baru muncul dan kedua pilihan jawabannya benar/salah.
5. Buka console browser; tidak boleh ada `SyntaxError`.

> Soal baru diprioritaskan oleh pemilihan berbobot, jadi biasanya muncul dalam
> beberapa tangga pertama. Kalau bank sangat besar dan soal baru tidak kunjung
> muncul, mainkan beberapa tangga lagi — semua soal tetap punya peluang.

### Langkah 7 — Deploy

Unggah file HTML yang berubah ke web server. Jika ada cache/CDN, lakukan cache
bust atau hard refresh. Lihat [07 · Deploy VPS](07-deploy-vps.md).

---

## 4. Menambah tema baru (opsional, butuh perubahan kode)

Game saat ini dirancang **satu tema**. Menambah tema lain berarti mengubah kode di
beberapa tempat sekaligus, bukan sekadar menambah soal.

Contoh tema baru: `daily_activity`.

### a. Tambahkan soal dengan topik baru

```js
{ id: 101, topic: 'daily_activity', emoji: '🦷', q: 'I ______ my teeth every morning.', correct: 'brush', wrong: 'wash' },
{ id: 102, topic: 'daily_activity', emoji: '🛏️', q: 'I ______ my bed after waking up.', correct: 'make', wrong: 'do' },
```

Gunakan rentang `id` yang tidak bertabrakan dengan tema lama.

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

### e. Server tidak perlu diubah, tetapi client menormalkan materi

`vs-server` hanya menyimpan dan meneruskan string `materi`; tidak ada whitelist
topik. Namun client menormalkan nilai yang tidak ada di `QUESTION_BANK` menjadi
`living_room` saat menerima `game_start`. Artinya tema baru baru bisa dipakai
setelah kode `topic`-nya ada di bank soal **dan** opsi menu terdaftar; kalau tidak,
room akan tetap memakai Living Room.

### f. Uji filter

Buka game, pilih topik baru, pastikan hanya soal topik itu yang muncul. Jika pool
kosong, game memakai seluruh bank (Living Room) — biasanya karena `value` tidak
sama dengan `topic` atau opsi belum terdaftar.

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
- **Jaga jumlah bank tetap besar.** Saat ini 50 soal untuk satu tema; pemilihan
  berbobot menekan pengulangan, tetapi bank yang lebih besar tetap lebih baik
  untuk sesi panjang.
- **Cocokkan dengan kunci sumber.** Saat menambah dari `quiz_a`/`quiz_b`, pastikan
  `correct` dan `wrong` tidak tertukar.

---

## 6. Cara pemilihan soal bekerja (bobot + jeda anti-ulang)

Sejak bank menjadi satu tema, pemilihan soal **tidak lagi memakai queue yang
diacak ulang** ketika habis. Setiap tangga memilih satu soal secara berbobot:

- Pool difilter berdasarkan `topic` (saat ini selalu `living_room`) lalu diacak
  sekali dengan Fisher–Yates saat permainan dimulai.
- Konstanta pengatur ada di `game.html` bagian **“1b. PEMILIHAN SOAL ANTI-ULANG”**:
  `QUESTION_REPEAT_BASE = 0.03`, `QUESTION_REPEAT_DECAY = 0.20`,
  `QUESTION_RECENT_WINDOW = 6`, dan `QUESTION_RECENT_FACTOR = 0.05`.
- Bobot tiap soal saat dipilih:
  - **belum pernah tampil** → bobot `1`;
  - **sudah tampil** → `0.03 × 0.20^(kemunculan − 1)` (3% bobot soal baru, turun
    ×0.20 setiap kemunculan berikutnya);
  - bila soal itu masih berada dalam **jeda 6 soal terakhir** → bobot dikali
    `0.05` lagi;
  - bobot minimum `1e-6`, jadi peluang tidak pernah benar-benar nol.
- Efeknya: soal baru diprioritaskan, soal yang baru muncul tidak langsung muncul
  lagi di tangga berikutnya, dan soal lama tetap bisa muncul kembali setelah cukup
  lama. Seluruh 50 soal tetap dapat muncul dalam sesi panjang.
- Riwayat anti-ulang disimpan **per tab** (kunci `id`) dan **bertahan antar ronde**
  di lobby yang sama (rematch); `startGame()` tidak menghapusnya. Refresh halaman
  memulai riwayat baru.
- Posisi jawaban benar diacak 50:50 antara kiri dan kanan untuk setiap soal.
- Di mabar, setiap tab punya riwayat dan urutan sendiri, jadi urutan soal antar
  tim berbeda. Server tidak membagikan soal.
- Menambah soal tidak mengubah skor per jawaban; lihat
  [06 · Mekanik & Skor](06-mekanik-dan-skor.md).

---

## 7. Kesalahan umum

| Gejala | Kemungkinan penyebab | Perbaikan |
|---|---|---|
| Halaman game blank | `SyntaxError`: koma/kutip hilang | Buka DevTools → Console, cek baris |
| Soal baru tidak pernah muncul | `topic` bukan `living_room`, atau `id` duplikat | Samakan `topic`; beri `id` unik |
| Dua pilihan jawaban sama | `correct === wrong` | Ganti pengecoh |
| Teks terpotong setelah apostrof | `'` tidak di-escape | Pakai `\'` atau kutip ganda |
| Soal terasa cepat berulang | Bank kecil / sesi sangat panjang | Tambah soal; ingat anti-ulang hanya menekan bobot, bukan melarang |
| Tema baru tidak ada di menu | Opsi `<select>` belum ditambah | Tambah di solo, admin, VS, dan pastikan ada di bank |
| Tema baru muncul tapi kembali ke Living Room | `value` ≠ `topic` / tidak ada di bank | Samakan nilainya; client menormalkan ke `living_room` |
| Soal lama hilang | Objek tertimpa / kurung salah | Pulihkan dari git |
| Perubahan tidak terlihat | Cache browser / file salah | Hard refresh, cek file yang di-deploy |

---

## 8. Checklist

- [ ] Soal ditambahkan ke `game.html`.
- [ ] Soal disalin ke `star_pou_sky_climber.html` (dan `star_pou_vs.html` bila dipakai).
- [ ] `id` unik dan belum dipakai soal lain.
- [ ] `topic` = `living_room` (atau tema yang memang didaftarkan).
- [ ] `correct` ≠ `wrong`.
- [ ] Apostrof di-escape dengan benar.
- [ ] `emoji` tidak kosong.
- [ ] Teks soal unik.
- [ ] Tidak ada error di console.
- [ ] Soal baru muncul cepat dan tidak ada pengulangan soal di tangga berikutnya.
- [ ] File yang berubah sudah di-deploy dan cache dibersihkan.

> Bank soal dan pemilihan anti-ulang ikut diuji di `tests/game-core.test.js`
> (jumlah soal, bentuk objek, bobot, jeda, dan riwayat antar-ronde). Ringkasan
> suite ada di [tests/README.md](../tests/README.md).

Lanjut ke [06 · Mekanik & Skor](06-mekanik-dan-skor.md).

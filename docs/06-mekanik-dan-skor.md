# 06 · Mekanik & Skor

Dokumen ini merangkum aturan permainan yang berlaku di mode solo maupun mabar.
Semua perhitungan berjalan di browser; server mabar hanya menyimpan dan
mengurutkan skor yang dikirim.

---

## 1. Siklus permainan

```
Mulai
  │  bank soal difilter + diacak
  ▼
Soal + 2 platform jawaban
  │
  ├─ jawaban BENAR ─► naik 1 tangga ─► +poin ─► soal baru (550 ms)
  │
  └─ jawaban SALAH ─► awan pecah ─► jatuh ─► soal baru (900 ms)
  │
  ▼
Timer habis ─► hasil akhir
```

Tidak ada batas jumlah tangga. Pemain terus naik sampai waktu habis.

---

## 2. Poin

Rumus jawaban benar:

```
poin = 100 + min(streak - 1, 5) × 20
```

- `streak` dihitung **setelah** jawaban benar tersebut.
- Bonus maksimal `5 × 20 = 100`.
- Poin maksimal per jawaban: **200**.

| Streak saat menjawab | Bonus | Poin |
|---:|---:|---:|
| 1 | 0 | 100 |
| 2 | +20 | 120 |
| 3 | +40 | 140 |
| 4 | +60 | 160 |
| 5 | +80 | 180 |
| 6+ | +100 | 200 |

Jawaban salah:

- Tidak mengurangi skor.
- `streak` langsung menjadi 0.
- Ketinggian tidak berubah.
- Karakter jatuh, lalu kembali ke platform aman terakhir.

---

## 3. Tangga, meter, dan zona

- Setiap jawaban benar menambah `floorLevel` sebanyak 1.
- Ketinggian yang ditampilkan = `floorLevel × 100` meter.
- Label **TANGGA n** di banner = `floorLevel + 1` (tangga yang sedang dituju).

| `floorLevel` | Meter | Zona |
|---:|---:|---|
| 0–3 | 0–300 | 🌱 Bumi & Rumput |
| 4–7 | 400–700 | ☁️ Langit Awan |
| 8–11 | 800–1.100 | 🌇 Atmosfer Senja |
| 12+ | 1.200+ | 🚀 Luar Angkasa! |

Latar langit bertransisi mengikuti posisi kamera, bukan langsung per tangga.

---

## 4. Waktu

| Mode | Pilihan | Perilaku |
|---|---|---|
| Solo | 120 / 180 / 300 detik | Hitung mundur |
| Solo | 9999 | Tanpa batas (`♾️`) |
| Admin mabar | 180 / 300 detik | Hitung mundur, cocok dengan opsi client |
| Admin mabar | 600 / 9000 | **Lihat catatan batasan di bawah** |

Logika client menganggap durasi `>= 9000` sebagai tanpa batas. Timer berhenti
saat `timeLeft` mencapai 0 dan modal hasil muncul.

### Batasan yang diketahui: opsi 10 menit & tanpa batas di admin

Menu solo hanya punya opsi `120`, `180`, `300`, dan `9999`. Saat admin memilih
**10 Menit** (`600`) atau **Tanpa Batas** (`9000`), client mencoba mengisi select
durasi dengan nilai yang tidak ada. Nilai select menjadi kosong, `parseInt`
menghasilkan `NaN`, dan timer tidak berjalan (efektif seperti tanpa batas).

Dampak praktis:

- **10 Menit** di panel admin saat ini **tidak** menghasilkan hitung mundur 10
  menit; permainan berjalan tanpa timer.
- **Tanpa Batas** juga berjalan tanpa timer (sesuai tujuan), meskipun lewat jalur
  `NaN`, bukan `9999`.

Jika butuh 10 menit yang benar-benar berhitung, gunakan 5 menit atau tambahkan
opsi `600`/`9000` yang konsisten di client (perubahan kode, di luar cakupan
dokumen ini).

---

## 5. Pengacakan soal

- Bank difilter berdasarkan `topic`, lalu diacak dengan Fisher–Yates.
- Satu soal selalu punya tepat satu jawaban benar dan satu pengecoh.
- Posisi jawaban benar diacak 50:50 antara kiri dan kanan.
- Saat pool habis, pool diacak ulang; soal bisa terulang.
- Di mabar, tiap tim mengacak sendiri sehingga urutan berbeda.
- Soal tetap sama secara konten; tidak ada pembagian soal dari server.

---

## 6. HUD

| Elemen | Sumber |
|---|---|
| Nama tim | Input menu, uppercase |
| Skor | Akumulasi poin |
| Ketinggian | `floorLevel × 100` + `m` |
| Badge zona | Threshold 4 / 8 / 12 |
| Timer | `mm:ss` atau `♾️` |
| Banner | Nomor tangga, emoji, teks soal |

---

## 7. Sinkronisasi skor di mabar

- Setiap perubahan HUD memicu pengiriman `score_update` (throttle ±400 ms).
- Payload: `{ type: 'score_update', score, floor, streak }`.
- Server:
  - Menolak update jika room belum `playing`.
  - Menolak update dari socket yang tidak terikat tim.
  - Meng-clamp `score` dan `floor` minimal 0 (streak tidak di-clamp).
  - Menyimpan nilai terakhir dan menyiarkan `leaderboard` terurut menurun.
- Tim yang disconnect lalu reconnect tanpa `rejoin` tidak akan lagi dianggap
  terikat tim, sehingga update-nya diabaikan.

Detail protokol: [08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md).

---

## 8. Perbedaan angka yang perlu diketahui

| Tempat | Yang ditampilkan | Arti sebenarnya |
|---|---|---|
| HUD ketinggian | `500m` | `floorLevel × 100` |
| Leaderboard VS | `5m` | **5 tangga**, bukan 5 meter |
| Leaderboard admin | `score` saja | Poin, tanpa ketinggian |
| Modal hasil | `X Meter (Tangga Y)` | Konsisten dengan HUD |

Ini murni perbedaan label tampilan; perhitungan skor tidak terpengaruh.

---

## 9. Ringkasan aturan

1. Jawaban benar = naik 1 tangga + 100–200 poin.
2. Jawaban salah = tidak turun tangga, tetapi kehilangan streak dan waktu.
3. Streak maksimal memberi bonus +100.
4. Waktu habis = permainan selesai; tidak ada kondisi menang absolut.
5. Mabar memakai soal dan durasi yang sama, tetapi progres tiap tim independen.
6. Server tidak menghitung pemenang; pemenang ditentukan dari leaderboard.

Kembali ke [05 · Menambah Soal](05-menambah-soal.md) atau lanjut ke
[07 · Deploy VPS](07-deploy-vps.md).

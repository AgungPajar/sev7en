# 06 · Mekanik & Skor

Dokumen ini merangkum aturan permainan yang berlaku di mode solo maupun mabar.
Semua perhitungan skor berjalan di browser; server mabar menyimpan, mengurutkan,
dan menghitung pemenang resmi di akhir ronde dari **ketinggian lalu skor** tiap tim.

> Catatan: konversi tampilan game dari Canvas 2D ke renderer 3D **tidak mengubah
> satu pun** angka, rumus, timing, atau aturan di dokumen ini. Kedalaman visual
> hanya memengaruhi lapisan gambar (lihat [10 · Renderer 3D](10-renderer-3d.md)).

---

## 1. Siklus permainan

```
Mulai
  │  bank soal tema tunggal + bobot anti-ulang
  ▼
Soal + 2 platform jawaban
  │
  ├─ jawaban BENAR ─► naik 1 tangga ─► +poin ─► soal baru (550 ms)
  │
  └─ jawaban SALAH ─► awan pecah ─► skor −50% (min 100) ─► jatuh 1 tangga (−100 m)
     ─► soal baru (900 ms)
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

- **Poin dipotong 50%** bila skor saat itu lebih dari 100:
  `skor baru = max(100, floor(skor × 0.5))`. Skor 0 tetap 0 dan skor tepat 100
  tetap 100 (tidak ada potongan). HUD langsung turun dan teks melayang `-N POIN`
  muncul bila memang ada potongan.
- `streak` langsung menjadi 0.
- Ketinggian turun **1 tangga = 100 m** dan pemain kembali ke platform aman
  sebelumnya; jika masih di tanah (0 m), pemain tetap di START.
- Karakter jatuh, lalu soal baru muncul setelah 900 ms.

Contoh potongan poin jawaban salah:

| Skor sebelum | Skor sesudah | Potongan |
|---:|---:|---:|
| 360 | 180 | −180 |
| 300 | 150 | −150 |
| 220 | 110 | −110 |
| 100 | 100 | 0 |
| 0 | 0 | 0 |

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
| Admin mabar | 600 / 9000 | 10 menit / tanpa batas; jam dihitung dari server |

Logika client menganggap durasi `>= 9000` sebagai tanpa batas. Timer berhenti
saat `timeLeft` mencapai 0 dan modal hasil muncul.

### Catatan: opsi 10 menit & tanpa batas

Menu solo hanya punya opsi `120`, `180`, `300`, dan `9999`. Di **mabar**, panel
admin boleh memilih **10 Menit** (`600`) atau **Tanpa Batas** (`9000`): nilai itu
dikirim server lewat `game_start` (`remaining`/`remainingMs`), dan client memakai
deadline dari server, jadi hitung mundur 10 menit di mabar berjalan benar meskipun
`<select>` lokal tidak punya opsi tersebut.

Kalau `startGame()` dipanggil tanpa jam server (mis. dari mode solo) dengan nilai
di luar opsi select, nilai select menjadi kosong, `parseInt` menghasilkan `NaN`,
dan timer lokal tidak berjalan (efektif seperti tanpa batas). Untuk solo, pakai
2/3/5 menit atau opsi Tanpa Batas yang tersedia.

---

## 5. Pemilihan soal (bobot + jeda anti-ulang)

- Bank soal sekarang **satu tema** (`living_room`, 50 soal). Pool difilter
  berdasarkan `topic` lalu diacak sekali dengan Fisher–Yates saat permainan
  dimulai.
- Setiap tangga memilih satu soal secara **berbobot** (bukan queue yang diacak
  ulang saat habis):
  - soal yang **belum pernah tampil** → bobot `1`;
  - soal yang **sudah tampil** → `0.03 × 0.20^(kemunculan − 1)`, yaitu 3% bobot
    soal baru dan turun ×0.20 setiap kemunculan berikutnya;
  - bila masih dalam **jeda 6 soal terakhir** → dikali `0.05` lagi;
  - bobot minimum `1e-6`, jadi peluang tidak pernah benar-benar nol.
- Efeknya: soal baru diprioritaskan, soal yang baru tampil tidak langsung muncul
  lagi di tangga berikutnya, dan soal lama tetap bisa muncul kembali setelah cukup
  lama. Seluruh 50 soal tetap dapat muncul dalam sesi panjang.
- Riwayat anti-ulang disimpan **per tab** dengan kunci `id` soal dan **bertahan
  antar ronde/rematch** di lobby yang sama; refresh halaman memulai riwayat baru.
- Satu soal selalu punya tepat satu jawaban benar dan satu pengecoh. Posisi
  jawaban benar diacak 50:50 antara kiri dan kanan.
- Di mabar, setiap tab punya riwayat dan urutan sendiri, jadi urutan antar tim
  berbeda. Soal tetap sama secara konten; tidak ada pembagian soal dari server.
- Menambah soal tidak mengubah skor per jawaban; lihat
  [05 · Menambah Soal](05-menambah-soal.md).

---

## 6. HUD

| Elemen | Sumber |
|---|---|
| Nama tim | Input menu, uppercase |
| Skor | Akumulasi poin |
| Ketinggian | `floorLevel × 100` + `m` |
| Badge zona | Threshold 4 / 8 / 12 |
| Timer | `mm:ss` atau `♾️` (di mabar mengikuti `remaining`/`remainingMs` dari server) |
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
  - Saat ronde berakhir (timer server atau tombol host), nilai terakhir dipakai
    untuk menghitung pemenang resmi dan klasemen (`game_end`).
- Tim yang disconnect lalu reconnect tanpa `rejoin` tidak akan lagi dianggap
  terikat tim, sehingga update-nya diabaikan.

Detail protokol: [08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md).

---

## 8. Format angka yang ditampilkan

| Tempat | Yang ditampilkan | Arti |
|---|---|---|
| HUD ketinggian | `500m` | `floorLevel × 100` |
| Leaderboard VS | `500 m · 520 pts` | ketinggian lebih dulu, lalu poin |
| Leaderboard admin | `500 m · 520 pts` | sama; urutannya ketinggian lalu poin |
| Modal hasil | `X Meter (Tangga Y)` | konsisten dengan HUD |

Leaderboard dan klasemen mengurutkan tim berdasarkan **ketinggian** lebih dulu,
baru poin. Ketinggian selalu ditampilkan dalam meter (`floor × 100`), tidak lagi
memakai label `5m` yang dulu berarti jumlah tangga.

---

## 9. Ringkasan aturan

1. Jawaban benar = naik 1 tangga + 100–200 poin.
2. Jawaban salah = skor dipotong 50% (minimum 100), turun 1 tangga (−100 m), dan
   kehilangan streak; di tanah tidak turun lagi.
3. Streak maksimal memberi bonus +100.
4. Waktu habis = permainan selesai; di solo tidak ada kondisi menang absolut.
5. Mabar memakai soal dan durasi yang sama, tetapi progres tiap tim independen.
6. Di mabar, server menghitung **pemenang resmi per ronde** dari keadaan terakhir
   (**ketinggian tertinggi → skor → nama**) dan mengirimnya lewat `game_end`; ronde
   berikutnya dimulai di lobby yang sama lewat **MAIN LAGI**.

Kembali ke [05 · Menambah Soal](05-menambah-soal.md) atau lanjut ke
[07 · Deploy VPS](07-deploy-vps.md).

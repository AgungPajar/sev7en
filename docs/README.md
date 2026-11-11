# Dokumentasi Sev7en Club — Star-Pou Sky Climber

Dokumentasi ini menjelaskan cara memakai, mengelola, menambah soal, dan men-deploy
game kuis Bahasa Inggris **Sev7en Club**. Game terdiri dari dua mode:

- **Solo** — latihan naik tangga awan di satu perangkat.
- **Mabar / VS** — maksimal **10 tim** bertanding lewat kode room 6 karakter, dengan
  leaderboard live.

> Catatan status: folder `tests/` sedang dalam pengerjaan (WIP) dan tidak dibahas
> di dokumentasi ini. Dokumentasi ini juga tidak mengubah kode tes.

---

## Peta dokumentasi

| Dokumen | Isi | Cocok untuk |
|---|---|---|
| [01 · Mulai Cepat](01-mulai-cepat.md) | Prasyarat, cara menjalankan di lokal, peta URL | Developer baru |
| [02 · Cara Main Solo](02-cara-main-solo.md) | Alur menu solo, kontrol, HUD, akhir permainan | Guru / siswa / operator |
| [03 · Panel Admin](03-panel-admin.md) | Password, buat room, bagikan kode, mulai mabar, memantau skor | Admin / host |
| [04 · Mabar Multiplayer](04-mabar-multiplayer.md) | Alur tim, join lobby, aturan, reconnect, batasan | Admin + tim |
| [05 · Menambah Soal](05-menambah-soal.md) | Struktur bank soal, cara menambah, topik baru, checklist | Developer / guru |
| [06 · Mekanik & Skor](06-mekanik-dan-skor.md) | Rumus poin, streak, zona ketinggian, timer | Semua |
| [07 · Deploy VPS](07-deploy-vps.md) | PM2, Nginx, WSS, environment, verifikasi | DevOps / maintainer |
| [08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md) | Peta file, model data, pesan WebSocket | Developer |
| [09 · Troubleshooting & FAQ](09-troubleshooting-faq.md) | Daftar error, gejala, solusi, pertanyaan umum | Semua |

---

## Mulai cepat (5 menit)

Butuh **Node.js 18+** dan dua terminal.

**Terminal 1 — server realtime mabar:**

```bash
cd vs-server
npm install
npm start
```

Server berjalan di `http://localhost:3001`, WebSocket di `ws://localhost:3001/ws`.

**Terminal 2 — file statis (game & admin):**

```bash
# dari root project
npx serve . -l 4173
```

Alternatif tanpa Node: `python -m http.server 4173`.

Lalu buka:

| Halaman | URL lokal |
|---|---|
| Landing / menu | `http://localhost:4173/` |
| Game solo | `http://localhost:4173/game.html` |
| Panel admin | `http://localhost:4173/admin/` |

**Password admin default:** `sev7en-admin`
(dapat diubah lewat environment `ADMIN_PASSWORD` di server).

### Demo alur mabar

1. Buka `/admin/`, isi password, pilih materi & durasi, klik **Buat Room**.
2. Salin **kode 6 huruf** atau **link** yang muncul.
3. Di perangkat tim, buka link tersebut, isi **nama tim**, lalu masuk lobby.
4. Setelah semua tim join, klik **MULAI MABAR** di panel admin.
5. Skor dan posisi tim tampil di leaderboard live.

---

## Yang perlu diketahui sejak awal

- **Soal masih hardcoded** di dalam file HTML. Belum ada CRUD soal di panel admin.
  Cara menambahnya ada di [05 · Menambah Soal](05-menambah-soal.md).
- **Tidak ada database.** Room, tim, dan skor hanya ada di memori server. Restart
  server atau menunggu 2 jam akan menghapus room.
- **Skor dikirim oleh browser tim** (client-authoritative). Cocok untuk kelas /
  kelompok tertutup, bukan kompetisi publik dengan hadiah.
- **Maksimal 10 tim per room**, dan tim hanya bisa join saat status room masih
  **lobby**.
- Panel admin bukan sistem login: halaman bisa dibuka siapa saja, tetapi membuat
  room memerlukan password yang benar.

---

## Struktur singkat project

```
sev7en/
├── index.html                  # Landing: solo, gabung room, panel admin
├── game.html                   # Game utama + mode mabar (VS)
├── star_pou_sky_climber.html   # Versi solo (tanpa blok VS)
├── star_pou_vs.html            # Duplikat lama game.html
├── admin/index.html            # Panel admin
├── vs-server/                  # Server WebSocket + PM2
├── docs/                       # Dokumentasi ini
└── tests/                      # WIP — tidak dibahas di sini
```

Mulai dari [01 · Mulai Cepat](01-mulai-cepat.md) jika baru pertama kali menjalankan
project ini.

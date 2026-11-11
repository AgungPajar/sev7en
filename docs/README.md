# Dokumentasi Sev7en Club — Star-Pou Sky Climber

Dokumentasi ini menjelaskan cara memakai, mengelola, menambah soal, dan men-deploy
game kuis Bahasa Inggris **Sev7en Club**. Game punya dua mode bermain, plus satu
mode tonton untuk admin:

- **Solo** — latihan naik tangga awan di satu perangkat.
- **Mabar / VS** — maksimal **10 tim** bertanding lewat kode room 6 karakter, dengan
  leaderboard live.
- **Tonton live (spectator)** — admin memantau semua tim sekaligus dari panel
  admin: satu kamera 3D per tim, lengkap dengan skor dan status online.

> Catatan status: world game kini dirender dalam **3D software** (Canvas 2D,
> tanpa WebGL/dependency) — lihat [10 · Renderer 3D](10-renderer-3d.md). Gameplay,
> skor, HUD, dan pesan VS lama tidak berubah. Suite unit test Node `tests/` lengkap;
> cara menjalankan dan cakupannya ada di [tests/README.md](../tests/README.md).

---

## Peta dokumentasi

| Dokumen | Isi | Cocok untuk |
|---|---|---|
| [01 · Mulai Cepat](01-mulai-cepat.md) | Prasyarat, cara menjalankan di lokal, peta URL | Developer baru |
| [02 · Cara Main Solo](02-cara-main-solo.md) | Alur menu solo, kontrol, HUD, akhir permainan | Guru / siswa / operator |
| [03 · Panel Admin](03-panel-admin.md) | Password, buat room, bagikan kode, mulai mabar, memantau skor, tonton live | Admin / host |
| [04 · Mabar Multiplayer](04-mabar-multiplayer.md) | Alur tim, join lobby, aturan, spectator, reconnect, batasan | Admin + tim |
| [05 · Menambah Soal](05-menambah-soal.md) | Struktur bank soal, cara menambah, topik baru, checklist | Developer / guru |
| [06 · Mekanik & Skor](06-mekanik-dan-skor.md) | Rumus poin, streak, zona ketinggian, timer | Semua |
| [07 · Deploy VPS](07-deploy-vps.md) | PM2, Nginx, WSS, environment, verifikasi | DevOps / maintainer |
| [08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md) | Peta file, model data, pesan WebSocket, telemetri spectator, rendering klien | Developer |
| [09 · Troubleshooting & FAQ](09-troubleshooting-faq.md) | Daftar error, gejala, solusi, pertanyaan umum | Semua |
| [10 · Renderer 3D](10-renderer-3d.md) | Renderer 3D software: kamera, proyeksi, zona, geometri, performa | Developer |

---

## Mulai cepat (1 menit)

Cara tercepat: **Bun**, satu proses untuk file statis + WebSocket.

```bash
bun run start          # dari root project
```

Buka `http://localhost:3001/`. Tidak perlu `npm install` dan tidak perlu
terminal kedua. Alternatif tanpa memasang Bun: `docker compose up -d --build`
(lihat [DOCKER.md](../DOCKER.md)).

Masih memakai **Node 18+** (dua proses: server WS + server statis)? Ikuti
[01 · Mulai Cepat](01-mulai-cepat.md).

| Halaman | URL (Bun / Docker) |
|---|---|
| Landing / menu | `http://localhost:3001/` |
| Game solo + mabar | `http://localhost:3001/game.html` |
| Tonton live (spectator) | `http://localhost:3001/game.html?code=<KODE>&spectate=1` |
| Panel admin | `http://localhost:3001/admin/` |
| Health check | `http://localhost:3001/health` |

**Password admin default:** `sev7en-admin`
(dapat diubah lewat environment `ADMIN_PASSWORD` di server).

Ringkasan alur permainan (solo, mabar, reconnect) ada di
[README utama](../README.md#alur-permainan).

### Demo alur mabar

1. Buka `/admin/`, isi password, pilih materi & durasi, klik **Buat Room**.
2. Salin **kode 6 huruf** atau **link** yang muncul.
3. Di perangkat tim, buka link tersebut, isi **nama tim**, lalu masuk lobby.
4. Setelah semua tim join, klik **MULAI MABAR** di panel admin.
5. Skor dan posisi tim tampil di leaderboard live.
6. Klik **🔴 Tonton Live** di panel admin untuk menonton semua tim sekaligus
   (satu kamera per tim). Detail kontrol dan troubleshooting ada di
   [03 · Panel Admin §6](03-panel-admin.md).

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
├── star_pou_vs.html            # Duplikat lama game.html (harus identik)
├── admin/index.html            # Panel admin
├── vs-server/                  # Server WebSocket (Bun native / Node + ws)
├── tools/                      # Spesifikasi renderer 3D + harness screenshot
├── Dockerfile                  # Image produksi (Bun alpine)
├── docs/                       # Dokumentasi ini
└── tests/                      # Unit test Node (node:test)
```

Mulai dari [01 · Mulai Cepat](01-mulai-cepat.md) jika baru pertama kali menjalankan
project ini.

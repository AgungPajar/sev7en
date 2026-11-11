# 01 · Mulai Cepat (Menjalankan di Lokal)

Panduan ini untuk developer atau operator yang baru pertama kali menjalankan
Sev7en Club di komputer sendiri. Estimasi 5–10 menit.

---

## 1. Prasyarat

| Kebutuhan | Keterangan |
|---|---|
| Node.js 18+ | Dipakai server mabar (`ws`) dan `npx serve` |
| Browser modern | Chrome / Edge / Firefox terbaru |
| Dua terminal | Satu untuk server, satu untuk file statis |
| Port 3001 | Untuk WebSocket server mabar |
| Port 4173 (contoh) | Untuk file statis HTML |

Game **solo** secara teknis bisa dibuka dengan double-click `game.html`, tetapi
**mode mabar tidak bisa** dan landing memakai path absolut (`/game.html`,
`/admin/`). Karena itu selalu jalankan lewat server statis.

---

## 2. Struktur dua bagian

Project ini punya dua bagian yang harus jalan bersamaan untuk mabar:

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  File statis (HTML/CSS/JS)  │        │  vs-server (Node + ws)       │
│  index / game / admin       │◄──────►│  Room, tim, skor, leaderboard│
│  port 4173 (contoh)         │  WS    │  port 3001, path /ws         │
└─────────────────────────────┘        └──────────────────────────────┘
```

- **Solo**: hanya butuh file statis.
- **Mabar**: butuh file statis + `vs-server`.

---

## 3. Jalankan server mabar

```bash
cd vs-server
npm install
npm start
```

Output yang diharapkan:

```
sev7en-vs WS on :3001/ws  admin pass=sev***  maxTeams=10
```

Cek server hidup:

```bash
curl http://localhost:3001/health
# {"ok":true,"rooms":0}
```

### Konfigurasi environment

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3001` | Port HTTP + WebSocket |
| `ADMIN_PASSWORD` | `sev7en-admin` | Password untuk `create_room` |

Contoh PowerShell:

```powershell
$env:PORT=3001
$env:ADMIN_PASSWORD="password-rahasia-sekolah"
npm start
```

Contoh bash/Linux:

```bash
PORT=3001 ADMIN_PASSWORD="password-rahasia-sekolah" npm start
```

> **Penting:** file `vs-server/.env.example` hanya contoh. Server **tidak**
> memuat file `.env` otomatis (tidak ada `dotenv`). Set environment lewat shell,
> PM2, atau Docker. Lihat [07 · Deploy VPS](07-deploy-vps.md).

---

## 4. Jalankan file statis

Dari **root project** (bukan dari dalam `vs-server`):

```bash
npx serve . -l 4173
```

Alternatif:

```bash
python -m http.server 4173
```

Lalu buka `http://localhost:4173/`.

> Jangan membuka `index.html` lewat `file://`. Path seperti `/admin/` dan
> `/game.html` akan gagal, dan WebSocket tidak akan terhubung.

---

## 5. Peta URL

| Halaman | URL | Keterangan |
|---|---|---|
| Landing | `/` | Tiga pilihan: solo, gabung room, admin |
| Solo / game | `/game.html` | Game utama; juga menangani join mabar |
| Panel admin | `/admin/` | Buat room & pantau leaderboard |
| Gabung via link | `/game.html?code=ABC123#join` | Buka dialog join, kode terisi |
| Gabung otomatis | `/game.html?code=ABC123&team=NAMA#join` | Kode + nama → langsung join |
| Health check | `http://localhost:3001/health` | Status server + jumlah room |

Di lokal, client otomatis memakai:

```
ws://localhost:3001/ws
```

Di production, client memakai path `wss://domain-anda/vs-ws` (lihat
[07 · Deploy VPS](07-deploy-vps.md)).

---

## 6. Uji cepat semua fitur

1. **Solo** — buka `/game.html`, isi nama tim, pilih materi, klik
   **MULAI NAIK TANGGA**. Jawab dengan panah kiri/kanan. Pastikan skor naik.
2. **Admin** — buka `/admin/`, isi password `sev7en-admin`, buat room. Pastikan
   kode 6 huruf muncul.
3. **Tim** — buka link room di tab lain (boleh browser berbeda), isi nama tim,
   masuk lobby. Panel admin harus menampilkan tim tersebut.
4. **Mulai** — klik **MULAI MABAR**. Kedua tab harus mulai bermain dan
   leaderboard muncul.
5. **Join ditolak** — coba join lagi setelah game mulai; harus muncul
   `Room sudah mulai`.

---

## 7. Menghentikan dan mereset

- **Stop server**: `Ctrl + C` di terminal server.
- **Reset semua room**: restart server (`Ctrl + C`, lalu `npm start`). Semua room
  dan skor hilang karena data hanya di memori.
- **Reset satu room**: tidak ada tombol hapus room. Buat room baru; room lama
  hilang otomatis setelah 2 jam (TTL) atau saat server restart.

---

## 8. Jebakan umum di lokal

| Gejala | Penyebab | Solusi |
|---|---|---|
| Panel admin merah “Terputus” | Server `vs-server` belum jalan | Jalankan `npm start` di `vs-server` |
| Klik Buat Room tidak bereaksi | WebSocket gagal dibuka | Cek port 3001 dan console browser |
| `404` saat buka `/admin/` | Server statis dijalankan dari folder salah | Jalankan dari root project |
| Halaman tampil tanpa style | Font/Lucide diblokir offline | Kosmetik saja; game tetap jalan |
| Join mabar gagal di `file://` | Origin tidak valid untuk WS | Pakai `http://localhost:4173` |
| Password ditolak | Password server bukan default | Cek `ADMIN_PASSWORD` di proses server |

Lanjut ke [02 · Cara Main Solo](02-cara-main-solo.md) atau
[03 · Panel Admin](03-panel-admin.md).

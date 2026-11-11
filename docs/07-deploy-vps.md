# 07 · Deploy ke VPS

Panduan ini menjelaskan deploy dua bagian Sev7en Club ke VPS Linux dengan
**Nginx + PM2**. Contoh domain: `sev7en.cerap.web.id`.

---

## 1. Topologi production

```
Internet
   │  HTTPS / WSS
   ▼
┌───────────────────────────────┐
│ Nginx (443)                   │
│  /            → file statis   │
│  /game.html   → file statis   │
│  /admin/      → file statis   │
│  /vs-ws       → 127.0.0.1:3001│  (WebSocket)
└───────────────────────────────┘
              │
              ▼
┌───────────────────────────────┐
│ PM2: sev7en-vs (Node)          │
│ HTTP + WS di :3001, path /ws   │
└───────────────────────────────┘
```

Yang perlu tersedia di VPS:

- Node.js 18+
- `npm`
- PM2 (`npm i -g pm2`)
- Nginx
- Sertifikat TLS (mis. Certbot / Cloudflare)

---

## 2. File mana yang di-deploy?

### File statis

| File/folder | Tujuan |
|---|---|
| `index.html` | Landing page |
| `game.html` | Game utama + mabar |
| `admin/index.html` | Panel admin |
| `star_pou_sky_climber.html` | Opsional, versi solo |
| `star_pou_vs.html` | Opsional, duplikat lama |

Contoh ke `/var/www/sev7en`:

```bash
rsync -av index.html game.html admin/ root@IP_VPS:/var/www/sev7en/
```

### Server mabar

| File | Tujuan |
|---|---|
| `vs-server/server.js` | Aplikasi |
| `vs-server/package.json` | Dependensi |
| `vs-server/package-lock.json` | Lockfile |
| `vs-server/ecosystem.config.cjs` | Konfigurasi PM2 |

```bash
rsync -av --exclude node_modules vs-server/ root@IP_VPS:/opt/sev7en/vs-server/
```

---

## 3. Menjalankan server dengan PM2

Di VPS:

```bash
cd /opt/sev7en/vs-server
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Cek status dan log:

```bash
pm2 status
pm2 logs sev7en-vs
curl http://127.0.0.1:3001/health
```

### Mengatur password admin

`ecosystem.config.cjs` saat ini berisi:

```js
module.exports = { apps: [{ name: 'sev7en-vs', script: 'server.js', env: { PORT: 3001, ADMIN_PASSWORD: 'sev7en-admin' } }] };
```

Ubah `ADMIN_PASSWORD` sebelum dipakai publik, lalu muat ulang konfigurasi:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Alternatif: set environment lewat shell PM2, tetapi **jangan** mengandalkan file
`.env`, karena server tidak memuat `.env` otomatis. `vs-server/.env.example`
hanya dokumentasi contoh.

| Variabel | Default | Wajib diubah? |
|---|---|---|
| `PORT` | `3001` | Tidak, kecuali bentrok |
| `ADMIN_PASSWORD` | `sev7en-admin` | **Ya, untuk production** |

Catatan: `MAX_TEAMS = 10`, TTL room 2 jam, dan interval cleanup 10 menit adalah
konstanta di `server.js`, bukan environment.

---

## 4. Konfigurasi Nginx

### 4.1 Situs statis

```nginx
server {
    listen 443 ssl http2;
    server_name sev7en.cerap.web.id;

    root /var/www/sev7en;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # WebSocket mabar
    location /vs-ws {
        proxy_pass http://127.0.0.1:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### 4.2 PENTING — path WebSocket harus cocok

Client production membuka:

```
wss://domain/vs-ws
```

Server mendengarkan path:

```
/ws
```

Artinya Nginx **harus memetakan** `/vs-ws` → `/ws`. Perhatikan baris:

```nginx
proxy_pass http://127.0.0.1:3001/ws;
```

Adanya `/ws` di akhir `proxy_pass` membuat prefix `/vs-ws` diganti menjadi
`/ws`.

Snippet `nginx-vs-snippet.conf` di repo **tidak** memakai `/ws` di akhir:

```nginx
proxy_pass http://127.0.0.1:3001;   # meneruskan /vs-ws apa adanya
```

Jika dipakai apa adanya, server menerima `/vs-ws` dan menolak upgrade karena
path-nya bukan `/ws`. Gejalanya: WebSocket gagal, browser mencatat handshake
`400`, panel admin terus “Terputus”.

Pilih salah satu solusi:

**A. Perbaiki Nginx (disarankan, client tidak berubah):**

```nginx
location /vs-ws {
    proxy_pass http://127.0.0.1:3001/ws;
    # ...header upgrade lainnya...
}
```

**B. Ubah client dan server agar sama-sama `/ws`:**

- Ubah `VS.getWsUrl()` di `game.html` dan `WS_URL` di `admin/index.html` menjadi
  `/ws`.
- Ubah `location` Nginx menjadi `/ws`.
- Ini menyentuh client dan berpotensi menyentuh tes (folder `tests` WIP), jadi
  opsi A lebih aman.

### 4.3 Verifikasi setelah reload

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -i http://127.0.0.1:3001/health
```

Lalu buka panel admin di browser dan pastikan indikator hijau
“Terhubung ke server realtime”. Di DevTools → Network → WS, status harus
`101 Switching Protocols`.

---

## 5. HTTPS dan WSS

- Jika halaman dibuka via `https://`, WebSocket **wajib** `wss://`. Client sudah
  otomatis memilih `wss:` saat `location.protocol === 'https:'`.
- Jangan mencampur halaman HTTPS dengan `ws://` — browser akan memblokir
  (mixed content).
- Pastikan sertifikat mencakup domain yang dipakai.
- Jika memakai Cloudflare, aktifkan WebSocket dan biarkan TLS terminate di
  Cloudflare atau origin, selama `Upgrade` diteruskan.

---

## 6. Update aplikasi

### Update file statis

```bash
rsync -av index.html game.html admin/ root@IP_VPS:/var/www/sev7en/
```

Jika memakai cache, lakukan purge atau minta pengguna hard refresh
(`Ctrl + F5`).

### Update server

```bash
rsync -av --exclude node_modules vs-server/ root@IP_VPS:/opt/sev7en/vs-server/
ssh root@IP_VPS 'cd /opt/sev7en/vs-server && npm ci --omit=dev && pm2 startOrReload ecosystem.config.cjs && pm2 save'
```

Restart server akan **menghapus semua room aktif** karena data hanya di memori.
Jadwalkan di luar jam pemakaian.

---

## 7. Rollback

- Simpan rilis sebelumnya (git tag / folder ber-tanggal).
- Untuk file statis: salin kembali versi lama.
- Untuk server: checkout versi lama, `npm ci`, lalu
  `pm2 restart sev7en-vs`.
- Jika perubahan hanya soal, rollback cukup mengganti file HTML.

---

## 8. Deploy script lama (`deploy-vs.ps1`)

File `deploy-vs.ps1` di root adalah **skrip lama/legacy**, bukan alur deploy utama.
Isinya:

- Path hardcoded ke `E:/Dev/Projek B Inggris/star_pou_vs.html`.
- Path SSH milik mesin pengembang tertentu.
- Port SSH `20301`.
- Hanya menyalin satu file HTML ke `/tmp` di VPS.
- Tidak menjalankan `npm install`, PM2, atau Nginx reload.

Jangan jadikan patokan. Gunakan langkah `rsync` + PM2 di atas, atau tulis ulang
skrip sesuai lingkungan Anda.

---

## 9. Checklist production

- [ ] `ADMIN_PASSWORD` sudah diganti dari `sev7en-admin`.
- [ ] Port `3001` tidak terbuka bebas ke internet; akses lewat Nginx.
- [ ] `location /vs-ws` memetakan ke `/ws`.
- [ ] Header `Upgrade` dan `Connection` diteruskan.
- [ ] `proxy_read_timeout` cukup panjang (mis. 3600s).
- [ ] HTTPS aktif dan client memakai `wss://`.
- [ ] `curl /health` di server merespons `{"ok":true,...}`.
- [ ] WebSocket menghasilkan status `101`.
- [ ] Panel admin bisa membuat room.
- [ ] Satu tim bisa join dan skor muncul di leaderboard.
- [ ] `pm2 save` dan `pm2 startup` sudah dijalankan.
- [ ] Log PM2 dipantau (`pm2 logs sev7en-vs`).
- [ ] Backup file statis dan konfigurasi Nginx tersedia.

---

## 10. Monitoring sederhana

```bash
# health
curl -s http://127.0.0.1:3001/health

# proses
pm2 status

# log realtime
pm2 logs sev7en-vs --lines 100

# port
ss -ltnp | grep 3001
```

Health endpoint hanya melaporkan `{ ok, rooms }`; tidak ada metrik historis.
Untuk kebutuhan audit, tambahkan log terpisah di masa depan.

Lanjut ke [08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md) atau
[09 · Troubleshooting & FAQ](09-troubleshooting-faq.md).

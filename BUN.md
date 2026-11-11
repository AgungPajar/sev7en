# Menjalankan sev7en dengan Bun

Game ini statis (HTML/JS) + satu server WebSocket untuk mode VS. Runtime Bun
menggantikan Node **dan** web server terpisah: satu proses menyajikan file game
sekaligus endpoint WebSocket.

## Prasyarat

- [Bun](https://bun.sh) 1.1+ (`bun --version`)
- Node 22+ hanya jika masih ingin memakai runtime lama

## Menjalankan

Dari root project:

```bash
bun run start       # produksi, http://localhost:3001
bun run dev         # watch mode (auto-restart saat file server berubah)
```

Atau dari folder server:

```bash
cd vs-server
bun run start:bun
bun run dev:bun
```

Buka `http://localhost:3001/` untuk landing page, `http://localhost:3001/game.html`
untuk game, dan `http://localhost:3001/admin/` untuk panel admin.

### Environment

| Variabel         | Default          | Keterangan                        |
| ---------------- | ---------------- | --------------------------------- |
| `PORT`           | `3001`           | Port HTTP + WebSocket             |
| `ADMIN_PASSWORD` | `sev7en-admin`   | Password untuk membuat room VS    |
| `NODE_ENV`       | –                | `production` mematikan dev mode   |

Contoh PowerShell:

```powershell
$env:PORT=8080; $env:ADMIN_PASSWORD='rahasia'; bun run start
```

## Endpoint

| Path       | Fungsi                                                        |
| ---------- | ------------------------------------------------------------- |
| `/`        | Landing page (`index.html`)                                    |
| `/game.html`, `/star_pou_vs.html` | Game (VS)                              |
| `/star_pou_sky_climber.html` | Build solo                                  |
| `/admin/`  | Panel admin                                                   |
| `/design/` | Aset desain                                                   |
| `/ws`      | WebSocket (akses langsung / dev)                              |
| `/vs-ws`   | WebSocket (path produksi lewat nginx)                         |
| `/health`  | `{"ok":true,"rooms":N}`                                       |

Static server memakai allowlist: hanya file game di root, folder `admin/`, dan
`design/`. Source server, `node_modules`, `.git`, dotfiles, dan path traversal
selalu `404`.

## Deploy dengan pm2 (Bun)

```bash
cd vs-server
pm2 start ecosystem.bun.config.cjs
pm2 save
```

`ecosystem.bun.config.cjs` memakai `interpreter: 'bun'` dan `NODE_ENV=production`.

## Nginx

Sama seperti versi Node — proxy `/vs-ws` ke port 3001 (lihat
`nginx-vs-snippet.conf`):

```nginx
location /vs-ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## Test

```bash
bun run test:bun          # dari root
cd vs-server && bun test  # dari folder server
```

Test mencakup static allowlist, `/health`, alur room lengkap (create → join →
start → score → finish → end), rejoin, dan WebSocket lewat `/ws` maupun
`/vs-ws`.

## Client WebSocket

`getWsUrls()` di `game.html`, `star_pou_vs.html`, dan `admin/index.html`
mencoba endpoint secara berurutan sampai ada yang tersambung:

1. `ws(s)://host:port/ws` — saat halaman dan server WS satu origin
   (termasuk akses LAN dari HP)
2. `ws://localhost:3001/ws` — saat halaman dibuka via `file://` atau static
   server terpisah (Live Server, `python -m http.server`, dll.)
3. `ws(s)://host:3001/ws` lalu `ws(s)://host/vs-ws` — akses LAN dengan static
   server di port lain, lalu path produksi nginx

Saat koneksi putus, client otomatis reconnect dan mengirim `rejoin` (tim) atau
`rejoin_host` (host), jadi tim tidak perlu join ulang dan room tetap sinkron.
Jika game sudah berjalan, server mengirim ulang `game_start` agar tim yang
reconnect langsung masuk kembali.

## Troubleshooting WS

| Gejala | Penyebab umum | Solusi |
| --- | --- | --- |
| `Tidak bisa konek ke server WS` | Server belum jalan / port beda | Jalankan `bun run start`, cek `http://localhost:3001/health` |
| Tim saling tidak terlihat | Satu client memakai server/room berbeda | Pastikan keduanya membuka origin yang sama dan kode room benar |
| HP tidak bisa join lewat link `localhost` | Link dibagikan dari host yang membuka `localhost` | Buka game dari host lewat IP LAN, mis. `http://192.168.1.10:3001/game.html` |
| WS putus saat edit file | `bun run dev` me-restart server | Pakai `bun run start` saat bermain |

## Runtime Node (fallback)

```bash
npm --prefix vs-server install
npm run start:node
# atau: cd vs-server && npm start
```

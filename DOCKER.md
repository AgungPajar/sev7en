# Menjalankan sev7en dengan Docker

Image-nya sengaja dibuat kecil: **satu proses** menyajikan file game statis
**dan** WebSocket VS, tanpa dependency npm, tanpa `node_modules`, dan tanpa
tahap build.

| Item | Nilai |
| --- | --- |
| Base image | `oven/bun:1-alpine` (musl, varian resmi paling kecil) |
| Layer aplikasi | **±216 KB** (11 file) |
| Dependency npm | **0** — server hanya memakai modul `node:` |
| User di container | non-root (`1000:1000`) |
| Root filesystem | read-only (room disimpan di memori) |

## Build

```bash
docker build -t sev7en .
```

Tidak ada `RUN npm install`, jadi build hanya butuh beberapa detik dan tidak
perlu akses registry npm.

## Jalan cepat

```bash
docker run -d --name sev7en \
  -p 3001:3001 \
  -e ADMIN_PASSWORD=rahasia \
  --restart unless-stopped \
  sev7en
```

Buka `http://localhost:3001/` (landing), `/game.html` (game VS), `/admin/`
(panel admin).

## Docker Compose (disarankan)

```bash
docker compose up -d --build     # build + jalan di background
docker compose logs -f           # lihat log
docker compose down              # stop + hapus container
```

Konfigurasi lewat `.env` di root project (dibaca otomatis oleh Compose):

```bash
cp .env.example .env    # lalu edit bila perlu
```

```dotenv
HOST_PORT=3001
ADMIN_PASSWORD=rahasia
```

Atau sekali jalan tanpa file:

```bash
ADMIN_PASSWORD=rahasia HOST_PORT=8080 docker compose up -d --build
```

## Environment

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3001` | Port di dalam container |
| `ADMIN_PASSWORD` | `sev7en-admin` | Password untuk membuat room VS |
| `NODE_ENV` | `production` | Mematikan dev mode Bun (tanpa error page verbose) |
| `HOST_PORT` | `3001` | Hanya Compose: port di host yang dipetakan ke `3001` |

`PORT` sebaiknya dibiarkan `3001` di dalam container; untuk mengubah port yang
diakses dari luar, pakai `HOST_PORT` agar pemetaan dan healthcheck tetap valid.

## Akses dari perangkat lain (LAN)

1. Jalankan container dengan port yang dipetakan ke host (default `3001`).
2. Cek IP host, mis. `ipconfig` → `192.168.100.17`.
3. Buka `http://192.168.100.17:3001/game.html` **dari host** dulu, supaya link
   yang dibagikan tombol "copy link" memakai IP LAN, bukan `localhost`.
4. Kalau perangkat lain tidak bisa connect padahal `http://localhost:3001/health`
   jalan, izinkan **Docker Desktop / vEthernet (WSL)** di Windows Firewall —
   Docker Desktop mem-proxy port lewat prosesnya sendiri, bukan lewat `bun`.

## Healthcheck

Image sudah punya `HEALTHCHECK` ke `/health` (interval 30s):

```bash
docker inspect --format '{{.State.Health.Status}}' sev7en
curl http://localhost:3001/health     # {"ok":true,"rooms":N}
```

## Kenapa tidak bloated

- **Tanpa dependency** → tidak ada `node_modules` dan tidak ada layer install.
  `vs-server/package.json` hanya dipakai runtime Node lama (paket `ws`), jadi
  tidak ikut ke image.
- **Alpine** → base terkecil yang resmi untuk Bun.
- **`.dockerignore` ketat** → konteks build tidak membawa `.git`, `tests/`,
  `docs/`, `design` mentah, atau file deploy lain.
- **COPY eksplisit** → hanya 11 file yang benar-benar bisa disajikan server
  (allowlist static) plus kode server. Source, test, dan dokumen tidak ada di
  dalam image, jadi tidak bisa bocor lewat HTTP.
- **Read-only rootfs + non-root + log rotation** → tidak ada pertumbuhan disk
  diam-diam.

Kalau ingin lebih kecil lagi, satu-satunya cara adalah mengganti runtime
(bukan file project): pakai base image Bun yang di-pin, mis.
`FROM oven/bun:1.4.4-alpine`, agar tidak ada perubahan tak terduga.

## Catatan operasional

- **State di memori**: `docker compose restart` / `down` menghapus semua room.
  Pemain cukup join ulang (client otomatis reconnect + `rejoin` selama proses
  hidup).
- **Jangan scale >1 replika** tanpa sticky session: room tidak dibagi antar
  container.
- **HTTPS / domain**: taruh reverse proxy (nginx/Caddy) di depan container,
  teruskan `/ws` dan `/vs-ws`. Contoh nginx ada di `nginx-vs-snippet.conf`
  (ganti `127.0.0.1:3001` dengan alamat container).
- **Multi-arch** (mis. VPS ARM):

  ```bash
  docker buildx build --platform linux/amd64,linux/arm64 -t sev7en .
  ```

## Troubleshooting

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `port is already allocated` | Port host dipakai proses lain (mis. `bun run start`) | Hentikan proses itu atau pakai `HOST_PORT=8080` |
| Container `unhealthy` | Server gagal start (port/password salah) | `docker compose logs` |
| `read-only file system` | Ada kode baru yang menulis ke disk | Hapus `read_only: true` di `docker-compose.yml` |
| Tim tidak saling terlihat | Host dan tim membuka origin/server berbeda | Pastikan semua memakai URL container yang sama |
| WS gagal di balik proxy | Header upgrade tidak diteruskan | Tambahkan `proxy_set_header Upgrade/Connection` (lihat snippet nginx) |

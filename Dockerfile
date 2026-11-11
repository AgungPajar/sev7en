# syntax=docker/dockerfile:1

# sev7en — static game + Bun WebSocket server in one process.
#
# Kenapa image-nya kecil:
#   * Tidak ada dependency npm sama sekali (server hanya pakai modul `node:`),
#     jadi TIDAK ada layer `npm/bun install` dan tidak ada node_modules.
#   * Base image Alpine (musl) — varian resmi Bun paling kecil.
#   * Hanya file runtime yang di-COPY (server + file yang boleh disajikan).
#
# Ukuran lapisan aplikasi: ~215 KB. Sisanya murni runtime Bun.
FROM oven/bun:1-alpine

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

# 1000:1000 = user `bun` bawaan image resmi.
COPY --chown=1000:1000 package.json ./
COPY --chown=1000:1000 vs-server/config.js vs-server/room-manager.js vs-server/server.bun.js ./vs-server/
COPY --chown=1000:1000 index.html game.html star_pou_vs.html star_pou_sky_climber.html ./
COPY --chown=1000:1000 admin/ ./admin/
COPY --chown=1000:1000 design/ ./design/

# Non-root. HOME diarahkan ke /tmp supaya aman saat rootfs read-only.
ENV HOME=/tmp
USER 1000:1000

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1

CMD ["bun", "vs-server/server.bun.js"]

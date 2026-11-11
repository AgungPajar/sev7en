// vs-server/server.bun.js — Bun-native runtime for Star-Pou VS
// Run: bun run server.bun.js   (port 3001 default)
// Serves the static game files AND the WebSocket endpoint(s) from one process.
//   - Static: /, /game.html, /star_pou_sky_climber.html, /star_pou_vs.html, /admin/, /design/
//   - WS:     /ws (dev/local) and /vs-ws (production nginx path)
//   - Health: /health

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, ADMIN_PASSWORD } from './config.js';
import { RoomManager, MAX_TEAMS, ROOM_TTL_MS } from './room-manager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PUBLIC_FILES = new Set([
  'index.html',
  'game.html',
  'star_pou_sky_climber.html',
  'star_pou_vs.html',
]);
const PUBLIC_DIRS = new Set(['admin', 'design']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * Resolve a URL path to a file inside the public allowlist.
 * Returns null for anything outside the game/admin/design surface
 * (server sources, tests, node_modules, .git, dotfiles, traversal, ...).
 */
export function resolvePublicPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;

  decoded = decoded.replace(/\\/g, '/');
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  if (decoded.endsWith('/')) decoded += 'index.html';

  const segments = decoded.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (segments.length === 1 && PUBLIC_DIRS.has(segments[0])) segments.push('index.html');

  const rel = segments.join('/');
  const isRootFile = PUBLIC_FILES.has(rel);
  const isPublicDirFile = PUBLIC_DIRS.has(segments[0]) && segments.length >= 2;
  if (!isRootFile && !isPublicDirFile) return null;

  const abs = path.resolve(ROOT, ...segments);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

async function serveStatic(pathname, head = false) {
  const filePath = resolvePublicPath(pathname);
  if (!filePath) return notFound();

  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();

  const headers = {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  };
  return head ? new Response(null, { status: 200, headers }) : new Response(file, { headers });
}

export function createBunServer(options = {}) {
  const config = {
    port: options.port ?? PORT,
    hostname: options.hostname ?? '0.0.0.0',
    adminPassword: options.adminPassword ?? ADMIN_PASSWORD,
    maxTeams: options.maxTeams ?? MAX_TEAMS,
    roomTtlMs: options.roomTtlMs ?? ROOM_TTL_MS,
    cleanupIntervalMs: options.cleanupIntervalMs ?? 10 * 60 * 1000,
    development: options.development ?? process.env.NODE_ENV !== 'production',
  };

  const manager = new RoomManager({
    adminPassword: config.adminPassword,
    maxTeams: config.maxTeams,
    roomTtlMs: config.roomTtlMs,
  });
  const connections = new WeakMap();

  const cleanupTimer = setInterval(() => manager.cleanup(), config.cleanupIntervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();

  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    development: config.development,

    fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === '/ws' || url.pathname === '/vs-ws') {
        const id = Math.random().toString(36).slice(2, 9);
        if (srv.upgrade(req, { data: { id } })) return;
        return new Response('WebSocket upgrade required', { status: 426 });
      }

      if (url.pathname === '/health') {
        return Response.json({ ok: true, rooms: manager.rooms.size });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }

      return serveStatic(url.pathname, req.method === 'HEAD');
    },

    websocket: {
      open(ws) {
        const conn = manager.createConnection(ws, ws.data?.id);
        connections.set(ws, conn);
      },
      message(ws, message) {
        const conn = connections.get(ws);
        if (conn) manager.handleMessage(conn, message);
      },
      close(ws) {
        const conn = connections.get(ws);
        if (conn) {
          manager.onClose(conn);
          connections.delete(ws);
        }
      },
    },
  });

  function stop() {
    clearInterval(cleanupTimer);
    try { server.stop(true); } catch {}
  }

  return {
    server,
    manager,
    config,
    stop,
    get port() { return server.port; },
    get rooms() { return manager.rooms; },
    cleanupNow: () => manager.cleanup(),
  };
}

if (import.meta.main) {
  const app = createBunServer();
  console.log(`sev7en-vs (Bun) on http://${app.config.hostname}:${app.port}  static + WS /ws & /vs-ws  admin pass=${app.config.adminPassword.slice(0, 3)}***  maxTeams=${app.config.maxTeams}`);
  const shutdown = () => { app.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

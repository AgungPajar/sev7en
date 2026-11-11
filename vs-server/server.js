// vs-server/server.js — Node adapter for Star-Pou VS (Realtime)
// Run: npm i && node server.js   (port 3001 default, WS at /ws)
// Or with Bun: bun server.bun.js (native Bun.serve + static files)
// Deploy di VPS 103.147.32.29 via pm2: pm2 start server.js --name sev7en-vs

import http from 'http';
import { pathToFileURL } from 'url';
import { WebSocketServer } from 'ws';
import { PORT, ADMIN_PASSWORD } from './config.js';
import {
  CODE_CHARS,
  MAX_TEAMS,
  ROOM_TTL_MS,
  genCode,
  roomPublic,
  broadcast,
  cleanupRooms,
  sanitizePlayerState,
  RoomManager,
} from './room-manager.js';

export { PORT, ADMIN_PASSWORD, CODE_CHARS, MAX_TEAMS, ROOM_TTL_MS, genCode, roomPublic, broadcast, cleanupRooms, sanitizePlayerState, RoomManager };

export function createVsServer(options = {}) {
  const config = {
    port: options.port ?? PORT,
    adminPassword: options.adminPassword ?? ADMIN_PASSWORD,
    maxTeams: options.maxTeams ?? MAX_TEAMS,
    roomTtlMs: options.roomTtlMs ?? ROOM_TTL_MS,
    cleanupIntervalMs: options.cleanupIntervalMs ?? 10 * 60 * 1000,
    host: options.host ?? '0.0.0.0',
  };

  const manager = new RoomManager({
    adminPassword: config.adminPassword,
    maxTeams: config.maxTeams,
    roomTtlMs: config.roomTtlMs,
  });
  const rooms = manager.rooms;

  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('sev7en-vs ws at /ws');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const conn = manager.createConnection(ws);
    ws.on('message', (buf) => manager.handleMessage(conn, buf));
    ws.on('close', () => manager.onClose(conn));
  });

  const cleanupTimer = setInterval(() => manager.cleanup(), config.cleanupIntervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();

  function listen(p = config.port, h = config.host) {
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.off('listening', onListening); reject(err); };
      const onListening = () => { server.off('error', onError); resolve(server.address()); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, h);
    });
  }

  function close() {
    clearInterval(cleanupTimer);
    return new Promise((resolve) => {
      for (const client of wss.clients) { try { client.terminate(); } catch {} }
      wss.close(() => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    });
  }

  return {
    server, wss, rooms, manager, listen, close, config,
    cleanupNow: () => manager.cleanup(),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = createVsServer();
  app.listen().then(() => {
    console.log(`sev7en-vs WS on :${app.config.port}/ws  admin pass=${app.config.adminPassword.slice(0, 3)}***  maxTeams=${app.config.maxTeams}`);
  });
}

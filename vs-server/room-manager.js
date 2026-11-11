// vs-server/room-manager.js
// Runtime-agnostic room/protocol logic shared by the Node adapter (server.js)
// and the Bun adapter (server.bun.js).

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
export const MAX_TEAMS = 10;
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 jam auto-cleanup

export function genCode(n = 6, random = Math.random) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return s;
}

export function roomPublic(r) {
  return {
    code: r.code, materi: r.materi, duration: r.duration, status: r.status,
    teams: [...r.teams.values()].map(t => ({ id: t.id, name: t.name, score: t.score, floor: t.floor, streak: t.streak })),
  };
}

export function broadcast(r, msg, except = null) {
  const s = JSON.stringify(msg);
  for (const t of r.teams.values()) {
    if (t.ws && t.ws.readyState === 1 && t !== except) try { t.ws.send(s); } catch {}
  }
  if (r.hostWs && r.hostWs.readyState === 1 && r.hostWs !== except?.ws) try { r.hostWs.send(s); } catch {}
}

export function cleanupRooms(rooms, ttlMs = ROOM_TTL_MS, now = Date.now()) {
  let removed = 0;
  for (const [code, r] of rooms) {
    if (now - r.createdAt > ttlMs) { rooms.delete(code); removed++; }
  }
  return removed;
}

function parseMessage(raw) {
  let text;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
  else if (raw != null) text = new TextDecoder().decode(raw);
  else return null;
  try {
    const msg = JSON.parse(text);
    return msg && typeof msg === 'object' ? msg : null;
  } catch {
    return null;
  }
}

/**
 * Connection shape used by the manager. Adapters create one per socket.
 * @typedef {{
 *   id: string,
 *   ws: { send(data: string): void, readyState: number },
 *   room: string | null,
 *   teamId: string | null,
 *   isHost: boolean,
 *   send(msg: object | string): void,
 * }} Connection
 */
export class RoomManager {
  constructor(options = {}) {
    this.adminPassword = options.adminPassword ?? 'sev7en-admin';
    this.maxTeams = options.maxTeams ?? MAX_TEAMS;
    this.roomTtlMs = options.roomTtlMs ?? ROOM_TTL_MS;
    this.now = options.now ?? Date.now;
    this.rooms = new Map();
  }

  /** @returns {Connection} */
  createConnection(ws, id = Math.random().toString(36).slice(2, 9)) {
    return {
      id,
      ws,
      room: null,
      teamId: null,
      isHost: false,
      send(payload) {
        ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
      },
    };
  }

  _send(conn, msg) {
    try { conn.send(JSON.stringify(msg)); } catch {}
  }

  handleMessage(conn, raw) {
    const msg = parseMessage(raw);
    if (!msg) return;
    const t = msg.type;

    if (t === 'create_room') {
      const isAdmin = msg.adminPassword === this.adminPassword;
      if (!isAdmin) { this._send(conn, { type: 'error', message: 'Password admin salah' }); return; }
      let code; do { code = genCode(6); } while (this.rooms.has(code));
      const r = {
        code,
        materi: msg.materi || 'all',
        duration: parseInt(msg.duration || 180, 10),
        status: 'lobby',
        hostId: conn.id,
        hostWs: conn.ws,
        hostConn: conn,
        createdAt: this.now(),
        teams: new Map(),
      };
      this.rooms.set(code, r);
      conn.room = code; conn.isHost = true;
      this._send(conn, { type: 'room_created', code, room: roomPublic(r) });
      return;
    }

    if (t === 'join_room') {
      const code = String(msg.code || '').toUpperCase().trim();
      const name = String(msg.teamName || '').trim().slice(0, 24);
      if (!code || !name) { this._send(conn, { type: 'error', message: 'Kode & nama tim wajib' }); return; }
      const r = this.rooms.get(code);
      if (!r) { this._send(conn, { type: 'error', message: 'Room tidak ditemukan' }); return; }
      if (r.status !== 'lobby') { this._send(conn, { type: 'error', message: 'Room sudah mulai' }); return; }
      if (r.teams.size >= this.maxTeams) { this._send(conn, { type: 'error', message: 'Room penuh (10 tim)' }); return; }
      if ([...r.teams.values()].some(x => x.name.toLowerCase() === name.toLowerCase())) {
        this._send(conn, { type: 'error', message: 'Nama tim sudah dipakai' }); return;
      }
      const id = Math.random().toString(36).slice(2, 7);
      const team = { id, name, score: 0, floor: 0, streak: 0, ws: conn.ws, conn };
      r.teams.set(id, team);
      conn.room = code; conn.teamId = id;
      this._send(conn, { type: 'joined', code, teamId: id, room: roomPublic(r) });
      broadcast(r, { type: 'room_update', room: roomPublic(r) });
      return;
    }

    if (t === 'rejoin') {
      const code = String(msg.code || '').toUpperCase().trim();
      const id = msg.teamId;
      const r = this.rooms.get(code);
      if (r && r.teams.has(id)) {
        const team = r.teams.get(id);
        team.ws = conn.ws; team.conn = conn;
        conn.room = code; conn.teamId = id;
        this._send(conn, { type: 'rejoined', room: roomPublic(r) });
        if (r.status === 'playing') this._send(conn, { type: 'game_start', materi: r.materi, duration: r.duration, serverTime: r.startedAt });
      }
      return;
    }

    if (t === 'rejoin_host') {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = this.rooms.get(code);
      if (!r || msg.adminPassword !== this.adminPassword) return;
      r.hostWs = conn.ws; r.hostConn = conn;
      conn.room = code; conn.isHost = true;
      this._send(conn, { type: 'rejoined_host', room: roomPublic(r) });
      if (r.status === 'playing') this._send(conn, { type: 'game_start', materi: r.materi, duration: r.duration, serverTime: r.startedAt });
      return;
    }

    if (t === 'start_game') {
      const r = this.rooms.get(conn.room);
      if (!r || !conn.isHost) { this._send(conn, { type: 'error', message: 'Hanya host yang bisa start' }); return; }
      if (r.teams.size === 0) { this._send(conn, { type: 'error', message: 'Belum ada tim join' }); return; }
      r.status = 'playing'; r.startedAt = this.now();
      const payload = { type: 'game_start', materi: r.materi, duration: r.duration, serverTime: r.startedAt };
      broadcast(r, payload);
      // also to host
      this._send(conn, payload);
      return;
    }

    if (t === 'score_update') {
      const r = this.rooms.get(conn.room);
      if (!r || r.status !== 'playing') return;
      const team = r.teams.get(conn.teamId);
      if (!team) return;
      // trust client but clamp
      const score = Math.max(0, parseInt(msg.score || 0, 10));
      const floor = Math.max(0, parseInt(msg.floor || 0, 10));
      const streak = parseInt(msg.streak || 0, 10);
      team.score = score; team.floor = floor; team.streak = streak;
      broadcast(r, {
        type: 'leaderboard',
        teams: [...r.teams.values()]
          .map(x => ({ id: x.id, name: x.name, score: x.score, floor: x.floor, streak: x.streak }))
          .sort((a, b) => b.score - a.score),
      });
      return;
    }

    if (t === 'finish') {
      const r = this.rooms.get(conn.room);
      if (!r) return;
      const team = r.teams.get(conn.teamId);
      if (team) {
        team.score = parseInt(msg.score || team.score, 10);
        team.floor = parseInt(msg.floor || team.floor, 10);
      }
      broadcast(r, {
        type: 'leaderboard',
        teams: [...r.teams.values()]
          .map(x => ({ id: x.id, name: x.name, score: x.score, floor: x.floor }))
          .sort((a, b) => b.score - a.score),
      });
      return;
    }

    if (t === 'end_game') {
      const r = this.rooms.get(conn.room);
      if (!r || !conn.isHost) return;
      r.status = 'ended';
      broadcast(r, { type: 'game_end' });
      return;
    }
  }

  onClose(conn) {
    if (!conn.room) return;
    const r = this.rooms.get(conn.room);
    if (!r) return;
    if (conn.isHost) {
      // host disconnect: keep room but mark host offline; room still alive via TTL
      r.hostWs = null;
      r.hostConn = null;
    } else if (conn.teamId) {
      // keep team entry for rejoin; just null ws
      const t = r.teams.get(conn.teamId);
      if (t) { t.ws = null; t.conn = null; }
      broadcast(r, { type: 'room_update', room: roomPublic(r) });
    }
  }

  cleanup(now = this.now()) {
    return cleanupRooms(this.rooms, this.roomTtlMs, now);
  }
}

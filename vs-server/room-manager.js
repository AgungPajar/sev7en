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
  // observer/admin spectator mendapat broadcast yang sama dengan tim + host
  if (r.observers) for (const obs of r.observers) {
    if (obs.ws && obs.ws.readyState === 1 && obs !== except && obs.ws !== except?.ws) try { obs.ws.send(s); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Telemetri pemain (relay ke observer/admin spectator)
// Snapshot `s` memakai field pendek; hanya field dikenal yang disalin.
// ---------------------------------------------------------------------------

const SIDE_STATUSES = new Set(['n', 'c', 'w']);
const NUM_LIMIT = 1e6;

function finiteNum(v, min = -NUM_LIMIT, max = NUM_LIMIT) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}

function nonNegInt(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(NUM_LIMIT, Math.max(0, Math.trunc(v)));
}

function shortString(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function sanitizeSide(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  const x = finiteNum(p.x); if (x !== undefined) out.x = x;
  const y = finiteNum(p.y); if (y !== undefined) out.y = y;
  const t = shortString(p.t, 80); if (t !== undefined) out.t = t;
  if (p.ok !== undefined) out.ok = p.ok ? 1 : 0;
  const st = shortString(p.st, 8);
  if (st !== undefined) out.st = SIDE_STATUSES.has(st) ? st : 'n';
  if (p.br !== undefined) out.br = p.br ? 1 : 0;
  const fy = finiteNum(p.fy); if (fy !== undefined) out.fy = fy;
  return out;
}

function sanitizeTrail(tr) {
  if (!Array.isArray(tr)) return [];
  const out = [];
  for (const entry of tr.slice(0, 8)) {
    if (!Array.isArray(entry)) continue;
    const wx = finiteNum(entry[0]);
    const wy = finiteNum(entry[1]);
    if (wx === undefined || wy === undefined) continue;
    const level = nonNegInt(entry[2]) ?? 0;
    const raw = entry[3];
    let status = 0;
    if (typeof raw === 'number' && Number.isFinite(raw)) status = Math.trunc(raw);
    else if (typeof raw === 'string') status = raw.slice(0, 8);
    out.push([wx, wy, level, status]);
  }
  return out;
}

function sanitizeQuestion(q) {
  if (q === null || q === undefined) return null;
  if (typeof q !== 'object' || Array.isArray(q)) return null;
  const out = {};
  const t = shortString(q.t, 160); if (t !== undefined) out.t = t;
  const e = shortString(q.e, 8); if (e !== undefined) out.e = e;
  return out;
}

/**
 * Sanitasi satu snapshot telemetri pemain.
 * @returns {object|null} null bila `s` bukan objek (pesan harus diabaikan).
 */
export function sanitizePlayerState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};

  const f = nonNegInt(s.f); if (f !== undefined) out.f = f;
  const sc = nonNegInt(s.sc); if (sc !== undefined) out.sc = sc;
  const stk = nonNegInt(s.stk); if (stk !== undefined) out.stk = stk;

  for (const key of ['cx', 'cy', 'sx', 'sy', 'sr']) {
    const v = finiteNum(s[key]);
    if (v !== undefined) out[key] = v;
  }

  const ss = shortString(s.ss, 16); if (ss !== undefined) out.ss = ss;
  const se = shortString(s.se, 16); if (se !== undefined) out.se = se;

  const sk = finiteNum(s.sk, 0, 1); if (sk !== undefined) out.sk = sk;
  const kx = finiteNum(s.kx, 0.5, 2); if (kx !== undefined) out.kx = kx;
  const ky = finiteNum(s.ky, 0.5, 2); if (ky !== undefined) out.ky = ky;

  if (s.b !== undefined) {
    const bx = Array.isArray(s.b) && s.b.length >= 2 ? finiteNum(s.b[0]) : undefined;
    const by = Array.isArray(s.b) && s.b.length >= 2 ? finiteNum(s.b[1]) : undefined;
    out.b = bx !== undefined && by !== undefined ? [bx, by] : null;
  }
  if (s.l !== undefined) out.l = sanitizeSide(s.l);
  if (s.r !== undefined) out.r = sanitizeSide(s.r);
  if (s.q !== undefined) out.q = sanitizeQuestion(s.q);
  if (s.tr !== undefined) out.tr = sanitizeTrail(s.tr);

  return out;
}

/** Relay snapshot terbaru HANYA ke observer room tsb (bukan tim/host). */
export function relayPlayerState(r, teamId, s, t) {
  if (!r.observers || r.observers.size === 0) return;
  const payload = JSON.stringify({ type: 'player_state', teamId, s, t });
  for (const obs of r.observers) {
    if (obs && obs.ws && obs.ws.readyState === 1) try { obs.ws.send(payload); } catch {}
  }
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
 *   isObserver?: boolean,
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
      isObserver: false,
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
        observers: new Set(), // conn admin/spectator, bukan tim
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
      const team = { id, name, score: 0, floor: 0, streak: 0, ws: conn.ws, conn, state: null, stateAt: 0 };
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

    if (t === 'spectate') {
      const code = String(msg.code || '').toUpperCase().trim();
      if (msg.adminPassword !== this.adminPassword) { this._send(conn, { type: 'error', message: 'Password admin salah' }); return; }
      const r = this.rooms.get(code);
      if (!r) { this._send(conn, { type: 'error', message: 'Room tidak ditemukan' }); return; }
      // observer bukan tim & bukan host: jangan sentuh r.teams / maxTeams
      if (conn.isObserver && conn.room && conn.room !== code) {
        const prev = this.rooms.get(conn.room);
        if (prev && prev.observers) prev.observers.delete(conn);
      }
      conn.room = code; conn.teamId = null; conn.isHost = false; conn.isObserver = true;
      r.observers.add(conn);
      this._send(conn, {
        type: 'spectate_ok',
        code,
        room: roomPublic(r),
        startedAt: r.startedAt || null,
        duration: r.duration,
        observers: r.observers.size,
      });
      // snapshot terakhir tiap tim yang sudah pernah kirim telemetri
      for (const team of r.teams.values()) {
        if (team.state) this._send(conn, { type: 'player_state', teamId: team.id, s: team.state, t: team.stateAt });
      }
      return;
    }

    if (t === 'spectate_leave') {
      if (conn.isObserver) {
        const r = this.rooms.get(conn.room);
        if (r && r.observers) r.observers.delete(conn);
        conn.isObserver = false; conn.room = null;
      }
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

    if (t === 'player_state') {
      const r = this.rooms.get(conn.room);
      if (!r || r.status !== 'playing') return;
      // hanya tim asli yang boleh kirim telemetri (observer/host diabaikan)
      if (!conn.teamId) return;
      const team = r.teams.get(conn.teamId);
      if (!team) return;
      const s = sanitizePlayerState(msg.s);
      if (!s) return; // s bukan objek -> abaikan
      team.state = s;
      team.stateAt = this.now();
      relayPlayerState(r, team.id, s, team.stateAt);
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
    if (conn.isObserver) {
      // observer putus: cukup keluarkan dari Set, tanpa room_update palsu
      if (r.observers) r.observers.delete(conn);
      conn.isObserver = false;
      return;
    }
    if (conn.isHost) {
      // host disconnect: keep room but mark host offline; room still alive via TTL
      r.hostWs = null;
      r.hostConn = null;
    } else if (conn.teamId) {
      // keep team entry for rejoin; just null ws
      const t = r.teams.get(conn.teamId);
      if (t) { t.ws = null; t.conn = null; }
      broadcast(r, { type: 'room_update', room: roomPublic(r) });
      // beri tahu observer agar bisa menandai tim offline (state terakhir tetap disimpan)
      if (r.observers) for (const obs of r.observers) this._send(obs, { type: 'team_offline', teamId: conn.teamId });
    }
  }

  cleanup(now = this.now()) {
    return cleanupRooms(this.rooms, this.roomTtlMs, now);
  }
}

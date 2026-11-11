// vs-server/room-manager.js
// Runtime-agnostic room/protocol logic shared by the Node adapter (server.js)
// and the Bun adapter (server.bun.js).

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
export const MAX_TEAMS = 10;
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 jam auto-cleanup
// Jeda setelah waktu habis untuk menerima `finish` (skor akhir) dari semua tim
// sebelum pemenang diumumkan. Server tetap sumber jam; grace hanya menampung
// skor akhir yang dikirim tepat saat timer menyentuh 0.
export const MATCH_GRACE_MS = 1200;

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

/**
 * Sisa waktu pertandingan (detik, dibulatkan ke atas) pada `now`. Server adalah
 * sumber jam: nilai ini dikirim ke client lewat `remaining` supaya HUD pemain,
 * leaderboard, dan status spectator admin menghitung deadline yang sama (tidak
 * terpengaruh beda jam antar perangkat maupun latensi pengiriman pesan).
 * @returns {number|null} null bila room belum/sudah tidak bermain, atau durasi
 *   "Tanpa Batas" (>= 9000 detik).
 */
export function remainingSeconds(r, now = Date.now()) {
  if (!r || r.status !== 'playing' || !r.startedAt) return null;
  const duration = Number(r.duration) || 0;
  if (!(duration > 0) || duration >= 9000) return null; // Tanpa Batas: tanpa hitungan
  const endsAt = Number(r.startedAt) + duration * 1000;
  return Math.max(0, Math.ceil((endsAt - Number(now)) / 1000));
}

/**
 * Sisa waktu pertandingan dalam milidetik (null bila tidak ada hitungan).
 * Dikirim bersama `remaining` (detik) supaya client dapat menghitung deadline
 * lokal dengan presisi milidetik: HUD pemain dan status spectator admin jatuh
 * pada detik yang sama, bukan hanya selisih maksimal 1 detik.
 */
export function remainingMs(r, now = Date.now()) {
  if (!r || r.status !== 'playing' || !r.startedAt) return null;
  const duration = Number(r.duration) || 0;
  if (!(duration > 0) || duration >= 9000) return null;
  const endsAt = Number(r.startedAt) + duration * 1000;
  return Math.max(0, Math.round(endsAt - Number(now)));
}

/** Data tim yang aman dikirim ke client (tanpa socket/telemetri). */
export function publicTeam(t) {
  return {
    id: String(t.id),
    name: String(t.name || 'TIM'),
    score: Math.max(0, Number(t.score) || 0),
    floor: Math.max(0, Number(t.floor) || 0),
    streak: Number(t.streak) || 0,
  };
}

/**
 * Klasemen akhir: skor tertinggi menang; bila skor sama, ketinggian (floor)
 * lebih tinggi menang; nama dipakai sebagai tie-break agar urutan deterministik.
 */
export function rankTeams(r) {
  return [...r.teams.values()]
    .map(publicTeam)
    .sort((a, b) =>
      b.score - a.score ||
      b.floor - a.floor ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id));
}

/**
 * Hasil resmi satu pertandingan. `winner` null bila posisi teratas seri
 * (skor & floor sama); `winners` selalu berisi tim di posisi teratas.
 */
export function matchResult(r, reason = 'host', now = Date.now()) {
  const teams = rankTeams(r).map((team, i) => ({ ...team, rank: i + 1 }));
  const round = Number(r && r.round) || 1;
  if (!teams.length) {
    return { reason, endedAt: now, round, winner: null, tied: false, winners: [], teams: [] };
  }
  const top = teams.filter((team) => team.score === teams[0].score && team.floor === teams[0].floor);
  const tied = top.length > 1;
  // Posisi teratas yang seri semuanya rank 1; tim berikutnya tetap memakai rank
  // klasemen aslinya (mis. 1, 1, 3) supaya kartu hasil tidak menulis 🥈 untuk seri.
  if (tied) {
    for (const team of teams) {
      if (team.score === teams[0].score && team.floor === teams[0].floor) team.rank = 1;
    }
  }
  const winners = top.map((team) => ({ ...team }));
  return {
    reason,
    endedAt: now,
    round,
    winner: tied ? null : { ...teams[0] },
    tied,
    winners,
    teams,
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
    // Timer bisa di-inject untuk test; default memakai global setTimeout dan
    // di-unref (Node) supaya timer 3-10 menit tidak menahan proses test.
    this.setTimer = options.setTimeout ?? ((fn, ms) => {
      const id = setTimeout(fn, ms);
      if (id && typeof id.unref === 'function') id.unref();
      return id;
    });
    this.clearTimer = options.clearTimeout ?? ((id) => clearTimeout(id));
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

  _clearEndTimer(r) {
    if (!r || r.endTimer == null) return;
    try { this.clearTimer(r.endTimer); } catch {}
    r.endTimer = null;
  }

  /** Jadwalkan akhir otomatis di server (sumber jam), plus grace skor akhir. */
  _scheduleEnd(r) {
    this._clearEndTimer(r);
    const duration = Number(r.duration) || 0;
    if (!(duration > 0) || duration >= 9000) return; // Tanpa Batas
    r.endTimer = this.setTimer(() => {
      r.endTimer = null;
      // Abaikan bila room sudah dihapus/diganti atau pertandingan sudah selesai.
      if (this.rooms.get(r.code) !== r || r.status !== 'playing') return;
      this._finishMatch(r, 'time');
    }, duration * 1000 + MATCH_GRACE_MS);
  }

  /**
   * Akhiri pertandingan: hitung pemenang, simpan hasil, siarkan `game_end` ke
   * tim + host + observer. Room kembali ke lobby (bukan dihapus) supaya kode
   * yang sama bisa dipakai untuk ronde berikutnya; skor direset saat `start_game`
   * berikutnya. Room hanya hilang lewat `delete_room`, TTL, atau restart server.
   */
  _finishMatch(r, reason = 'host') {
    if (!r || r.status !== 'playing') return null;
    this._clearEndTimer(r);
    r.status = 'lobby';
    r.startedAt = null;
    const result = matchResult(r, reason, this.now());
    r.lastResult = result;
    broadcast(r, { type: 'game_end', ...result });
    broadcast(r, { type: 'room_update', room: roomPublic(r) });
    return result;
  }

  /** Hentikan semua timer room (dipakai saat server shutdown). */
  dispose() {
    for (const r of this.rooms.values()) this._clearEndTimer(r);
    this.rooms.clear();
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
        startedAt: null,
        round: 0,
        lastResult: null,
        endTimer: null,
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
        this._send(conn, { type: 'rejoined', room: roomPublic(r), round: r.round || 0, lastResult: r.lastResult || null });
        if (r.status === 'playing') this._send(conn, { type: 'game_start', materi: r.materi, duration: r.duration, serverTime: r.startedAt, remaining: remainingSeconds(r, this.now()), remainingMs: remainingMs(r, this.now()), round: r.round || 1 });
      }
      return;
    }

    if (t === 'rejoin_host') {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = this.rooms.get(code);
      if (!r || msg.adminPassword !== this.adminPassword) return;
      // Socket host lama tidak boleh tetap memegang kendali setelah digantikan.
      if (r.hostConn && r.hostConn !== conn) r.hostConn.isHost = false;
      r.hostWs = conn.ws; r.hostConn = conn;
      conn.room = code; conn.isHost = true;
      this._send(conn, { type: 'rejoined_host', room: roomPublic(r), round: r.round || 0, lastResult: r.lastResult || null });
      if (r.status === 'playing') this._send(conn, { type: 'game_start', materi: r.materi, duration: r.duration, serverTime: r.startedAt, remaining: remainingSeconds(r, this.now()), remainingMs: remainingMs(r, this.now()), round: r.round || 1 });
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
        // Sisa waktu saat ini supaya spectator yang join di tengah pertandingan
        // langsung memakai deadline yang sama dengan tim (null saat lobby).
        remaining: remainingSeconds(r, this.now()),
        remainingMs: remainingMs(r, this.now()),
        round: r.round || 0,
        // Hasil ronde terakhir dikirim agar admin yang membuka Tonton Live
        // setelah pertandingan selesai tetap melihat layar Game Over + pemenang.
        lastResult: r.lastResult || null,
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

    if (t === 'delete_room') {
      const r = this.rooms.get(conn.room);
      if (!r || !conn.isHost || r.hostConn !== conn) {
        if (r) this._send(conn, { type: 'error', message: 'Hanya host yang bisa menghapus room' });
        return;
      }
      this._clearEndTimer(r);
      this.rooms.delete(r.code);
      // Beri tahu semua yang masih terikat (tim, host, observer) sebelum socket
      // dilepas dari room. Client menampilkan pesan "Room dihapus" lalu kembali
      // ke menu; kode room tidak bisa dipakai lagi.
      broadcast(r, { type: 'room_deleted', code: r.code, message: 'Room dihapus oleh admin' });
      for (const team of r.teams.values()) {
        if (team.conn) { team.conn.room = null; team.conn.teamId = null; }
        team.ws = null; team.conn = null;
      }
      if (r.observers) for (const obs of r.observers) {
        if (obs) { obs.room = null; obs.isObserver = false; }
      }
      if (r.hostConn) { r.hostConn.room = null; r.hostConn.isHost = false; }
      r.hostConn = null; r.hostWs = null;
      r.teams.clear();
      if (r.observers) r.observers.clear();
      return;
    }

    if (t === 'start_game') {
      const r = this.rooms.get(conn.room);
      if (!r || !conn.isHost || r.hostConn !== conn) { this._send(conn, { type: 'error', message: 'Hanya host yang bisa start' }); return; }
      if (r.teams.size === 0) { this._send(conn, { type: 'error', message: 'Belum ada tim join' }); return; }
      if (r.status === 'playing') {
        // Cegah double-click/duplikat yang mereset ronde yang baru berjalan.
        this._send(conn, { type: 'error', message: 'Pertandingan sedang berjalan' });
        return;
      }
      // Ronde baru: reset skor/telemetri, pertahankan tim yang sudah join.
      this._clearEndTimer(r);
      r.status = 'playing';
      r.startedAt = this.now();
      r.round = (Number(r.round) || 0) + 1;
      r.lastResult = null;
      for (const team of r.teams.values()) {
        team.score = 0; team.floor = 0; team.streak = 0;
        team.state = null; team.stateAt = 0;
      }
      broadcast(r, { type: 'room_update', room: roomPublic(r) });
      const payload = {
        type: 'game_start', materi: r.materi, duration: r.duration,
        serverTime: r.startedAt,
        remaining: remainingSeconds(r, r.startedAt),
        remainingMs: remainingMs(r, r.startedAt),
        round: r.round,
      };
      broadcast(r, payload);
      // also to host
      this._send(conn, payload);
      this._scheduleEnd(r);
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
      if (!r || r.status !== 'playing') return;
      const team = r.teams.get(conn.teamId);
      if (team) {
        // Nilai 0 diabaikan: dipakai sebagai nilai final bila client mengirim
        // skor terakhir tepat saat waktu habis (server masih dalam grace).
        if (msg.score) team.score = Math.max(0, parseInt(msg.score, 10) || 0);
        if (msg.floor) team.floor = Math.max(0, parseInt(msg.floor, 10) || 0);
        const streak = parseInt(msg.streak, 10);
        if (Number.isFinite(streak)) team.streak = streak;
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
      if (!r || !conn.isHost || r.hostConn !== conn) return;
      if (r.status !== 'playing') {
        this._send(conn, { type: 'error', message: 'Tidak ada pertandingan yang berjalan' });
        return;
      }
      this._finishMatch(r, 'host');
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
      // host disconnect: keep room but mark host offline; room still alive via TTL.
      // Socket host lama yang baru saja digantikan rejoin_host tidak boleh
      // melepas host aktif yang baru.
      if (r.hostConn === conn) {
        r.hostWs = null;
        r.hostConn = null;
      }
    } else if (conn.teamId) {
      const t = r.teams.get(conn.teamId);
      // Socket tim lama yang sudah digantikan `rejoin` jangan melepas socket baru.
      if (!t || t.conn !== conn) return;
      // keep team entry for rejoin; just null ws
      t.ws = null; t.conn = null;
      broadcast(r, { type: 'room_update', room: roomPublic(r) });
      // beri tahu observer agar bisa menandai tim offline (state terakhir tetap disimpan)
      if (r.observers) for (const obs of r.observers) this._send(obs, { type: 'team_offline', teamId: conn.teamId });
    }
  }

  cleanup(now = this.now()) {
    let removed = 0;
    for (const [code, r] of this.rooms) {
      if (now - r.createdAt > this.roomTtlMs) {
        this._clearEndTimer(r);
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }
}

// tests/vs-server.test.js
// Unit + integration tests for the Star-Pou VS WebSocket server.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVsServer,
  genCode,
  roomPublic,
  broadcast,
  cleanupRooms,
  sanitizePlayerState,
  CODE_CHARS,
  MAX_TEAMS,
} from '../vs-server/server.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll a predicate instead of sleeping a fixed time (telemetry has no ack).
async function waitUntil(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
    await delay(10);
  }
}

// Representative complete snapshot sent by game.html (~8x/detik).
const snapshot = (over = {}) => ({
  f: 3, sc: 120, stk: 2,
  cx: 10.5, cy: -40.25, sx: 120, sy: -880,
  ss: 'jumping', se: 'happy', sr: 1.25, sk: 0.5, kx: 1.05, ky: 0.95,
  b: [120, -880],
  l: { x: 100, y: -880, t: 'They ___ to school every day', ok: 1, st: 'c', br: 0, fy: -900 },
  r: { x: 140, y: -880, t: 'They is go', ok: 0, st: 'w', br: 1, fy: -900 },
  tr: [[0, 0, 0, 'correct'], [120, -880, 1, 'correct']],
  q: { t: 'Pilih jawaban yang benar', e: '🍔' },
  ...over,
});

// ---------------------------------------------------------------------------
// WebSocket test client (Node's built-in WebSocket, no extra dependency)
// ---------------------------------------------------------------------------
async function openClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  const waiters = [];
  const errors = [];

  ws.addEventListener('message', (event) => {
    const raw = typeof event.data === 'string' ? event.data : String(event.data);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    messages.push(parsed);
    flush();
  });
  ws.addEventListener('error', (event) => { errors.push(event); });

  function flush() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      const index = messages.findIndex((m) => waiter.predicate(m));
      if (index === -1) continue;
      const [message] = messages.splice(index, 1);
      waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('failed to open WebSocket')), { once: true });
  });

  const client = {
    ws,
    messages,
    errors,
    send(payload) {
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    },
    next(predicate = () => true, timeout = 2000) {
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`timed out waiting for message; buffered=${JSON.stringify(messages)}`));
        }, timeout);
        waiters.push(waiter);
        flush();
      });
    },
    nextType(type, timeout = 2000) {
      return client.next((m) => m && m.type === type, timeout);
    },
    async none(ms = 150) {
      await delay(ms);
      return messages.length === 0;
    },
    clear() { messages.length = 0; },
    close() { try { ws.close(); } catch {} },
  };
  return client;
}

describe('vs-server — pure helpers', () => {
  it('genCode produces 6 characters from the unambiguous alphabet', () => {
    assert.equal(genCode().length, 6);
    assert.equal(genCode(10).length, 10);
    for (let i = 0; i < 200; i++) {
      const code = genCode();
      for (const ch of code) assert.ok(CODE_CHARS.includes(ch), `bad char ${ch}`);
      assert.ok(!/[IO01]/.test(code), `ambiguous char in ${code}`);
    }
  });

  it('genCode maps random values onto the alphabet boundaries', () => {
    assert.equal(genCode(6, () => 0), 'AAAAAA');
    assert.equal(genCode(6, () => 0.999999), '999999');
    assert.equal(genCode(3, () => 0.5), CODE_CHARS[16].repeat(3));
  });

  it('roomPublic exposes teams without socket references', () => {
    const r = {
      code: 'ABC123',
      materi: 'food_kitchen',
      duration: 60,
      status: 'lobby',
      hostWs: { secret: true },
      createdAt: 123,
      teams: new Map([
        ['a', { id: 'a', name: 'Alpha', score: 10, floor: 2, streak: 1, ws: { secret: true } }],
        ['b', { id: 'b', name: 'Beta', score: 4, floor: 1, streak: 0, ws: null }],
      ]),
    };
    const pub = roomPublic(r);
    assert.deepEqual(pub, {
      code: 'ABC123',
      materi: 'food_kitchen',
      duration: 60,
      status: 'lobby',
      teams: [
        { id: 'a', name: 'Alpha', score: 10, floor: 2, streak: 1 },
        { id: 'b', name: 'Beta', score: 4, floor: 1, streak: 0 },
      ],
    });
    assert.equal('hostWs' in pub, false);
    assert.equal('createdAt' in pub, false);
    assert.equal('ws' in pub.teams[0], false);
  });

  it('broadcast sends JSON to every open team and the host', () => {
    const sent = [];
    const socket = () => ({ readyState: 1, send: (s) => sent.push(JSON.parse(s)) });
    const a = socket();
    const b = socket();
    const host = socket();
    const r = {
      teams: new Map([['a', { id: 'a', ws: a }], ['b', { id: 'b', ws: b }]]),
      hostWs: host,
    };
    broadcast(r, { type: 'leaderboard', teams: [1] });
    assert.equal(sent.length, 3);
    for (const msg of sent) assert.deepEqual(msg, { type: 'leaderboard', teams: [1] });
  });

  it('broadcast skips closed sockets and the excluded team', () => {
    const sent = [];
    const open = () => ({ readyState: 1, send: (s) => sent.push(JSON.parse(s)) });
    const closed = { readyState: 3, send: () => { throw new Error('must not send'); } };
    const teamA = { id: 'a', ws: open() };
    const teamB = { id: 'b', ws: open() };
    const host = open();
    const r = { teams: new Map([['a', teamA], ['b', teamB]]), hostWs: host };

    broadcast(r, { type: 'room_update' }, teamA);
    assert.equal(sent.length, 2); // team B + host
    broadcast(r, { type: 'room_update' }, { id: 'c', ws: closed });
    assert.equal(sent.length, 5); // team A + team B + host again
  });

  it('broadcast tolerates a throwing send', () => {
    const sent = [];
    const bad = { readyState: 1, send: () => { throw new Error('boom'); } };
    const good = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
    const r = { teams: new Map([['a', { id: 'a', ws: bad }], ['b', { id: 'b', ws: good }]]), hostWs: null };
    assert.doesNotThrow(() => broadcast(r, { type: 'x' }));
    assert.deepEqual(sent, [{ type: 'x' }]);
  });

  it('broadcast also reaches room observers', () => {
    const sent = [];
    const socket = () => ({ readyState: 1, send: (s) => sent.push(JSON.parse(s)) });
    const r = {
      teams: new Map([['a', { id: 'a', ws: socket() }]]),
      hostWs: socket(),
      observers: new Set([{ ws: socket() }, {}]),
    };
    broadcast(r, { type: 'room_update' });
    assert.equal(sent.length, 3); // team + host + 1 open observer
    for (const msg of sent) assert.deepEqual(msg, { type: 'room_update' });
  });

  it('sanitizePlayerState copies known fields only', () => {
    const out = sanitizePlayerState({ ...snapshot(), rahasia: 'x', extra: 1 });
    assert.deepEqual(out, snapshot());
    assert.equal('rahasia' in out, false);
    assert.equal('extra' in out, false);
  });

  it('sanitizePlayerState clamps numbers and truncates strings/trail', () => {
    const out = sanitizePlayerState({
      f: -5, sc: 3.9, stk: 'x',
      cx: NaN, cy: Infinity, sr: 1e12,
      ss: 's'.repeat(100), se: 42,
      sk: 9, kx: 9, ky: -3,
      b: [NaN, 2], l: 'nope',
      r: { x: 1, y: 2, t: 't'.repeat(100), ok: 0, st: 'zz', br: 'yes', fy: Infinity },
      tr: Array.from({ length: 12 }, (_, i) => [i, -i, i, i % 2]),
      q: { t: 'q'.repeat(300), e: '🍔'.repeat(10) },
    });
    assert.equal(out.f, 0);
    assert.equal(out.sc, 3);
    assert.equal('stk' in out, false);
    assert.equal('cx' in out, false);
    assert.equal('cy' in out, false);
    assert.equal(out.sr, 1e6);
    assert.equal(out.ss.length, 16);
    assert.equal('se' in out, false);
    assert.equal(out.sk, 1);
    assert.equal(out.kx, 2);
    assert.equal(out.ky, 0.5);
    assert.equal(out.b, null);
    assert.equal(out.l, null);
    assert.equal(out.r.t.length, 80);
    assert.equal(out.r.st, 'n');
    assert.equal(out.r.br, 1);
    assert.equal('fy' in out.r, false);
    assert.equal(out.tr.length, 8);
    assert.equal(out.q.t.length, 160);
    assert.equal(out.q.e.length, 8);
  });

  it('sanitizePlayerState rejects non-object snapshots', () => {
    assert.equal(sanitizePlayerState(null), null);
    assert.equal(sanitizePlayerState(undefined), null);
    assert.equal(sanitizePlayerState('nope'), null);
    assert.equal(sanitizePlayerState([1, 2, 3]), null);
    assert.deepEqual(sanitizePlayerState({}), {});
  });

  it('cleanupRooms removes only rooms older than the TTL', () => {
    const now = 10_000_000;
    const rooms = new Map([
      ['old', { createdAt: now - 1001 }],
      ['edge', { createdAt: now - 1000 }],
      ['new', { createdAt: now - 10 }],
    ]);
    assert.equal(cleanupRooms(rooms, 1000, now), 1);
    assert.deepEqual([...rooms.keys()], ['edge', 'new']);
  });
});

// ---------------------------------------------------------------------------
// Live server integration
// ---------------------------------------------------------------------------
describe('vs-server — live server', () => {
  let app;
  let port;
  let clients;

  const client = async () => {
    const c = await openClient(port);
    clients.push(c);
    return c;
  };

  const createRoom = async (extra = {}) => {
    const host = await client();
    host.send({ type: 'create_room', adminPassword: app.config.adminPassword, ...extra });
    const created = await host.nextType('room_created');
    return { host, code: created.code, created };
  };

  const joinRoom = async (code, teamName) => {
    const c = await client();
    c.send({ type: 'join_room', code, teamName });
    const joined = await c.nextType('joined');
    return { c, joined };
  };

  const startGame = async (host) => {
    host.send({ type: 'start_game' });
    await host.nextType('game_start');
  };

  const spectate = async (code, adminPassword = app.config.adminPassword) => {
    const c = await client();
    c.send({ type: 'spectate', code, adminPassword });
    return c;
  };

  const sendState = (c, over = {}) => c.send({ type: 'player_state', s: snapshot(over) });

  beforeEach(async () => {
    clients = [];
    app = createVsServer();
    const address = await app.listen(0, '127.0.0.1');
    port = address.port;
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    await delay(20);
    await app.close();
  });

  // ---- HTTP -------------------------------------------------------------
  it('serves /health with the room count', async () => {
    let res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, rooms: 0 });

    await createRoom();
    res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.deepEqual(await res.json(), { ok: true, rooms: 1 });
  });

  it('serves a plain-text fallback for other paths', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.equal(await res.text(), 'sev7en-vs ws at /ws');
  });

  // ---- create_room ------------------------------------------------------
  it('rejects create_room with a wrong admin password', async () => {
    const host = await client();
    host.send({ type: 'create_room', adminPassword: 'wrong' });
    const error = await host.nextType('error');
    assert.equal(error.message, 'Password admin salah');
    assert.equal(app.rooms.size, 0);
  });

  it('accepts create_room after a failed attempt on the same socket', async () => {
    const host = await client();
    host.send({ type: 'create_room', adminPassword: 'wrong' });
    await host.nextType('error');
    host.send({ type: 'create_room', adminPassword: app.config.adminPassword });
    const created = await host.nextType('room_created');
    assert.equal(created.code.length, 6);
    assert.equal(app.rooms.size, 1);
  });

  it('creates a lobby with default materi/duration', async () => {
    const { created } = await createRoom();
    assert.equal(created.room.materi, 'all');
    assert.equal(created.room.duration, 180);
    assert.equal(created.room.status, 'lobby');
    assert.deepEqual(created.room.teams, []);
    assert.ok(CODE_CHARS.includes(created.code[0]));
  });

  it('honours custom materi/duration and falsy fallbacks', async () => {
    const { created } = await createRoom({ materi: 'food_kitchen', duration: '90' });
    assert.equal(created.room.materi, 'food_kitchen');
    assert.equal(created.room.duration, 90);

    const { created: second } = await createRoom({ materi: '', duration: 0 });
    assert.equal(second.room.materi, 'all');
    assert.equal(second.room.duration, 180);
  });

  it('generates unique room codes', async () => {
    const codes = new Set();
    for (let i = 0; i < 15; i++) {
      const { code } = await createRoom();
      codes.add(code);
    }
    assert.equal(codes.size, 15);
  });

  // ---- join_room --------------------------------------------------------
  it('lets a team join and notifies everyone', async () => {
    const { host, code } = await createRoom();
    const { c, joined } = await joinRoom(code, 'Alpha');

    assert.equal(joined.code, code);
    assert.equal(typeof joined.teamId, 'string');
    assert.equal(joined.room.teams.length, 1);
    assert.deepEqual(joined.room.teams[0], {
      id: joined.teamId, name: 'Alpha', score: 0, floor: 0, streak: 0,
    });

    const hostUpdate = await host.next((m) => m.type === 'room_update' && m.room.teams.length === 1);
    assert.equal(hostUpdate.room.teams[0].name, 'Alpha');
    const selfUpdate = await c.next((m) => m.type === 'room_update' && m.room.teams.length === 1);
    assert.equal(selfUpdate.room.teams[0].id, joined.teamId);
  });

  it('requires both code and team name', async () => {
    const { code } = await createRoom();
    const c = await client();

    c.send({ type: 'join_room', code: '', teamName: 'Alpha' });
    assert.equal((await c.nextType('error')).message, 'Kode & nama tim wajib');

    c.send({ type: 'join_room', code, teamName: '   ' });
    assert.equal((await c.nextType('error')).message, 'Kode & nama tim wajib');
  });

  it('rejects an unknown room', async () => {
    const c = await client();
    c.send({ type: 'join_room', code: 'ZZZZZZ', teamName: 'Alpha' });
    assert.equal((await c.nextType('error')).message, 'Room tidak ditemukan');
  });

  it('accepts lowercase codes', async () => {
    const { code } = await createRoom();
    const c = await client();
    c.send({ type: 'join_room', code: code.toLowerCase(), teamName: 'Alpha' });
    const joined = await c.nextType('joined');
    assert.equal(joined.code, code);
  });

  it('rejects duplicate team names case-insensitively', async () => {
    const { code } = await createRoom();
    await joinRoom(code, 'Alpha');
    const c = await client();
    c.send({ type: 'join_room', code, teamName: '  alpha ' });
    assert.equal((await c.nextType('error')).message, 'Nama tim sudah dipakai');
  });

  it('trims and truncates team names to 24 characters', async () => {
    const { code } = await createRoom();
    const { joined } = await joinRoom(code, `   ${'x'.repeat(40)}   `);
    assert.equal(joined.room.teams[0].name, 'x'.repeat(24));
  });

  it('rejects joins once the room has started', async () => {
    const { host, code } = await createRoom();
    await joinRoom(code, 'Alpha');
    host.send({ type: 'start_game' });
    await host.nextType('game_start');

    const c = await client();
    c.send({ type: 'join_room', code, teamName: 'Late' });
    assert.equal((await c.nextType('error')).message, 'Room sudah mulai');
  });

  it('rejects the 11th team', async () => {
    const { code } = await createRoom();
    for (let i = 1; i <= MAX_TEAMS; i++) await joinRoom(code, `Team ${i}`);
    const extra = await client();
    extra.send({ type: 'join_room', code, teamName: 'Team 11' });
    assert.equal((await extra.nextType('error')).message, 'Room penuh (10 tim)');
    assert.equal(app.rooms.get(code).teams.size, MAX_TEAMS);
  });

  // ---- start_game -------------------------------------------------------
  it('only lets the host start the game', async () => {
    const { code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    c.send({ type: 'start_game' });
    assert.equal((await c.nextType('error')).message, 'Hanya host yang bisa start');
  });

  it('refuses to start an empty room', async () => {
    const { host } = await createRoom();
    host.send({ type: 'start_game' });
    assert.equal((await host.nextType('error')).message, 'Belum ada tim join');
  });

  it('broadcasts game_start to teams and host', async () => {
    const { host, code } = await createRoom({ materi: 'continuous_hobby', duration: 45 });
    const { c } = await joinRoom(code, 'Alpha');
    const before = Date.now();
    host.send({ type: 'start_game' });

    const teamStart = await c.nextType('game_start');
    assert.equal(teamStart.materi, 'continuous_hobby');
    assert.equal(teamStart.duration, 45);
    assert.ok(teamStart.serverTime >= before && teamStart.serverTime <= Date.now());

    // The host gets the broadcast and the explicit follow-up.
    const hostStart1 = await host.nextType('game_start');
    const hostStart2 = await host.nextType('game_start');
    assert.equal(hostStart1.serverTime, teamStart.serverTime);
    assert.equal(hostStart2.serverTime, teamStart.serverTime);

    const room = app.rooms.get(code);
    assert.equal(room.status, 'playing');
    assert.equal(room.startedAt, teamStart.serverTime);
  });

  // ---- score_update -----------------------------------------------------
  it('ignores score updates before the game starts', async () => {
    const { code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    c.clear();
    c.send({ type: 'score_update', score: 50, floor: 2, streak: 1 });
    assert.equal(await c.none(), true);
  });

  it('ignores score updates from a socket without a team', async () => {
    const { host, code } = await createRoom();
    await joinRoom(code, 'Alpha');
    host.send({ type: 'start_game' });
    await host.nextType('game_start');
    host.clear();
    host.send({ type: 'score_update', score: 999 });
    assert.equal(await host.none(), true);
  });

  it('stores scores and broadcasts a sorted leaderboard', async () => {
    const { host, code } = await createRoom();
    const { c: a } = await joinRoom(code, 'Alpha');
    const { c: b } = await joinRoom(code, 'Beta');
    host.send({ type: 'start_game' });
    await a.nextType('game_start');

    a.send({ type: 'score_update', score: 50, floor: 1, streak: 1 });
    let lb = await a.nextType('leaderboard');
    assert.equal(lb.teams[0].name, 'Alpha');
    assert.equal(lb.teams[0].score, 50);

    b.clear();
    b.send({ type: 'score_update', score: 120, floor: 3, streak: 2 });
    lb = await b.next((m) => m.type === 'leaderboard' && m.teams[0] && m.teams[0].name === 'Beta');
    assert.deepEqual(lb.teams.map((t) => t.name), ['Beta', 'Alpha']);
    assert.deepEqual(lb.teams.map((t) => t.score), [120, 50]);
    assert.equal(lb.teams[0].floor, 3);
    assert.equal(lb.teams[0].streak, 2);
  });

  it('clamps negative score/floor but not streak', async () => {
    const { host, code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    host.send({ type: 'start_game' });
    await c.nextType('game_start');

    c.send({ type: 'score_update', score: -50, floor: -2, streak: -7 });
    const lb = await c.nextType('leaderboard');
    assert.equal(lb.teams[0].score, 0);
    assert.equal(lb.teams[0].floor, 0);
    assert.equal(lb.teams[0].streak, -7);
  });

  // ---- finish -----------------------------------------------------------
  it('updates the final score/floor on finish', async () => {
    const { host, code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    host.send({ type: 'start_game' });
    await c.nextType('game_start');

    c.send({ type: 'finish', score: 250, floor: 5 });
    const lb = await c.nextType('leaderboard');
    assert.equal(lb.teams[0].score, 250);
    assert.equal(lb.teams[0].floor, 5);
  });

  it('keeps the previous value when finish sends zero', async () => {
    const { host, code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    host.send({ type: 'start_game' });
    await c.nextType('game_start');

    c.send({ type: 'score_update', score: 50, floor: 2, streak: 0 });
    await c.nextType('leaderboard');
    c.send({ type: 'finish', score: 0, floor: 0 });
    const lb = await c.nextType('leaderboard');
    assert.equal(lb.teams[0].score, 50);
    assert.equal(lb.teams[0].floor, 2);
  });

  // ---- end_game ---------------------------------------------------------
  it('only lets the host end the game', async () => {
    const { code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    c.clear();
    c.send({ type: 'end_game' });
    assert.equal(await c.none(), true);
    assert.equal(app.rooms.get(code).status, 'lobby');
  });

  it('broadcasts game_end and marks the room as ended', async () => {
    const { host, code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    host.send({ type: 'end_game' });
    await c.nextType('game_end');
    await host.nextType('game_end');
    assert.equal(app.rooms.get(code).status, 'ended');
  });

  // ---- rejoin -----------------------------------------------------------
  it('supports rejoining a team after a disconnect', async () => {
    const { host, code } = await createRoom();
    const { c: first, joined } = await joinRoom(code, 'Alpha');
    first.close();
    await delay(50);
    assert.equal(app.rooms.get(code).teams.get(joined.teamId).ws, null);

    const again = await client();
    again.send({ type: 'rejoin', code, teamId: joined.teamId });
    const rejoined = await again.nextType('rejoined');
    assert.equal(rejoined.room.teams.length, 1);
    const serverTeam = app.rooms.get(code).teams.get(joined.teamId);
    assert.ok(serverTeam.ws, 'server should attach the reconnected socket');
    assert.equal(serverTeam.ws._teamId, joined.teamId);
    assert.equal(serverTeam.ws.readyState, 1);

    host.send({ type: 'start_game' });
    await again.nextType('game_start');
    again.send({ type: 'score_update', score: 30, floor: 1, streak: 1 });
    const lb = await again.nextType('leaderboard');
    assert.equal(lb.teams[0].score, 30);
  });

  it('silently ignores invalid rejoin attempts', async () => {
    const { code } = await createRoom();
    const c = await client();
    c.send({ type: 'rejoin', code, teamId: 'nope' });
    c.send({ type: 'rejoin', code: 'ZZZZZZ', teamId: 'nope' });
    assert.equal(await c.none(), true);
  });

  // ---- disconnects ------------------------------------------------------
  it('keeps a disconnected team in the room and notifies the host', async () => {
    const { host, code } = await createRoom();
    const { c, joined } = await joinRoom(code, 'Alpha');
    await delay(30);
    host.clear();
    c.close();
    const update = await host.next((m) => m.type === 'room_update');
    assert.equal(update.room.teams.length, 1);
    assert.equal(update.room.teams[0].id, joined.teamId);
    assert.equal(app.rooms.get(code).teams.get(joined.teamId).ws, null);
  });

  it('keeps the room alive when the host disconnects', async () => {
    const { host, code } = await createRoom();
    await joinRoom(code, 'Alpha');
    host.close();
    await delay(50);
    const room = app.rooms.get(code);
    assert.ok(room, 'room should still exist');
    assert.equal(room.hostWs, null);
  });

  it('ignores disconnects from sockets that never joined', async () => {
    const c = await client();
    c.close();
    await delay(20);
    assert.equal(app.rooms.size, 0);
  });

  // ---- rooms ------------------------------------------------------------
  it('keeps rooms isolated from each other', async () => {
    const { host: hostA, code: codeA } = await createRoom();
    const { host: hostB, code: codeB } = await createRoom();
    const { c: teamA } = await joinRoom(codeA, 'Alpha');
    const { c: teamB } = await joinRoom(codeB, 'Beta');
    teamA.clear();
    teamB.clear();

    hostA.send({ type: 'start_game' });
    await teamA.nextType('game_start');
    teamA.send({ type: 'score_update', score: 77, floor: 3, streak: 1 });
    await teamA.nextType('leaderboard');

    assert.equal(app.rooms.get(codeA).status, 'playing');
    assert.equal(app.rooms.get(codeB).status, 'lobby');
    assert.equal(app.rooms.get(codeB).teams.get(app.rooms.get(codeB).teams.keys().next().value).score, 0);
    assert.equal(await teamB.none(100), true);

    hostB.send({ type: 'start_game' });
    const startB = await teamB.nextType('game_start');
    assert.equal(startB.serverTime > 0, true);
  });

  it('cleans up rooms older than the TTL', async () => {
    const { code } = await createRoom();
    app.rooms.get(code).createdAt = Date.now() - 3 * 60 * 60 * 1000;
    assert.equal(app.cleanupNow(), 1);
    assert.equal(app.rooms.size, 0);
  });

  it('runs periodic cleanup automatically', async () => {
    const shortLived = createVsServer({ roomTtlMs: 0, cleanupIntervalMs: 10 });
    const address = await shortLived.listen(0, '127.0.0.1');
    const c = await openClient(address.port);
    try {
      c.send({ type: 'create_room', adminPassword: shortLived.config.adminPassword });
      await c.nextType('room_created');
      await delay(60);
      assert.equal(shortLived.rooms.size, 0);
    } finally {
      c.close();
      await delay(10);
      await shortLived.close();
    }
  });

  // ---- protocol robustness ---------------------------------------------
  it('ignores malformed JSON and unknown message types', async () => {
    const c = await client();
    c.send('this is not json');
    c.send({ type: 'unknown_type' });
    c.send({});
    c.send({ type: 'join_room' });
    // join_room without fields produces an error, so consume it.
    assert.equal((await c.nextType('error')).message, 'Kode & nama tim wajib');

    c.send({ type: 'create_room', adminPassword: app.config.adminPassword });
    const created = await c.nextType('room_created');
    assert.equal(created.code.length, 6);
  });

  // ---- spectator & telemetry -------------------------------------------
  it('relays player_state to a spectating admin for every team', async () => {
    const { host, code } = await createRoom();
    const teams = [];
    for (let i = 1; i <= 4; i++) {
      const { c, joined } = await joinRoom(code, `Tim ${i}`);
      teams.push({ client: c, teamId: joined.teamId });
    }
    await startGame(host);
    for (const t of teams) await t.client.nextType('game_start');

    for (let i = 0; i < teams.length; i++) sendState(teams[i].client, { f: i, sc: 100 + i });
    await waitUntil(() => teams.every((t) => app.rooms.get(code).teams.get(t.teamId).state));

    const obs = await spectate(code);
    const ok = await obs.nextType('spectate_ok');
    assert.equal(ok.code, code);
    assert.equal(ok.duration, 180);
    assert.equal(typeof ok.startedAt, 'number');
    assert.equal(ok.observers, 1);
    assert.equal(ok.room.teams.length, 4);

    const seen = new Map();
    for (let i = 0; i < 4; i++) {
      const ps = await obs.nextType('player_state');
      seen.set(ps.teamId, ps);
    }
    assert.deepEqual([...seen.keys()].sort(), teams.map((t) => t.teamId).sort());
    assert.equal(seen.get(teams[2].teamId).s.f, 2);
    assert.equal(seen.get(teams[2].teamId).s.sc, 102);
    for (const ps of seen.values()) assert.equal(typeof ps.t, 'number');
  });

  it('rejects spectate with a wrong admin password', async () => {
    const { code } = await createRoom();
    const obs = await spectate(code, 'wrong');
    assert.equal((await obs.nextType('error')).message, 'Password admin salah');
    assert.equal(app.rooms.get(code).observers.size, 0);
  });

  it('rejects spectate for an unknown room code', async () => {
    const obs = await spectate('ZZZZZZ');
    assert.equal((await obs.nextType('error')).message, 'Room tidak ditemukan');
  });

  it('sends the latest stored snapshot to a spectator joining mid-game', async () => {
    const { host, code } = await createRoom();
    const { c, joined } = await joinRoom(code, 'Alpha');
    await startGame(host);
    await c.nextType('game_start');
    sendState(c, { f: 5, sc: 250 });
    await waitUntil(() => app.rooms.get(code).teams.get(joined.teamId).state);

    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    const ps = await obs.nextType('player_state');
    assert.equal(ps.teamId, joined.teamId);
    assert.deepEqual(ps.s, snapshot({ f: 5, sc: 250 }));
    assert.equal(ps.t, app.rooms.get(code).teams.get(joined.teamId).stateAt);
  });

  it('ignores player_state sent by a spectator connection', async () => {
    const { host, code } = await createRoom();
    const { c, joined } = await joinRoom(code, 'Alpha');
    await startGame(host);
    await c.nextType('game_start');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    obs.clear();

    obs.send({ type: 'player_state', s: snapshot() });
    assert.equal(await obs.none(120), true);
    assert.equal(app.rooms.get(code).teams.get(joined.teamId).state, null);
  });

  it('does not leak telemetry to teams or the host', async () => {
    const { host, code } = await createRoom();
    const { c: a, joined } = await joinRoom(code, 'Alpha');
    const { c: b } = await joinRoom(code, 'Beta');
    await startGame(host);
    await a.nextType('game_start');
    await b.nextType('game_start');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    a.clear(); b.clear(); host.clear();

    sendState(a);
    const ps = await obs.nextType('player_state');
    assert.equal(ps.teamId, joined.teamId);
    await delay(120);
    for (const c of [a, b, host]) {
      assert.equal(c.messages.some((m) => m.type === 'player_state'), false);
    }
  });

  it('notifies observers with team_offline when a team socket closes', async () => {
    const { host, code } = await createRoom();
    const { c, joined } = await joinRoom(code, 'Alpha');
    await startGame(host);
    await c.nextType('game_start');
    sendState(c);
    await waitUntil(() => app.rooms.get(code).teams.get(joined.teamId).state);
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');

    c.close();
    const offline = await obs.nextType('team_offline');
    assert.equal(offline.teamId, joined.teamId);
    // state terakhir tetap disimpan supaya bisa direplay saat rejoin/spectate lagi
    assert.ok(app.rooms.get(code).teams.get(joined.teamId).state);
  });

  it('keeps relaying telemetry after a team rejoins', async () => {
    const { host, code } = await createRoom();
    const { c, joined } = await joinRoom(code, 'Alpha');
    await startGame(host);
    await c.nextType('game_start');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');

    sendState(c, { f: 1 });
    assert.equal((await obs.nextType('player_state')).s.f, 1);

    c.close();
    await obs.nextType('team_offline');

    const again = await client();
    again.send({ type: 'rejoin', code, teamId: joined.teamId });
    await again.nextType('rejoined');
    await again.nextType('game_start');

    sendState(again, { f: 9 });
    const ps = await obs.nextType('player_state');
    assert.equal(ps.teamId, joined.teamId);
    assert.equal(ps.s.f, 9);
  });

  it('does not count observers as teams and allows spectating in the lobby', async () => {
    const { code } = await createRoom();
    const { joined } = await joinRoom(code, 'Alpha');
    // kode lowercase juga diterima (server trim + uppercase)
    const obs = await spectate(code.toLowerCase());
    const ok = await obs.nextType('spectate_ok');
    assert.equal(ok.code, code);
    assert.equal(ok.room.status, 'lobby');
    assert.equal(ok.startedAt, null);
    assert.deepEqual(ok.room.teams.map((t) => t.id), [joined.teamId]);
    assert.equal(ok.observers, 1);
    assert.equal(app.rooms.get(code).teams.size, 1);
    assert.equal(app.rooms.get(code).observers.size, 1);
  });

  it('sends existing room broadcasts such as game_start to spectators', async () => {
    const { host, code } = await createRoom({ materi: 'food_kitchen', duration: 60 });
    await joinRoom(code, 'Alpha');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');

    host.send({ type: 'start_game' });
    const start = await obs.nextType('game_start');
    assert.equal(start.materi, 'food_kitchen');
    assert.equal(start.duration, 60);
    assert.equal(typeof start.serverTime, 'number');
  });

  it('keeps spectator traffic isolated between rooms', async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    const { c: teamA, joined: joinedA } = await joinRoom(roomA.code, 'Alpha');
    const { c: teamB } = await joinRoom(roomB.code, 'Beta');
    await startGame(roomA.host);
    await startGame(roomB.host);
    await teamA.nextType('game_start');
    await teamB.nextType('game_start');

    const obsA = await spectate(roomA.code);
    await obsA.nextType('spectate_ok');
    const obsB = await spectate(roomB.code);
    await obsB.nextType('spectate_ok');
    obsA.clear(); obsB.clear();

    sendState(teamA, { f: 3 });
    const ps = await obsA.nextType('player_state');
    assert.equal(ps.teamId, joinedA.teamId);
    await delay(120);
    assert.equal(obsB.messages.some((m) => m.type === 'player_state'), false);
    assert.equal(app.rooms.get(roomA.code).observers.size, 1);
    assert.equal(app.rooms.get(roomB.code).observers.size, 1);
  });

  it('forgets an observer when its socket closes (without a fake room_update)', async () => {
    const { code } = await createRoom();
    await joinRoom(code, 'Alpha');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    await waitUntil(() => app.rooms.get(code).observers.size === 1);

    obs.close();
    await waitUntil(() => app.rooms.get(code).observers.size === 0);
  });

  it('removes the observer on spectate_leave without replying', async () => {
    const { code } = await createRoom();
    await joinRoom(code, 'Alpha');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    obs.clear();

    obs.send({ type: 'spectate_leave' });
    assert.equal(await obs.none(120), true);
    assert.equal(app.rooms.get(code).observers.size, 0);
  });

  it('sanitizes telemetry before relaying to spectators', async () => {
    const { host, code } = await createRoom();
    const { c } = await joinRoom(code, 'Alpha');
    await startGame(host);
    await c.nextType('game_start');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    obs.clear();

    c.send({
      type: 'player_state',
      s: {
        f: -9, sc: 7.8, stk: 'x',
        cx: NaN, cy: Infinity, sr: 1e12,
        ss: 's'.repeat(40), se: 42,
        sk: 9, kx: 9, ky: -3,
        b: [NaN, 2], l: 'nope',
        r: { x: 1, y: 2, t: 't'.repeat(100), ok: 0, st: 'zz', br: 'yes', fy: Infinity },
        tr: Array.from({ length: 12 }, (_, i) => [i, -i, i, i % 2]),
        q: { t: 'q'.repeat(300), e: '🍔'.repeat(10) },
        alien: 'dibuang',
      },
    });
    const ps = await obs.nextType('player_state');
    assert.equal(ps.s.f, 0);
    assert.equal(ps.s.sc, 7);
    assert.equal('stk' in ps.s, false);
    assert.equal('cx' in ps.s, false);
    assert.equal('cy' in ps.s, false);
    assert.equal(ps.s.sr, 1e6);
    assert.equal(ps.s.ss.length, 16);
    assert.equal('se' in ps.s, false);
    assert.equal(ps.s.sk, 1);
    assert.equal(ps.s.kx, 2);
    assert.equal(ps.s.ky, 0.5);
    assert.equal(ps.s.b, null);
    assert.equal(ps.s.l, null);
    assert.equal(ps.s.r.t.length, 80);
    assert.equal(ps.s.r.st, 'n');
    assert.equal(ps.s.r.br, 1);
    assert.equal('fy' in ps.s.r, false);
    assert.equal(ps.s.tr.length, 8);
    assert.equal(ps.s.q.t.length, 160);
    assert.equal(ps.s.q.e.length, 8);
    assert.equal('alien' in ps.s, false);

    // `s` bukan objek -> pesan diabaikan, tidak ada relay
    obs.clear();
    c.send({ type: 'player_state', s: 'nope' });
    assert.equal(await obs.none(150), true);
  });

  it('cleanup removes rooms together with their observers', async () => {
    const { code } = await createRoom();
    await joinRoom(code, 'Alpha');
    const obs = await spectate(code);
    await obs.nextType('spectate_ok');
    const room = app.rooms.get(code);
    assert.equal(room.observers.size, 1);

    room.createdAt = Date.now() - 3 * 60 * 60 * 1000;
    assert.equal(app.cleanupNow(), 1);
    assert.equal(app.rooms.has(code), false);
    assert.equal(app.cleanupNow(), 0);
  });
});

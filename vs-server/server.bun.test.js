// vs-server/server.bun.test.js — run with: bun test server.bun.test.js
// Covers the Bun adapter: static allowlist, health, and the full VS room flow
// over both WebSocket paths (/ws and /vs-ws).

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBunServer, resolvePublicPath } from './server.bun.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameHtml = readFileSync(path.join(ROOT, 'game.html'), 'utf8');

function vsFor(location) {
  const match = gameHtml.match(/const VS = \{[\s\S]*?\n\};/);
  if (!match) throw new Error('VS object not found in game.html');
  return new Function('location', `${match[0]}\nreturn VS;`)(location);
}

const app = createBunServer({ port: 0, hostname: '127.0.0.1', adminPassword: 'test-pass' });
const base = `http://127.0.0.1:${app.port}`;
const wsBase = `ws://127.0.0.1:${app.port}`;

afterAll(() => app.stop());

function makeClient(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });

  return {
    ws,
    open: new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect ${url}`)), { once: true });
    }),
    send(obj) { ws.send(JSON.stringify(obj)); },
    next(type, timeoutMs = 3000) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const j = waiters.indexOf(waiter);
          if (j >= 0) {
            waiters.splice(j, 1);
            reject(new Error(`timeout waiting for "${type}"`));
          }
        }, timeoutMs);
      });
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function connect(path = '/ws') {
  const client = makeClient(wsBase + path);
  await client.open;
  return client;
}

describe('static file serving', () => {
  test('/health reports an empty room list', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.rooms).toBe('number');
  });

  test('serves the landing page and game files', async () => {
    for (const file of ['/', '/index.html', '/game.html', '/star_pou_vs.html', '/star_pou_sky_climber.html']) {
      const res = await fetch(base + file);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect((await res.text()).length).toBeGreaterThan(1000);
    }
  });

  test('serves admin and design assets', async () => {
    const admin = await fetch(`${base}/admin/index.html`);
    expect(admin.status).toBe(200);
    const adminNoSlash = await fetch(`${base}/admin`);
    expect(adminNoSlash.status).toBe(200);
    expect(await adminNoSlash.text()).toContain('admin');
    const design = await fetch(`${base}/design/probe.txt`);
    expect(design.status).toBe(200);
  });

  test('admin panel ships the Tonton Live spectator launcher', async () => {
    const html = await (await fetch(`${base}/admin/index.html`)).text();
    expect(html).toContain('Tonton Live');
    expect(html).toContain('id="specFrame"');
    expect(html).toContain('allow="fullscreen; gamepad"');
    expect(html).toContain('sev7en-admin-pass');
    expect(html).toContain('sev7en-spec-exit');
    expect(html).toContain('&spectate=1');
  });

  test('rejects server sources, dotfiles, traversal, and unknown files', async () => {
    for (const path of [
      '/vs-server/server.js',
      '/vs-server/server.bun.js',
      '/vs-server/.env.example',
      '/tests/vs-server.test.js',
      '/node_modules/ws/index.js',
      '/.git/config',
      '/..%2f..%2fetc%2fpasswd',
      '/package.json',
    ]) {
      const res = await fetch(base + path);
      expect(res.status).toBe(404);
    }
  });

  test('resolvePublicPath only resolves the allowlist', () => {
    expect(resolvePublicPath('/')).toMatch(/index\.html$/);
    expect(resolvePublicPath('/game.html')).toMatch(/game\.html$/);
    expect(resolvePublicPath('/admin/index.html')).toMatch(/admin[\\/]index\.html$/);
    expect(resolvePublicPath('/vs-server/server.js')).toBeNull();
    expect(resolvePublicPath('/../secret.txt')).toBeNull();
  });

  test('HEAD requests return headers without a body', async () => {
    const res = await fetch(`${base}/game.html`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('VS room flow over /ws', () => {
  test('create, join, start, score, and finish', async () => {
    const host = await connect('/ws');
    const team = await connect('/ws');

    host.send({ type: 'create_room', adminPassword: 'test-pass', materi: 'ipa', duration: 120 });
    const created = await host.next('room_created');
    expect(created.code).toHaveLength(6);
    expect(created.room.status).toBe('lobby');

    team.send({ type: 'join_room', code: created.code.toLowerCase(), teamName: 'Tim Merah' });
    const joined = await team.next('joined');
    expect(joined.code).toBe(created.code);
    expect(joined.room.teams).toHaveLength(1);
    await host.next('room_update');

    host.send({ type: 'start_game' });
    const startTeam = await team.next('game_start');
    const startHost = await host.next('game_start');
    expect(startTeam.materi).toBe('ipa');
    expect(startTeam.duration).toBe(120);
    expect(startHost.serverTime).toBe(startTeam.serverTime);

    team.send({ type: 'score_update', score: 42, floor: 3, streak: 2 });
    const board = await team.next('leaderboard');
    expect(board.teams[0]).toMatchObject({ name: 'Tim Merah', score: 42, floor: 3, streak: 2 });
    await host.next('leaderboard'); // host receives the same update

    team.send({ type: 'finish', score: 50, floor: 4 });
    const final = await host.next('leaderboard');
    expect(final.teams[0]).toMatchObject({ name: 'Tim Merah', score: 50, floor: 4 });

    host.send({ type: 'end_game' });
    await team.next('game_end');
    await host.next('game_end');

    host.close();
    team.close();
  });

  test('rejects a wrong admin password and unknown room codes', async () => {
    const client = await connect('/ws');
    client.send({ type: 'create_room', adminPassword: 'nope' });
    expect((await client.next('error')).message).toBe('Password admin salah');

    client.send({ type: 'join_room', code: 'ZZZZZZ', teamName: 'Tim' });
    expect((await client.next('error')).message).toBe('Room tidak ditemukan');
    client.close();
  });

  test('all teams see each other in the lobby', async () => {
    const host = await connect('/ws');
    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');

    const a = await connect('/ws');
    a.send({ type: 'join_room', code, teamName: 'Tim A' });
    await a.next('joined');
    await Promise.all([a.next('room_update'), host.next('room_update')]);

    const b = await connect('/ws');
    b.send({ type: 'join_room', code, teamName: 'Tim B' });
    await b.next('joined');

    const updates = await Promise.all([
      a.next('room_update'),
      b.next('room_update'),
      host.next('room_update'),
    ]);
    for (const update of updates) {
      expect(update.room.teams.map((t) => t.name).sort()).toEqual(['Tim A', 'Tim B']);
    }

    host.close();
    a.close();
    b.close();
  });

  test('rejoin_host recovers host control after a disconnect', async () => {
    const host = await connect('/ws');
    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');

    const team = await connect('/ws');
    team.send({ type: 'join_room', code, teamName: 'Tim Recovery' });
    await team.next('joined');
    await host.next('room_update');

    host.close();

    const host2 = await connect('/ws');
    host2.send({ type: 'rejoin_host', code, adminPassword: 'test-pass' });
    const rejoined = await host2.next('rejoined_host');
    expect(rejoined.room.teams.some((t) => t.name === 'Tim Recovery')).toBe(true);

    host2.send({ type: 'start_game' });
    const start = await host2.next('game_start');
    expect(start.materi).toBe('all');
    await team.next('game_start');

    host2.close();
    team.close();
  });

  test('rejoin during a running game resumes with game_start', async () => {
    const host = await connect('/ws');
    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');

    const team = await connect('/ws');
    team.send({ type: 'join_room', code, teamName: 'Tim Lanjut' });
    const { teamId } = await team.next('joined');
    await host.next('room_update');

    host.send({ type: 'start_game' });
    await host.next('game_start');
    await team.next('game_start');

    team.close();

    const again = await connect('/ws');
    again.send({ type: 'rejoin', code, teamId });
    const rejoined = await again.next('rejoined');
    expect(rejoined.room.status).toBe('playing');
    const resumed = await again.next('game_start');
    expect(resumed.materi).toBe('all');

    host.close();
    again.close();
  });

  test('rejoin_host is rejected with a wrong password', async () => {
    const host = await connect('/ws');
    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');
    host.close();

    const impostor = await connect('/ws');
    impostor.send({ type: 'rejoin_host', code, adminPassword: 'wrong' });
    impostor.send({ type: 'start_game' });
    expect((await impostor.next('error')).message).toBe('Hanya host yang bisa start');
    impostor.close();
  });

  test('rejoin rebinds a team after reconnect', async () => {
    const host = await connect('/ws');
    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');

    const first = await connect('/ws');
    first.send({ type: 'join_room', code, teamName: 'Tim Biru' });
    const { teamId } = await first.next('joined');
    first.close();

    const second = await connect('/ws');
    second.send({ type: 'rejoin', code, teamId });
    const rejoined = await second.next('rejoined');
    expect(rejoined.room.teams.some((t) => t.id === teamId && t.name === 'Tim Biru')).toBe(true);

    host.close();
    second.close();
  });

  test('spectator receives live telemetry and team_offline', async () => {
    const host = await connect('/ws');
    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');

    const team = await connect('/ws');
    team.send({ type: 'join_room', code, teamName: 'Tim Live' });
    const { teamId } = await team.next('joined');
    await host.next('room_update');

    host.send({ type: 'start_game' });
    await host.next('game_start');
    await team.next('game_start');

    // admin spectator boleh join mid-game
    const spec = await connect('/ws');
    spec.send({ type: 'spectate', code, adminPassword: 'test-pass' });
    const ok = await spec.next('spectate_ok');
    expect(ok.code).toBe(code);
    expect(ok.observers).toBe(1);
    expect(ok.room.teams.some((t) => t.id === teamId)).toBe(true);

    team.send({ type: 'player_state', s: { f: 2, sc: 30, ss: 'jumping', cx: 1.5, cy: -20, kx: 9 } });
    const live = await spec.next('player_state');
    expect(live.teamId).toBe(teamId);
    expect(live.s).toMatchObject({ f: 2, sc: 30, ss: 'jumping', cx: 1.5, cy: -20 });
    expect(live.s.kx).toBe(2); // clamp skala

    team.close();
    const offline = await spec.next('team_offline');
    expect(offline.teamId).toBe(teamId);

    spec.close();
    host.close();
  });
});

describe('VS room flow over /vs-ws', () => {
  test('the production proxy path upgrades and speaks the same protocol', async () => {
    const host = await connect('/vs-ws');
    const team = await connect('/vs-ws');

    host.send({ type: 'create_room', adminPassword: 'test-pass' });
    const { code } = await host.next('room_created');

    team.send({ type: 'join_room', code, teamName: 'Tim Hijau' });
    const joined = await team.next('joined');
    expect(joined.teamId).toBeTruthy();
    await host.next('room_update');

    host.close();
    team.close();
  });
});

describe('client WS URL resolution', () => {
  test('file:// falls back to the local VS server on 3001', () => {
    const vs = vsFor({ protocol: 'file:', hostname: '', port: '', origin: 'null' });
    expect(vs.getWsUrls()).toEqual(['ws://localhost:3001/ws']);
  });

  test('same origin is preferred when the Bun server serves the page', () => {
    const vs = vsFor({ protocol: 'http:', hostname: 'localhost', port: '3001', origin: 'http://localhost:3001' });
    expect(vs.getWsUrls()).toEqual(['ws://localhost:3001/ws']);
  });

  test('a separate static dev server falls back to port 3001', () => {
    const vs = vsFor({ protocol: 'http:', hostname: 'localhost', port: '5500', origin: 'http://localhost:5500' });
    expect(vs.getWsUrls()).toEqual([
      'ws://localhost:5500/ws',
      'ws://localhost:3001/ws',
    ]);
  });

  test('LAN clients use the page port, then 3001, then /vs-ws', () => {
    const vs = vsFor({ protocol: 'http:', hostname: '192.168.1.10', port: '5500', origin: 'http://192.168.1.10:5500' });
    expect(vs.getWsUrls()).toEqual([
      'ws://192.168.1.10:5500/ws',
      'ws://192.168.1.10:3001/ws',
      'ws://192.168.1.10/vs-ws',
    ]);
  });

  test('production keeps using the nginx /vs-ws path', () => {
    const vs = vsFor({ protocol: 'https:', hostname: 'sev7en.cerap.web.id', port: '', origin: 'https://sev7en.cerap.web.id' });
    expect(vs.getWsUrls()).toEqual(['wss://sev7en.cerap.web.id/vs-ws']);
  });
});

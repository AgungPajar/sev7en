// tests/game-vs-client.test.js
// Unit tests for the VS (realtime multiplayer) client embedded in game.html.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGamePage, mulberry32, plain, startGame } from './helpers/game-page.js';

const load = (opts = {}) => loadGamePage('game.html', { random: mulberry32(7), ...opts });

const VS = (page) => page.get('VS');

function openSocket(page) {
  page.call('vsConnect');
  const ws = page.lastWs();
  assert.ok(ws, 'expected a WebSocket instance');
  ws.open();
  return ws;
}

function sentJson(ws, index = -1) {
  const raw = index < 0 ? ws.sent[ws.sent.length + index] : ws.sent[index];
  assert.ok(raw, `no message at index ${index}`);
  return JSON.parse(raw);
}

const team = (id, name, extra = {}) => ({ id, name, score: 0, floor: 0, streak: 0, ...extra });
const room = (teams = [], extra = {}) => ({ code: 'ABC123', materi: 'all', duration: 180, status: 'lobby', teams, ...extra });

describe('VS client — connection URL', () => {
  // README "Alur koneksi WebSocket & reconnect": same-origin first, then the
  // local VS server (:3001) for file:// / a separate static server, then the
  // host:3001 and nginx /vs-ws fallbacks in production.
  it('prefers the same-origin socket on localhost, then the local VS server', () => {
    const page = load();
    assert.deepEqual(plain(page.get('VS').getWsUrls()), [
      'ws://localhost:8080/ws',
      'ws://localhost:3001/ws',
    ]);
    assert.equal(page.get('VS').getWsUrl(), 'ws://localhost:8080/ws');
  });

  it('prefers the same-origin socket on 127.0.0.1, then the local VS server', () => {
    const page = load({ hostname: '127.0.0.1', host: '127.0.0.1:8080' });
    assert.deepEqual(plain(page.get('VS').getWsUrls()), [
      'ws://127.0.0.1:8080/ws',
      'ws://localhost:3001/ws',
    ]);
  });

  it('uses /vs-ws over https in production', () => {
    const page = load({
      hostname: 'sev7en.cerap.web.id',
      host: 'sev7en.cerap.web.id',
      port: '',
      protocol: 'https:',
      origin: 'https://sev7en.cerap.web.id',
    });
    assert.deepEqual(plain(page.get('VS').getWsUrls()), ['wss://sev7en.cerap.web.id/vs-ws']);
    assert.equal(page.get('VS').getWsUrl(), 'wss://sev7en.cerap.web.id/vs-ws');
  });

  it('uses /vs-ws over http in production', () => {
    const page = load({
      hostname: 'sev7en.cerap.web.id',
      host: 'sev7en.cerap.web.id',
      port: '',
      protocol: 'http:',
      origin: 'http://sev7en.cerap.web.id',
    });
    assert.deepEqual(plain(page.get('VS').getWsUrls()), ['ws://sev7en.cerap.web.id/vs-ws']);
    assert.equal(page.get('VS').getWsUrl(), 'ws://sev7en.cerap.web.id/vs-ws');
  });

  it('tries the same-origin socket then /vs-ws for a LAN page', () => {
    const page = load({ hostname: '192.168.1.5', host: '192.168.1.5:3001', port: '3001' });
    assert.deepEqual(plain(page.get('VS').getWsUrls()), [
      'ws://192.168.1.5:3001/ws',
      'ws://192.168.1.5/vs-ws',
    ]);
  });

  it('falls back to the local VS server when opened from file://', () => {
    const page = load({ protocol: 'file:', hostname: '', host: '', port: '', origin: 'null' });
    assert.deepEqual(plain(page.get('VS').getWsUrls()), ['ws://localhost:3001/ws']);
  });
});

describe('VS client — vsConnect()', () => {
  it('opens a socket to the computed URL', () => {
    const page = load();
    page.call('vsConnect');
    assert.equal(page.wsInstances.length, 1);
    assert.equal(page.lastWs().url, 'ws://localhost:8080/ws');
  });

  it('does not open a second socket while the current one is open', () => {
    const page = load();
    openSocket(page);
    page.call('vsConnect');
    assert.equal(page.wsInstances.length, 1);
  });

  it('reconnects after 2 s when enabled and in a room', () => {
    const page = load();
    const ws = openSocket(page);
    VS(page).enabled = true;
    VS(page).code = 'ABC123';
    ws.close();
    assert.equal(page.wsInstances.length, 1);
    page.advance(1999);
    assert.equal(page.wsInstances.length, 1);
    page.advance(1);
    assert.equal(page.wsInstances.length, 2);
  });

  it('does not reconnect once the room code is gone', () => {
    const page = load();
    const ws = openSocket(page);
    VS(page).enabled = false;
    VS(page).code = null;
    VS(page).teamId = null;
    ws.close();
    page.advance(5000);
    assert.equal(page.wsInstances.length, 1);
  });
});

describe('VS client — incoming messages', () => {
  it('handles room_created and shows the host lobby', () => {
    const page = load();
    const ws = openSocket(page);
    ws.receive({ type: 'room_created', code: 'NEW123', room: room([]) });

    assert.equal(VS(page).code, 'NEW123');
    assert.equal(VS(page).isHost, true);
    assert.equal(page.el('vs-code-display').textContent, 'NEW123');
    assert.equal(page.el('vs-share-link').textContent, 'http://localhost/game.html?code=NEW123#join');
    assert.equal(page.el('vs-create-result').style.display, 'block');
    assert.equal(page.el('vs-create-err').style.display, 'none');
    assert.equal(page.el('vs-bar').style.display, 'flex');
    assert.equal(page.el('vs-code-badge').textContent, 'KODE NEW123');
    assert.equal(page.el('vs-teams-count').textContent, '0 tim');
    assert.equal(page.el('vs-leaderboard').style.display, 'block');
  });

  it('handles joined and enters the waiting room', () => {
    const page = load({ hash: '#join' });
    const ws = openSocket(page);
    ws.receive({ type: 'joined', code: 'ABC123', teamId: 't1', room: room([team('t1', 'Alpha')]) });

    assert.equal(VS(page).code, 'ABC123');
    assert.equal(VS(page).teamId, 't1');
    assert.equal(VS(page).isHost, false);
    assert.equal(page.el('modal').style.display, 'none');
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('vs-card-create').style.display, 'none');
    assert.equal(page.el('vs-card-join').style.display, 'block');
    assert.equal(page.el('vs-join-code').style.display, 'none');
    assert.equal(page.el('vs-join-name').style.display, 'none');
    assert.equal(page.query('#vs-card-join .vs-btn-primary').style.display, 'none');
    assert.equal(page.query('#vs-card-join .vs-btn-ghost').textContent, 'Keluar Lobby');
    assert.equal(page.el('vs-join-lobby').style.display, 'block');
    assert.match(page.el('vs-join-status').textContent, /kamu di lobby \(ABC123\)/);
    assert.match(page.el('vs-join-status').textContent, /menunggu host memulai/);
    assert.equal(page.el('vs-join-err').style.display, 'none');
    assert.equal(page.el('vs-bar').style.display, 'flex');
    assert.equal(page.el('vs-teams-count').textContent, '1 tim');
  });

  it('removes the early-join style override when joined', () => {
    const page = load({ hash: '#join' });
    assert.ok(page.document.head.children.some((c) => c.id === 'early-join-hide-style'));
    const ws = openSocket(page);
    ws.receive({ type: 'joined', code: 'ABC123', teamId: 't1', room: room([team('t1', 'Alpha')]) });
    assert.ok(!page.document.head.children.some((c) => c.id === 'early-join-hide-style'));
  });

  it('renders the host lobby on room_update', () => {
    const page = load();
    VS(page).isHost = true;
    const ws = openSocket(page);
    ws.receive({
      type: 'room_update',
      room: room([team('t1', 'Alpha', { score: 30 }), team('t2', 'Beta', { score: 10 })]),
    });
    const html = page.el('vs-lobby-host').innerHTML;
    assert.match(html, /Alpha/);
    assert.match(html, /30 pts/);
    assert.match(html, /Beta/);
    assert.match(html, /10 pts/);
    assert.equal(page.el('vs-teams-count').textContent, '2 tim');
  });

  it('renders the guest lobby on room_update', () => {
    const page = load();
    VS(page).isHost = false;
    VS(page).teamId = 't1';
    const ws = openSocket(page);
    ws.receive({
      type: 'room_update',
      room: room([team('t1', 'Me', { floor: 3 }), team('t2', 'Other', { floor: 1 })]),
    });
    const html = page.el('vs-lobby-guest').innerHTML;
    assert.match(html, /Me \(kamu\)/);
    assert.match(html, /3 tangga/);
    assert.match(html, /Other/);
    assert.match(html, /1 tangga/);
  });

  it('starts the game from game_start', () => {
    const page = load();
    VS(page).teamName = 'Tim A';
    VS(page).isHost = false;
    page.el('team-input').value = '';
    const ws = openSocket(page);

    ws.receive({ type: 'game_start', materi: 'living_room', duration: 60 });

    assert.equal(VS(page).enabled, true);
    assert.equal(page.el('vs-modal').style.display, 'none');
    assert.equal(page.el('modal').style.display, 'none');
    assert.equal(page.el('topic-select').value, 'living_room');
    assert.equal(page.el('duration-select').value, '60');
    assert.equal(page.el('team-input').value, 'Tim A');
    assert.equal(page.get('_vsMateri'), 'living_room');
    assert.equal(page.get('gameRunning'), true);
    assert.equal(page.get('activePool.length'), 50);
    assert.equal(page.el('team-display').textContent, 'TIM A');
  });

  it('normalises legacy or unknown materi to the single Living Room theme', () => {
    for (const materi of ['all', 'food_kitchen', 'there_prep', 'unknown_xyz']) {
      const page = load();
      const ws = openSocket(page);
      ws.receive({ type: 'game_start', materi, duration: 60 });
      assert.equal(page.el('topic-select').value, 'living_room', materi);
      assert.equal(page.get('activePool.length'), 50, materi);
      assert.equal(page.get('_vsMateri'), 'living_room', materi);
      assert.equal(page.get('gameRunning'), true, materi);
    }
  });

  it('stores and renders the leaderboard', () => {
    const page = load();
    VS(page).teamId = 't2';
    const ws = openSocket(page);
    const teams = Array.from({ length: 12 }, (_, i) =>
      team(`t${i + 1}`, `Team ${i + 1}`, { score: (12 - i) * 10, floor: 12 - i }));
    ws.receive({ type: 'leaderboard', teams });

    assert.equal(VS(page).lb.length, 12);
    const html = page.el('vs-lb-list').innerHTML;
    assert.match(html, /🥇/);
    assert.match(html, /🥈/);
    assert.match(html, /🥉/);
    assert.match(html, /4\./);
    assert.match(html, /Team 1/);
    assert.match(html, /1200 m/);
    assert.match(html, /120 pts/);
    // Only the top 10 are rendered
    assert.ok(!html.includes('Team 11'), '11th team should not be rendered');
    assert.ok(!html.includes('Team 12'), '12th team should not be rendered');
    // The local team is highlighted
    assert.match(html, /rgba\(59,130,246,\.18\)/);
    assert.match(html, /1px solid #3b82f6/);
  });

  it('ends the game on game_end', () => {
    const page = load();
    const ws = openSocket(page);
    ws.receive({ type: 'game_end' });
    assert.equal(page.el('modal').style.display, 'flex');
    assert.equal(page.el('modal-title').textContent, '🎉 WAKTU HABIS!');
  });

  it('shows host/create errors in the create form', () => {
    const page = load();
    VS(page).isHost = true;
    const ws = openSocket(page);
    const btn = page.query('#vs-card-join .vs-btn-primary');
    btn.disabled = true;
    btn.textContent = 'Masuk…';

    ws.receive({ type: 'error', message: 'Password admin salah' });

    assert.equal(page.el('vs-create-err').textContent, 'Password admin salah');
    assert.equal(page.el('vs-create-err').style.display, 'block');
    assert.equal(btn.textContent, 'Join Lobby');
    assert.equal(btn.disabled, false);
    assert.equal(btn.style.display, '');
  });

  it('shows join errors in the join form for a joined team', () => {
    const page = load();
    VS(page).isHost = false;
    VS(page).teamId = 't1';
    const ws = openSocket(page);
    ws.receive({ type: 'error', message: 'Room penuh (10 tim)' });
    assert.equal(page.el('vs-join-err').textContent, 'Room penuh (10 tim)');
    assert.equal(page.el('vs-join-err').style.display, 'block');
  });

  it('ignores malformed JSON and keeps working', () => {
    const page = load();
    const ws = openSocket(page);
    assert.doesNotThrow(() => ws.receive('{not json'));
    ws.receive({ type: 'room_created', code: 'OK1234', room: room([]) });
    assert.equal(VS(page).code, 'OK1234');
  });
});

describe('VS client — lobby helpers', () => {
  it('vsShowBar falls back to the room code', () => {
    const page = load();
    VS(page).code = null;
    page.call('vsShowBar', room([team('a', 'A'), team('b', 'B'), team('c', 'C')], { code: 'XYZ789' }));
    assert.equal(page.el('vs-bar').style.display, 'flex');
    assert.equal(page.el('vs-code-badge').textContent, 'KODE XYZ789');
    assert.equal(page.el('vs-teams-count').textContent, '3 tim');
    assert.equal(page.el('vs-leaderboard').style.display, 'block');
  });

  it('renderLobbyHost shows a hint when empty', () => {
    const page = load();
    page.call('renderLobbyHost', room([]));
    assert.match(page.el('vs-lobby-host').innerHTML, /Belum ada tim join/);
  });

  it('renderLobbyHost lists names and scores', () => {
    const page = load();
    page.call('renderLobbyHost', room([team('a', 'Alpha', { score: 5 }), team('b', 'Beta', { score: 7 })]));
    const html = page.el('vs-lobby-host').innerHTML;
    assert.match(html, /Alpha/);
    assert.match(html, /5 pts/);
    assert.match(html, /Beta/);
    assert.match(html, /7 pts/);
  });

  it('renderLobbyGuest marks the local team', () => {
    const page = load();
    VS(page).teamId = 'b';
    page.call('renderLobbyGuest', room([team('a', 'Alpha', { floor: 2 }), team('b', 'Beta', { floor: 4 })]));
    const html = page.el('vs-lobby-guest').innerHTML;
    assert.match(html, /Alpha/);
    assert.match(html, /2 tangga/);
    assert.match(html, /Beta \(kamu\)/);
    assert.match(html, /4 tangga/);
  });

  it('renderLeaderboard handles an empty list', () => {
    const page = load();
    page.call('renderLeaderboard', []);
    assert.equal(page.el('vs-lb-list').innerHTML, '');
  });

  it('renderLeaderboard assigns medals by rank', () => {
    const page = load();
    page.call('renderLeaderboard', [team('a', 'A', { score: 3 }), team('b', 'B', { score: 2 }), team('c', 'C', { score: 1 }), team('d', 'D', { score: 0 })]);
    const html = page.el('vs-lb-list').innerHTML;
    assert.match(html, /🥇.*A/);
    assert.match(html, /🥈.*B/);
    assert.match(html, /🥉.*C/);
    assert.match(html, /4\..*D/);
  });
});

describe('VS client — lobby UI actions', () => {
  it('vsOpenCreate switches to the create card and connects', () => {
    const page = load({ search: '?code=abc123' });
    page.call('vsOpenCreate');
    assert.equal(page.el('modal').style.display, 'none');
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('vs-card-create').style.display, 'block');
    assert.equal(page.el('vs-card-join').style.display, 'none');
    assert.equal(page.el('vs-join-code').value, 'ABC123');
    assert.equal(page.wsInstances.length, 1);
  });

  it('vsOpenJoin resets the join card and connects', () => {
    const page = load({ hash: '#join', search: '?code=abc123' });
    page.call('vsOpenJoin');
    assert.equal(page.el('modal').style.display, 'none');
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('vs-card-create').style.display, 'none');
    assert.equal(page.el('vs-card-join').style.display, 'block');
    assert.equal(page.el('vs-join-code').style.display, '');
    assert.equal(page.el('vs-join-name').style.display, '');
    assert.equal(page.query('#vs-card-join .vs-btn-primary').style.display, '');
    assert.equal(page.el('vs-join-lobby').style.display, 'none');
    assert.equal(page.el('vs-join-err').style.display, 'none');
    assert.equal(page.el('vs-join-code').value, 'ABC123');
    assert.equal(page.wsInstances.length, 1);
    assert.ok(!page.document.head.children.some((c) => c.id === 'early-join-hide-style'));
  });

  it('vsClose hides the dialog and reveals the main menu', () => {
    const page = load();
    page.el('vs-modal').style.display = 'flex';
    page.el('modal').style.display = 'none';
    VS(page).teamId = null;
    VS(page).enabled = false;
    page.call('vsClose');
    assert.equal(page.el('vs-modal').style.display, 'none');
    assert.equal(page.el('modal').style.display, 'flex');
  });

  it('vsClose never drops a joined team back to the menu', () => {
    const page = load();
    page.el('vs-modal').style.display = 'flex';
    page.el('modal').style.display = 'none';
    VS(page).teamId = 't1';
    page.call('vsClose');
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('modal').style.display, 'none');
  });

  it('vsClose keeps the menu hidden while a VS game is enabled', () => {
    const page = load();
    page.el('vs-modal').style.display = 'flex';
    page.el('modal').style.display = 'none';
    VS(page).teamId = null;
    VS(page).enabled = true;
    page.call('vsClose');
    assert.equal(page.el('vs-modal').style.display, 'none');
    assert.equal(page.el('modal').style.display, 'none');
  });

  it('vsCopyLink copies the share link and alerts', () => {
    const page = load();
    page.el('vs-share-link').textContent = 'http://example.test/game.html?code=ABC123#join';
    page.call('vsCopyLink');
    assert.deepEqual(page.clipboard.written, ['http://example.test/game.html?code=ABC123#join']);
    assert.deepEqual(page.alerts, ['Link disalin: http://example.test/game.html?code=ABC123#join']);
  });

  it('vsStartGame does nothing without a socket', () => {
    const page = load();
    assert.doesNotThrow(() => page.call('vsStartGame'));
  });

  it('vsStartGame sends start_game when connected', () => {
    const page = load();
    const ws = openSocket(page);
    page.call('vsStartGame');
    assert.deepEqual(sentJson(ws), { type: 'start_game' });
  });
});

describe('VS client — create room', () => {
  it('sends create_room with the form values once the socket opens', () => {
    const page = load();
    page.el('vs-admin-pass').value = 'secret';
    page.el('vs-materi').value = 'living_room';
    page.el('vs-duration').value = '60';

    page.call('vsCreateRoom');
    const ws = page.lastWs();
    assert.equal(ws.readyState, 0);
    page.advance(300);
    assert.equal(ws.sent.length, 0);

    ws.open();
    page.advance(200);
    assert.equal(ws.sent.length, 1);
    assert.deepEqual(sentJson(ws), {
      type: 'create_room',
      adminPassword: 'secret',
      materi: 'living_room',
      duration: '60',
    });
  });

  it('sends immediately when the socket is already open', () => {
    const page = load();
    page.el('vs-admin-pass').value = 'pw';
    page.el('vs-materi').value = 'living_room';
    page.el('vs-duration').value = '180';
    const ws = openSocket(page);
    page.call('vsCreateRoom');
    page.advance(300);
    assert.equal(ws.sent.length, 1);
    assert.equal(sentJson(ws).type, 'create_room');
  });
});

describe('VS client — join room', () => {
  it('validates that code and name are present', () => {
    const page = load();
    page.el('vs-join-code').value = '';
    page.el('vs-join-name').value = '';
    page.call('vsJoinRoom');
    assert.equal(page.el('vs-join-err').textContent, 'Kode & nama tim wajib');
    assert.equal(page.el('vs-join-err').style.display, 'block');
    assert.equal(page.wsInstances.length, 0);
  });

  it('validates the code length', () => {
    const page = load();
    page.el('vs-join-code').value = 'ABC12';
    page.el('vs-join-name').value = 'Tim A';
    page.call('vsJoinRoom');
    assert.equal(page.el('vs-join-err').textContent, 'Kode harus 6 huruf');
    assert.equal(page.el('vs-join-err').style.display, 'block');
    assert.equal(page.wsInstances.length, 0);
  });

  it('normalises input, disables the button and sends join_room', () => {
    const page = load();
    page.el('vs-join-code').value = ' abc123 ';
    page.el('vs-join-name').value = '  Tim A  ';
    const btn = page.query('#vs-card-join .vs-btn-primary');

    page.call('vsJoinRoom');
    assert.equal(VS(page).teamName, 'Tim A');
    assert.equal(btn.textContent, 'Masuk…');
    assert.equal(btn.disabled, true);
    assert.equal(page.el('vs-join-err').style.display, 'none');

    const ws = page.lastWs();
    assert.ok(ws);
    page.advance(300);
    assert.equal(ws.sent.length, 0);
    ws.open();
    page.advance(200);
    assert.equal(ws.sent.length, 1);
    assert.deepEqual(sentJson(ws), { type: 'join_room', code: 'ABC123', teamName: 'Tim A' });
  });

  it('re-enables the button after the 12 s safety timeout without a response', () => {
    const page = load();
    page.el('vs-join-code').value = 'ABC123';
    page.el('vs-join-name').value = 'Tim A';
    const btn = page.query('#vs-card-join .vs-btn-primary');
    page.call('vsJoinRoom');
    const ws = page.lastWs();
    ws.open();
    page.advance(300 + 200);
    assert.equal(ws.sent.length, 1);
    assert.equal(btn.disabled, true, 'button stays disabled while waiting for the server');
    page.advance(4000);
    assert.equal(btn.disabled, true, '4 s is shorter than the shipped 12 s safety guard');
    page.advance(8000);
    assert.equal(btn.textContent, 'Join Lobby');
    assert.equal(btn.disabled, false);
  });

  it('keeps the button disabled after joining', () => {
    const page = load();
    page.el('vs-join-code').value = 'ABC123';
    page.el('vs-join-name').value = 'Tim A';
    const btn = page.query('#vs-card-join .vs-btn-primary');
    page.call('vsJoinRoom');
    VS(page).teamId = 't1';
    page.advance(4000);
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'Masuk…');
  });

  it('recovers when sending fails', () => {
    const page = load();
    page.el('vs-join-code').value = 'ABC123';
    page.el('vs-join-name').value = 'Tim A';
    const btn = page.query('#vs-card-join .vs-btn-primary');
    const ws = openSocket(page);
    ws.send = () => { throw new Error('socket gone'); };

    page.call('vsJoinRoom');
    page.advance(300);

    assert.equal(btn.textContent, 'Join Lobby');
    assert.equal(btn.disabled, false);
    assert.equal(page.el('vs-join-err').textContent, 'Gagal konek — coba lagi');
    assert.equal(page.el('vs-join-err').style.display, 'block');
  });
});

describe('VS client — score sync hook', () => {
  it('does not push scores when VS is disabled', () => {
    const page = load();
    const ws = openSocket(page);
    page.call('updateHUD');
    assert.equal(ws.sent.length, 0);
  });

  it('pushes score/floor/streak when VS is enabled', () => {
    const page = load();
    const ws = openSocket(page);
    VS(page).enabled = true;
    page.eval('score = 120; floorLevel = 3; streak = 2;');
    page.call('updateHUD');
    assert.equal(ws.sent.length, 1);
    assert.deepEqual(sentJson(ws), { type: 'score_update', score: 120, floor: 3, streak: 2 });
  });

  it('throttles pushes to one per 400 ms', () => {
    const page = load();
    const ws = openSocket(page);
    VS(page).enabled = true;
    page.call('updateHUD');
    page.call('updateHUD');
    page.call('updateHUD');
    assert.equal(ws.sent.length, 1);
    page.advance(399);
    page.call('updateHUD');
    assert.equal(ws.sent.length, 1);
    page.advance(2);
    page.call('updateHUD');
    assert.equal(ws.sent.length, 2);
  });

  it('does not push when the socket is closed', () => {
    const page = load();
    const ws = openSocket(page);
    VS(page).enabled = true;
    ws.close();
    page.call('updateHUD');
    assert.equal(ws.sent.length, 0);
  });

  it('updates the in-game leaderboard timer', () => {
    const page = load();
    openSocket(page);
    VS(page).enabled = true;
    page.eval('timeLeft = 65;');
    page.call('updateHUD');
    assert.equal(page.el('vs-lb-timer').textContent, '01:05');
    page.eval('timeLeft = 5;');
    page.call('updateHUD');
    assert.equal(page.el('vs-lb-timer').textContent, '00:05');
  });

  it('leaves the timer alone for endless games', () => {
    const page = load();
    openSocket(page);
    VS(page).enabled = true;
    page.el('vs-lb-timer').textContent = 'KEEP';
    page.eval('timeLeft = 9000;');
    page.call('updateHUD');
    assert.equal(page.el('vs-lb-timer').textContent, 'KEEP');
  });
});

describe('VS client — URL auto-join', () => {
  it('prefills the join code from the query string', () => {
    const page = load({ search: '?code=abc123' });
    assert.equal(page.el('vs-join-code').value, 'ABC123');
  });

  it('auto-joins when code and team are present', () => {
    const page = load({ search: '?code=abc123&team=Tim%20A', hash: '#join' });

    page.advance(200); // tryOpen -> vsOpenJoin
    assert.equal(page.el('vs-join-code').value, 'ABC123');
    assert.equal(page.el('vs-join-name').value, 'Tim A');

    page.advance(500); // scheduled vsJoinRoom
    const ws = page.lastWs();
    assert.ok(ws, 'expected a websocket for auto-join');
    page.advance(300);
    ws.open();
    page.advance(200);

    assert.equal(ws.sent.length, 1);
    assert.deepEqual(sentJson(ws), { type: 'join_room', code: 'ABC123', teamName: 'Tim A' });
  });

  it('opens the join dialog but does not auto-join with only a code', () => {
    const page = load({ search: '?code=abc123' });
    page.advance(200);
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('vs-join-code').value, 'ABC123');
    page.advance(2000);
    assert.equal(page.lastWs().sent.length, 0);
  });

  it('reopens the join dialog on hashchange', () => {
    const page = load();
    page.location.hash = '#join';
    page.fireWindow('hashchange');
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('vs-card-join').style.display, 'block');
  });
});

// =====================================================================
// Spectator admin ("Tonton Live") + player telemetry
// =====================================================================
// game.html has two features layered on the VS block:
//  - telemetry: while a VS match runs, every client posts a compact
//    `{type:'player_state', s:{...}}` snapshot ~8x/s;
//  - spectator: /game.html?code=KODE&spectate=1 renders one software-3D camera
//    pane per team (grid, tabs, focus mode, per-player zoom).
// The snapshot wire format is documented here by its consumers:
//   f floor, sc score, stk streak, cx/cy camera, sx/sy star position,
//   ss/se star state/expression, sr/sk rotation/progress, kx/ky scale,
//   b base platform, l/r answer options, tr climbed trail (x,y,level,status),
//   q active question {t,e}. A trail row with level 0 is the START platform.
const SPEC = (page) => page.get('SPEC');

const specTeam = (id, name, extra = {}) => ({ id, name, score: 0, floor: 0, streak: 0, ...extra });

const playerSnapshot = (overrides = {}) => ({
  f: 3, sc: 350, stk: 2,
  cx: 0, cy: -630, sx: 0, sy: -678,
  ss: 'idle', se: 'happy', sr: 0, sk: 0, kx: 1, ky: 1,
  b: [0, 0],
  l: { x: -230, y: -840, t: 'dinner', ok: 1, st: 'n', br: 0, fy: 0 },
  r: { x: 230, y: -840, t: 'breakfast', ok: 0, st: 'n', br: 0, fy: 0 },
  tr: [[0, 0, 0, 'correct'], [0, -210, 1, 'correct']],
  q: { t: 'It is 7 a.m. in the morning. I eat ______.', e: '🌅🍛' },
  ...overrides,
});

// Open the spectator URL and let the shipped 300 ms auto-start timer fire.
function spectatorPage(opts = {}) {
  const page = load({ search: '?code=ABC123&spectate=1', ...opts });
  page.advance(400);
  return page;
}

function connectSpectator(page) {
  const ws = page.lastWs();
  assert.ok(ws, 'the spectator page should have opened a WebSocket');
  if (ws.readyState !== 1) ws.open();
  return ws;
}

// A started spectator page seeded with `count` teams via spectate_ok.
function startedSpectator(count = 4, opts = {}) {
  const page = spectatorPage(opts);
  const ws = connectSpectator(page);
  const teams = Array.from({ length: count }, (_, i) => specTeam(`t${i + 1}`, `Tim ${i + 1}`));
  page.call('vsSpecOnMessage', {
    type: 'spectate_ok', code: 'ABC123',
    room: { code: 'ABC123', status: 'playing', teams },
    startedAt: page.clock.now, duration: 180,
  });
  return { page, ws, teams };
}

describe('VS client — telemetry snapshot (vsCollectPlayerState)', () => {
  it('returns the full documented snapshot contract after startGame()', () => {
    const page = load();
    startGame(page);
    const snap = plain(page.call('vsCollectPlayerState'));

    assert.deepEqual(Object.keys(snap).sort(), [
      'b', 'cx', 'cy', 'f', 'kx', 'ky', 'l', 'q', 'r', 'sc', 'se',
      'sk', 'sr', 'ss', 'stk', 'sx', 'sy', 'tr',
    ]);
    assert.equal(snap.f, 0);
    assert.equal(snap.sc, 0);
    assert.equal(snap.stk, 0);
    assert.equal(snap.ss, 'idle');
    assert.equal(snap.se, 'happy');
    assert.deepEqual(snap.b, [0, 0]);
    assert.equal(snap.kx, 1);
    assert.equal(snap.ky, 1);
    // The trail encodes climbed platforms as [x, y, level, status]; the START
    // rung is level 0 (the spectator derives `isStart` from it and renders
    // "START (0m)" in the 3D scene — asserted in the render tests below).
    assert.deepEqual(snap.tr, [[0, 0, 0, 'correct']]);

    const left = page.get('leftOptionPlat');
    const right = page.get('rightOptionPlat');
    assert.equal(snap.l.t, left.text);
    assert.equal(snap.r.t, right.text);
    assert.deepEqual(Object.keys(snap.l).sort(), ['br', 'fy', 'ok', 'st', 't', 'x', 'y']);
    assert.deepEqual(Object.keys(snap.r).sort(), ['br', 'fy', 'ok', 'st', 't', 'x', 'y']);
    assert.equal(snap.l.x, left.wx);
    assert.equal(snap.l.y, left.wy);
    assert.equal(snap.r.x, right.wx);
    assert.equal(snap.l.ok, left.isCorrect ? 1 : 0);
    assert.equal(snap.r.ok, right.isCorrect ? 1 : 0);
    assert.equal(snap.l.st, 'n');
    assert.equal(snap.l.br, 0);
    assert.equal(snap.l.fy, 0);

    const qText = page.el('q-text').textContent;
    const qEmoji = page.el('q-emoji').textContent;
    assert.ok(qText.length > 0);
    assert.ok(qEmoji.length > 0);
    assert.deepEqual(snap.q, { t: qText.slice(0, 160), e: qEmoji.slice(0, 8) });
  });

  it('tracks a correct climb (floor/score/streak/trail change)', () => {
    const page = load();
    startGame(page);
    const before = plain(page.call('vsCollectPlayerState'));
    assert.ok(before.q.t.length > 0);

    const correctSide = page.get('leftOptionPlat.isCorrect') ? 'left' : 'right';
    page.call('triggerJump', correctSide);
    page.frames(40);
    assert.equal(page.get('star.state'), 'celebrating');
    page.advance(550); // celebrate -> idle + fresh question/options
    assert.equal(page.get('star.state'), 'idle');

    const after = plain(page.call('vsCollectPlayerState'));
    assert.equal(after.f, 1);
    assert.equal(after.sc, 100);
    assert.ok(after.sc > before.sc);
    assert.equal(after.stk, 1);
    assert.ok(after.tr.length > before.tr.length);
    assert.deepEqual(after.tr[after.tr.length - 1], [correctSide === 'left' ? -230 : 230, -210, 1, 'correct']);
    assert.equal(after.l.t, page.get('leftOptionPlat.text'));
    assert.equal(after.r.t, page.get('rightOptionPlat.text'));
    assert.equal(after.b[1], -210);
    assert.equal(after.q.t, page.el('q-text').textContent);
    assert.equal(after.q.e, page.el('q-emoji').textContent);
  });
});

describe('VS client — telemetry stream', () => {
  const playerStates = (ws) =>
    ws.sent.map((raw) => JSON.parse(raw)).filter((msg) => msg.type === 'player_state');

  function startVsGame(page, ws) {
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, serverTime: page.clock.now });
    page.advance(300);
  }

  it('sends player_state at ~8 Hz only while a VS game is running', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    page.call('vsStartTelemetry');
    ws.open();
    page.advance(300);
    assert.equal(playerStates(ws).length, 0, 'telemetry must be silent before the match starts');

    ws.receive({ type: 'game_start', materi: 'all', duration: 180, serverTime: page.clock.now });
    assert.equal(VS(page).enabled, true);
    assert.equal(page.get('gameRunning'), true);
    page.advance(300);

    const states = playerStates(ws);
    assert.ok(states.length >= 2, `expected several snapshots in 300 ms, got ${states.length}`);
    for (const msg of states) {
      assert.equal(typeof msg.s, 'object');
      assert.equal(Number.isInteger(msg.s.f), true, 's.f must be an integer floor');
      assert.equal(Number.isInteger(msg.s.sc), true, 's.sc must be an integer score');
      assert.equal(typeof msg.s.q.t, 'string');
      assert.ok(msg.s.q.t.length > 0);
      assert.ok(Array.isArray(msg.s.tr));
    }
  });

  it('stops on vsStopTelemetry() and can be restarted', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    page.call('vsStartTelemetry');
    startVsGame(page, ws);
    const before = playerStates(ws).length;
    assert.ok(before >= 2);

    page.call('vsStopTelemetry');
    page.advance(1000);
    assert.equal(playerStates(ws).length, before, 'no player_state after vsStopTelemetry()');

    page.call('vsStartTelemetry');
    page.advance(300);
    assert.ok(playerStates(ws).length > before, 'telemetry must restart');
  });

  it('stops when endGame() runs', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    page.call('vsStartTelemetry');
    startVsGame(page, ws);
    const before = playerStates(ws).length;
    assert.ok(before >= 2);

    page.call('endGame');
    page.advance(1000);
    assert.equal(playerStates(ws).length, before, 'endGame() must stop the telemetry timer');
  });

  it('stops on a game_end message from the server', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    page.call('vsStartTelemetry');
    startVsGame(page, ws);
    const before = playerStates(ws).length;
    assert.ok(before >= 2);

    ws.receive({ type: 'game_end' });
    page.advance(1000);
    assert.equal(playerStates(ws).length, before, 'game_end must stop the telemetry timer');
    assert.equal(page.get('gameRunning'), false);
  });
});

describe('VS client — spectator from URL', () => {
  it('starts the spectator UI from ?code=..&spectate=1', () => {
    const page = load({ search: '?code=ABC123&spectate=1' });
    assert.equal(SPEC(page).active, false, 'the shipped code waits for a short timer');
    assert.doesNotThrow(() => page.advance(400));

    assert.equal(SPEC(page).active, true);
    assert.equal(SPEC(page).code, 'ABC123');
    assert.equal(SPEC(page).status, 'lobby');
    assert.equal(SPEC(page).err, '');
    assert.equal(page.document.body.classList.contains('spectate-mode'), true);
    assert.equal(page.document.body.className, 'spectate-mode');
    assert.equal(typeof page.get('window.__spectator.frame'), 'function');

    // pointer + wheel listeners for the spectator controls are registered on
    // top of the original game pointerdown listener.
    const listeners = page.el('gameCanvas')._listeners;
    assert.ok(listeners.pointerdown.length >= 2);
    assert.equal(listeners.pointermove.length, 1);
    assert.equal(listeners.wheel.length, 1);

    const ws = connectSpectator(page);
    const sent = ws.sent.map((raw) => JSON.parse(raw));
    assert.deepEqual(sent.find((msg) => msg.type === 'spectate'), {
      type: 'spectate', code: 'ABC123', adminPassword: '',
    });
  });

  it('does not start the spectator from a code without spectate=1', () => {
    const page = load({ search: '?code=ABC123' });
    page.advance(400);
    assert.equal(SPEC(page).active, false);
    assert.equal(SPEC(page).code, null);
    assert.ok(!page.get('window.__spectator'));
    assert.equal(page.document.body.classList.contains('spectate-mode'), false);
    // ...the regular VS join lobby still opens for that URL.
    assert.equal(page.el('vs-modal').style.display, 'flex');
  });

  it('does not start the spectator without any query parameters', () => {
    const page = load();
    page.advance(400);
    assert.equal(SPEC(page).active, false);
    assert.ok(!page.get('window.__spectator'));
    assert.equal(page.document.body.classList.contains('spectate-mode'), false);
  });

  it('ignores spectate=1 without a room code', () => {
    for (const search of ['?spectate=1', '?code=&spectate=1', '?code=%20&spectate=true']) {
      const page = load({ search });
      page.advance(400);
      assert.equal(SPEC(page).active, false, `unexpected spectator start for "${search}"`);
    }
  });
});

describe('VS client — spectator message ingest', () => {
  it('spectate_ok connects, seeds the teams and sets the room status', () => {
    const page = load();
    page.call('vsSpecStart', 'abc123', 'secret');
    assert.equal(SPEC(page).active, true);
    assert.equal(SPEC(page).code, 'ABC123', 'room codes are normalised to upper case');

    page.call('vsSpecOnMessage', {
      type: 'spectate_ok', code: 'ABC123',
      room: {
        code: 'ABC123', status: 'playing',
        teams: [specTeam('t1', 'Alpha'), specTeam('t2', 'Beta'), specTeam('t3', 'Gamma'), specTeam('t4', 'Delta')],
      },
      startedAt: 1700000000123, duration: 180,
    });

    assert.equal(SPEC(page).connected, true);
    assert.equal(SPEC(page).status, 'playing');
    assert.equal(SPEC(page).startedAt, 1700000000123);
    assert.equal(SPEC(page).duration, 180);
    assert.equal(SPEC(page).err, '');
    const view = plain(page.call('vsSpecView'));
    assert.equal(view.active, true);
    assert.equal(view.connected, true);
    assert.equal(view.code, 'ABC123');
    assert.equal(view.status, 'playing');
    assert.equal(view.selectedId, 't1');
    assert.deepEqual(view.teams.map((team) => team.id), ['t1', 't2', 't3', 't4']);
    assert.deepEqual(view.teams.map((team) => team.name), ['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('routes WebSocket messages through the spectator handler instead of the lobby', () => {
    const page = spectatorPage();
    const ws = connectSpectator(page);
    ws.receive({ type: 'spectate_ok', code: 'ABC123', room: { code: 'ABC123', status: 'lobby', teams: [specTeam('t1', 'Alpha')] } });
    assert.equal(SPEC(page).connected, true);
    assert.equal(plain(page.call('vsSpecView')).teams.length, 1);
    assert.ok(!page.el('vs-bar').style.display, 'spectator messages must not paint the VS lobby bar');
  });

  it('player_state updates score/floor/streak/online/hasData per team', () => {
    const { page } = startedSpectator(4);
    page.call('vsSpecOnMessage', {
      type: 'player_state', teamId: 't2',
      s: playerSnapshot({ f: 5, sc: 820, stk: 3, cx: 120, cy: -1050, sx: 110, sy: -1098, q: { t: 'Soal aktif?', e: '🚀' } }),
    });

    const view = plain(page.call('vsSpecView'));
    const t2 = view.teams.find((team) => team.id === 't2');
    assert.equal(t2.score, 820);
    assert.equal(t2.floor, 5);
    assert.equal(t2.streak, 3);
    assert.equal(t2.online, true);
    assert.equal(t2.hasData, true);
    assert.equal(t2.lastAt, page.clock.now);
    // Snapshot is kept for the info bar and the smooth pane interpolation.
    assert.equal(page.get('SPEC.teams.get("t2").snap.q.t'), 'Soal aktif?');
    assert.equal(page.get('SPEC.teams.get("t2").target.camY'), -1050);
    assert.equal(page.get('SPEC.teams.get("t2").target.starY'), -1098);
    assert.equal(page.get('SPEC.teams.get("t2").view.starY'), -48, 'view starts from the default pose');

    const untouched = view.teams.filter((team) => team.id !== 't2');
    for (const team of untouched) {
      assert.equal(team.hasData, false);
      assert.equal(team.floor, 0);
      assert.equal(team.online, true, 'teams are online until told otherwise');
    }
  });

  it('team_offline marks only the disconnected team offline', () => {
    const { page } = startedSpectator(4);
    page.call('vsSpecOnMessage', { type: 'player_state', teamId: 't1', s: playerSnapshot() });
    page.call('vsSpecOnMessage', { type: 'player_state', teamId: 't2', s: playerSnapshot({ f: 4, sc: 400 }) });
    page.call('vsSpecOnMessage', { type: 'team_offline', teamId: 't2' });

    const teams = plain(page.call('vsSpecView')).teams;
    assert.equal(teams.find((team) => team.id === 't2').online, false);
    assert.equal(teams.find((team) => team.id === 't2').hasData, true, 'last snapshot is kept on disconnect');
    assert.equal(teams.find((team) => team.id === 't1').online, true);
  });

  it('leaderboard updates known teams without adding new rows', () => {
    const { page } = startedSpectator(3);
    page.call('vsSpecOnMessage', {
      type: 'leaderboard',
      teams: [{ id: 't1', score: 900, floor: 9, streak: 4 }, { id: 't9', score: 1, floor: 0, streak: 0 }],
    });
    const view = plain(page.call('vsSpecView'));
    assert.equal(view.teams.length, 3, 'leaderboard must not invent teams');
    const t1 = view.teams.find((team) => team.id === 't1');
    assert.equal(t1.score, 900);
    assert.equal(t1.floor, 9);
    assert.equal(t1.streak, 4);
  });

  it('room_update adds teams that joined later', () => {
    const { page } = startedSpectator(2);
    page.call('vsSpecOnMessage', {
      type: 'room_update',
      room: { code: 'ABC123', status: 'playing', teams: [specTeam('t1', 'Tim 1'), specTeam('t2', 'Tim 2'), specTeam('t3', 'Baru'), specTeam('t4', 'Lagi')] },
    });
    const view = plain(page.call('vsSpecView'));
    assert.deepEqual(view.teams.map((team) => team.id), ['t1', 't2', 't3', 't4']);
    assert.equal(view.teams.find((team) => team.id === 't3').name, 'Baru');
  });

  it('error and game lifecycle messages update the spectator state', () => {
    const { page } = startedSpectator(2);
    page.call('vsSpecOnMessage', { type: 'error', message: 'Password admin salah' });
    assert.equal(SPEC(page).err, 'Password admin salah');
    assert.equal(plain(page.call('vsSpecView')).err, 'Password admin salah');

    page.call('vsSpecOnMessage', { type: 'game_start', serverTime: 1700000000200, duration: 60 });
    assert.equal(SPEC(page).status, 'playing');
    assert.equal(SPEC(page).startedAt, 1700000000200);
    assert.equal(SPEC(page).duration, 60);

    page.call('vsSpecOnMessage', { type: 'game_end' });
    assert.equal(SPEC(page).status, 'ended');
  });
});

describe('VS client — spectator layout & zoom', () => {
  function layoutPage(count, focusId = null) {
    const page = load();
    page.call('vsSpecStart', 'ABC123', '');
    const teams = Array.from({ length: count }, (_, i) => specTeam(`t${i + 1}`, `Tim ${i + 1}`));
    page.call('vsSpecOnMessage', { type: 'spectate_ok', code: 'ABC123', room: { code: 'ABC123', status: 'playing', teams } });
    if (focusId) {
      page.call('specSelect', focusId);
      page.call('specToggleFocus');
    }
    return page;
  }

  it('lays 4 teams out as a 2x2 grid of non-overlapping panes', () => {
    const page = layoutPage(4);
    const L = plain(page.call('specComputeLayout', 1440, 900));
    assert.equal(L.panes.length, 4);
    assert.equal(L.tabs.length, 4);

    // Two columns, two rows: same-row panes share y, same-column panes share x.
    assert.equal(L.panes[0].y, L.panes[1].y);
    assert.equal(L.panes[2].y, L.panes[3].y);
    assert.ok(L.panes[2].y > L.panes[0].y, 'second row must be below the first');
    assert.equal(L.panes[0].x, L.panes[2].x);
    assert.ok(L.panes[1].x > L.panes[0].x, 'second column must be to the right');

    for (const pane of L.panes) assert.ok(pane.w > 100 && pane.h > 100, 'panes must be usable');
    for (let i = 0; i < L.panes.length; i++) {
      for (let j = i + 1; j < L.panes.length; j++) {
        const a = L.panes[i], b = L.panes[j];
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.equal(overlaps, false, `panes ${i} and ${j} overlap`);
      }
    }
    for (const pane of L.panes) {
      assert.ok(pane.x >= L.grid.x - 1e-6 && pane.x + pane.w <= L.grid.x + L.grid.w + 1e-6);
      assert.ok(pane.y >= L.grid.y - 1e-6 && pane.y + pane.h <= L.grid.y + L.grid.h + 1e-6);
    }
  });

  it('lays a single team out as one full-grid pane', () => {
    const page = layoutPage(1);
    const L = plain(page.call('specComputeLayout', 1440, 900));
    assert.equal(L.panes.length, 1);
    assert.equal(L.tabs.length, 1);
    assert.equal(L.panes[0].teamId, 't1');
    assert.ok(Math.abs(L.panes[0].w - L.grid.w) < 1e-6);
    assert.ok(Math.abs(L.panes[0].h - L.grid.h) < 1e-6);
  });

  it('lays 10 teams out as 10 panes in a 4-column grid', () => {
    const page = layoutPage(10);
    const L = plain(page.call('specComputeLayout', 1440, 900));
    assert.equal(L.panes.length, 10);
    assert.equal(L.tabs.length, 10);
    assert.equal(L.panes[0].y, L.panes[3].y, 'first four panes share a row');
    assert.ok(L.panes[4].y > L.panes[0].y);
    assert.equal(L.panes[4].x, L.panes[0].x, 'row 2 starts back at the first column');
    assert.ok(L.panes[1].x > L.panes[0].x);
  });

  it('focus mode keeps only the selected team pane', () => {
    const page = layoutPage(4, 't3');
    assert.equal(SPEC(page).focus, true);
    const L = plain(page.call('specComputeLayout', 1440, 900));
    assert.equal(L.panes.length, 1);
    assert.equal(L.panes[0].teamId, 't3');
    assert.ok(Math.abs(L.panes[0].w - L.grid.w) < 1e-6);

    page.call('specToggleFocus');
    assert.equal(plain(page.call('specComputeLayout', 1440, 900)).panes.length, 4);
  });

  it('clamps per-team zoom to 0.7..2.4 and keeps teams independent', () => {
    const page = layoutPage(3);
    const zoom = (id) => page.get(`SPEC.teams.get("${id}").zoom`);
    assert.equal(page.get('SPEC_MIN_ZOOM'), 0.7);
    assert.equal(page.get('SPEC_MAX_ZOOM'), 2.4);
    assert.equal(zoom('t1'), 1);

    page.call('specSetZoom', 't1', 99);
    assert.equal(zoom('t1'), 2.4);
    page.call('specSetZoom', 't2', 0.1);
    assert.equal(zoom('t2'), 0.7);
    page.call('specZoomBy', 't1', -0.2);
    page.call('specZoomBy', 't2', 0.2);
    assert.equal(zoom('t1'), 2.2);
    assert.equal(zoom('t2'), 0.9);
    assert.equal(zoom('t3'), 1, 'zoom is stored per player/team');

    page.call('specSetZoom', 't1', NaN);
    page.call('specSetZoom', 't1', Infinity);
    assert.equal(zoom('t1'), 2.2, 'non-finite zoom values are ignored');
    assert.doesNotThrow(() => page.call('specSetZoom', 'nope', 2));
    assert.doesNotThrow(() => page.call('specZoomBy', 'nope', 0.2));
  });
});

describe('VS client — spectator hit-testing & controls', () => {
  function gridPage(count = 4) {
    const { page } = startedSpectator(count);
    page.eval('SPEC.layout = specComputeLayout(W, H)');
    return page;
  }
  const centre = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

  it('hit-tests the zoom buttons and body of every pane', () => {
    const page = gridPage();
    const L = plain(page.get('SPEC.layout'));
    for (const pane of L.panes) {
      for (const kind of ['zoomIn', 'zoomOut', 'zoomReset']) {
        const point = centre(pane[kind]);
        assert.deepEqual(plain(page.call('specHitTest', point.x, point.y)), { kind, teamId: pane.teamId });
      }
      const point = centre(pane);
      assert.deepEqual(plain(page.call('specHitTest', point.x, point.y)), { kind: 'pane', teamId: pane.teamId });
    }
  });

  it('hit-tests team tabs and the top-bar buttons', () => {
    const page = gridPage();
    const L = plain(page.get('SPEC.layout'));
    L.tabs.forEach((tab, i) => {
      const point = centre(tab);
      assert.deepEqual(plain(page.call('specHitTest', point.x, point.y)), { kind: 'tab', teamId: L.panes[i].teamId });
    });
    const mode = centre(L.mode);
    assert.deepEqual(plain(page.call('specHitTest', mode.x, mode.y)), { kind: 'mode' });
    const exit = centre(L.exit);
    assert.deepEqual(plain(page.call('specHitTest', exit.x, exit.y)), { kind: 'exit' });
    assert.equal(page.call('specHitTest', L.grid.x - 5, L.grid.y - 5), null);
  });

  it('pointerdown on a pane zoom button zooms and selects that team', () => {
    const page = gridPage();
    const L = plain(page.get('SPEC.layout'));
    const pane = L.panes[1]; // team t2
    let point = centre(pane.zoomIn);
    page.call('specOnPointerDown', { clientX: point.x, clientY: point.y });
    assert.equal(SPEC(page).selectedId, 't2');
    assert.equal(page.get('SPEC.teams.get("t2").zoom'), 1.2);

    point = centre(pane.zoomOut);
    page.call('specOnPointerDown', { clientX: point.x, clientY: point.y });
    assert.equal(page.get('SPEC.teams.get("t2").zoom'), 1);

    page.call('specSetZoom', 't2', 2);
    point = centre(pane.zoomReset);
    page.call('specOnPointerDown', { clientX: point.x, clientY: point.y });
    assert.equal(page.get('SPEC.teams.get("t2").zoom'), 1);
  });

  it('pointerdown on a tab selects the team and enters focus mode', () => {
    const page = gridPage();
    const L = plain(page.get('SPEC.layout'));
    const tab = L.tabs[2];
    page.call('specOnPointerDown', { clientX: tab.x + tab.w / 2, clientY: tab.y + tab.h / 2 });
    assert.equal(SPEC(page).selectedId, 't3');
    assert.equal(SPEC(page).focus, true);
    page.eval('SPEC.layout = specComputeLayout(W, H)');
    assert.equal(plain(page.get('SPEC.layout')).panes.length, 1);
  });

  it('pointerdown on a pane body selects it without toggling focus', () => {
    const page = gridPage();
    page.eval('SPEC.focus = false; SPEC.layout = specComputeLayout(W, H);');
    const L = plain(page.get('SPEC.layout'));
    const pane = L.panes[3];
    const point = centre(pane);
    page.call('specOnPointerDown', { clientX: point.x, clientY: point.y });
    assert.equal(SPEC(page).selectedId, 't4');
    assert.equal(SPEC(page).focus, false);
  });

  it('specToggleFocus flips focus only when a team is selected', () => {
    const page = gridPage();
    assert.equal(SPEC(page).focus, false);
    page.call('specToggleFocus');
    assert.equal(SPEC(page).focus, true);
    page.call('specToggleFocus');
    assert.equal(SPEC(page).focus, false);
    page.eval('SPEC.selectedId = null');
    assert.doesNotThrow(() => page.call('specToggleFocus'));
    assert.equal(SPEC(page).focus, false);
  });

  it('pointermove tracks hover and the wheel zooms the hovered player', () => {
    const page = gridPage();
    const L = plain(page.get('SPEC.layout'));
    const pane = L.panes[2];
    const point = centre(pane.zoomOut);
    page.call('specOnPointerMove', { clientX: point.x, clientY: point.y });
    assert.deepEqual(plain(page.get('SPEC.hover')), { kind: 'zoomOut', teamId: 't3' });
    assert.equal(page.el('gameCanvas').style.cursor, 'pointer');

    const before = page.get('SPEC.teams.get("t3").zoom');
    page.call('specOnWheel', { clientX: centre(pane).x, clientY: centre(pane).y, deltaY: -100, preventDefault() {} });
    assert.equal(page.get('SPEC.teams.get("t3").zoom'), before + 0.1);
    assert.equal(SPEC(page).selectedId, 't3');
  });

  it('vsSpecExit restores the page and tells the server to leave', () => {
    const page = gridPage();
    const ws = page.lastWs();
    page.call('vsSpecExit');

    assert.equal(SPEC(page).active, false);
    assert.equal(page.document.body.classList.contains('spectate-mode'), false);
    assert.equal(page.document.body.className, '');
    assert.ok(!page.get('window.__spectator'));
    const listeners = page.el('gameCanvas')._listeners;
    assert.equal(listeners.pointermove.length, 0);
    assert.equal(listeners.wheel.length, 0);
    assert.ok(ws.sent.map((raw) => JSON.parse(raw)).some((msg) => msg.type === 'spectate_leave'));

    page.eval('SPEC.focus = false');
    page.fireWindow('keydown', { key: 'f' });
    assert.equal(SPEC(page).focus, false, 'the spectator key listener must be removed on exit');
  });
});

describe('VS client — spectator rendering', () => {
  function liveRoom(names) {
    const page = spectatorPage();
    connectSpectator(page);
    const teams = names.map((name, i) => specTeam(`t${i + 1}`, name));
    page.call('vsSpecOnMessage', {
      type: 'spectate_ok', code: 'ABC123',
      room: { code: 'ABC123', status: 'playing', teams },
      startedAt: page.clock.now, duration: 180,
    });
    teams.forEach((team, i) => {
      page.call('vsSpecOnMessage', {
        type: 'player_state', teamId: team.id,
        s: playerSnapshot({
          f: 3 + i, sc: 300 + i * 50,
          cx: i * 40, cy: -(3 + i) * 210,
          sx: i * 40, sy: -(3 + i) * 210 - 48,
        }),
      });
    });
    return page;
  }

  it('renders a 4-team camera grid with the real 3D renderer', () => {
    const page = liveRoom(['Alpha', 'Beta', 'Gamma', 'Delta']);
    page.resetCtxCalls();
    assert.doesNotThrow(() => page.call('vsSpecRenderNow', 1234));

    const calls = page.ctxCalls();
    const log = page.ctxLog();
    assert.ok(calls.fill > 100, `expected many filled 3D faces, got ${calls.fill}`);
    assert.ok(calls.lineTo > 200, `expected polygon edges, got ${calls.lineTo}`);
    assert.ok(calls.fillText > 20, `expected HUD/team text, got ${calls.fillText}`);
    assert.ok((calls.createLinearGradient || 0) > 0, 'gradients (sky, pane header) expected');
    assert.ok((calls.ellipse || 0) + (calls.arc || 0) > 0, 'sky/planet/star circles expected');
    assert.ok((calls.clip || 0) >= 4, 'each camera pane must clip its scene');
    assert.equal(calls.save, calls.restore, 'paint state must stay balanced');

    // One DPR setTransform + two per pane (clip + translated scene).
    assert.ok(log.transforms.length >= 9, `expected pane transforms, got ${log.transforms.length}`);
    assert.ok(log.transforms.some((tr) => tr[4] > 0 && tr[5] > 0), 'pane scene transform missing');

    const texts = log.texts.map((entry) => entry.text);
    assert.ok(texts.some((text) => text.includes('TONTON LIVE')));
    assert.ok(texts.some((text) => text.includes('KODE ABC123')));
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      assert.ok(texts.some((text) => text.includes(name)), `missing pane header for ${name}`);
    }
    assert.ok(texts.some((text) => text.includes('START (0m)')), 'trail keeps the START rung');
    assert.equal(plain(page.call('vsSpecView')).paneCount, 4);
  });

  it('renders a 2-team room and reports the pane count', () => {
    const page = liveRoom(['Alpha', 'Beta']);
    page.resetCtxCalls();
    assert.doesNotThrow(() => page.call('vsSpecRenderNow', 500));
    assert.equal(plain(page.call('vsSpecView')).paneCount, 2);
    const texts = page.ctxLog().texts.map((entry) => entry.text);
    assert.ok(texts.some((text) => text.includes('Alpha')));
    assert.ok(texts.some((text) => text.includes('Beta')));
  });

  it('renders the connecting/empty state without throwing', () => {
    const page = spectatorPage();
    connectSpectator(page);
    page.resetCtxCalls();
    assert.doesNotThrow(() => page.call('vsSpecRenderNow', 500));
    const texts = page.ctxLog().texts.map((entry) => entry.text);
    assert.ok(texts.some((text) => text.includes('TONTON LIVE')));
    assert.ok(texts.some((text) => text.includes('Menghubungkan')), 'shows the connecting placeholder');
  });

  it('brings the pane camera closer at a higher per-team zoom', () => {
    const page = liveRoom(['Alpha']);
    page.eval('SPEC.focus = true; SPEC.selectedId = "t1";');
    page.call('specSetZoom', 't1', 1);
    page.call('vsSpecRenderNow', 1000);
    const dist1 = page.get('camera3D.dist');
    const scale1 = page.get('camera3D.scale');

    page.call('specSetZoom', 't1', 2);
    page.call('vsSpecRenderNow', 1000);
    const dist2 = page.get('camera3D.dist');
    const scale2 = page.get('camera3D.scale');

    assert.ok(dist2 < dist1, `zoom 2 must move the camera closer (${dist2} < ${dist1})`);
    assert.ok(scale2 > scale1 * 1.5, `zoom 2 must enlarge the projection (${scale2} vs ${scale1})`);
    assert.equal(page.get('camera3D.zoom'), 2);
  });

  it('throttles redraws but vsSpecRenderNow forces one', () => {
    const page = liveRoom(['Alpha', 'Beta']);
    assert.equal(page.get('SPEC_MIN_FRAME_MS'), 30);
    page.resetCtxCalls();
    page.call('specRender', 1000);
    const drawn = page.ctxCalls().fill || 0;
    assert.ok(drawn > 0, 'the first specRender must paint');

    page.call('specRender', 1000); // same Date.now(): inside the 30 ms window
    assert.equal(page.ctxCalls().fill, drawn, 'a second render inside 30 ms must be skipped');

    page.call('vsSpecRenderNow', 1000);
    assert.ok(page.ctxCalls().fill > drawn, 'vsSpecRenderNow must bypass the throttle');
  });
});

describe('VS client — spectator panes keep the player state intact', () => {
  it('restores cam, star, platforms and viewport after rendering panes', () => {
    const { page } = startedSpectator(3);
    for (const id of ['t1', 't2', 't3']) {
      page.call('vsSpecOnMessage', { type: 'player_state', teamId: id, s: playerSnapshot() });
    }

    page.eval('cam.x = 123; cam.y = -456; cam.targetX = 111; cam.targetY = -999;');
    page.eval('star.wx = 42; star.wy = -77; star.rotation = 0.5; star.state = "jumping"; star.expression = "jump"; star.progress = 0.3; star.scaleX = 1.2; star.scaleY = 0.9;');
    const readPlayer = () => plain(page.get('[cam.x, cam.y, cam.targetX, cam.targetY, star.wx, star.wy, star.rotation, star.state, star.expression, star.progress, star.scaleX, star.scaleY]'));
    const before = readPlayer();
    const viewport = plain(page.get('[W, H, STEP_X]'));
    assert.deepEqual(viewport, [1280, 720, 230]);

    page.resetCtxCalls();
    assert.doesNotThrow(() => page.call('vsSpecRenderNow', 1000));

    assert.deepEqual(readPlayer(), before, 'a pane render must restore cam/star afterwards');
    assert.deepEqual(plain(page.get('[W, H, STEP_X]')), viewport, 'the pane viewport must be restored');
    // Scene arrays/bindings swapped per pane are restored too. This spectator
    // page has no live solo game, so the saved values are the idle ones.
    assert.equal(page.get('currentBasePlat'), null);
    assert.equal(page.get('leftOptionPlat'), null);
    assert.equal(page.get('rightOptionPlat'), null);
    assert.equal(page.get('letitedPlatforms.length'), 0);
    assert.equal(page.get('particles.length'), 0);
    assert.equal(page.get('floatingTexts.length'), 0);
    // The restore above happened after a real paint (not a no-op path).
    assert.ok((page.ctxCalls().fill || 0) > 100);
  });
});

describe('VS client — game over & lobby yang bisa dipakai ulang', () => {
  const result = (over = {}) => ({
    reason: 'time', endedAt: 1700000000000, round: 2,
    winner: { id: 't2', name: 'Tim Beta', score: 900, floor: 7, streak: 3, rank: 1 },
    tied: false,
    winners: [{ id: 't2', name: 'Tim Beta', score: 900, floor: 7, streak: 3, rank: 1 }],
    teams: [
      { id: 't2', name: 'Tim Beta', score: 900, floor: 7, streak: 3, rank: 1 },
      { id: 't1', name: 'Tim Alpha', score: 400, floor: 3, streak: 1, rank: 2 },
    ],
    ...over,
  });

  it('shows the server winner and final standings on game_end', () => {
    const page = load();
    VS(page).teamId = 't1';
    VS(page).teamName = 'Tim Alpha';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, remaining: 120, round: 2 });
    ws.receive({ type: 'game_end', ...result() });

    assert.equal(VS(page).matchOver, true);
    assert.equal(page.get('gameRunning'), false);
    assert.equal(page.el('vs-result').style.display, 'flex');
    assert.match(page.el('vs-result-kicker').textContent, /GAME OVER · RONDE 2/);
    assert.equal(page.el('vs-result-title').textContent, 'Tim Beta MENANG!');
    assert.match(page.el('vs-result-list').innerHTML, /Tim Beta/);
    assert.match(page.el('vs-result-list').innerHTML, /Tim Alpha \(kamu\)/);
    assert.match(page.el('vs-result-list').innerHTML, /700 m · 900 pts/);
    assert.notEqual(page.el('modal-title').textContent, '🎉 WAKTU HABIS!', 'modal solo tidak boleh dipakai di VS');
    assert.equal(VS(page).lastResult.winner.name, 'Tim Beta');
  });

  it('shows the last result after a socket rejoin during game over', () => {
    const page = load();
    VS(page).teamId = 't1';
    VS(page).code = 'ABC123';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, remaining: 120, round: 1 });
    ws.receive({
      type: 'rejoined',
      room: room([team('t1', 'Tim Alpha')], { status: 'lobby' }),
      round: 1,
      lastResult: result(),
    });
    assert.equal(page.el('vs-result').style.display, 'flex');
    assert.equal(page.el('vs-result-title').textContent, 'Tim Beta MENANG!');
    assert.equal(VS(page).matchOver, true);
  });

  it('falls back to SELESAI for an old server that sends game_end without a result', () => {
    const page = load();
    VS(page).teamId = 't1';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 60, remaining: 60, round: 1 });
    ws.receive({ type: 'game_end' });
    assert.equal(page.el('vs-result').style.display, 'flex');
    assert.equal(page.el('vs-result-title').textContent, 'SELESAI');
    assert.equal(page.el('vs-result-kicker').textContent, 'GAME OVER · RONDE 1');
  });

  it('shows SERI when the top teams tie', () => {
    const page = load();
    VS(page).teamId = 't1';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, remaining: 120, round: 1 });
    const tied = result({
      winner: null, tied: true,
      winners: [
        { id: 't1', name: 'Tim Alpha', score: 500, floor: 5, streak: 0, rank: 1 },
        { id: 't2', name: 'Tim Beta', score: 500, floor: 5, streak: 0, rank: 1 },
      ],
      teams: [
        { id: 't1', name: 'Tim Alpha', score: 500, floor: 5, streak: 0, rank: 1 },
        { id: 't2', name: 'Tim Beta', score: 500, floor: 5, streak: 0, rank: 1 },
      ],
    });
    ws.receive({ type: 'game_end', ...tied });
    assert.equal(page.el('vs-result-title').textContent, 'SERI!');
    assert.match(page.el('vs-result-champion').textContent, /Tim Alpha/);
    assert.match(page.el('vs-result-champion').textContent, /Tim Beta/);
  });

  it('hides the result and starts the next round on a new game_start', () => {
    const page = load();
    VS(page).teamId = 't1';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, remaining: 120, round: 1 });
    ws.receive({ type: 'game_end', ...result() });
    assert.equal(page.el('vs-result').style.display, 'flex');

    ws.receive({ type: 'game_start', materi: 'all', duration: 120, remaining: 120, round: 2 });
    assert.equal(page.el('vs-result').style.display, 'none');
    assert.equal(VS(page).matchOver, false);
    assert.equal(VS(page).round, 2);
    assert.equal(page.get('gameRunning'), true);
  });

  it('sends the final score and shows a waiting screen when the local clock hits zero', () => {
    const page = load();
    VS(page).teamId = 't1';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 5, remaining: 5, round: 3 });
    page.eval('score = 250; floorLevel = 2; streak = 1; updateHUD()');
    page.advance(5000);

    assert.equal(page.get('gameRunning'), false);
    assert.equal(VS(page).matchOver, true);
    assert.equal(page.el('vs-result').style.display, 'flex');
    assert.match(page.el('vs-result-title').textContent, /WAKTU HABIS/);
    const finish = ws.sent.map((raw) => JSON.parse(raw)).find((m) => m.type === 'finish');
    assert.ok(finish, 'client harus mengirim skor akhir ke server');
    assert.equal(finish.score, 250);
    assert.equal(finish.floor, 2);
    assert.equal(finish.streak, 1);

    // Hasil resmi dari server menggantikan layar "menunggu hasil".
    ws.receive({ type: 'game_end', ...result({ round: 3 }) });
    assert.equal(page.el('vs-result-title').textContent, 'Tim Beta MENANG!');
  });

  it('returns to the waiting lobby from the result screen', () => {
    const page = load({ hash: '#join' });
    VS(page).code = 'ABC123';
    VS(page).teamId = 't1';
    VS(page).teamName = 'Tim Alpha';
    VS(page).room = room([team('t1', 'Tim Alpha'), team('t2', 'Tim Beta')]);
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 60, remaining: 60, round: 1 });
    ws.receive({ type: 'game_end', ...result() });

    page.call('vsBackToLobby');
    assert.equal(page.el('vs-result').style.display, 'none');
    assert.equal(page.el('vs-modal').style.display, 'flex');
    assert.equal(page.el('modal').style.display, 'none');
    assert.match(page.el('vs-join-status').textContent, /menunggu host memulai ronde berikutnya/);
    assert.match(page.el('vs-lobby-guest').innerHTML, /Tim Alpha \(kamu\)/);
  });

  it('clears VS state and shows ROOM DIHAPUS when the host deletes the lobby', () => {
    const page = load({ hash: '#join' });
    VS(page).code = 'ABC123';
    VS(page).teamId = 't1';
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 60, remaining: 60, round: 1 });
    ws.receive({ type: 'room_deleted', code: 'ABC123', message: 'Room dihapus oleh admin' });

    assert.equal(VS(page).code, null);
    assert.equal(VS(page).teamId, null);
    assert.equal(VS(page).enabled, false);
    assert.equal(page.get('gameRunning'), false);
    assert.equal(page.el('modal').style.display, 'flex');
    assert.equal(page.el('modal-title').textContent, 'ROOM DIHAPUS');
    assert.match(page.el('modal-desc').textContent, /ABC123/);
    assert.equal(page.el('vs-result').style.display, 'none');
  });
});

describe('VS client — spectator game over', () => {
  const specResult = () => ({
    reason: 'time', endedAt: 1700000000000, round: 2,
    winner: { id: 't2', name: 'Tim Beta', score: 800, floor: 6, streak: 2, rank: 1 },
    tied: false,
    winners: [{ id: 't2', name: 'Tim Beta', score: 800, floor: 6, streak: 2, rank: 1 }],
    teams: [
      { id: 't2', name: 'Tim Beta', score: 800, floor: 6, streak: 2, rank: 1 },
      { id: 't1', name: 'Tim Alpha', score: 300, floor: 2, streak: 0, rank: 2 },
    ],
  });

  it('stores the result on game_end and draws GAME OVER with the winner', () => {
    const { page, ws } = startedSpectator(2);
    ws.receive({ type: 'game_end', ...specResult() });

    assert.equal(SPEC(page).status, 'ended');
    assert.equal(SPEC(page).resultVisible, true);
    assert.equal(SPEC(page).result.winner.name, 'Tim Beta');
    assert.equal(page.call('specStatusText', page.clock.now), 'SELESAI');
    page.eval('SPEC.layout = specComputeLayout(W, H)');
    const L = plain(page.get('SPEC.layout'));
    assert.ok(L.result && L.result.dismiss && L.result.exit, 'kartu hasil punya tombol dismiss + keluar');

    page.resetCtxCalls();
    page.call('vsSpecRenderNow', 2000);
    const texts = page.ctxLog().texts.map((t) => t.text);
    assert.ok(texts.some((t) => t.includes('GAME OVER')), 'layar harus menulis GAME OVER');
    assert.ok(texts.some((t) => t.includes('Tim Beta')), 'layar harus menulis nama pemenang');
    assert.ok(texts.some((t) => t.includes('Tim Alpha')), 'layar harus menampilkan klasemen');
  });

  it('lets the admin dismiss the result to look at the cameras again', () => {
    const { page, ws } = startedSpectator(2);
    ws.receive({ type: 'game_end', ...specResult() });
    page.eval('SPEC.layout = specComputeLayout(W, H)');
    const L = plain(page.get('SPEC.layout'));
    page.fire('gameCanvas', 'pointerdown', {
      clientX: L.result.dismiss.x + 10,
      clientY: L.result.dismiss.y + 10,
    });
    assert.equal(SPEC(page).resultVisible, false);
    assert.equal(SPEC(page).result.winner.name, 'Tim Beta', 'hasil tetap disimpan setelah kartu ditutup');
  });

  it('shows the last result when the admin opens the spectator after the match', () => {
    const page = spectatorPage();
    const ws = connectSpectator(page);
    page.call('vsSpecOnMessage', {
      type: 'spectate_ok', code: 'ABC123', round: 2,
      room: { code: 'ABC123', status: 'lobby', teams: specResult().teams },
      startedAt: null, duration: 180,
      lastResult: specResult(),
    });
    assert.equal(SPEC(page).resultVisible, true);
    assert.equal(SPEC(page).result.winner.name, 'Tim Beta');
    assert.equal(SPEC(page).round, 2);
  });

  it('clears the result and resets snapshots on the next round', () => {
    const { page, ws } = startedSpectator(2);
    page.call('vsSpecOnMessage', { type: 'player_state', teamId: 't1', s: playerSnapshot() });
    assert.ok(SPEC(page).teams.get('t1').snap);
    ws.receive({ type: 'game_end', ...specResult() });
    assert.equal(SPEC(page).resultVisible, true);

    ws.receive({ type: 'game_start', materi: 'all', duration: 180, remaining: 180, round: 3 });
    assert.equal(SPEC(page).resultVisible, false);
    assert.equal(SPEC(page).round, 3);
    assert.equal(SPEC(page).status, 'playing');
    assert.equal(SPEC(page).teams.get('t1').snap, null, 'frame ronde lama tidak boleh tampil di ronde baru');
    assert.equal(page.call('specStatusText', page.clock.now), 'BERMAIN 03:00');
  });

  it('shows the room-deleted message and clears the camera grid', () => {
    const { page, ws } = startedSpectator(2);
    ws.receive({ type: 'room_deleted', code: 'ABC123', message: 'Room dihapus oleh admin' });
    assert.equal(SPEC(page).err, 'Room dihapus oleh admin');
    assert.equal(SPEC(page).connected, false);
    assert.equal(SPEC(page).teams.size, 0);
    assert.equal(SPEC(page).order.length, 0);
    assert.equal(page.call('specStatusText', page.clock.now), 'SELESAI');
  });
});

describe('VS client — match clock sync (pemain vs admin spectator)', () => {
  const timerText = (page) => page.el('timer-val').textContent;

  it('uses the server remaining on game_start instead of the full duration', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    const startAt = page.clock.now;
    // Server bilang match sudah jalan 1 detik: 179 detik sisa, bukan 180.
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, serverTime: startAt - 1000, remaining: 179 });
    assert.equal(page.get('timeLeft'), 179);
    assert.equal(timerText(page), '02:59');

    page.advance(1000);
    assert.equal(page.get('timeLeft'), 178);
    assert.equal(timerText(page), '02:58');

    // Deadline lokal: 10 detik berjalan -> 179 - 10 = 169 (tick 250 ms tetap tepat).
    page.advance(9000);
    assert.equal(page.get('timeLeft'), 169);
    assert.equal(timerText(page), '02:49');
  });

  it('keeps the remaining on a mid-match rejoin instead of restarting at full duration', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, serverTime: page.clock.now - 30000, remaining: 150 });
    assert.equal(page.get('timeLeft'), 150);
    assert.equal(timerText(page), '02:30');
    page.advance(2000);
    assert.equal(page.get('timeLeft'), 148);
  });

  it('falls back to the legacy countdown for an old server without remaining', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 180, serverTime: page.clock.now });
    assert.equal(page.get('timeLeft'), 180);
    page.advance(1000);
    assert.equal(page.get('timeLeft'), 179, 'the legacy timeLeft-- timer still works');
  });

  it('ends the match exactly at the deadline', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 5, serverTime: page.clock.now, remaining: 5 });
    page.advance(2000);
    assert.equal(page.get('gameRunning'), true);
    assert.equal(page.get('timeLeft'), 3);
    page.advance(3200);
    assert.equal(page.get('gameRunning'), false, 'endGame() must run when the deadline passes');
    assert.equal(page.get('timeLeft'), 0);
  });

  it('does not count down unlimited matches (duration >= 9000)', () => {
    const page = load();
    page.call('vsConnect');
    const ws = page.lastWs();
    ws.open();
    ws.receive({ type: 'game_start', materi: 'all', duration: 9000, serverTime: page.clock.now, remaining: null });
    assert.equal(timerText(page), '♾️');
    page.advance(3000);
    assert.equal(page.get('timeLeft'), 9000);
  });

  it('admin spectator counts down from the same remaining', () => {
    const page = spectatorPage();
    connectSpectator(page);
    page.call('vsSpecOnMessage', {
      type: 'spectate_ok', code: 'ABC123',
      room: { code: 'ABC123', status: 'playing', teams: [specTeam('t1', 'Tim 1')] },
      startedAt: page.clock.now - 1000, duration: 180, remaining: 179,
    });
    assert.equal(page.get('SPEC.deadlineAt'), page.clock.now + 179000);
    assert.equal(page.call('specStatusText', page.clock.now), 'BERMAIN 02:59');
    page.advance(1000);
    assert.equal(page.call('specStatusText', page.clock.now), 'BERMAIN 02:58');

    // game_start (mis. observer reconnect) memakai deadline baru dari server.
    page.call('vsSpecOnMessage', { type: 'game_start', materi: 'all', duration: 180, serverTime: page.clock.now, remaining: 60 });
    assert.equal(page.call('specStatusText', page.clock.now), 'BERMAIN 01:00');

    page.call('vsSpecOnMessage', { type: 'game_end' });
    assert.equal(page.get('SPEC.deadlineAt'), 0);
    assert.equal(page.call('specStatusText', page.clock.now), 'SELESAI');
  });

  it('admin spectator falls back to startedAt for an old server', () => {
    const page = spectatorPage();
    connectSpectator(page);
    page.call('vsSpecOnMessage', {
      type: 'spectate_ok', code: 'ABC123',
      room: { code: 'ABC123', status: 'playing', teams: [specTeam('t1', 'Tim 1')] },
      startedAt: page.clock.now - 30000, duration: 180,
    });
    assert.equal(page.get('SPEC.deadlineAt'), 0);
    assert.equal(page.call('specStatusText', page.clock.now), 'BERMAIN 02:30');
  });

  it('prefers remainingMs so player HUD and admin status hit the same second', () => {
    // Pemain menerima game_start pada T0 dengan sisa 179.400 dtk.
    const player = load();
    player.call('vsConnect');
    const pws = player.lastWs();
    pws.open();
    pws.receive({ type: 'game_start', materi: 'all', duration: 180, serverTime: player.clock.now, remaining: 180, remainingMs: 179400 });
    const playerDeadline = player.get('vsMatchDeadline');
    assert.equal(playerDeadline, player.clock.now + 179400);

    // Admin membuka spectator beberapa detik kemudian: server mengirim sisa
    // milidetik yang mengarah ke instan absolut yang sama.
    const admin = spectatorPage();
    connectSpectator(admin);
    admin.advance(7000);
    const adminRemainingMs = playerDeadline - admin.clock.now;
    admin.call('vsSpecOnMessage', {
      type: 'spectate_ok', code: 'ABC123',
      room: { code: 'ABC123', status: 'playing', teams: [specTeam('t1', 'Tim 1')] },
      startedAt: admin.clock.now - 4000, duration: 180,
      remaining: Math.ceil(adminRemainingMs / 1000), remainingMs: adminRemainingMs,
    });
    const adminDeadline = admin.get('SPEC.deadlineAt');
    assert.equal(adminDeadline, admin.clock.now + adminRemainingMs);
    assert.equal(adminDeadline, playerDeadline, 'kedua deadline harus instan absolut yang sama');

    // Samakan jam kedua halaman (admin sudah 7 dtk di depan karena auto-start
    // spectator 300 ms + advance), lalu bandingkan angka detiknya.
    const skew = admin.clock.now - player.clock.now;
    player.advance(skew);
    for (let i = 0; i < 5; i++) {
      const adminText = admin.call('specStatusText', admin.clock.now);
      assert.equal(adminText.replace(/^BERMAIN /, ''), player.el('timer-val').textContent, `detik harus sama pada tick ${i}`);
      player.advance(1000);
      admin.advance(1000);
    }
  });
});

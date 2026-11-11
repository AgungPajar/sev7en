// tests/game-vs-client.test.js
// Unit tests for the VS (realtime multiplayer) client embedded in game.html.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGamePage, mulberry32, plain } from './helpers/game-page.js';

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
  it('uses the local server for localhost', () => {
    assert.equal(load().get('VS').getWsUrl(), 'ws://localhost:3001/ws');
  });

  it('uses the local server for 127.0.0.1', () => {
    assert.equal(load({ hostname: '127.0.0.1' }).get('VS').getWsUrl(), 'ws://localhost:3001/ws');
  });

  it('uses /vs-ws over https in production', () => {
    const page = load({ hostname: 'sev7en.cerap.web.id', protocol: 'https:', origin: 'https://sev7en.cerap.web.id' });
    assert.equal(page.get('VS').getWsUrl(), 'wss://sev7en.cerap.web.id/vs-ws');
  });

  it('uses /vs-ws over http in production', () => {
    const page = load({ hostname: 'sev7en.cerap.web.id', protocol: 'http:', origin: 'http://sev7en.cerap.web.id' });
    assert.equal(page.get('VS').getWsUrl(), 'ws://sev7en.cerap.web.id/vs-ws');
  });
});

describe('VS client — vsConnect()', () => {
  it('opens a socket to the computed URL', () => {
    const page = load();
    page.call('vsConnect');
    assert.equal(page.wsInstances.length, 1);
    assert.equal(page.lastWs().url, 'ws://localhost:3001/ws');
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

  it('does not reconnect when the VS session is not enabled', () => {
    const page = load();
    const ws = openSocket(page);
    VS(page).enabled = false;
    VS(page).code = 'ABC123';
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

    ws.receive({ type: 'game_start', materi: 'food_kitchen', duration: 60 });

    assert.equal(VS(page).enabled, true);
    assert.equal(page.el('vs-modal').style.display, 'none');
    assert.equal(page.el('modal').style.display, 'none');
    assert.equal(page.el('topic-select').value, 'food_kitchen');
    assert.equal(page.el('duration-select').value, '60');
    assert.equal(page.el('team-input').value, 'Tim A');
    assert.equal(page.get('_vsMateri'), 'food_kitchen');
    assert.equal(page.get('gameRunning'), true);
    assert.equal(page.get('activePool.length'), 8);
    assert.equal(page.el('team-display').textContent, 'TIM A');
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
    assert.match(html, /120/);
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
    page.el('vs-materi').value = 'food_kitchen';
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
      materi: 'food_kitchen',
      duration: '60',
    });
  });

  it('sends immediately when the socket is already open', () => {
    const page = load();
    page.el('vs-admin-pass').value = 'pw';
    page.el('vs-materi').value = 'all';
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

  it('re-enables the button after 4 s without a response', () => {
    const page = load();
    page.el('vs-join-code').value = 'ABC123';
    page.el('vs-join-name').value = 'Tim A';
    const btn = page.query('#vs-card-join .vs-btn-primary');
    page.call('vsJoinRoom');
    const ws = page.lastWs();
    ws.open();
    page.advance(300 + 200);
    assert.equal(ws.sent.length, 1);
    assert.equal(btn.disabled, true);
    page.advance(4000);
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

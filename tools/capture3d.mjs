#!/usr/bin/env node
/**
 * tools/capture3d.mjs — harness screenshot game sev7en.
 *
 * Menjalankan Microsoft Edge headless lewat Chrome DevTools Protocol (CDP)
 * memakai global WebSocket bawaan Node (Node 22+, diuji Node 26), lalu:
 *   - membuka halaman game (default http://127.0.0.1:4173/game.html),
 *   - mengeksekusi skenario evaluasi JS (menu, solo-start, play, wrong,
 *     mid-altitude/sunset, space, mobile portrait/landscape),
 *   - menyimpan screenshot PNG ke .shots/<timestamp>/,
 *   - mengumpulkan uncaught exception, console.error/console.warn, dan
 *     Log.entryAdded level error,
 *   - mencetak ringkasan JSON + menulis summary.json,
 *   - exit code 1 bila ada exception / page error / kegagalan harness.
 *
 * Zero dependency. Server statis (python -m http.server 4173) TIDAK dijalankan
 * oleh script ini — Lead yang menyediakannya.
 *
 * Menambah skenario: sunting array SCENARIOS di bawah. Bentuk satu langkah:
 *   { eval: 'ekspresi JS', wait: 800 }          // evaluasi lalu jeda
 *   { waitFor: 'star.state === "idle"', timeout: 5000 } // tunggu kondisi
 *   { shot: 'nama-tambahan' }                   // screenshot tambahan
 *   { wait: 500 }                               // jeda saja
 * Screenshot default diambil sekali di akhir tiap skenario.
 */

import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_URL = 'http://127.0.0.1:4173/game.html';
const DEFAULT_EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE_PREFIX = 'sev7en-capture-';
const MAX_CONSOLE_TEXT = 1200;

// ===========================================================================
// SKENARIO — ubah/tambah di sini. Nama harus unik dan dipakai untuk nama PNG.
// ===========================================================================
const SCENARIOS = [
  {
    name: 'menu',
    label: 'Menu awal (modal pengaturan, tanpa aksi)',
    steps: [],
  },
  {
    name: 'solo-start',
    label: 'Mulai solo: startGame() dari menu',
    steps: [{ eval: 'startGame()', wait: 900 }],
  },
  {
    name: 'play',
    label: 'Dua jawaban benar berturut-turut (2 lompatan)',
    steps: [
      { eval: 'startGame()', wait: 800 },
      { eval: "triggerJump(leftOptionPlat && leftOptionPlat.isCorrect ? 'left' : 'right')", wait: 800 },
      { waitFor: "star.state === 'idle' && leftOptionPlat && rightOptionPlat", timeout: 6000 },
      { eval: "triggerJump(leftOptionPlat && leftOptionPlat.isCorrect ? 'left' : 'right')", wait: 800 },
    ],
  },
  {
    name: 'wrong',
    label: 'Jawaban salah: awan pecah, bintang jatuh (250ms setelah lompat)',
    steps: [
      { eval: 'startGame()', wait: 800 },
      { eval: "triggerJump(leftOptionPlat && leftOptionPlat.isCorrect ? 'right' : 'left')", wait: 250 },
    ],
  },
  {
    name: 'mid',
    label: 'Altitud menengah / senja (floorLevel=11, platform di 1100m)',
    steps: [
      { eval: 'startGame()', wait: 600 },
      { eval: "floorLevel = 11; score = 1100; const b = { wx: 0, wy: -1100, w: 220, h: 30, isStart: false, level: 11, status: 'correct' }; letitedPlatforms = [b]; currentBasePlat = b; star.wx = 0; star.wy = b.wy - 48; star.state = 'idle'; star.rotation = 0; cam.x = 0; cam.y = b.wy; cam.targetX = 0; cam.targetY = b.wy; initEnvironment(); spawnNextStairOptions(); updateHUD();", wait: 900 },
    ],
  },
  {
    name: 'space',
    label: 'Luar angkasa (floorLevel=30, platform di 3000m)',
    steps: [
      { eval: 'startGame()', wait: 600 },
      { eval: "floorLevel = 30; score = 3000; const b = { wx: 0, wy: -3000, w: 220, h: 30, isStart: false, level: 30, status: 'correct' }; letitedPlatforms = [b]; currentBasePlat = b; star.wx = 0; star.wy = b.wy - 48; star.state = 'idle'; star.rotation = 0; cam.x = 0; cam.y = b.wy; cam.targetX = 0; cam.targetY = b.wy; initEnvironment(); spawnNextStairOptions(); updateHUD();", wait: 900 },
    ],
  },
  {
    name: 'climb-history',
    label: 'Riwayat tangga awan berundak di bawah pemain (7 tingkat)',
    steps: [
      { eval: 'startGame()', wait: 500 },
      { eval: "const plats = []; for (let i = 0; i < 7; i++) { plats.push({ wx: (i % 2 === 0 ? 0 : (i % 4 === 1 ? 230 : -230)), wy: -i * 210, w: 220, h: 30, level: i, status: 'correct' }); } letitedPlatforms = plats; currentBasePlat = plats[plats.length - 1]; floorLevel = 6; score = 600; star.wx = currentBasePlat.wx; star.wy = currentBasePlat.wy - 48; star.state = 'idle'; star.rotation = 0; cam.x = currentBasePlat.wx; cam.y = currentBasePlat.wy; cam.targetX = cam.x; cam.targetY = cam.y; initEnvironment(); spawnNextStairOptions(); updateHUD();", wait: 900 },
    ],
  },
  {
    name: 'mobile-portrait',
    label: 'Viewport mobile portrait 390x844',
    viewport: { width: 390, height: 844, mobile: true },
    steps: [{ eval: 'startGame()', wait: 800 }],
  },
  {
    name: 'mobile-landscape',
    label: 'Viewport mobile landscape 844x390',
    viewport: { width: 844, height: 390, mobile: true },
    steps: [{ eval: 'startGame()', wait: 800 }],
  },
  {
    name: 'fps',
    label: 'Ukur FPS renderer 3D (~1,5 detik setelah satu jawaban benar)',
    steps: [
      { eval: 'startGame()', wait: 700 },
      { eval: "triggerJump(leftOptionPlat && leftOptionPlat.isCorrect ? 'left' : 'right')", wait: 900 },
      { eval: "(async () => { const frames = await new Promise((resolve) => { let count = 0; const t0 = performance.now(); const tick = () => { count++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else resolve({ count, ms: performance.now() - t0 }); }; requestAnimationFrame(tick); }); return Math.round(frames.count / (frames.ms / 1000)) + ' fps'; })()", wait: 100 },
    ],
  },
  {
    name: 'spectate-grid',
    label: 'Penonton admin: 4 kamera tim sekaligus (grid 2x2) + tab + info soal',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: spectateDemoScript(), wait: 1400 },
      { shot: 'grid-4-kamera' },
    ],
  },
  {
    name: 'spectate-focus',
    label: 'Penonton admin: mode fokus satu tim + zoom 160%',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: spectateDemoScript(), wait: 1200 },
      { eval: "specSelect('demo3'); SPEC.focus = true; specSetZoom('demo3', 1.6); vsSpecRenderNow(2000);", wait: 800 },
      { shot: 'fokus-zoom' },
    ],
  },
  {
    name: 'spectate-zoom',
    label: 'Penonton admin: zoom per pemain berbeda (80% / 120% / 180% / 240%)',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: spectateDemoScript(), wait: 1000 },
      { eval: "[['demo1', 0.8], ['demo2', 1.2], ['demo3', 1.8], ['demo4', 2.4]].forEach((pair) => specSetZoom(pair[0], pair[1])); vsSpecRenderNow(2000);", wait: 900 },
      { shot: 'zoom-per-pemain' },
    ],
  },
  {
    name: 'spectate-fps',
    label: 'Ukur fps rAF vs fps gambar mode penonton 4 kamera (~1,5 detik)',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: spectateDemoScript(), wait: 1200 },
      { eval: "(async () => { const t0 = performance.now(); let frames = 0, draws = 0, last = SPEC.lastDrawAt; await new Promise((resolve) => { const run = () => { frames++; if (SPEC.lastDrawAt !== last) { last = SPEC.lastDrawAt; draws++; } if (performance.now() - t0 < 1500) requestAnimationFrame(run); else resolve(true); }; requestAnimationFrame(run); }); const sec = (performance.now() - t0) / 1000; return Math.round(frames / sec) + ' fps rAF / ' + Math.round(draws / sec) + ' fps gambar'; })()", wait: 100 },
    ],
  },
  {
    name: 'spectate-real-player',
    label: 'End-to-end nyata: 1 halaman pemain (iframe) main sungguhan, spectator menontonnya',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: spectateRealPlayerScript(), wait: 300 },
      { waitFor: "typeof SPEC !== 'undefined' && SPEC.connected && SPEC.teams.size >= 1 && Array.from(SPEC.teams.values()).every((t) => !!t.snap)", timeout: 15000 },
      { wait: 1000 },
      { shot: 'pemain-nyata' },
      { wait: 1600 },
      { shot: 'pemain-nyata-bergerak' },
    ],
  },
  {
    name: 'admin-tonton-live',
    label: 'Panel admin: tombol Tonton Live membuka overlay iframe 4 kamera (end-to-end)',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: adminLiveSetupScript(), wait: 300 },
      { waitFor: "(() => { const f = document.getElementById('specFrame'); if (!f) return false; const w = f.contentWindow; if (!w || typeof w.vsSpecView !== 'function') return false; const v = w.vsSpecView(); return !!(v && v.active && v.connected && v.teams.length === 4 && v.teams.every((t) => t.hasData)); })()", timeout: 15000 },
      { wait: 1200 },
      { shot: 'overlay-4-kamera' },
      { eval: "(() => { const w = document.getElementById('specFrame').contentWindow; const v = w.vsSpecView(); const id = v.teams[2] && v.teams[2].id; if (!id) return false; w.specSelect(id); w.specToggleFocus(); w.specSetZoom(id, 1.5); w.vsSpecRenderNow(2500); return true; })()", wait: 900 },
      { shot: 'overlay-fokus-zoom' },
    ],
  },
  {
    name: 'spectate-lobby',
    label: 'Penonton admin: room masih lobby, menunggu tim join',
    viewport: { width: 1280, height: 800 },
    steps: [
      { eval: spectateLobbyScript(), wait: 1000 },
      { shot: 'lobby' },
    ],
  },
  {
    name: 'spectate-live',
    label: 'Penonton admin end-to-end: room nyata + 4 tim kirim telemetri ke server',
    viewport: { width: 1440, height: 900 },
    steps: [
      { eval: spectateLiveScript(), wait: 300 },
      { waitFor: "typeof SPEC !== 'undefined' && SPEC.connected && SPEC.order.length === 4 && SPEC.order.every((id) => { const t = SPEC.teams.get(id); return !!(t && t.snap); })", timeout: 10000 },
      { wait: 900 },
      { shot: 'live-4-tim' },
      { eval: "specSelect(SPEC.order[1]); SPEC.focus = true; specSetZoom(SPEC.order[1], 1.5); vsSpecRenderNow(3000);", wait: 800 },
      { shot: 'live-fokus' },
    ],
  },
];

// Demo visual mode penonton: injeksi snapshot ke klien (tanpa server room),
// supaya screenshot layout/kamera/zoom bisa diambil deterministik.
function spectateDemoScript() {
  return `(() => {
    if (typeof vsSpecStart !== 'function') throw new Error('halaman ini bukan build VS (spectator tidak ada)');
    const teams = [
      { id: 'demo1', name: 'BINTANG 1', floor: 3 },
      { id: 'demo2', name: 'BINTANG 2', floor: 6 },
      { id: 'demo3', name: 'BINTANG 3', floor: 9 },
      { id: 'demo4', name: 'BINTANG 4', floor: 12 }
    ];
    const qs = [
      { q: 'The cat is sleeping ______ the table. (Di bawah)', e: '🐱🪑', c: 'under', w: 'behind' },
      { q: 'Look! She ______ reading a book now.', e: '📖👧', c: 'is', w: 'are' },
      { q: 'We keep milk and fruit cold in the ______.', e: '🧊🍎', c: 'refrigerator', w: 'cupboard' },
      { q: 'I go to school ______ bus.', e: '🚌🏫', c: 'by', w: 'on' }
    ];
    vsSpecStart('DEMO07', 'sev7en-admin');
    const room = {
      code: 'DEMO07', materi: 'all', duration: 180, status: 'playing',
      teams: teams.map((t) => ({ id: t.id, name: t.name, score: t.floor * 120, floor: t.floor, streak: Math.min(5, t.floor % 6) }))
    };
    vsSpecOnMessage({ type: 'spectate_ok', code: 'DEMO07', startedAt: Date.now() - 45000, duration: 180, room: room });
    for (const team of teams) {
      const f = team.floor;
      const q = qs[f % qs.length];
      const cx = ((f % 3) - 1) * 60;
      const s = {
        f: f, sc: f * 120, stk: Math.min(5, f % 6), cx: cx, cy: -f * 210,
        sx: cx, sy: -f * 210 - 48, ss: 'idle', se: 'happy', sr: 0, sk: 0, kx: 1, ky: 1,
        b: [cx, -f * 210],
        l: { x: cx - 230, y: -(f + 1) * 210, t: q.c, ok: 1, st: 'n', br: 0, fy: 0 },
        r: { x: cx + 230, y: -(f + 1) * 210, t: q.w, ok: 0, st: 'n', br: 0, fy: 0 },
        tr: [], q: { t: q.q, e: q.e }
      };
      vsSpecOnMessage({ type: 'player_state', teamId: team.id, s: s, t: Date.now() });
    }
    // Buang pesan error server (demo ini tidak memakai room sungguhan).
    if (window.__demoErrClear) clearInterval(window.__demoErrClear);
    window.__demoErrClear = setInterval(function () { try { SPEC.err = ''; } catch (e) {} }, 120);
    return teams.length;
  })()`;
}

function spectateLobbyScript() {
  return `(async () => {
    if (typeof vsSpecStart !== 'function') throw new Error('halaman ini bukan build VS (spectator tidak ada)');
    const pass = 'sev7en-admin';
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
    const openWs = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('WebSocket gagal: ' + wsUrl));
    });
    const waitMsg = (ws, type) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout menunggu ' + type)), 6000);
      const onMsg = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === type) { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(msg); }
      };
      ws.addEventListener('message', onMsg);
    });
    const host = await openWs();
    host.send(JSON.stringify({ type: 'create_room', adminPassword: pass, materi: 'all', duration: 300 }));
    const created = await waitMsg(host, 'room_created');
    const code = created.code;
    for (const name of ['BINTANG 1', 'BINTANG 2']) {
      const ws = await openWs();
      ws.send(JSON.stringify({ type: 'join_room', code: code, teamName: name }));
      await waitMsg(ws, 'joined');
    }
    window.vsSpecStart(code, pass);
    return code;
  })()`;
}

// End-to-end: buat room nyata + 4 socket tim yang mengirim player_state, lalu
// buka spectator dengan password admin. Memverifikasi relay server + render.
function spectateLiveScript() {
  return `(async () => {
    if (typeof vsSpecStart !== 'function') throw new Error('halaman ini bukan build VS (spectator tidak ada)');
    const pass = 'sev7en-admin';
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
    const openWs = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('WebSocket gagal: ' + wsUrl));
    });
    const waitMsg = (ws, type) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout menunggu ' + type)), 6000);
      const onMsg = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === type) { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(msg); }
      };
      ws.addEventListener('message', onMsg);
    });
    const host = await openWs();
    host.send(JSON.stringify({ type: 'create_room', adminPassword: pass, materi: 'all', duration: 180 }));
    const created = await waitMsg(host, 'room_created');
    const code = created.code;
    const names = ['BINTANG 1', 'BINTANG 2', 'BINTANG 3', 'BINTANG 4'];
    const teams = [];
    for (let i = 0; i < names.length; i++) {
      const ws = await openWs();
      ws.send(JSON.stringify({ type: 'join_room', code: code, teamName: names[i] }));
      await waitMsg(ws, 'joined');
      teams.push(ws);
    }
    await new Promise((r) => setTimeout(r, 200));
    host.send(JSON.stringify({ type: 'start_game' }));
    await new Promise((r) => setTimeout(r, 250));
    const qs = [
      { q: 'The cat is sleeping ______ the table. (Di bawah)', e: '🐱🪑', c: 'under', w: 'behind' },
      { q: 'Look! She ______ reading a book now.', e: '📖👧', c: 'is', w: 'are' },
      { q: 'We keep milk and fruit cold in the ______.', e: '🧊🍎', c: 'refrigerator', w: 'cupboard' },
      { q: 'I go to school ______ bus.', e: '🚌🏫', c: 'by', w: 'on' }
    ];
    const base = [3, 6, 9, 12];
    let tick = 0;
    window.__specE2E = setInterval(() => {
      tick++;
      teams.forEach((ws, i) => {
        const f = base[i] + Math.floor(tick / 24);
        const q = qs[(f + i) % qs.length];
        const cx = ((i % 3) - 1) * 60;
        ws.send(JSON.stringify({ type: 'player_state', s: {
          f: f, sc: f * 120, stk: Math.min(5, f % 6), cx: cx, cy: -f * 210,
          sx: cx, sy: -f * 210 - 48, ss: 'idle', se: 'happy', sr: 0, sk: 0, kx: 1, ky: 1,
          b: [cx, -f * 210],
          l: { x: cx - 230, y: -(f + 1) * 210, t: q.c, ok: 1, st: 'n', br: 0, fy: 0 },
          r: { x: cx + 230, y: -(f + 1) * 210, t: q.w, ok: 0, st: 'n', br: 0, fy: 0 },
          tr: [], q: { t: q.q, e: q.e }
        } }));
      });
    }, 125);
    window.vsSpecStart(code, pass);
    return code;
  })()`;
}

// End-to-end paling nyata: halaman pemain asli (iframe game.html) auto-join,
// host mulai mabar, pemain menjawab soal (triggerJump) → telemetri asli dari
// kode game mengalir lewat server → spectator admin melihat kamera pemain itu.
function spectateRealPlayerScript() {
  return `(async () => {
    const pass = 'sev7en-admin';
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
    const openWs = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('WebSocket gagal: ' + wsUrl));
    });
    const waitMsg = (ws, type) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout menunggu ' + type)), 6000);
      const onMsg = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === type) { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(msg); }
      };
      ws.addEventListener('message', onMsg);
    });
    const host = await openWs();
    host.send(JSON.stringify({ type: 'create_room', adminPassword: pass, materi: 'all', duration: 180 }));
    const created = await waitMsg(host, 'room_created');
    const code = created.code;
    const frame = document.createElement('iframe');
    frame.id = 'playerFrame';
    frame.style.cssText = 'position:fixed;left:8px;bottom:8px;width:520px;height:330px;z-index:5;border:2px solid #22c55e;border-radius:10px;opacity:0.98;box-shadow:0 10px 30px rgba(0,0,0,.5)';
    frame.src = '/game.html?code=' + encodeURIComponent(code) + '&team=UJI%20NYATA';
    document.body.appendChild(frame);
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        let joined = false;
        try {
          const doc = frame.contentDocument;
          const lobby = doc && doc.getElementById('vs-join-lobby');
          joined = !!(lobby && getComputedStyle(lobby).display !== 'none');
        } catch (e) {}
        if (joined) return resolve(true);
        if (Date.now() - t0 > 12000) return reject(new Error('iframe pemain tidak join lobby'));
        setTimeout(tick, 120);
      };
      tick();
    });
    host.send(JSON.stringify({ type: 'start_game' }));
    await new Promise((r) => setTimeout(r, 1600));
    window.__realJump = setInterval(() => {
      try { frame.contentWindow.triggerJump(Math.random() < 0.5 ? 'left' : 'right'); } catch (e) {}
    }, 900);
    window.vsSpecStart(code, pass);
    return code;
  })()`;
}

// End-to-end dari panel admin: buat room lewat tombol admin, 4 socket tim join
// + kirim telemetri, mulai mabar, lalu klik "Tonton Live" dan tunggu iframe.
function adminLiveSetupScript() {
  return `(async () => {
    const $ = (id) => document.getElementById(id);
    const pass = 'sev7en-admin';
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
    const openWs = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('WebSocket gagal: ' + wsUrl));
    });
    const waitFor = (fn, timeout) => new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        let ok = false;
        try { ok = fn(); } catch (e) {}
        if (ok) return resolve(true);
        if (Date.now() - t0 > timeout) return reject(new Error('timeout di panel admin'));
        setTimeout(tick, 80);
      };
      tick();
    });
    $('adminPass').value = pass;
    $('btnCreate').click();
    await waitFor(() => {
      const code = String($('codeEl').textContent || '').trim();
      return code.indexOf('—') < 0 && getComputedStyle($('roomCard')).display !== 'none';
    }, 8000);
    const code = String($('codeEl').textContent || '').replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const teams = [];
    for (const name of ['BINTANG 1', 'BINTANG 2', 'BINTANG 3', 'BINTANG 4']) {
      const ws = await openWs();
      ws.send(JSON.stringify({ type: 'join_room', code: code, teamName: name }));
      teams.push(ws);
    }
    await new Promise((r) => setTimeout(r, 400));
    $('btnStart').click();
    await new Promise((r) => setTimeout(r, 300));
    const qs = [
      { q: 'The cat is sleeping ______ the table. (Di bawah)', e: '🐱🪑', c: 'under', w: 'behind' },
      { q: 'Look! She ______ reading a book now.', e: '📖👧', c: 'is', w: 'are' },
      { q: 'We keep milk and fruit cold in the ______.', e: '🧊🍎', c: 'refrigerator', w: 'cupboard' },
      { q: 'I go to school ______ bus.', e: '🚌🏫', c: 'by', w: 'on' }
    ];
    const base = [2, 5, 8, 11];
    let tick = 0;
    window.__adminDemo = setInterval(() => {
      tick++;
      teams.forEach((ws, i) => {
        const f = base[i] + Math.floor(tick / 24);
        const q = qs[(f + i) % qs.length];
        const cx = ((i % 3) - 1) * 60;
        ws.send(JSON.stringify({ type: 'player_state', s: {
          f: f, sc: f * 120, stk: Math.min(5, f % 6), cx: cx, cy: -f * 210,
          sx: cx, sy: -f * 210 - 48, ss: 'idle', se: 'happy', sr: 0, sk: 0, kx: 1, ky: 1,
          b: [cx, -f * 210],
          l: { x: cx - 230, y: -(f + 1) * 210, t: q.c, ok: 1, st: 'n', br: 0, fy: 0 },
          r: { x: cx + 230, y: -(f + 1) * 210, t: q.w, ok: 0, st: 'n', br: 0, fy: 0 },
          tr: [], q: { t: q.q, e: q.e }
        } }));
      });
    }, 125);
    $('btnWatch').click();
    return code;
  })()`;
}



const DEFAULTS = {
  url: DEFAULT_URL,
  out: '.shots',
  viewport: { width: 1280, height: 800, mobile: false },
  scenario: 'all',
  edge: process.env.SEV7EN_EDGE || DEFAULT_EDGE,
  settleMs: 500,
  port: 0,
  navTimeoutMs: 25000,
  evalTimeoutMs: 15000,
};

const HELP = `Penggunaan:
  node tools/capture3d.mjs [opsi]

Opsi (format --kunci=nilai):
  --url=URL              URL game (default ${DEFAULT_URL})
                         Server statis diasumsikan sudah berjalan di port 4173.
  --out=FOLDER           Folder dasar output (default .shots).
                         Hasil masuk ke FOLDER/<timestamp>/
  --viewport=WxH         Viewport desktop dasar (default 1280x800)
  --scenario=all|a,b     Skenario yang dijalankan (default all)
  --edge=PATH            Path msedge.exe (default ${DEFAULT_EDGE})
  --settle=MS            Jeda setelah load sebelum langkah pertama (default 500)
  --port=PORT            Port remote debugging (default: port bebas acak)
  --nav-timeout=MS       Timeout navigasi/load (default 25000)
  --eval-timeout=MS      Timeout Runtime.evaluate (default 15000)
  --strict               Anggap console.error sebagai kegagalan (exit 1)
  --keep-open            Biarkan Edge hidup setelah run; Ctrl+C untuk menutup
  --quiet                Sembunyikan log progres (ringkasan JSON tetap dicetak)

Skenario tersedia:
${SCENARIOS.map((scenario) => `  ${scenario.name.padEnd(17)} ${scenario.label}`).join('\n')}

Contoh:
  node tools/capture3d.mjs
  node tools/capture3d.mjs --scenario=play,wrong --viewport=1440x900
  node tools/capture3d.mjs --out=.shots/uji --scenario=mobile-portrait,mid

Exit code: 0 sukses, 1 ada exception/page error/kegagalan harness,
           2 setup gagal (argumen, server statis, atau Edge tidak ditemukan).
Output  : FOLDER/<timestamp>/*.png + summary.json, ringkasan JSON di stdout.
`;

// ===========================================================================
// Util umum
// ===========================================================================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shorten(value, max = 300) {
  const text = typeof value === 'string' ? value : safeStringify(value);
  if (typeof text !== 'string') return String(text);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatTimestamp(date) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function safeFileName(name) {
  return String(name).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'shot';
}

function makeLogger(quiet) {
  return (message) => {
    if (!quiet) console.log(`[sev7en-capture] ${message}`);
  };
}

function formatRemoteObject(object) {
  if (object === null || typeof object !== 'object') return String(object);
  if ('value' in object) return typeof object.value === 'string' ? object.value : safeStringify(object.value);
  if (object.unserializableValue !== undefined) return String(object.unserializableValue);
  if (object.description !== undefined) return String(object.description);
  return `<${object.type}>`;
}

function summarizeValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return shorten(value, 300);
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  return shorten(safeStringify(value), 300);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function describeFetchError(error) {
  if (error?.name === 'TimeoutError') return 'timeout (server tidak menjawab)';
  const code = error?.cause?.code;
  if (code) return `${code}: ${error.message}`;
  return error?.message || String(error);
}

// ===========================================================================
// Argumen CLI
// ===========================================================================
function parsePositiveNumber(raw, flagName, { min = 0, max = 120000, integer = true } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${flagName} harus angka${integer ? ' bulat' : ''} ${min}..${max} (dapat: ${JSON.stringify(raw)})`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {
    ...DEFAULTS,
    viewport: { ...DEFAULTS.viewport },
    keepOpen: false,
    quiet: false,
    strict: false,
    help: false,
  };
  const unknown = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      unknown.push(arg);
      continue;
    }
    if (!arg.includes('=')) {
      if (arg === '--keep-open') { opts.keepOpen = true; continue; }
      if (arg === '--quiet') { opts.quiet = true; continue; }
      if (arg === '--strict') { opts.strict = true; continue; }
      unknown.push(arg);
      continue;
    }

    const separator = arg.indexOf('=');
    const key = arg.slice(2, separator);
    const value = arg.slice(separator + 1);

    switch (key) {
      case 'url': {
        if (!/^https?:\/\//i.test(value)) {
          throw new Error(`--url harus diawali http:// atau https:// (dapat: ${JSON.stringify(value)})`);
        }
        opts.url = value;
        break;
      }
      case 'out': {
        if (!value.trim()) throw new Error('--out tidak boleh kosong');
        opts.out = value;
        break;
      }
      case 'viewport': {
        const match = /^(\d+)\s*[xX]\s*(\d+)$/.exec(value.trim());
        if (!match) throw new Error(`--viewport harus format LEBARxTINGGI, contoh --viewport=1280x800 (dapat: ${JSON.stringify(value)})`);
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (width < 200 || height < 200 || width > 7680 || height > 4320) {
          throw new Error(`--viewport di luar batas wajar: ${width}x${height}`);
        }
        opts.viewport = { width, height, mobile: false };
        break;
      }
      case 'scenario': {
        if (!value.trim()) throw new Error('--scenario tidak boleh kosong (pakai "all" atau nama skenario)');
        opts.scenario = value;
        break;
      }
      case 'edge': {
        if (!value.trim()) throw new Error('--edge tidak boleh kosong');
        opts.edge = value;
        break;
      }
      case 'settle':
        opts.settleMs = parsePositiveNumber(value, '--settle', { min: 0, max: 60000 });
        break;
      case 'port':
        opts.port = parsePositiveNumber(value, '--port', { min: 0, max: 65535 });
        break;
      case 'nav-timeout':
        opts.navTimeoutMs = parsePositiveNumber(value, '--nav-timeout', { min: 1000, max: 120000 });
        break;
      case 'eval-timeout':
        opts.evalTimeoutMs = parsePositiveNumber(value, '--eval-timeout', { min: 500, max: 120000 });
        break;
      default:
        unknown.push(arg);
    }
  }

  if (unknown.length) {
    throw new Error(`Argumen tidak dikenal: ${unknown.join(' ')}. Opsi bernilai wajib memakai format --kunci=nilai. Lihat --help.`);
  }
  return opts;
}

function selectScenarios(spec) {
  if (!spec || spec.trim().toLowerCase() === 'all') return SCENARIOS;
  const byName = new Map(SCENARIOS.map((scenario) => [scenario.name, scenario]));
  const names = [...new Set(spec.split(',').map((name) => name.trim()).filter(Boolean))];
  if (!names.length) throw new Error('--scenario tidak berisi nama skenario yang valid');
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length) {
    throw new Error(`Skenario tidak dikenal: ${unknown.join(', ')}. Tersedia: ${SCENARIOS.map((scenario) => scenario.name).join(', ')}`);
  }
  return names.map((name) => byName.get(name));
}

// ===========================================================================
// Prasyarat: server statis, Edge, port bebas, folder output
// ===========================================================================
async function checkServer(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
    await response.arrayBuffer();
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, reason: describeFetchError(error) };
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        if (!port) reject(new Error('Gagal mendapatkan port bebas'));
        else resolve(port);
      });
    });
  });
}

async function makeOutDir(base) {
  const root = path.resolve(base);
  await mkdir(root, { recursive: true });
  const stamp = formatTimestamp(new Date());
  let candidate = path.join(root, stamp);
  let counter = 2;
  while (await fileExists(candidate)) {
    candidate = path.join(root, `${stamp}-${counter++}`);
    if (counter > 99) throw new Error(`Tidak bisa membuat folder output unik di ${root}`);
  }
  await mkdir(candidate, { recursive: true });
  return candidate;
}

// ===========================================================================
// CDP: koneksi WebSocket + request/response berbasis id + event listener
// ===========================================================================
class CdpConnection {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();
  #closed = false;

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => this.#handleMessage(event));
    socket.addEventListener('close', () => this.#handleClose());
    socket.addEventListener('error', () => {});
  }

  static async connect(wsUrl, timeoutMs = 10000) {
    if (typeof WebSocket !== 'function') {
      throw new Error('Global WebSocket tidak tersedia. Harness ini butuh Node 22+ (disarankan Node 26).');
    }
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { socket.close(); } catch { /* abaikan */ }
        reject(new Error(`Koneksi WebSocket ke ${wsUrl} timeout setelah ${timeoutMs}ms`));
      }, timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket gagal terhubung ke ${wsUrl}${event?.message ? `: ${event.message}` : ''}`));
      }, { once: true });
    });
    return new CdpConnection(socket);
  }

  #handleMessage(event) {
    let message;
    try {
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        const extra = message.error.data ? ` — ${message.error.data}` : '';
        pending.reject(new Error(`${pending.method} gagal: ${message.error.message}${extra}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method !== 'string') return;
    const handlers = this.#handlers.get(message.method);
    if (!handlers || handlers.size === 0) return;
    for (const handler of [...handlers]) {
      try {
        handler(message.params ?? {});
      } catch {
        // Error di handler event tidak boleh menjatuhkan koneksi CDP.
      }
    }
  }

  #handleClose() {
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(new Error('CDP socket tertutup'));
    this.#pending.clear();
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.#closed) return Promise.reject(new Error(`CDP socket sudah tertutup (${method})`));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timeout setelah ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, handler) {
    let handlers = this.#handlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => this.off(method, handler);
  }

  off(method, handler) {
    const handlers = this.#handlers.get(method);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this.#handlers.delete(method);
  }

  waitForEvent(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Menunggu event ${method} timeout setelah ${timeoutMs}ms`));
      }, timeoutMs);
      const unsubscribe = this.on(method, (params) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
    });
  }

  async close() {
    if (this.#closed) return;
    try {
      this.#socket.close(1000, 'selesai');
    } catch {
      // abaikan
    }
    await sleep(50);
  }
}

// ===========================================================================
// Diagnostik: exception, console error/warning, log error
// ===========================================================================
class ErrorCollector {
  constructor(logger) {
    this.logger = logger;
    this.items = [];
    this.scenario = null;
    this.ignoredLogEntries = 0;
  }

  begin(scenarioName) {
    this.scenario = scenarioName;
  }

  add(kind, info) {
    const item = { scenario: this.scenario ?? '(startup)', kind, at: new Date().toISOString(), ...info };
    this.items.push(item);
    if (this.logger) this.logger(item);
    return item;
  }

  forScenario(scenarioName) {
    return this.items.filter((item) => item.scenario === scenarioName);
  }

  counts() {
    const counts = {
      uncaughtExceptions: 0,
      consoleErrors: 0,
      consoleWarnings: 0,
      logErrors: 0,
      harnessErrors: 0,
      harnessWarnings: 0,
      ignoredLogEntries: this.ignoredLogEntries,
    };
    for (const item of this.items) {
      switch (item.kind) {
        case 'uncaught-exception': counts.uncaughtExceptions += 1; break;
        case 'console-error': counts.consoleErrors += 1; break;
        case 'console-warning': counts.consoleWarnings += 1; break;
        case 'log-error': counts.logErrors += 1; break;
        case 'harness-error': counts.harnessErrors += 1; break;
        case 'harness-warning': counts.harnessWarnings += 1; break;
        default: break;
      }
    }
    return counts;
  }

  hasFatal(strict) {
    return this.items.some((item) => (
      item.kind === 'uncaught-exception'
      || item.kind === 'log-error'
      || item.kind === 'harness-error'
      || (strict && item.kind === 'console-error')
    ));
  }
}

const errorLogger = (item) => {
  if (item.kind === 'console-warning' || item.kind === 'harness-warning') return;
  const labels = {
    'uncaught-exception': 'EXCEPTION',
    'console-error': 'console.error',
    'log-error': 'log-error',
    'harness-error': 'harness-error',
  };
  const label = labels[item.kind] || item.kind;
  console.error(`[sev7en-capture] ${label} [${item.scenario}]: ${shorten(item.text, 500)}`);
};

function attachDiagnostics(cdp, errors) {
  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params?.exceptionDetails ?? {};
    const exception = details.exception ?? {};
    const description = exception.description || details.text || 'Uncaught exception';
    errors.add('uncaught-exception', {
      text: shorten(description, MAX_CONSOLE_TEXT),
      url: details.url || exception.url || '',
      line: details.lineNumber,
      column: details.columnNumber,
    });
  });

  cdp.on('Runtime.consoleAPICalled', (params) => {
    const type = params?.type;
    if (type !== 'error' && type !== 'warning' && type !== 'assert') return;
    const text = (params.args ?? []).map(formatRemoteObject).join(' ');
    const kind = type === 'warning' ? 'console-warning' : 'console-error';
    errors.add(kind, { text: shorten(text, MAX_CONSOLE_TEXT), type });
  });

  cdp.on('Log.entryAdded', (params) => {
    const entry = params?.entry ?? {};
    if (entry.level !== 'error') return;
    const url = entry.url || '';
    const text = entry.text || '';
    // python http.server tidak punya favicon; 404 favicon bukan error game.
    if (/favicon\.ico/i.test(url) || /favicon/i.test(text)) {
      errors.ignoredLogEntries += 1;
      return;
    }
    errors.add('log-error', {
      text: shorten(text, MAX_CONSOLE_TEXT),
      url,
      source: entry.source || '',
      line: entry.lineNumber,
    });
  });

  // Jangan biarkan dialog JS memblokir screenshot.
  cdp.on('Page.javascriptDialogOpening', () => {
    cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
}

// ===========================================================================
// Operasi halaman
// ===========================================================================
async function applyViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: Boolean(viewport.mobile),
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: Boolean(viewport.mobile),
      maxTouchPoints: viewport.mobile ? 5 : 1,
    });
  } catch {
    // Touch emulation opsional; abaikan bila versi Edge menolak.
  }
}

async function evaluate(cdp, expression, options = {}) {
  const { awaitPromise = true, timeoutMs = 15000, userGesture = true } = options;
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture,
    timeout: timeoutMs,
  }, timeoutMs + 3000);
  if (result?.exceptionDetails) {
    const details = result.exceptionDetails;
    const description = details.exception?.description || details.text || 'exception';
    throw new Error(`Evaluasi JS gagal: ${shorten(description, 500)}`);
  }
  if (!result || !result.result) return undefined;
  return result.result.value;
}

async function waitForCondition(cdp, expression, timeoutMs = 5000, pollMs = 60) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const truthy = await evaluate(cdp, `Boolean(${expression})`, { awaitPromise: false, timeoutMs: 4000 });
      if (truthy) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
  throw new Error(`waitFor timeout ${timeoutMs}ms: ${expression}${lastError ? ` — ${lastError.message}` : ''}`);
}

async function waitAnimationFrames(cdp, frames = 2, timeoutMs = 3000) {
  const expression = `new Promise((resolve) => { let remaining = ${Math.max(1, Math.floor(frames))}; const step = () => { remaining -= 1; if (remaining <= 0) resolve(true); else requestAnimationFrame(step); }; requestAnimationFrame(step); })`;
  try {
    await evaluate(cdp, expression, { awaitPromise: true, timeoutMs });
  } catch {
    await sleep(100);
  }
}

function samePage(first, second) {
  try {
    const a = new URL(first);
    const b = new URL(second);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return first === second;
  }
}

async function navigate(cdp, url, timeoutMs = 25000) {
  const loadEvent = cdp.waitForEvent('Page.loadEventFired', timeoutMs);
  let navResult;
  try {
    navResult = await cdp.send('Page.navigate', { url }, timeoutMs);
  } catch (error) {
    loadEvent.catch(() => {});
    throw error;
  }
  if (navResult?.errorText) {
    loadEvent.catch(() => {});
    throw new Error(`Navigasi ke ${url} gagal: ${navResult.errorText}`);
  }
  await loadEvent.catch((error) => {
    throw new Error(`Menunggu load ${url} gagal: ${error.message}`);
  });

  // loadEventFired kadang datang dari frame lama; pastikan readyState + URL benar.
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const state = await evaluate(cdp, '({ href: location.href, ready: document.readyState })', { awaitPromise: false, timeoutMs: 2500 });
      if (state && state.ready === 'complete' && samePage(state.href, url)) {
        await sleep(80);
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(80);
  }
  throw new Error(`Halaman ${url} tidak mencapai readyState "complete" dalam ${timeoutMs}ms${lastError ? ` — ${lastError.message}` : ''}`);
}

const PAGE_STATE_EXPR = `(() => {
  const safe = (read, fallback) => { try { return read(); } catch (e) { return fallback; } };
  return {
    title: document.title,
    readyState: document.readyState,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    url: location.href,
    gameRunning: safe(() => gameRunning, null),
    floorLevel: safe(() => floorLevel, null),
    score: safe(() => score, null),
    streak: safe(() => streak, null),
    cam: safe(() => cam, null),
    star: safe(() => ({ wx: star.wx, wy: star.wy, state: star.state, expression: star.expression }), null),
    leftOption: safe(() => leftOptionPlat ? ({ wx: leftOptionPlat.wx, wy: leftOptionPlat.wy, isCorrect: leftOptionPlat.isCorrect, status: leftOptionPlat.status, text: leftOptionPlat.text }) : null, null),
    rightOption: safe(() => rightOptionPlat ? ({ wx: rightOptionPlat.wx, wy: rightOptionPlat.wy, isCorrect: rightOptionPlat.isCorrect, status: rightOptionPlat.status, text: rightOptionPlat.text }) : null, null),
    platformCount: safe(() => letitedPlatforms.length, null),
    cloudCount: safe(() => bgClouds.length, null),
    starCount: safe(() => spaceStars.length, null),
    camera3D: safe(() => camera3D ? ({ eye: camera3D.eye, target: camera3D.target, dist: camera3D.dist, fov: camera3D.fov }) : null, null),
    canvas: safe(() => ({ width: canvas.width, height: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight }), null),
    modalVisible: safe(() => getComputedStyle(document.getElementById('modal')).display !== 'none', null),
    hud: safe(() => ({
      team: document.getElementById('team-display')?.textContent ?? null,
      score: document.getElementById('score-val')?.textContent ?? null,
      altitude: document.getElementById('alt-val')?.textContent ?? null,
      zone: document.getElementById('zone-badge')?.textContent ?? null,
      counter: document.getElementById('q-counter')?.textContent ?? null,
      question: document.getElementById('q-text')?.textContent ?? null,
    }), null),
  };
})()`;

async function readPageState(cdp) {
  try {
    return await evaluate(cdp, PAGE_STATE_EXPR, { awaitPromise: false, timeoutMs: 5000 });
  } catch (error) {
    return { error: error.message };
  }
}

async function captureScreenshot(cdp, filePath) {
  await waitAnimationFrames(cdp, 2);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    optimizeForSpeed: false,
  }, 30000);
  if (!result?.data) throw new Error('Page.captureScreenshot tidak mengembalikan data PNG');
  const buffer = Buffer.from(result.data, 'base64');
  if (buffer.length < 100) throw new Error(`PNG hasil screenshot terlalu kecil (${buffer.length} byte)`);
  await writeFile(filePath, buffer);
  return {
    file: filePath,
    relativeFile: path.relative(process.cwd(), filePath),
    bytes: buffer.length,
  };
}

// ===========================================================================
// Edge lifecycle
// ===========================================================================
async function launchEdge(edgePath, port, profileDir, viewport) {
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-sync',
    '--disable-background-networking',
    '--metrics-recording-only',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank',
  ];
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(edgePath, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Gagal spawn Edge (${edgePath}): ${error.message}`));
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      resolve(child);
    });
  });
}

async function fetchJson(url, options = {}, timeoutMs = 3000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
  return response.json();
}

async function waitForCdpEndpoint(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const info = await fetchJson(`http://127.0.0.1:${port}/json/version`, {}, 1500);
      if (info?.webSocketDebuggerUrl) return info;
      lastError = new Error('/json/version belum berisi webSocketDebuggerUrl');
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`CDP endpoint http://127.0.0.1:${port}/json/version tidak siap dalam ${timeoutMs}ms${lastError ? ` — ${describeFetchError(lastError)}` : ''}`);
}

async function pickPageTarget(port) {
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = Array.isArray(targets)
        ? targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        : null;
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  try {
    const created = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (created?.webSocketDebuggerUrl) return created;
  } catch (error) {
    lastError = error;
  }
  throw new Error(`Tidak ada target page di Edge (CDP port ${port})${lastError ? ` — ${lastError.message}` : ''}`);
}

async function stopEdge(child, graceMs = 6000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* abaikan */ }
      finish();
    }, graceMs);
    timer.unref?.();
    try {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.once('error', () => { try { child.kill(); } catch { /* abaikan */ } });
        killer.once('exit', () => setTimeout(finish, 150));
      } else {
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* abaikan */ } }, 1500).unref?.();
      }
    } catch {
      try { child.kill(); } catch { /* abaikan */ }
    }
  });
}

async function removeProfile(profileDir) {
  if (!profileDir) return;
  const resolved = path.resolve(profileDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(PROFILE_PREFIX)) {
    console.error(`[sev7en-capture] Lewati hapus profil (path tak terduga): ${resolved}`);
    return;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(resolved, { recursive: true, force: true, maxRetries: 2 });
      return;
    } catch {
      await sleep(250);
    }
  }
  console.error(`[sev7en-capture] Profil Edge sementara gagal dihapus: ${resolved}`);
}

// ===========================================================================
// Skenario runner
// ===========================================================================
function describeStep(step) {
  const info = {};
  if (step.eval) info.eval = shorten(step.eval, 180);
  if (step.waitFor) info.waitFor = shorten(step.waitFor, 140);
  if (step.timeout) info.waitForTimeoutMs = step.timeout;
  if (typeof step.wait === 'number') info.waitMs = step.wait;
  if (step.shot) info.shot = step.shot;
  return info;
}

async function waitForGameGlobals(cdp, errors) {
  try {
    await waitForCondition(cdp, 'typeof startGame === "function" && typeof triggerJump === "function"', 6000);
  } catch (error) {
    errors.add('harness-warning', {
      text: `Global startGame/triggerJump belum siap: ${error.message}`,
    });
  }
}

async function runScenario(cdp, scenario, context) {
  const { opts, outDir, errors } = context;
  const viewport = scenario.viewport ?? opts.viewport;
  const record = {
    name: scenario.name,
    label: scenario.label,
    viewport: { width: viewport.width, height: viewport.height, mobile: Boolean(viewport.mobile) },
    ok: true,
    durationMs: 0,
    screenshots: [],
    steps: [],
    state: null,
    errors: [],
  };
  const startedMs = Date.now();
  errors.begin(scenario.name);

  try {
    await applyViewport(cdp, viewport);
    await navigate(cdp, opts.url, opts.navTimeoutMs);
    await waitForGameGlobals(cdp, errors);
    if (opts.settleMs > 0) await sleep(opts.settleMs);

    let explicitShot = false;
    for (const step of scenario.steps ?? []) {
      const stepStartedMs = Date.now();
      const info = describeStep(step);
      try {
        if (step.eval) {
          const value = await evaluate(cdp, step.eval, { timeoutMs: opts.evalTimeoutMs });
          const resultText = summarizeValue(value);
          if (resultText !== undefined) info.result = resultText;
        }
        if (step.waitFor) {
          await waitForCondition(cdp, step.waitFor, step.timeout ?? 5000);
        }
        if (typeof step.wait === 'number' && step.wait > 0) {
          await sleep(step.wait);
        }
        if (step.shot) {
          const filePath = path.join(outDir, `${safeFileName(scenario.name)}--${safeFileName(step.shot)}.png`);
          record.screenshots.push({ label: step.shot, ...(await captureScreenshot(cdp, filePath)) });
          explicitShot = true;
        }
      } finally {
        info.ms = Date.now() - stepStartedMs;
        record.steps.push(info);
      }
    }

    if (!explicitShot) {
      const filePath = path.join(outDir, `${safeFileName(scenario.name)}.png`);
      record.screenshots.push({ label: scenario.name, ...(await captureScreenshot(cdp, filePath)) });
    }
    record.state = await readPageState(cdp);
  } catch (error) {
    record.ok = false;
    errors.add('harness-error', { text: `${scenario.name}: ${error.message}` });
  } finally {
    record.durationMs = Date.now() - startedMs;
    record.errors = errors.forScenario(scenario.name);
    const fatal = record.errors.some((item) => (
      item.kind === 'uncaught-exception'
      || item.kind === 'log-error'
      || item.kind === 'harness-error'
      || (opts.strict && item.kind === 'console-error')
    ));
    if (fatal) record.ok = false;
  }
  return record;
}

// ===========================================================================
// Main
// ===========================================================================
const state = {
  cdp: null,
  edgeChild: null,
  profileDir: null,
  cleanupPromise: null,
};

function cleanupBrowser() {
  if (!state.cleanupPromise) {
    state.cleanupPromise = (async () => {
      if (state.cdp) {
        try { await state.cdp.close(); } catch { /* abaikan */ }
        state.cdp = null;
      }
      if (state.edgeChild) {
        try { await stopEdge(state.edgeChild); } catch { /* abaikan */ }
        state.edgeChild = null;
      }
      if (state.profileDir) {
        await removeProfile(state.profileDir);
        state.profileDir = null;
      }
    })();
  }
  return state.cleanupPromise;
}

async function run() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[sev7en-capture] ${error.message}`);
    console.error('[sev7en-capture] Jalankan dengan --help untuk daftar opsi.');
    return 2;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  let scenarios;
  try {
    scenarios = selectScenarios(opts.scenario);
  } catch (error) {
    console.error(`[sev7en-capture] ${error.message}`);
    return 2;
  }

  const log = makeLogger(opts.quiet);
  const startedAt = new Date();
  const startedAtMs = Date.now();

  log(`url: ${opts.url}`);
  log(`skenario: ${scenarios.map((scenario) => scenario.name).join(', ')}`);
  log(`Edge: ${opts.edge}`);

  const server = await checkServer(opts.url);
  if (!server.ok) {
    console.error('[sev7en-capture] Server statis tidak bisa diakses.');
    console.error(`  URL     : ${opts.url}`);
    console.error(`  Penyebab: ${server.reason}`);
    console.error('  Harness tidak menjalankan server. Dari root proyek jalankan:');
    console.error('    python -m http.server 4173');
    console.error('  Lalu ulangi perintah ini (atau pakai --url=... bila port berbeda).');
    return 2;
  }
  log(`server OK (HTTP ${server.status})`);

  if (!(await fileExists(opts.edge))) {
    console.error(`[sev7en-capture] Microsoft Edge tidak ditemukan: ${opts.edge}`);
    console.error('  Tunjuk path msedge.exe lewat --edge=... atau set environment SEV7EN_EDGE.');
    return 2;
  }

  const errors = new ErrorCollector(errorLogger);
  const port = opts.port || (await getFreePort());
  const profileDir = await mkdtemp(path.join(os.tmpdir(), PROFILE_PREFIX));
  state.profileDir = profileDir;

  try {
    const child = await launchEdge(opts.edge, port, profileDir, opts.viewport);
    state.edgeChild = child;
    log(`Edge PID ${child.pid} · CDP port ${port}`);

    const cdpWait = waitForCdpEndpoint(port, 20000);
    const earlyExit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ kind: 'exit', code, signal })));
    const ready = await Promise.race([cdpWait.then((info) => ({ kind: 'ready', info })), earlyExit]);
    if (ready.kind === 'exit') {
      // waitForCdpEndpoint masih polling; cegah unhandled rejection saat nanti timeout.
      cdpWait.catch(() => {});
      throw new Error(`Edge keluar sebelum CDP siap (code=${ready.code}, signal=${ready.signal})`);
    }
    log(`CDP siap: ${ready.info.Browser || 'Microsoft Edge'}`);

    const target = await pickPageTarget(port);
    const cdp = await CdpConnection.connect(target.webSocketDebuggerUrl, 12000);
    state.cdp = cdp;
    attachDiagnostics(cdp, errors);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    log(`terhubung ke target page: ${target.id || '(tanpa id)'}`);

    const outDir = await makeOutDir(opts.out);
    log(`outDir: ${outDir}`);

    const records = [];
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      log(`[${index + 1}/${scenarios.length}] ${scenario.name} — ${scenario.label}`);
      const record = await runScenario(cdp, scenario, { opts, outDir, errors });
      records.push(record);
      log(`[${index + 1}/${scenarios.length}] ${record.ok ? 'OK' : 'GAGAL'} · ${record.durationMs}ms · ${record.screenshots.length} PNG`);
      for (const screenshot of record.screenshots) {
        log(`    PNG: ${screenshot.relativeFile} (${screenshot.bytes} byte)`);
      }
    }

    const counts = errors.counts();
    const failedScenarios = records.filter((record) => !record.ok).map((record) => record.name);
    const summary = {
      ok: failedScenarios.length === 0 && !errors.hasFatal(opts.strict),
      url: opts.url,
      edge: opts.edge,
      strict: Boolean(opts.strict),
      outDir,
      viewport: `${opts.viewport.width}x${opts.viewport.height}`,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      counts,
      failedScenarios,
      scenarios: records,
      errors: errors.items,
    };
    const summaryPath = path.join(outDir, 'summary.json');
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

    if (!opts.quiet) {
      log('');
      log(`=== RINGKASAN · ${summary.ok ? 'OK' : 'ADA MASALAH'} ===`);
      log(`skenario ${records.length} · PNG ${records.reduce((total, record) => total + record.screenshots.length, 0)} · exception ${counts.uncaughtExceptions} · console.error ${counts.consoleErrors} · log-error ${counts.logErrors} · warning ${counts.consoleWarnings}`);
      log(`summary.json: ${summaryPath}`);
    }
    console.log(JSON.stringify(summary, null, 2));

    if (opts.keepOpen) {
      log(`--keep-open: Edge hidup di http://127.0.0.1:${port}/json/list`);
      log('Tekan Ctrl+C untuk menutup Edge dan keluar.');
      await new Promise(() => {});
    }

    return summary.ok ? 0 : 1;
  } finally {
    await cleanupBrowser();
  }
}

function handleSignal(signal) {
  console.error(`\n[sev7en-capture] ${signal} diterima — menutup Edge...`);
  cleanupBrowser().finally(() => process.exit(130));
}

async function main() {
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  try {
    return await run();
  } catch (error) {
    console.error(`[sev7en-capture] Error tak terduga: ${error?.stack || error}`);
    return 1;
  } finally {
    await cleanupBrowser();
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`[sev7en-capture] Fatal: ${error?.stack || error}`);
  process.exitCode = 1;
});

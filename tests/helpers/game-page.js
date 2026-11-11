// tests/helpers/game-page.js
// Loads a static game HTML file and executes its real inline <script> blocks
// inside a deterministic sandbox (fake DOM, canvas, audio, timers, WebSocket).
// This lets the unit tests exercise the shipped game code without modifying it.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

export const GAME_FILES = [
  'game.html',
  'star_pou_sky_climber.html',
];

const RealDate = Date;

export function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue; // external scripts are not part of the game logic
    if (m[2].trim()) scripts.push({ attrs, code: m[2] });
  }
  return scripts;
}

class FakeClock {
  constructor(now = 1700000000000) {
    this.now = now;
    this.seq = 0;
    this.tasks = new Map();
  }
  setTimeout(fn, ms = 0) {
    const id = ++this.seq;
    this.tasks.set(id, { id, fn, time: this.now + Math.max(0, Number(ms) || 0), interval: null });
    return id;
  }
  setInterval(fn, ms = 0) {
    const id = ++this.seq;
    const every = Math.max(1, Number(ms) || 0);
    this.tasks.set(id, { id, fn, time: this.now + every, interval: every });
    return id;
  }
  clear(id) {
    this.tasks.delete(id);
  }
  advance(ms) {
    const target = this.now + Math.max(0, Number(ms) || 0);
    let guard = 0;
    for (;;) {
      let next = null;
      for (const task of this.tasks.values()) {
        if (task.time > target) continue;
        if (!next || task.time < next.time || (task.time === next.time && task.id < next.id)) next = task;
      }
      if (!next) break;
      if (++guard > 200000) throw new Error('FakeClock: too many timer iterations');
      this.now = next.time;
      if (next.interval) next.time += next.interval;
      else this.tasks.delete(next.id);
      next.fn();
    }
    this.now = target;
  }
  pending() {
    return this.tasks.size;
  }
}

function createCanvasContext(calls) {
  const record = (name) => (...args) => { calls[name] = (calls[name] || 0) + 1; return args; };
  const gradient = () => ({ addColorStop: record('addColorStop') });
  // Paint-state log: unlike the plain call counters this keeps the *style* that
  // was active for each paint, which is how 3D tests assert zone/status colours
  // without hard-coding a specific shadeHex() output.
  const log = { fills: [], strokes: [], texts: [], transforms: [], lineDashes: [] };
  const ctx = {
    calls,
    _log: log,
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, lineJoin: 'miter',
    lineCap: 'butt', miterLimit: 10, filter: 'none', imageSmoothingEnabled: true,
    lineDashOffset: 0, shadowColor: 'transparent', shadowBlur: 0,
    shadowOffsetX: 0, shadowOffsetY: 0, globalCompositeOperation: 'source-over',
    save: record('save'), restore: record('restore'),
    beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'), bezierCurveTo: record('bezierCurveTo'),
    arc: record('arc'), arcTo: record('arcTo'), ellipse: record('ellipse'), rect: record('rect'),
    roundRect: record('roundRect'), clip: record('clip'),
    fill(...args) {
      record('fill')(...args);
      log.fills.push({ style: ctx.fillStyle, globalAlpha: ctx.globalAlpha });
      return undefined;
    },
    stroke(...args) {
      record('stroke')(...args);
      log.strokes.push({ style: ctx.strokeStyle, lineWidth: ctx.lineWidth, globalAlpha: ctx.globalAlpha });
      return undefined;
    },
    fillRect(...args) {
      record('fillRect')(...args);
      log.fills.push({ style: ctx.fillStyle, globalAlpha: ctx.globalAlpha });
      return undefined;
    },
    strokeRect: record('strokeRect'), clearRect: record('clearRect'),
    fillText(text, x, y, maxWidth) {
      record('fillText')(text, x, y, maxWidth);
      log.texts.push({ text: String(text), style: ctx.fillStyle, font: String(ctx.font), textAlign: ctx.textAlign, globalAlpha: ctx.globalAlpha });
      return undefined;
    },
    strokeText: record('strokeText'),
    translate: record('translate'), rotate: record('rotate'), scale: record('scale'),
    setTransform(a, b, c, d, e, f) {
      record('setTransform')(a, b, c, d, e, f);
      log.transforms.push([a, b, c, d, e, f]);
      return undefined;
    },
    transform: record('transform'), resetTransform: record('resetTransform'),
    setLineDash(segments) {
      record('setLineDash')(segments);
      log.lineDashes.push(Array.isArray(segments) ? [...segments] : segments);
      return undefined;
    },
    getLineDash: () => [],
    createLinearGradient: (...args) => { record('createLinearGradient')(...args); return gradient(); },
    createRadialGradient: (...args) => { record('createRadialGradient')(...args); return gradient(); },
    createConicGradient: (...args) => { record('createConicGradient')(...args); return gradient(); },
    createPattern: () => null,
    measureText: (text) => { record('measureText')(text); return { width: String(text).length * 10 }; },
    drawImage: record('drawImage'),
    putImageData: record('putImageData'),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return ctx;
}

function createElement(doc, tag = 'div', id = '') {
  // Real class bookkeeping: the spectator mode toggles
  // `document.body.classList.add('spectate-mode')`, so `classList` must behave
  // like the browser API instead of being a no-op. `className` stays in sync
  // in both directions.
  const classSet = new Set();
  const classList = {
    add(...names) { for (const n of names) if (String(n)) classSet.add(String(n)); },
    remove(...names) { for (const n of names) classSet.delete(String(n)); },
    toggle(name, force) {
      const key = String(name);
      const on = force === undefined ? !classSet.has(key) : !!force;
      if (on) classSet.add(key); else classSet.delete(key);
      return on;
    },
    replace(from, to) {
      if (!classSet.has(String(from))) return false;
      classSet.delete(String(from));
      classSet.add(String(to));
      return true;
    },
    contains(name) { return classSet.has(String(name)); },
    item(index) { return [...classSet][index] ?? null; },
    get length() { return classSet.size; },
    get value() { return [...classSet].join(' '); },
    toString() { return [...classSet].join(' '); },
  };
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeName: String(tag).toUpperCase(),
    nodeType: 1,
    id,
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    checked: false,
    selected: false,
    hidden: false,
    width: 0,
    height: 0,
    _listeners: {},
    _rect: null,
    classList,
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      if (child.id) doc._register(child);
      return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      if (child.id) doc._unregister(child);
      return child;
    },
    insertBefore(child) { return el.appendChild(child); },
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = el._listeners[type];
      if (list) el._listeners[type] = list.filter((f) => f !== fn);
    },
    dispatch(type, ev = {}) {
      for (const fn of el._listeners[type] || []) fn({ type, target: el, ...ev });
    },
    setAttribute(k, v) { el[k] = String(v); },
    getAttribute(k) { return el[k] === undefined ? null : String(el[k]); },
    hasAttribute(k) { return el[k] !== undefined; },
    removeAttribute(k) { delete el[k]; },
    querySelector(sel) { return doc.querySelector(sel); },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return el._rect || { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0 };
    },
    focus() {},
    blur() {},
    click() { el.dispatch('click', { clientX: 0, clientY: 0 }); },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    contains() { return false; },
  };

  // `className` is the canonical string form of the class set.
  Object.defineProperty(el, 'className', {
    get() { return [...classSet].join(' '); },
    set(value) {
      classSet.clear();
      for (const name of String(value || '').split(/\s+/)) if (name) classSet.add(name);
    },
    configurable: true,
    enumerable: true,
  });

  if (el.tagName === 'CANVAS') {
    const calls = {};
    const ctx = createCanvasContext(calls);
    ctx.canvas = el;
    el._ctx = ctx;
    el._ctxCalls = calls;
    el._ctxLog = ctx._log;
    el.getContext = (kind) => (kind === '2d' ? ctx : null);
    el.toDataURL = () => 'data:image/png;base64,';
    // The renderer reads clientWidth/clientHeight for sprite caches in some
    // browsers; keep them in sync with the backing-store size.
    Object.defineProperty(el, 'clientWidth', { get() { return el.width; }, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get() { return el.height; }, configurable: true });
  }
  return el;
}

class FakeAudioContext {
  constructor(log) {
    this.log = log;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { connect() {} };
    this.oscillators = [];
    this.gains = [];
    this.resumeCalls = 0;
    log.contexts.push(this);
  }
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
  createOscillator() {
    const osc = {
      type: 'sine',
      frequency: {
        setValueAtTime(v, t) { osc.freqStart = { v, t }; },
        exponentialRampToValueAtTime(v, t) { osc.freqExp = { v, t }; },
        linearRampToValueAtTime(v, t) { osc.freqLin = { v, t }; },
      },
      connect() {},
      disconnect() {},
      start(t) { osc.startedAt = t; },
      stop(t) { osc.stoppedAt = t; },
    };
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = {
      gain: {
        setValueAtTime(v, t) { gain.start = { v, t }; },
        exponentialRampToValueAtTime(v, t) { gain.exp = { v, t }; },
        linearRampToValueAtTime(v, t) { gain.lin = { v, t }; },
      },
      connect() {},
      disconnect() {},
    };
    this.gains.push(gain);
    return gain;
  }
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url, registry) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    registry.push(this);
  }
  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('WebSocket is not open');
    this.sent.push(String(data));
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    if (this.onclose) this.onclose({ type: 'close' });
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    if (this.onopen) this.onopen({ type: 'open' });
  }
  receive(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    if (this.onmessage) this.onmessage({ data, type: 'message' });
  }
  fail() {
    if (this.onerror) this.onerror({ type: 'error' });
  }
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadGamePage(file, options = {}) {
  const absPath = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const html = fs.readFileSync(absPath, 'utf8');
  const scripts = extractInlineScripts(html);

  const clock = new FakeClock(options.now ?? 1700000000000);
  const audioLog = { contexts: [] };
  const wsInstances = [];
  const alerts = [];
  const clipboard = { written: [] };
  const logs = [];
  const windowListeners = {};
  const documentListeners = {};
  const rafQueue = [];
  let rafSeq = 0;

  const document = {
    readyState: 'complete',
    _elements: new Map(),
    _selectors: new Map(),
    _register(el) {
      if (el.id) document._elements.set(el.id, el);
    },
    _unregister(el) {
      if (el.id && document._elements.get(el.id) === el) document._elements.delete(el.id);
    },
    getElementById(id) {
      const key = String(id);
      if (!document._elements.has(key)) {
        const tag = key === 'gameCanvas' ? 'canvas' : 'div';
        const el = createElement(document, tag, key);
        document._elements.set(key, el);
        if (key === 'gameCanvas') {
          el.width = options.innerWidth ?? 1280;
          el.height = options.innerHeight ?? 720;
        }
      }
      return document._elements.get(key);
    },
    querySelector(sel) {
      const key = String(sel);
      if (document._selectors.has(key)) return document._selectors.get(key);
      const idMatch = /^#([A-Za-z0-9_-]+)$/.exec(key);
      if (idMatch) return document.getElementById(idMatch[1]);
      const el = createElement(document, 'div', key);
      document._selectors.set(key, el);
      return el;
    },
    querySelectorAll() { return []; },
    createElement(tag) { return createElement(document, tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; },
    addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      if (documentListeners[type]) documentListeners[type] = documentListeners[type].filter((f) => f !== fn);
    },
    dispatch(type, ev = {}) {
      for (const fn of documentListeners[type] || []) fn({ type, target: document, ...ev });
    },
  };
  document.head = createElement(document, 'head', '');
  document.body = createElement(document, 'body', '');
  document.documentElement = createElement(document, 'html', '');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  const location = {
    protocol: options.protocol ?? 'http:',
    hostname: options.hostname ?? 'localhost',
    host: options.host ?? `${options.hostname ?? 'localhost'}:8080`,
    port: options.port ?? '8080',
    origin: options.origin ?? `${options.protocol ?? 'http:'}//${options.hostname ?? 'localhost'}`,
    pathname: options.pathname ?? '/game.html',
    search: options.search ?? '',
    hash: options.hash ?? '',
    href: `${options.origin ?? 'http://localhost'}${options.pathname ?? '/game.html'}${options.search ?? ''}${options.hash ?? ''}`,
  };

  const math = Object.create(Math);
  math.random = options.random ?? Math.random;

  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(clock.now);
      else super(...args);
    }
    static now() { return clock.now; }
  }

  const sandbox = {
    console: {
      log: (...args) => logs.push(args.join(' ')),
      info: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
      debug: (...args) => logs.push(args.join(' ')),
    },
    document,
    location,
    innerWidth: options.innerWidth ?? 1280,
    innerHeight: options.innerHeight ?? 720,
    navigator: { userAgent: 'node-test', clipboard: { writeText: (t) => { clipboard.written.push(String(t)); return Promise.resolve(); } } },
    alert: (msg) => { alerts.push(String(msg)); },
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => {
      if (windowListeners[type]) windowListeners[type] = windowListeners[type].filter((f) => f !== fn);
    },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clear(id),
    setInterval: (fn, ms) => clock.setInterval(fn, ms),
    clearInterval: (id) => clock.clear(id),
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return ++rafSeq; },
    cancelAnimationFrame: () => {},
    AudioContext: function AudioContext() { return new FakeAudioContext(audioLog); },
    WebSocket: function WebSocket(url) { return new FakeWebSocket(url, wsInstances); },
    URLSearchParams,
    Math: math,
    Date: FakeDate,
    Intl,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    performance: { now: () => clock.now - 1700000000000 },
  };
  // The 3D renderer caps the backing store at DPR 2; tests run at DPR 1 so
  // canvas.width === W (documented sandbox behaviour, see tests/README.md).
  sandbox.devicePixelRatio = options.devicePixelRatio ?? 1;
  sandbox.screen = {
    width: options.innerWidth ?? 1280,
    height: options.innerHeight ?? 720,
    devicePixelRatio: sandbox.devicePixelRatio,
  };
  sandbox.OffscreenCanvas = function OffscreenCanvas(width, height) {
    const el = createElement(document, 'canvas');
    el.width = Number(width) || 0;
    el.height = Number(height) || 0;
    el._isOffscreen = true;
    return el;
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  // Browser globals that the game assigns through `window.*`
  const context = vm.createContext(sandbox);

  for (let i = 0; i < scripts.length; i++) {
    vm.runInContext(scripts[i].code, context, { filename: `${path.basename(absPath)}#script${i + 1}` });
  }

  const page = {
    file: absPath,
    sandbox,
    context,
    window: sandbox,
    document,
    location,
    clock,
    audio: audioLog,
    alerts,
    clipboard,
    logs,
    wsInstances,
    rafQueue,
    get(expr) {
      return vm.runInContext(String(expr), context);
    },
    eval(code) {
      return vm.runInContext(String(code), context);
    },
    call(name, ...args) {
      const fn = vm.runInContext(String(name), context);
      if (typeof fn !== 'function') throw new Error(`${name} is not a function`);
      return fn(...args);
    },
    el(id) {
      return document.getElementById(id);
    },
    query(sel) {
      return document.querySelector(sel);
    },
    setRect(elOrId, rect) {
      const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
      el._rect = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0, ...rect };
      return el;
    },
    fireWindow(type, ev = {}) {
      for (const fn of windowListeners[type] || []) fn({ type, target: sandbox, ...ev });
    },
    fireDocument(type, ev = {}) {
      document.dispatch(type, ev);
    },
    fire(elOrId, type, ev = {}) {
      const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
      el.dispatch(type, ev);
    },
    setRandom(fn) {
      math.random = fn;
    },
    resetRandom() {
      math.random = Math.random;
    },
    frame(t = 0) {
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const cb of batch) cb(t);
      return batch.length;
    },
    frames(count, start = 0, step = 16.6667) {
      for (let i = 0; i < count; i++) page.frame(start + i * step);
    },
    advance(ms) {
      clock.advance(ms);
    },
    ctxCalls() {
      return document.getElementById('gameCanvas')._ctxCalls;
    },
    ctxLog() {
      return document.getElementById('gameCanvas')._ctxLog;
    },
    resetCtxCalls() {
      const canvas = document.getElementById('gameCanvas');
      const calls = canvas._ctxCalls;
      for (const key of Object.keys(calls)) delete calls[key];
      const log = canvas._ctxLog;
      if (log) for (const key of Object.keys(log)) log[key].length = 0;
    },
    lastWs() {
      return wsInstances[wsInstances.length - 1] || null;
    },
    plain(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    },
  };

  return page;
}

export function startGame(page, { topic = 'all', duration = 180, team = '' } = {}) {
  page.el('topic-select').value = topic;
  page.el('duration-select').value = String(duration);
  page.el('team-input').value = team;
  page.call('startGame');
}

export function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

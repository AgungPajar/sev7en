// tests/site-structure.test.js
// Guards the static site structure: required markup, self-contained scripts,
// and the duplicate VS build staying in sync.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers/game-page.js';

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const idsOf = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

const CORE_IDS = [
  'gameCanvas',
  'modal', 'modal-title', 'modal-desc',
  'team-input', 'topic-select', 'duration-select', 'team-display',
  'score-val', 'alt-val', 'zone-badge', 'timer-val',
  'q-counter', 'q-emoji', 'q-text',
];

const VS_IDS = [
  'vs-bar', 'vs-code-badge', 'vs-teams-count', 'vs-leaderboard', 'vs-lb-timer', 'vs-lb-list',
  'vs-modal', 'vs-card-create', 'vs-admin-pass', 'vs-materi', 'vs-duration',
  'vs-create-result', 'vs-code-display', 'vs-share-link', 'vs-lobby-host', 'vs-create-err',
  'vs-card-join', 'vs-join-code', 'vs-join-name', 'vs-join-lobby', 'vs-join-status',
  'vs-lobby-guest', 'vs-join-err',
];

describe('site structure', () => {
  for (const file of ['game.html', 'star_pou_sky_climber.html']) {
    it(`${file} contains all core game elements`, () => {
      const ids = new Set(idsOf(read(file)));
      for (const id of CORE_IDS) assert.ok(ids.has(id), `${file} is missing #${id}`);
    });

    it(`${file} is self-contained (no external scripts)`, () => {
      const html = read(file);
      assert.ok(!/<script[^>]+\bsrc\s*=/i.test(html), `${file} must not rely on external scripts`);
      assert.ok(/<script[^>]*>[\s\S]*?QUESTION_BANK[\s\S]*?<\/script>/i.test(html), `${file} must inline the game script`);
    });
  }

  it('game.html contains the full VS client markup', () => {
    const ids = new Set(idsOf(read('game.html')));
    for (const id of VS_IDS) assert.ok(ids.has(id), `game.html is missing #${id}`);
  });

  it('star_pou_sky_climber.html does not ship the VS client', () => {
    const html = read('star_pou_sky_climber.html');
    assert.ok(!html.includes('vsConnect'));
    assert.ok(!html.includes('vs-modal'));
    const ids = new Set(idsOf(html));
    for (const id of VS_IDS) assert.ok(!ids.has(id), `solo build should not contain #${id}`);
  });

  it('star_pou_vs.html is an exact copy of game.html', () => {
    assert.equal(read('star_pou_vs.html'), read('game.html'));
  });

  it('offers exactly one Living Room theme in the game and the admin panel', () => {
    for (const file of ['game.html', 'admin/index.html']) {
      const html = read(file);
      assert.ok(html.includes('value="living_room"'), `${file} is missing the living_room option`);
      assert.ok(
        !/value="(?:all|there_prep|food_kitchen|continuous_hobby|routine_transport)"/.test(html),
        `${file} still offers a retired theme option`,
      );
    }
    assert.match(read('admin/index.html'), /<select id="materi">[\s\S]*?<option value="living_room">/);
  });

  it('the landing page links to the game and the admin panel', () => {
    const html = read('index.html');
    assert.ok(html.includes('/game.html'));
    assert.ok(html.includes('/admin/'));
    for (const id of ['joinModal', 'joinCode', 'joinName', 'joinErr']) {
      assert.ok(new Set(idsOf(html)).has(id), `index.html is missing #${id}`);
    }
  });
});

// tests/landing.test.js
// Unit tests for the landing page join dialog (index.html).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGamePage } from './helpers/game-page.js';

const load = (opts = {}) => loadGamePage('index.html', opts);

describe('landing page — join dialog', () => {
  it('starts closed without a code or #join', () => {
    const page = load();
    assert.notEqual(page.el('joinModal').style.display, 'flex');
  });

  it('auto-opens and prefills the code from ?code=', () => {
    const page = load({ search: '?code=abc123' });
    assert.equal(page.el('joinModal').style.display, 'flex');
    assert.equal(page.el('joinCode').value, 'ABC123');
    assert.equal(page.el('joinErr').style.display, 'none');
  });

  it('auto-opens from the #join hash', () => {
    const page = load({ hash: '#join' });
    assert.equal(page.el('joinModal').style.display, 'flex');
  });

  it('openJoin() shows the dialog and hides old errors', () => {
    const page = load();
    page.el('joinErr').style.display = 'block';
    page.call('openJoin');
    assert.equal(page.el('joinModal').style.display, 'flex');
    assert.equal(page.el('joinErr').style.display, 'none');
  });

  it('closeJoin() hides the dialog', () => {
    const page = load({ hash: '#join' });
    page.call('closeJoin');
    assert.equal(page.el('joinModal').style.display, 'none');
  });

  it('doJoin() requires both code and team name', () => {
    const page = load();
    page.el('joinCode').value = '';
    page.el('joinName').value = '';
    page.call('doJoin');
    assert.equal(page.el('joinErr').textContent, 'Kode & nama tim wajib');
    assert.equal(page.el('joinErr').style.display, 'block');
  });

  it('doJoin() requires a 6-character code', () => {
    const page = load();
    page.el('joinCode').value = 'ABC12';
    page.el('joinName').value = 'Tim A';
    page.call('doJoin');
    assert.equal(page.el('joinErr').textContent, 'Kode harus 6 huruf');
    assert.equal(page.el('joinErr').style.display, 'block');
  });

  it('doJoin() redirects to game.html with normalised values', () => {
    const page = load();
    page.el('joinCode').value = ' abc123 ';
    page.el('joinName').value = '  Tim A  ';
    page.call('doJoin');
    assert.equal(page.location.href, '/game.html?code=ABC123&team=Tim%20A#join');
  });
});

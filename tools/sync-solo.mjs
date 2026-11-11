#!/usr/bin/env node
// tools/sync-solo.mjs — bangun ulang build solo dari game.html.
//
// game.html adalah satu-satunya sumber kebenaran untuk renderer dan gameplay.
// Bagian yang hanya ada di build VS ditandai di game.html dengan:
//
//   <!-- @vs-only -->  ...  <!-- @/vs-only -->
//
// Skrip ini:
//   1. menyalin game.html -> star_pou_vs.html   (harus identik, dijaga test)
//   2. membuang semua blok @vs-only -> star_pou_sky_climber.html (build solo)
//
// Pakai:
//   node tools/sync-solo.mjs            # tulis kedua file
//   node tools/sync-solo.mjs --check    # hanya cek (tidak menulis)
//
// Setelah mengubah game.html, WAJIB jalankan skrip ini supaya build solo dan
// star_pou_vs.html tidak ketinggalan. Test `tests/site-structure.test.js`
// memeriksa keduanya.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'game.html');
const VS = path.join(ROOT, 'star_pou_vs.html');
const SOLO = path.join(ROOT, 'star_pou_sky_climber.html');

const BEGIN = '<!-- @vs-only -->';
const END = '<!-- @/vs-only -->';
const CORE_IDS = [
  'gameCanvas', 'modal', 'team-input', 'topic-select', 'duration-select',
  'team-display', 'score-val', 'alt-val', 'zone-badge', 'timer-val',
  'q-counter', 'q-emoji', 'q-text',
];
const VS_ONLY_MARKERS = ['vsConnect', 'vsOpenJoin', 'vs-modal', 'vs-leaderboard'];

/** Buang semua blok @vs-only dari HTML game. */
export function stripVsOnly(html) {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = html.indexOf(BEGIN, cursor);
    if (start === -1) {
      out += html.slice(cursor);
      break;
    }
    const end = html.indexOf(END, start + BEGIN.length);
    if (end === -1) throw new Error('penanda @vs-only tidak punya penutup @/vs-only');
    out += html.slice(cursor, start);
    cursor = end + END.length;
  }
  // Rapikan baris kosong berlebih yang tersisa dari blok yang dibuang.
  return out.replace(/[ \t]*\r?\n(?:[ \t]*\r?\n){2,}/g, '\r\n\r\n');
}

/** Validasi build solo: tidak boleh ada sisa mode VS, wajib punya elemen inti. */
export function validateSolo(solo) {
  const problems = [];
  for (const marker of VS_ONLY_MARKERS) {
    if (solo.includes(marker)) problems.push(`build solo masih memuat "${marker}"`);
  }
  if (solo.includes(BEGIN) || solo.includes(END)) problems.push('build solo masih memuat penanda @vs-only');
  for (const id of CORE_IDS) {
    if (!solo.includes(`id="${id}"`)) problems.push(`build solo kehilangan #${id}`);
  }
  if (!/QUESTION_BANK/.test(solo)) problems.push('build solo kehilangan script game');
  return problems;
}

export function buildSolo(gameHtml) {
  return stripVsOnly(gameHtml);
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const game = fs.readFileSync(GAME, 'utf8');
  const solo = buildSolo(game);

  const problems = validateSolo(solo);
  if (problems.length) {
    console.error('GAGAL: ' + problems.join('; '));
    process.exitCode = 1;
    return;
  }

  const blocksRemoved = (game.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log(`game.html        : ${game.length} byte, ${blocksRemoved} blok @vs-only`);
  console.log(`solo (dihasilkan): ${solo.length} byte`);
  console.log(`vs   (salinan)   : ${game.length} byte`);

  if (checkOnly) {
    console.log('cek OK (tidak ada file yang ditulis; jalankan tanpa --check untuk menulis)');
    return;
  }

  fs.writeFileSync(SOLO, solo);
  fs.writeFileSync(VS, game);
  console.log(`ditulis: ${path.basename(SOLO)} dan ${path.basename(VS)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

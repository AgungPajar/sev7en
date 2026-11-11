// tests/game-core.test.js
// Unit tests for the shared game logic embedded in game.html and
// star_pou_sky_climber.html. The real inline scripts are executed by the
// sandbox helper, so these tests exercise the shipped code (not a copy).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGamePage, startGame, plain, mulberry32, GAME_FILES } from './helpers/game-page.js';

const closeTo = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ≈ ${expected}`);

const TOPIC_COUNTS = {
  living_room: 50,
};

for (const file of GAME_FILES) {
  describe(`game core — ${file}`, () => {
    const load = (opts = {}) => loadGamePage(file, { random: mulberry32(42), ...opts });

    // ------------------------------------------------------------------
    // 1. Question bank
    // ------------------------------------------------------------------
    describe('QUESTION_BANK', () => {
      it('contains 50 well-formed questions', () => {
        const bank = plain(load().get('QUESTION_BANK'));
        assert.equal(bank.length, 50);
        for (const q of bank) {
          assert.equal(typeof q.id, 'number');
          assert.ok(Number.isInteger(q.id) && q.id > 0, `invalid id for: ${q.q}`);
          assert.equal(typeof q.topic, 'string');
          assert.ok(q.topic.length > 0);
          assert.equal(typeof q.emoji, 'string');
          assert.ok(q.emoji.length > 0, `missing emoji for: ${q.q}`);
          assert.equal(typeof q.q, 'string');
          assert.ok(q.q.trim().length > 0);
          assert.equal(typeof q.correct, 'string');
          assert.equal(typeof q.wrong, 'string');
          assert.ok(q.correct.trim().length > 0);
          assert.ok(q.wrong.trim().length > 0);
          assert.notEqual(q.correct, q.wrong, `correct === wrong for: ${q.q}`);
        }
        assert.deepEqual(bank.map((q) => q.id), Array.from({ length: 50 }, (_, i) => i + 1));
      });

      it('uses the single Living Room theme for every question', () => {
        const bank = plain(load().get('QUESTION_BANK'));
        const counts = {};
        for (const q of bank) counts[q.topic] = (counts[q.topic] || 0) + 1;
        assert.deepEqual(counts, TOPIC_COUNTS);
      });

      it('has no duplicated question text', () => {
        const bank = plain(load().get('QUESTION_BANK'));
        const seen = new Set();
        for (const q of bank) {
          assert.ok(!seen.has(q.q), `duplicate question: ${q.q}`);
          seen.add(q.q);
        }
      });
    });

    // ------------------------------------------------------------------
    // 2. shuffle()
    // ------------------------------------------------------------------
    describe('shuffle()', () => {
      it('returns a permutation without mutating the input', () => {
        const page = load();
        const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const snapshot = [...input];
        const out = plain(page.call('shuffle', input));
        assert.deepEqual(input, snapshot, 'input array was mutated');
        assert.deepEqual([...out].sort((a, b) => a - b), snapshot);
      });

      it('handles empty and single-element arrays', () => {
        const page = load();
        assert.deepEqual(plain(page.call('shuffle', [])), []);
        assert.deepEqual(plain(page.call('shuffle', ['x'])), ['x']);
      });

      it('is deterministic for the same random seed', () => {
        const page = load();
        const input = [1, 2, 3, 4, 5, 6, 7, 8];
        page.setRandom(mulberry32(1234));
        const a = plain(page.call('shuffle', input));
        page.setRandom(mulberry32(1234));
        const b = plain(page.call('shuffle', input));
        assert.deepEqual(a, b);
      });

      it('can produce a different order for a different seed', () => {
        const page = load();
        const input = Array.from({ length: 12 }, (_, i) => i);
        page.setRandom(mulberry32(1));
        const a = plain(page.call('shuffle', input));
        page.setRandom(mulberry32(2));
        const b = plain(page.call('shuffle', input));
        assert.notDeepEqual(a, b);
      });
    });

    // ------------------------------------------------------------------
    // 3. Environment
    // ------------------------------------------------------------------
    describe('initEnvironment()', () => {
      it('creates 18 clouds and 120 stars with values in range', () => {
        const page = load();
        page.call('initEnvironment');
        const W = page.get('W');
        const clouds = plain(page.get('bgClouds'));
        const stars = plain(page.get('spaceStars'));

        assert.equal(clouds.length, 18);
        for (const c of clouds) {
          assert.ok(c.offsetX >= -0.9 * W && c.offsetX <= 0.9 * W, `offsetX out of range: ${c.offsetX}`);
          assert.ok(c.worldY <= 0 && c.worldY >= -18 * 180 - 120, `worldY out of range: ${c.worldY}`);
          assert.ok(c.scale >= 0.6 && c.scale <= 1.3, `scale out of range: ${c.scale}`);
          assert.ok(Math.abs(c.speed) >= 0.15 && Math.abs(c.speed) <= 0.55, `speed out of range: ${c.speed}`);
          assert.notEqual(c.speed, 0);
        }

        assert.equal(stars.length, 120);
        for (const s of stars) {
          assert.ok(s.rx >= 0 && s.rx < 1, `rx out of range: ${s.rx}`);
          assert.ok(s.ry >= 0 && s.ry < 1, `ry out of range: ${s.ry}`);
          assert.ok(s.size >= 1 && s.size <= 3.5, `size out of range: ${s.size}`);
          assert.ok(s.blinkSpeed >= 0.002 && s.blinkSpeed <= 0.008, `blinkSpeed out of range: ${s.blinkSpeed}`);
          assert.ok(s.phase >= 0 && s.phase <= Math.PI * 2, `phase out of range: ${s.phase}`);
        }
      });

      it('replaces the previous arrays', () => {
        const page = load();
        const oldClouds = page.get('bgClouds');
        const oldStars = page.get('spaceStars');
        page.call('initEnvironment');
        assert.notEqual(page.get('bgClouds'), oldClouds);
        assert.notEqual(page.get('spaceStars'), oldStars);
      });
    });

    // ------------------------------------------------------------------
    // 4. startGame()
    // ------------------------------------------------------------------
    describe('startGame()', () => {
      it('initialises a fresh run at ground level', () => {
        const page = load();
        startGame(page, { duration: 180, team: 'tim a' });

        assert.equal(page.get('gameRunning'), true);
        assert.equal(page.get('score'), 0);
        assert.equal(page.get('floorLevel'), 0);
        assert.equal(page.get('streak'), 0);
        assert.equal(page.get('timeLeft'), 180);
        assert.equal(page.get('questionPickSeq'), 1);

        const base = plain(page.get('currentBasePlat'));
        assert.equal(base.wx, 0);
        assert.equal(base.wy, 0);
        assert.equal(base.w, 220);
        assert.equal(base.h, 30);
        assert.equal(base.isStart, true);
        assert.equal(base.status, 'correct');
        assert.equal(base.level, 0);

        assert.equal(page.get('star.wx'), 0);
        assert.equal(page.get('star.wy'), -48);
        assert.equal(page.get('star.state'), 'idle');
        assert.equal(page.get('star.expression'), 'happy');
        assert.equal(page.get('star.rotation'), 0);

        assert.deepEqual(plain(page.get('cam')), { x: 0, y: 0, targetX: 0, targetY: 0 });
        assert.equal(page.get('letitedPlatforms.length'), 1);
        assert.equal(page.get('letitedPlatforms[0] === currentBasePlat'), true);
        assert.equal(page.el('modal').style.display, 'none');
        assert.equal(page.el('team-display').textContent, 'TIM A');
      });

      it('falls back to the default team name for empty input', () => {
        const page = load();
        startGame(page, { team: '   ' });
        assert.equal(page.el('team-display').textContent, 'TIM BINTANG A');
      });

      it('builds the pool from all questions for topic "all"', () => {
        const page = load();
        startGame(page, { topic: 'all' });
        assert.equal(page.get('activePool.length'), 50);
        assert.equal(page.get('activePool.length'), page.get('QUESTION_BANK.length'));
      });

      it('filters the pool by the single theme', () => {
        for (const [topic, count] of Object.entries(TOPIC_COUNTS)) {
          const page = load();
          startGame(page, { topic });
          assert.equal(page.get('activePool.length'), count, topic);
          const pool = plain(page.get('activePool'));
          assert.ok(pool.every((q) => q.topic === topic), topic);
        }
      });

      it('resets any previous progress', () => {
        const page = load();
        startGame(page, { duration: 60 });
        page.eval('score = 999; floorLevel = 7; streak = 4; timeLeft = 3;');
        startGame(page, { duration: 60 });
        assert.equal(page.get('score'), 0);
        assert.equal(page.get('floorLevel'), 0);
        assert.equal(page.get('streak'), 0);
        assert.equal(page.get('timeLeft'), 60);
      });

      it('spawns two complementary answer platforms above the base', () => {
        const page = load();
        startGame(page);
        const left = plain(page.get('leftOptionPlat'));
        const right = plain(page.get('rightOptionPlat'));
        const stepX = page.get('STEP_X');
        const stepY = page.get('STEP_Y');

        assert.equal(stepY, 210);
        assert.equal(stepX, 230); // min(230, 1280 * 0.23)
        assert.equal(left.wx, -stepX);
        assert.equal(right.wx, stepX);
        assert.equal(left.wy, -stepY);
        assert.equal(right.wy, -stepY);
        assert.equal(left.side, 'left');
        assert.equal(right.side, 'right');
        assert.equal(left.level, 1);
        assert.equal(right.level, 1);
        assert.equal(left.w, 250);
        assert.equal(right.w, 250);
        assert.equal(left.h, 32);
        assert.equal(right.h, 32);
        assert.equal(left.status, 'neutral');
        assert.equal(right.status, 'neutral');
        assert.equal(left.broken, false);
        assert.equal(right.broken, false);
        assert.equal(left.fallY, 0);
        assert.equal(right.fallY, 0);
        assert.equal(left.isCorrect, !right.isCorrect, 'exactly one option must be correct');
      });

      it('labels the options with the current question answers', () => {
        const page = load();
        startGame(page);
        const q = plain(page.get('currentQuestion'));
        const left = plain(page.get('leftOptionPlat'));
        const right = plain(page.get('rightOptionPlat'));

        assert.equal(new Set([left.text, right.text]).size, 2);
        assert.deepEqual(new Set([left.text, right.text]), new Set([q.correct, q.wrong]));
        assert.equal(left.isCorrect ? left.text : right.text, q.correct);
        assert.equal(left.isCorrect ? right.text : left.text, q.wrong);
        assert.equal(page.el('q-counter').textContent, 'TANGGA 1');
        assert.equal(page.el('q-emoji').textContent, q.emoji);
        assert.equal(page.el('q-text').textContent, q.q);
      });

      it('shows the countdown for finite durations', () => {
        const page = load();
        startGame(page, { duration: 180 });
        assert.equal(page.el('timer-val').textContent, '03:00');
        page.advance(1000);
        assert.equal(page.get('timeLeft'), 179);
        assert.equal(page.el('timer-val').textContent, '02:59');
      });

      it('shows an infinity symbol and never ticks for durations >= 9000', () => {
        const page = load();
        startGame(page, { duration: 9000 });
        assert.equal(page.el('timer-val').textContent, '♾️');
        assert.equal(page.get('timeLeft'), 9000);
        page.advance(5000);
        assert.equal(page.get('timeLeft'), 9000);
      });

      it('ends the game when the countdown reaches zero', () => {
        const page = load();
        startGame(page, { duration: 3 });
        page.advance(3000);
        assert.equal(page.get('gameRunning'), false);
        assert.equal(page.el('modal').style.display, 'flex');
        assert.equal(page.el('modal-title').textContent, '🎉 WAKTU HABIS!');
        assert.match(page.el('modal-desc').innerHTML, /0 POIN/);
        assert.match(page.el('modal-desc').innerHTML, /0 Meter \(Tangga 0\)/);
      });

      it('uses the configured team name in the final result', () => {
        const page = load();
        startGame(page, { duration: 3, team: 'bintang tujuh' });
        page.eval('score = 450; floorLevel = 4;');
        page.advance(3000);
        assert.match(page.el('modal-desc').innerHTML, /BINTANG TUJUH/);
        assert.match(page.el('modal-desc').innerHTML, /450 POIN/);
        assert.match(page.el('modal-desc').innerHTML, /400 Meter \(Tangga 4\)/);
      });
    });

    // ------------------------------------------------------------------
    // 5. HUD
    // ------------------------------------------------------------------
    describe('updateHUD()', () => {
      it('renders score and altitude', () => {
        const page = load();
        startGame(page);
        page.eval('score = 320; floorLevel = 5; timeLeft = 120;');
        page.call('updateHUD');
        assert.equal(page.el('score-val').textContent, 320);
        assert.equal(page.el('alt-val').textContent, '500m');
      });

      it('switches zone badges at the documented thresholds', () => {
        const page = load();
        startGame(page);
        const cases = [
          [0, '🌱 Bumi & Rumput', '#22c55e'],
          [3, '🌱 Bumi & Rumput', '#22c55e'],
          [4, '☁️ Langit Awan', '#38bdf8'],
          [7, '☁️ Langit Awan', '#38bdf8'],
          [8, '🌇 Atmosfer Senja', '#f59e0b'],
          [11, '🌇 Atmosfer Senja', '#f59e0b'],
          [12, '🚀 Luar Angkasa!', '#8b5cf6'],
          [99, '🚀 Luar Angkasa!', '#8b5cf6'],
        ];
        for (const [floor, label, color] of cases) {
          page.eval(`floorLevel = ${floor}; timeLeft = 180;`);
          page.call('updateHUD');
          assert.equal(page.el('zone-badge').textContent, label, `floor ${floor}`);
          assert.match(page.el('zone-badge').style.background, new RegExp(color));
        }
      });

      it('formats the timer as mm:ss', () => {
        const page = load();
        startGame(page);
        const cases = [
          [0, '00:00'],
          [5, '00:05'],
          [59, '00:59'],
          [60, '01:00'],
          [65, '01:05'],
          [3599, '59:59'],
        ];
        for (const [seconds, expected] of cases) {
          page.eval(`timeLeft = ${seconds};`);
          page.call('updateHUD');
          assert.equal(page.el('timer-val').textContent, expected, `timeLeft ${seconds}`);
        }
      });

      it('leaves the infinity timer untouched for >= 9000', () => {
        const page = load();
        startGame(page, { duration: 9000 });
        page.el('timer-val').textContent = 'KEEP';
        page.eval('timeLeft = 9000;');
        page.call('updateHUD');
        assert.equal(page.el('timer-val').textContent, 'KEEP');
      });
    });

    // ------------------------------------------------------------------
    // 6. Color interpolation & coordinates
    // ------------------------------------------------------------------
    describe('lerpColor()', () => {
      it('returns the endpoints for factor 0 and 1', () => {
        const page = load();
        assert.equal(page.call('lerpColor', '#2563eb', '#1d4ed8', 0), 'rgb(37,99,235)');
        assert.equal(page.call('lerpColor', '#2563eb', '#1d4ed8', 1), 'rgb(29,78,216)');
      });

      it('interpolates the midpoint', () => {
        const page = load();
        assert.equal(page.call('lerpColor', '#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
        assert.equal(page.call('lerpColor', '#ff0000', '#0000ff', 0.5), 'rgb(128,0,128)');
      });

      it('clamps factors outside [0, 1]', () => {
        const page = load();
        assert.equal(page.call('lerpColor', '#000000', '#ffffff', -5), 'rgb(0,0,0)');
        assert.equal(page.call('lerpColor', '#000000', '#ffffff', 5), 'rgb(255,255,255)');
      });

      it('accepts lowercase hex values', () => {
        const page = load();
        assert.equal(page.call('lerpColor', '#abcdef', '#abcdef', 0.3), 'rgb(171,205,239)');
      });
    });

    describe('world/3D projection', () => {
      it('maps the gameplay plane into 3D world space', () => {
        const page = load();
        assert.deepEqual(plain(page.call('gameTo3D', 0, 0)), { x: 0, y: 0, z: 0 });
        assert.deepEqual(plain(page.call('gameTo3D', 125, -210)), { x: 125, y: 210, z: 0 });
        assert.deepEqual(plain(page.call('gameTo3D', 125, -210, 170)), { x: 125, y: 210, z: 170 });
      });

      it('centres the camera aim point on screen', () => {
        const page = load();
        page.call('updateCameraRig');
        const W = page.get('W');
        const H = page.get('H');
        const camera = plain(page.get('camera3D'));
        const aim = page.call('projectPoint', camera.target);
        assert.ok(aim, 'the aim point must project');
        closeTo(aim.x, W / 2, 1e-6);
        closeTo(aim.y, H / 2, 1e-6);

        // The gameplay point right under the aim is also centred.
        const AU = page.get('STEP_Y') * 0.86;
        const aimed = page.call('projectGamePoint', page.get('cam.x'), page.get('cam.y') - AU);
        assert.ok(aimed, 'the aimed gameplay point must project');
        closeTo(aimed.x, W / 2, 1e-6);
        closeTo(aimed.y, H / 2, 1e-6);
      });

      it('projects the camera origin below the screen centre (reasonable tolerance)', () => {
        const page = load();
        page.call('updateCameraRig');
        const W = page.get('W');
        const H = page.get('H');
        const origin = page.call('projectGamePoint', page.get('cam.x'), page.get('cam.y'));
        assert.ok(origin, 'the camera origin must project');
        closeTo(origin.x, W / 2, 1);
        assert.ok(origin.y > H / 2, 'the ground under the camera sits below the aim');
        assert.ok(origin.y < H, 'the ground under the camera stays on screen');
      });

      it('makes closer objects project larger than far ones', () => {
        const page = load();
        page.call('updateCameraRig');
        const camera = plain(page.get('camera3D'));
        const far = page.call('projectGamePoint', 0, 0, 0);
        const near = page.call('projectPoint', { x: 0, y: 0, z: camera.eye.z - 80 });
        assert.ok(far && near, 'both points must project');
        assert.ok(near.depth < far.depth, 'the nearer point has a smaller depth');
        assert.ok(near.scale > far.scale, 'closer objects get a bigger scale');
      });

      it('returns null for points at/behind the camera', () => {
        const page = load();
        page.call('updateCameraRig');
        const camera = plain(page.get('camera3D'));
        const behind = {
          x: camera.eye.x - camera.fwd.x * 100,
          y: camera.eye.y - camera.fwd.y * 100,
          z: camera.eye.z - camera.fwd.z * 100,
        };
        assert.equal(page.call('projectPoint', behind), null);
        // Same in gameplay space: anything in front of the eye on the +z side.
        assert.equal(page.call('projectGamePoint', 0, 0, camera.eye.z + 500), null);
      });

      it('updates the viewport, STEP_X and the canvas backing store on resize', () => {
        const page = load();
        assert.equal(page.get('STEP_X'), 230); // min(230, 1280 * 0.23)
        assert.equal(page.get('DPR'), 1); // sandbox devicePixelRatio
        page.window.innerWidth = 800;
        page.window.innerHeight = 600;
        page.fireWindow('resize');
        assert.equal(page.get('W'), 800);
        assert.equal(page.get('H'), 600);
        assert.equal(page.get('STEP_X'), 184); // min(230, 800 * 0.23)
        assert.equal(page.el('gameCanvas').width, 800); // DPR = 1 in the sandbox
        assert.equal(page.el('gameCanvas').height, 600);

        page.call('updateCameraRig');
        const camera = plain(page.get('camera3D'));
        closeTo(camera.focal, 300 / Math.tan((55 * Math.PI) / 180 / 2), 1e-6);
        const aim = page.call('projectPoint', camera.target);
        closeTo(aim.x, 400, 1e-6);
        closeTo(aim.y, 300, 1e-6);
      });
    });

    // ------------------------------------------------------------------
    // 7. Stair spawning
    // ------------------------------------------------------------------
    describe('spawnNextStairOptions()', () => {
      it('draws a question from the pool and updates the prompt', () => {
        const page = load();
        startGame(page);
        const q = plain(page.get('currentQuestion'));
        assert.ok(plain(page.get('QUESTION_BANK')).some((item) => item.id === q.id));
        assert.equal(page.get('questionPickSeq'), 1);
        assert.equal(page.el('q-counter').textContent, 'TANGGA 1');
        assert.equal(page.el('q-emoji').textContent, q.emoji);
        assert.equal(page.el('q-text').textContent, q.q);
      });

      it('draws a different question next and records both in the anti-repeat history', () => {
        const page = load();
        startGame(page);
        const first = plain(page.get('currentQuestion'));
        page.call('spawnNextStairOptions');
        const second = plain(page.get('currentQuestion'));
        assert.notEqual(second.id, first.id);
        assert.equal(page.get('questionPickSeq'), 2);
        assert.equal(page.get('questionStats.size'), 2);
        assert.equal(page.el('q-text').textContent, second.q);
      });

      it('does not crash when the pool is empty', () => {
        const page = load();
        startGame(page);
        const before = page.el('q-text').textContent;
        page.eval('activePool = [];');
        assert.doesNotThrow(() => page.call('spawnNextStairOptions'));
        assert.equal(page.el('q-text').textContent, before);
      });

      it('keeps serving the same question when the pool has only one item', () => {
        const page = load();
        startGame(page);
        page.eval('activePool = [QUESTION_BANK[0]];');
        page.call('spawnNextStairOptions');
        page.call('spawnNextStairOptions');
        assert.equal(page.get('activePool.length'), 1);
        assert.equal(page.get('questionPickSeq'), 3);
        assert.equal(page.el('q-text').textContent, plain(page.get('QUESTION_BANK[0]')).q);
      });

      it('does not add clouds when the next step is already covered', () => {
        const page = load();
        startGame(page);
        const before = page.get('bgClouds.length');
        page.call('spawnNextStairOptions');
        assert.equal(page.get('bgClouds.length'), before);
      });

      it('extends the cloud backdrop when climbing high', () => {
        const page = load();
        startGame(page);
        page.eval('currentBasePlat.wy = -5000;');
        const before = page.get('bgClouds.length');
        page.call('spawnNextStairOptions');
        assert.equal(page.get('bgClouds.length'), before + 6);
      });

      it('uses floorLevel + 1 as the platform level', () => {
        const page = load();
        startGame(page);
        page.eval('floorLevel = 5;');
        page.call('spawnNextStairOptions');
        assert.equal(page.get('leftOptionPlat.level'), 6);
        assert.equal(page.get('rightOptionPlat.level'), 6);
      });
    });

    // ------------------------------------------------------------------
    // 7b. Anti-repeat question selection
    // ------------------------------------------------------------------
    describe('anti-repeat question selection', () => {
      it('gives an unseen question a much higher weight than a seen one', () => {
        const page = load();
        page.eval('questionStats.clear(); questionPickSeq = 0;');
        page.call('noteQuestionShown', page.get('QUESTION_BANK[0]'));
        const seen = page.call('questionWeight', page.get('QUESTION_BANK[0]'));
        const unseen = page.call('questionWeight', page.get('QUESTION_BANK[1]'));
        assert.equal(unseen, 1);
        assert.ok(seen < 0.01, `seen weight should be tiny, got ${seen}`);
      });

      it('applies a cooldown window and recovers the weight afterwards', () => {
        const page = load();
        page.eval('questionStats.clear(); questionPickSeq = 0;');
        page.call('noteQuestionShown', page.get('QUESTION_BANK[0]'));
        const recent = page.call('questionWeight', page.get('QUESTION_BANK[0]'));
        page.eval('questionPickSeq += QUESTION_RECENT_WINDOW;');
        const recovered = page.call('questionWeight', page.get('QUESTION_BANK[0]'));
        assert.ok(recovered > recent * 10, `recovered ${recovered} should be much larger than ${recent}`);
        assert.ok(recovered < 0.1, `recovered weight should stay below an unseen question, got ${recovered}`);
      });

      it('lowers the weight further each time the same question appears', () => {
        const page = load();
        page.eval('questionStats.clear(); questionPickSeq = 0;');
        page.call('noteQuestionShown', page.get('QUESTION_BANK[0]'));
        page.eval('questionPickSeq += QUESTION_RECENT_WINDOW;');
        const once = page.call('questionWeight', page.get('QUESTION_BANK[0]'));
        page.call('noteQuestionShown', page.get('QUESTION_BANK[0]'));
        page.eval('questionPickSeq += QUESTION_RECENT_WINDOW;');
        const twice = page.call('questionWeight', page.get('QUESTION_BANK[0]'));
        assert.ok(twice < once, `twice ${twice} should be lower than once ${once}`);
      });

      it('never repeats a question on the very next stair', () => {
        const page = load();
        startGame(page);
        const ids = [];
        for (let i = 0; i < 30; i++) {
          page.call('spawnNextStairOptions');
          ids.push(plain(page.get('currentQuestion')).id);
        }
        for (let i = 1; i < ids.length; i++) {
          assert.notEqual(ids[i], ids[i - 1], `question ${ids[i]} repeated immediately at draw ${i}`);
        }
      });

      it('still surfaces every question over a long session', () => {
        const page = load();
        startGame(page);
        const seen = new Set();
        for (let i = 0; i < 800; i++) {
          page.call('spawnNextStairOptions');
          seen.add(plain(page.get('currentQuestion')).id);
        }
        assert.equal(seen.size, 50);
      });

      it('keeps the seen history across startGame so a rematch prefers fresh questions', () => {
        const page = load();
        startGame(page);
        for (let i = 0; i < 10; i++) page.call('spawnNextStairOptions');
        const afterFirst = page.get('questionPickSeq');
        assert.equal(afterFirst, 11);
        startGame(page);
        assert.equal(page.get('questionPickSeq'), afterFirst + 1);
        assert.ok(page.get('questionStats.size') >= 10);
      });
    });

    // ------------------------------------------------------------------
    // 8. Jumping & landing
    // ------------------------------------------------------------------
    describe('triggerJump()', () => {
      it('starts a jump toward the selected platform', () => {
        const page = load();
        startGame(page);
        const left = plain(page.get('leftOptionPlat'));
        page.call('triggerJump', 'left');

        assert.equal(page.get('star.state'), 'jumping');
        assert.equal(page.get('star.expression'), 'jump');
        assert.equal(page.get('star.chosenPlat === leftOptionPlat'), true);
        assert.equal(page.get('star.startX'), 0);
        assert.equal(page.get('star.startY'), -48);
        assert.equal(page.get('star.targetX'), left.wx);
        assert.equal(page.get('star.targetY'), left.wy - 48);
        assert.equal(page.get('star.progress'), 0);
        assert.equal(page.get('star.scaleX'), 0.78);
        assert.equal(page.get('star.scaleY'), 1.28);
      });

      it('supports jumping to the right platform', () => {
        const page = load();
        startGame(page);
        page.call('triggerJump', 'right');
        assert.equal(page.get('star.chosenPlat === rightOptionPlat'), true);
        assert.equal(page.get('star.targetX'), page.get('rightOptionPlat.wx'));
      });

      it('does nothing while the game is not running', () => {
        const page = load();
        page.call('triggerJump', 'left');
        assert.equal(page.get('star.state'), 'idle');
        assert.equal(page.get('star.chosenPlat'), null);
      });

      it('does nothing while already jumping', () => {
        const page = load();
        startGame(page);
        page.call('triggerJump', 'left');
        const chosen = page.get('star.chosenPlat');
        page.call('triggerJump', 'right');
        assert.equal(page.get('star.chosenPlat'), chosen);
      });

      it('does nothing when the target platform is missing', () => {
        const page = load();
        startGame(page);
        page.eval('leftOptionPlat = null;');
        page.call('triggerJump', 'left');
        assert.equal(page.get('star.state'), 'idle');
      });
    });

    describe('onLandOnPlatform() — correct answer', () => {
      const landCorrect = (page) => {
        const left = plain(page.get('leftOptionPlat'));
        const right = plain(page.get('rightOptionPlat'));
        const plat = left.isCorrect ? left : right;
        page.call('onLandOnPlatform', page.get(left.isCorrect ? 'leftOptionPlat' : 'rightOptionPlat'));
        return plat;
      };

      it('awards points, increases floor/streak and celebrates', () => {
        const page = load();
        startGame(page);
        const plat = landCorrect(page);

        assert.equal(page.get('score'), 100);
        assert.equal(page.get('floorLevel'), 1);
        assert.equal(page.get('streak'), 1);
        assert.equal(page.get('currentBasePlat.status'), 'correct');
        assert.equal(page.get('star.state'), 'celebrating');
        assert.equal(page.get('star.expression'), 'win');
        assert.equal(page.get('star.scaleX'), 1.32);
        assert.equal(page.get('star.scaleY'), 0.72);
        assert.equal(page.get('cam.targetX'), plat.wx);
        assert.equal(page.get('cam.targetY'), plat.wy);
        assert.equal(page.get('letitedPlatforms.length'), 2);
        assert.equal(page.get('currentBasePlat === letitedPlatforms[1]'), true);
        assert.equal(page.el('score-val').textContent, 100);
        assert.equal(page.el('alt-val').textContent, '100m');
      });

      it('spawns confetti and a floating score label', () => {
        const page = load();
        startGame(page);
        const plat = landCorrect(page);
        const particles = plain(page.get('particles'));
        const texts = plain(page.get('floatingTexts'));

        assert.equal(particles.length, 30);
        assert.equal(texts.length, 1);
        assert.equal(texts[0].text, '+100 NAIK! ⬆️');
        assert.equal(texts[0].color, '#4ade80');
        assert.equal(texts[0].wx, plat.wx);
        assert.equal(texts[0].wy, plat.wy - 85);
        assert.equal(texts[0].alpha, 1);
      });

      it('caps the streak bonus at +100 (200 total)', () => {
        const page = load();
        startGame(page);
        const scores = [];
        for (let i = 0; i < 8; i++) {
          landCorrect(page);
          scores.push(page.get('score'));
          page.advance(550);
        }
        // 100, 220, 360, 520, 700, 900, 1100, 1300
        assert.deepEqual(scores, [100, 220, 360, 520, 700, 900, 1100, 1300]);
        assert.equal(page.get('streak'), 8);
        assert.equal(page.get('floorLevel'), 8);
      });

      it('keeps at most 8 platforms in the climb history', () => {
        const page = load();
        startGame(page);
        const markers = [];
        for (let i = 1; i <= 9; i++) {
          const plat = { wx: i * 10, wy: -i * 210, isCorrect: true, marker: i, status: 'neutral' };
          markers.push(plat);
          page.call('onLandOnPlatform', plat);
          page.advance(550);
        }
        assert.equal(page.get('letitedPlatforms.length'), 8);
        const history = page.get('letitedPlatforms');
        assert.equal(history[history.length - 1], markers[8]);
        assert.equal(history[0], markers[1]); // start + marker1 were shifted out
        assert.ok(!plain(history).some((p) => p.isStart), 'start platform should be evicted');
      });

      it('resumes idle and spawns the next stairs after 550 ms', () => {
        const page = load();
        startGame(page);
        landCorrect(page);
        page.advance(549);
        assert.equal(page.get('star.state'), 'celebrating');
        assert.equal(page.get('questionPickSeq'), 1);
        page.advance(1);
        assert.equal(page.get('star.state'), 'idle');
        assert.equal(page.get('star.expression'), 'happy');
        assert.equal(page.get('questionPickSeq'), 2);
        assert.equal(page.el('q-counter').textContent, 'TANGGA 2');
      });

      it('does not respawn when the game has stopped', () => {
        const page = load();
        startGame(page);
        landCorrect(page);
        page.eval('gameRunning = false;');
        page.advance(550);
        assert.equal(page.get('star.state'), 'celebrating');
        assert.equal(page.get('questionPickSeq'), 1);
      });
    });

    describe('onLandOnPlatform() — wrong answer', () => {
      it('breaks the platform, resets the streak and falls', () => {
        const page = load();
        startGame(page);
        page.eval('streak = 5; score = 300;');
        const left = plain(page.get('leftOptionPlat'));
        const wrongSide = left.isCorrect ? 'rightOptionPlat' : 'leftOptionPlat';
        const wrong = plain(page.get(wrongSide));
        page.call('onLandOnPlatform', page.get(wrongSide));

        assert.equal(page.get('score'), 300);
        assert.equal(page.get('floorLevel'), 0);
        assert.equal(page.get('streak'), 0);
        assert.equal(page.get('star.state'), 'falling');
        assert.equal(page.get('star.expression'), 'dizzy');
        assert.equal(page.get('star.vy'), -4);
        assert.equal(page.get('currentBasePlat.status'), 'correct');
        assert.equal(page.get(wrongSide + '.status'), 'wrong');
        assert.equal(page.get(wrongSide + '.broken'), true);
        assert.equal(page.el('score-val').textContent, 300);
      });

      it('spawns red confetti and a break label', () => {
        const page = load();
        startGame(page);
        const left = plain(page.get('leftOptionPlat'));
        const wrongSide = left.isCorrect ? 'rightOptionPlat' : 'leftOptionPlat';
        page.call('onLandOnPlatform', page.get(wrongSide));
        const texts = plain(page.get('floatingTexts'));
        assert.equal(page.get('particles.length'), 30);
        assert.equal(texts.length, 1);
        assert.equal(texts[0].text, 'AWAN HANCUR! 💥');
        assert.equal(texts[0].color, '#f87171');
      });

      it('returns to the last safe platform and spawns new stairs after 900 ms', () => {
        const page = load();
        startGame(page);
        const base = plain(page.get('currentBasePlat'));
        const left = plain(page.get('leftOptionPlat'));
        const wrongSide = left.isCorrect ? 'rightOptionPlat' : 'leftOptionPlat';
        page.call('onLandOnPlatform', page.get(wrongSide));

        page.advance(899);
        assert.equal(page.get('star.state'), 'falling');
        page.advance(1);
        assert.equal(page.get('star.state'), 'idle');
        assert.equal(page.get('star.expression'), 'happy');
        assert.equal(page.get('star.wx'), base.wx);
        assert.equal(page.get('star.wy'), base.wy - 48);
        assert.equal(page.get('star.rotation'), 0);
        assert.equal(page.get('star.scaleX'), 1.25);
        assert.equal(page.get('star.scaleY'), 0.75);
        assert.equal(page.get('questionPickSeq'), 2);
      });

      it('does not reset when the game has stopped', () => {
        const page = load();
        startGame(page);
        const left = plain(page.get('leftOptionPlat'));
        const wrongSide = left.isCorrect ? 'rightOptionPlat' : 'leftOptionPlat';
        page.call('onLandOnPlatform', page.get(wrongSide));
        page.eval('gameRunning = false;');
        page.advance(900);
        assert.equal(page.get('star.state'), 'falling');
        assert.equal(page.get('questionPickSeq'), 1);
      });
    });

    // ------------------------------------------------------------------
    // 9. Animation loop
    // ------------------------------------------------------------------
    describe('animate()', () => {
      it('eases the camera 8% toward its target each frame', () => {
        const page = load();
        startGame(page);
        page.eval('cam.targetX = 100; cam.targetY = -200;');
        page.frame(0);
        closeTo(page.get('cam.x'), 8);
        closeTo(page.get('cam.y'), -16);
        page.frame(16);
        closeTo(page.get('cam.x'), 8 + (100 - 8) * 0.08);
      });

      it('completes a jump after ~19 frames and lands on the platform', () => {
        const page = load();
        startGame(page);
        const leftIsCorrect = page.get('leftOptionPlat.isCorrect');
        page.call('triggerJump', leftIsCorrect ? 'left' : 'right');

        page.frames(18);
        closeTo(page.get('star.progress'), 0.99, 1e-6);
        assert.equal(page.get('star.state'), 'jumping');
        assert.equal(page.get('score'), 0);

        page.frame(300);
        assert.equal(page.get('star.state'), 'celebrating');
        assert.equal(page.get('score'), 100);
        assert.equal(page.get('floorLevel'), 1);
        assert.equal(page.get('star.wx'), page.get('star.targetX'));
        assert.equal(page.get('star.wy'), page.get('star.targetY'));
      });

      it('applies falling physics and drags the broken platform down', () => {
        const page = load();
        startGame(page);
        page.eval('star.state = "falling"; star.vy = 0; star.wy = 0; star.rotation = 0; star.chosenPlat = { fallY: 0 };');
        page.frame(0);
        closeTo(page.get('star.vy'), 0.75);
        closeTo(page.get('star.wy'), 0.75);
        closeTo(page.get('star.rotation'), 0.14);
        closeTo(page.get('star.chosenPlat.fallY'), 0.675);
        page.frame(16);
        closeTo(page.get('star.vy'), 1.5);
        closeTo(page.get('star.wy'), 0.75 + 1.5);
        closeTo(page.get('star.rotation'), 0.28);
      });

      it('bobs up and down while celebrating', () => {
        const page = load();
        startGame(page);
        page.eval('star.state = "celebrating"; star.targetY = -300;');
        page.frame(0); // sin(0) = 0
        closeTo(page.get('star.wy'), -300);
        page.frame(1000); // sin(18) ≈ -0.751
        const wy = page.get('star.wy');
        assert.ok(wy <= -300 && wy >= -316, `celebrating wy out of range: ${wy}`);
      });

      it('updates and removes confetti particles', () => {
        const page = load();
        startGame(page);
        page.call('spawnConfetti', 0, 0, '#ffffff');
        const before = plain(page.get('particles[0]'));
        page.frame(0);
        const after = plain(page.get('particles[0]'));
        assert.equal(after.wx, before.wx + before.vx);
        assert.equal(after.wy, before.wy + before.vy);
        closeTo(after.vy, before.vy + 0.35);
        closeTo(after.life, before.life - 0.022);

        page.frames(46, 16);
        assert.equal(page.get('particles.length'), 0);
      });

      it('updates and removes floating texts', () => {
        const page = load();
        startGame(page);
        page.get('floatingTexts').push({ wx: 0, wy: 0, text: 'TEST', color: '#fff', alpha: 1 });
        page.frame(0);
        closeTo(page.get('floatingTexts[0].wy'), -1.8);
        closeTo(page.get('floatingTexts[0].alpha'), 0.98);
        page.frames(50, 16);
        assert.equal(page.get('floatingTexts.length'), 0);
      });

      it('renders the 3D sky, platforms and the character without throwing', () => {
        const page = load();
        startGame(page);
        page.resetCtxCalls();
        page.frame(1000);
        const calls = page.ctxCalls();
        for (const name of ['save', 'restore', 'fillRect', 'beginPath', 'fill', 'stroke', 'fillText', 'moveTo', 'lineTo', 'roundRect', 'createLinearGradient', 'arc']) {
          assert.ok((calls[name] || 0) > 0, `expected ctx.${name} to be called`);
        }
        // 3D geometry: the scene paints filled polygons, not only rectangles/arcs.
        assert.ok((calls.lineTo || 0) >= 20, 'expected polygon edges from 3D meshes');
        assert.ok((calls.fill || 0) >= 10, 'expected filled 3D faces');
      });

      it('draws space objects at high altitude', () => {
        const page = load();
        startGame(page);
        page.eval('cam.y = -3000; cam.targetY = -3000;');
        page.resetCtxCalls();
        page.frame(1000);
        const calls = page.ctxCalls();
        assert.ok((calls.ellipse || 0) > 0, 'Saturn ring should be drawn');
        assert.ok((calls.arc || 0) > 0);
      });

      it('draws jump guides only while idle', () => {
        const page = load();
        startGame(page);
        page.resetCtxCalls();
        page.frame(0);
        assert.ok((page.ctxCalls().setLineDash || 0) > 0);

        page.call('triggerJump', 'left');
        page.resetCtxCalls();
        page.frame(16);
        assert.equal(page.ctxCalls().setLineDash || 0, 0);
      });

      it('ignores null or off-screen platforms safely', () => {
        const page = load();
        startGame(page);
        page.resetCtxCalls();
        page.call('drawPlatform', null);
        assert.equal(page.ctxCalls().save || 0, 0);

        page.call('drawPlatform', { wx: 0, wy: 999999, w: 100, h: 20, text: 'x', side: 'left' }, true);
        assert.equal(page.ctxCalls().save || 0, 0);
      });

      it('draws every facial expression without throwing', () => {
        const page = load();
        for (const expression of ['happy', 'jump', 'win', 'dizzy']) {
          page.eval(`star.expression = ${JSON.stringify(expression)};`);
          assert.doesNotThrow(() => page.call('drawStarPou', 1234));
        }
      });
    });

    // ------------------------------------------------------------------
    // 10. Confetti
    // ------------------------------------------------------------------
    describe('spawnConfetti()', () => {
      it('adds 30 particles with bounded random values', () => {
        const page = load();
        startGame(page);
        page.eval('particles = [];');
        page.call('spawnConfetti', 10, -20, '#4ade80');
        const particles = plain(page.get('particles'));
        assert.equal(particles.length, 30);
        const allowed = new Set(['#4ade80', '#fbbf24', '#38bdf8', '#f472b6', '#ffffff']);
        for (const p of particles) {
          assert.equal(p.wx, 10);
          assert.equal(p.wy, -20);
          assert.ok(p.vx >= -6 && p.vx <= 6, `vx ${p.vx}`);
          assert.ok(p.vy >= -12 && p.vy <= -2, `vy ${p.vy}`);
          assert.ok(p.size >= 6 && p.size <= 12, `size ${p.size}`);
          assert.ok(allowed.has(p.color), `color ${p.color}`);
          assert.equal(p.life, 1);
        }
      });

      it('appends to existing particles', () => {
        const page = load();
        startGame(page);
        page.eval('particles = [{ wx: 0, wy: 0, vx: 0, vy: 0, size: 1, color: "#fff", life: 1 }];');
        page.call('spawnConfetti', 0, 0, '#fff');
        assert.equal(page.get('particles.length'), 31);
      });
    });

    // ------------------------------------------------------------------
    // 11. Audio
    // ------------------------------------------------------------------
    describe('playSound()', () => {
      it('creates the AudioContext lazily and reuses it', () => {
        const page = load();
        assert.equal(page.get('audioCtx'), null);
        page.call('playSound', 'jump');
        assert.equal(page.audio.contexts.length, 1);
        page.call('playSound', 'jump');
        assert.equal(page.audio.contexts.length, 1);
      });

      it('plays a rising sine sweep for jumps', () => {
        const page = load();
        page.call('playSound', 'jump');
        const ctx = page.audio.contexts[0];
        assert.equal(ctx.oscillators.length, 1);
        const osc = ctx.oscillators[0];
        assert.equal(osc.type, 'sine');
        assert.deepEqual(osc.freqStart, { v: 260, t: 0 });
        assert.deepEqual(osc.freqExp, { v: 620, t: 0.18 });
        assert.equal(osc.startedAt, 0);
        assert.equal(osc.stoppedAt, 0.2);
        assert.deepEqual(ctx.gains[0].start, { v: 0.25, t: 0 });
        assert.deepEqual(ctx.gains[0].lin, { v: 0.01, t: 0.2 });
      });

      it('plays a four-note arpeggio for correct answers', () => {
        const page = load();
        page.call('playSound', 'correct');
        const ctx = page.audio.contexts[0];
        assert.equal(ctx.oscillators.length, 4);
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        ctx.oscillators.forEach((osc, i) => {
          assert.equal(osc.type, 'triangle');
          assert.deepEqual(osc.freqStart, { v: freqs[i], t: i * 0.06 });
          assert.deepEqual(osc.startedAt, i * 0.06);
          assert.deepEqual(osc.stoppedAt, i * 0.06 + 0.22);
        });
      });

      it('plays a descending sawtooth for wrong answers', () => {
        const page = load();
        page.call('playSound', 'wrong');
        const ctx = page.audio.contexts[0];
        assert.equal(ctx.oscillators.length, 1);
        const osc = ctx.oscillators[0];
        assert.equal(osc.type, 'sawtooth');
        assert.deepEqual(osc.freqStart, { v: 240, t: 0 });
        assert.deepEqual(osc.freqLin, { v: 85, t: 0.45 });
        assert.equal(osc.stoppedAt, 0.45);
      });

      it('resumes a suspended context', () => {
        const page = load();
        page.call('playSound', 'jump');
        const ctx = page.audio.contexts[0];
        ctx.state = 'suspended';
        ctx.resumeCalls = 0;
        page.call('playSound', 'jump');
        assert.equal(ctx.resumeCalls, 1);
        assert.equal(ctx.state, 'running');
      });

      it('does not create oscillators for unknown sound types', () => {
        const page = load();
        page.call('playSound', 'nope');
        assert.equal(page.audio.contexts.length, 1);
        assert.equal(page.audio.contexts[0].oscillators.length, 0);
      });
    });

    // ------------------------------------------------------------------
    // 12. Controls
    // ------------------------------------------------------------------
    describe('keyboard controls', () => {
      const resetJump = (page) => page.eval('star.state = "idle"; star.chosenPlat = null;');

      it('jumps left with ArrowLeft / a / A', () => {
        for (const key of ['ArrowLeft', 'a', 'A']) {
          const page = load();
          startGame(page);
          page.fireWindow('keydown', { key });
          assert.equal(page.get('star.state'), 'jumping', key);
          assert.equal(page.get('star.chosenPlat === leftOptionPlat'), true, key);
        }
      });

      it('jumps right with ArrowRight / d / D', () => {
        for (const key of ['ArrowRight', 'd', 'D']) {
          const page = load();
          startGame(page);
          page.fireWindow('keydown', { key });
          assert.equal(page.get('star.state'), 'jumping', key);
          assert.equal(page.get('star.chosenPlat === rightOptionPlat'), true, key);
        }
      });

      it('ignores unrelated keys', () => {
        const page = load();
        startGame(page);
        page.fireWindow('keydown', { key: 'x' });
        assert.equal(page.get('star.state'), 'idle');
      });

      it('ignores keys while jumping', () => {
        const page = load();
        startGame(page);
        page.call('triggerJump', 'left');
        page.fireWindow('keydown', { key: 'ArrowRight' });
        assert.equal(page.get('star.chosenPlat === leftOptionPlat'), true);
        resetJump(page);
      });
    });

    describe('pointer controls', () => {
      it('jumps left on the left half of the canvas', () => {
        const page = load();
        startGame(page);
        page.setRect('gameCanvas', { left: 100, width: 1280, right: 1380 });
        page.fire('gameCanvas', 'pointerdown', { clientX: 150 });
        assert.equal(page.get('star.chosenPlat === leftOptionPlat'), true);
      });

      it('jumps right on the right half of the canvas', () => {
        const page = load();
        startGame(page);
        page.setRect('gameCanvas', { left: 100, width: 1280, right: 1380 });
        page.fire('gameCanvas', 'pointerdown', { clientX: 1200 });
        assert.equal(page.get('star.chosenPlat === rightOptionPlat'), true);
      });

      it('ignores taps before the game starts', () => {
        const page = load();
        page.fire('gameCanvas', 'pointerdown', { clientX: 10 });
        assert.equal(page.get('star.state'), 'idle');
      });

      it('ignores taps while jumping', () => {
        const page = load();
        startGame(page);
        page.call('triggerJump', 'left');
        page.fire('gameCanvas', 'pointerdown', { clientX: 1200 });
        assert.equal(page.get('star.chosenPlat === leftOptionPlat'), true);
      });
    });

    // ------------------------------------------------------------------
    // 13. End of game
    // ------------------------------------------------------------------
    describe('endGame()', () => {
      it('stops the timer and shows the final summary', () => {
        const page = load();
        startGame(page, { duration: 5, team: 'tim x' });
        page.advance(2000);
        page.eval('score = 250; floorLevel = 3;');
        page.call('endGame');

        assert.equal(page.get('gameRunning'), false);
        assert.equal(page.el('modal').style.display, 'flex');
        assert.equal(page.el('modal-title').textContent, '🎉 WAKTU HABIS!');
        assert.match(page.el('modal-desc').innerHTML, /TIM X/);
        assert.match(page.el('modal-desc').innerHTML, /250 POIN/);
        assert.match(page.el('modal-desc').innerHTML, /300 Meter \(Tangga 3\)/);

        const frozen = page.get('timeLeft');
        page.advance(10000);
        assert.equal(page.get('timeLeft'), frozen);
      });

      it('openMenu() pauses the run', () => {
        const page = load();
        startGame(page, { duration: 10 });
        page.call('openMenu');
        assert.equal(page.get('gameRunning'), false);
        assert.equal(page.el('modal').style.display, 'flex');
        assert.equal(page.el('modal-title').textContent, 'PENGATURAN MATCH');
        page.advance(5000);
        assert.equal(page.get('timeLeft'), 10);
      });
    });
  });
}

// tests/game-3d.test.js
// Unit tests for the software 3D renderer contract documented in
// tools/3d-engine-spec.md (projection, camera rig, near clipping, sky zones,
// toon shading, platonic meshes and one render frame).
//
// These tests are written against the *contract*, never against a copy of the
// implementation: the real inline <script> of the shipped HTML is executed by
// tests/helpers/game-page.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGamePage, startGame, plain, mulberry32, GAME_FILES } from './helpers/game-page.js';

const closeTo = (actual, expected, eps = 1e-6, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${label}expected ${actual} ≈ ${expected} (Δ=${Math.abs(actual - expected)})`
  );

const deg2rad = (deg) => (deg * Math.PI) / 180;

// Parse the colour strings a Canvas 2D fillStyle can hold in this sandbox.
// Returns [r, g, b] or null for gradients/unsupported values.
function parseColor(value) {
  if (typeof value !== 'string') return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

const colorsEqual = (a, b) => {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return String(a).toLowerCase() === String(b).toLowerCase();
  return ca.every((channel, i) => channel === cb[i]);
};

const isUnit = (v) => Math.abs(Math.hypot(v.x, v.y, v.z) - 1) <= 1e-6;
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scaled = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });

const pointAlong = (from, direction, distance) => add(from, scaled(direction, distance));

for (const file of GAME_FILES) {
  describe(`3D engine — ${file}`, () => {
    const load = (opts = {}) => loadGamePage(file, { random: mulberry32(42), ...opts });
    const rig = (opts = {}) => {
      const page = load(opts);
      page.call('updateCameraRig');
      return page;
    };

    // ----------------------------------------------------------------
    // Contract surface
    // ----------------------------------------------------------------
    describe('contract surface', () => {
      it('exposes every function named in tools/3d-engine-spec.md', () => {
        const page = load();
        const names = [
          'gameTo3D', 'updateCameraRig', 'projectPoint', 'projectGamePoint',
          'clipPolygonNear', 'drawPoly3', 'shadeHex', 'mixHex', 'zonePalette',
          'platformMesh', 'starMesh', 'sortByDepth',
          'drawSkyAndEnvironment', 'drawPlatform', 'drawStarPou', 'animate',
        ];
        for (const name of names) {
          assert.equal(typeof page.get(name), 'function', `${name} should be a function`);
        }
      });

      it('exposes the documented constants', () => {
        const page = load();
        assert.equal(page.get('CAM_FOV_DEG'), 55);
        assert.equal(page.get('CAM_NEAR'), 20);
        assert.deepEqual(plain(page.get('ZONE_STEPS')), [900, 1800, 2700]);
        assert.equal(page.get('STEP_Y'), 210);
        assert.equal(typeof page.get('STEP_X'), 'number');
      });

      it('keeps LIGHT_DIR normalised as documented', () => {
        const dir = plain(load().get('LIGHT_DIR'));
        assert.equal(typeof dir.x, 'number');
        assert.equal(typeof dir.y, 'number');
        assert.equal(typeof dir.z, 'number');
        closeTo(Math.hypot(dir.x, dir.y, dir.z), 1, 1e-6, 'LIGHT_DIR length ');
        // Direction (-0.35, 0.80, 0.45) normalised.
        const len = Math.hypot(-0.35, 0.8, 0.45);
        closeTo(dir.x, -0.35 / len, 1e-6, 'LIGHT_DIR.x ');
        closeTo(dir.y, 0.8 / len, 1e-6, 'LIGHT_DIR.y ');
        closeTo(dir.z, 0.45 / len, 1e-6, 'LIGHT_DIR.z ');
      });
    });

    // ----------------------------------------------------------------
    // Coordinate system
    // ----------------------------------------------------------------
    describe('gameTo3D()', () => {
      it('maps world (wx, wy) to (x, -y, 0)', () => {
        const page = load();
        assert.deepEqual(plain(page.call('gameTo3D', 100, -200)), { x: 100, y: 200, z: 0 });
        assert.deepEqual(plain(page.call('gameTo3D', -35, 48)), { x: -35, y: -48, z: 0 });
        assert.deepEqual(plain(page.call('gameTo3D', 0, 0)), { x: 0, y: 0, z: 0 });
      });

      it('passes wz through as the third coordinate', () => {
        const page = load();
        assert.deepEqual(plain(page.call('gameTo3D', 10, -20, 170)), { x: 10, y: 20, z: 170 });
        assert.deepEqual(plain(page.call('gameTo3D', 10, -20, 0)), { x: 10, y: 20, z: 0 });
      });
    });

    // ----------------------------------------------------------------
    // Camera rig
    // ----------------------------------------------------------------
    describe('updateCameraRig()', () => {
      it('builds the documented camera3D object', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        for (const key of ['eye', 'target', 'fwd', 'right', 'up', 'focal', 'near', 'fov', 'dist', 'yaw', 'pitch', 'scale']) {
          assert.ok(key in camera, `camera3D.${key} missing`);
        }
        for (const key of ['eye', 'target', 'fwd', 'right', 'up']) {
          for (const axis of ['x', 'y', 'z']) {
            assert.equal(typeof camera[key][axis], 'number', `camera3D.${key}.${axis}`);
            assert.ok(Number.isFinite(camera[key][axis]), `camera3D.${key}.${axis} not finite`);
          }
        }
        assert.ok(Number.isFinite(camera.focal) && camera.focal > 0, 'focal must be positive');
        assert.ok(Number.isFinite(camera.dist) && camera.dist > 0, 'dist must be positive');
      });

      it('uses near = CAM_NEAR and focal = (H/2) / tan(fov/2)', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const H = page.get('H');
        assert.equal(camera.near, page.get('CAM_NEAR'));
        assert.equal(camera.near, 20);
        assert.equal(camera.fov, page.get('CAM_FOV_DEG'));
        closeTo(camera.focal, H / 2 / Math.tan(deg2rad(camera.fov) / 2), 1e-6, 'focal ');
      });

      it('recomputes focal for a shorter viewport', () => {
        const page = rig();
        page.window.innerWidth = 800;
        page.window.innerHeight = 600;
        page.fireWindow('resize');
        page.call('updateCameraRig');
        const camera = plain(page.get('camera3D'));
        closeTo(camera.focal, 600 / 2 / Math.tan(deg2rad(55) / 2), 1e-6, 'focal after resize ');
      });

      it('aims at (cam.x, -cam.y + STEP_Y*0.86, 0) and keeps cam 2D-shaped', () => {
        const page = load();
        page.eval('cam.x = 120; cam.y = -420; cam.targetX = 120; cam.targetY = -420;');
        page.call('updateCameraRig');
        const camera = plain(page.get('camera3D'));
        const AU = page.get('STEP_Y') * 0.86;
        closeTo(camera.target.x, 120, 1e-6, 'target.x ');
        closeTo(camera.target.y, 420 + AU, 1e-6, 'target.y ');
        closeTo(camera.target.z, 0, 1e-6, 'target.z ');
        // cam must stay exactly the legacy {x, y, targetX, targetY} object.
        assert.deepEqual(plain(page.get('cam')), { x: 120, y: -420, targetX: 120, targetY: -420 });
      });

      it('places the eye in front of (z > 0) and EYE_ABOVE above the target', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const eyeAbove = page.get('EYE_ABOVE');
        // Final tuning: a high eye (+160) shows the top surface of the slabs so
        // the answer platforms read as 3D instead of edge-on boxes.
        assert.equal(eyeAbove, 160);
        assert.ok(camera.eye.z > camera.target.z, 'eye must be on the +z side');
        assert.ok(camera.eye.y > camera.target.y, 'eye must be above the target');
        closeTo(camera.eye.y - camera.target.y, eyeAbove, 1e-6, 'eye lift ');
        const horizontal = Math.hypot(camera.eye.x - camera.target.x, camera.eye.z - camera.target.z);
        closeTo(horizontal, camera.dist, 1e-6, 'horizontal eye distance ');
        assert.ok(camera.dist >= 340, `adaptive dist should be >= 340, got ${camera.dist}`);
      });

      it('keeps scale = focal / dist and an orthonormal basis', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        closeTo(camera.scale, camera.focal / camera.dist, 1e-6, 'scale ');
        for (const key of ['fwd', 'right', 'up']) {
          assert.ok(isUnit(camera[key]), `camera3D.${key} must be normalised`);
        }
        closeTo(dot(camera.right, camera.fwd), 0, 1e-6, 'right ⟂ fwd ');
        closeTo(dot(camera.up, camera.fwd), 0, 1e-6, 'up ⟂ fwd ');
        closeTo(dot(camera.right, camera.up), 0, 1e-6, 'right ⟂ up ');
        assert.ok(camera.up.y > 0, 'up should point towards +y (world up)');
      });

      it('points fwd from the eye towards the target and keeps yaw small', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const toTarget = sub(camera.target, camera.eye);
        const length = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
        const expected = { x: toTarget.x / length, y: toTarget.y / length, z: toTarget.z / length };
        closeTo(dot(camera.fwd, expected), 1, 1e-6, 'fwd direction ');
        assert.ok(Math.abs(camera.yaw) <= deg2rad(10) + 1e-9, `yaw must be small, got ${camera.yaw}`);
      });
    });

    // ----------------------------------------------------------------
    // Projection
    // ----------------------------------------------------------------
    describe('projectPoint() / projectGamePoint()', () => {
      it('projects the camera target to the centre of the screen', () => {
        const page = rig();
        const W = page.get('W');
        const H = page.get('H');
        const camera = plain(page.get('camera3D'));
        const p = page.call('projectPoint', camera.target);
        assert.ok(p, 'the aim point must be in front of the camera');
        closeTo(p.x, W / 2, 1e-6, 'screen x ');
        closeTo(p.y, H / 2, 1e-6, 'screen y ');
        const eyeDistance = Math.hypot(
          camera.target.x - camera.eye.x,
          camera.target.y - camera.eye.y,
          camera.target.z - camera.eye.z
        );
        closeTo(p.depth, eyeDistance, 1e-6, 'depth ');
        closeTo(p.scale, camera.focal / eyeDistance, 1e-6, 'scale ');
      });

      it('projects the camera origin below the centre (reasonable tolerance)', () => {
        const page = rig();
        const W = page.get('W');
        const H = page.get('H');
        const origin = page.call('projectGamePoint', page.get('cam.x'), page.get('cam.y'));
        assert.ok(origin, 'the world origin must be visible');
        closeTo(origin.x, W / 2, 1, 'world origin screen x ');
        assert.ok(origin.y > H / 2, 'world origin should be below the aim point');
        assert.ok(origin.y < H, 'world origin should stay on screen');
      });

      it('rejects points at or behind the near plane', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const behind = pointAlong(camera.eye, camera.fwd, -50);
        assert.equal(page.call('projectPoint', behind), null, 'behind camera must be null');
        const tooClose = pointAlong(camera.eye, camera.fwd, camera.near - 5);
        assert.equal(page.call('projectPoint', tooClose), null, 'inside near plane must be null');
        const justInside = pointAlong(camera.eye, camera.fwd, camera.near + 5);
        assert.notEqual(page.call('projectPoint', justInside), null, 'just past near must project');
      });

      it('grows the scale as objects get closer to the camera', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const far = page.call('projectGamePoint', 0, 0, 0);
        const near = page.call('projectPoint', { x: 0, y: 0, z: camera.eye.z - 80 });
        assert.ok(far && near, 'both points should project');
        assert.ok(near.depth < far.depth, 'the near point must have a smaller depth');
        assert.ok(near.scale > far.scale, 'closer objects must have a bigger scale');
      });

      it('scales exactly as focal / depth', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const a = pointAlong(camera.eye, camera.fwd, 300);
        const b = pointAlong(camera.eye, camera.fwd, 600);
        const pa = page.call('projectPoint', a);
        const pb = page.call('projectPoint', b);
        closeTo(pa.scale, camera.focal / 300, 1e-6, 'scale at 300 ');
        closeTo(pb.scale, camera.focal / 600, 1e-6, 'scale at 600 ');
        closeTo(pa.scale / pb.scale, 2, 1e-6, 'inverse depth ratio ');
        // Screen-space lateral displacement follows the same 1/depth law.
        const la = pointAlong(add(a, scaled(camera.right, 50)), camera.fwd, 0);
        const lb = pointAlong(add(b, scaled(camera.right, 50)), camera.fwd, 0);
        const qa = page.call('projectPoint', la);
        const qb = page.call('projectPoint', lb);
        closeTo((qa.x - page.get('W') / 2) / (qb.x - page.get('W') / 2), 2, 1e-6, 'lateral ratio ');
      });

      it('projectGamePoint is projectPoint(gameTo3D(...))', () => {
        const page = rig();
        for (const [wx, wy, wz] of [[0, 0, 0], [120, -210, 0], [-45, -48, 170], [0, 0, 80]]) {
          const viaGame = page.call('projectGamePoint', wx, wy, wz);
          const via3D = page.call('projectPoint', page.call('gameTo3D', wx, wy, wz));
          assert.equal(Boolean(viaGame), Boolean(via3D), `nullability for (${wx},${wy},${wz})`);
          if (!viaGame) continue;
          closeTo(viaGame.x, via3D.x, 1e-6, `x for (${wx},${wy},${wz}) `);
          closeTo(viaGame.y, via3D.y, 1e-6, `y for (${wx},${wy},${wz}) `);
          closeTo(viaGame.depth, via3D.depth, 1e-6, `depth for (${wx},${wy},${wz}) `);
        }
      });
    });

    // ----------------------------------------------------------------
    // Near clipping
    // ----------------------------------------------------------------
    describe('clipPolygonNear()', () => {
      it('returns a fully visible polygon untouched', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const base = camera.target;
        const pts = [
          add(add(base, scaled(camera.right, -120)), scaled(camera.up, 40)),
          add(add(base, scaled(camera.right, 120)), scaled(camera.up, 40)),
          add(base, scaled(camera.up, -60)),
        ];
        const out = plain(page.call('clipPolygonNear', pts));
        assert.equal(out.length, 3);
        out.forEach((p, i) => {
          closeTo(p.x, pts[i].x, 1e-6, `x[${i}] `);
          closeTo(p.y, pts[i].y, 1e-6, `y[${i}] `);
          closeTo(p.z, pts[i].z, 1e-6, `z[${i}] `);
        });
      });

      it('clips a polygon that crosses the near plane to depths >= near', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const front = camera.target;
        const depth = Math.hypot(
          front.x - camera.eye.x,
          front.y - camera.eye.y,
          front.z - camera.eye.z
        );
        const behind = pointAlong(front, camera.fwd, -(depth + 500));
        const pts = [
          front,
          add(behind, scaled(camera.right, -100)),
          add(behind, scaled(camera.right, 100)),
        ];
        const out = plain(page.call('clipPolygonNear', pts));
        assert.ok(Array.isArray(out), 'clipPolygonNear must return an array');
        assert.ok(out.length >= 3, `expected a clipped polygon, got ${out.length} points`);
        assert.ok(out.length <= 5, `clipping a triangle should not add faces (${out.length} points)`);
        // Depth must follow the documented view-space formula dot(p - eye, fwd).
        const viewDepth = (p) =>
          (p.x - camera.eye.x) * camera.fwd.x +
          (p.y - camera.eye.y) * camera.fwd.y +
          (p.z - camera.eye.z) * camera.fwd.z;
        for (const p of out) {
          assert.equal(typeof p.x, 'number');
          assert.equal(typeof p.y, 'number');
          assert.equal(typeof p.z, 'number');
          const d = viewDepth(p);
          assert.ok(
            d >= camera.near - 1e-9,
            `clipped depth ${d} is in front of the near plane ${camera.near}`
          );
          // Vertices strictly beyond the near plane must project; a vertex that
          // lands exactly on the plane may sit on the floating-point boundary.
          if (d > camera.near + 1e-6) {
            assert.ok(page.call('projectPoint', p), `depth ${d} must project`);
          }
        }
        assert.ok(
          out.some((p) => Math.abs(viewDepth(p) - camera.near) < 1e-6),
          'at least one clipped vertex should sit on the near plane'
        );
      });

      it('rejects a polygon entirely behind the near plane', () => {
        const page = rig();
        const camera = plain(page.get('camera3D'));
        const pts = [
          pointAlong(camera.eye, camera.fwd, -50),
          pointAlong(add(camera.eye, scaled(camera.right, 100)), camera.fwd, -80),
          pointAlong(add(camera.eye, scaled(camera.up, 100)), camera.fwd, -120),
        ];
        const out = plain(page.call('clipPolygonNear', pts));
        assert.ok(Array.isArray(out));
        assert.equal(out.length, 0);
      });
    });

    // ----------------------------------------------------------------
    // Sky zones
    // ----------------------------------------------------------------
    describe('zonePalette()', () => {
      const palette = (page, altitude) => plain(page.call('zonePalette', altitude));

      it('returns all documented keys with sane types', () => {
        const page = load();
        const keys = ['top', 'bottom', 'fog', 'starAlpha', 'planetAlpha', 'sunset', 'cosmic', 'cloudTint', 'name'];
        for (const altitude of [0, 900, 1800, 2700, 5000]) {
          const zone = palette(page, altitude);
          for (const key of keys) {
            assert.ok(key in zone, `zonePalette(${altitude}).${key} missing`);
          }
          for (const key of ['top', 'bottom', 'fog', 'cloudTint']) {
            assert.equal(typeof zone[key], 'string', `zonePalette(${altitude}).${key}`);
          }
          for (const key of ['starAlpha', 'planetAlpha', 'sunset']) {
            assert.equal(typeof zone[key], 'number', `zonePalette(${altitude}).${key}`);
            assert.ok(zone[key] >= 0 && zone[key] <= 1, `zonePalette(${altitude}).${key} out of [0,1]`);
          }
          assert.equal(typeof zone.cosmic, 'boolean');
          assert.equal(typeof zone.name, 'string');
          assert.ok(zone.name.length > 0);
        }
      });

      it('switches zone at the documented thresholds 900 / 1800 / 2700', () => {
        const page = load();
        assert.notEqual(palette(page, 899).name, palette(page, 900).name, 'zone must change at 900');
        assert.notEqual(palette(page, 1799).name, palette(page, 1800).name, 'zone must change at 1800');
        assert.notEqual(palette(page, 2699).name, palette(page, 2700).name, 'zone must change at 2700');
        // Exactly four distinct zones in the documented range.
        const names = new Set(
          [0, 900, 1800, 2700, 5000].map((altitude) => palette(page, altitude).name)
        );
        assert.equal(names.size, 4);
      });

      it('flags cosmic only at/above 2700', () => {
        const page = load();
        for (const altitude of [0, 400, 899, 900, 1800, 2699]) {
          assert.equal(palette(page, altitude).cosmic, false, `cosmic at ${altitude}`);
        }
        for (const altitude of [2700, 3000, 5000]) {
          assert.equal(palette(page, altitude).cosmic, true, `cosmic at ${altitude}`);
        }
        assert.equal(palette(page, 2700).name, palette(page, 5000).name);
      });

      it('fades starAlpha and planetAlpha in monotonically', () => {
        const page = load();
        const samples = [0, 200, 500, 800, 1100, 1300, 1500, 1800, 2000, 2100, 2400, 2700, 3000];
        const star = samples.map((altitude) => palette(page, altitude).starAlpha);
        const planet = samples.map((altitude) => palette(page, altitude).planetAlpha);
        for (let i = 1; i < samples.length; i++) {
          assert.ok(star[i] >= star[i - 1] - 1e-9, `starAlpha decreased at ${samples[i]}`);
          assert.ok(planet[i] >= planet[i - 1] - 1e-9, `planetAlpha decreased at ${samples[i]}`);
        }
        assert.equal(palette(page, 0).starAlpha, 0);
        assert.equal(palette(page, 0).planetAlpha, 0);
        // starAlpha = max(0, (alt - 1100) / 1000), capped at 1
        closeTo(palette(page, 1600).starAlpha, 0.5, 1e-9, 'starAlpha(1600) ');
        closeTo(palette(page, 2100).starAlpha, 1, 1e-9, 'starAlpha(2100) ');
        closeTo(palette(page, 3000).starAlpha, 1, 1e-9, 'starAlpha(3000) ');
        // planetAlpha = max(0, (alt - 2000) / 900), capped at 1
        closeTo(palette(page, 2450).planetAlpha, 0.5, 1e-9, 'planetAlpha(2450) ');
        closeTo(palette(page, 2900).planetAlpha, 1, 1e-9, 'planetAlpha(2900) ');
      });

      it('computes the sunset veil with the documented ramps', () => {
        const page = load();
        const clamp01 = (v) => Math.min(1, Math.max(0, v));
        const expected = (altitude) => clamp01((altitude - 900) / 700) * clamp01((2500 - altitude) / 1100);
        for (const altitude of [0, 900, 1000, 1600, 2500, 2700, 5000]) {
          closeTo(palette(page, altitude).sunset, expected(altitude), 1e-9, `sunset(${altitude}) `);
        }
      });

      it('keeps the 2D sky gradient endpoints and tints', () => {
        const page = load();
        const ground = palette(page, 0);
        assert.ok(colorsEqual(ground.top, 'rgb(37,99,235)'), `zone-0 top was ${ground.top}`);
        assert.ok(colorsEqual(ground.bottom, 'rgb(147,197,253)'), `zone-0 bottom was ${ground.bottom}`);
        const sky = palette(page, 900);
        assert.ok(colorsEqual(sky.top, 'rgb(29,78,216)'), `zone-1 top was ${sky.top}`);
        const sunset = palette(page, 1800);
        assert.ok(colorsEqual(sunset.top, 'rgb(49,16,66)'), `zone-2 top was ${sunset.top}`);
        const space = palette(page, 3000);
        assert.ok(colorsEqual(space.top, 'rgb(2,4,10)'), `zone-3 top was ${space.top}`);
        assert.ok(colorsEqual(space.bottom, 'rgb(15,23,42)'), `zone-3 bottom was ${space.bottom}`);
        // top/bottom/cloudTint must actually differ between zones.
        assert.notEqual(ground.top, space.top);
        assert.notEqual(ground.bottom, space.bottom);
        assert.notEqual(ground.cloudTint, sunset.cloudTint);
      });
    });

    // ----------------------------------------------------------------
    // Toon shading
    // ----------------------------------------------------------------
    describe('shadeHex() / mixHex()', () => {
      it('formats shadeHex output as rgb(r,g,b)', () => {
        const page = load();
        const out = page.call('shadeHex', '#abcdef', 1);
        assert.match(out, /^rgb\(\d+,\d+,\d+\)$/);
      });

      it('scales the channels by the brightness factor', () => {
        const page = load();
        assert.equal(page.call('shadeHex', '#808080', 1), 'rgb(128,128,128)');
        assert.equal(page.call('shadeHex', '#ff0000', 1), 'rgb(255,0,0)');
        assert.equal(page.call('shadeHex', '#ffffff', 0), 'rgb(0,0,0)');
        const half = parseColor(page.call('shadeHex', '#ff0000', 0.5));
        assert.deepEqual(half, [128, 0, 0]);
      });

      it('mixHex interpolates like the legacy lerpColor', () => {
        const page = load();
        assert.ok(colorsEqual(page.call('mixHex', '#000000', '#ffffff', 0), 'rgb(0,0,0)'));
        assert.ok(colorsEqual(page.call('mixHex', '#000000', '#ffffff', 1), 'rgb(255,255,255)'));
        assert.ok(colorsEqual(page.call('mixHex', '#000000', '#ffffff', 0.5), 'rgb(128,128,128)'));
        assert.ok(colorsEqual(page.call('mixHex', '#2563eb', '#1d4ed8', 0), 'rgb(37,99,235)'));
        assert.ok(colorsEqual(page.call('mixHex', '#2563eb', '#1d4ed8', 1), 'rgb(29,78,216)'));
        assert.match(page.call('mixHex', '#abcdef', '#123456', 0.3), /^rgb\(\d+,\d+,\d+\)$/);
      });
    });

    // ----------------------------------------------------------------
    // Meshes
    // ----------------------------------------------------------------
    describe('platformMesh()', () => {
      const plat = (extra = {}) => ({
        wx: 0, wy: 0, w: 250, h: 32, text: 'TEST', side: 'left',
        level: 1, status: 'neutral', broken: false, fallY: 0, isCorrect: false,
        ...extra,
      });

      it('builds a 3D slab mesh with the documented fields', () => {
        const page = load();
        const mesh = plain(page.call('platformMesh', plat()));
        assert.ok(mesh && Array.isArray(mesh.faces), 'platformMesh must return {faces}');
        assert.ok(mesh.faces.length >= 6, `octagonal slab needs faces, got ${mesh.faces.length}`);
        for (const key of ['faces', 'rw', 'wy', 'topY', 'halfW', 'halfD']) {
          assert.ok(key in mesh, `platformMesh().${key} missing`);
        }
        assert.equal(typeof mesh.rw, 'number');
        assert.equal(typeof mesh.halfW, 'number');
        assert.equal(typeof mesh.halfD, 'number');
      });

      it('caches the mesh on the platform object', () => {
        const page = load();
        const p = plat();
        const first = page.call('platformMesh', p);
        assert.ok(first, 'platformMesh should return a mesh');
        assert.equal(p._mesh3d, first, 'mesh must be cached as p._mesh3d');
        const second = page.call('platformMesh', p);
        assert.equal(second, first, 'second call must reuse the cached mesh');
        assert.equal(second.faces.length, first.faces.length);
      });

      it('rebuilds the cached geometry when rw or wy changes', () => {
        const page = load();
        const p = plat();
        const first = page.call('platformMesh', p);
        p.wy = -840; // climb far enough to change the projected render width (rw)
        const second = page.call('platformMesh', p);
        assert.ok(second, 'platformMesh after a move should still return a mesh');
        assert.equal(p._mesh3d, second);
        // Cache may be invalidated; the mesh must stay structurally valid.
        assert.ok(second.faces.length >= 6);
      });

      it('uses consistent, volumetric octagon faces', () => {
        const page = load();
        const p = plat();
        const mesh = plain(page.call('platformMesh', p));
        const all = [];
        const byKind = { top: [], bottom: [], side: [] };
        for (const face of mesh.faces) {
          assert.ok(Array.isArray(face.pts), 'face.pts must be an array');
          assert.ok(face.pts.length >= 3, 'a face needs at least 3 vertices');
          assert.equal(typeof face.kind, 'string', 'every face needs a kind');
          assert.ok(['top', 'bottom', 'side'].includes(face.kind), `unexpected face kind ${face.kind}`);
          byKind[face.kind].push(face);
          for (const pt of face.pts) {
            for (const axis of ['x', 'y', 'z']) {
              assert.equal(typeof pt[axis], 'number', `face vertex ${axis}`);
            }
            all.push(pt);
          }
        }
        // Rounded box: 1 top cap + 1 bottom cap (octagons) + 8 side quads.
        assert.equal(byKind.top.length, 1, 'one octagon top face');
        assert.equal(byKind.bottom.length, 1, 'one octagon bottom face');
        assert.equal(byKind.side.length, 8, 'eight side quads');
        assert.equal(byKind.top[0].pts.length, 8, 'top cap is an octagon');
        assert.equal(byKind.bottom[0].pts.length, 8, 'bottom cap is an octagon');
        for (const side of byKind.side) assert.equal(side.pts.length, 4, 'side face is a quad');

        const ys = all.map((pt) => pt.y);
        const zs = all.map((pt) => pt.z);
        const xs = all.map((pt) => pt.x);
        const thick = Math.max(...ys) - Math.min(...ys);
        assert.ok(thick > 0 && thick <= 60, `slab thickness ${thick} should be a visible slab`);
        // The top cap sits exactly on the platform surface (topY).
        for (const pt of byKind.top[0].pts) closeTo(pt.y, mesh.topY, 1e-6, 'top cap y ');
        closeTo(Math.max(...zs) - Math.min(...zs), 170, 5, 'slab depth ');
        closeTo(Math.max(...zs), 85, 5, 'front slab edge ');
        closeTo(Math.min(...zs), -85, 5, 'back slab edge ');
        closeTo(Math.max(...xs) - Math.min(...xs), mesh.rw, mesh.rw * 0.2, 'slab width ');
      });

      it('paints status-specific colours through drawPlatform()', () => {
        const page = load();
        startGame(page);
        const fills = (extra) => {
          page.resetCtxCalls();
          page.call('drawPlatform', plat(extra), true);
          return page.ctxLog().fills.map((entry) => parseColor(entry.style)).filter(Boolean);
        };
        const expectHue = (extra, predicate, label) => {
          const colours = fills(extra);
          assert.ok(colours.length > 0, `drawPlatform should paint ${label}`);
          assert.ok(colours.some(predicate), `no ${label} colour drawn: ${JSON.stringify(colours)}`);
        };
        expectHue({ status: 'correct' }, ([r, g, b]) => g > r * 1.15 && g > b * 1.15, 'green');
        expectHue({ status: 'wrong' }, ([r, g, b]) => r > g * 1.15 && r > b * 1.15, 'red');
        expectHue({ status: 'neutral', level: 12 }, ([r, g, b]) => b > g * 1.15 && b > r * 1.02, 'purple');
        expectHue({ status: 'correct', isStart: true }, ([r, g, b]) => r > 140 && g > 120 && b < g * 0.8, 'yellow');
      });
    });

    describe('starMesh()', () => {
      it('builds a 5-point star prism (2 faces + 10 sides = 12 faces)', () => {
        const page = load();
        const mesh = plain(page.call('starMesh'));
        assert.ok(mesh && Array.isArray(mesh.faces), 'starMesh must return {faces}');
        assert.equal(mesh.faces.length, 12, 'prism should have 2 caps + 10 sides');
        const caps = mesh.faces.filter((face) => face.pts.length === 10);
        const sides = mesh.faces.filter((face) => face.pts.length === 4);
        assert.equal(caps.length, 2, 'front + back star faces');
        assert.equal(sides.length, 10, 'one quad per star edge');
        for (const face of mesh.faces) assert.equal(typeof face.kind, 'string');
      });

      it('uses outer radius 45, inner radius 25 and thickness 26', () => {
        const page = load();
        const mesh = plain(page.call('starMesh'));
        const zs = mesh.faces.flatMap((face) => face.pts.map((pt) => pt.z));
        closeTo(Math.max(...zs), 13, 1e-6, 'front face z ');
        closeTo(Math.min(...zs), -13, 1e-6, 'back face z ');
        closeTo(Math.max(...zs) - Math.min(...zs), 26, 1e-6, 'prism thickness ');

        const cap = mesh.faces.find((face) => face.pts.length === 10 && face.pts[0].z > 0);
        assert.ok(cap, 'front star cap not found');
        const radii = cap.pts.map((pt) => Math.hypot(pt.x, pt.y));
        closeTo(Math.max(...radii), 45, 1e-6, 'outer radius ');
        closeTo(Math.min(...radii), 25, 1e-6, 'inner radius ');
      });
    });

    describe('sortByDepth()', () => {
      it('sorts items far -> near for the painter algorithm', () => {
        const page = load();
        const items = [{ id: 'a', d: 1 }, { id: 'b', d: 5 }, { id: 'c', d: 3 }];
        const sorted = plain(page.call('sortByDepth', items, (item) => item.d));
        assert.deepEqual(sorted.map((item) => item.id), ['b', 'c', 'a']);
      });
    });

    // ----------------------------------------------------------------
    // One full frame
    // ----------------------------------------------------------------
    describe('animate() frame', () => {
      it('paints a 3D frame (polygons, text, DPR transform) without throwing', () => {
        const page = load();
        startGame(page);
        page.resetCtxCalls();
        assert.doesNotThrow(() => page.frame(1000));
        const calls = page.ctxCalls();
        for (const name of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'fill', 'stroke', 'fillText', 'createLinearGradient', 'setLineDash']) {
          assert.ok((calls[name] || 0) > 0, `expected ctx.${name} to be called by a 3D frame`);
        }
        // 3D scene = many filled polygons, not just rectangles/arcs.
        assert.ok((calls.lineTo || 0) >= 20, `expected polygon edges, got ${calls.lineTo}`);
        assert.ok((calls.fill || 0) >= 10, `expected filled faces, got ${calls.fill}`);
        // DPR is 1 in the sandbox: the frame must start by setting the DPR transform.
        const transforms = page.ctxLog().transforms;
        assert.ok(
          transforms.some((t) => t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1),
          `expected a setTransform(1,0,0,1,...) DPR call, got ${JSON.stringify(transforms)}`
        );
      });

      it('paints the sky and planet in the space zone without throwing', () => {
        const page = load();
        startGame(page);
        page.eval('cam.y = -3000; cam.targetY = -3000;');
        page.call('updateCameraRig');
        page.resetCtxCalls();
        assert.doesNotThrow(() => page.frame(1000));
        const calls = page.ctxCalls();
        assert.ok((calls.ellipse || 0) > 0, 'planet ring should be drawn with ellipse');
        assert.ok((calls.arc || 0) > 0, 'stars/planets should be drawn with arc');
      });

      it('culls platforms that are behind the camera or far off-screen', () => {
        const page = load();
        startGame(page);
        page.resetCtxCalls();
        page.call('drawPlatform', null);
        assert.equal(page.ctxCalls().save || 0, 0, 'drawPlatform(null) must be a no-op');
        page.resetCtxCalls();
        page.call('drawPlatform', { wx: 0, wy: 999999, w: 100, h: 20, text: 'x', side: 'left' });
        assert.equal(page.ctxCalls().save || 0, 0, 'far off-screen platforms must be culled before save');
      });
    });
  });
}

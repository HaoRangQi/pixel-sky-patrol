// 对真实制导源码运行确定性回归，只替换音效、粒子与计分边界。
// Run: node --test tools/test_missile_guidance.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = Object.fromEntries(['10_core.js', '40_game.js', '42_combat.js'].map(name =>
  [name, readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')]));
function sliceScript(name, start, end) {
  const text = sources[name], from = text.indexOf(start), to = text.indexOf(end, from);
  assert(from >= 0 && to > from, `Cannot locate real-source slice in ${name}`);
  return new vm.Script(text.slice(from, to), {
    filename: name, lineOffset: text.slice(0, from).split('\n').length - 1,
  });
}
const constants = sliceScript('10_core.js', 'const TAU =', 'const PAL =');
const math = sliceScript('10_core.js', 'const clamp =', '// ------------------------------------------------------------ matrices');
const game = new vm.Script(sources['40_game.js'], { filename: '40_game.js' });
const combat = new vm.Script(sources['42_combat.js'], { filename: '42_combat.js' });
const len = a => Math.hypot(a.x, a.y, a.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = a => ({ x: a.x, y: a.y, z: a.z });
const round = x => Number(x.toFixed(6));
const snapshot = m => ({ age: round(m.age), pos: copy(m.pos), vel: copy(m.vel), speedField: round(m.speed), actualSpeed: round(len(m.vel)), dead: m.dead });
const report = (t, value) => t.diagnostic(JSON.stringify(value));

function fixture() {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.5;
  const effects = [];
  const context = vm.createContext({ Math: deterministicMath, recordExplosion: p => effects.push(copy(p)) });
  for (const script of [constants, math, game, combat]) script.runInContext(context);
  // Only presentation/scoring hooks are stubbed; missile, fuse, damage and vector code stay real.
  const api = vm.runInContext(`
    addSmoke = spawnBurst = spawnSparks = spawnDebris = addScorch = addShake = awardKill = trace = () => {};
    spawnExplosion = p => recordExplosion(p);
    const AudioSys = { launch() {}, explosion() {}, shieldHit() {} };
    ({ G, basisFrom, rotateTowards, spawnPlayerMissile, spawnEnemyMissile,
       updateMissiles, targetAimPoint, SPEED_CRUISE, SPEED_BURN });
  `, context);
  const { G } = api;
  G.mode = 'play';
  G.map = { heightAt: () => 0, cloudDensity: () => 0 };
  G.player = {
    pos: { x: 0, y: 600, z: 0 }, speed: api.SPEED_CRUISE,
    basis: api.basisFrom(0, 0, 0), dead: false, invuln: 0,
    agl: 600, inCloud: 0, skimming: false, shield: 100,
  };
  return { ...api, effects };
}
function launch(f, target) {
  f.G.lock.phase = 'locked';
  f.G.lock.target = target;
  f.G.enemies = [target];
  f.spawnPlayerMissile();
  return f.G.missiles.at(-1);
}
function advance(f, seconds, dt = 1 / 60) {
  assert(dt > 0 && dt <= 0.05, 'respect the production timestep cap');
  const steps = Math.round(seconds / dt);
  assert(Math.abs(steps * dt - seconds) < 1e-9);
  for (let i = 0; i < steps; i++) f.updateMissiles(dt);
}
function drone(f) {
  return { pos: { x: 90, y: 598.75, z: -500 }, speed: 108,
    basis: f.basisFrom(0, 0, 0), isGround: false, hp: 100, dead: false };
}

test('source snapshot', t => {
  report(t, Object.fromEntries(Object.entries(sources).map(([name, text]) =>
    [name, createHash('sha256').update(text).digest('hex')])));
});

test('enemy launch speed is continuous with the 22 m/s^2 motor ramp', t => {
  const runs = [1, 14].map(wave => {
    const f = fixture(); f.G.wave = wave;
    const m = f.spawnEnemyMissile({ x: 0, y: 600, z: 1000 }, f.G.player.pos, null);
    const beforeSpeed = len(m.vel), before = snapshot(m), dt = 1 / 60;
    f.updateMissiles(dt);
    const after = snapshot(m);
    return { wave, dt, before, after, delta: len(m.vel) - beforeSpeed, allowedDelta: 22 * dt };
  });
  report(t, runs);
  assert(runs.every(r => r.delta <= r.allowedDelta + 1e-8), 'first update jumps from the 0.55 launch velocity to the full speed field');
  assert(runs.every(r => Math.abs(r.before.speedField - r.before.actualSpeed) < 1e-8), 'speed must describe actual velocity at spawn');
});

test('opposite rotateTowards vectors retain unit length and make bounded angular progress', t => {
  const f = fixture();
  const runs = [{ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }].map(a => {
    const b = { x: -a.x, y: -a.y, z: -a.z }, maxAngle = 0.1;
    const out = f.rotateTowards(a, b, maxAngle), length = len(out);
    const dot = (a.x * out.x + a.y * out.y + a.z * out.z) / length;
    const actualTurn = Math.acos(Math.max(-1, Math.min(1, dot)));
    return { a, b, maxAngle, out, length, actualTurn };
  });
  report(t, runs);
  assert(runs.every(r => Number.isFinite(r.length) && Math.abs(r.length - 1) < 1e-8 && Math.abs(r.actualTurn - r.maxAngle) < 1e-8),
    'zero cross product is finite: the old fallback does not run and only scales the original heading');
});

test('ordinary nonparallel rotation preserves unit length and the turn limit', () => {
  const f = fixture();
  const out = f.rotateTowards({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, 0.1);
  assert(Math.abs(len(out) - 1) < 1e-12);
  assert(Math.abs(Math.acos(-out.z) - 0.1) < 1e-12);
});

test('ordinary locked player missile still homes and detonates independently of later launcher attitude', t => {
  function run(changeAttitude) {
    const f = fixture(), target = drone(f), m = launch(f, target);
    advance(f, 0.4);
    if (changeAttitude) f.G.player.basis = f.basisFrom(1.2, 0.6, 0);
    advance(f, 2.1);
    return { missile: snapshot(m), targetDead: target.dead, explosions: f.effects.length };
  }
  const unchanged = run(false), changed = run(true);
  report(t, { unchanged, changed });
  assert(unchanged.targetDead && unchanged.missile.dead && unchanged.explosions > 0);
  assert(changed.targetDead && changed.missile.dead);
  assert.deepEqual(changed.missile, unchanged.missile);
});

test('ordinary locked enemy missile still tracks a live clear-air player', t => {
  const f = fixture();
  f.G.player.basis = f.basisFrom(0.7, 0, 0);
  const m = f.spawnEnemyMissile({ x: 100, y: 600, z: 1000 }, f.G.player.pos, null);
  const initialRange = dist(m.pos, f.G.player.pos);
  advance(f, 1);
  const finalRange = dist(m.pos, f.G.player.pos);
  report(t, { initialRange, finalRange, missile: snapshot(m) });
  assert(!m.dead && !m.lost && finalRange < initialRange - 60);
  assert(Math.abs(len(m.vel) - m.speed) < 1e-9);
});

test('lost player missile with a live former target continues straight', t => {
  const f = fixture(), target = drone(f), m = launch(f, target), start = copy(m.pos);
  m.lost = true;
  advance(f, 1);
  report(t, { start, missile: snapshot(m) });
  assert(!m.dead && !target.dead);
  assert(Math.abs(m.pos.x - start.x) < 1e-9 && Math.abs(m.pos.y - start.y) < 1e-9);
  assert(Math.abs(m.vel.x) + Math.abs(m.vel.y) < 1e-9 && m.vel.z < 0);
});

test('lost enemy missile continues straight then expires on its loss timer', t => {
  const f = fixture(), m = f.spawnEnemyMissile({ x: 100, y: 600, z: 1000 }, f.G.player.pos, null);
  const initial = copy(m.vel), initialSpeed = len(initial);
  m.lost = true; m.lostTimer = 0.7;
  advance(f, 0.4);
  const straight = snapshot(m), speed = len(m.vel);
  assert(!m.dead);
  assert(dist({ x: m.vel.x / speed, y: m.vel.y / speed, z: m.vel.z / speed },
    { x: initial.x / initialSpeed, y: initial.y / initialSpeed, z: initial.z / initialSpeed }) < 1e-12);
  advance(f, 0.4);
  report(t, { straight, expired: snapshot(m), explosions: f.effects.length });
  assert(m.dead && !f.G.missiles.includes(m) && f.effects.length === 1);
});

for (const targetDestroyed of [false, true]) {
  test(`无锁或目标销毁后保持惯性航向：targetDestroyed=${targetDestroyed}`, () => {
    const f = fixture(), target = targetDestroyed ? drone(f) : null;
    if (target) launch(f, target);
    else f.spawnPlayerMissile();
    const m = f.G.missiles[0];
    advance(f, 0.4);
    if (target) target.dead = true;
    const start = copy(m.pos), direction = { x: m.vel.x / len(m.vel), y: m.vel.y / len(m.vel), z: m.vel.z / len(m.vel) };
    f.G.player.basis = f.basisFrom(1.2, 0.35, 0);
    advance(f, 3.6);
    const endDirection = { x: m.vel.x / len(m.vel), y: m.vel.y / len(m.vel), z: m.vel.z / len(m.vel) };
    assert(!m.dead);
    assert(dist(direction, endDirection) < 1e-9);
    const travelled = dist(start, m.pos);
    assert(dist(m.pos, { x: start.x + direction.x * travelled, y: start.y + direction.y * travelled, z: start.z + direction.z * travelled }) < 1e-8);
  });
}

test('50ms与25ms步长均检测到距弹道15米的近炸目标', () => {
  for (const dt of [0.05, 0.025]) {
    const f = fixture();
    f.G.player.speed = 204;
    f.spawnPlayerMissile();
    const m = f.G.missiles[0];
    advance(f, 2);
    const start = copy(m.pos), target = drone(f);
    target.pos = { x: start.x + 15, y: start.y - 0.8, z: start.z - 325 * 0.025 };
    f.G.enemies = [target];
    const aim = f.targetAimPoint(target);
    assert(dist(start, aim) > 16, '起点在近炸球外，避免只测起点命中');
    advance(f, 0.05, dt);
    if (dt === 0.05) assert(dist(m.pos, aim) > 16, '粗步长终点也在近炸球外');
    assert(m.dead && target.dead && f.effects.length > 0, `dt=${dt}漏掉线段内近炸`);
  }
});

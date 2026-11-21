// Run: node --test tools/test_enemy_speed.mjs
// Exercise the real drone spawn, AI, motion and weapon code; replace audio only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
const core = read('10_core'), world = read('20_world');
const source = [
  core.slice(core.indexOf('const TAU ='), core.indexOf('const PAL =')),
  core.slice(core.indexOf('const clamp ='), core.indexOf('// ------------------------------------------------------------ matrices')),
  world.slice(world.indexOf('const WORLD_SIZE ='), world.indexOf('const WORKER_SRC =')),
  read('40_game'), read('42_combat'),
].join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (actual, expected, why, epsilon = 1e-9) =>
  assert(Math.abs(actual - expected) <= epsilon, `${why}: expected ${expected}, got ${actual}`);

function fixture(scale) {
  const deterministicMath = Object.create(Math); deterministicMath.random = () => 0.5;
  const api = vm.runInNewContext(`${source}\n
    const AudioSys = { launch() {}, gunshot() {}, explosion() {}, shieldHit() {} };
    ({ G, basisFrom, spawnDrone, updateEnemies, spawnEnemyMissile, updateMissiles,
       spawnGunBullet, updateGunBullets, updateGround });`, { Math: deterministicMath });
  const { G, basisFrom } = api;
  G.mode = 'play'; G.wave = 1; G.waveTotal = 10;
  if (scale !== undefined) G.enemySpeedScale = scale;
  G.map = { heightAt: () => 0, cloudDensity: () => 0 };
  G.player = {
    pos: { x: 0, y: 600, z: 0 }, speed: 112, basis: basisFrom(0, 0, 0),
    dead: false, invuln: 0, agl: 600, inCloud: 0, skimming: false, shield: 100,
  };
  return api;
}

function drone(f, state = 'patrol') {
  const e = f.spawnDrone();
  Object.assign(e, {
    pos: { x: 0, y: 600, z: state === 'patrol' ? -2000 : 1000 },
    yaw: 0, pitch: 0, roll: 0, basis: f.basisFrom(0, 0, 0),
    state: state === 'leaving' ? 'patrol' : state,
    aware: state === 'patrol' ? 0 : 4.2, energy: 100, fleeT: 20,
    leaving: state === 'leaving', orbit: 0, orbitSpeed: 0.2,
    anchor: { x: -420, y: 600, z: -2600 }, missileCd: 99, gunCd: 99,
  });
  return e;
}

test('new drones immediately start at the selected speed multiplier', t => {
  const runs = [0.3, 0.65, 1, 1.2].map(scale => {
    const f = fixture(scale), e = f.spawnDrone();
    near(e.speed, 108 * scale, `spawn at ${scale}`);
    return { scale, speed: e.speed };
  });
  t.diagnostic(JSON.stringify(runs));
});

for (const [state, energy, target] of [
  ['patrol', 100, 108], ['engage', 100, 152], ['engage', 20, 112],
  ['flee', 30, 168], ['leaving', 100, 150],
]) test(`${state} at ${energy} energy scales its target speed and actual motion`, () => {
  for (const scale of [0.3, 0.65, 1.2]) {
    const f = fixture(scale), e = drone(f, state), dt = 1 / 60;
    e.energy = energy;
    const beforeSpeed = e.speed, beforePos = plain(e.pos);
    f.updateEnemies(dt);
    const expected = beforeSpeed + (target * scale - beforeSpeed) * (1 - Math.exp(-1.4 * dt));
    near(e.speed, expected, `${state} speed at ${scale}`);
    near(distance(e.pos, beforePos), expected * dt, `${state} world displacement at ${scale}`);
  }
});

test('changing the multiplier leaves existing drones continuous and new drones use it immediately', t => {
  const f = fixture(1), e = drone(f, 'leaving'), dt = 1 / 60;
  e.speed = 150;
  const before = plain(e.pos);
  f.G.enemySpeedScale = 0.3;
  assert.equal(e.speed, 150); assert.deepEqual(plain(e.pos), before);
  const fresh = f.spawnDrone(); near(fresh.speed, 32.4, 'new drone after adjustment');
  f.G.enemies = [e];
  f.updateEnemies(dt);
  const first = e.speed;
  near(first, 150 + (45 - 150) * (1 - Math.exp(-1.4 * dt)), 'first deceleration step');
  assert(first > 45 && first < 150, 'existing speed must not jump to the new target');
  for (let i = 1; i < 180; i++) f.updateEnemies(dt);
  const slower = e.speed;
  near(slower, 45 + 105 * Math.exp(-1.4 * 3), 'three seconds of deceleration');
  f.G.enemySpeedScale = 1.2;
  f.updateEnemies(dt);
  const firstAcceleration = e.speed;
  assert(firstAcceleration > slower && firstAcceleration < 180);
  for (let i = 1; i < 360; i++) f.updateEnemies(dt);
  assert(e.speed > 179.9 && e.speed < 180);
  t.diagnostic(JSON.stringify({ first, slower, firstAcceleration, final: e.speed }));
});

test('enemy speed does not scale AI energy, awareness, orbit, weapon cooldowns or the player', () => {
  const dt = 1 / 60;
  for (const state of ['engage', 'patrol', 'flee']) {
    const slow = fixture(0.3), fast = fixture(1.2);
    const a = drone(slow, state), b = drone(fast, state);
    const player = plain(slow.G.player);
    slow.updateEnemies(dt); fast.updateEnemies(dt);
    for (const key of ['state', 'age', 'aware', 'energy', 'fleeT', 'orbit', 'missileCd', 'gunCd', 'losTimer']) {
      assert.equal(a[key], b[key], `${state}.${key} runs on real simulation time`);
    }
    assert.equal(a.age, dt);
    if (state === 'engage') {
      near(a.missileCd, 99 - dt, 'missile cooldown'); near(a.gunCd, 99 - dt, 'gun cooldown');
      near(a.energy, 100 - 10.7 * dt, 'engagement energy');
    }
    if (state === 'patrol') near(a.orbit, 0.2 * dt, 'patrol orbit');
    assert.deepEqual(plain(slow.G.player), player); assert.deepEqual(plain(fast.G.player), player);
    assert.equal(slow.G.time, 0); assert.equal(fast.G.time, 0);
  }
});

test('missiles, bullets and ground enemies retain their own speed and timing', () => {
  function run(scale) {
    const f = fixture(scale), { G } = f;
    G.ground = [{ type: 'sam', pos: { x: 400, y: 0, z: 800 }, yaw: 0, dead: false, fireCd: 10, flashT: 0.3 }];
    f.spawnEnemyMissile({ x: 0, y: 600, z: 1000 }, G.player.pos, null);
    f.spawnGunBullet({ x: 200, y: 600, z: 1000 }, { x: 0, y: 0, z: -590.4 }, 'enemy', 4.2);
    for (let i = 0; i < 60; i++) { f.updateMissiles(1 / 60); f.updateGunBullets(1 / 60); f.updateGround(1 / 60); }
    return plain({ missiles: G.missiles, bullets: G.bullets, ground: G.ground, player: G.player });
  }
  assert.deepEqual(run(0.3), run(1.2));
});

test('an omitted multiplier preserves the original per-frame trajectory exactly', t => {
  const original = fixture(), explicit = fixture(1);
  const a = drone(original, 'engage'), b = drone(explicit, 'engage');
  // Captured from the real unscaled implementation before the multiplier edit.
  const originalCheckpoints = [
    { frame: 1, pos: { x: 0, y: 600.0272526733751, z: 998.1832913737416 }, speed: 109.01478150847271, energy: 99.82166666666666, state: 'engage' },
    { frame: 60, pos: { x: 0, y: 604.452606768553, z: 871.4806933244056 }, speed: 141.14973358656925, energy: 89.2999999999995, state: 'engage' },
    { frame: 180, pos: { x: 0, y: 614.8343733118072, z: 574.8566277819191 }, speed: 151.3401946198989, energy: 67.8999999999985, state: 'engage' },
    { frame: 360, pos: { x: -202.07743969851677, y: 717.8666828570997, z: 343.4222792425258 }, speed: 151.99010583773617, energy: 35.79999999999813, state: 'engage' },
  ];
  const checkpoints = [];
  for (let i = 1; i <= 360; i++) {
    original.updateEnemies(1 / 60); explicit.updateEnemies(1 / 60);
    assert.deepEqual(plain(a), plain(b), `default and explicit 1 diverged at frame ${i}`);
    if ([1, 60, 180, 360].includes(i)) checkpoints.push({ frame: i, pos: plain(a.pos), speed: a.speed, energy: a.energy, state: a.state });
  }
  assert.deepEqual(checkpoints, originalCheckpoints);
  assert(!Object.hasOwn(original.G, 'enemySpeedScale'));
  t.diagnostic(JSON.stringify(checkpoints));
});

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

function fixture(liveEffects = false) {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.5;
  const effects = [];
  const context = vm.createContext({ Math: deterministicMath, recordExplosion: p => effects.push(copy(p)) });
  for (const script of [constants, math, game, combat]) script.runInContext(context);
  // Only presentation/scoring hooks are stubbed; missile, fuse, damage and vector code stay real.
  const api = vm.runInContext(`
    addShake = awardKill = trace = () => {};
    ${liveEffects ? '' : 'spawnBurst = spawnSparks = spawnDebris = addScorch = () => {}; spawnExplosion = p => recordExplosion(p);'}
    const AudioSys = { launch() {}, explosion() {}, shieldHit() {}, gunshot() {}, tone() {} };
    ({ G, basisFrom, rotateTowards, spawnPlayerMissile, firePlayerMissile, spawnEnemyMissile,
       updateMissiles, updateEffects, updateGunBullets, spawnGunBullet, firePlayerGuns, fireDroneGuns,
       targetAimPoint, SPEED_CRUISE, SPEED_BURN, GUN_BULLET_SPEED, GUN_BULLET_GRAVITY });
  `, context);
  const { G } = api;
  G.mode = 'play';
  G.map = { heightAt: () => 0, cloudDensity: () => 0 };
  G.player = {
    pos: { x: 0, y: 600, z: 0 }, speed: api.SPEED_CRUISE,
    basis: api.basisFrom(0, 0, 0), dead: false, invuln: 0,
    agl: 600, inCloud: 0, skimming: false, shield: 100, missiles: 4, reloads: [],
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
  for (let i = 0; i < steps; i++) { f.updateMissiles(dt); f.updateEffects(dt); }
}
function drone(f) {
  return { pos: { x: 90, y: 598.75, z: -500 }, speed: 108,
    basis: f.basisFrom(0, 0, 0), isGround: false, hp: 100, dead: false };
}

test('source snapshot', t => {
  report(t, Object.fromEntries(Object.entries(sources).map(([name, text]) =>
    [name, createHash('sha256').update(text).digest('hex')])));
});

test('enemy missile speed changes smoothly under thrust and gravity', t => {
  const runs = [1, 14].map(wave => {
    const f = fixture(); f.G.wave = wave;
    const m = f.spawnEnemyMissile({ x: 0, y: 600, z: 1000 }, f.G.player.pos, null);
    const beforeSpeed = len(m.vel), before = snapshot(m), dt = 1 / 60;
    f.updateMissiles(dt);
    const after = snapshot(m);
    return { wave, dt, before, after, delta: len(m.vel) - beforeSpeed };
  });
  report(t, runs);
  assert(runs.every(r => r.delta > 0 && r.delta < 2), 'enemy missile accelerates smoothly while gravity is integrated');
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

test('无锁发射先沿机头向前，之后沿长弧下坠并撞地', t => {
  const f = fixture(); f.spawnPlayerMissile();
  const m = f.G.missiles[0], origin = copy(m.pos);
  assert(-m.vel.z / m.speed > 0.995, '水平机头发射不能瞬间向天上折转');
  advance(f, 0.25);
  const early = copy(m.pos);
  assert(origin.z - early.z > 80 && Math.abs(early.y - origin.y) < 8, '离架时应在前方而不是屏幕上方');
  advance(f, 2.75);
  const later = snapshot(m);
  assert(!m.dead && origin.z - m.pos.z > 1100 && m.pos.y < origin.y - 120 && m.vel.y < 0);
  advance(f, 8);
  report(t, { origin, early, later, impact: snapshot(m) });
  assert(m.dead && f.effects.length > 0 && m.pos.y < 2 && m.age < 14);
});

test('一枚无锁弹落岸只留下一个落点，火光结束后树冠般的烟柱仍在上升', () => {
  const f = fixture(true); f.G.map.heightAt = () => 12;
  f.spawnPlayerMissile();
  for (let i = 0; f.G.missiles.length && i < 360; i++) advance(f, 1 / 60);
  assert.equal(f.G.decals.length, 1, '一次接触不能叠两套爆点、焦痕和音效');
  const site = f.G.decals[0].pos;
  advance(f, 1);
  assert(!f.G.effects.some(e => e.type === 'fire'));
  const plume = f.G.effects.filter(e => e.type === 'smoke' && e.dark);
  assert(plume.some(e => e.pos.y + e.size > site.y + 65 && e.size >= 16), '火光熄灭后，远岸落点仍应有可辨认的离地烟柱');
  assert(plume.every(e => Math.hypot(e.pos.x - site.x, e.pos.z - site.z) < 50), '烟柱留在实际接触处');
});

test('四个实弹挂点按可见机翼交替离架（含桶滚姿态）', () => {
  const f = fixture(), p = f.G.player;
  p.renderBasis = f.basisFrom(0, 0, Math.PI / 2);
  const signs = [], offsets = [];
  for (let i = 0; i < 4; i++) {
    f.firePlayerMissile();
    const m = f.G.missiles.at(-1), a = m.pos, b = p.pos, r = p.renderBasis.right;
    const lateral = (a.x-b.x)*r.x + (a.y-b.y)*r.y + (a.z-b.z)*r.z;
    assert(Math.abs(lateral) > 1.8, '挂架应跟随画面中实际滚转的机翼');
    signs.push(Math.sign(lateral)); offsets.push(Math.round(Math.abs(lateral) * 10));
  }
  assert(signs.every((v,i) => !i || v === -signs[i-1]));
  assert.equal(new Set(offsets).size, 2, '发射点对应两对不同的可见挂架');
  assert.equal(p.missiles, 0);
});

test('即使每发都已装填完毕，两翼也轮换离架', () => {
  const f = fixture(), p = f.G.player;
  const sides = [];
  for (let i = 0; i < 5; i++) {
    p.missiles = 4; p.reloads = []; f.firePlayerMissile();
    sides.push(Math.sign(f.G.missiles.at(-1).pos.x - p.pos.x));
  }
  assert(sides.every((v,i) => !i || v === -sides[i-1]));
});

test('已锁定也先直出，再渐入既有追踪转弯', () => {
  const f = fixture(), target = drone(f); target.pos.x = 230;
  const m = launch(f, target);
  assert(Math.abs(m.vel.x) < 1, '不能在机翼上就斜指向目标');
  advance(f, 0.1);
  assert(m.pos.z < -40 && Math.abs(m.vel.x) < 2, '离架的前一小段不应横向折弯');
  advance(f, 0.3);
  assert(m.vel.x > 15 && m.target === target, '离架后才向锁定目标平滑弯过去');
});

test('20/60/120 帧的无锁弧线位置一致', () => {
  function position(dt) {
    const f = fixture(); f.spawnPlayerMissile(); const m = f.G.missiles[0];
    advance(f, 2, dt); return m.pos;
  }
  assert(dist(position(1 / 20), position(1 / 120)) < 0.15);
  assert(dist(position(1 / 60), position(1 / 120)) < 0.15);
});

test('locked missile still guides despite ballistic gravity', () => {
  const f = fixture(), target = drone(f), m = launch(f, target);
  advance(f, 0.5);
  assert(!m.dead && m.target === target);
  assert(m.gravity > 0, 'guided missile retains gravity while tracking its target');
});

test('lost enemy missile keeps falling but expires on its loss timer', t => {
  const f = fixture(), m = f.spawnEnemyMissile({ x: 100, y: 600, z: 1000 }, f.G.player.pos, null);
  m.lost = true; m.lostTimer = 0.7;
  advance(f, 0.4);
  const falling = snapshot(m);
  assert(!m.dead && m.vel.y < 0);
  advance(f, 0.4);
  report(t, { falling, expired: snapshot(m), explosions: f.effects.length });
  assert(m.dead && !f.G.missiles.includes(m) && f.effects.length === 1);
});

test('destroying a locked target releases guidance but preserves ballistic motion', () => {
  const f = fixture(), target = drone(f), m = launch(f, target);
  advance(f, 0.5);
  const before = snapshot(m); assert(before.vel.x > 0);
  target.dead = true;
  f.G.player.basis = f.basisFrom(1.2, 0.35, 0);
  advance(f, 0.1);
  assert(!m.dead && m.pos.x > before.pos.x && m.vel.y < before.vel.y);
  assert(Math.abs(m.vel.x - before.vel.x) < 0.01, '失去目标后保留横向惯性');
});

test('player gunfire creates a fast gravity-affected tracer projectile and hits after flight time', () => {
  const f = fixture(), target = drone(f);
  target.pos = { x: 0, y: 600, z: -420 };
  target.hp = 100;
  f.G.enemies = [target];
  const hp = target.hp;
  f.firePlayerGuns();
  const bullet = f.G.bullets.at(-1);
  assert.equal(target.hp, hp, 'firing is no longer hitscan');
  assert.equal(bullet.owner, 'player');
  assert.ok(len(bullet.vel) >= f.GUN_BULLET_SPEED - 1e-6);
  f.updateGunBullets(0.1);
  assert.equal(target.hp, hp, 'the projectile has not reached the target yet');
  assert.ok(bullet.vel.y < 0, 'the bullet falls under gravity');
  for (let i = 0; i < 10 && target.hp === hp; i++) f.updateGunBullets(0.05);
  assert.equal(target.hp, hp - 12, 'swept projectile collision applies normal gun damage');
});

test('enemy gun burst creates delayed physical rounds instead of direct random damage', () => {
  const f = fixture(), enemy = { pos: { x: 0, y: 600, z: 420 }, basis: f.basisFrom(0, 0, 0) };
  f.G.player.pos = { x: 0, y: 600, z: 0 };
  f.G.player.basis = f.basisFrom(0, 0, 0);
  const shield = f.G.player.shield;
  f.fireDroneGuns(enemy, f.G.player, 420);
  assert.equal(f.G.player.shield, shield, 'the fire event itself cannot apply hitscan damage');
  assert.equal(f.G.bullets.length, 4, 'enemy burst produces four physical rounds');
  assert.ok(f.G.bullets.every(b => b.owner === 'enemy' && len(b.vel) > 550));
  for (let i = 0; i < 16 && f.G.player.shield === shield; i++) f.updateGunBullets(0.05);
  assert.ok(f.G.player.shield < shield, 'enemy tracer rounds damage only when they reach the player');
});

test('gun bullets stop at terrain before reaching a target', () => {
  const f = fixture(), target = drone(f);
  target.pos = { x: 0, y: 600, z: -420 };
  target.hp = 100;
  f.G.enemies = [target];
  f.G.map.heightAt = (x, z) => z < -150 && z > -250 ? 620 : 0;
  f.firePlayerGuns();
  for (let i = 0; i < 10 && f.G.bullets.length; i++) f.updateGunBullets(0.05);
  assert.equal(target.hp, 100, 'terrain collision blocks the tracer from damaging the drone');
  assert.equal(f.G.bullets.length, 0, 'the tracer is consumed by the terrain impact');
});

test('两枚弹各自留下连贯、有界的世界烟迹；弹体消失后烟迹独立渐隐', () => {
  const f = fixture(); f.spawnPlayerMissile();
  const first = f.G.missiles[0];
  f.G.player.pos.x += 100; f.spawnPlayerMissile();
  advance(f, 1, 0.05);
  const trails = f.G.missileTrails || [];
  assert.equal(trails.length, 2, '不能把离散暗烟点当作连续航迹，也不能串弹');
  const [a,b] = trails, points = a.points;
  assert(points.length > 12 && points.length < 100);
  assert(points.every((p,i) => !i || dist(p.pos, points[i-1].pos) < 22), '低帧率不能在路径上留下长间断');
  assert(points.every(p => Math.abs(p.pos.x - first.pos.x) < 1));
  assert(b.points.every(p => p.pos.x > 90));
  assert(points.at(-1).pos.z > first.pos.z && dist(points.at(-1).pos, first.pos) < 24, '末端跟在弹尾后方');
  const old = points[0], pos = copy(old.pos), life = old.life;
  const fromLaunch = points[0].pos.z - points.at(-1).pos.z;
  assert(fromLaunch > 340, '一秒时应读得出一整段航迹');
  first.dead = true; f.updateMissiles(0.01); f.updateEffects(0.05);
  assert(a.points.includes(old) && old.life < life && dist(old.pos, pos) < 0.01, '原地的烟不随导弹移除或跳位');
  f.G.missiles[0].dead = true; advance(f, 3);
  assert.equal(f.G.missileTrails.length, 0, '老烟应自行消失');
});

test('high-speed flight samples paired wing-tip trails at a drawable spacing', () => {
  const source = sources['40_game.js'];
  assert.match(source, /p\.vaporTimer \+= 0\.05;\s*const b = basisFrom\(p\.yaw, p\.pitch, p\.roll \+ \(p\.inversionRoll \|\| 0\) \+ p\.spin\);\s*addWingTrail\(wingTipPosition\(p, b, 1\), 1\);\s*addWingTrail\(wingTipPosition\(p, b, -1\), -1\);/);
});

test('50ms 与 25ms 步长均检测到只在两帧端点之间经过的游戏目标', () => {
  for (const dt of [0.05, 0.025]) {
    const f = fixture();
    f.G.player.speed = 204;
    f.spawnPlayerMissile();
    const m = f.G.missiles[0];
    advance(f, 2);
    const start = copy(m.pos), target = drone(f);
    const control = fixture(); control.G.player.speed = 204; control.spawnPlayerMissile();
    advance(control, 2); control.updateMissiles(dt);
    const end = control.G.missiles[0].pos;
    target.pos = {
      x: start.x + 19.7,
      y: (start.y + end.y) / 2 - 0.8,
      z: (start.z + end.z) / 2,
    };
    f.G.enemies = [target];
    const aim = f.targetAimPoint(target);
    assert(dist(start, aim) > m.hitRadius, '起点在近炸球外，避免只测起点命中');
    assert(dist(end, aim) > m.hitRadius, '整帧终点在近炸球外，避免只测终点命中');
    advance(f, 0.05, dt);
    assert(m.dead && target.dead && f.effects.length > 0, `dt=${dt}漏掉线段内近炸`);
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
const core = read('10_core'), world = read('20_world');
const source = [
  core.slice(core.indexOf('const TAU ='), core.indexOf('// --------------------------------------------------------------- input')),
  world.slice(world.indexOf('const WORLD_SIZE ='), world.indexOf('const WORKER_SRC =')),
  read('40_game'), read('42_combat'),
].join('\n');
const dt = 1 / 60, deg = Math.PI / 180;

function fixture({ comfortable = true, speed = 112, view = 2 } = {}) {
  const f = vm.runInNewContext(`${source}
    const VW = 604, VH = 340, INPUT = { mx: 302, my: 170, keys: new Set() };
    const AudioSys = { gunshot() {}, launch() {}, lockTone() {}, lockTick() {} };
    ({ G, INPUT, basisFrom, makePlayer, updateCamera, updateLockOn, playerLockAim, projectTargetMarker,
       spawnDrone, updateEnemies, firePlayerGuns, spawnPlayerMissile, updateGunBullets, updateMissiles });`);
  f.G.map = { heightAt: () => 0, cloudDensity: () => 0 };
  f.G.mode = 'play';
  f.G.view = view;
  f.G.spawn = { x: 0, z: 0, heading: 1 };
  f.G.player = Object.assign(f.makePlayer(f.G.map), {
    yaw: 0, pitch: 0, basis: f.basisFrom(0, 0, 0), flightComfort: comfortable,
    speed, agl: 600,
  });
  f.G.enemySpeedScale = .65;
  f.updateCamera(dt);
  return f;
}

function placeTarget(f, target, distance, degrees) {
  const { pos } = f.G.player, angle = degrees * deg;
  target.pos = { x: pos.x + Math.sin(angle) * distance, y: pos.y, z: pos.z - Math.cos(angle) * distance };
  return target;
}

function acquire(f, distance = 700, bearing = 14) {
  const target = placeTarget(f, f.spawnDrone(), distance, bearing);
  for (let i = 0; i < 49; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locked');
  assert.equal(f.G.lock.target, target);
  return target;
}

test('现有目标可以留在较宽的维持圈和2900米范围，再回正时继续锁定', () => {
  const f = fixture(), target = acquire(f);
  placeTarget(f, target, 2800, 18);
  const decoy = placeTarget(f, f.spawnDrone(), 700, 0);
  f.updateLockOn(dt);
  assert.equal(f.G.lock.target, target, '仍在维持圈内不会被另一个目标抢走');
  assert.notEqual(f.G.lock.target, decoy);
  assert.equal(f.G.lock.phase, 'locked');
  assert.equal(f.G.lock.progress, 1);
});

test('短暂丢目标可续一部分锁定进度，丢标间发射只会出无锁弹', () => {
  const f = fixture(), target = acquire(f);
  assert.equal(f.G.player.trackedAirTarget, target);
  placeTarget(f, target, 700, 30);
  f.spawnPlayerMissile();
  assert.equal(f.G.missiles.at(-1).target, null, '发射时重新检查这一帧的瞄准角度');
  for (let i = 0; i < 6; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'search');
  assert.equal(f.G.lock.target, null);
  assert.equal(f.G.player.trackedAirTarget, target);
  f.spawnPlayerMissile();
  assert.equal(f.G.missiles.at(-1).target, null);
  placeTarget(f, target, 700, 14);
  f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locking');
  assert(f.G.lock.progress > .4 && f.G.lock.progress < 1, '恢复部分进度并重新进入武器获取条件');
  for (let i = 0; i < 24; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locked');
  f.spawnPlayerMissile();
  assert.equal(f.G.missiles.at(-1).target, target);
});

test('路过准星的敌机完成锁定才接替最近确认的跟踪目标', () => {
  const f = fixture(), confirmed = acquire(f, 420, 0);
  placeTarget(f, confirmed, 420, 40);
  const passing = placeTarget(f, f.spawnDrone(), 640, 0);
  for (let i = 0; i < 12; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locking');
  assert(f.G.lock.target === passing);
  assert(f.G.player.trackedAirTarget === confirmed, '短暂掠过准星仍沿原目标提示');

  placeTarget(f, passing, 640, -40);
  f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'search');
  assert(f.G.player.trackedAirTarget === confirmed);

  placeTarget(f, passing, 640, 0);
  for (let i = 0; i < 49; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locked');
  assert(f.G.lock.target === passing);
  assert(f.G.player.trackedAirTarget === passing, '完整锁定更新跟踪目标');
});

for (const obstruction of ['terrain', 'cloud', 'destroyed']) {
  test(`${obstruction}立即阻断制导和按旧记忆重锁`, () => {
    const f = fixture(), target = acquire(f, 700, 0);
    if (obstruction === 'terrain') f.G.map.heightAt = (_, z) => z < -100 && z > -600 ? 700 : 0;
    if (obstruction === 'cloud') f.G.map.cloudDensity = () => .35;
    if (obstruction === 'destroyed') target.dead = true;
    f.spawnPlayerMissile();
    assert.equal(f.G.missiles.at(-1).target, null, '同一帧发射也遵守地形、云和存活条件');
    f.updateLockOn(dt);
    assert.equal(f.G.lock.phase, 'search');
    assert.equal(f.G.lock.target, null);
    assert.equal(f.G.lock.progress, 0);
    assert.equal(f.G.player.trackedAirTarget, null);
    f.G.map.heightAt = () => 0;
    f.G.map.cloudDensity = () => 0;
    target.dead = false;
    f.updateLockOn(dt);
    assert(Math.abs(f.G.lock.progress - dt / .8) < 1e-9);
  });
}

test('普通原版目标仍在原获取圈外立即脱锁', () => {
  const f = fixture({ comfortable: false }), target = acquire(f);
  placeTarget(f, target, 700, 18);
  f.updateLockOn(dt);
  assert.equal(f.G.lock.target, null);
  assert.equal(f.G.lock.phase, 'search');
});

function placeAtSightOffset(f, target, offset) {
  if (f.G.view === 0) {
    placeTarget(f, target, 700, 0);
    const marker = {};
    f.projectTargetMarker({ ...target.pos, y: target.pos.y + 1.5 }, marker, target);
    f.INPUT.mx = marker.x - offset; f.INPUT.my = marker.y;
    return;
  }
  const aim = f.playerLockAim(), c = f.G.camera;
  const x = ((aim.x + offset) / 604 * 2 - 1) * c.aspect * c.tanHalf;
  const y = (1 - aim.y / 340 * 2) * c.tanHalf;
  const direction = { x: c.fwd.x + c.right.x * x + c.up.x * y,
    y: c.fwd.y + c.right.y * x + c.up.y * y, z: c.fwd.z + c.right.z * x + c.up.z * y };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  target.pos = { x: c.pos.x + direction.x / length * 700,
    y: c.pos.y + direction.y / length * 700 - 1.5, z: c.pos.z + direction.z / length * 700 };
}

for (const view of [0, 1, 2]) test(`新版视角${view}捕获圈缩紧，越过保持边界发射无锁，旧入口圈不变`, () => {
  const f = fixture({ view }), target = f.spawnDrone();
  f.G.player.lockRadius = 38;
  const radius = view === 0 ? 47.5 : 38;
  assert.equal(f.playerLockAim().radius, radius);
  placeAtSightOffset(f, target, radius + 2);
  for (let i = 0; i < 50; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.target, null, '原大圈内、新小圈外的目标不允许捕获');
  placeAtSightOffset(f, target, radius - 2);
  for (let i = 0; i < 50; i++) f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locked');
  placeAtSightOffset(f, target, radius * 1.14);
  f.updateLockOn(dt);
  assert.equal(f.G.lock.phase, 'locked', '边沿小幅偏移保留锁定');
  placeAtSightOffset(f, target, radius * 1.22);
  f.spawnPlayerMissile();
  assert.equal(f.G.missiles.at(-1).target, null, '越界同帧发射不允许沿用旧锁定');
  f.updateLockOn(dt);
  assert.equal(f.G.lock.target, null);
  delete f.G.player.lockRadius;
  assert.equal(f.playerLockAim().radius, view === 0 ? 92 : 74);
});

function drone(f, state, x, y, z, yaw) {
  const e = f.spawnDrone();
  Object.assign(e, {
    pos: { x, y, z }, yaw, pitch: 0, roll: 0, basis: f.basisFrom(yaw, 0, 0),
    state, aware: state === 'engage' ? 4.2 : 0, energy: 100, fleeT: 12,
    missileCd: 99, gunCd: 99, anchor: { x: 0, y: 600, z: -2000 }, orbit: 0, orbitSpeed: .2,
  });
  return e;
}

test('追击、脱离和巡逻统一限制敌机的转弯与升降响应', () => {
  for (const state of ['engage', 'patrol', 'flee']) {
    const f = fixture(), e = drone(f, state, 0, 1000, 1200, Math.PI / 2);
    const yaw = e.yaw;
    f.updateEnemies(dt);
    const yawRate = Math.abs(e.yaw - yaw) / dt / deg;
    const pitchRate = Math.abs(e.pitch) / dt / deg;
    assert(yawRate >= 32 && yawRate <= 38, `${state} yaw ${yawRate}°/s`);
    assert(pitchRate > 5 && pitchRate <= 28, `${state} pitch ${pitchRate}°/s`);
  }
});

for (const state of ['engage', 'patrol']) {
  test(`${state}近掠之后沿原航向飞过边界，留出追击窗口再转入下一段`, () => {
    const f = fixture(), e = drone(f, state, 418, 600, 0, Math.PI / 2);
    f.G.player.inCloud = .5;
    let maxYawChange = 0;
    for (let i = 0; i < 144; i++) {
      f.updateEnemies(dt);
      maxYawChange = Math.max(maxYawChange, Math.abs(e.yaw - Math.PI / 2));
    }
    assert(e.pos.x > 560, '敌机应持续移动并穿过420米边界');
    assert(maxYawChange < 2 * deg, `近掠直飞应保留原航向，实际偏差 ${maxYawChange / deg}°`);
    for (let i = 0; i < 72; i++) f.updateEnemies(dt);
    assert(Math.abs(e.yaw - Math.PI / 2) > 12 * deg, '结束脱离后要继续正常机动');
  });
}

test('敌机沿近掠航向继续飞行时仍能在有效方向开火', () => {
  const f = fixture(), e = drone(f, 'engage', 0, 600, -410, Math.PI);
  e.gunCd = 0;
  f.updateEnemies(dt);
  assert(f.G.bullets.some(b => b.owner === 'enemy'), '掠过玩家前仍能开火');
  assert(Math.abs(Math.sin(e.yaw)) < 1e-9 && Math.cos(e.yaw) < 0, '仍沿通过玩家的既有航线飞行');
});

for (const knots of [218, 500, 1500]) {
  test(`${knots}节开火后，机炮和锁定或无锁导弹均向前离机`, () => {
    const speed = knots / 1.94384;
    for (const guided of [true, false]) {
      const f = fixture({ speed }), p = f.G.player;
      if (guided) acquire(f, 2100, 0);
      f.firePlayerGuns();
      f.spawnPlayerMissile();
      const bullet = f.G.bullets[0], missile = f.G.missiles[0];
      assert.equal(!!missile.target, guided);
      let greatestMissileDrop = 0;
      for (let i = 0; i < 36; i++) {
        const before = missile.speed;
        p.pos.z -= speed * dt;
        f.updateMissiles(dt); f.updateGunBullets(dt);
        greatestMissileDrop = Math.max(greatestMissileDrop, before - missile.speed);
      }
      assert(p.pos.z - bullet.pos.z > 10, '机炮弹体在己机前方');
      assert(p.pos.z - missile.pos.z > 10, '导弹开启制导后仍在己机前方');
      assert(greatestMissileDrop < 5, '开启制导的首帧不会瞬间降速');
      assert(Math.abs(-bullet.vel.z - speed - 720) < 1e-9, '机炮始终保留相对载机的出膛速度');
      assert(Math.abs(missile.maxSpeed - speed - 1000) < 1e-9);
    }
  });
}

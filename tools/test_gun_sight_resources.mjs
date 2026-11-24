import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const core = read('src/10_core.js');
const source = [core.slice(core.indexOf('const TAU ='), core.indexOf('// --------------------------------------------------------------- input')),
  read('src/40_game.js'), read('src/42_combat.js'), read('src/43_defense.js'), read('src/44_ai.js'), read('sky-patrol/64_scene.js')].join('\n');

function fixture(view = 1, speed = 257.22) {
  const context = vm.createContext({ console, document: { body: { classList: { add() {}, remove() {} } } } });
  const f = vm.runInContext(`${source}
    const VW = 604, VH = 340, CLOUD_BASE = 1300, CLOUD_TOP = 2200, INPUT = { mx: 302, my: 170, keys: new Set() }, TOUCH = { active: false };
    const AudioSys = { gunshot() {}, shieldHit() {}, explosion() {}, launch() {}, lockTone() {}, lockTick() {}, updateEngine() {} };
    ({ G, INPUT, basisFrom, makePlayer, buildCamera, computePose, firePlayerGuns, updatePlayerGuns, updateGunBullets,
       updateGame, updateEnemies, updateMissiles, spawnEnemyMissile, spawnGunBullet, wingmanSpawn, wingmanOnRunStart, updateWingman,
       projectToScreen, updateCamera, run: code => eval(code) });`, context);
  const { G } = f;
  G.map = { heightAt: () => 0, cloudDensity: () => 0 };
  G.mode = 'play'; G.view = view; G.spawn = { x: 0, z: 0, heading: 0 };
  G.player = Object.assign(f.makePlayer(G.map), { pos: { x: 0, y: 1500, z: 0 }, speed, yaw: 0, pitch: 0, roll: 0,
    flightComfort: true, gunSightOffset: 16, gunEffectiveRange: 900, gunCapacity: 180, gunAmmo: 180, gunReload: 0, gunReloadSeconds: 10 });
  G.player.basis = G.player.renderBasis = f.basisFrom(0, 0, 0);
  G.camera = f.buildCamera(f.computePose(view, false));
  return f;
}

for (const view of [0, 1, 2]) for (const range of [150, 450, 850]) {
  test(`视角${view}准星所指${range}米目标由实体机炮命中，无需抬枪补偿`, () => {
    const f = fixture(view), { G } = f;
    const ray = raisedRay(G.camera);
    const point = view === 0 ? { x: 0, y: 1500, z: -range } : {
      x: G.camera.pos.x + ray.x * range,
      y: G.camera.pos.y + ray.y * range,
      z: G.camera.pos.z + ray.z * range,
    };
    const target = { pos: point, hp: 72, maxHp: 72, radius: 4, dead: false };
    G.enemies = [target];
    // 俯瞰使用同高度光标方位，追尾/座舱使用上移16逻辑像素的准星。
    if (view === 0) {
      const p = {}; f.projectToScreen({ x: 0, y: 1500, z: -25 }, p);
      f.INPUT.mx = p.x; f.INPUT.my = p.y;
    }
    f.firePlayerGuns();
    assert.equal(target.hp, 72, '开火时不允许直接扣血');
    for (let i = 0; i < 100 && target.hp === 72; i++) f.updateGunBullets(1 / 60);
    assert.equal(target.hp, 60, '炮弹应命中准星射线上的原目标');
  });
}

function raisedRay(camera) {
  const y = 16 / 170 * camera.tanHalf;
  const v = { x: camera.fwd.x + camera.up.x * y, y: camera.fwd.y + camera.up.y * y, z: camera.fwd.z + camera.up.z * y };
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function muzzlePoint(f) {
  return f.run('vadd(vmad(G.player.pos,(G.player.renderBasis || G.player.basis).fwd,4.9),vmul((G.player.renderBasis || G.player.basis).up,-.62))');
}

for (const knots of [100, 500, 1500]) for (const view of [1, 2]) {
  test(`${knots}节视角${view}真实炮口出生，平直段按900米准星校准方向连续收敛`, () => {
    const f = fixture(view, knots / 1.94384), p = f.G.player;
    const muzzle = muzzlePoint(f), ray = raisedRay(f.G.camera);
    const point = { x: f.G.camera.pos.x + ray.x * 900, y: f.G.camera.pos.y + ray.y * 900, z: f.G.camera.pos.z + ray.z * 900 };
    f.firePlayerGuns();
    const bullet = f.G.bullets[0];
    assert.deepEqual({ ...bullet.pos }, { ...muzzle }, '实体起点必须是机体炮口，不是相机准星射线上的空中点');
    const start = {}; f.projectToScreen(bullet.pos, start);
    let previousError = Math.hypot(start.x - 302, start.y - 154);
    assert(previousError > 2, '炮口近场视差不能被游戏化起点偷偷抹掉');
    const relative = { x: bullet.vel.x - p.basis.fwd.x * p.speed,
      y: bullet.vel.y - p.basis.fwd.y * p.speed, z: bullet.vel.z - p.basis.fwd.z * p.speed };
    const length = Math.hypot(point.x - muzzle.x, point.y - muzzle.y, point.z - muzzle.z);
    for (const axis of ['x', 'y', 'z']) assert(Math.abs(relative[axis] - (point[axis] - muzzle[axis]) / length * 720) < 1e-8);
    const flatTime = bullet.flatTime, initialError = previousError;
    for (let i = 0; i < 80; i++) {
      const dt = flatTime / 80;
      p.pos = f.run(`vmad(G.player.pos,G.player.basis.fwd,G.player.speed*${dt})`);
      f.G.time += dt; f.updateGunBullets(dt); f.updateCamera(dt);
      const head = {}; f.projectToScreen(bullet.pos, head);
      const error = Math.hypot(head.x - 302, head.y - 154);
      assert(error <= previousError + .01, '实际近弹应从炮口连续收敛，不瞬移到准星');
      previousError = error;
    }
    assert(previousError < initialError * .15, '实际平直段应显著接近准星，不能为测试延长有效射程');
  });
}

test('完整帧连发从本帧真实炮口出生，不重复推进出生帧或把近弹搬到准星', () => {
  const f = fixture(1, 1500 / 1.94384), p = f.G.player;
  p.cruiseSpeed = p.speed; p.burnSpeed = p.speed; p.mouseSteering = false;
  f.G.waveTotal = f.G.waveSpawned = 1;
  f.INPUT.keys.add('KeyF');
  for (let i = 0; i < 24; i++) {
    f.updateGame(1 / 60);
    for (const b of f.G.bullets) {
      if (b.trail.length !== 1) continue;
      const muzzle = muzzlePoint(f);
      assert.deepEqual({ ...b.pos }, { ...muzzle }, `完整帧${i}的新弹必须刚出生在炮口`);
    }
  }
});

for (const view of [1,2]) test(`视角${view}俯仰和侧倾时，炮弹和火光从同一可见机体炮口出生`, () => {
  const f=fixture(view,500/1.94384),p=f.G.player;
  Object.assign(p,{yaw:.65,pitch:.25,roll:-.45});p.basis=p.renderBasis=f.basisFrom(p.yaw,p.pitch,p.roll);
  p.renderBasis=f.basisFrom(p.yaw,p.pitch,p.roll+.12);
  f.G.camera=f.buildCamera(f.computePose(view,false));f.firePlayerGuns();
  const bullet=f.G.bullets[0], muzzle=muzzlePoint(f);
  assert.deepEqual({ ...bullet.pos }, { ...muzzle });
  const fire=f.G.effects.filter(e=>e.type==='spark');
  assert(fire.length>0);
  assert(fire.every(e=>Math.hypot(e.pos.x-muzzle.x,e.pos.y-muzzle.y,e.pos.z-muzzle.z)<1));
});

test('追尾和座舱的准星、锁定参考共用上移位置，原入口仍居中', () => {
  const f = fixture();
  for (const view of [1, 2]) {
    f.G.view = view;
    const aim = f.run('playerLockAim()');
    assert.equal(aim.x, 302); assert.equal(aim.y, 154);
    const p = f.run('playerGunSight()');
    assert.equal(p.x, aim.x); assert.equal(p.y, aim.y);
  }
  delete f.G.player.gunSightOffset;
  assert.equal(f.run('playerLockAim().y'), 170);
});

test('有效射程内弹道平直，超程后开始受重力下坠，射出后不追踪移动目标', () => {
  const f = fixture(2), p = f.G.player;
  f.firePlayerGuns();
  const bullet = f.G.bullets[0], before = { ...bullet.vel };
  for (let i = 0; i < 30; i++) f.updateGunBullets(1 / 60);
  assert.equal(bullet.vel.y, before.y, '有效射程内不让玩家猜下坠');
  for (let i = 0; i < 65; i++) f.updateGunBullets(1 / 60);
  assert(bullet.vel.y < before.y - 1, '有效射程外保留重力');
  const vx = bullet.vel.x; p.yaw = 1; p.basis = f.basisFrom(1, 0, 0);
  f.updateGunBullets(1 / 60);
  assert.equal(bullet.vel.x, vx, '已射出的机炮不随飞机或锁定改变方向');
});

test('玩家机炮180发耗尽后十秒补给，期间不能开火且暂停不计时', () => {
  const f = fixture();
  for (let i = 0; i < 180; i++) { f.G.player.gunCd = 0; f.firePlayerGuns(); }
  assert.equal(f.G.player.gunAmmo, 0);
  assert.equal(f.G.player.gunReload, 10);
  const shots = f.G.stats.shots;
  f.G.player.gunCd = 0; f.firePlayerGuns();
  assert.equal(f.G.stats.shots, shots);
  for (let i = 0; i < 540; i++) f.updatePlayerGuns(1 / 60);
  assert.equal(f.G.player.gunAmmo, 0, '九秒不得提前补满');
  const remaining = f.G.player.gunReload; f.G.mode = 'paused';
  for (let i = 0; i < 120; i++) f.updateGame(1 / 60);
  assert.equal(f.G.player.gunReload, remaining);
  f.G.mode = 'play';
  for (let i = 0; i < 61; i++) f.updatePlayerGuns(1 / 60);
  assert.equal(f.G.player.gunAmmo, 180);
});

test('准星外锁定目标不会吸附子弹，地形仍能挡住机炮', () => {
  const f = fixture(2), camera = f.G.camera;
  const enemy = { pos: { x: camera.pos.x+90, y: camera.pos.y, z: camera.pos.z-450 }, radius: 7, hp: 72 };
  f.G.enemies = [enemy]; f.G.lock = { target: enemy, phase: 'locked' };
  f.firePlayerGuns();
  assert(Math.abs(f.G.bullets[0].vel.x) < 1e-6, '不能朝准星外的锁定目标拐弯');
  f.G.map.heightAt = (_x,z) => z < -150 && z > -200 ? 1700 : 0;
  for (let i=0;i<50 && f.G.bullets.length;i++) f.updateGunBullets(1/60);
  assert.equal(f.G.bullets.length,0);
  assert.equal(enemy.hp,72);
});

test('移动目标按可见提前量射击可命中，不额外加入重力抬枪', () => {
  const f = fixture(1), p = f.G.player;
  const target = { pos: { x: 0, y: 1500, z: -500 }, speed: 120, basis: f.basisFrom(0,0,0), hp:72, radius:7 };
  f.G.enemies=[target];
  const lead=f.run('playerGunLead(G.enemies[0])');
  // The visible cue must account for the velocity already inherited from the carrier.
  const z=lead.z, distance=Math.abs(z-22.5), raise=Math.atan(16/170*Math.tan(1.01/2));
  f.G.camera=f.buildCamera({pos:{x:0,y:1508,z:22.5},target:{x:0,y:1508+Math.tan(Math.atan2(1500.8-1508,distance)-raise)*distance,z},up:{x:0,y:1,z:0},fov:1.01});
  f.firePlayerGuns();
  for(let i=0;i<100 && target.hp===72;i++) {target.pos.z-=target.speed/60;f.updateGunBullets(1/60);}
  assert.equal(target.hp,60);
});

test('移动目标的提前量只包含相对载机速度，不重复计算已经继承的前进速度', () => {
  const f=fixture(),p=f.G.player;
  const target={pos:{x:0,y:1500,z:-500},speed:p.speed,basis:f.basisFrom(0,0,0)};
  f.G.enemies=[target];const lead=f.run('playerGunLead(G.enemies[0])');
  assert(Math.abs(lead.z-target.pos.z)<.01,'同速同向时相对位置不变，提前量不能再沿世界速度前推');
});

test('旧入口不启用新版准星或库存时，继续原有弹道和无限备弹合同', () => {
  const f = fixture(2), p = f.G.player;
  delete p.gunEffectiveRange; delete p.gunCapacity; delete p.gunAmmo;
  f.firePlayerGuns(); const bullet = f.G.bullets[0], vy = bullet.vel.y;
  f.updateGunBullets(.1);
  assert(bullet.vel.y < vy);
  assert.equal(p.gunAmmo, undefined);
});

test('敌方导弹能锁向僚机并实际扣盾，不把伤害记到玩家', () => {
  const f = fixture(), p = f.G.player;
  f.G.wingmanWanted = true; f.wingmanOnRunStart();
  const wing = f.G.allies[0];
  wing.pos = { x: 0, y: 1500, z: -300 };
  wing.speed = 0;
  const missile = f.spawnEnemyMissile({ x: 0, y: 1500, z: -500 }, wing.pos, null, 26, wing);
  assert.equal(missile.target, wing);
  for (let i=0;i<120 && !missile.dead;i++) f.updateMissiles(1/60);
  assert.equal(wing.shield,54);
  assert.equal(p.shield,100);
});

test('敌机能自主选择射界内的僚机作为攻击对象', () => {
  const f = fixture(); f.G.wingmanWanted=true; f.wingmanOnRunStart();
  f.run(`G.waveTotal=1;G.waveSpawned=0;const e=spawnDrone();
    Object.assign(e,{pos:{x:0,y:1500,z:0},yaw:0,pitch:0,roll:0,state:'engage',aware:4.2,energy:100,gunCd:0,missileCd:999});
    e.basis=basisFrom(0,0,0);G.player.pos.z=200;G.allies[0].pos={x:0,y:1500,z:-200};updateEnemies(1/60);`);
  assert(f.G.bullets.some(b=>b.owner==='enemy' && b.vel.z<0), '敌方机炮应射向前方僚机而非身后的玩家');
});

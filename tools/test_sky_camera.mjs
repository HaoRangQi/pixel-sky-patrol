// Run real camera/game math in the existing VM seam; no build output or model changes.
// Run: node --test tools/test_sky_camera.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const core = read('src/10_core.js');
function coreSlice(start, end) {
  const from = core.indexOf(start), to = core.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing core seam: ${start}`);
  return new vm.Script(core.slice(from, to), { filename: 'src/10_core.js' });
}
const constants = coreSlice('const TAU =', 'const PAL =');
const math = coreSlice('const clamp =', '// Bayer 4x4 threshold');
const game = new vm.Script(read('src/40_game.js'), { filename: 'src/40_game.js' });
const scene = new vm.Script(read('sky-patrol/64_scene.js'), { filename: 'sky-patrol/64_scene.js' });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b, k) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const near = (a, b, message, epsilon = 1e-7) => assert(Math.abs(a - b) < epsilon, `${message}: ${a} != ${b}`);

function fixture(seed = 1337, aspect = 16 / 9) {
  const context = vm.createContext({ document: { body: { classList: { add() {}, remove() {} } } } });
  vm.runInContext(`
    let VW = ${340 * aspect}, VH = 340;
    const AudioSys = { uiTick() {}, waveStart() {}, updateEngine() {}, lowWarn() {}, enabled: false };
    const INPUT = { keys: new Set(), mx: VW/2, my: VH*.52, mouseSteerAge: Infinity };
    const TOUCH = { active: false };
    function resetMouseSteering() {}
    function updateEffects() {}
    function updateVapor() {}
    function addWingTrail() {}
  `, context);
  for (const script of [constants, math, game]) script.runInContext(context);
  // Combat spawning is outside the camera seam; startup/reset and all camera logic stay real.
  vm.runInContext('beginWave = () => {}; const originalComputePose = computePose;', context);
  scene.runInContext(context);
  const api = vm.runInContext(`({ G, basisFrom, computePose, originalComputePose,
    setupTitleWorld, startRun, restartRun, cycleView, updateCamera, updateTitle, updateFlight, projectToScreen, INPUT })`, context);
  api.G.seed = seed;
  api.G.mode = 'title';
  api.G.map = {
    heightAt: () => 40, forestAt: () => 0.8, cloudDensity: () => 0,
    findScenicSpawn: () => ({ x: 3100, z: 5200, heading: -0.2 }),
  };
  api.setupTitleWorld();
  return api;
}

function assertTailAxis(f, label) {
  const { G } = f, { player: p, camera: c } = G;
  const heading = f.basisFrom(p.yaw, 0, 0), horizontalRight = heading.right;
  near(dot(sub(c.pos, p.pos), horizontalRight), 0, `${label}: camera leaves the rear heading plane`);
  near(dot(sub(c.target, p.pos), horizontalRight), 0, `${label}: target leaves the rear heading plane`);
  near(c.right.y, 0, `${label}: horizon rolls with the aircraft`);
  assert(dot(sub(c.pos, p.pos), heading.fwd) < -10, `${label}: camera must remain behind the tail heading`);
  assert(dot(sub(c.target, p.pos), heading.fwd) > 10, `${label}: target must look ahead of the nose heading`);
  for (const distance of [-4, 0, 5]) {
    const screen = {};
    assert(f.projectToScreen(add(p.pos, p.renderBasis.fwd, distance), screen));
    near(screen.x / (340 * c.aspect), 0.5, `${label}: fuselage axis drifts horizontally`, 1e-4);
  }
}

function orient(f, yaw, pitch, roll = 0, spin = 0) {
  const p = f.G.player;
  Object.assign(p, { yaw, pitch, roll, spin });
  p.basis = f.basisFrom(yaw, pitch, roll);
  p.renderBasis = f.basisFrom(yaw, pitch, roll + spin);
}

for (const dt of [1/30, 1/60, 1/144]) {
  test(`真实A/D转向与松键时机身倾斜、追尾地平线保持水平（${Math.round(1/dt)} Hz）`, () => {
    const f = fixture(); f.startRun(); f.updateCamera(dt);
    let maxBank = 0, maxHorizonRoll = 0, maxLateral = 0;
    for (let frame = 0; frame < Math.round(4/dt); frame++) {
      const t = frame*dt;
      f.INPUT.keys.clear();
      if (t < 1) f.INPUT.keys.add('KeyD');
      if (t >= 2 && t < 3) f.INPUT.keys.add('KeyA');
      f.G.time += dt; f.updateFlight(dt); f.updateCamera(dt);
      maxBank = Math.max(maxBank, Math.abs(f.G.player.roll));
      maxHorizonRoll = Math.max(maxHorizonRoll, Math.abs(Math.asin(f.G.camera.right.y)));
      maxLateral = Math.max(maxLateral, Math.abs(dot(sub(f.G.camera.pos, f.G.player.pos), f.basisFrom(f.G.player.yaw, 0, 0).right)));
    }
    assert(maxBank > .9, '不能靠取消机身倾斜通过镜头回归');
    assert(maxHorizonRoll < 1e-5, `地平线随转向倾斜${maxHorizonRoll*180/Math.PI}°`);
    assert(maxLateral < 1e-5, `转向期间机位绕机身横移${maxLateral}米`);
    assertTailAxis(f, 'A/D松键后');
  });

  test(`真实抬头与松键的追尾俯仰没有瞬间抽动（${Math.round(1/dt)} Hz）`, () => {
    const f = fixture(); f.startRun(); f.updateCamera(dt);
    let angle = Math.asin(f.G.camera.fwd.y), velocity = 0, maxAcceleration = 0;
    for (let frame = 0; frame < Math.round(3/dt); frame++) {
      f.INPUT.keys.clear();
      if (frame*dt >= .2 && frame*dt < .7) f.INPUT.keys.add('KeyW');
      f.G.time += dt; f.updateFlight(dt); f.updateCamera(dt);
      const nextAngle = Math.asin(f.G.camera.fwd.y), nextVelocity = (nextAngle-angle)/dt;
      maxAcceleration = Math.max(maxAcceleration, Math.abs(nextVelocity-velocity)/dt);
      angle = nextAngle; velocity = nextVelocity;
      assertTailAxis(f, `W/松键 ${frame}`);
    }
    assert(maxAcceleration < 12, `俯仰角加速度${maxAcceleration.toFixed(2)} rad/s²，按键边沿仍在抽动`);
    assert(Math.abs(f.G.player.pitch) < .01, '真实抬头后应自然回平，不写玩家姿态');
  });
}

test('追尾受击反馈不再给机位和瞄向叠加逐帧随机震动', () => {
  const f = fixture(); f.startRun(); f.updateCamera(1/60);
  const before = JSON.stringify(f.G.camera);
  f.G.shake = 2;
  for (let frame = 0; frame < 30; frame++) {
    f.updateCamera(1/60);
    assert.equal(JSON.stringify(f.G.camera), before, `受击第${frame}帧仍随机移动世界`);
  }
  assert.equal(f.G.shake, 2, '不能清掉游戏受击状态来掩盖相机震动');
});

test('正式加力和松键减速不泵动追尾FOV', () => {
  const f = fixture(); f.startRun(); f.updateCamera(1/60);
  const fov = f.G.camera.fov;
  let maxSpeed = 0, minFuel = 100;
  for (let frame = 0; frame < 360; frame++) {
    f.INPUT.keys.clear();
    if (frame < 120) f.INPUT.keys.add('ShiftLeft');
    f.G.time += 1/60; f.updateFlight(1/60); f.updateCamera(1/60);
    maxSpeed = Math.max(maxSpeed, f.G.player.speed); minFuel = Math.min(minFuel, f.G.player.fuel);
    near(f.G.camera.fov, fov, '加力不能拉伸世界视野');
  }
  assert(maxSpeed >= 203 && minFuel < 70, '必须真正加力耗油，而不是绕过飞行更新');
});

test('默认从南岸向北贯穿湖区，而非瞄准旧盆地中心', () => {
  const f = fixture(), { spawn: sp, player: p } = f.G;
  assert(sp.z > 6700 && sp.z < 7600, '南岸出发应留出至少 6 公里的首段航程');
  assert(p.basis.fwd.z < -0.98, '首段应沿水系长轴，而不是斜切过湖心后撞上对岸');
  const alternate = fixture(77);
  assert.equal(alternate.G.spawn.x, 3100, 'other seeds keep their map-selected spawn');
  assert.equal(alternate.G.spawn.z, 5200);
});

test('title chase aims farther into the lake while staying on the tail axis', () => {
  const f = fixture(), b = f.G.player.basis;
  f.updateCamera(1 / 60);
  const pose = f.computePose(1, false), verticalAim = dot(sub(pose.target, pose.pos), b.up);
  assert.ok(verticalAim < -12, `title should frame foreground water and shore, got ${verticalAim.toFixed(1)}m`);
  assertTailAxis(f, 'title landscape framing');
  const flight = fixture(); flight.startRun(); flight.updateCamera(1 / 60);
  const flightPlayer = flight.G.player, flightPose = flight.computePose(1, false);
  const flightAim = dot(sub(flightPose.target, flightPose.pos), flightPlayer.basis.up);
  assert.ok(flightAim < -11, `first-flight chase should retain landscape foreground, got ${flightAim.toFixed(1)}m`);
});

test('standby, first flight, and restart use the same centered tail-axis framing', () => {
  const f = fixture();
  for (const mode of ['title', 'start', 'restart']) {
    if (mode === 'start') f.startRun();
    if (mode === 'restart') {
      f.G.chasePos = { x: -9000, y: 5000, z: 8000 };
      f.G.mode = 'failed';
      f.restartRun();
    }
    orient(f, -0.32, 0.19, 0.48);
    const before = JSON.stringify(f.G.player);
    f.updateCamera(1 / 60);
    assertTailAxis(f, mode);
    assert.equal(JSON.stringify(f.G.player), before, 'camera must not rotate or replace the existing aircraft');
    assert.equal(f.G.view, 1);
  }
});

for (const mode of ['title', 'play']) for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
  test(`${mode} yaw/pitch/bank changes stay behind the fuselage on every frame at ${Math.round(1 / dt)} FPS`, () => {
    const f = fixture(1337, 4 / 3);
    if (mode === 'play') f.startRun();
    const p = f.G.player;
    for (let frame = 0; frame < Math.round(6 / dt); frame++) {
      const t = frame * dt;
      orient(f, 2.9 + t * 0.9, Math.sin(t * 1.7) * 0.55, Math.sin(t * 1.1) * 0.8);
      p.pos = add(p.pos, p.basis.fwd, p.speed * dt);
      f.G.lastDt = dt;
      f.updateCamera(dt);
      assertTailAxis(f, `${mode}, frame ${frame}`);
    }
  });
}

test('standby autopilot and its camera keep moving rather than freezing a static picture', () => {
  const f = fixture(), start = { ...f.G.player.pos };
  f.updateCamera(1 / 60);
  const camera = { ...f.G.camera.pos };
  for (let i = 0; i < 180; i++) {
    f.G.lastDt = 1 / 60;
    f.updateTitle(1 / 60);
    assertTailAxis(f, `standby frame ${i}`);
  }
  assert(Math.hypot(...Object.values(sub(f.G.player.pos, start))) > 200);
  assert(Math.hypot(...Object.values(sub(f.G.camera.pos, camera))) > 200);
});

for (const scenic of [false, true]) {
  test(`${scenic ? '巡航' : '截击'}俯视都以近距真实机体取景，不退回地图图标比例`, () => {
    for (const aspect of [1.38, 1.84, 2.89, .57]) {
      const f = fixture(1337, aspect), { G } = f;
      f.startRun();
      G.skyScenic = scenic ? { oblique: false, from: 0, changedAt: 0 } : null;
      G.view = 0; G.prevView = 0; G.viewBlend = 1;
      orient(f, 0, 0);
      const before = JSON.stringify(G.player);
      f.updateCamera(1 / 60);
      const c = G.camera, p = G.player;
      assert(c.pos.y - p.pos.y < 80, `俯视距离仍为${c.pos.y - p.pos.y}米`);
      near(c.pos.x, p.pos.x, '北向俯视不应侧移');
      near(c.pos.z, p.pos.z, '北向俯视不应前后偏移');
      near(c.up.z, -1, '屏幕上方应固定为北');
      const left = {}, right = {}, nose = {}, tail = {};
      assert(f.projectToScreen(add(p.pos, p.renderBasis.right, -4.9), left));
      assert(f.projectToScreen(add(p.pos, p.renderBasis.right, 4.9), right));
      assert(f.projectToScreen(add(p.pos, p.renderBasis.fwd, 6.59), nose));
      assert(f.projectToScreen(add(p.pos, p.renderBasis.fwd, -4.3), tail));
      const span = Math.abs(right.x - left.x) / (340 * aspect);
      const length = Math.abs(tail.y - nose.y) / 340;
      assert(span > .145 && span < .55, `机翼占画宽${span}，无法看清机型或已裁切`);
      assert(length > .25 && length < .60, `机长占画高${length}，未达到参考的主体比例`);
      assert.equal(JSON.stringify(p), before, '镜头不能修改飞机姿态或位置');
      assert.deepEqual(f.computePose(0, false), f.originalComputePose(0, false), '巡航与截击应共用实际俯视，而非只修演示模式');
    }
  });
}

test('近距俯视里仍可用屏幕边缘指示选择原本可见的游戏目标，不冒充目标在机身下', () => {
  const f = fixture(), { G } = f;
  f.startRun(); orient(f, 0, 0);
  G.view = G.prevView = 0; G.viewBlend = 1; f.updateCamera(1 / 60);
  const context = vm.createContext({ G, VW: 604, VH: 340, INPUT: { mx: 302, my: 18 },
    LOCK_TIME: .8, AudioSys: { lockTick() {}, lockTone() {} },
    projectToScreen: f.projectToScreen, lineOfSightClear: () => true });
  math.runInContext(context);
  new vm.Script(read('src/42_combat.js')).runInContext(context);
  G.map.cloudDensity = () => 0;
  const ahead = add(G.player.pos, G.player.basis.fwd, 700);
  G.enemies = [{ kind: 'drone', pos: ahead }];
  const worldPoint = {};
  assert(f.projectToScreen(ahead, worldPoint) && !worldPoint.visible, '目标应确实在显示画面之外');
  const lock = () => vm.runInContext('for(let i=0;i<60;i++) updateLockOn(1/60);', context);
  lock();
  assert.equal(G.lock.phase, 'locked', '原地图可选中的前方目标在镜头拉近后不能消失');
  context.INPUT.my = 322; lock();
  assert.equal(G.lock.phase, 'search', '不能在鼠标指向相反方向时继续选中');
  context.INPUT.my = 18; context.lineOfSightClear = () => false; lock();
  assert.equal(G.lock.phase, 'search', '屏幕边缘指示不能选穿地形');
});

test('受击时北向俯视不因震动歪斜，也不靠HUD符号补偿机位', () => {
  const f = fixture();
  f.startRun();
  f.G.view = 0; f.G.prevView = 0; f.G.viewBlend = 1; f.G.shake = 2;
  for (let i = 0; i < 20; i++) {
    f.updateCamera(1 / 60);
    near(f.G.camera.fwd.y, -1, '受击后俯视仍应垂直向下');
    near(f.G.camera.up.z, -1, '受击后屏幕上方仍应为北');
  }
});

test('top/cockpit poses and all three smooth view transitions remain in the shared engine', () => {
  const f = fixture();
  f.startRun();
  orient(f, -0.4, 0.15, 0.3);
  for (const view of [0, 2]) {
    assert.deepEqual(f.computePose(view, false), f.originalComputePose(view, false));
  }
  for (const next of [2, 0, 1]) {
    const previous = f.G.view;
    f.cycleView();
    assert.equal(f.G.view, next);
    assert.equal(f.G.prevView, previous);
    assert.equal(f.G.viewBlend, 0);
    const a = f.computePose(previous, false), b = f.computePose(next, false);
    f.G.viewBlend = 0.5;
    f.updateCamera(1 / 60);
    for (const key of ['x', 'y', 'z']) {
      near(f.G.camera.pos[key], (a.pos[key] + b.pos[key]) / 2, 'switch must blend camera position');
      near(f.G.camera.target[key], (a.target[key] + b.target[key]) / 2, 'switch must blend aim');
    }
    assert(f.G.viewBlend > 0.5 && f.G.viewBlend < 1);
    for (let i = 0; i < 66; i++) f.updateCamera(1 / 60);
    assert.equal(f.G.viewBlend, 1);
    if (next === 2) assert(f.G.cockpitAlpha > 0.99);
    if (next === 1) assertTailAxis(f, 'return from top');
  }
});

test('barrel spin remains visible from chase and still rotates the cockpit camera', () => {
  const f = fixture();
  f.startRun();
  orient(f, -0.4, 0.1, 0.25);
  f.updateCamera(1 / 60);
  const chase = f.computePose(1, false), cockpit = f.computePose(2, false);
  f.G.player.spin = Math.PI;
  f.updateCamera(1 / 60);
  const spunChase = f.computePose(1, false), spunCockpit = f.computePose(2, false);
  assert.deepEqual(spunChase, chase, 'chase must not cancel the aircraft barrel spin by spinning with it');
  assert(dot(f.G.player.basis.up, f.G.player.renderBasis.up) < -0.99);
  assert(dot(cockpit.up, spunCockpit.up) < -0.99, 'cockpit must follow render-basis barrel roll');
  near(dot(sub(spunCockpit.target, spunCockpit.pos), f.G.player.renderBasis.fwd), 160, 'cockpit still looks forward');
});

test('terrain clearance during a bank lifts the chase camera without a lateral body-axis offset', () => {
  const f = fixture();
  f.G.map.heightAt = () => 650;
  orient(f, -0.3, 0.42, 0.55);
  f.updateCamera(1 / 60);
  assert(f.G.camera.pos.y >= 654.5);
  assertTailAxis(f, 'banked hill clearance');
});

test('chase poses and blended camera keep terrain/water clearance in standby and flight', () => {
  for (const mode of ['title', 'play']) {
    const f = fixture();
    f.G.mode = mode;
    f.G.map.heightAt = () => 200;
    f.G.player.pos.y = 201;
    orient(f, -0.3, 0.45);
    const pose = f.computePose(1, false);
    assert(pose.pos.y >= 204.5, `${mode}: direct chase pose must clear terrain`);
    f.G.view = 1; f.G.prevView = 2; f.G.viewBlend = 0.5;
    f.updateCamera(1 / 60);
    assert(f.G.camera.pos.y >= 203, `${mode}: blended camera must clear terrain`);
    f.G.map.heightAt = () => -50;
    f.G.player.pos.y = -2;
    const waterPose = f.computePose(1, false);
    assert(waterPose.pos.y >= 4.5, `${mode}: chase must clear the water surface`);
  }
});

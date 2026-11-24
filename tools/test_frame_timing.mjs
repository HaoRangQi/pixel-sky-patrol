// Run: node --test tools/test_frame_timing.mjs
// Drive the real RAF callback, game clock and flight model with a VM wall clock.
// Rendering, combat and browser scheduling are the only external boundaries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function slice(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing source seam: ${start}`);
  return source.slice(from, to);
}
const core = read('src/10_core.js'), main = read('src/60_main.js');
const source = [
  slice(core, 'const TAU =', 'const PAL ='),
  slice(core, 'const clamp =', '// Bayer 4x4 threshold'),
  read('src/40_game.js'),
  slice(main, '// --------------------------------------------------------------- frame ------', 'function collectDrawables()'),
  slice(main, 'window.__PI =', '// --------------------------------------------------------------- start ------'),
].join('\n');
const near = (actual, expected, message, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${message}: expected ${expected}, got ${actual}`);

function fixture(sky = false) {
  let wall = 0;
  const callbacks = [], listeners = new Map(), calls = { renders: 0, ui: 0, resizes: 0, steps: [] };
  const document = {
    hidden: false,
    body: { classList: { add() {}, remove() {} } },
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  const context = vm.createContext({ window: {}, document, calls,
    performance: { now: () => wall },
    requestAnimationFrame: callback => callbacks.push(callback),
  });
  vm.runInContext(`
    let VW = 604, VH = 340, WORLD_H = 640;
    let qualityIndex = 0;
    const QUALITY_STEPS = [640, 560, 480, 400, 340, 288, 240];
    const ADAPT_QUALITY = true, FIXED_QUALITY = 0;
    const BOOT = { ready: true, error: null }, TEST = { errors: [], exceptions: [] };
    const INPUT = { keys: new Set(), mx: VW/2, my: VH/2, mouseSteerAge: Infinity };
    const TOUCH = { active: false };
    const AudioSys = { waveStart() {}, updateEngine() {}, lowWarn() {}, enabled: false };
    const Renderer = { render() { calls.renders++; } };
    function resizeAll() { calls.resizes++; }
    function collectDrawables() { return []; }
    function drawUIFrame() { calls.ui++; }
    function resetMouseSteering() {}
    function updatePlayerGuns() {}
    function updateLockOn() {}
    function updateMissiles() {}
    function updateEnemies() {}
    function updateGround() {}
    function updateGunBullets() {}
    function updateEffects() {}
    function updateVapor() {}
    function addWingTrail() {}
    ${source}
    beginWave = updateWaveLogic = computeThreats = () => {};
    const actualUpdateGame = updateGame;
    updateGame = dt => { calls.steps.push(dt); actualUpdateGame(dt); };
    G.map = { heightAt: () => 20, forestAt: () => 0, cloudDensity: () => 0,
      findScenicSpawn: () => ({ x: 0, z: 0, heading: .6 }) };
    G.meshes = {};
    startRun();
    G.player.pitch = 0;
    ${sky ? 'G.player.cruiseSpeed = 112; G.player.burnSpeed = 500 / 1.94384; G.player.speedResponse = 1.6; G.player.mouseSteering = false;' : ''}
    updateCamera(1/60);
    requestAnimationFrame(loop);
    window.__eval = code => eval(code);
  `, context);
  const run = code => context.window.__eval(code), G = context.window.__PI.G;
  function frame(seconds) {
    wall += seconds * 1000;
    assert.equal(callbacks.length, 1, 'The RAF loop must schedule exactly one successor');
    callbacks.shift()(wall);
  }
  return { G, calls, run, api: context.window.__PI, frame,
    frames(count, seconds) { for (let i = 0; i < count; i++) frame(seconds); },
    visible(hidden, seconds = 0) {
      wall += seconds * 1000; document.hidden = hidden;
      listeners.get('visibilitychange')?.();
    },
  };
}

for (const sky of [false, true]) {
  const entry = sky ? '新版' : '原入口';
  for (const fps of [60, 20, 4, 2]) {
    test(`${entry}实际RAF在${fps}FPS的4秒墙钟中保持巡航时间与位移`, () => {
      const f = fixture(sky), initial = { ...f.G.player.pos };
      f.frames(4 * fps, 1 / fps);
      near(f.G.time, 4, 'Low FPS must not discard ordinary wall time');
      near(f.G.realTime, 4, 'The game real clock must advance with wall time');
      near(Math.hypot(f.G.player.pos.x - initial.x, f.G.player.pos.y - initial.y, f.G.player.pos.z - initial.z), 448, 'Cruise world displacement');
      assert(f.calls.steps.every(dt => dt > 0 && dt <= .05), 'Every real game update must fit the established 50ms limit');
      assert.equal(f.calls.renders, 4 * fps, 'Substeps must not add renderer work');
      assert.equal(f.calls.ui, 4 * fps, 'Substeps must not add UI draws');
    });
  }

  test(`${entry}Shift在4FPS仍按墙钟达到加力上限并产生更多真实位移`, () => {
    const slow = fixture(sky), normal = fixture(sky), cruise = fixture(sky);
    slow.run("INPUT.keys.add('ShiftLeft')"); normal.run("INPUT.keys.add('ShiftLeft')");
    slow.frames(16, .25); normal.frames(80, .05); cruise.frames(16, .25);
    near(slow.G.player.speed, sky ? 500 / 1.94384 : 204, 'Shift reaches the existing entry-specific cap');
    near(slow.G.player.speed, normal.G.player.speed, 'Shift speed must not depend on render frequency');
    near(slow.G.player.fuel, normal.G.player.fuel, 'Afterburner fuel must not depend on render frequency');
    near(slow.G.player.pos.x, normal.G.player.pos.x, 'World x must match the existing 50ms integration');
    near(slow.G.player.pos.z, normal.G.player.pos.z, 'World z must match the existing 50ms integration');
    assert(Math.hypot(slow.G.player.pos.x, slow.G.player.pos.z) > Math.hypot(cruise.G.player.pos.x, cruise.G.player.pos.z) * 1.6);
  });
}

test('低帧率的FPS和自适应质量按实际墙钟采样而非模拟子步计数', () => {
  const f = fixture();
  f.frames(8, .25);
  near(f.G.fps, 4, 'Reported FPS must reflect eight rendered frames in two seconds');
  assert.equal(f.calls.resizes, 1, 'Low FPS must reduce internal resolution after the first wall-time sample');
  assert(f.run('WORLD_H') < 640);
  f.frames(24, .25);
  near(f.G.fps, 4, 'Substeps must not inflate reported FPS');
  assert.equal(f.calls.resizes, 2, 'The quality cooldown must elapse in wall seconds');
});

test('前台长停顿最多追赶半秒且不向下一帧留下积压', () => {
  const f = fixture();
  f.frame(30);
  near(f.G.time, .5, 'A long visible stall has a bounded recovery window');
  assert.equal(f.calls.steps.length, 10, 'A resumed frame has at most ten game updates');
  near(f.G.fps, 1/30, 'FPS still counts the full render gap beyond the recovery window');
  f.frame(1/60);
  near(f.G.time, .5 + 1/60, 'Discarded suspension time must not leak into later frames');
});

test('隐藏页面不推进模拟，恢复可见后不追赶后台墙钟或污染FPS', () => {
  const f = fixture();
  f.frames(8, .25);
  const before = f.G.time, position = { ...f.G.player.pos };
  f.visible(true);
  f.frame(1);
  near(f.G.time, before, 'A throttled hidden RAF must not move the player');
  assert.deepEqual({ ...f.G.player.pos }, position);
  f.visible(false, 30);
  f.frame(1/60);
  near(f.G.time, before + 1/60, 'Foreground resume must start from its current wall time');
  f.frames(119, 1/60);
  near(f.G.fps, 60, 'Background wall time must not contaminate visible FPS');
});

test('freeze保留画面刷新与手动step，解除后不补算冻结时间', () => {
  const f = fixture();
  f.frames(4, .25); f.api.freeze(true);
  const time = f.G.time, realTime = f.G.realTime, position = { ...f.G.player.pos };
  f.frames(20, .25);
  near(f.G.time, time, 'Freeze stops the simulation clock'); near(f.G.realTime, realTime, 'Freeze stops the real game clock');
  assert.deepEqual({ ...f.G.player.pos }, position);
  assert.equal(f.calls.renders, 24, 'Freeze still renders screenshots');
  f.api.step(.25);
  near(f.G.time, time + .25, 'The explicit step API still works while frozen');
  assert.equal(f.G.freeze, true);
  f.api.freeze(false); f.frame(1/60);
  near(f.G.time, time + .25 + 1/60, 'Thaw must not replay frozen wall time');
});

test('暂停期间保持位置与任务时钟，继续飞行只推进新的墙钟', () => {
  const f = fixture();
  f.frames(4, .25); f.run("G.pausedFrom = G.mode; G.mode = 'paused'");
  const time = f.G.time, realTime = f.G.realTime, position = { ...f.G.player.pos };
  f.frames(20, .25);
  near(f.G.time, time, 'Pause stops the mission clock');
  near(f.G.realTime, realTime + 5, 'Pause retains the established real-time/UI clock contract');
  assert.deepEqual({ ...f.G.player.pos }, position);
  f.run('G.mode = G.pausedFrom; G.pausedFrom = null'); f.frame(1/60);
  near(f.G.time, time + 1/60, 'Resume must not replay paused wall time');
});

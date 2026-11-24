import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const core = readFileSync(new URL('../src/10_core.js', import.meta.url), 'utf8');
const game = readFileSync(new URL('../src/40_game.js', import.meta.url), 'utf8');
const combat = readFileSync(new URL('../src/42_combat.js', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/50_ui_hud.js', import.meta.url), 'utf8');
const math = core.slice(core.indexOf('const clamp ='), core.indexOf('// ------------------------------------------------------------ matrices'));
const matrices = core.slice(core.indexOf('function mat4()'), core.indexOf('// --------------------------------------------------------------- input'));

function wingRuntime() {
  const calls = [], stamps = [];
  const document = { createElement() {
    const pixels = [], raster = { fillRect(x, y) { pixels.push([x, y, this.fillStyle]); } };
    const stamp = { pixels, getContext: () => raster };
    stamps.push(stamp); return stamp;
  } };
  const ctx = new Proxy({ globalAlpha: 1, save() {}, restore() {},
    stroke() { calls.push(['stroke', this.globalAlpha, this.lineWidth, this.lineCap, this.strokeStyle]); },
    fillRect(...args) { calls.push(['fillRect', ...args, this.fillStyle, this.globalAlpha]); },
    drawImage(image, x, y, w, h) { calls.push(['stamp', x, y, w, h, this.globalAlpha]); },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const f = vm.runInNewContext(
    `${math}\n${matrices}\n${game}\n${combat}\n${hud}\n({ G, buildCamera, basisFrom, drawVaporPoints, drawEffects, drawTracers,
      spawnGunBullet, updateGunBullets, updateEffects, projectToScreen, drawAimReticle })`,
    { VW: 604, VH: 340, UI_DPR: 1, ctx, document, TAU: Math.PI * 2, AudioSys: {},
      INPUT: { mx: 302, my: 170 }, drawText() {} },
  );
  f.G.camera = f.buildCamera({ pos: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, fov: 1 });
  return { ...f, calls, stamps };
}

function gunRuntime() {
  const f = wingRuntime();
  f.G.map = { heightAt: () => 0, cloudDensity: () => 0 };
  f.G.view = 2;
  f.G.player = { pos: { x: 0, y: 1500, z: 0 }, basis: f.basisFrom(0, 0, 0) };
  f.G.camera = f.buildCamera({ pos: { x: 0, y: 1508, z: 22.5 }, target: { x: 0, y: 1495, z: -32 }, up: { x: 0, y: 1, z: 0 }, fov: 1.01 });
  return f;
}

test('机炮出生不向炮口后方造线，飞行中不再留下静止的逐帧曳光副本', () => {
  const f = gunRuntime(), origin = { x: 0, y: 1499.38, z: -4.9 };
  const bullet = f.spawnGunBullet(origin, { x: 0, y: 0, z: -900 }, 'player', 12);
  assert.equal(f.G.tracers.length, 0, '旧出生段向后延伸13米，会在机尾透视放大');
  assert(bullet.trail.every(p => p.z <= origin.z), '采样不得出现在炮口后方');
  for (let i = 0; i < 30; i++) f.updateGunBullets(1 / 60);
  assert.equal(f.G.tracers.length, 0, '实体炮弹只绘制当前活弹自身的尾段');
});

test('炮弹短尾段有界并保留实际重力轨迹，弹体死亡后同时消失', () => {
  const f = gunRuntime();
  const bullet = f.spawnGunBullet({ x: 0, y: 1500, z: -5 }, { x: 0, y: 0, z: -900 }, 'player', 12);
  bullet.flatTime = 1;
  for (let i = 0; i < 96; i++) f.updateGunBullets(1 / 60);
  assert(bullet.trail?.length > 2 && bullet.trail.length <= 16, '尾段应采样并限制在短窗口内');
  const tail = bullet.trail[0];
  assert(tail.z > bullet.pos.z && tail.y > bullet.pos.y, '应能读出实际向前及下坠方向');
  assert(Math.abs(tail.z - bullet.pos.z) < 200, '不能沿整条航线积累长烟带');
  for (let i = 0; i < 45; i++) f.updateGunBullets(1 / 60);
  f.calls.length = 0; f.drawTracers();
  assert.equal(f.G.bullets.length, 0);
  assert.equal(f.calls.filter(c => ['stroke', 'fillRect'].includes(c[0])).length, 0, '死弹不能留下一条旧线');
});

test('追尾准星绘制读取同一个上移16像素的位置', () => {
  const f = gunRuntime();
  f.G.view = 1; f.G.player.gunSightOffset = 16;
  f.drawAimReticle();
  const rings = f.calls.filter(c => c[0] === 'arc');
  assert(rings.length > 0 && rings.every(c => c[1] === 302 && c[2] === 154));
});

test('远处沿视线的炮弹即使尾段缩成亚像素，仍绘制独立的亮弹头', () => {
  const f = gunRuntime(), c = f.G.camera;
  const origin = { ...c.pos }, velocity = { x: c.fwd.x * 900, y: c.fwd.y * 900, z: c.fwd.z * 900 };
  const bullet = f.spawnGunBullet(origin, velocity, 'player', 12);
  bullet.flatTime = 2;
  for (let i = 0; i < 75; i++) f.updateGunBullets(1 / 60);
  f.calls.length = 0; f.drawTracers();
  const heads = f.calls.filter(c => c[0] === 'fillRect' && c[3] >= 1 && c[4] >= 1 && c[6] > .5);
  assert(heads.length >= 1, '远段必须有至少一个逻辑像素的亮弹头，不能只画13米短线');
  f.G.map.heightAt = () => 1700;
  f.calls.length = 0; f.drawTracers();
  assert.equal(f.calls.filter(c => ['stroke', 'fillRect'].includes(c[0])).length, 0, '山体必须遮挡弹头和尾迹');
});

test('座舱近处的曳光不能被透视拉成贯穿风挡的长光柱', () => {
  const f = gunRuntime();
  f.G.camera = f.buildCamera({ pos: { x: 0, y: 1501, z: 3 }, target: { x: 0, y: 1501, z: -100 }, up: { x: 0, y: 1, z: 0 }, fov: 1.01 });
  const bullet = f.spawnGunBullet({ x: 0, y: 1499.38, z: -4.9 }, { x: 0, y: 0, z: -900 }, 'player', 12);
  bullet.flatTime = 2;
  f.updateGunBullets(1 / 60); f.drawTracers();
  let from, length = 0;
  for (const c of f.calls) {
    if (c[0] === 'moveTo') from = c;
    if (c[0] === 'lineTo' && from) length += Math.hypot(c[1] - from[1], c[2] - from[2]);
  }
  assert(length > 0 && length <= 12, `单发近段应为短曳光，实际长${length.toFixed(1)}逻辑像素`);
});

test('wing vapor draws two continuous side-separated lines and no circles', () => {
  const { G, drawVaporPoints, calls } = wingRuntime();
  G.vapor = [
    { pos: { x: -4, y: 0, z: -100 }, side: -1, life: 0.4, maxLife: 0.45, size: 1 },
    { pos: { x: 4, y: 0, z: -100 }, side: 1, life: 0.4, maxLife: 0.45, size: 1 },
    { pos: { x: -3, y: 0, z: -110 }, side: -1, life: 0.3, maxLife: 0.45, size: 1 },
    { pos: { x: 3, y: 0, z: -110 }, side: 1, life: 0.3, maxLife: 0.45, size: 1 },
  ];
  drawVaporPoints();
  assert.equal(calls.filter(call => call[0] === 'arc').length, 0, 'wing vapor must not be drawn as dots');
  assert.equal(calls.filter(call => call[0] === 'stroke').length, 2, 'left and right wing tips form two trails');
  assert.equal(calls.filter(call => call[0] === 'lineTo').length, 2, 'each wing trail joins adjacent samples');
});

test('wing trail starts a new segment across a teleport-sized sampling gap', () => {
  const { G, drawVaporPoints, calls } = wingRuntime();
  G.vapor = [
    { pos: { x: -4, y: 0, z: -100 }, side: -1, life: 0.4, maxLife: 0.45, size: 1 },
    { pos: { x: -3, y: 0, z: -110 }, side: -1, life: 0.3, maxLife: 0.45, size: 1 },
    { pos: { x: -2, y: 0, z: -1000 }, side: -1, life: 0.2, maxLife: 0.45, size: 1 },
  ];
  drawVaporPoints();
  assert.equal(calls.filter(call => call[0] === 'lineTo').length, 1);
  assert.equal(calls.filter(call => call[0] === 'moveTo').length, 2, 'large gaps start a new subpath');
});

test('导弹的世界烟带逐段相接、弹头附近亮细、老烟较宽且更淡', () => {
  const { G, drawEffects, calls } = wingRuntime();
  const smoke = (x, y, life) => ({ pos: { x, y, z: -170 }, life });
  G.missileTrails = [
    { points: [smoke(-18,0,0.65), smoke(-12,1,0.7), smoke(-6,3,0.75)] },
    { points: [smoke(8,8,1.4), smoke(14,10,1.45)] },
  ];
  drawEffects();
  const strokes = calls.filter(c => c[0] === 'stroke');
  assert(strokes.length >= 3, '每对相邻的烟迹采样之间要有实际的绘制');
  assert(strokes[0][1] < strokes.at(-1)[1], '老烟透明度应更低');
  assert(strokes[0][2] > strokes.at(-1)[2], '相同深度时老烟应扩散');
  let x; const widths = [];
  for (const [op, px] of calls) {
    if (op === 'moveTo') x = px;
    if (op === 'lineTo') { widths.push(Math.abs(px-x)); x = px; }
  }
  assert(widths.length >= 3 && widths.every(w => w < 18), '不能把两条不同轨迹接成横跨屏幕的一笔');
});

test('离架的烟路有暖亮受光面和松散像素边缘，不是白直尺', () => {
  const { G, calls, stamps, drawEffects } = wingRuntime();
  G.missileTrails = [{ points: Array.from({ length: 18 }, (_, i) => ({
    pos: { x: -2.2, y: -4 - i * i * 0.026, z: -32 - i * 15 }, life: 0.95 + i * 0.045,
  })) }];
  drawEffects(); const puffs = calls.filter(c => c[0] === 'stamp');
  assert(puffs.length >= 4, '必须能看到沿世界路径分布的数团侧光尾烟，而非只画线段');
  assert(stamps.some(s => new Set(s.pixels.map(p => p[2])).size >= 3 && s.pixels.length < s.width * s.height), '烟团应有亮面、背光面与透明外缘');
  assert(puffs[0][3] > puffs.at(-1)[3] * 2 && puffs[0][3] < 52, '近团有透视但不能遮满画面');
  assert(puffs.every(c => c[5] > 0 && c[5] < 0.88), '烟不能成为不透明的圆盘');
  const count = stamps.length; calls.length = 0; drawEffects();
  assert.equal(stamps.length, count, '同一画面不能重复生成烟纹');
  assert.deepEqual(calls.filter(c => c[0] === 'stamp'), puffs, '冻结时不能闪烁或更换烟团');
});

test('烟带接头不叠圆端光斑，同一世界路径的老烟透灰而非长条亮尺', () => {
  const { G, calls, drawEffects } = wingRuntime();
  G.missileTrails = [{ points: Array.from({length: 10}, (_, i) => ({
    pos: { x: -5 + i * 1.7, y: 2, z: -23 - i * 7 }, life: 0.46 + i * 0.14,
  })) }];
  drawEffects(); const paint = calls.filter(c => c[0] === 'stroke');
  assert(paint.length >= 9, '尾烟冷却后仍能读出路径');
  assert(paint.every(c => c[3] === 'butt'), '不能在每个采样接头叠一颗圆头亮斑');
  assert(Math.max(...paint.map(c => c[2])) < 9, '不得再让近段变成近半架机身宽的直尺');
  assert(!new Set(paint.slice(0, 2).map(c => c[4])).has(paint.at(-1)[4]), '新烟与老烟不能全程同色发亮');
  assert(paint[0][1] < paint.at(-1)[1] * 0.4, '老烟必须淡出而非横贯前景');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const core = readFileSync(new URL('../src/10_core.js', import.meta.url), 'utf8');
const game = readFileSync(new URL('../src/40_game.js', import.meta.url), 'utf8');
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
    drawImage(image, x, y, w, h) { calls.push(['stamp', x, y, w, h, this.globalAlpha]); },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const { G, buildCamera, drawVaporPoints, drawEffects } = vm.runInNewContext(
    `${math}\n${matrices}\n${game}\n${hud}\n({ G, buildCamera, drawVaporPoints, drawEffects })`,
    { VW: 604, VH: 340, UI_DPR: 1, ctx, document, TAU: Math.PI * 2, AudioSys: {} },
  );
  G.camera = buildCamera({ pos: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, fov: 1 });
  return { G, drawVaporPoints, drawEffects, calls, stamps };
}

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

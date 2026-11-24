// 真实 HUD 源码：机身后方的焦痕/特效/地面阴影必须按机体实际屏幕轮廓挖空，
// 而不是整团丢弃、也不是只挖一个比机身小的椭圆；无 Path2D 的环境退回整团绘制。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const hud = readFileSync(new URL('../src/50_ui_hud.js', import.meta.url), 'utf8');

function fixture({ view = 0, cockpitAlpha = 0, playerZ = 0, decalPos = { x: 8, y: 0, z: 2 }, roll = 0, path2d = true } = {}) {
  const clips = [], ellipses = [], paths = [];
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get: (target, name) => {
      if (name === 'clip') return (...args) => clips.push(args.map(v => typeof v === 'object' && v ? 'path' : v));
      if (name === 'ellipse') return (...args) => ellipses.push(args);
      return name in target ? target[name] : () => {};
    },
    set: (target, name, value) => { target[name] = value; return true; },
  });
  class FakePath2D {
    constructor() { this.ops = []; paths.push(this); }
    rect(...args) { this.ops.push(['rect', ...args]); }
    moveTo(...args) { this.ops.push(['moveTo', ...args]); }
    lineTo(...args) { this.ops.push(['lineTo', ...args]); }
    closePath() { this.ops.push(['closePath']); }
  }
  const cos = Math.cos(roll), sin = Math.sin(roll);
  const b = {
    fwd: { x: sin, y: 0, z: -cos }, right: { x: cos, y: 0, z: sin }, up: { x: 0, y: 1, z: 0 },
  };
  // 俯视正交投影：世界 x/z 到屏幕 x/y（1 米 = 10 像素），越高的点离相机越近。
  const context = vm.createContext({
    ctx, VW: 604, VH: 340, TAU: Math.PI * 2, clamp01: v => Math.max(0, Math.min(1, v)),
    ...(path2d ? { Path2D: FakePath2D } : {}),
    projectToScreen: (p, out) => { out.x = 302 + p.x * 10; out.y = 170 + p.z * 10; out.dist = out.w = 60 - p.y / 10; out.visible = true; return true; },
    screenPixelPerMetre: () => 4,
    vadd: (a, c) => ({ x: a.x + c.x, y: a.y + c.y, z: a.z + c.z }),
    vmul: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
    G: {
      time: 1, mode: 'play', view, viewBlend: 1, cockpitAlpha,
      player: { dead: false, pos: { x: 0, y: 100, z: playerZ }, basis: b, renderBasis: b },
      decals: [{ pos: decalPos, size: 12, life: 5, maxLife: 5 }],
      effects: [], ground: [], enemies: [], missiles: [], popups: [],
    },
    INPUT: { mx: 302, my: 170, mouseSteerAge: 1, touchMode: false, keys: new Set() }, TOUCH: { active: false },
  });
  vm.runInContext(hud, context);
  return { context, clips, ellipses, paths };
}

test('机翼投影内被判定为遮挡：固定小椭圆盖不到的翼尖外侧也挖空', () => {
  const f = fixture();
  // 左侧翼尖附近；旧的 5.6px/m 椭圆在 4px/m 下只有约 22 像素半径，盖不住这里。
  assert.equal(vm.runInContext('playerScreenCovers({ x: 302 - 4.0 * 10, y: 170 + 2.0 * 10 }, 55)', f.context), true, '翼下投影仍被当成未遮挡');
  assert.equal(vm.runInContext('playerScreenCovers({ x: 302 + 30 * 10, y: 170 + 30 * 10 }, 60)', f.context), false, '机体外的点被误判为遮挡');
});

test('后方焦痕按机鼻、双翼尖、机尾的投影挖空', () => {
  const f = fixture();
  vm.runInContext('drawScorchDecals()', f.context);
  assert.equal(f.clips.length, 1, '焦痕未走裁剪路径');
  assert.deepEqual(f.clips[0], ['path', 'evenodd'], '裁剪未使用 evenodd 挖空');
  const ops = f.paths[0].ops;
  assert.equal(ops.filter(op => op[0] === 'lineTo').length, 3, '挖空轮廓应由四端点连成闭合折线');
  assert.equal(ops.filter(op => op[0] === 'moveTo').length, 1, '挖空轮廓缺少起点');
  assert(ops.some(op => op[0] === 'rect'), '裁剪路径缺少整屏外框');
});

test('滚转后轮廓跟着机翼转向，屏幕落点改变', () => {
  const straight = fixture(), rolled = fixture({ roll: Math.PI / 3 });
  const x = 302 - 4.0 * 10, y = 170 + 2.0 * 10;
  assert.equal(vm.runInContext(`playerScreenCovers({ x: ${x}, y: ${y} }, 55)`, straight.context), true);
  assert.equal(vm.runInContext(`playerScreenCovers({ x: ${x}, y: ${y} }, 55)`, rolled.context), false, '轮廓没有跟随滚转');
});

test('位于机身前方的焦痕不被挖空', () => {
  const f = fixture({ decalPos: { x: 8, y: 120, z: -6 } });
  vm.runInContext('drawScorchDecals()', f.context);
  assert.equal(f.clips.length, 0, '机身前方的焦痕被误挖空');
  assert(f.ellipses.length >= 2, '焦痕没有实际绘制');
});

test('座舱视角不裁剪世界覆盖层', () => {
  const f = fixture({ view: 2, cockpitAlpha: 1 });
  vm.runInContext('drawScorchDecals()', f.context);
  assert.equal(f.clips.length, 0, '座舱视角仍在裁剪');
});

test('没有 Path2D 的环境退回整团绘制而不是留洞', () => {
  const f = fixture({ path2d: false });
  vm.runInContext('drawScorchDecals()', f.context);
  assert.equal(f.clips.length, 0, '缺少 Path2D 时不应调用 clip');
  assert(f.ellipses.length >= 2, '缺少 Path2D 时焦痕被丢弃');
});

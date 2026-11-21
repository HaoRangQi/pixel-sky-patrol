// 默认追尾必须实际调用完整飞行HUD，不能只留下左上角状态文字。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

function fixture() {
  const calls = [], text = [];
  const ctx = new Proxy({ globalAlpha: 1 }, { get: (o, k) => k in o ? o[k] : () => {} });
  const context = vm.createContext({ ctx, VW: 558, VH: 340, cssRect: { height: 1020 }, TAU: Math.PI * 2, SKY_PHOSPHOR: '#b8ded2',
    G: { mode: 'play', view: 1, viewBlend: 1, cockpitAlpha: 0, wave: 1, waveKills: 0, waveTotal: 4, score: 0, missionTime: 3,
      player: { yaw: 0, roll: 0, speed: 112, pos: { y: 640 }, agl: 620, basis: { fwd: { y: 0 } }, gLoad: 1,
        fuel: 100, shield: 100, missiles: 4, reloads: [], flares: 3, flareCd: 0, gunCd: 0 }, camera: {}, lock: { phase: 'search' } },
    INPUT: { mx: 279, my: 170, mouseSteerAge: 1, touchMode: false, keys: new Set() }, TOUCH: { active: false },
    MOUSE_STEER_TIMEOUT: .42, MISSILE_RELOAD: 4.5, DEG: Math.PI / 180, flightMode: 'intercept', compassDeg: () => 0,
    fmtTime: () => '00:03', wrapAngle: a => Math.atan2(Math.sin(a), Math.cos(a)),
    pad: (v, n) => String(v).padStart(n, '0'), clamp01: v => Math.max(0, Math.min(1, v)),
  });
  vm.runInContext(read('src/50_ui_hud.js'), context);
  const cockpit = read('sky-patrol/54_cockpit.js');
  vm.runInContext(cockpit.slice(cockpit.indexOf('function skySystemReadings'), cockpit.indexOf('function skySystemRow')), context);
  vm.runInContext(read('sky-patrol/55_ui.js'), context);
  for (const name of ['drawPitchLadder', 'drawObjectivesPanel', 'drawScorePanel', 'drawSpeedAlt', 'drawShieldFuel',
    'drawWeaponPips', 'drawMiniRadar', 'drawTargetMarkers', 'drawAimReticle', 'drawThreats', 'drawWarnings',
    'drawMousePip', 'drawRadarScope', 'drawMissilePip', 'segBar', 'line', 'rect', 'panel']) context[name] = (...args) => calls.push({ name, args });
  context.drawText = (value, x, y, options = {}) => text.push({ value: String(value), x, y, ...options });
  return { context, calls, text, draw: () => vm.runInContext('drawHUD()', context) };
}

test('新版默认截击追尾恢复初始版完整飞行HUD，而非左上角微型监控', () => {
  const f = fixture(); f.draw();
  for (const name of ['drawPitchLadder', 'drawObjectivesPanel', 'drawScorePanel', 'drawSpeedAlt', 'drawShieldFuel', 'drawWeaponPips', 'drawMiniRadar'])
    assert.equal(f.calls.filter(c => c.name === name).length, 1, `实际HUD没有绘制${name}`);
  for (const name of ['drawTargetMarkers', 'drawAimReticle', 'drawThreats'])
    assert.equal(f.calls.filter(c => c.name === name).length, 1, `恢复仪表不能删除${name}`);
});

test('座舱不叠加外置任务、空速高度、资源、武器与雷达面板', () => {
  const f = fixture(); Object.assign(f.context.G, { view: 2, cockpitAlpha: 1 }); f.draw();
  for (const name of ['drawObjectivesPanel', 'drawScorePanel', 'drawSpeedAlt', 'drawShieldFuel', 'drawWeaponPips', 'drawMiniRadar'])
    assert(!f.calls.some(c => c.name === name), `座舱重复叠加${name}`);
  assert(f.calls.some(c => c.name === 'drawTargetMarkers'));
  assert(f.calls.some(c => c.name === 'drawThreats'));
});

test('完整追尾HUD的固定面板参与目标避让，不能让目标标签穿过仪表', () => {
  const f = fixture();
  for (const [x, y] of [[50, 35], [50, 95], [50, 140], [510, 25], [510, 140], [514, 296], [279, 318]])
    assert(vm.runInContext(`hudBlocked(${x},${y})`, f.context), `仪表区域${x},${y}未加入避让`);
  assert.equal(vm.runInContext('hudBlocked(279,190)', f.context), false, '中央锁定区域不能被整片屏蔽');
});

for (const [width, height] of [[187, 662], [986, 277]]) {
  test(`紧凑HUD ${width}×340的武器读数保留底部安全边距`, () => {
    const f = fixture(); f.context.VW = width; f.context.cssRect.height = height; f.draw();
    for (const value of ['导弹', '干扰', '3', '4/4']) {
      const t = f.text.find(t => t.value === value);
      assert(t, `没有绘制${value}`);
      assert(t.y + t.size * .25 <= 336, `${value}的字身仍贴边或被裁切：${t.y}`);
    }
    for (const c of f.calls.filter(c => c.name === 'panel')) {
      const [x, y, w, h] = c.args;
      assert(x >= 0 && y >= 0 && x + w <= width && y + h <= 340, '紧凑面板越过画布');
    }
  });
}

test('竖屏顶部航向框不被任务与得分面板盖住', () => {
  const f = fixture(); f.context.VW = 187; f.context.cssRect.height = 662; f.draw();
  const heading = f.calls.find(c => c.name === 'panel' && c.args[1] === 8).args;
  assert(heading[0] >= 75 && heading[0] + heading[2] <= 112, `航向框与任务/得分重叠：${heading}`);
});

test('宽屏待发武器不重复画两行相同库存，有冷却时显示倒计时', () => {
  const f = fixture(); f.draw();
  assert(!f.text.some(t => t.value === '4/4' || t.value === '3'), '初版武器图标已带库存，不应在下方再重复一遍');
  Object.assign(f.context.G.player, { missiles: 3, reloads: [3.2], flares: 2, flareCd: 7 });
  f.text.length = 0; f.draw();
  assert(f.text.some(t => t.value === '3/4 · 4s'));
  assert(f.text.some(t => t.value === '2 · 7s'));
});

test('短横屏圆雷达不压住升降率和G读数', () => {
  const f = fixture(); f.context.VW = 986; f.context.cssRect.height = 277;
  const l = vm.runInContext('skyFlightLayout()', f.context);
  assert(l.radar.y - l.radar.r > l.speedY + 60 * l.s + 4, '圆雷达侵入G读数字身');
});

test('紧凑武器栏多发后只显示下一枚的真实装填进度', () => {
  const f = fixture(); f.context.VW = 187;
  Object.assign(f.context.G.player, { missiles: 2, reloads: [1.8, 3.2] });
  vm.runInContext('skyWeaponStatus(true)', f.context);
  const pips = f.calls.filter(c => c.name === 'drawMissilePip').map(c => c.args);
  assert.equal(pips.length, 4);
  assert.deepEqual(pips.map(p => p[2]), [true, true, false, false]);
  assert.equal(pips[0][3], 0); assert.equal(pips[1][3], 0);
  assert(Math.abs(pips[2][3] - .6) < 1e-9);
  assert.equal(pips[3][3], 0, '尚未轮到的空槽不能伪造相同装填进度');
});

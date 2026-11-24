// 默认追尾必须实际调用完整飞行HUD，不能只留下左上角状态文字。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

function fixture() {
  const calls = [], text = [];
  const ctx = new Proxy({ globalAlpha: 1 }, { get: (o, k) => k in o ? o[k] : () => {} });
  const context = vm.createContext({ ctx, VW: 558, VH: 340, cssRect: { height: 1020 }, TAU: Math.PI * 2, SKY_PHOSPHOR: '#b8ded2', PAL: { goldHot: '#ffe39a' },
    G: { mode: 'play', view: 1, viewBlend: 1, cockpitAlpha: 0, wave: 1, waveKills: 0, waveTotal: 4, score: 0, missionTime: 3, enemies: [], ground: [],
      player: { yaw: 0, roll: 0, speed: 112, pos: { y: 640 }, agl: 620, basis: { fwd: { y: 0 } }, gLoad: 1,
        fuel: 100, shield: 100, missiles: 4, reloads: [], flares: 3, flareCd: 0, gunCd: 0 }, camera: {}, lock: { phase: 'search' } },
    INPUT: { mx: 279, my: 170, mouseSteerAge: 1, touchMode: false, keys: new Set() }, TOUCH: { active: false },
    MOUSE_STEER_TIMEOUT: .42, MISSILE_RELOAD: 4.5, DEG: Math.PI / 180, flightMode: 'intercept', compassDeg: () => 0,
    fmtTime: () => '00:03', wrapAngle: a => Math.atan2(Math.sin(a), Math.cos(a)),
    projectTargetMarker: () => false, // 此夹具只检查面板；真实目标投影另有完整飞行回归。
    textWidth: (value, size) => [...value].reduce((w, c) => w + size * (/[㐀-鿿]/.test(c) ? 1 : .6), 0),
    pad: (v, n) => String(v).padStart(n, '0'), clamp01: v => Math.max(0, Math.min(1, v)),
  });
  vm.runInContext(read('src/50_ui_hud.js'), context);
  const paintObjectives = context.drawObjectivesPanel;
  vm.runInContext(read('sky-patrol/54_cockpit.js'), context);
  vm.runInContext(read('sky-patrol/55_ui.js'), context);
  for (const name of ['drawPitchLadder', 'drawObjectivesPanel', 'drawScorePanel', 'drawSpeedAlt', 'drawShieldFuel',
    'drawWeaponPips', 'drawMiniRadar', 'drawTargetMarkers', 'drawAimReticle', 'drawThreats', 'drawWarnings',
    'drawMousePip', 'drawRadarScope', 'drawMissilePip', 'segBar', 'line', 'rect', 'panel']) context[name] = (...args) => calls.push({ name, args });
  context.drawText = (value, x, y, options = {}) => text.push({ value: String(value), x, y, ...options });
  return { context, calls, text, paintObjectives, draw: () => vm.runInContext('drawHUD()', context) };
}

for (const [width, height, compact] of [[625, 738, false], [187, 662, true], [986, 277, true]]) {
  test(`截击 ${width}×${height} 的任务仪表显示当前波和三波终点`, () => {
    const f = fixture();
    Object.assign(f.context, { VW: width, cssRect: { height } });
    f.context.drawObjectivesPanel = f.paintObjectives;
    Object.assign(f.context.G, { missionWaveGoal: 3, wave: 2, waveKills: 1, waveTotal: 5 });
    f.draw();
    const wave = f.text.find(t => t.value === (compact ? '第 2/3 波' : '第 02/03 波'));
    const kill = f.text.find(t => compact ? t.value === '目标 1/5' : t.value === '1/5');
    assert(wave && kill, '总波数和本波战果均应可见');
    const onSeparateRows = wave.y + wave.size * .25 < kill.y - kill.size;
    const sideBySide = wave.x + wave.value.length * wave.size < kill.x - kill.value.length * kill.size;
    assert(onSeparateRows || sideBySide, '波次和战果须各有占位');
    if (width < 420) {
      assert.equal(wave.size, 8, '保留窄屏仪表字号');
      assert(wave.x + wave.value.length * wave.size < 74, '波次须留在左上仪表');
    }
    f.context.G.wave = 3;
    f.context.G.banner = { t: 1, life: 3.4, title: '第 03 波' };
    f.text.length = 0;
    f.draw();
    assert(f.text.filter(t => t.value === (compact ? '第 3/3 波' : '第 03/03 波')).length >= 2, '第三波的仪表和入场横幅都报最后一波');
    f.context.G.missionWaveGoal = 0;
    f.text.length = 0;
    f.draw();
    assert(f.text.some(t => t.value === '第 03 波') && !f.text.some(t => /第 .+\/.+ 波/.test(t.value)), '无尽模式只显示当前波');
    f.context.flightMode = 'free';
    f.context.G.banner.title = '自由巡航';
    f.text.length = 0;
    f.draw();
    assert(f.text.some(t => t.value === '自由巡航') && !f.text.some(t => /^第 .* 波/.test(t.value)), '巡航保留航线提示');
  });
}

test('守卫湖谷任务仪表显示关名、空中进度与待落地装甲，继续挑战恢复无尽波次', () => {
  const f = fixture(), g = f.context.G;
  f.context.drawObjectivesPanel = f.paintObjectives;
  Object.assign(g, { missionWaveGoal: 3, wave: 3, waveKills: 1, waveTotal: 6, defenseStage: { title: '空投突袭', air: ['transport'] } });
  const carrier = { cargoRemaining: 2, dead: false };
  g.enemies.push(carrier);
  function checkArmor(expected) {
    for (const [width, height] of [[625, 738], [187, 662], [986, 277]]) {
      f.context.VW = width;
      f.context.cssRect.height = height;
      f.text.length = 0;
      f.draw();
      for (const label of ['空投突袭', '第 3/3 关', `装甲 ${expected}`])
        assert(f.text.some(t => t.value === label), `${width}×${height} 未显示 ${label}`);
      assert(f.text.some(t => ['1/6', '空中 1/6'].includes(t.value)));
    }
  }
  checkArmor('待空投');
  g.ground.push({ airdrop: {}, dead: false });
  checkArmor('剩余 1');
  carrier.cargoRemaining = 0;
  g.ground[0].dead = true;
  checkArmor('已清除');

  Object.assign(g, { wave: 4, missionWaveGoal: 0, defenseStage: { title: '迎击增援', air: ['fighter'] }, banner: { t: 1, life: 3.4 } });
  f.text.length = 0;
  f.draw();
  assert(f.text.some(t => t.value === '第 04 波') && f.text.some(t => t.value === '第 04 波 · 迎击增援'));
  assert(!f.text.some(t => /^装甲 |\/0 关/.test(t.value)));
});

test('新版保盾附加目标等待本波结算，已经达成的击杀目标仍显示完成', () => {
  const f = fixture(), g = f.context.G;
  const game = read('src/40_game.js');
  vm.runInContext(game.slice(game.indexOf('function isSecondaryComplete()'), game.indexOf('// --------------------------------------------------------------- frame')), f.context);
  f.context.drawObjectivesPanel = f.paintObjectives;
  Object.assign(g, { view: 0, wave: 3, missionWaveGoal: 3, secondary: { type: 'shield', need: 63 }, secondaryDone: false });
  g.player.flightComfort = true;
  const secondary = () => {
    f.text.length = 0;
    f.draw();
    const line = f.text.find(t => t.value.startsWith('附加'));
    return [line.value, line.color];
  };

  assert.deepEqual(secondary(), ['附加  保持 63% 护盾', '#cdb57f'], '开战时护盾达标仍属于待结算目标');
  g.mode = 'waveclear';
  assert.deepEqual(secondary(), ['附加  保持 63% 护盾', '#cdb57f'], '补给后回升的护盾不能改变结算');
  g.secondaryDone = true;
  assert.deepEqual(secondary(), ['附加完成  保持 63% 护盾', '#bce7a0']);

  g.mode = 'play';
  g.secondaryDone = false;
  g.secondary = { type: 'sam', killed: 2, need: 2 };
  assert.deepEqual(secondary(), ['附加完成  2/2 防空阵地', '#bce7a0']);
  g.secondary = { type: 'low', done: true };
  assert.deepEqual(secondary(), ['附加完成  低空击杀：完成', '#bce7a0']);

  delete g.player.flightComfort;
  g.missionWaveGoal = 0;
  g.secondary = { type: 'shield', need: 63 };
  assert.deepEqual(secondary(), ['附加完成  保持 63% 护盾', '#bce7a0'], '根入口保留实时护盾附加反馈');
});

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

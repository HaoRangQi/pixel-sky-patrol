import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + 1));
const measure = (value, size) => [...String(value)].reduce((width, char) => width + size * (/[㐀-鿿]/.test(char) ? 1 : .62), 0);
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const bounds = t => ({ x: t.x - measure(t.value, t.size) / 2, y: t.y - t.size, w: measure(t.value, t.size), h: t.size + 3 });

function fixture(width = 1358, height = 738) {
  const text = [], panels = [], lines = [], symbols = [];
  const ctx = new Proxy({ globalAlpha: 1, fill() { symbols.push(['polygon', this.fillStyle]); },
    arc(...args) { symbols.push(['arc', ...args]); } }, { get: (o, k) => k in o ? o[k] : () => {} });
  const game = read('src/40_game.js'), combat = read('src/42_combat.js');
  const p = { pos: { x: 0, y: 700, z: 0 }, yaw: 0, flightComfort: true, gLoad: 1,
    speed: 1320 / 1.94384, burnSpeed: 1500 / 1.94384, roll: 0, pitch: 0, agl: 700, groundH: 0,
    fuel: 100, shield: 100, missiles: 4, flares: 3, reloads: [], flareCd: 0, gunCd: 0 };
  const context = vm.createContext({ ctx, VW: 340 * width / height, VH: 340, cssRect: { height }, TAU: Math.PI * 2, DEG: Math.PI / 180,
    G: { mode: 'play', view: 2, viewBlend: 1, cockpitAlpha: 1, realTime: 1, player: p, enemies: [], ground: [], threatList: [],
      lock: { target: null, phase: 'search', progress: 0 }, map: { heightAt: () => 0, cloudDensity: () => 0 } },
    PAL: { goldHot: '#ffe39a' }, DRONE_MAX_HP: 100, flightMode: 'intercept', MOUSE_STEER_TIMEOUT: .42,
    INPUT: { mx: 0, my: 0, mouseSteerAge: Infinity, touchMode: true, keys: new Set() }, TOUCH: { active: false },
    pad: (v, n) => String(v).padStart(n, '0'), textWidth: measure,
    circleLine: (x, y, r, color) => symbols.push(['ring', x, y, r, color]),
    circleFill: (_x, _y, _r, color) => symbols.push(['circle', color]), compassDeg: () => 0,
  });
  const run = code => vm.runInContext(code, context);
  run(section(read('src/10_core.js'), 'const clamp =', '// Bayer 4x4'));
  run(section(game, 'function computePose(', 'function blendCameraPose('));
  run(section(game, 'function projectToScreen(', '// ----------------------------------------------------------- flight'));
  run(section(combat, 'function collectTargets(', 'function updateLockOn('));
  for (const file of ['src/50_ui_hud.js', 'sky-patrol/54_cockpit.js', 'sky-patrol/55_ui.js']) run(read(file));
  const seatRadar = context.skyMapGlass;
  Object.assign(context, {
    drawPitchLadder() {}, skyMapGlass() {},
    drawText: (value, x, y, opts = {}) => text.push({ value: String(value), x, y, ...opts }),
    rect: (x, y, w, h, color) => panels.push({ x, y, w, h, color }),
    panel: (x, y, w, h, opts) => panels.push({ x, y, w, h, ...opts }),
    rectLine: (_x, _y, w, h, color) => symbols.push([`outline${w}x${h}`, color]), line: (...args) => lines.push(args),
  });
  run('G.player.basis = G.player.renderBasis = basisFrom(0,0,0); G.camera = buildCamera(computePose(2));');
  return {
    G: context.G, p, context, text, panels, lines, symbols, seatRadar, run,
    add(x, altitude, z) {
      const enemy = { kind: 'drone', hp: 100, pos: { x, y: p.pos.y + altitude, z } };
      context.G.enemies.push(enemy);
      return enemy;
    },
    draw(code = 'drawHUD()') { text.length = panels.length = lines.length = symbols.length = 0; run(code); },
  };
}

test('座舱枪瞄上移16像素，姿态梯和空速高度窗保持原位', () => {
  const f = fixture();
  f.p.gunSightOffset = 16;
  f.draw('skyGlass(G.player, 0, 0)');
  const sight = f.symbols.find(s => s[0] === 'ring' && s[3] === 2.5);
  assert.equal(sight[2], 154);
  const readout = f.text.find(t => t.value === '1320');
  assert(readout && readout.y === 155);
});

test('新版锁定目标圈最大半径不超过21像素，不能再用40像素外扩回声遮住敌机', () => {
  const f = fixture();
  f.p.lockRadius = 38;
  const enemy = f.add(0, 10, -700);
  f.G.lock = { target: enemy, phase: 'locked', progress: 1 };
  f.draw('drawTargetMarkers()');
  const arcs = f.symbols.filter(s => s[0] === 'arc');
  assert(arcs.length > 0);
  assert(arcs.every(s => s[3] <= 21), `锁圈实际半径：${arcs.map(s => s[3]).join(',')}`);
});

for (const [width, height] of [[1358, 738], [366, 662], [818, 277]]) {
  test(`座舱 ${width}×${height} 对后方原目标只显示一个可读追踪提示`, () => {
    const f = fixture(width, height);
    f.G.banner = { t: 1, life: 3, title: '第 01 波' };
    f.G.threatList = [{ ang: 0.5, d: 650 }];
    f.run('SKY_OCCLUSION.push({ x: VW - 72, y: 21, w: 72, h: 83 });');
    f.add(-100, 50, -450);
    f.p.trackedAirTarget = f.add(680, -220, 1710);
    f.draw();
    const notices = f.text.filter(t => /^(跟踪|锁定中|已锁定)/.test(t.value));
    assert.equal(notices.length, 1, '舱外同一架敌机应有一个提示');
    const notice = notices[0];
    assert.match(notice.value, /跟踪.*后.*低.*1\.9 km/, '继续跟踪之前的后方低位敌机');
    assert.notEqual(notice.color, '#ffe39a');
    assert(notice.size * height / 340 >= 14 - 1e-6);
    const bounds = { x: notice.x - measure(notice.value, notice.size) / 2, y: notice.y - notice.size,
      w: measure(notice.value, notice.size), h: notice.size * 1.25 };
    assert(bounds.x > 0 && bounds.x + bounds.w < f.context.VW);
    assert(bounds.y > 40 && bounds.y + bounds.h < (width / height * 340 < 415 ? 217 : 241));
    for (const t of f.text.filter(t => t.value === '导弹来袭' || t.value === '第 01 波'))
      assert(bounds.y > t.y + 4 || bounds.y + bounds.h < t.y - t.size, `该追踪提示不能挡住${t.value}`);
    assert.equal(f.G.lock.phase, 'search');
  });
}

test('低于风挡的敌机保留追踪提示，云层、地形和死亡使追踪失效', () => {
  const f = fixture();
  const enemy = f.add(0, -220, -700);
  f.p.trackedAirTarget = enemy;
  f.draw();
  assert(f.text.some(t => /跟踪.*低.*73\d m/.test(t.value)));
  assert(!f.text.some(t => t.value === '敌机'), '风挡下只显示追踪提示');
  f.G.map.cloudDensity = () => 1;
  f.draw();
  assert(!f.text.some(t => /^(跟踪|锁定)/.test(t.value)));
  f.G.map.cloudDensity = () => 0;
  f.G.map.heightAt = () => 800;
  f.draw();
  assert(!f.text.some(t => /^(跟踪|锁定)/.test(t.value)));
  f.G.map.heightAt = () => 0;
  enemy.dead = true;
  f.draw();
  assert(!f.text.some(t => /^(跟踪|锁定)/.test(t.value)));
});

test('竖屏追踪备用位在准星下，保留1500节、四位高度、G/RA及告警', () => {
  const f = fixture(366, 662);
  Object.assign(f.p, { speed: 1500 / 1.94384, pos: { x: 0, y: 2400, z: 0 }, agl: 70, gLoad: 6.5,
    fuel: 12, shield: 20, terrainWarn: true });
  f.G.realTime = .1;
  f.G.threatList = [{ ang: 0.5, d: 650 }];
  f.p.trackedAirTarget = f.add(680, -220, 1710);
  f.run('SKY_OCCLUSION.push({ x: VW - 72, y: 21, w: 72, h: 83 });');
  f.draw('skyGlass(G.player, 0, 0); drawHUD();');
  const tracking = f.panels.find(p => p.fill === '#18252e');
  assert(tracking && tracking.y >= f.context.VH / 2 + 6, '遮挡时将追踪提示锚在准星下方');
  assert(tracking.y + tracking.h <= 217);
  const readouts = f.panels.filter(p => p.color === '#2e3e34');
  assert.equal(readouts.length, 2);
  for (const readout of readouts) assert(!overlaps(tracking, readout), '追踪提示不应挡住玻璃主数字窗');
  for (const label of ['1500', '7874', 'G 6.5', 'RA 7874', '导弹来袭', '护盾告急', '燃油告急', '拉起！', '低空']) {
    const readout = f.text.find(t => t.value === label);
    assert(readout, `保留${label}读数`);
    const w = measure(readout.value, readout.size);
    assert(!overlaps(tracking, { x: readout.x - w / 2, y: readout.y - readout.size, w, h: readout.size * 1.25 }), `追踪提示不应挡住${label}`);
  }
});

test('旧敌机保持浅灰追踪，新目标独立显示淡蓝进度，锁定完成后交接', () => {
  const f = fixture();
  const prior = f.add(680, -220, 1710), candidate = f.add(0, 15, -680);
  f.p.trackedAirTarget = prior;
  f.G.lock = { target: candidate, phase: 'locking', progress: .42 };
  f.draw();
  assert(f.text.some(t => /^跟踪.*右后.*1\.9 km$/.test(t.value) && t.color === '#e4e9e5'));
  assert(f.text.some(t => t.value === '锁定中 42%' && t.color === '#b9ddff'));
  assert(!f.text.some(t => t.value.startsWith('已锁定')));
  f.G.lock.phase = 'locked';
  f.G.lock.progress = 1;
  f.draw();
  assert(f.text.some(t => /^已锁定.*正前.*680 m$/.test(t.value) && t.color === '#ffe39a'));
  assert(!f.text.some(t => t.value.startsWith('跟踪')));
});

test('座舱提示、可见框和追尾锁定文字按真实状态切换淡蓝／金色', () => {
  const f = fixture();
  const enemy = f.add(0, 15, -680);
  for (const [phase, progress, label, color] of [['locking', .42, '锁定中 42%', '#b9ddff'], ['locked', 1, '已锁定', '#ffe39a']]) {
    f.G.lock = { target: enemy, phase, progress };
    f.G.view = 2; f.G.cockpitAlpha = 1;
    f.draw();
    const cue = f.text.filter(t => t.value.startsWith(label));
    assert.equal(cue.length, 1);
    assert.equal(cue[0].color, color);
    f.G.view = 1; f.G.cockpitAlpha = 0;
    f.draw('drawTargetMarkers(SKY_LOCKING_COLOR)');
    assert(f.text.some(t => t.value === label && t.color === color));
  }
});

test('四位数座舱空速保留完整的数字窗，指针按1500节量程显示1320节', () => {
  const f = fixture(818, 277);
  f.draw('skyCockpitPanel(G.player, 0, 0)');
  const number = f.text.find(t => t.value === '1320');
  assert(number && f.text.some(t => t.value === 'KT/1500'));
  const needle = f.lines.find(l => l[4] === '#e8d6a4' && l[5] === 1.4);
  const angle = Math.atan2(needle[3] - needle[1], needle[2] - needle[0]) / f.context.DEG;
  assert(Math.abs(((angle - 140 + 360) % 360) / 260 - .88) < 1e-9);
  assert(f.panels.some(r => r.color === '#272831' && Math.abs(r.x + r.w / 2 - number.x) < .01 && r.w >= measure('1320', number.size) + 6));
  f.draw('skyGlass(G.player, 0, 0)');
  const headsUp = f.text.find(t => t.value === '1320');
  assert(headsUp.size * 277 / 340 >= 14 - 1e-6, '短横屏四位数空速应可直接辨读');
});

test('竖屏座舱入场横幅以完整字宽避让战斗面板，并与威胁和跟踪提示分开', () => {
  const f = fixture(366, 662), combatPanel = { x: 106, y: 33, w: 82, h: 54 };
  f.run(`SKY_OCCLUSION.push(${JSON.stringify(combatPanel)});`);
  Object.assign(f.G, { wave: 3, missionWaveGoal: 3, banner: { t: 1, life: 3.4, title: '第 03 波' }, threatList: [{ d: 640 }] });
  f.p.trackedAirTarget = f.add(400, -30, 620);
  for (const [stage, title] of [[null, '第 3/3 波'], [{ title: '空投突袭', air: ['transport'] }, '第 3/3 关 · 空投突袭']]) {
    f.G.defenseStage = stage;
    f.draw();
    const banner = f.text.find(t => t.value === title);
    assert(banner, `显示完整的${title}`);
    assert(!overlaps(bounds(banner), combatPanel), '面板从横幅中心右侧开始也不能遮掉任何字');
    for (const t of f.text.filter(t => /跟踪|导弹来袭/.test(t.value))) assert(!overlaps(bounds(banner), bounds(t)));
  }
});

test('空域清除后，三视角直接提示最近待清装甲的方向和距离', () => {
  const f = fixture(366, 662);
  Object.assign(f.G, { wave: 3, waveKills: 6, waveTotal: 6, waveSpawned: 6, missionWaveGoal: 3, score: 0, missionTime: 23,
    defenseStage: { title: '空投突袭', air: ['transport'] } });
  Object.assign(f.context, { MISSILE_RELOAD: 4.5, fmtTime: () => '00:23', drawRadarScope() {} });
  const drop = { kind: 'vehicle', type: 'vehicle', isGround: true, pos: { x: 100, y: 150, z: 3850 }, airdrop: {} };
  f.G.ground.push(drop,
    { kind: 'vehicle', type: 'vehicle', isGround: true, pos: { x: 160, y: 45, z: -5200 } },
    { kind: 'vehicle', type: 'vehicle', isGround: true, pos: { x: 0, y: 0, z: 200 }, dead: true });
  f.G.map.heightAt = () => 800;
  for (const view of [0, 1, 2]) {
    Object.assign(f.G, { view, cockpitAlpha: view === 2 ? 1 : 0 });
    f.draw();
    assert(f.text.some(t => t.value === '装甲 · 正后 · 3.9 km'), `视角 ${view} 的超出火控距离装甲应有任务级方向与距离`);
    assert.equal(f.G.lock.target, null);
  }
  f.G.waveKills--;
  f.draw();
  assert(!f.text.some(t => t.value.startsWith('装甲 · ')), '有待拦截飞机时保留空中追踪优先级');
  f.G.waveKills++;
  f.G.ground[0].dead = true;
  f.draw();
  assert(f.text.some(t => t.value === '装甲 · 正前 · 5.2 km'));
});

test('运输机诱饵提示给出机炮操作，干扰结束后回到运输机追踪和正确耐久', () => {
  const f = fixture(366, 662);
  f.G.defenseStage = { title: '空投突袭', air: ['transport'] };
  const transport = Object.assign(f.add(0, 20, -740), { kind: 'transport', hp: 260, maxHp: 390, flareFlash: 1.2 });
  f.G.lock = { target: transport, phase: 'locked', progress: 1 };
  f.draw();
  assert(f.text.some(t => /诱饵.*机炮/.test(t.value)));
  assert(f.panels.some(p => Math.abs(p.w - 40 * (260 / 390)) < 1e-8 && p.h === 4), '耐久条显示真实的 260/390');
  transport.flareFlash = 0;
  f.draw();
  assert(!f.text.some(t => /诱饵/.test(t.value)));
  assert(f.text.some(t => /^已锁定 运输机 · 正前/.test(t.value) && t.color === '#ffe39a'));
});

test('有限干扰失败显示继续制导，新兵种与脱离预兆给出可执行提示', () => {
  const f = fixture(366, 662);
  f.G.defenseStage = { title: '战斗机入侵', air: ['fighter'] };
  const fighter = Object.assign(f.add(0, 20, -740), { kind: 'fighter', hp: 130, maxHp: 130,
    flares: 1, flareFlash: 1.2, flareOutcome: 'failed' });
  f.G.lock = { target: fighter, phase: 'locked', progress: 1 };
  f.draw();
  assert(f.text.some(t => /战斗机干扰失败.*剩1发.*导弹继续/.test(t.value)));
  fighter.flareFlash = 0; fighter.tacticPhase = 'warning';
  f.draw();
  assert(f.text.some(t => /战斗机准备脱离.*机炮咬住/.test(t.value) && t.color === '#ffdf9b'));
});

test('外置雷达和座舱地图用相同的四种符号区分无人机、战斗机、运输机和装甲', () => {
  const f = fixture(366, 662);
  Object.assign(f.G, { time: 1, missiles: [], defenseStage: { air: ['drone', 'fighter', 'transport'] } });
  Object.assign(f.context, { RADAR: { canvas: {} }, skyMapGlass: f.seatRadar, updateRadarMap() {} });
  f.add(-450, 0, 420);
  Object.assign(f.add(500, 0, 420), { kind: 'fighter' });
  Object.assign(f.add(400, 0, -520), { kind: 'transport' });
  f.G.ground.push({ kind: 'vehicle', type: 'vehicle', isGround: true, pos: { x: -500, y: 20, z: -420 }, airdrop: {} });
  for (const radar of ['drawRadarScope(46,50,30)', 'skyMapGlass(10,10,64,40,G.player)']) {
    f.draw(radar);
    assert(f.symbols.some(([shape, color]) => shape === 'circle' && color === '#ff8f84'), '无人机为圆点');
    assert(f.symbols.some(([shape, color]) => shape === 'polygon' && color === '#fff0cc'), '战斗机为三角形');
    assert(f.panels.some(p => p.w === 9 && p.h === 3 && p.color === '#ffd483'), '运输机为长条');
    assert(f.symbols.some(([shape, color]) => shape === 'outline5x5' && color === '#e1bdff'), '装甲为方框');
  }
});

function denseDefenseFixture(view) {
  const f = fixture();
  Object.assign(f.G, { view, cockpitAlpha: view === 2 ? 1 : 0, wave: 3, waveKills: 0, waveTotal: 6, missionWaveGoal: 3,
    highScore: 0, score: 0, missionTime: 61, defenseStage: { title: '空投突袭', air: ['transport', 'fighter', 'drone'] },
    banner: { title: '空投突袭', t: 1, life: 3.4 }, threatList: [{ d: 640 }] });
  Object.assign(f.context, { MISSILE_RELOAD: 4.5, fmtTime: () => '01:01', drawMiniRadar() {} });
  const transport = Object.assign(f.add(0, 10, -1100), { kind: 'transport', hp: 260, maxHp: 390, flareFlash: 1.2 });
  const near = Object.assign(f.add(-100, 30, -500), { kind: 'fighter', hp: 90, maxHp: 100 });
  const far = f.add(-400, 10, -850);
  const drop = { kind: 'vehicle', type: 'vehicle', isGround: true, pos: { x: 0, y: 695, z: -1115 }, airdrop: {} };
  f.G.ground.push(drop);
  f.G.lock = { target: transport, phase: 'locked', progress: 1 };

  const cx = Math.round(f.context.VW / 2), cy = f.context.VH / 2;
  const positions = new Map([[transport, [cx, cy - 2]], [drop, [cx + 1, cy - 4]], [near, [cx - 103, cy - 1]], [far, [cx - 198, cy + 4]]]);
  const brackets = [];
  f.context.projectTargetMarker = (_pos, screen, target) => {
    const [x, y] = positions.get(target);
    Object.assign(screen, { x, y, visible: true, edge: false });
    return true;
  };
  const bracket = f.context.drawBracket;
  f.context.drawBracket = (x, y, r, shape, ctx) => { brackets.push([x, y, shape]); bracket(x, y, r, shape, ctx); };
  return { ...f, positions, brackets, near, transport, cx, cy };
}

test('追尾第三关关名和警告独立，重叠空投目标保留框而当前锁定保留身份和距离', () => {
  const f = denseDefenseFixture(1);
  f.draw();
  const title = f.text.find(t => t.value === '第 3/3 关 · 空投突袭');
  const threat = f.text.find(t => t.value === '导弹来袭');
  const flare = f.text.find(t => /诱饵.*机炮/.test(t.value));
  assert(title && threat && flare);
  const contactText = f.text.filter(t => /^运输机$|^装甲$|^(已锁定|锁定中)|^战斗机|^无人机/.test(t.value));
  for (const label of contactText) {
    for (const message of [title, threat, flare]) assert(!overlaps(bounds(label), bounds(message)), `${label.value} 压住 ${message.value}`);
  }
  assert(contactText.some(t => /^已锁定 运输机.*1\.1 km/.test(t.value) && t.color === '#ffe39a'));
  assert(!contactText.some(t => /^装甲/.test(t.value)), '与锁圈重叠的空投车辆让出文字区域');
  assert(f.brackets.some(([x, , shape]) => x === f.cx + 1 && shape === 'square'), '装甲的标记框仍存在');
  assert(f.brackets.some(([, , shape]) => shape === 'diamond'), '火控锁圈仍存在');
});

test('座舱近空速和高度窗的非主目标文字不碰读数，当前锁定与远处标签保持可见', () => {
  const f = denseDefenseFixture(2);
  f.positions.set(f.near, [f.cx - 103, f.cy - 1]);
  const nearAltitude = f.add(100, -35, -600);
  f.positions.set(nearAltitude, [f.cx + 103, f.cy - 1]);
  f.draw('skyGlass(G.player, 0, 0); drawHUD();');
  const glass = f.panels.filter(p => p.color === '#2e3e34');
  const contactText = f.text.filter(t => /^(战斗机|无人机|已锁定)/.test(t.value) || ['511', '609', '940'].includes(t.value));
  assert.equal(glass.length, 2);
  for (const label of contactText) for (const box of glass) assert(!overlaps(bounds(label), box), `${label.value} 压住玻璃主数字窗`);
  assert(f.text.some(t => /^已锁定 运输机.*1\.1 km/.test(t.value)));
  assert(f.text.some(t => /^无人机/.test(t.value) && t.x < f.cx - 150), '远离仪表的目标仍有标注');
  assert(f.brackets.some(([x]) => x === f.cx - 103) && f.brackets.some(([x]) => x === f.cx + 103));
});

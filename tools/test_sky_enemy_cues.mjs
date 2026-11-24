import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const combat = read('src/42_combat.js');
const projection = combat.slice(combat.indexOf('function projectTargetMarker('), combat.indexOf('function updateLockOn('));
const locking = combat.slice(combat.indexOf('function updateLockOn('), combat.indexOf('// --------------------------------------------------------------- threats'));
const cockpit = read('sky-patrol/54_cockpit.js');
const readings = cockpit.slice(cockpit.indexOf('function skySystemReadings('), cockpit.indexOf('function skySystemRow('));
const measure = (value, size = 8) => [...String(value)].reduce((w, c) => w + size * (/[㐀-鿿]/.test(c) ? 1 : .62), 0);

function fixture(width, height, newer = true) {
  const text = [], arrows = [], targets = [];
  const state = { globalAlpha: 1, fillStyle: '#fff', x: 0, y: 0, angle: 0 }, stack = [];
  const ctx = new Proxy(state, {
    get: (o, name) => name in o ? o[name] : ({
      save: () => stack.push({ ...o }), restore: () => Object.assign(o, stack.pop()),
      translate: (x, y) => { o.x = x; o.y = y; }, rotate: angle => { o.angle = angle; },
      fill: () => arrows.push({ x: o.x, y: o.y, angle: o.angle, alpha: o.globalAlpha, color: o.fillStyle }),
    }[name] || (() => {})),
  });
  const context = vm.createContext({
    ctx, VW: 340 * width / height, VH: 340, cssRect: { height }, TAU: Math.PI * 2,
    G: { mode: 'play', view: 0, viewBlend: 1, cockpitAlpha: 0, realTime: 0, wave: 1,
      player: { pos: { x: 0, y: 600, z: 0 }, basis: { fwd: { x: 0, y: 0, z: -1 } },
        fuel: 100, shield: 100, missiles: 4, flares: 3, reloads: [], flareCd: 0, gunCd: 0 },
      camera: {}, lock: { target: null, phase: 'search', progress: 0, tick: 0 } },
    PAL: { goldHot: '#ffe39a' }, DRONE_MAX_HP: 100, LOCK_TIME: 1,
    INPUT: { mx: 0, my: 0, keys: new Set(), touchMode: true }, TOUCH: { active: false }, MISSILE_RELOAD: 4.5,
    flightMode: 'intercept', pad: (n, width) => String(n).padStart(width, '0'),
    compassDeg: () => 0, fmtTime: () => '00:00',
    AudioSys: { lockTone() {}, lockTick() {} }, lineOfSightClear: () => true,
    vdist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
    vsub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    vnorm: v => { const n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n }; },
    vdot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    clamp01: n => Math.max(0, Math.min(1, n)), clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
    textWidth: measure, drawText: (value, x, y, options = {}) => text.push({ value: String(value), x, y, ...options }),
    collectTargets: () => targets, targetConcealed: t => !!t.concealed, projectToScreen: () => false,
  });
  vm.runInContext(read('src/50_ui_hud.js'), context);
  vm.runInContext(projection, context);
  vm.runInContext(locking, context);
  vm.runInContext(readings, context);
  if (newer) vm.runInContext(read('sky-patrol/55_ui.js'), context);
  Object.assign(context, {
    drawText: (value, x, y, options = {}) => text.push({ value: String(value), x: x + state.x, y: y + state.y, ...options }),
    rect() {}, rectLine() {}, panel() {}, drawMissilePip() {},
    line() {}, drawObjectivesPanel() {}, drawScorePanel() {}, drawSpeedAlt() {}, drawShieldFuel() {}, drawMiniRadar() {},
    drawAimReticle() {}, drawThreats() {}, drawWarnings() {},
  });
  return {
    context, text, arrows, targets,
    add(angle, distance, overrides = {}) {
      const target = { kind: 'drone', hp: 100, pos: { x: Math.cos(angle) * distance, y: 600, z: Math.sin(angle) * distance }, ...overrides };
      targets.push(target); return target;
    },
    draw() { text.length = arrows.length = 0; vm.runInContext('drawTargetMarkers()', context); },
    blocked(x, y) { return vm.runInContext(`hudBlocked(${x},${y})`, context); },
    weapons() { text.length = 0; vm.runInContext('skyWeaponStatus(skyCompactHUD())', context); return text.map(t => ({ ...t })); },
    project(target, withTarget = true) {
      context.markerTarget = target;
      return vm.runInContext(`(() => { const t = markerTarget, s = {}; projectTargetMarker(t.pos,s${withTarget ? ',t' : ''}); return s; })()`, context);
    },
  };
}

function labelBounds(t) {
  const w = measure(t.value, t.size);
  return { x: t.x - (t.align === 'center' ? w / 2 : t.align === 'right' ? w : 0), y: t.y - t.size, w, h: t.size * 1.25 };
}
function intersects(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function checkReadable(f, labels) {
  const unit = f.context.cssRect.height / 340;
  assert(labels.length, '屏外敌机必须有带单位的可读标签');
  for (const t of labels) {
    assert(t.size * unit >= 14 - 1e-6, `标签字号只有${(t.size * unit).toFixed(2)} CSS px`);
    assert((t.alpha ?? 1) >= .9, '敌情标签不能以低透明度融进地景');
    const r = labelBounds(t);
    assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= f.context.VW && r.y + r.h <= 340, '标签不能越过画框');
    for (let x = r.x; x <= r.x + r.w; x += 2) for (let y = r.y; y <= r.y + r.h; y += 2)
      assert(!f.blocked(x, y), `敌情${t.value}在${x.toFixed(1)},${y.toFixed(1)}被固定HUD挡住`);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++)
    assert(!intersects(labelBounds(labels[i]), labelBounds(labels[j])), '同向敌机文字不能互相重叠');
}

for (const [width, height] of [[1358, 738], [366, 662], [818, 277]]) {
  test(`俯瞰${width}×${height}真实武器绘字边界参与避让，目标不能压住机炮加力状态行`, () => {
    const f = fixture(width, height);
    Object.assign(f.context.G.player, { missiles: 2, reloads: [1.8, 3.2], flares: 2, flareCd: 7 });
    const weapons = f.weapons();
    for (const t of weapons) {
      const r = labelBounds(t);
      for (const [x, y] of [[r.x + 1, r.y + 1], [r.x + r.w - 1, r.y + 1], [r.x + 1, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]])
        assert(f.blocked(x, y), `实际武器文字${t.value}顶部或边缘未避让：${JSON.stringify(r)}`);
    }
    for (let i = 0; i < 24; i++) {
      f.targets.length = 0;
      f.context.G.time = i;
      f.add(i * Math.PI / 12, 2100, { isGround: true, type: 'sam', kind: 'sam' });
      f.draw();
      const label = f.text.find(t => /防空.*2\.1 km/.test(t.value));
      assert(label, '真实防空目标仍须显示');
      for (const weapon of weapons) assert(!intersects(labelBounds(label), labelBounds(weapon)), `敌情${label.value}压住实际武器文字${weapon.value}`);
    }
  });

  test(`俯瞰${width}×${height}八方向敌机标出真实方向和可读距离，并避让仪表`, () => {
    for (let i = 0; i < 8; i++) {
      const f = fixture(width, height), angle = i * Math.PI / 4;
      f.add(angle, i % 2 ? 825 : 2450); f.draw();
      const labels = f.text.filter(t => /敌机.*(?:m|米)/.test(t.value));
      assert.equal(labels.length, 1, '每个屏外敌机应保留一个有名称和单位的距离标签');
      checkReadable(f, labels);
      assert.equal(f.arrows.length, 1);
      const arrow = f.arrows[0];
      assert(arrow.alpha >= .9, '方向箭头不能以低透明度融进地景');
      assert(Math.abs(Math.atan2(Math.sin(arrow.angle - angle), Math.cos(arrow.angle - angle))) < 1e-9, '避让后箭头仍须指向真实敌机方向');
      for (const [dx, dy] of [[0, 0], [-6, -6], [6, 6]]) assert(!f.blocked(arrow.x + dx, arrow.y + dy), '方向箭头被仪表挡住');
    }
  });

  test(`俯瞰${width}×${height}同向四目标分开显示，优先保留锁定与DOM避让`, () => {
    const f = fixture(width, height);
    for (const d of [1400, 1800, 2300, 2800]) f.add(Math.PI / 2, d);
    const target = f.targets[3];
    f.context.G.lock = { target, phase: 'locked', progress: 1 };
    vm.runInContext('SKY_OCCLUSION.push({x:VW*.66,y:220,w:VW*.30,h:25})', f.context);
    f.draw();
    const labels = f.text.filter(t => /(?:敌机|锁定).*(?:m|米)/.test(t.value));
    assert.equal(labels.length, 4, '同向目标仍须分别可见');
    checkReadable(f, labels);
    assert(labels.some(t => /已锁定.*2\.8\s?km/.test(t.value)), '锁定提示须保留真实目标的距离与已锁定状态');
    assert(f.arrows.some(a => a.color === '#ffe39a'), '锁定方向使用金色强调');
  });

  test(`俯瞰${width}×${height}鼠标和触屏瞄准可见提示时沿实际锁定路径命中同一目标`, () => {
    const f = fixture(width, height);
    for (const distance of [1400, 1800, 2300]) f.add(-Math.PI / 2, distance);
    f.draw();
    const target = f.targets[2], label = f.text.find(t => /2\.3 km/.test(t.value));
    assert(label, `同方向目标须保留可见标签：${JSON.stringify(f.text)}`);
    const bounds = labelBounds(label);
    f.context.INPUT.mx = bounds.x + bounds.w / 2;
    f.context.INPUT.my = bounds.y + bounds.h / 2;
    vm.runInContext('updateLockOn(1/60)', f.context);
    assert.equal(f.context.G.lock.target, target, `可见目标标签与获取锁定必须使用同一投影点：${JSON.stringify({ text: f.text, marker: f.project(target), aim: f.context.INPUT })}`);
    for (let frame = 0; frame < 65; frame++) vm.runInContext('updateLockOn(1/60)', f.context);
    assert.equal(f.context.G.lock.target, target);
    assert.equal(f.context.G.lock.phase, 'locked', '标签改为金色时不能因避让位移丢失锁定');
    f.draw();
    assert(f.text.some(t => /已锁定.*2\.3 km/.test(t.value)));
    const behind = f.add(Math.PI / 2, 1800);
    f.context.G.time = 1;
    f.context.G.lock = { target: null, phase: 'search', progress: 0, tick: 0 };
    const marker = f.project(behind);
    Object.assign(f.context.INPUT, { mx: marker.x, my: marker.y });
    f.targets.splice(0, 3);
    vm.runInContext('updateLockOn(1/60)', f.context);
    assert.equal(f.context.G.lock.target, null, '显示后方敌情不能绕过真实机头前锥');
    const original = f.project(behind, false);
    assert.equal(original.skyCue, undefined, '无target参数的投影继续保留原共享合同');
  });
}

test('新版俯瞰保留遮蔽筛选和地面类型；切回追尾仍使用原方向提示', () => {
  const f = fixture(1358, 738), original = fixture(1358, 738, false);
  const concealed = f.add(-Math.PI / 2, 1800, { concealed: true });
  f.add(Math.PI, 600, { isGround: true, type: 'sam', kind: 'sam' });
  f.draw();
  assert(!f.text.some(t => /1\.8/.test(t.value)), '不能暴露被云遮住的敌机');
  assert(f.text.some(t => /防空.*600\s?(m|米)/.test(t.value)), '地面敌军不能误标成飞机');
  f.targets.splice(0, f.targets.length); original.targets.push(concealed);
  concealed.concealed = false; f.targets.push(concealed);
  f.context.G.view = original.context.G.view = 1;
  f.draw(); original.draw();
  assert.deepEqual(f.text, original.text, '追尾保留原共享方向提示');
  assert.deepEqual(f.arrows, original.arrows);
});

test('第三波北向密集敌情避让入场横幅，进度变金不移动当前目标的瞄准点', () => {
  const f = fixture(1358, 738), g = f.context.G;
  Object.assign(g, { wave: 3, missionWaveGoal: 3, banner: { title: '第 03 波', t: 1, life: 3.4 } });
  const target = f.add(-1.74, 1300);
  f.add(-1.76, 2170, { isGround: true, type: 'vehicle', kind: 'vehicle' });
  f.add(-1.51, 2230);
  f.add(-3.08, 1320);
  f.add(3.02, 2070);
  f.add(.53, 1810, { isGround: true, type: 'sam', kind: 'sam' });
  f.add(1.76, 2020, { isGround: true, type: 'sam', kind: 'sam' });
  f.add(2.7, 1900);
  g.lock = { target, phase: 'locking', progress: .55 };
  vm.runInContext('drawHUD()', f.context);
  const title = f.text.find(t => t.value === '第 03/03 波');
  const labels = f.text.filter(t => /^(锁定中|敌机|防空|装甲)/.test(t.value));
  assert(title && labels.length === 8);
  const blocked = labelBounds(title);
  for (const label of labels) assert(!intersects(blocked, labelBounds(label)), `第三波标题撞上${label.value}`);
  const before = f.project(target);
  g.lock.phase = 'locked';
  g.lock.progress = 1;
  const after = f.project(target);
  assert(before.skyCue && after.skyCue);
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
});

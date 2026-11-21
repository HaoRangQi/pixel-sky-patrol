// 实际HUD与准星分支：闲置时不能用固定光标遮住近距机身。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const hud = new vm.Script(read('src/50_ui_hud.js'), { filename: 'src/50_ui_hud.js' });
const sky = new vm.Script(read('sky-patrol/55_ui.js'), { filename: 'sky-patrol/55_ui.js' });

function fixture(newVersion) {
  const calls = [], pips = [];
  const ctx = new Proxy({}, {
    get: (target, name) => target[name] ?? ((...args) => calls.push([name, ...args])),
    set: (target, name, value) => { target[name] = value; return true; },
  });
  const context = vm.createContext({
    ctx, VW: 626, VH: 340, TAU: Math.PI * 2, MOUSE_STEER_TIMEOUT: .42,
    G: { mode: 'play', player: {}, camera: {}, view: 0, viewBlend: 1, cockpitAlpha: 0, lock: { phase: 'search' } },
    INPUT: { mx: 313, my: 170, mouseSteerAge: 1, touchMode: false },
    TOUCH: { active: false }, flightMode: 'intercept', clamp01: value => Math.max(0, Math.min(1, value)),
  });
  hud.runInContext(context);
  if (newVersion) sky.runInContext(context);
  const drawTargets = vm.runInContext('drawTargetMarkers', context);
  for (const name of ['drawPitchLadder', 'drawHeadingTape', 'drawTargetMarkers', 'drawObjectivesPanel',
    'drawScorePanel', 'drawSpeedAlt', 'drawShieldFuel', 'drawThreats', 'drawWeaponPips',
    'drawMiniRadar', 'drawWarnings', 'drawBanner', 'drawText', 'line',
    'skyCompactFlightPanels', 'skyWeaponStatus', 'drawRadarScope']) context[name] = () => {};
  context.drawMousePip = (...args) => pips.push(args);
  return { context, calls, pips, drawTargets, draw: () => vm.runInContext('drawHUD()', context) };
}

for (const newVersion of [false, true]) {
  test(`${newVersion ? '新版' : '根入口'}闲置俯视不以准星和鼠标点遮住真实机体`, () => {
    const f = fixture(newVersion);
    f.draw();
    assert.equal(f.calls.filter(([name]) => name === 'arc').length, 0, '无输入时仍在机身中心画圆形准星');
    assert.equal(f.pips.length, 0, '无输入时仍在机身中心画鼠标点');
    f.context.INPUT.mouseSteerAge = 0;
    f.draw();
    assert(f.calls.some(([name]) => name === 'arc'), '真实瞄准输入的光标不能被一并移除');
    assert.equal(f.pips.length, 1);
  });
}

test('窄屏开局横幅避开透景仪表，不删掉真实波次提示', () => {
  const f = fixture(true), text = [];
  f.context.VW = 195;
  f.context.G.banner = { title: '第 01 波', t: 1, life: 3.2 };
  f.context.drawText = (value, x, y) => text.push({ value, x, y });
  vm.runInContext('SKY_OCCLUSION.push({x:43,y:32,w:133,h:50})', f.context);
  f.draw();
  const banner = text.find(item => item.value === '第 01 波');
  assert(banner, '不能为了监控截图而移除波次提示');
  assert(banner.y >= 122 && banner.y < 140, `波次横幅仍压在油量刻度上：${banner.y}`);
});

test('目标名称和血条避让透景仪表，仍保留真实锁定框和锁定状态', () => {
  const f = fixture(true), text = [], bars = [];
  const target = { kind: 'drone', pos: {}, hp: 100 };
  Object.assign(f.context, { VW:195, PAL:{goldHot:'#ffe39a'}, DRONE_MAX_HP:100,
    collectTargets:()=>[target], vdist:()=>1400, targetConcealed:()=>false, clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    projectTargetMarker:(_,point)=>{Object.assign(point,{x:95,y:112,visible:true});return true;},
    rect:(x,y)=>bars.push({x,y}),rectLine(){},
    drawText:(value,x,y)=>text.push({value,x,y}) });
  Object.assign(f.context.G, {realTime:0,lock:{target,phase:'locked',progress:1}});
  vm.runInContext('SKY_OCCLUSION.push({x:43,y:32,w:133,h:50})', f.context);
  f.drawTargets();
  const label = text.find(item=>item.value==='敌机');
  assert(label && label.y>150, `目标文字仍叠在油盾读数上：${label?.y}`);
  assert(bars.every(item=>item.y>150), '目标血条仍压住油盾刻度');
  assert(text.some(item=>item.value==='已锁定'), '不能删除真实锁定状态来避让');
  assert(f.calls.some(([name])=>name==='arc'), '真实目标锁定框不能被删除');
});

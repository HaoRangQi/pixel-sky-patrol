// 通过真实DOM按钮与键盘操作新版，不用测试布景入口启动。
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
function press(element, button = 0) {
  assert(element && !element.disabled, '目标按钮不存在或未启用');
  const r = element.getBoundingClientRect(), options = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button, buttons: button === 0 ? 1 : 2, pointerType: 'mouse' };
  element.dispatchEvent(new PointerEvent('pointerdown', options));
  element.dispatchEvent(new MouseEvent('mousedown', options));
  element.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
  element.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
  if (button === 0) element.click();
}
const click = id => press(document.getElementById(id));
assert(window.__PI?.ready(), '引擎未就绪');
assert(window.__SKY, '新版正式入口未实现');
const G = __PI.G;
assert(document.documentElement.lang === 'zh-CN', '默认语言不是中文');
assert(G.mode === 'title', '首次打开不是待命界面');
assert(!document.getElementById('sky-start').hidden, '待命操作不可见');
assert(document.getElementById('sky-pause').hidden, '暂停面板初始泄漏');

click('sky-cruise');
await settle();
assert(G.mode === 'play' && __SKY.flightMode === 'free', '自由巡航没有正式开始');
__PI.freeze(true);
assert(!G.enemies.length && !G.ground.length && G.waveTotal === 0, '自由巡航仍创建敌军');
// 隔离敌军生成逻辑：每秒补充燃油和安全离地高度，不把该测试当默认飞行体验。
for (let i = 0; i < 120; i++) {
  G.player.fuel = 100;
  G.player.pos.y = Math.max(G.player.pos.y, G.map.heightAt(G.player.pos.x, G.player.pos.z) + 700);
  __PI.step(1);
  assert(G.mode === 'play' && !G.enemies.length && !G.ground.length, `巡航在第${i + 1}秒生成战斗或切换状态`);
  assert(!G.missiles.some(m => m.owner === 'enemy'), '巡航生成敌弹');
}
const cruiseSeconds = G.time;
const initialView = G.view;
const views = [];
for (let i = 0; i < 3; i++) {
  click('sky-camera');
  __PI.step(0.04);
  await settle();
  views.push(G.view);
}
assert(new Set(views).size === 3 && G.view === initialView, '三个镜头没有完整循环');

const beforeUi = { shots: G.stats.shots, ammo: G.player.missiles, tracers: G.tracers.length };
click('sky-sound');
await settle();
const soundOn = G.sound;
assert(soundOn, '声音开关没有开启');
click('sky-sound');
assert(!G.sound, '声音无法关闭');
press(document.getElementById('sky-sound'), 2);
assert(G.stats.shots === beforeUi.shots && G.player.missiles === beforeUi.ammo && G.tracers.length === beforeUi.tracers, '工具栏点击穿透成开火或发射');

const pause = document.querySelector('[data-sky-action="pause"]');
press(pause);
await settle();
assert(G.mode === 'paused' && !document.getElementById('sky-pause').hidden, '暂停按钮无效');
assert(document.getElementById('sky-header').inert && document.getElementById('sky-controls').inert, '模态背后的按钮未隔离');
document.getElementById('sky-home').focus();
document.getElementById('sky-home').dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true }));
assert(document.activeElement.id === 'sky-resume', '暂停面板Tab没有循环到第一个按钮');
const pausedPos = { ...G.player.pos }, pausedTime = G.time;
__PI.step(1);
assert(JSON.stringify(G.player.pos) === JSON.stringify(pausedPos) && G.time === pausedTime, '暂停时任务仍在推进');
click('sky-resume');
await settle();
assert(G.mode === 'play', '无法恢复巡航');
__PI.step(0.2);
assert(G.time > pausedTime, '恢复后任务不推进');

press(pause);
await settle();
click('sky-restart');
await settle();
__PI.freeze(true);
assert(G.mode === 'play' && __SKY.flightMode === 'free' && G.time < 1 && G.player.missiles === 4 && !G.enemies.length, '暂停中重开未保留模式并清空状态');
press(pause);
await settle();
click('sky-home');
await settle();
assert(G.mode === 'title' && !document.getElementById('sky-start').hidden, '返回待命失败');

click('sky-intercept');
await settle();
__PI.freeze(true);
assert(G.mode === 'play' && __SKY.flightMode === 'intercept' && G.enemies.length > 0 && G.waveTotal === 4, '截击没有复用真实波次');
const missiles = G.player.missiles, shots = G.stats.shots;
key('KeyE'); key('KeyE', 'keyup');
assert(G.player.missiles === missiles - 1 && G.stats.shots === shots + 1, 'E未发射导弹');
const gunShots = G.stats.shots;
key('KeyF');
__PI.step(0.13);
key('KeyF', 'keyup');
assert(G.stats.shots >= gunShots + 2 && G.tracers.length > 0, '按住F没有持续发射机炮');
key('KeyQ'); key('KeyQ', 'keyup');
assert(G.player.rollT > 0, 'Q没有触发桶滚');
await settle();
assert(document.getElementById('sky-ammo-count').textContent.includes('03'), '底栏弹药没有同步');
assert(!document.getElementById('sky-combat').hidden, '截击战斗信息不可见');
assert(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify({ errors: __PI.errors, exceptions: __PI.exceptions }));

const stage = document.getElementById('stage').getBoundingClientRect();
const gl = document.getElementById('gl').getBoundingClientRect();
const ui = document.getElementById('ui').getBoundingClientRect();
assert(stage.x >= 0 && stage.y >= 0 && stage.right <= innerWidth + 1 && stage.bottom <= innerHeight + 1, '游戏舞台超出视口');
assert(Math.abs(ui.x - gl.x) < 1 && Math.abs(ui.y - gl.y) < 1 && Math.abs(ui.width - gl.width) < 1 && Math.abs(ui.height - gl.height) < 1, 'GL与HUD画布不对齐');
assert(ui.x >= stage.x - 1 && ui.y >= stage.y - 1 && ui.right <= stage.right + 1 && ui.bottom <= stage.bottom + 1, '引擎仍按整个window排布，画布溢出stage');
return { result: 'PASS', cruiseSeconds, views, soundToggle: true, toolbarIsolation: true, pausedStable: true, restartAndHome: true, interceptEnemies: G.enemies.length, missileCount: G.player.missiles, gunTracers: G.tracers.length, stage: stage.toJSON(), canvas: ui.toJSON(), errors: __PI.errors, exceptions: __PI.exceptions };

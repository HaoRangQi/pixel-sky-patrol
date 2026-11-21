import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(root + name, 'utf8');
for (const name of ['sky-patrol/55_ui.js', 'sky-patrol/65_app.js']) {
  assert.ok(existsSync(root + name), `SKY adapter source is required: ${name}`);
}
const ui = read('sky-patrol/54_cockpit.js') + '\n' + read('sky-patrol/55_ui.js');
const app = read('sky-patrol/65_app.js');
assert.ok(/<button\b[^>]*data-sky-action="flare"[^>]*>[\s\S]*?<kbd>C<\/kbd>[\s\S]*?干扰弹[\s\S]*?<\/button>/.test(read('sky-patrol/00_shell.html')), '新版操作栏必须有标明C的干扰弹按钮');
const engineFiles = ['10_core', '20_world', '30_shaders', '31_render', '32_meshes', '33_forest', '40_game', '42_combat', '50_ui_hud', '52_ui_screens'];
new vm.Script(`(() => {\n${engineFiles.map(n => read(`src/${n}.js`)).join('\n')}\n${ui}\n${read('src/60_main.js')}\n${app}\n})();`);

// Minimal DOM/renderer boundary; the VM runs the actual core, game, combat and UI logic.
class Element {
  constructor(id, parent = null, tagName = 'DIV') {
    this.id = id; this.parentElement = parent; this.tagName = tagName;
    this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = tagName === 'BUTTON';
    this.listeners = new Map(); this.attributes = new Map(); this.writes = 0; this.attributeWrites = 0; this._text = '';
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, on) { on ? classes.add(x) : classes.delete(x); } };
  }
  addEventListener(type, fn, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, capture: options === true || !!options.capture }); this.listeners.set(type, list);
  }
  contains(el) { for (; el; el = el.parentElement) if (el === this) return true; return false; }
  closest(selector) {
    for (let el = this; el; el = el.parentElement) {
      if (selector === 'button' && el.tagName === 'BUTTON') return el;
      if (selector === '[data-sky-action]' && el.dataset.skyAction) return el;
    }
    return null;
  }
  set textContent(value) { this._text = String(value); this.writes++; }
  get textContent() { return this._text; }
  setAttribute(name, value) {
    this.attributeWrites++; this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = document.body; }
  querySelectorAll(selector) { return nodes.filter(n => this.contains(n) && matches(n, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getContext() { return context2d; }
}
const context2d = new Proxy({ measureText: t => ({ width: t.length * 6 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) }, {
  get: (o, k) => k in o ? o[k] : () => {},
});
const window = new Element('window');
const document = new Element('document', window);
document.body = new Element('body', document); document.activeElement = document.body;
const nodes = [];
const node = (id, parent = document.body, tag = 'DIV') => { const n = new Element(id, parent, tag); nodes.push(n); return n; };
const sky = node('sky-app'); const stage = node('stage', sky);
stage.rect = { left: 40, top: 78, width: 1280, height: 720 };
const gl = node('gl', stage, 'CANVAS'); const canvas = node('ui', stage, 'CANVAS');
gl.rect = canvas.rect = stage.rect;
for (const id of ['sky-header', 'bootfallback', 'sky-brand', 'sky-mode-label', 'sky-telemetry', 'sky-alt', 'sky-speed', 'sky-combat', 'sky-wave', 'sky-score', 'sky-shield', 'sky-fuel', 'sky-start', 'sky-pause', 'sky-result', 'sky-result-score', 'sky-result-kills', 'sky-status', 'sky-controls', 'sky-ammo-count', 'sky-ammo']) node(id, sky);
const byId = id => nodes.find(n => n.id === id);
for (const id of ['sky-camera', 'sky-chase', 'sky-intercept', 'sky-cruise', 'sky-inland', 'sky-resume', 'sky-cruise-speed', 'sky-burn-speed', 'sky-speed-reset', 'sky-mouse-steering', 'sky-enemy-speed', 'sky-restart', 'sky-home', 'sky-again', 'sky-result-home', 'sky-sound', 'sky-fullscreen']) {
  const parent = ['sky-resume', 'sky-cruise-speed', 'sky-burn-speed', 'sky-speed-reset', 'sky-mouse-steering', 'sky-enemy-speed', 'sky-restart', 'sky-home'].includes(id) ? byId('sky-pause')
    : ['sky-again', 'sky-result-home'].includes(id) ? byId('sky-result') : sky;
  node(id, parent, id.endsWith('-speed') || id === 'sky-mouse-steering' ? 'INPUT' : 'BUTTON');
}
for (const kind of ['cruise', 'burn', 'enemy']) node(`sky-${kind}-speed-value`, byId('sky-pause'), 'OUTPUT');
byId('sky-mouse-steering').type = 'checkbox'; byId('sky-mouse-steering').checked = false;
node('sound-label', byId('sky-sound'), 'SPAN');
const actions = {};
for (const action of ['roll', 'boost', 'gun', 'missile', 'flare', 'view', 'pause']) {
  actions[action] = node(`action-${action}`, byId('sky-controls'), 'BUTTON'); actions[action].dataset.skyAction = action;
}
node('flare-label', actions.flare, 'SPAN');
for (let i = 0; i < 4; i++) node(`ammo-${i}`, byId('sky-ammo')).dataset.ammoSlot = String(i);
function matches(n, selector) { return selector.split(',').some(part => { const s = part.trim(); return s === 'span' ? n.tagName === 'SPAN' : s === 'button' ? n.tagName === 'BUTTON' : s === 'input' ? n.tagName === 'INPUT' : s === '[data-sky-action]' ? !!n.dataset.skyAction : s === '[data-ammo-slot]' ? n.dataset.ammoSlot !== undefined : false; }); }
document.getElementById = byId;
document.querySelectorAll = selector => nodes.filter(n => matches(n, selector));
document.createElement = () => new Element('canvas');
document.fullscreenEnabled = true; document.fullscreenElement = null;
let fullscreenReject = false;
sky.requestFullscreen = async () => { if (fullscreenReject) throw Error('denied'); document.fullscreenElement = sky; dispatch(document, 'fullscreenchange'); };
document.exitFullscreen = async () => { document.fullscreenElement = null; dispatch(document, 'fullscreenchange'); };
Object.assign(window, { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2 });
function dispatch(target, type, props = {}) {
  const event = { target, type, pointerType: 'mouse', pointerId: 1, button: 0, clientX: 500, clientY: 300, detail: 1, repeat: false, ...props,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = this.immediate = true; } };
  const path = []; for (let p = target; p; p = p.parentElement) path.push(p);
  for (const capture of [true, false]) {
    for (const el of capture ? [...path].reverse() : path) {
      for (const l of el.listeners.get(type) || []) { if (l.capture === capture) l.fn(event); if (event.immediate) break; }
      if (event.stopped) return event;
    }
  }
  return event;
}
let rafCount = 0;
const storage = new Map([['sky-patrol-hs-v1', '2400']]);
const sandbox = vm.createContext({ window, document, console, URLSearchParams, location: { search: '' }, performance: { now: () => 10 },
  setTimeout, clearTimeout, requestAnimationFrame: () => ++rafCount, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
const boundary = `
const Renderer = { init() { return true; }, resize(w, h) { window.__resized = [w, h]; } };
const CLOUD_BASE = 1300; const CLOUD_TOP = 2200; const $bootfallback = null;
function generateWorld() { return new Promise(() => {}); }
function findFlatSpot(map, x, z) { return { x: x + 900, z: z + 900, h: 20 }; }
`;
const runtimeFiles = ['10_core', '40_game', '42_combat', '50_ui_hud', '52_ui_screens'];
vm.runInContext(`(() => { ${boundary}\n${runtimeFiles.map(n => read(`src/${n}.js`)).join('\n')}\n${ui}\n${read('src/60_main.js')}\n${app}\nwindow.__eval = code => eval(code); })();`, sandbox);
const run = code => window.__eval(code);
const G = window.__PI.G;
assert.ok(window.__SKY, 'formal SKY API is exposed without replacing __PI');
assert.equal(rafCount, 1, 'adapter does not start a second animation loop');
assert.equal(byId('sky-intercept').disabled, true, 'loading keeps starts disabled');
assert.equal(stage.rect.width / stage.rect.height, run('VIEW_ASPECT'));
assert.equal(gl.style.left, '0px', 'canvas is stage-local rather than window-local');
assert.equal(gl.style.width, '1280px');
assert.equal(canvas.width, run('VW * UI_DPR'));
assert.equal(run('UI_DPR'), 3);
assert.ok(run('WORLD_H') >= 180);

G.map = { heightAt: () => 20, cloudDensity: () => 0, findScenicSpawn: () => ({ x: 0, z: 0, heading: 0.6 }) };
run("BOOT.ready = true; G.highScore = loadHighScore(); G.mode = 'title'; setupTitleWorld(); G.camera = buildCamera(computePose(1, false));");
window.__SKY.sync();
assert.equal(G.highScore, 2400, 'high score loader returns a finite value to boot');
assert.equal(byId('sky-intercept').disabled, false);
assert.equal(actions.flare.disabled, true, '待命时不能发射干扰弹');
run("onKeyDown('Space'); onKeyDown('KeyQ'); onKeyDown('KeyF');");
assert.equal(G.mode, 'title', 'only Enter starts the initial title from keyboard');
run("onKeyDown('Enter')");
assert.equal(window.__SKY.flightMode, 'intercept');
assert.equal(G.enemies.length, 3, 'formal start preserves original initial wave, no __PI extras');
assert.equal(G.player.pos.y, 620, 'formal start does not apply screenshot altitude');
assert.ok(G.waveTotal > 0 && G.ground.length > 0);

// 实际按钮复用真实干扰弹规则，不穿透为机炮、导弹或切镜头。
const flareBefore = { ammo: G.player.missiles, shots: G.stats.shots, view: G.view };
assert.equal(actions.flare.disabled, false);
assert.match(byId('flare-label').textContent, /干扰弹.*3/);
dispatch(actions.flare, 'pointerdown'); dispatch(actions.flare, 'mousedown'); dispatch(actions.flare, 'mouseup'); dispatch(actions.flare, 'pointerup'); dispatch(actions.flare, 'click');
assert.equal(G.player.flares, 2); assert.equal(G.player.flareCd, 7);
assert.equal(G.effects.filter(effect => effect.type === 'flare').length, 6, '一轮投放六颗真实干扰效果');
assert.deepEqual({ ammo: G.player.missiles, shots: G.stats.shots, view: G.view }, flareBefore);
assert.equal(actions.flare.disabled, true); assert.match(byId('flare-label').textContent, /7s/);
assert.match(actions.flare.getAttribute('aria-label'), /剩余 2.*冷却 7/);
dispatch(actions.flare, 'click'); assert.equal(G.player.flares, 2, '冷却期间不能连点发射');
run('updateFlight(1)'); window.__SKY.sync(); assert.match(byId('flare-label').textContent, /6s/);
G.player.flareCd = 0; G.realTime += 7; window.__SKY.sync();
assert.equal(actions.flare.disabled, false);
dispatch(actions.flare, 'keydown', { code: 'Space' }); dispatch(actions.flare, 'click', { detail: 0 });
assert.equal(G.player.flares, 1); assert.equal(G.view, flareBefore.view, '聚焦按钮的空格不切视角');
G.player.flareCd = 0; G.realTime += 7;
dispatch(canvas, 'keydown', { code: 'KeyX' }); dispatch(canvas, 'keyup', { code: 'KeyX' });
assert.equal(G.player.flares, 0, 'X快捷键仍可用');
assert.equal(actions.flare.disabled, true); assert.match(byId('flare-label').textContent, /用尽/);
window.__SKY.restart(); G.mode = 'waveclear'; window.__SKY.sync();
assert.equal(actions.flare.disabled, true, '遵守现有干扰弹只在play投放的规则');
G.mode = 'play'; window.__SKY.sync();
dispatch(actions.pause, 'click'); assert.equal(actions.flare.disabled, true);
dispatch(actions.flare, 'click'); assert.equal(G.player.flares, 3, '暂停时不消耗干扰弹');
dispatch(byId('sky-resume'), 'click');

G.freeze = true; G.testInput = { burn: true }; G.pausedFrom = 'waveclear'; G.touchStick = { x: 1, y: 1 };
run("INPUT.keys.add('KeyF'); INPUT.left = INPUT.touchBurn = INPUT.touchGun = true; TOUCH.active = true; UI_HOLDS.set(4, {});");
dispatch(byId('sky-cruise'), 'click'); // hidden starts must not switch a live flight
assert.equal(window.__SKY.flightMode, 'intercept');
window.__SKY.start('free');
assert.equal(window.__SKY.flightMode, 'free');
assert.equal(G.mode, 'play');
assert.equal(G.enemies.length + G.ground.length + G.missiles.length, 0, 'cruise has no combat spawns');
assert.equal(G.waveTotal + G.waveSpawned + G.waveKills + G.activeCap, 0);
assert.equal(G.secondary, null);
assert.equal(G.freeze, false); assert.equal(G.testInput, null); assert.equal(G.touchStick, null); assert.equal(G.pausedFrom, null);
assert.equal(run('INPUT.keys.size + UI_HOLDS.size'), 0); assert.equal(run('TOUCH.active || INPUT.left || INPUT.touchBurn || INPUT.touchGun'), false);
assert.equal(G.view, 1); assert.ok(!G.banner || !/波/.test(G.banner.title), 'cruise never shows a wave-start banner');
run('updateWaveLogic(10)'); assert.equal(G.mode, 'play', 'zero cruise targets never completes an empty wave');
const shield = G.player.shield;
run("damagePlayer(10, 'missile', true)"); assert.equal(G.player.shield, shield);
run("damagePlayer(5, 'terrain', true)"); assert.equal(G.player.shield, shield - 5, 'cruise retains terrain consequences');
window.__SKY.sync();
assert.equal(sky.dataset.flight, 'free'); assert.equal(byId('sky-combat').hidden, true);
assert.equal(byId('sky-alt').textContent, '2,034'); assert.equal(byId('sky-speed').textContent, '218');
assert.match(byId('sky-status').textContent, /撞地|地形/);
const writes = byId('sky-alt').writes; window.__SKY.sync(); assert.equal(byId('sky-alt').writes, writes, 'unchanged telemetry does not rewrite text');
assert.equal(byId('sky-shield').textContent, '95', 'shell supplies shield/fuel percent units');
assert.equal(byId('sky-fuel').textContent, '100');
G.player.missiles = 2; window.__SKY.sync();
assert.equal(byId('ammo-2').getAttribute('data-empty'), 'true', 'shell ammo styling receives empty state');

// Original window input listeners remain installed; capture fences must intercept them.
dispatch(byId('sky-sound'), 'mousedown'); assert.equal(run('INPUT.left'), false);
dispatch(byId('sky-sound'), 'pointermove'); assert.equal(run('INPUT.mouseSteerAge'), Infinity);
dispatch(canvas, 'pointermove', { clientX: 1000, clientY: 200 });
assert.equal(G.player.mouseSteering, false, '新版默认关闭鼠标操纵');
assert.equal(run('readSteering().sx || readSteering().sy || readSteering().turn'), 0, '鼠标仍能瞄准但默认不能改变飞行操纵');
dispatch(document.body, 'pointermove'); assert.equal(run('INPUT.mouseSteerAge'), Infinity);
dispatch(canvas, 'mousedown'); assert.equal(run('INPUT.left'), true);
dispatch(document.body, 'mouseup'); assert.equal(run('INPUT.left'), false, 'release outside stage cannot leave guns held');
const view = G.view;
const key = dispatch(byId('sky-camera'), 'keydown', { code: 'Space' });
assert.equal(G.view, view, 'focused button Space does not reach game shortcut');
assert.ok(!key.defaultPrevented, 'native Space activation is retained');
dispatch(byId('sky-camera'), 'keydown', { code: 'KeyW' }); assert.equal(run("INPUT.keys.has('KeyW')"), true, 'focus does not block unrelated flight keys');
dispatch(byId('sky-camera'), 'keyup', { code: 'KeyW' }); assert.equal(run("INPUT.keys.has('KeyW')"), false);
dispatch(actions.boost, 'pointerdown'); assert.equal(run('INPUT.touchBurn'), true);
dispatch(document.body, 'pointerup'); assert.equal(run('INPUT.touchBurn'), false);
dispatch(actions.gun, 'pointerdown'); assert.equal(run('INPUT.touchGun'), true);
dispatch(actions.gun, 'pointercancel'); assert.equal(run('INPUT.touchGun'), false);
dispatch(actions.view, 'pointerdown'); dispatch(actions.view, 'click'); assert.equal(G.view, (view + 1) % 3, 'discrete DOM action fires once per click');
run('TOUCH.active = true; TOUCH.id = 3; INPUT.touchBurn = INPUT.touchGun = true; G.touchStick = {x: 1, y: 1}; UI_HOLDS.set(3, {});');
dispatch(actions.pause, 'click');
assert.equal(G.mode, 'paused'); assert.equal(sky.dataset.mode, 'paused');
assert.equal(run('TOUCH.active || INPUT.touchBurn || INPUT.touchGun || UI_HOLDS.size'), 0);
assert.equal(G.touchStick, null); assert.equal(byId('sky-pause').hidden, false);
// 模态界面首尾循环焦点，不允许Tab进入背后的设置与原版链接。
byId('sky-home').focus();
const modalTab = dispatch(byId('sky-home'), 'keydown', { code: 'Tab', shiftKey: false });
assert.ok(modalTab.defaultPrevented, '暂停对话框末尾Tab必须留在模态内');
assert.equal(document.activeElement, byId('sky-resume'));
const modalBack = dispatch(byId('sky-resume'), 'keydown', { code: 'Tab', shiftKey: true });
assert.ok(modalBack.defaultPrevented);
assert.equal(document.activeElement, byId('sky-home'));
dispatch(byId('sky-resume'), 'click'); assert.equal(G.mode, 'play');

let audioInit = 0; let audioToggle = 0;
window.__audioInit = () => audioInit++; window.__audioToggle = () => audioToggle++;
run('AudioSys.init = () => window.__audioInit(); AudioSys.setEnabled = on => { AudioSys.enabled = on; window.__audioToggle(); };');
dispatch(byId('sky-sound'), 'click'); assert.equal(G.sound, true); assert.ok(audioInit && audioToggle);
assert.equal(byId('sky-sound').getAttribute('aria-pressed'), 'true');
assert.equal(byId('sound-label').textContent, '音效开启', 'sound text preserves its sibling SVG icon');
assert.equal(byId('sky-sound').getAttribute('aria-label'), '音效开启');
dispatch(byId('sky-fullscreen'), 'click'); await new Promise(resolve => setImmediate(resolve));
assert.equal(document.fullscreenElement, sky); assert.equal(byId('sky-fullscreen').getAttribute('aria-pressed'), 'true');
dispatch(byId('sky-fullscreen'), 'click'); await new Promise(resolve => setImmediate(resolve));
assert.equal(document.fullscreenElement, null);
fullscreenReject = true; dispatch(byId('sky-fullscreen'), 'click'); await new Promise(resolve => setImmediate(resolve));
assert.equal(document.fullscreenElement, null); assert.match(byId('sky-status').textContent, /全屏/);

window.__SKY.home(); assert.equal(G.mode, 'title'); assert.equal(G.enemies.length, 0); assert.equal(G.freeze, false);
assert.equal(byId('sky-start').hidden, false);
dispatch(byId('sky-intercept'), 'click'); assert.equal(window.__SKY.flightMode, 'intercept'); assert.equal(G.enemies.length, 3);
const before = G.player.shield; run("damagePlayer(5, 'missile', true)"); assert.equal(G.player.shield, before - 5, 'intercept damage remains original');
G.waveKills = G.waveTotal; run('updateWaveLogic(0.1)'); assert.equal(G.mode, 'waveclear', 'intercept wave completion remains original');
window.__SKY.sync(); assert.equal(sky.dataset.mode, 'waveclear');
run("G.mode = 'failed'; G.failTimer = 1; G.score = 1234; G.stats.kills = 2;"); window.__SKY.sync();
assert.equal(byId('sky-result').hidden, false); assert.equal(byId('sky-result-score').textContent, '1,234');
dispatch(byId('sky-again'), 'click'); assert.equal(G.mode, 'play'); assert.equal(G.score, 0);
assert.equal(rafCount, 1);
// 两条巡航仍用同一张地图和同一套规则；重开保留路线，回到待命不污染常规出生点。
window.__SKY.home(); const lakeSpawn = { ...G.player.pos };
const map = G.map;
assert.equal(byId('sky-inland').disabled, false, '待命时能从正式按钮进入内陆草谷');
dispatch(byId('sky-inland'), 'click');
assert.equal(window.__SKY.flightMode, 'free'); assert.equal(G.view, 1); assert.equal(G.map, map);
const inland = { ...G.player.pos };
assert.ok(Math.hypot(inland.x - lakeSpawn.x, inland.z - lakeSpawn.z) > 1000, '草谷出发点须位于另一段真实地形');
assert.ok(inland.y - map.heightAt(inland.x, inland.z) < 260, '林线入口不应沿用湖区600米净空');
assert.equal(G.enemies.length + G.ground.length, 0);
window.__SKY.restart(); assert.deepEqual({ ...G.player.pos }, inland);
window.__SKY.home(); dispatch(byId('sky-intercept'), 'click');
assert.equal(G.player.pos.x, lakeSpawn.x); assert.equal(G.player.pos.z, lakeSpawn.z); assert.equal(G.enemies.length, 3);
assert.equal(run('hudBlocked(50, 100)'), true, '恢复的资源面板必须参与目标标签避让');
dispatch(byId('sky-camera'), 'click');
assert.equal(byId('sky-camera').getAttribute('aria-label'), '切换视角，当前座舱视角', '读屏名称必须同步实际视角');
dispatch(actions.boost, 'click', { detail: 0 });
assert.equal(run('INPUT.touchBurn'), true, '辅助技术单次激活加速应提供有限时长的加速');
await new Promise(resolve => setTimeout(resolve, 1300));
assert.equal(run('INPUT.touchBurn'), false, '辅助技术短加速必须自动结束');
console.log('PASS SKY adapter: full concatenated syntax, real lifecycle/waves/damage, stage resize, DOM state, input fences, holds, audio and fullscreen rejection.');

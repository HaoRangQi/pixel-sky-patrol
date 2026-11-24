// Run: node --test tools/test_sky_speed.mjs
// The real shell, input listeners, flight model and SKY lifecycle run in a VM.
// Only DOM/canvas/renderer/world generation are replaced; no browser is started.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const scripts = ['10_core', '40_game', '42_combat', '43_defense', '44_ai', '50_ui_hud', '52_ui_screens'];
const commonSource = scripts.map(name => read(`src/${name}.js`)).join('\n');
const mainSource = read('src/60_main.js');
const skySource = read('sky-patrol/54_cockpit.js') + '\n' + read('sky-patrol/55_ui.js');
const sceneSource = read('sky-patrol/64_scene.js');
const appSource = read('sky-patrol/65_app.js');
const shells = { sky: read('sky-patrol/00_shell.html'), original: read('src/00_shell.html') };
const KNOTS_PER_MS = 1.94384;
const plain = value => JSON.parse(JSON.stringify(value));
const near = (value, expected, tolerance = 1e-9, why = '') =>
  assert(Math.abs(value - expected) <= tolerance, `${why}: expected ${expected}, got ${value}`);

function dom(shell) {
  const nodes = [];
  const context2d = new Proxy({ globalAlpha: 1, measureText: text => ({ width: text.length * 6 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, {
    get: (object, key) => key in object ? object[key] : () => {},
  });
  let document;
  function matches(element, selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      let exclude = null;
      part = part.replace(/:not\(([^)]+)\)/g, (_, value) => { exclude = value; return ''; });
      const enabled = part.includes(':enabled');
      part = part.replace(':enabled', '');
      const tag = part.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && element.tagName !== tag.toUpperCase()) return false;
      for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
        const actual = element.getAttribute(name);
        if (actual === null || value !== undefined && actual !== value) return false;
      }
      return (!enabled || !element.disabled) && (!exclude || !matches(element, exclude));
    });
  }
  class Element {
    constructor(tagName, parentElement = null) {
      this.tagName = tagName.toUpperCase(); this.parentElement = parentElement;
      this.id = ''; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.checked = false;
      this.listeners = new Map(); this.attributes = new Map(); this._text = ''; this._value = '';
      this.rect = { left: 0, top: 0, width: 0, height: 0 };
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
        toggle(value, on) { on ? classes.add(value) : classes.delete(value); } };
    }
    addEventListener(type, fn, options = {}) {
      const list = this.listeners.get(type) || [];
      list.push({ fn, capture: options === true || !!options.capture }); this.listeners.set(type, list);
    }
    contains(element) { for (; element; element = element.parentElement) if (element === this) return true; return false; }
    closest(selector) { for (let element = this; element; element = element.parentElement) if (matches(element, selector)) return element; return null; }
    matches(selector) { return matches(this, selector); }
    get textContent() { return this._text; }
    set textContent(value) { this._text = String(value); }
    get value() { return this.tagName === 'OUTPUT' ? this.textContent : this._value; }
    set value(value) { if (this.tagName === 'OUTPUT') this.textContent = value; else this._value = String(value); }
    setAttribute(name, value) {
      value = String(value); this.attributes.set(name, value);
      if (name === 'id') this.id = value;
      if (['type', 'min', 'max', 'step', 'value', 'tabIndex'].includes(name)) this[name] = value;
      if (['hidden', 'disabled', 'checked'].includes(name)) this[name] = true;
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getBoundingClientRect() { return this.rect; }
    setPointerCapture() {}
    releasePointerCapture() {}
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
    querySelectorAll(selector) { return nodes.filter(element => element !== this && this.contains(element) && matches(element, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getContext() { return context2d; }
  }
  const window = new Element('window');
  document = new Element('document', window);
  document.body = new Element('body', document); document.activeElement = document.body;
  // Read actual tags/attributes so missing controls, ranges, labels and DOM order
  // fail the test instead of being silently supplied by a hand-built fixture.
  const markup = shell.slice(shell.indexOf('<body'), shell.indexOf('<script>'));
  const stack = [document.body];
  const voidTags = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
  for (const [, closing, tag, attributes] of markup.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)) {
    const name = tag.toUpperCase();
    if (name === 'BODY') continue;
    if (closing) {
      const index = stack.findLastIndex(element => element.tagName === name);
      if (index > 0) stack.length = index;
      continue;
    }
    const element = new Element(name, stack.at(-1)); nodes.push(element);
    for (const [, key, doubleQuoted, singleQuoted, unquoted] of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g)) {
      element.setAttribute(key, doubleQuoted ?? singleQuoted ?? unquoted ?? '');
    }
    if (!voidTags.has(name) && !attributes.trimEnd().endsWith('/')) stack.push(element);
  }
  const byId = id => nodes.find(element => element.id === id) || null;
  document.getElementById = byId;
  document.querySelectorAll = selector => nodes.filter(element => matches(element, selector));
  document.createElement = tag => new Element(tag);
  document.fullscreenEnabled = false; document.fullscreenElement = null;
  Object.assign(window, { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2 });
  for (const id of ['stage', 'ui', 'gl']) if (byId(id)) byId(id).rect = { left: 40, top: 78, width: 1280, height: 720 };
  function dispatch(target, type, props = {}) {
    assert(target, `Cannot dispatch ${type}: required real-shell control is missing`);
    const event = { target, type, pointerType: 'mouse', pointerId: 1, button: 0, clientX: 500, clientY: 300, detail: 1, repeat: false, ...props,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = this.immediate = true; } };
    const path = []; for (let element = target; element; element = element.parentElement) path.push(element);
    for (const capture of [true, false]) {
      for (const element of capture ? [...path].reverse() : path) {
        for (const listener of element.listeners.get(type) || []) {
          if (listener.capture === capture) listener.fn(event);
          if (event.immediate) break;
        }
        if (event.stopped) return event;
      }
    }
    return event;
  }
  return { window, document, byId, nodes, dispatch };
}

function fixture(sky = true) {
  const browser = dom(sky ? shells.sky : shells.original);
  const { window, document } = browser;
  const deterministicMath = Object.create(Math); deterministicMath.random = () => 0.5;
  const storageWrites = [];
  const context = vm.createContext({ window, document, console, Math: deterministicMath, URLSearchParams, location: { search: '' }, performance: { now: () => 10 },
    setTimeout, clearTimeout, requestAnimationFrame: () => 1,
    localStorage: { getItem: () => null, setItem: (...args) => storageWrites.push(args) } });
  const boundary = `
    const Renderer = { init() { return true; }, resize() {} };
    const CLOUD_BASE = 1300, CLOUD_TOP = 2200, $bootfallback = null;
    function generateWorld() { return new Promise(() => {}); }
    function findFlatSpot(map, x, z) { return { x: x + 900, z: z + 900, h: 20 }; }
  `;
  vm.runInContext(`(() => { ${boundary}\n${commonSource}\n${sky ? skySource : ''}\n${mainSource}\n${sky ? sceneSource + '\n' + appSource : ''}
    window.__eval = code => eval(code);
  })();`, context);
  const run = code => window.__eval(code);
  const G = window.__PI.G;
  G.map = { heightAt: () => 20, forestAt: () => 0, cloudDensity: () => 0, findScenicSpawn: () => ({ x: 0, z: 0, heading: 0.6 }) };
  run("BOOT.ready = true; G.seed = 1; G.mode = 'title'; setupTitleWorld(); G.camera = buildCamera(computePose(1, false));");
  if (sky) window.__SKY.sync();
  const start = mode => sky ? window.__SKY.start(mode || 'free') : run('startRun()');
  const action = name => browser.nodes.find(element => element.dataset.skyAction === name);
  const click = id => browser.dispatch(browser.byId(id), 'click');
  const input = (kind, knots) => {
    const element = browser.byId(`sky-${kind}-speed`);
    assert(element, `Pause menu needs the real sky-${kind}-speed range`);
    element.value = knots; browser.dispatch(element, 'input');
  };
  const control = (kind, value) => {
    const element = browser.byId({ mouse: 'sky-mouse-steering', enemySpeed: 'sky-enemy-speed', turn: 'sky-turn-rate', turnAuto: 'sky-turn-lock' }[kind]);
    assert(element, `Pause menu needs the real ${kind} control`);
    if (kind === 'mouse' || kind === 'turnAuto') element.checked = value; else element.value = value;
    browser.dispatch(element, kind === 'mouse' || kind === 'turnAuto' ? 'change' : 'input');
  };
  const pause = () => { browser.dispatch(action('pause'), 'click'); assert.equal(G.mode, 'paused'); };
  const resume = () => { click('sky-resume'); assert.equal(G.mode, 'play'); };
  const step = (frames = 1, dt = 1 / 60, wholeGame = false) => {
    for (let i = 0; i < frames; i++) run(`${wholeGame ? 'updateGame' : 'updateFlight'}(${dt})`);
  };
  const key = (code, pressed = true, target = browser.byId('ui')) => browser.dispatch(target, pressed ? 'keydown' : 'keyup', { code });
  const advance = (seconds, dt = 1 / 60) => step(Math.round(seconds / dt), dt, true);
  return { ...browser, run, G, start, action, click, input, control, pause, resume, step, advance, key, storageWrites };
}

function flightState(fixture) {
  const { G } = fixture, p = G.player;
  return plain({ speed: p.speed, pos: p.pos, fuel: p.fuel, burning: p.burning, time: G.time, missionTime: G.missionTime });
}

function finishSortieWave(f) {
  f.run(`{
    while (G.waveSpawned < G.waveTotal) spawnDrone();
    for (const enemy of G.enemies) hitDrone(enemy, enemy.hp, enemy.pos);
    updateGame(1 / 60);
  }`);
  f.window.__SKY?.sync();
}

test('本土防空三关只拦截入侵编队，结束后保留本局数据继续迎击', () => {
  const f = fixture(); f.click('sky-intercept');
  assert.equal(f.G.missionWaveGoal, 3);
  assert.match(f.byId('sky-wave').textContent, /第 1\/3 关/);
  for (const [wave, title, formation] of [
    [1, '无人机入侵', ['drone', 'drone', 'drone', 'drone']],
    [2, '战斗机入侵', ['fighter', 'fighter', 'fighter', 'fighter', 'fighter']],
    [3, '空投突袭', ['drone', 'drone', 'fighter', 'fighter', 'fighter', 'transport']],
  ]) {
    assert.equal(f.G.wave, wave);
    assert.equal(f.G.defenseStage?.title, title);
    assert.equal(f.G.waveTotal, formation.length);
    assert.equal(f.G.ground.length, 0, '只有运输机能投放本次防守任务的地面目标');
    assert(!['sam', 'vehicle'].includes(f.G.secondary?.type));
    f.run('while (G.waveSpawned < G.waveTotal) spawnDrone()');
    assert.deepEqual(Array.from(f.G.enemies, e => e.kind).sort(), formation);
    finishSortieWave(f);
    if (wave < 3) {
      assert.equal(f.G.mode, 'waveclear');
      assert.equal(f.byId('sky-result').hidden, true);
      f.advance(8.1);
    }
  }
  assert.equal(f.G.mode, 'victory');
  assert.equal(f.G.stats.kills, 15);
  assert.equal(f.byId('sky-result-title').textContent, '守卫湖谷成功');
  assert.equal(f.byId('sky-result').hidden, false);
  assert.match(f.byId('sky-result-message').textContent, /三股入侵/);
  assert.equal(f.byId('sky-result-kills').textContent, '15');
  assert.equal(f.byId('sky-result-score').textContent, Math.floor(f.G.score).toLocaleString('en-US'));
  assert.equal(f.document.activeElement, f.byId('sky-again'));
  assert.equal(f.byId('sky-header').inert, true);
  const won = { ...flightState(f), score: f.G.score, player: f.G.player, saves: f.storageWrites.length };
  assert.deepEqual(f.storageWrites.at(-1), ['sky-patrol-hs-v1', String(Math.floor(won.score))]);
  assert.equal(f.G.threatList.length, 0);
  const view = f.G.view;
  for (const key of ['Space', 'Escape', 'KeyR', 'KeyQ', 'KeyE', 'ShiftLeft']) {
    f.key(key); f.key(key, false);
  }
  const tab = f.dispatch(f.byId('sky-result-home'), 'keydown', { code: 'Tab' });
  f.byId('sky-result-home').focus();
  assert.equal(f.dispatch(f.byId('sky-result-home'), 'keydown', { code: 'Tab' }).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.byId('sky-again'));
  assert.equal(tab.immediate, true);
  f.advance(20);
  assert.equal(f.G.view, view);
  assert.equal(f.G.mode, 'victory');
  assert.equal(f.G.score, won.score);
  assert.equal(f.storageWrites.length, won.saves);
  assert.deepEqual(flightState(f), { speed: won.speed, pos: won.pos, fuel: won.fuel, burning: won.burning, time: won.time, missionTime: won.missionTime });
  assert.equal(f.run('INPUT.keys.size'), 0);
  assert.equal(f.byId('sky-continue-challenge').disabled, false);
  f.click('sky-continue-challenge');
  assert.equal(f.G.mode, 'play');
  assert.equal(f.G.wave, 4);
  assert.equal(f.G.missionWaveGoal, 0);
  assert.equal(f.G.defenseStage?.title, '拦截增援');
  assert.match(f.byId('sky-wave').textContent, /第 04 波/);
  assert.equal(f.G.ground.length, 0);
  assert.equal(f.G.stats.kills, 15);
  assert.equal(f.G.score, won.score);
  assert.equal(f.G.player, won.player);
  assert.deepEqual([f.G.player.shield, f.G.player.fuel, f.G.player.missiles, f.G.player.flares], [100, 100, 4, 3]);
  assert.equal(f.byId('sky-result').hidden, true);
  assert.equal(f.byId('sky-header').inert, false);
  finishSortieWave(f);
  assert.equal(f.G.mode, 'waveclear', '继续挑战按原波次规则补给');
  f.window.__SKY.restart();
  assert.equal(f.G.missionWaveGoal, 3);
  assert.equal(f.G.wave, 1);
  assert.equal(f.G.score, 0);
});

test('本土防空最终关需清除已投装甲，空中全灭时保持可飞行', () => {
  const f = fixture(); f.click('sky-intercept'); f.run('beginWave(3)');
  f.run(`G.ground.push({ type: 'vehicle', kind: 'vehicle', isGround: true, hp: 80,
    dead: false, pos: { x: 500, y: 20, z: -500 }, yaw: 0, patrolYaw: 0, fireCd: 1.5, flashT: 0 });`);
  finishSortieWave(f);
  assert.equal(f.G.waveKills, f.G.waveTotal);
  assert.equal(f.G.mode, 'play');
  assert.equal(f.byId('sky-result').hidden, true);
  assert.equal(f.byId('sky-armor-status').textContent, '剩余 1');
  f.run('hitGround(G.ground[0], 130); updateGame(1 / 60)');
  f.window.__SKY.sync();
  assert.equal(f.G.mode, 'victory');
  assert.equal(f.G.stats.veh, 1);
  assert.equal(f.byId('sky-result-kills').textContent, '7');
});

test('结算按 Enter 再次出航，失败与巡航保持各自路线，原版第三波继续挑战', () => {
  const f = fixture(); f.click('sky-intercept');
  f.run('beginWave(3)'); finishSortieWave(f);
  assert.equal(f.G.mode, 'victory');
  f.key('Enter'); f.key('Enter', false);
  assert.equal(f.G.mode, 'play');
  assert.equal(f.G.wave, 1);
  assert.equal(f.G.missionWaveGoal, 3);
  f.run('killPlayer()'); f.advance(2); f.window.__SKY.sync();
  assert.equal(f.G.mode, 'failed');
  assert.equal(f.byId('sky-result-title').textContent, '本次航程结束');
  assert.equal(f.byId('sky-continue-challenge').hidden, true);
  f.click('sky-result-home');
  assert.equal(f.G.mode, 'title');
  assert.equal(f.G.missionWaveGoal, 0);
  assert.equal(f.G.defenseStage, null);
  f.click('sky-cruise');
  f.advance(2);
  assert.equal(f.G.mode, 'play');
  assert.equal(f.G.missionWaveGoal, 0);
  assert.equal(f.G.defenseStage, null);
  assert.equal(f.G.enemies.length, 0);
  const original = fixture(false); original.start();
  original.run('beginWave(3)'); finishSortieWave(original);
  assert(original.G.ground.some(g => g.type === 'sam'), '旧美术入口继续使用原波次规则');
  assert.equal(original.G.mode, 'waveclear');
  original.advance(8.1);
  assert.equal(original.G.wave, 4);
  assert.equal(original.G.mode, 'play');
});

test('起步300档保留原100节的世界位移，HUD报实速而非把设定值当空速', () => {
  const f = fixture(); f.start();
  const p = f.G.player, origin = { ...p.pos };
  f.advance(1); f.window.__SKY.sync();
  near(Math.hypot(p.pos.x-origin.x, p.pos.y-origin.y, p.pos.z-origin.z), 100 / KNOTS_PER_MS, 1e-5);
  assert.equal(f.byId('sky-speed').textContent, '100');
  f.pause(); assert.equal(+f.byId('sky-cruise-speed').value, 300);
});

test('两条速度滑块共用刻度，巡航往返与触顶保留所选加力余量', () => {
  const f = fixture(); f.start(); f.pause();
  const value = () => +f.byId('sky-burn-speed').value;
  f.input('cruise', 498); assert.equal(value(), 698);
  f.input('burn', 800); f.input('cruise', 1400); assert.equal(value(), 1500);
  f.input('cruise', 498); assert.equal(value(), 800);
  f.input('cruise', 300); assert.equal(value(), 602);
  assert.equal(f.byId('sky-cruise-speed').min, f.byId('sky-burn-speed').min);
});

test('1200档才首次满转向，且加力中敌机和玩家均取当前空速的转弯半径', () => {
  const f = fixture(); f.start(); f.pause();
  for (const [dial, rate] of [[300,30],[800,80],[876,88],[1199,119],[1200,120],[1500,120]]) {
    f.input('cruise',dial); assert.equal(+f.byId('sky-turn-rate').value, rate, `巡航 ${dial} 档`);
  }
  f.click('sky-speed-reset'); f.input('burn', 1500); f.click('sky-restart');
  const p = f.G.player; f.key('ShiftLeft'); f.key('KeyD'); f.advance(4);
  near(Math.abs(p.yawRate) * 180/Math.PI, 120, .2);
  near(f.run('defensePlayerTurnRadius(G.player)'), p.speed/(120*Math.PI/180), 1e-6);
});

test('默认Shift前半秒已跑过一半速差，且一秒位移超过同线巡航的两倍', () => {
  const flight = boost => { const f = fixture(); f.start(); const p = f.G.player, origin = { ...p.pos }, start = p.speed;
    if (boost) f.key('ShiftLeft'); f.advance(.5); const fraction = (p.speed - start) / (p.burnSpeed - start);
    f.advance(.5); return { fraction, distance: Math.hypot(p.pos.x-origin.x,p.pos.y-origin.y,p.pos.z-origin.z) }; };
  const fast=flight(true); assert(fast.fraction > .5 && fast.fraction < 1);
  assert(fast.distance > flight(false).distance * 2);
});

test('暂停菜单暴露1500节速度上限与独立的原生转向滑块', () => {
  const f = fixture(); f.start(); f.pause();
  for (const [kind, min, max, display] of [['cruise', 300, 1500, 300], ['burn', 300, 1500, 500]]) {
    const input = f.byId(`sky-${kind}-speed`), output = f.byId(`sky-${kind}-speed-value`);
    assert(input, `真实暂停菜单缺少 sky-${kind}-speed`);
    assert.equal(input.tagName, 'INPUT'); assert.equal(input.type, 'range');
    assert.equal(Number(input.min), min); assert.equal(Number(input.max), max); assert.equal(Number(input.step), 1);
    assert.equal(Number(input.value), display);
    assert(output, `真实暂停菜单缺少 sky-${kind}-speed-value`);
    assert.equal(output.tagName, 'OUTPUT'); assert.equal(Number.parseInt(output.textContent, 10), display);
    assert.match(output.textContent, /节/); assert.match(input.getAttribute('aria-valuetext') || '', /节/);
    assert(f.nodes.some(element => element.tagName === 'LABEL' && element.getAttribute('for') === input.id), `${kind} needs an associated label`);
    assert(f.byId('sky-pause').contains(input));
    assert.equal(input.disabled, false);
  }
  const turn = f.byId('sky-turn-rate'), lock = f.byId('sky-turn-lock');
  assert.equal(turn?.type, 'range');
  assert.deepEqual([turn.min, turn.max, turn.step, turn.value].map(Number), [8, 120, 1, 30]);
  assert.equal(turn.disabled, true, '默认转向由速度锁定，不能直接拖动');
  assert.equal(lock?.type, 'checkbox'); assert.equal(lock.checked, true); assert.equal(lock.disabled, false);
  assert.equal(turn.getAttribute('aria-valuetext'), '30°/秒 · 随速度');
  assert.equal(f.byId('sky-turn-rate-value').textContent, '30°/秒 · 随速度');
  assert(f.nodes.some(element => element.tagName === 'LABEL' && element.getAttribute('for') === turn.id));
  assert(f.nodes.some(element => element.tagName === 'LABEL' && element.getAttribute('for') === lock.id));
  assert.equal(f.byId('sky-speed-reset')?.tagName, 'BUTTON');
  assert.equal(f.byId('sky-speed-reset').disabled, false);
  assert.equal(dom(shells.original).byId('sky-cruise-speed'), null, '原入口不增加调速设置');
});

test('转向默认锁定巡航速度并跟随滑块，解锁后按固定角速度手动设置', () => {
  const f = fixture(); f.start(); f.pause();
  const turn = f.byId('sky-turn-rate'), lock = f.byId('sky-turn-lock');
  f.input('cruise', 500);
  assert.equal(Number(turn.value), 50, '巡航变快后转向滑块应自动跟随');
  assert.match(f.byId('sky-turn-rate-value').textContent, /50°\/秒.*随速度/);
  assert.equal(turn.disabled, true);
  near(f.G.player.turnRateAtSpeed(500 / KNOTS_PER_MS), 50 * Math.PI / 180);

  f.control('turnAuto', false);
  assert.equal(turn.disabled, false); assert.equal(lock.checked, false);
  assert.equal(f.G.player.turnRateAtSpeed, null, '解锁后不再跟随速度');
  f.control('turn', 45);
  assert.equal(Number(turn.value), 45);
  near(f.G.player.turnRateLimit, 45 * Math.PI / 180);
  f.input('cruise', 320);
  assert.equal(Number(turn.value), 45, '解锁后巡航变化不再改写转向');

  f.control('turnAuto', true);
  assert.equal(turn.disabled, true); assert.equal(Number(turn.value), 32);
  near(f.G.player.turnRateAtSpeed(140 / KNOTS_PER_MS), 32 * Math.PI / 180);
});

test('原入口保留112/204；新版关闭可选响应后共享公式逐帧速度、燃油、位移一致', () => {
  const original = fixture(false), sky = fixture(); original.start(); sky.start();
  assert.equal(original.G.player.cruiseSpeed, undefined); assert.equal(original.G.player.burnSpeed, undefined);
  assert.equal(original.G.player.speed, 112); assert.equal(original.run('SPEED_BURN'), 204);
  near(sky.G.player.cruiseSpeed * KNOTS_PER_MS, 100); near(sky.G.player.burnSpeed * KNOTS_PER_MS, 500);
  sky.run('G.player.cruiseSpeed = 112; G.player.burnSpeed = 204; G.player.speed = G.player.targetSpeed = 112; delete G.player.burnAcceleration; delete G.player.speedResponse; G.player.mouseSteering = true; G.player.flightComfort = false; G.player.pitch = 0.02;');
  for (let frame = 0; frame < 360; frame++) {
    if ([30, 200].includes(frame)) { original.key('ShiftLeft'); sky.key('ShiftLeft'); }
    if ([110, 250].includes(frame)) { original.key('ShiftLeft', false); sky.key('ShiftLeft', false); }
    original.step(); sky.step();
    assert.deepEqual(flightState(sky), flightState(original), `默认飞行在第 ${frame + 1} 帧改变`);
  }
  assert.equal(sky.run('SPEED_CRUISE'), 112); assert.equal(sky.run('SPEED_BURN'), 204);
});

test('暂停改参数不推进位置、空速、燃油或仿真时钟，且设置不写入存储', () => {
  const f = fixture(); f.start(); f.step(20, 1 / 60, true); f.pause();
  const before = flightState(f);
  f.input('cruise', 300); f.input('burn', 480);
  f.step(120, 1 / 60, true);
  assert.deepEqual(flightState(f), before);
  near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 100);
  near(f.G.player.burnSpeed * KNOTS_PER_MS, 460);
  assert.equal(Number.parseInt(f.byId('sky-cruise-speed-value').textContent, 10), 300);
  assert.equal(Number.parseInt(f.byId('sky-burn-speed-value').textContent, 10), 480);
  assert.equal(f.storageWrites.length, 0, '调速应仅保留在当前页面');
});

test('巡航/加力上下界与联动有效，NaN、Infinity、无效类型不污染参数', () => {
  const f = fixture(); f.start(); f.pause();
  f.input('burn', 220); f.input('cruise', 300);
  near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 100);
  near(f.G.player.burnSpeed * KNOTS_PER_MS, 200, 1e-9, '提高巡航时加力至少保留50节余量');
  assert.equal(Number(f.byId('sky-burn-speed').min), 300, '加力滑块范围固定，不随巡航移动');
  assert.equal(Number(f.byId('sky-burn-speed').value), 350);
  f.run("skySetFlightSpeed('burn', 0)");
  near(f.G.player.burnSpeed * KNOTS_PER_MS, 200, 1e-9, '加力不能低于巡航加50节');
  f.run("skySetFlightSpeed('cruise', -10)");
  near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 100);
  near(f.G.player.burnSpeed * KNOTS_PER_MS, 200, 1e-9, '降低巡航不自动降低加力');
  f.input('cruise', 1470); f.input('burn', 1471);
  near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 1470); near(f.G.player.burnSpeed * KNOTS_PER_MS, 1500);
  assert.equal(f.byId('sky-burn-speed').disabled, true, '余量顶到1500节时加力滑块锁定');
  f.run("skySetFlightSpeed('cruise', 1999)");
  near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 1500); near(f.G.player.burnSpeed * KNOTS_PER_MS, 1500);
  assert.equal(f.byId('sky-burn-speed').disabled, true);
  f.run("skySetFlightSpeed('burn', 1999)");
  near(f.G.player.burnSpeed * KNOTS_PER_MS, 1500);
  const before = [f.G.player.cruiseSpeed, f.G.player.burnSpeed];
  for (const call of ["('cruise', NaN)", "('burn', Infinity)", "('cruise', -Infinity)", "('burn', 'not-a-number')", "('unknown', 200)"]) {
    f.run(`skySetFlightSpeed${call}`);
    assert.deepEqual([f.G.player.cruiseSpeed, f.G.player.burnSpeed], before, `${call} 应保持有效的原参数`);
  }
});

test('恢复默认回到300节巡航和500节加力，不从显示值反推', () => {
  const f = fixture(); f.start(); f.pause();
  const before = flightState(f);
  f.input('cruise', 340); f.input('burn', 430); f.control('turnAuto', false); f.control('turn', 46); f.click('sky-speed-reset');
  assert.equal(f.G.player.cruiseSpeed, 100 / KNOTS_PER_MS); assert.equal(f.G.player.burnSpeed, 500 / KNOTS_PER_MS);
  assert.equal(Number(f.byId('sky-cruise-speed').value), 300);
  assert.equal(Number(f.byId('sky-burn-speed').value), 500);
  assert.equal(Number(f.byId('sky-burn-speed').min), 300);
  near(f.G.player.turnRateLimit, 30 * Math.PI / 180);
  assert.equal(Number(f.byId('sky-turn-rate').value), 30);
  assert.equal(f.byId('sky-turn-lock').checked, true, '恢复默认应重新锁定转向');
  assert.deepEqual(flightState(f), before, '恢复目标值同样不能修改当前空速');
  f.resume(); f.window.__SKY.restart();
  assert.equal(f.G.player.speed, 100 / KNOTS_PER_MS); assert.equal(f.G.player.targetSpeed, 100 / KNOTS_PER_MS);
  assert.equal(f.G.player.cruiseSpeed, 100 / KNOTS_PER_MS); assert.equal(f.G.player.burnSpeed, 500 / KNOTS_PER_MS);
});

test('正式飞行中设置接口和隐藏控件不能改参数或意外恢复默认', () => {
  const f = fixture(); f.start(); f.pause(); f.input('cruise', 310); f.input('burn', 470); f.resume();
  const before = [f.G.player.cruiseSpeed, f.G.player.burnSpeed];
  f.run("skySetFlightSpeed('cruise', 100); skyResetFlightSpeeds();");
  f.input('cruise', 100); f.click('sky-speed-reset');
  assert.deepEqual([f.G.player.cruiseSpeed, f.G.player.burnSpeed], before);
});

test('继续飞行后巡航加速、加力和下调上限都连续，HUD显示实际空速', () => {
  const f = fixture(); f.start(); f.pause();
  const before = f.G.player.speed;
  f.input('cruise', 500); f.input('burn', 550); f.resume(); f.step();
  near(f.G.player.speed, before + (500 / KNOTS_PER_MS - before) * (1 - Math.exp(-1.6 / 60)), 1e-8, '首帧按实际速度平滑过渡');
  f.step(179); assert(f.G.player.speed > 240, '巡航改值后约三秒应形成明显速度差');
  f.step(1021); near(f.G.player.speed * KNOTS_PER_MS, 500, 0.005, '应收敛到新巡航');
  const cruise = f.G.player.speed;
  f.key('ShiftLeft'); f.step();
  assert(f.G.player.burning); near(f.G.player.speed - cruise, 62 / 60, 1e-9, '保留原加力加速度');
  f.step(120); near(f.G.player.speed * KNOTS_PER_MS, 550, 0.005, '加力达到所选上限');
  assert(f.G.player.fuel < 100);
  f.pause(); const fast = f.G.player.speed;
  f.input('cruise', 300); f.input('burn', 350);
  assert.equal(f.G.player.speed, fast, '降低上限不能在暂停中截断速度');
  f.resume(); f.key('ShiftLeft'); f.step();
  near(f.G.player.speed, fast + (200 / KNOTS_PER_MS - fast) * (1 - Math.exp(-1.6 / 60)), 1e-8, '超过新的上限时按住加力也不瞬间截断');
  f.window.__SKY.sync();
  assert.equal(Number(f.byId('sky-speed').textContent), Math.round(f.G.player.speed * KNOTS_PER_MS), 'HUD使用当前空速');
  assert.notEqual(Number(f.byId('sky-speed').textContent), 300, 'HUD不能直接显示新的目标上限');
  f.key('ShiftLeft', false); const released = f.G.player.speed; f.step();
  assert(!f.G.player.burning && f.G.player.speed < released && f.G.player.speed > 100 / KNOTS_PER_MS);
  f.step(1200); near(f.G.player.speed * KNOTS_PER_MS, 100, 0.005, '松开加力后回300档的真实巡航空速');
});

test('Shift和触屏加力使用同一设定，松开与燃油不足时回巡航', () => {
  const f = fixture(); f.start(); f.pause(); f.input('cruise', 300); f.input('burn', 420); f.resume();
  f.step(1200);
  f.dispatch(f.action('boost'), 'pointerdown', { pointerType: 'touch', pointerId: 8 }); f.step();
  assert(f.G.player.burning); near(f.G.player.targetSpeed * KNOTS_PER_MS, 340);
  f.dispatch(f.document.body, 'pointerup', { pointerType: 'touch', pointerId: 8 }); f.step();
  assert(!f.G.player.burning); near(f.G.player.targetSpeed * KNOTS_PER_MS, 100);
  f.key('ShiftLeft'); f.G.player.fuel = 0.6; f.step();
  assert(f.G.player.burning && f.G.player.fuel < 0.5, '仍沿用原耗油率和加力阈值');
  const before = f.G.player.speed; f.step();
  assert(!f.G.player.burning, '燃油不足时不能继续加力');
  near(f.G.player.targetSpeed * KNOTS_PER_MS, 100);
  assert(f.G.player.speed < before && f.G.player.speed > 100 / KNOTS_PER_MS, '燃油不足也应平滑回巡航');
  f.key('ShiftLeft', false);
});

test('重开、再次出航、截击/巡航和草谷切换保留参数并以自选巡航起飞', () => {
  const f = fixture(); f.start(); f.pause(); f.input('cruise', 320); f.input('burn', 483); f.control('turnAuto', false); f.control('turn', 45);
  const verify = () => {
    assert.equal(f.G.mode, 'play');
    near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 140);
    near(f.G.player.burnSpeed * KNOTS_PER_MS, 466);
    near(f.G.player.turnRateLimit, Math.PI / 4);
    assert.equal(f.G.player.speed, f.G.player.cruiseSpeed); assert.equal(f.G.player.targetSpeed, f.G.player.cruiseSpeed);
  };
  f.click('sky-restart'); verify();
  f.window.__SKY.start('intercept'); verify(); assert.equal(f.G.enemies.length, 3);
  f.window.__SKY.start('free'); verify(); assert.equal(f.G.enemies.length, 0);
  f.G.mode = 'failed'; f.G.failTimer = 1; f.window.__SKY.sync(); f.click('sky-again'); verify();
  f.window.__SKY.home(); f.click('sky-inland'); verify(); assert.equal(f.G.player.agl, 125);
  f.window.__SKY.restart(); verify(); assert.equal(f.G.player.agl, 125);
});

test('返回待命的演示飞机不携带参数，页面内保留设置而新页面恢复默认', () => {
  const f = fixture(); f.start(); f.pause(); f.input('cruise', 333); f.input('burn', 467); f.window.__SKY.home();
  assert.equal(f.G.mode, 'title'); assert.equal(f.G.player.cruiseSpeed, undefined); assert.equal(f.G.player.burnSpeed, undefined);
  f.step(1, 1 / 60, true); assert.equal(f.G.player.speed, 92, '待命仍沿用演示空速');
  f.click('sky-cruise'); near(f.G.player.speed * KNOTS_PER_MS, 166); near(f.G.player.burnSpeed * KNOTS_PER_MS, 434);
  const refreshed = fixture(); refreshed.start();
  assert.equal(refreshed.G.player.speed, 100 / KNOTS_PER_MS); assert.equal(refreshed.G.player.burnSpeed, 500 / KNOTS_PER_MS);
});

test('暂停焦点循环包含滑块，方向键保留原生行为，Esc恢复清空输入与焦点', () => {
  const f = fixture(); f.start(); f.key('ShiftLeft'); f.pause();
  assert.equal(f.run('INPUT.keys.size'), 0);
  f.control('turnAuto', false);
  const modal = f.byId('sky-pause');
  const controls = modal.querySelectorAll('button, input').filter(element => !element.disabled);
  assert.equal(controls[0].id, 'sky-resume'); assert.equal(controls.at(-1).id, 'sky-home');
  for (const id of ['sky-cruise-speed', 'sky-burn-speed', 'sky-turn-rate', 'sky-turn-lock', 'sky-speed-reset', 'sky-enemy-speed', 'sky-mouse-steering', 'sky-wingman', 'sky-ai-enabled', 'sky-restart'])
    assert(controls.some(element => element.id === id), `${id}应包含在暂停焦点循环内`);
  for (const id of ['sky-ai-endpoint', 'sky-ai-model', 'sky-ai-key', 'sky-ai-test'])
    assert(!controls.some(element => element.id === id), `${id}在 AI 关闭时不能进入焦点循环`);
  assert.equal(f.document.activeElement, f.byId('sky-resume'));
  f.byId('sky-home').focus();
  assert(f.dispatch(f.byId('sky-home'), 'keydown', { code: 'Tab' }).defaultPrevented);
  assert.equal(f.document.activeElement, f.byId('sky-resume'));
  assert(f.dispatch(f.byId('sky-resume'), 'keydown', { code: 'Tab', shiftKey: true }).defaultPrevented);
  assert.equal(f.document.activeElement, f.byId('sky-home'));
  for (const id of ['sky-cruise-speed', 'sky-burn-speed', 'sky-turn-rate']) {
    const slider = f.byId(id); slider.focus();
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      const event = f.key(code, true, slider);
      assert(!event.defaultPrevented, `${code}应交给浏览器原生滑块`);
      assert.equal(f.run('INPUT.keys.size'), 0, `${code}不能进入飞行输入`);
      f.key(code, false, slider);
    }
    assert.equal(f.G.mode, 'paused');
  }
  f.key('Escape', true, f.byId('sky-burn-speed'));
  assert.equal(f.G.mode, 'play'); assert.equal(f.run('INPUT.keys.size'), 0);
  assert(!modal.contains(f.document.activeElement), '恢复后焦点不能留在隐藏的暂停控件');
  f.step(); assert.equal(f.G.player.burning, false, '暂停前按住Shift不能粘到恢复后');
  assert.equal(f.run('INPUT.left || INPUT.touchBurn || INPUT.touchGun || TOUCH.active'), false);
});

test('座舱扩展量程后的指针仍按实际节数绘制，数字窗不显示目标上限', () => {
  const f = fixture(); f.start(); f.pause(); f.input('burn', 500);
  f.G.player.speed = 480 / KNOTS_PER_MS;
  f.run(`
    window.__dialNeedles = []; window.__dialText = [];
    const speedTestLine = line, speedTestText = drawText;
    line = function (...args) {
      if (args[4] === '#e8d6a4' && args[5] === 1.4) window.__dialNeedles.push(args);
      return speedTestLine(...args);
    };
    drawText = function (...args) { window.__dialText.push(args); return speedTestText(...args); };
  `);
  const draw = () => {
    f.run('window.__dialNeedles.length = window.__dialText.length = 0; skyCockpitPanel(G.player, 0, 0);');
    const needle = f.window.__dialNeedles[0];
    assert(needle, '实际座舱绘制缺少空速指针');
    // Read the drawn needle through its established 140°..400° sweep.
    const degrees = Math.atan2(needle[3] - needle[1], needle[2] - needle[0]) * 180 / Math.PI;
    const fraction = ((degrees - 140 + 360) % 360) / 260;
    const text = f.window.__dialText.map(args => String(args[0]));
    assert(text.includes('480'), '数字窗必须显示实际480节');
    return { fraction, text };
  };
  const expanded = draw(); near(expanded.fraction * 500, 480, 1e-8, '500节量程中480节指针不应顶格');
  assert(expanded.text.includes('KT/500'), '扩大空速量程时盘面须显示500节满量程');
  f.input('burn', 300);
  const standard = draw(); near(standard.fraction, 1, 1e-9, '降低量程后超量程指针停在末端');
  assert(standard.text.includes('KT'), '默认450节量程保留原KT标签');
  assert.equal(f.G.player.speed, 480 / KNOTS_PER_MS, '切换仪表量程不改变实际空速');
});

test('暂停按钮和滑块焦点保留M音效快捷键，重复事件不二次切换且恢复无粘键', () => {
  const f = fixture(); f.start();
  assert.equal(f.G.sound, false);
  f.key('KeyM'); assert.equal(f.G.sound, true, '起飞后M应开启音效');
  f.key('KeyM', false); f.pause();
  for (const id of ['sky-resume', 'sky-cruise-speed', 'sky-burn-speed']) {
    const target = f.byId(id), before = f.G.sound; target.focus();
    f.key('KeyM', true, target);
    assert.equal(f.G.sound, !before, `${id}焦点上的M应切换音效`);
    assert.equal(f.G.mode, 'paused', '音效快捷键不能恢复飞行');
    assert.equal(f.run('INPUT.keys.size'), 0, '暂停M不能积累飞行输入');
    f.dispatch(target, 'keydown', { code: 'KeyM', repeat: true });
    assert.equal(f.G.sound, !before, '按住M产生的重复事件不能二次切换');
    assert.equal(f.G.mode, 'paused'); assert.equal(f.run('INPUT.keys.size'), 0);
    if (id !== 'sky-burn-speed') f.key('KeyM', false, target);
  }
  const sound = f.G.sound;
  f.resume(); assert.equal(f.run('INPUT.keys.size'), 0, '恢复不能继承尚未松开的M');
  f.key('KeyM', false); f.step();
  assert.equal(f.G.sound, sound, '恢复和松键不能额外切换音效');
  assert.equal(f.run('INPUT.keys.size'), 0);
  assert.equal(f.run('INPUT.left || INPUT.touchBurn || INPUT.touchGun || TOUCH.active'), false);
  assert.equal(f.G.player.burning, false);
});

test('主界面设置可直接打开，关闭返回待命且不启动航次', () => {
  const f = fixture();
  const button = f.byId('sky-settings');
  assert(button, '三项出航按钮旁需要设置入口');
  assert.equal(button.disabled, false);
  const before = flightState(f);
  f.click('sky-settings');
  assert.equal(f.G.mode, 'paused');
  assert.equal(f.G.pausedFrom, 'title');
  assert.equal(f.byId('sky-pause').hidden, false);
  assert.equal(f.byId('sky-pause-title').textContent, '设置');
  assert.equal(f.byId('sky-resume').textContent, '返回主界面');
  assert.equal(f.byId('sky-pause-flight-actions').hidden, true);
  assert.equal(f.byId('sky-restart').disabled, true);
  assert.equal(f.byId('sky-home').disabled, true);
  assert.equal(f.byId('sky-combat').hidden, true, '起飞前设置不显示战役进度');
  assert.equal(f.byId('sky-app').dataset.hud, 'shell');
  f.run(`drawWorldOverlay = drawCockpit = drawScreenFeedback = () => {};
    drawTitle = () => { window.__titleDrawn = true; };
    drawHUD = () => { window.__flightHudDrawn = true; }; drawUIFrame();`);
  assert.equal(f.window.__titleDrawn, true);
  assert.notEqual(f.window.__flightHudDrawn, true);
  assert.equal(f.document.activeElement, f.byId('sky-resume'));
  f.advance(2);
  assert.deepEqual(flightState(f), before, '设置期间待命场景和任务时间冻结');
  f.click('sky-resume');
  assert.equal(f.G.mode, 'title');
  assert.equal(f.G.pausedFrom, null);
  assert.equal(f.byId('sky-pause').hidden, true);
  assert.equal(f.document.activeElement, button);
  assert.equal(f.G.allies.length, 0);
});

test('起飞前配置留给下一航次，待命不应用飞行参数或生成僚机', () => {
  const f = fixture();
  assert(f.byId('sky-settings'));
  f.click('sky-settings');
  f.input('cruise', 500); f.input('burn', 900);
  f.control('turnAuto', false); f.control('turn', 45);
  f.control('mouse', true); f.control('enemySpeed', 80);
  const volume = f.byId('sky-volume'); volume.value = 70; f.dispatch(volume, 'input');
  for (const id of ['sky-wingman', 'sky-ai-enabled']) {
    const input = f.byId(id); input.checked = true; f.dispatch(input, 'change');
  }
  assert.equal(f.byId('sky-ai-details').hidden, false);
  assert.equal(f.byId('sky-ai-endpoint').disabled, false);
  assert.equal(f.byId('sky-ai-test').disabled, false);
  assert.equal(f.G.player.cruiseSpeed, undefined, '待命演示不携带正式飞行参数');
  assert.equal(f.G.player.mouseSteering, undefined);
  assert.equal(f.G.allies.length, 0, '勾选僚机只保存偏好，起飞后才出生');
  assert.equal(f.run('WingmanAdvisor.runtime.requests'), 0);
  f.key('Escape');
  f.start('free');
  near(f.G.player.cruiseSpeed * KNOTS_PER_MS, 500);
  near(f.G.player.burnSpeed * KNOTS_PER_MS, 900);
  near(f.G.player.turnRateLimit / (Math.PI / 180), 45);
  assert.equal(f.G.player.mouseSteering, true);
  assert.equal(f.G.enemySpeedScale, .8);
  assert.equal(f.G.volume, .7);
  assert.equal(f.G.allies.length, 1);
  assert.equal(f.storageWrites.length, 0);
  f.pause();
  assert.equal(f.byId('sky-pause-title').textContent, '航程暂停');
  assert.equal(f.byId('sky-resume').textContent, '继续飞行');
  assert.equal(f.byId('sky-pause-flight-actions').hidden, false);
  f.resume();
});

test('主界面设置保留输入框编辑和Tab焦点圈，Esc关闭后不会误起飞', () => {
  const f = fixture();
  assert(f.byId('sky-settings'));
  f.click('sky-settings');
  const last = f.byId('sky-ai-enabled'), resume = f.byId('sky-resume');
  last.focus(); f.dispatch(last, 'keydown', { code: 'Tab' });
  assert.equal(f.document.activeElement, resume);
  f.dispatch(resume, 'keydown', { code: 'Tab', shiftKey: true });
  assert.equal(f.document.activeElement, last, '隐藏的飞行操作不进入焦点圈');
  last.checked = true; f.dispatch(last, 'change');
  const key = f.byId('sky-ai-key'), sound = f.G.sound;
  key.focus();
  for (const code of ['KeyM', 'KeyP', 'Enter', 'Space']) {
    const event = f.key(code, true, key);
    assert(!event.defaultPrevented);
    assert.equal(f.G.mode, 'paused');
  }
  assert.equal(f.G.sound, sound);
  f.key('Escape', true, key);
  assert.equal(f.G.mode, 'title');
  assert.equal(f.document.activeElement, f.byId('sky-settings'));
  assert.equal(f.run('INPUT.keys.size'), 0);
});

test('辅助僚机默认关闭，开启后一局一架并在重开/换模式时保留', () => {
  const f = fixture(); f.start('intercept'); f.pause();
  assert.equal(f.G.allies.length, 0);
  assert.equal(f.byId('sky-wingman').checked, false);
  assert.equal(f.byId('sky-wingman').disabled, false);
  assert.equal(f.byId('sky-ai-enabled').checked, false);
  assert.equal(f.byId('sky-ai-details').hidden, true);
  assert.equal(f.byId('sky-ai-status').textContent, '关闭');
  f.byId('sky-wingman').checked = true;
  f.dispatch(f.byId('sky-wingman'), 'change');
  assert.equal(f.G.wingmanWanted, true);
  assert.equal(f.G.allies.length, 1);
  f.click('sky-restart');
  assert.equal(f.G.allies.length, 1, '重开应继续带僚机');
  f.pause();
  f.click('sky-home');
  assert.equal(f.G.allies.length, 0, '回待命应清空僚机');
  assert.equal(f.G.wingmanWanted, true, '页面内保留开关');
  f.start('intercept');
  assert.equal(f.G.allies.length, 1, '再次出航应恢复僚机');
  assert.equal(f.storageWrites.length, 0, '僚机设置不写本地存储');
});

test('AI 接入默认关闭，展开后可填写配置；文本框不触发 M/P/Enter 快捷键', () => {
  const f = fixture(); f.start('intercept'); f.pause();
  f.byId('sky-ai-enabled').checked = true;
  f.dispatch(f.byId('sky-ai-enabled'), 'change');
  assert.equal(f.byId('sky-ai-details').hidden, false);
  assert.equal(f.byId('sky-ai-endpoint').disabled, false);
  assert.equal(f.byId('sky-ai-model').disabled, false);
  assert.equal(f.byId('sky-ai-key').disabled, false);
  assert.equal(f.byId('sky-ai-test').disabled, false);
  assert.equal(f.byId('sky-ai-status').textContent, '待配置');
  f.byId('sky-ai-endpoint').value = 'https://api.example.com/v1';
  f.dispatch(f.byId('sky-ai-endpoint'), 'change');
  f.byId('sky-ai-model').value = 'test-model';
  f.dispatch(f.byId('sky-ai-model'), 'change');
  f.byId('sky-ai-key').value = 'sk-page-memory-only';
  f.dispatch(f.byId('sky-ai-key'), 'input');
  assert.equal(f.storageWrites.length, 0, 'Key 与端点不得写入存储');

  const key = f.byId('sky-ai-key');
  key.focus();
  const sound = f.G.sound;
  for (const code of ['KeyM', 'KeyP', 'Enter', 'NumpadEnter', 'Space']) {
    const event = f.dispatch(key, 'keydown', { code });
    assert(!event.defaultPrevented, `${code} 应保留输入框原生行为`);
    assert.equal(event.immediate, true, `${code} 不能继续进入游戏快捷键`);
    assert.equal(f.G.mode, 'paused');
  }
  assert.equal(f.G.sound, sound, '输入 Key 时 M 不能切换音效');
  assert.equal(f.run('INPUT.keys.size'), 0);
  const escape = f.dispatch(key, 'keydown', { code: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.G.mode, 'play', 'Escape 仍可关闭暂停');

  f.pause();
  f.byId('sky-ai-enabled').checked = false;
  f.dispatch(f.byId('sky-ai-enabled'), 'change');
  assert.equal(f.byId('sky-ai-details').hidden, true);
  assert.equal(f.document.activeElement, f.byId('sky-ai-enabled'), '关闭 AI 后焦点回到总开关');
});

test('暂停鼠标/敌机设置默认关闭和65%，只在暂停修改，速度恢复不重置操纵设置', () => {
  const f = fixture(); f.start(); f.pause();
  const mouse = f.byId('sky-mouse-steering'), enemy = f.byId('sky-enemy-speed');
  assert.equal(mouse?.type, 'checkbox'); assert.equal(mouse.checked, false);
  assert.equal(enemy?.type, 'range');
  assert.deepEqual([Number(enemy.min), Number(enemy.max), Number(enemy.step), Number(enemy.value)], [30, 120, 5, 65]);
  assert.match(f.byId('sky-enemy-speed-value')?.textContent || '', /65.*%/);
  assert.equal(f.G.enemySpeedScale, .65);
  f.control('mouse', true); f.control('enemySpeed', 85); f.click('sky-speed-reset');
  assert.equal(f.G.player.mouseSteering, true); assert.equal(f.G.enemySpeedScale, .85);
  f.resume(); f.run("skySetControlSetting('mouse', false); skySetControlSetting('enemySpeed', 30);");
  assert.equal(f.G.player.mouseSteering, true); assert.equal(f.G.enemySpeedScale, .85);
  f.window.__SKY.restart(); assert.equal(f.G.player.mouseSteering, true); assert.equal(f.G.enemySpeedScale, .85);
  f.pause(); f.run("skySetControlSetting('enemySpeed', 0)"); assert.equal(f.G.enemySpeedScale, .3);
  f.run("skySetControlSetting('enemySpeed', 999)"); assert.equal(f.G.enemySpeedScale, 1.2);
  f.run("skySetControlSetting('enemySpeed', NaN)"); assert.equal(f.G.enemySpeedScale, 1.2);
  const refreshed = fixture(); refreshed.start();
  assert.equal(refreshed.G.player.mouseSteering, false); assert.equal(refreshed.G.enemySpeedScale, .65);
});

test('新版三视角默认鼠标不转向，开启后转向；键盘、触屏和鼠标开火仍可用', () => {
  for (const view of ['chase', 'top', 'cockpit']) {
    const f = fixture(); f.start(); f.run(`setViewName('${view}'); G.viewBlend = 1;`);
    assert.equal(f.G.player.mouseSteering, false);
    const before = { yaw: f.G.player.yaw, pitch: f.G.player.pitch };
    const move = () => f.dispatch(f.byId('ui'), 'pointermove', { clientX: 1190, clientY: 180 });
    for (let i = 0; i < 30; i++) { move(); f.step(); }
    near(f.G.player.yaw, before.yaw, 1e-9, `${view}默认鼠标不改变航向`);
    assert(Math.abs(f.G.player.pitch) <= Math.abs(before.pitch) + 1e-9, `${view}默认鼠标不拉升机头`);
    const shots = f.G.stats.shots;
    f.dispatch(f.byId('ui'), 'mousedown'); f.dispatch(f.document.body, 'mouseup');
    assert(f.G.stats.shots > shots, '鼠标默认不转向仍可开火');
    f.pause(); f.control('mouse', true); f.resume();
    const yaw = f.G.player.yaw;
    for (let i = 0; i < 30; i++) { move(); f.step(); }
    assert(Math.abs(f.G.player.yaw - yaw) > .02, `${view}开启鼠标后应转向`);
  }
  const f = fixture(); f.start(); const yaw = f.G.player.yaw;
  f.key('KeyD'); f.advance(.5); f.key('KeyD', false);
  assert(Math.abs(f.G.player.yaw - yaw) > .02, '默认键盘仍可转向');
  f.window.__SKY.restart(); const touchYaw = f.G.player.yaw;
  f.dispatch(f.byId('ui'), 'pointerdown', { pointerType: 'touch', pointerId: 9, clientX: 1190, clientY: 350 });
  f.advance(.5); f.dispatch(f.document.body, 'pointerup', { pointerType: 'touch', pointerId: 9 });
  assert(Math.abs(f.G.player.yaw - touchYaw) > .02, '默认触屏仍可转向');
  const original = fixture(false); original.start();
  original.dispatch(original.byId('ui'), 'pointermove', { clientX: 1190, clientY: 180 }); original.step();
  assert.notEqual(original.G.player.roll, 0, '原入口仍保留鼠标操纵');
});

test('默认加力保持500节，1500节巡航时Shift保持速度和燃油', () => {
  const f = fixture(); f.start(); const start = { ...f.G.player.pos };
  f.key('ShiftLeft'); f.advance(3);
  assert(f.G.player.speed > 224 && f.G.player.speed <= 500 / KNOTS_PER_MS + 1e-9, '默认3秒后实际空速应超过原巡航两倍');
  assert(Math.hypot(f.G.player.pos.x - start.x, f.G.player.pos.y - start.y, f.G.player.pos.z - start.z) > 500, '位移须使用实际加力速度');
  near(f.G.missionTime, 3, 1e-9); near(f.G.time, 3, 1e-9);
  f.pause(); f.input('cruise', 1500); f.resume(); f.window.__SKY.restart();
  const cappedStart = { ...f.G.player.pos };
  f.G.player.fuel = 70; f.key('ShiftLeft'); f.advance(1);
  near(f.G.player.speed * KNOTS_PER_MS, 1500); assert.equal(f.G.player.burning, false);
  near(Math.hypot(f.G.player.pos.x - cappedStart.x, f.G.player.pos.y - cappedStart.y, f.G.player.pos.z - cappedStart.z), 1500 / KNOTS_PER_MS);
  assert(f.G.player.fuel >= 70, '达到1500节封顶时按Shift不能消耗燃油');
});

test('最低档以100节实速起步，满加力可在燃油耗尽前平滑达到1500节', () => {
  const f = fixture(); f.start(); f.pause(); f.input('cruise', 300); f.input('burn', 1500);
  f.click('sky-restart');
  const p = f.G.player, startSpeed = p.speed;
  f.key('ShiftLeft'); f.step();
  assert(p.speed > startSpeed && p.speed < startSpeed + 8);
  f.advance(3.5);
  near(p.speed * KNOTS_PER_MS, 1500);
  assert(p.burning && p.fuel > 40);
  f.key('ShiftLeft', false); f.step();
  assert(!p.burning && p.speed > startSpeed && p.speed < 1500 / KNOTS_PER_MS);
});

test('调整转向滑块可改变航向速度，巡航与加力使用同一转向曲线和实际空速', () => {
  for (const turn of [12, 45, 60]) {
    const turns = [fixture(), fixture()];
    for (const f of turns) {
      f.start(); f.pause(); f.input('burn', 1500); f.control('turnAuto', false); f.control('turn', turn);
      assert.equal(f.byId('sky-turn-rate-value').textContent, `${turn}°/秒`);
      f.resume(); f.run("setViewName('cockpit');"); f.key('ArrowRight');
    }
    turns[1].key('ShiftLeft');
    for (let i = 0; i < 300; i++) {
      for (const f of turns) {
        const p = f.G.player, at = { ...p.pos };
        f.step(1, 1 / 60, true);
        near(Math.hypot(p.pos.x - at.x, p.pos.y - at.y, p.pos.z - at.z) * 60, p.speed, 1e-7, '转弯用当前空速积分位置');
      }
      near(turns[0].G.player.yawRate, turns[1].G.player.yawRate, 1e-9, '加力不影响当前转向曲线');
    }
    near(turns[0].G.player.yawRate * 180 / Math.PI, turn, .02);
    near(turns[1].G.player.speed * KNOTS_PER_MS, 1500);
  }
});

test('座舱普通转向一秒形成倾角，各帧率下倾角/航向变化受限且相机姿态一致', () => {
  for (const dt of [1 / 20, 1 / 60]) {
    const f = fixture(); f.start(); f.run("setViewName('cockpit'); G.viewBlend = 1;"); f.key('KeyD');
    const check = seconds => {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        const roll = f.G.player.roll, yaw = f.G.player.yaw; f.step(1, dt, true);
        assert(Math.abs(f.G.player.roll - roll) <= .6 * dt + 1e-9, `dt=${dt}普通倾斜超过35度/秒`);
        const deltaYaw = Math.atan2(Math.sin(f.G.player.yaw - yaw), Math.cos(f.G.player.yaw - yaw));
        const p = f.G.player, limit = p.turnRateAtSpeed(p.speed);
        assert(Math.abs(deltaYaw) <= limit * dt + 1e-9, `dt=${dt}航向变化过快`);
        assert(Math.abs(f.G.player.roll) <= .58, '普通转向不能超过约32度倾角');
      }
    };
    check(1); assert(Math.abs(f.G.player.roll) > .4, '按住一秒应形成清楚的倾角');
    const { up } = f.G.player.renderBasis, camera = f.G.camera.up;
    assert(up.x * camera.x + up.y * camera.y + up.z * camera.z > .999, '座舱真实相机与飞机采用同一姿态');
    f.key('KeyD', false); check(1); assert(Math.abs(f.G.player.roll) < .15, '松开后普通倾角逐步回中');
  }
});

for (const view of ['chase', 'top']) {
  test(`新版${view}的A/D转向和座舱一样逐渐进入，速度变化不放大转向`, () => {
    for (const boost of [false, true]) {
      const f = fixture(), cockpit = fixture();
      f.start(); cockpit.start();
      f.run(`setViewName('${view}');`); cockpit.run("setViewName('cockpit');");
      const p = f.G.player, yaw = p.yaw;
      for (const sim of [f, cockpit]) {
        if (boost) sim.key('ShiftLeft');
        sim.key('KeyD');
      }
      for (let i = 0; i < 100; i++) {
        const beforeRoll = p.roll;
        f.step(1, 1 / 60, true); cockpit.step(1, 1 / 60, true);
        assert(Math.abs(p.roll - beforeRoll) <= .6 / 60 + 1e-9, '外部机身应逐渐侧倾');
        near(p.yawRate, cockpit.G.player.yawRate, 1e-9, '同速度和输入使用座舱转向节奏');
        const limit = p.turnRateAtSpeed(p.speed);
        assert(Math.abs(p.yawRate) <= limit + 1e-9, '外部航向不能超过随速度推导的限速');
        if (i === 0) assert(Math.abs(p.yawRate) < .025, '按下第一帧不能突然转满');
      }
      assert(p.yaw - yaw > .12 && p.roll < -.4, '转向仍可响应并形成可见侧倾');
      f.key('KeyD', false); f.advance(1.5);
      assert(Math.abs(p.roll) < .08 && Math.abs(p.yawRate) < .12, '松键后平滑结束转向');
      near(f.G.camera.right.y, 0, 1e-7, '外部地平线保持稳定');
    }
  });
}

for (const [view, key] of [['chase', 'KeyS'], ['cockpit', 'KeyW'], ['top', 'ArrowDown']]) {
  test(`新版${view}松开${key}保持俯仰，弹道跟随实际准星，R可恢复水平`, () => {
    const f = fixture(); f.start(); f.run(`setViewName('${view}');`);
    const p = f.G.player;
    f.key(key); f.advance(.4); f.key(key, false);
    const pitch = p.pitch;
    assert(Math.abs(pitch) > .15 && Math.abs(pitch) < .30);
    f.advance(.8);
    near(p.pitch, pitch, 1e-9, '松开俯仰键后不应自行回平');
    near(p.basis.fwd.y, Math.sin(pitch), 1e-9, '保持实际机头，而非仅移动准星');
    tap(f, 'KeyF');
    const bullet = f.G.bullets.at(-1);
    const shot = f.run('playerGunSolution(G.bullets[G.bullets.length-1].pos)');
    near(bullet.vel.y, shot.velocity.y);
    near(bullet.vel.x, shot.velocity.x); near(bullet.vel.z, shot.velocity.z);
    tap(f, 'KeyR'); f.advance(1.6);
    near(p.pitch, 0); near(p.basis.fwd.y, 0);
  });
}

test('原入口保留原俯瞰转向速度和松开W后水平回中', () => {
  const f = fixture(false); f.start(); f.run("setViewName('top');");
  f.key('KeyD'); f.step(); f.key('KeyD', false);
  assert(f.G.player.yawRate > 1.8);
  f.key('KeyW'); f.advance(.4); f.key('KeyW', false); f.advance(1.5);
  assert(Math.abs(f.G.player.pitch) < .01);
});

function armHalfRoll(f, code = 'KeyA', hold = 2.05) {
  f.key(code); f.advance(hold); f.key(code, false);
}
function tap(f, code = 'KeyA') { f.key(code); f.key(code, false); }
function halfRollGesture(f, code = 'KeyA') {
  armHalfRoll(f, code); f.advance(.1); tap(f, code); f.advance(.15); tap(f, code);
}

test('真实AD长按后双击平滑半滚、持续倒飞与翻回，Q完整桶滚保留原倒飞', () => {
  const f = fixture(); f.start(); halfRollGesture(f);
  assert(f.G.player.halfRoll, '长按松开后双击应启动半滚');
  f.advance(.4); const early = Math.abs(f.G.player.inversionRoll);
  assert(early > 0 && early < Math.PI / 2, '前四分之一进程须缓入');
  f.advance(.4); near(Math.abs(f.G.player.inversionRoll), Math.PI / 2, .08, '0.8秒约转过90度');
  f.advance(.8); near(Math.abs(f.G.player.inversionRoll), Math.PI, 1e-9);
  assert(f.G.player.basis.up.y < -.8 && f.G.player.renderBasis.up.y < -.8, '真实与显示姿态都须保持倒飞');
  near(f.G.camera.right.y, 0, 1e-9, '追尾地平线保持水平'); assert(f.G.camera.up.y > .9);
  const inverted = f.G.player.inversionRoll; f.key('KeyQ'); f.key('KeyQ', false); f.advance(.3);
  assert(f.G.player.rollT > 0 && Math.abs(f.G.player.spin) > .2, '原Q完整桶滚仍有动画');
  f.advance(1); assert.equal(f.G.player.inversionRoll, inverted); assert.equal(f.G.player.spin, 0);
  assert(f.G.player.renderBasis.up.y < -.8, 'Q结束回到原倒飞姿态');
  halfRollGesture(f); f.advance(1.6); near(f.G.player.inversionRoll, 0, 1e-9); assert(f.G.player.basis.up.y > .8);
  halfRollGesture(f, 'KeyD'); f.advance(1.6);
  near(Math.abs(f.G.player.inversionRoll), Math.PI, 1e-9); assert(Math.sign(f.G.player.inversionRoll) !== Math.sign(inverted), 'D与A采用相反半滚方向');
});

test('短按、混向、自动重复、超时、暂停和失焦不误触半滚', () => {
  const cases = [
    ['短hold', f => { armHalfRoll(f, 'KeyA', 1.5); tap(f); f.advance(.1); tap(f); }],
    ['混向', f => { armHalfRoll(f); tap(f, 'KeyD'); tap(f); f.advance(.1); tap(f); }],
    ['双击过慢', f => { armHalfRoll(f); tap(f); f.advance(.4); tap(f); }],
    ['待触发超时', f => { armHalfRoll(f); f.advance(1.3); tap(f); f.advance(.1); tap(f); }],
    ['repeat', f => { armHalfRoll(f); f.key('KeyA'); f.dispatch(f.byId('ui'), 'keydown', { code: 'KeyA', repeat: true }); f.key('KeyA', false); }],
    ['暂停', f => { armHalfRoll(f); f.pause(); f.resume(); tap(f); f.advance(.1); tap(f); }],
    ['失焦', f => { armHalfRoll(f); f.dispatch(f.window, 'blur'); tap(f); f.advance(.1); tap(f); }],
    ['重开', f => { armHalfRoll(f); f.window.__SKY.restart(); tap(f); f.advance(.1); tap(f); }],
  ];
  for (const [name, act] of cases) {
    const f = fixture(); f.start(); act(f); f.advance(2);
    assert(!f.G.player.halfRoll, `${name}不能触发半滚`);
    near(f.G.player.inversionRoll ?? 0, 0, 1e-9, `${name}不能改变正倒飞状态`);
  }
});

for (const holdAfterTrigger of [4, 4.6]) {
  test(`原生A手势触发${holdAfterTrigger}秒后Space切换视角，相机逐帧转动连续且正交`, t => {
    const f = fixture(); f.start(); halfRollGesture(f); f.advance(holdAfterTrigger);
    near(Math.abs(f.G.player.inversionRoll), Math.PI, 1e-9);
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const length = a => Math.hypot(a.x, a.y, a.z);
    const maxima = [];
    for (const view of [2, 0, 1]) {
      f.key('Space'); f.key('Space', false); assert.equal(f.G.view, view);
      let previousUp = { ...f.G.camera.up }, maxAngle = 0;
      for (let frame = 0; frame < 100; frame++) {
        f.step(1, 1 / 60, true);
        const { up, right, fwd } = f.G.camera;
        for (const vector of [up, right, fwd]) {
          assert(Object.values(vector).every(Number.isFinite), `视角${view}第${frame}帧相机出现非有限分量`);
          near(length(vector), 1, 1e-5, `视角${view}相机基向量应保持单位长度`);
        }
        for (const [a, b] of [[up, right], [up, fwd], [right, fwd]])
          near(dot(a, b), 0, 1e-5, `视角${view}相机基向量应保持正交`);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(previousUp, up) / length(previousUp) / length(up))));
        maxAngle = Math.max(maxAngle, angle); previousUp = { ...up };
      }
      maxima.push({ view, maxAngle });
    }
    t.diagnostic(JSON.stringify(maxima));
    for (const { view, maxAngle } of maxima)
      assert(maxAngle < .15, `倒飞切到视角${view}时单帧转动${maxAngle.toFixed(3)}rad，须小于0.15rad`);
  });
}

test('A/D重叠长按后松开再双击不能把混向手势识别成半滚', () => {
  const f = fixture(); f.start();
  f.key('KeyA'); f.key('KeyD'); f.advance(2.05);
  f.key('KeyA', false); f.key('KeyD', false);
  tap(f, 'KeyD'); f.advance(.15); tap(f, 'KeyD');
  assert(!f.G.player.halfRoll, 'A/D重叠长按应清空待触发手势');
  f.advance(2); near(f.G.player.inversionRoll, 0, 1e-9, '混向操作结束后应继续正飞');
});

test('倒飞R平滑回正且保留航向、任务与真实位移，重复R和Q不打断', () => {
  const f = fixture(); f.start(); halfRollGesture(f); f.advance(1.6);
  f.key('KeyW'); f.advance(.2); f.key('KeyW', false);
  const p = f.G.player, before = plain(p.renderBasis), yaw = p.yaw, time = f.G.missionTime, pos = { ...p.pos };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (dot(a.right, b.right) + dot(a.up, b.up) + dot(a.fwd, b.fwd) - 1) / 2)));
  f.key('KeyR'); f.key('KeyR', false);
  assert(p.recovery, '正式飞行中的R应启动回正'); assert.equal(f.G.player, p, 'R不能重开任务');
  near(angle(before, p.renderBasis), 0, 1e-6, 'R按下当帧姿态不能跳变');
  const recovery = p.recovery;
  let previous = before;
  for (let frame = 0; frame < 96; frame++) {
    if (frame === 12) {
      f.dispatch(f.byId('ui'), 'keydown', { code: 'KeyR', repeat: true });
      tap(f, 'KeyQ'); assert.equal(p.recovery, recovery, '重复R和Q不能重启或打断回正');
      tap(f, 'KeyD'); tap(f, 'KeyD'); f.key('KeyD');
      assert.equal(p.recovery, recovery); assert(!p.halfRoll, '恢复中双击A/D不能切换为半滚');
      assert(f.run("INPUT.keys.has('KeyD')"), '恢复期间保留原始按键状态');
    }
    if (frame === 60) f.key('KeyD', false);
    f.step(1, 1 / 60, true);
    assert(angle(previous, p.renderBasis) <= 4 / 60 + 1e-5, '回正的单帧角速度不超过4rad/s');
    previous = plain(p.renderBasis);
    near(p.yaw, yaw, 1e-9, '回正保持原航向');
  }
  assert(!p.recovery); near(p.inversionRoll, 0); near(p.roll, 0); near(p.pitch, 0);
  assert(p.basis.up.y > .999 && p.renderBasis.up.y > .999, '1.6秒后真实和显示姿态均应正飞');
  const recoveredDistance = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z);
  assert(recoveredDistance > p.cruiseSpeed * 1.6 * .98 && recoveredDistance <= p.cruiseSpeed * 1.6 + 1e-7,
    '低速浅仰角回正期间应走完约1.6秒的实际巡航距离');
  near(f.G.missionTime, time + 1.6); assert.equal(f.G.mode, 'play');
  f.key('KeyD'); f.advance(.3); f.key('KeyD', false);
  assert(Math.abs(p.yaw - yaw) > .01, '回正结束后方向键恢复正常操纵');
});

test('真实回正按钮单击与KeyR逐帧执行同一动作，暂停和回正期间不可重复激活', () => {
  const keyboard = fixture(), button = fixture();
  for (const f of [keyboard, button]) { f.start(); halfRollGesture(f); f.advance(1.6); }
  const recover = button.action('recover');
  assert(recover && recover.tagName === 'BUTTON', '正式操作栏须有原生回正按钮');
  assert.match(recover.getAttribute('aria-label') || '', /回|正/);
  assert.equal(recover.disabled, false);
  const before = flightState(button), player = button.G.player;
  tap(keyboard, 'KeyR'); button.dispatch(recover, 'click');
  assert.equal(button.G.player, player); assert.deepEqual(flightState(button), before, '回正单击当帧不能推进飞行');
  assert.deepEqual(plain(button.G.player.recovery), plain(keyboard.G.player.recovery));
  assert.equal(recover.disabled, true, '回正过程中按钮应禁用');
  for (let frame = 0; frame < 96; frame++) {
    keyboard.step(1, 1 / 60, true); button.step(1, 1 / 60, true);
    assert.deepEqual(flightState(button), flightState(keyboard), `按钮/KeyR第${frame + 1}帧飞行状态不同`);
    assert.deepEqual(plain(button.G.player.renderBasis), plain(keyboard.G.player.renderBasis));
  }
  button.window.__SKY.sync(); assert.equal(recover.disabled, false); assert(!button.G.player.recovery);
  button.pause(); assert.equal(recover.disabled, true); button.dispatch(recover, 'click');
  assert(!button.G.player.recovery, '暂停中的隐藏操作不能启动回正');
});

for (const source of ['half-roll', 'Q-spin']) {
  test(`R可从${source}中途接管，并从当时真实姿态平滑回正`, () => {
    const f = fixture(); f.start();
    if (source === 'half-roll') { halfRollGesture(f); f.advance(.65); assert(f.G.player.halfRoll); }
    else { tap(f, 'KeyQ'); f.advance(.3); assert(f.G.player.rollT > 0); }
    const p = f.G.player, before = plain(p.renderBasis), time = f.G.missionTime;
    f.key('KeyR'); f.key('KeyR', false);
    assert(p.recovery); assert(!p.halfRoll); assert.equal(p.rollT, 0); assert.equal(p.spin, 0);
    assert.deepEqual(plain(p.renderBasis), before, '接管当帧不能跳到新姿态');
    f.step(1, 1 / 60, true);
    for (const axis of ['up', 'right', 'fwd']) {
      const a = before[axis], b = p.renderBasis[axis], cosine = a.x * b.x + a.y * b.y + a.z * b.z;
      assert(Math.acos(Math.max(-1, Math.min(1, cosine))) < 4 / 60, '接管后的第一帧仍须连续');
    }
    f.advance(95 / 60); assert(!p.recovery); near(p.inversionRoll, 0); near(p.roll, 0); near(p.pitch, 0);
    assert(p.renderBasis.up.y > .999); near(f.G.missionTime, time + 1.6);
  });
}

test('回正暂停时冻结，重开清除；failed的R仍重新起飞，原入口飞行R不新增行为', () => {
  const f = fixture(); f.start(); halfRollGesture(f); f.advance(1.6); tap(f, 'KeyR'); f.advance(.4);
  assert(f.G.player.recovery); f.pause();
  const p = f.G.player, recovery = plain(p.recovery), state = flightState(f), basis = plain(p.renderBasis);
  f.advance(2); assert.deepEqual(plain(p.recovery), recovery); assert.deepEqual(flightState(f), state);
  assert.deepEqual(plain(p.renderBasis), basis);
  f.click('sky-restart'); assert.equal(f.G.mode, 'play'); assert.notEqual(f.G.player, p);
  assert(!f.G.player.recovery); assert(!f.G.player.halfRoll); near(f.G.player.inversionRoll, 0);
  f.G.mode = 'failed'; f.G.failTimer = 1; f.G.score = 700; f.window.__SKY.sync(); tap(f, 'KeyR');
  assert.equal(f.G.mode, 'play'); assert.equal(f.G.score, 0, 'failed的R保持原重新起飞合同');
  const original = fixture(false); original.start(); original.key('KeyD'); original.advance(.3);
  const originalPlayer = original.G.player, originalState = plain(originalPlayer);
  tap(original, 'KeyR'); assert.equal(original.G.player, originalPlayer);
  assert.deepEqual(plain(originalPlayer), originalState); assert(!originalPlayer.recovery);
});

test('新版低速平飞与座舱持续采样左右翼尖，暂停冻结且dead不再新增', () => {
  for (const view of ['chase', 'top', 'cockpit']) {
    const f = fixture(); f.start(); f.pause(); f.input('cruise', 300); f.resume(); f.window.__SKY.restart();
    f.run(`setViewName('${view}'); G.viewBlend = 1;`);
    assert.equal(f.G.player.continuousTrails, true);
    f.advance(.3);
    const first = new Set(f.G.vapor);
    for (const side of [-1, 1]) assert(f.G.vapor.some(point => point.side === side), `${view}低速平飞缺少${side}侧航迹`);
    f.advance(.6);
    for (const side of [-1, 1]) assert(f.G.vapor.some(point => point.side === side && !first.has(point)), `${view}旧航迹结束后仍须采样新航迹`);
    const vapor = plain(f.G.vapor); f.pause(); f.advance(1); assert.deepEqual(plain(f.G.vapor), vapor);
    f.resume(); f.G.player.dead = true; const existing = new Set(f.G.vapor); f.advance(.2);
    assert(f.G.vapor.every(point => existing.has(point)), 'dead状态不能新增翼尖采样');
  }
  const original = fixture(false); original.start();
  assert.equal(original.G.player.continuousTrails, undefined);
});

// Run: node --test tools/test_sky_wingman.mjs
// 辅助僚机的引擎级回归：默认关闭、生命周期、编队、确定性、攻击与击杀信用。
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
const difficultySource = read('sky-patrol/66_difficulty.js');
const shell = read('sky-patrol/00_shell.html');
const plain = value => JSON.parse(JSON.stringify(value));

function dom(markup) {
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
  const body = markup.slice(markup.indexOf('<body'), markup.indexOf('<script>'));
  const stack = [document.body];
  const voidTags = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
  for (const [, closing, tag, attributes] of body.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)) {
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

function fixture() {
  const browser = dom(shell);
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
  vm.runInContext(`(() => { ${boundary}\n${commonSource}\n${skySource}\n${mainSource}\n${sceneSource}\n${appSource}\n${difficultySource}
    window.__eval = code => eval(code);
  })();`, context);
  const run = code => window.__eval(code);
  const G = window.__PI.G;
  G.map = { heightAt: () => 20, forestAt: () => 0, cloudDensity: () => 0, findScenicSpawn: () => ({ x: 0, z: 0, heading: 0.6 }) };
  run("BOOT.ready = true; G.seed = 1; G.mode = 'title'; setupTitleWorld(); G.camera = buildCamera(computePose(1, false));");
  window.__SKY.sync();
  const start = mode => window.__SKY.start(mode || 'intercept');
  const step = (frames = 1, dt = 1 / 60, wholeGame = false) => {
    for (let i = 0; i < frames; i++) run(`${wholeGame ? 'updateGame' : 'updateFlight'}(${dt})`);
  };
  const advance = (seconds, dt = 1 / 60) => step(Math.round(seconds / dt), dt, true);
  const action = name => browser.nodes.find(element => element.dataset.skyAction === name);
  const click = id => browser.dispatch(browser.byId(id), 'click');
  const teardown = () => { window.__SKY.stop?.(); };
  return { ...browser, run, G, start, action, click, step, advance, storageWrites, teardown };
}

test('辅助僚机默认关闭：不出生、不开火、不产生友军子弹', () => {
  const f = fixture(); f.start('intercept');
  assert.equal(f.G.allies.length, 0);
  f.advance(2);
  assert.equal(f.G.allies.length, 0);
  assert.equal(f.G.bullets.filter(bullet => bullet.owner === 'ally').length, 0);
  assert.equal(f.storageWrites.length, 0, '僚机默认状态不应写本地存储');
});

test('战斗难度默认标准，UI可切预设和逐兵种反制，并标记自定义', () => {
  const f = fixture();
  assert.equal(f.byId('sky-difficulty').value, 'standard');
  assert.equal(f.byId('sky-difficulty').disabled, true, '待命未进设置时不可修改');
  f.click('sky-settings');
  assert.equal(f.byId('sky-difficulty').disabled, false);
  assert.match(f.byId('sky-difficulty-summary').textContent, /标准.*6\/8\/10/);
  const select = f.byId('sky-difficulty');
  select.value = 'hard'; f.dispatch(select, 'change');
  assert.match(f.byId('sky-difficulty-summary').textContent, /挑战.*8\/10\/12/);
  assert.equal(f.byId('sky-flare-fighter').value, '2');
  const fighter = f.byId('sky-flare-fighter');
  fighter.value = '4'; f.dispatch(fighter, 'input');
  const chance = f.byId('sky-flare-chance-fighter');
  chance.value = '85'; f.dispatch(chance, 'input');
  assert.equal(select.value, 'custom');
  assert.equal(f.byId('sky-flare-fighter-value').textContent, '4 发 · 85%');
  const snap = plain(f.run('skyDifficultySnapshot()'));
  assert.equal(snap.preset, 'hard'); assert.equal(snap.custom, true);
  assert.deepEqual(Array.from(snap.waves), [8, 10, 12]);
  assert.deepEqual(snap.flares.fighter, { count: 4, chance: .85 });
});

test('难度在新航次快照：标准6/8/10、挑战8/10/12，暂停改动不凭空补给当前敌人', () => {
  const f = fixture(); f.run("G.mode='paused';skyDifficultySelectPreset('standard')");
  f.start('intercept');
  assert.deepEqual(Array.from(f.G.defenseRules.waves), [6, 8, 10]);
  assert.equal(f.G.waveTotal, 6); assert.equal(f.G.enemies.length, 3);
  assert(f.G.enemies.every(e => e.kind === 'drone' && e.flares === 1 && e.maxFlares === 1));
  assert.equal(f.G.enemies[0].flareChance, .45);
  f.run("G.mode='paused';skyDifficultyAdjustFlare('drone','count',4)");
  assert.equal(f.G.defenseRules.flares.drone.count, 1, '当前航次不能被改成免费补弹');
  f.run('window.__SKY.restart()');
  assert.equal(f.G.defenseRules.flares.drone.count, 4);
  assert.equal(f.G.enemies[0].flares, 4);
  assert.equal(f.G.enemies[0].maxFlares, 4);
  f.run("G.mode='paused';skyDifficultySelectPreset('hard')");
  f.run('window.__SKY.restart()');
  assert.deepEqual(Array.from(f.G.defenseRules.waves), [8, 10, 12]);
  assert.equal(f.G.waveTotal, 8);
  f.run('prepareWave(2)');
  assert.equal(f.G.waveTotal, 10);
  f.run('prepareWave(3)');
  assert.equal(f.G.waveTotal, 12);
  assert.deepEqual(Array.from(f.G.defenseStage.air.slice(0, 6)), ['transport','fighter','drone','fighter','drone','fighter']);
});

test('僚机在本局只出生一架，回待命会清空', () => {
  const f = fixture(); f.start('intercept');
  f.run('G.wingmanWanted = true; wingmanOnRunStart(); wingmanSpawn(); wingmanSpawn();');
  assert.equal(f.G.allies.length, 1);
  assert.equal(f.G.allies[0].team, 'ally');
  f.run('setupTitleWorld()');
  assert.equal(f.G.allies.length, 0);
});

test('僚机跟随玩家且不钻进地形，位置保持有限值', () => {
  const f = fixture(); f.start('intercept');
  f.run('G.wingmanWanted = true; wingmanOnRunStart();');
  f.advance(4);
  const w = plain(f.G.allies[0]);
  assert(Number.isFinite(w.pos.x) && Number.isFinite(w.pos.y) && Number.isFinite(w.pos.z));
  assert(w.pos.y > 20 + 40, '僚机必须高于地形安全线');
  const distance = f.run('vdist(G.allies[0].pos, G.player.pos)');
  assert(distance > 25 && distance < 320, `僚机应留在玩家附近，实际 ${distance.toFixed(1)}m`);
});

for (const knots of [100, 500, 1500]) {
  test(`僚机在${knots}节移动玩家周围真实环绕，不长期滞留机尾`, t => {
    const f = fixture(); f.start('free');
    const sample = plain(f.run(`(() => {
      const p = G.player; p.speed = p.cruiseSpeed = ${knots}/1.94384; p.burnSpeed=p.speed*1.4;
      G.wingmanWanted=true;wingmanOnRunStart();
      const w=G.allies[0], sectors=new Set(); let rear=0,count=0,min=Infinity,max=0,travel=0;
      for(let i=0;i<90*60;i++){
        p.pos=vmad(p.pos,p.basis.fwd,p.speed/60);G.time+=1/60;
        const before=vcopy(w.pos);updateWingman(1/60);
        const step=vdist(before,w.pos);if(step>w.speed/60+.001)throw new Error('僚机不能瞬移');
        if(i%30===0&&i>10*60){
          const d=vsub(w.pos,p.pos),front=vdot(d,p.basis.fwd),right=vdot(d,p.basis.right),gap=vlen(d);
          sectors.add(Math.abs(front)>Math.abs(right)?front>0?'front':'rear':right>0?'right':'left');
          if(front < -Math.abs(right))rear++;count++;min=Math.min(min,gap);max=Math.max(max,gap);travel+=step;
        }
      }
      return {sectors:[...sectors],rearFraction:rear/count,min,max,travel,ammo:w.ammo,shield:w.shield};
    })()`));
    assert.deepEqual([...sample.sectors].sort(), ['front','left','rear','right']);
    assert(sample.rearFraction < .4, `机尾占比不应长期过半，实际${sample.rearFraction}`);
    assert(sample.min > 65 && sample.max < 500, `伴飞距离异常${sample.min}..${sample.max}`);
    assert.equal(sample.ammo,36);assert.equal(sample.shield,80);
    t.diagnostic(JSON.stringify({ knots, ...sample }));
  });
}

test('环绕伴飞在玩家转向、爬升和加力后连续归位，补给仍在外围绕行', t => {
  const f = fixture(); f.start('free');
  const sample = plain(f.run(`(() => {
    const p=G.player;G.wingmanWanted=true;wingmanOnRunStart();
    const w=G.allies[0];let max=0,min=Infinity,stepError=0;
    for(let i=0;i<90*60;i++){
      const time=i/60;
      p.yaw += time>8&&time<16 ? .3/60 : 0;
      p.pitch = time>20&&time<28 ? .18 : 0;
      p.speed=damp(p.speed,time>32?257:52,1.6,1/60);
      p.basis=p.renderBasis=basisFrom(p.yaw,p.pitch,0);
      p.pos=vmad(p.pos,p.basis.fwd,p.speed/60);G.time+=1/60;
      if(i===50*60)w.ammo=0;
      const before=vcopy(w.pos);updateWingman(1/60);
      stepError=Math.max(stepError,vdist(before,w.pos)-w.speed/60);
      const gap=vdist(w.pos,p.pos);max=Math.max(max,gap);min=Math.min(min,gap);
    }
    return {max,min,stepError,end:vdist(w.pos,p.pos),ammo:w.ammo,shield:w.shield,state:w.state};
  })()`));
  t.diagnostic(JSON.stringify(sample));
  assert(sample.max < 950 && sample.min > 40, `机动伴飞距离异常${sample.min}..${sample.max}`);
  assert(sample.end > 100 && sample.end < 350);
  assert(sample.stepError < .01, '真实飞行不能瞬移到环上');
  assert.equal(sample.ammo,36);assert.equal(sample.shield,80);assert.equal(sample.state,'patrol');
});

test('僚机不消耗全局随机数，且同种子重放位置一致', () => {
  const off = fixture(); off.start('free');
  const on = fixture(); on.start('free');
  on.run('G.wingmanWanted = true; wingmanOnRunStart();');
  const offA = off.run('rng()'); const onA = on.run('rng()');
  assert.equal(onA, offA, '出生僚机不能推进全局随机序列');
  off.advance(1); on.advance(1);
  assert.equal(on.run('rng()'), off.run('rng()'), '僚机更新不能消耗全局随机数');

  const a = fixture(); a.start('free'); a.run('G.wingmanWanted = true; wingmanOnRunStart();');
  const b = fixture(); b.start('free'); b.run('G.wingmanWanted = true; wingmanOnRunStart();');
  a.advance(2); b.advance(2);
  assert.deepEqual(plain(a.G.allies[0].pos), plain(b.G.allies[0].pos), '同种子僚机轨迹必须一致');
});

test('友军火力只伤敌人，不伤玩家，也不进入玩家锁定集合', () => {
  const f = fixture(); f.start('intercept');
  f.run(`
    G.enemies.length = 0; G.ground.length = 0; G.missiles.length = 0;
    G.wingmanWanted = true; wingmanOnRunStart();
    const p = G.player, b = p.basis;
    spawnGunBullet(vadd(p.pos, vmul(b.fwd, 30)), vmul(b.fwd, -420), 'ally', 90, '#a9f0d0');
  `);
  const shield = f.G.player.shield;
  f.run('updateGunBullets(0.05)');
  assert.equal(f.G.player.shield, shield, '友军子弹不能扣玩家护盾');
  assert.equal(f.run('collectTargets().some(target => target.team === "ally")'), false);
  assert.equal(f.run('collectAllyTargets().some(target => target === G.player)'), false);
  assert.equal(f.run('collectAllyTargets().some(target => target.team === "ally")'), false);
});

test('友军子弹能击伤敌机，击杀只记僚机信用', () => {
  const f = fixture(); f.start('intercept');
  f.run(`
    G.wingmanWanted = true; wingmanOnRunStart();
    const e = G.enemies.find(enemy => !enemy.dead);
    e.hp = 40; G.waveKills = 0; G.allyKills = 0; G.stats.kills = 0; G.combo = 1; G.lastKillTime = -99;
    spawnGunBullet({ x: e.pos.x - 10, y: e.pos.y, z: e.pos.z }, { x: 500, y: 0, z: 0 }, 'ally', 8, '#a9f0d0');
    updateGunBullets(0.05);
    window.__wingHp = e.hp;
  `);
  assert(f.run('window.__wingHp') < 40, '友军机炮必须能命中敌机');
  f.run(`
    const e = G.enemies.find(enemy => !enemy.dead);
    if (e) { e.hp = 1; hitDrone(e, 999, e.pos, 'ally'); }
  `);
  assert.equal(f.G.waveKills, 1, '友军击杀必须推进波次');
  assert.equal(f.G.allyKills, 1, '友军击杀单独计数');
  assert.equal(f.G.stats.kills, 0, '友军击杀不能算玩家击杀');
  assert.equal(f.G.combo, 1, '友军击杀不能推进玩家连杀');
});

test('友军 HUD 标记只读，不改变目标集合、锁定或击杀统计', () => {
  const f = fixture(); f.start('intercept');
  f.run('G.wingmanWanted = true; wingmanOnRunStart();');
  const before = f.run(`(() => {
    const target = G.enemies.find(enemy => !enemy.dead);
    G.lock.target = target; G.lock.phase = 'locked';
    return { targets: collectTargets().length, lock: G.lock.target === target, kills: G.stats.kills, waveKills: G.waveKills };
  })()`);
  f.run('drawWingmanMarker({ bottom: skyCockpitPanelTop() - 7 })');
  assert.equal(f.run('collectTargets().length'), before.targets);
  assert.equal(f.run('G.lock.target === G.enemies.find(enemy => !enemy.dead)'), true);
  assert.equal(f.run('G.stats.kills'), before.kills);
  assert.equal(f.run('collectTargets().some(target => target.team === "ally")'), false);
});

test('僚机命令在 12 秒后过期并回退本地意图', () => {
  const f = fixture(); f.start('intercept');
  f.run('G.wingmanWanted = true; wingmanOnRunStart();');
  const accepted = f.run('wingmanSetCommand({ intent: "hold_fire", aggression: "low" }, "llm", 12)');
  assert.equal(accepted, true);
  assert.equal(f.run('wingmanEffectiveIntent(G.allies[0]).intent'), 'hold_fire');
  f.run('G.time += 13');
  assert.notEqual(f.run('wingmanEffectiveIntent(G.allies[0]).intent'), 'hold_fire');
  assert.equal(f.run('wingmanEffectiveIntent(G.allies[0]).source'), 'local');
});

for (const aggression of ['low', 'normal', 'high']) {
  test(`僚机${aggression}模式在六秒理想射界内只提供辅助伤害`, t => {
    const f = fixture(); f.start('free');
    f.run(`
      G.wingmanWanted = true; wingmanOnRunStart();
      const w = G.allies[0];
      w.pos = { x: 0, y: 600, z: 0 }; w.basis = w.renderBasis = basisFrom(0, 0, 0); w.speed = 0;
      const target = { pos: { x: 0, y: 600, z: -300 }, basis: basisFrom(0, 0, 0),
        speed: 0, radius: 7, hp: 1000, maxHp: 1000, dead: false, kind: 'drone' };
      G.enemies = [target]; w.target = target;
      window.__emitted = 0; window.__rounds = 0;
      const recordBullet = spawnGunBullet;
      spawnGunBullet = function (...args) {
        if (args[2] === 'ally') { window.__rounds++; window.__emitted += args[3]; }
        return recordBullet(...args);
      };
      for (let i = 0; i < 360; i++) {
        w.fireCd = Math.max(0, w.fireCd - 1 / 60);
        wingmanTryFire(w, { intent: 'cover_player', aggression: '${aggression}' });
        updateGunBullets(1 / 60);
      }
      window.__fireResult = { rounds: window.__rounds, emitted: window.__emitted, hit: 1000 - target.hp };
    `);
    const result = plain(f.run('window.__fireResult'));
    t.diagnostic(JSON.stringify({ aggression, seconds: 6, range: 300, ...result }));
    assert(result.hit >= 16, '弱化后仍必须能够用实际弹道帮助玩家伤敌');
    assert(result.emitted <= 72, '六秒全中输出不应超过一架第一关无人机的耐久');
    assert(result.hit < 72, '六秒后不应已自动消灭一个满血无人机');
  });
}

test('僚机不再从700米外自动开炮，600米内仍可支援', () => {
  const f = fixture(); f.start('free');
  f.run(`G.wingmanWanted = true; wingmanOnRunStart();
    const w = G.allies[0]; w.pos = { x: 0, y: 600, z: 0 }; w.basis = basisFrom(0, 0, 0);
    w.target = { pos: { x: 0, y: 600, z: -700 }, hp: 72, speed: 0 };
    wingmanTryFire(w, { aggression: 'high' });`);
  assert.equal(f.G.bullets.length, 0, '激进模式也不能扩大射程');
  f.run(`G.allies[0].target.pos.z = -500; wingmanTryFire(G.allies[0], { aggression: 'normal' });`);
  assert.equal(f.G.bullets.length, 1);
});

test('僚机可自主处理1500米内敌情，仍保留1800米协攻和2200米脱离边界', () => {
  const f = fixture(); f.start('free');
  f.run(`G.wingmanWanted = true; wingmanOnRunStart();
    const p = G.player, w = G.allies[0];
    const target = { pos: vmad(p.pos, p.basis.fwd, 2400), hp: 72, dead: false };
    G.enemies = [target]; G.lock.target = target;`);
  assert.equal(f.run('wingmanPickTarget(G.allies[0], { intent: "attack_player_target", aggression: "high" })'), null);
  f.run('G.lock.target = null; G.enemies[0].pos = vmad(G.player.pos, G.player.basis.fwd, 1700);');
  assert.equal(f.run('wingmanEffectiveIntent(G.allies[0]).intent'), 'regroup');
  assert.equal(f.run('wingmanPickTarget(G.allies[0], { intent: "cover_player", aggression: "high" })'), null);
  f.run('G.enemies[0].pos = vmad(G.player.pos, G.player.basis.fwd, 1200);');
  assert.equal(f.run('wingmanEffectiveIntent(G.allies[0]).intent'), 'cover_player');
  assert.equal(f.run('wingmanPickTarget(G.allies[0], { intent: "cover_player" }) === G.enemies[0]'), true);
  f.run('G.lock.target = G.enemies[0]; G.enemies[0].pos = vmad(G.player.pos, G.player.basis.fwd, 1600);');
  assert.equal(f.run('wingmanPickTarget(G.allies[0], { intent: "attack_player_target" }) === G.lock.target'), true);
  f.run('G.allies[0].pos = vmad(G.player.pos, G.player.basis.fwd, 2400); G.allies[0].targetTimer = 0; updateWingman(1/60);');
  assert.equal(f.G.allies[0].target, null, '超过离队距离后停止追击');
  assert.equal(f.G.allies[0].state, 'follow');
});

test('僚机有限弹药耗尽后补给十八秒，切换开关不刷新库存', () => {
  const f = fixture(); f.start('free');
  f.run(`G.wingmanWanted = true; wingmanOnRunStart();
    const w = G.allies[0]; w.pos = { x: 0, y: 600, z: 0 }; w.basis = basisFrom(0,0,0);
    w.target = { pos: { x: 0, y: 600, z: -300 }, speed: 0, hp: 1000 };
    for (let i=0;i<36;i++) { w.fireCd = 0; wingmanTryFire(w,{aggression:'normal'}); }
  `);
  assert.equal(f.G.allies[0].ammo, 0);
  f.run('updateWingman(1/60)');
  assert.equal(f.G.allies[0].state, 'resupply');
  assert(f.G.allies[0].serviceT > 17);
  f.run('wingmanClear("disabled"); wingmanSpawn();');
  assert.equal(f.G.allies[0].ammo, 0, '开关不能变成免费补给');
  f.run('G.enemies.length=0; G.allies[0].target=null;');
  for (let i=0;i<17*60;i++) f.run('updateWingman(1/60);G.time+=1/60;');
  assert.equal(f.G.allies[0].ammo, 0);
  for (let i=0;i<61;i++) f.run('updateWingman(1/60);G.time+=1/60;');
  assert.equal(f.G.allies[0].ammo, 36);
});

test('僚机可被敌方实体弹击伤，低盾撤出，损毁本航次不复活', () => {
  const f = fixture(); f.start('intercept');
  f.run(`G.wingmanWanted=true;wingmanOnRunStart();
    G.enemies.length=G.ground.length=0;
    const w=G.allies[0];spawnGunBullet({x:w.pos.x-10,y:w.pos.y,z:w.pos.z},{x:500,y:0,z:0},'enemy',64);
    updateGunBullets(.05);`);
  assert.equal(f.G.allies[0].shield, 16);
  f.run('updateWingman(1/60)');
  assert.equal(f.G.allies[0].state, 'resupply');
  f.run('damageWingman(99);');
  assert.equal(f.G.allies[0].dead, true);
  f.run('wingmanClear("disabled");wingmanSpawn();updateWingman(20);');
  assert.equal(f.G.allies[0].dead, true);
  assert.equal(f.G.allies[0].shield, 0);
  f.run('wingmanOnRunStart();');
  assert.equal(f.G.allies[0].dead, false);
  assert.equal(f.G.allies[0].shield, 80);
});

test('僚机自主选敌、攻击一段后脱离，附近无人时侧前巡弋', () => {
  const f = fixture(); f.start('free');
  f.run(`G.wingmanWanted=true;wingmanOnRunStart();
    const p=G.player;G.enemies=[{pos:vmad(p.pos,p.basis.fwd,1200),speed:30,hp:72,basis:basisFrom(p.yaw,0,0)}];
    G.lock.target=null;updateWingman(1/60);`);
  assert.equal(f.G.allies[0].state, 'engage', '不必先等玩家锁定才有动作');
  assert(f.G.allies[0].target);
  f.run('G.enemies[0].pos = vmad(G.allies[0].pos, G.allies[0].basis.fwd, 500); G.allies[0].attackT = 6; updateWingman(1/60)');
  assert.equal(f.G.allies[0].state, 'break');
  f.run('G.enemies.length=0;G.allies[0].breakT=0;updateWingman(1/60)');
  assert.equal(f.G.allies[0].state, 'patrol');
});

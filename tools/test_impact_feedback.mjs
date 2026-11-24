import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const core = read('src/10_core.js');
const math = core.slice(core.indexOf('const clamp ='), core.indexOf('// --------------------------------------------------------------- input'));
const source = [math, read('src/40_game.js'), read('src/42_combat.js'), read('src/50_ui_hud.js')].join('\n');

function impact({ missile = false, water = false, details = true } = {}) {
  const paint = [], calls = [];
  const ctx = new Proxy({
    arc(x, y, radius, start, end) { calls.push(['arc', x, y, radius, start, end]); this.radius = radius; },
    fill() { paint.push({ color: this.fillStyle, alpha: this.globalAlpha, radius: this.radius }); },
  }, {
    get: (target, name) => target[name] ?? ((...args) => calls.push([name, ...args])),
  });
  const document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
  const context = vm.createContext({ ctx, document, VW: 604, VH: 340, TAU: 2 * Math.PI,
    AudioSys: { gunshot() {}, launch() {}, explosion() {} } });
  const { G, updateGunBullets, updateMissiles, updateEffects, drawEffects, basisFrom, buildCamera, random } = vm.runInContext(`
    ${source}
    ({ G, updateGunBullets, updateMissiles, updateEffects, drawEffects, basisFrom, buildCamera, random: () => rng() });
  `, context);
  // Same continuous sloping height field for gun and missile. All impacts come
  // from live weapon updates through the production swept collision.
  const heightAt = water ? () => -18 : (x, z) => 16 - .014 * z + .002 * x;
  G.mode = 'play';
  G.map = { heightAt, cloudDensity: () => 0 };
  const basis = basisFrom(0, -.23, 0);
  G.player = { pos: { x: 0, y: 118, z: 0 }, basis, renderBasis: basis, speed: 112,
    missiles: 4, reloads: [], gunCd: 0, detailedSurfaceImpacts: details, shield: 100 };
  G.camera = buildCamera({ pos: { x: 0, y: 127, z: 22 }, target: { x: 0, y: 32, z: -400 }, up: { x: 0, y: 1, z: 0 }, fov: 1 });
  const weapon = missile ? 'missiles' : 'bullets';
  vm.runInContext(missile ? 'firePlayerMissile()' : 'firePlayerGuns()', context);
  const projectile = G[weapon][0];
  assert(projectile, '测试从真正开火生成弹体');
  const dt = 1 / 60;
  let frames = 0;
  while (G[weapon].length && frames++ < 120) {
    (missile ? updateMissiles : updateGunBullets)(dt);
    updateEffects(dt);
  }
  assert(projectile.dead && !G[weapon].length, '弹体须在未过期时实际碰到地面或水面');
  assert(projectile.life > 0);
  drawEffects();
  const effects = [...G.effects];
  const frame = JSON.parse(JSON.stringify({ pos: projectile.pos, vel: projectile.vel, frames,
    hp: G.player.shield, hits: G.stats.hits, shake: G.shake, flash: G.flash, hitStop: G.hitStop }));
  return { G, updateEffects, drawEffects, frame, effects, paint, calls, heightAt, nextRandom: random() };
}

test('新版机炮命中斜坡时先画可辨认的亮点，再留下短促浅尘', () => {
  const { G, effects, paint, heightAt, updateEffects, drawEffects, frame } = impact();
  const dust = effects.find(e => e.type === 'mist');
  const cssDiameter = mark => mark.radius * 2 * 738 / 340;
  assert(dust && effects.filter(e => e.type === 'spark').length >= 2, '少量火星配上土尘才看得出落点');
  assert(paint.some(p => p.color === '#ff7a3a' && p.alpha >= .9 && cssDiameter(p) >= 10 && cssDiameter(p) <= 14),
    '典型桌面追尾的落地亮点直径约10至14像素');
  assert(paint.some(p => p.color === '#fff6dc' && p.alpha >= .9), '橙边内应有暖白亮核');
  assert(Math.abs(dust.pos.y - heightAt(dust.pos.x, dust.pos.z)) < 3);
  assert(Math.hypot(dust.pos.x - frame.pos.x, dust.pos.z - frame.pos.z) < 15, '尘点从碰撞所在的末段冒出');
  const firstDustY = dust.pos.y;
  paint.length = 0;
  for (let i = 0; i < 14; i++) updateEffects(1 / 60);
  drawEffects();
  assert(!paint.some(p => p.color === '#fff6dc'), '亮核应迅速退场');
  assert(dust.pos.y > firstDustY + 2, '尘点从地面轻微上冲');
  assert(paint.some(p => p.color === dust.color && p.alpha >= .35 && cssDiameter(p) >= 10), '亮核之后仍能看见浅尘');
  for (let i = 0; i < 16; i++) updateEffects(1 / 60);
  assert.equal(G.effects.length, 0);
  assert.equal(G.decals.length, 0);
});

test('新版机炮入水显示小水花和涟漪', () => {
  const { G, effects, calls } = impact({ water: true });
  assert(effects.some(e => e.type === 'spray' && e.vel.y > 0), '碰到水面应溅起短促水点');
  assert(effects.some(e => e.type === 'foam' && Math.abs(e.pos.y) < 2));
  assert(calls.some(call => call[0] === 'ellipse' && call[3] >= 1.5), '小涟漪要在真实画布路径中达到可读尺寸');
  assert.equal(G.decals.length, 0);
});

for (const water of [false, true]) {
  const surface = water ? '水面' : '斜坡';
  test(`导弹命中${surface}的世界特效更强，碰撞和强度之外的反馈保持一致`, () => {
    const legacy = impact({ missile: true, water, details: false });
    const detail = impact({ missile: true, water });
    assert.deepEqual(detail.frame, legacy.frame, '视觉增强不应改变碰撞、速度、得分或整体画面反馈');
    assert.equal(detail.nextRandom, legacy.nextRandom, '视觉增强不应移走游戏随机序列');
    const primary = water ? 'spray' : 'fire';
    const radius = f => Math.max(...f.effects.filter(e => e.type === primary).map(e => e.size));
    assert(radius(detail) >= radius(legacy) * 1.35, '导弹落点应实际扩大亮核或水柱');
    assert(detail.effects.length > impact({ water }).effects.length * 4, '炮弹效果应明显轻于导弹');
    assert.equal(detail.G.decals.length, water ? 0 : 1, '一发导弹只留下自己的落点');
    assert(detail.effects.length <= 48);
    if (!water) {
      assert(detail.paint.some(p => p.color === '#fff6dc' && p.alpha > .8), '实际画布路径要绘出明亮火核');
      assert(detail.effects.some(e => e.type === 'smoke' && e.dark && e.maxLife > 2.5), '短火光后应有烟柱');
    }
  });
  test(`机炮命中${surface}保持轨迹，旧入口仍是原有两点火星`, () => {
    const legacy = impact({ water, details: false });
    const detail = impact({ water });
    assert.deepEqual(detail.frame, legacy.frame);
    assert.equal(detail.nextRandom, legacy.nextRandom);
    assert.equal(legacy.effects.length, 2);
    assert(legacy.effects.every(e => e.type === 'spark' && e.color === '#d4a16a'));
    assert(detail.effects.length <= 6);
  });
}

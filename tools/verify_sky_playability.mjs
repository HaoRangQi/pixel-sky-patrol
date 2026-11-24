#!/usr/bin/env node
// Native CDP controls; normal RAF is used for all wall-clock speed measurements.
// __PI.freeze/step is reserved for exact view, trail and recovery frame checks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8765/sky-patrol/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const only = process.argv.find(v => v.startsWith('--only='))?.slice(7);
assert(!only || ['top', 'recovery', 'handling', 'impacts', 'walltime'].includes(only), 'Use --only=top|recovery|handling|impacts|walltime');
const sizes = [{ name: 'desktop', width: 1440, height: 900, mobile: false }, { name: 'portrait', width: 390, height: 844, mobile: true }, { name: 'landscape', width: 844, height: 390, mobile: true }];
const file = path.join(ROOT, 'shots', 'sky_playability_results.json');
const previous = only && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const report = { command: `node tools/verify_sky_playability.mjs${only ? ` --only=${only}` : ''}`, startedAt: new Date().toISOString(), result: 'RUNNING',
  inputPath: 'Native CDP keyboard, mouse and touch. Exact attitude/trail checks freeze and step the existing engine. Wall-clock cases use unmodified RAF without freeze/step; no player, camera, time or enemy state is assigned.',
  cases: previous?.cases.filter(c => c.name !== only) || [], screenshots: previous?.screenshots.filter(s => !s.endsWith('_failed.png')) || [],
  ...(previous ? { retainedEvidence: { command: previous.command, finishedAt: previous.finishedAt, reason: `Only ${only} is rerun; previous cases are retained with their own timestamps.` } } : {}) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
const near = (a, b, why, epsilon = 1e-6) => assert(Math.abs(a - b) < epsilon, `${why}: ${a} != ${b}`);
let chrome, ws, profile, serial = 0, events = [];
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 65000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
const runtimeErrors = () => events.filter(e => e.method === 'Runtime.exceptionThrown' || e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' || e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network');
async function until(expression) { const end = Date.now() + 60000; while (!(await evaluate(expression))) { assert(Date.now() < end, `Timed out: ${expression}`); await sleep(80); } }
function pageState() {
  const g = __PI.G, p = g.player, c = g.camera, ui = document.getElementById('ui'), gl = document.getElementById('gl');
  return { wall: performance.now() / 1000, mode: g.mode, time: g.time, realTime: g.realTime, missionTime: g.missionTime, freeze: g.freeze, fps: g.fps, view: g.view, viewBlend: g.viewBlend,
    p: { pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, roll: p.roll, speed: p.speed, targetSpeed: p.targetSpeed, fuel: p.fuel, burning: p.burning, inversionRoll: p.inversionRoll || 0, spin: p.spin, halfRoll: p.halfRoll ?? null, recovery: p.recovery ?? null, renderBasis: p.renderBasis, basis: p.basis, continuousTrails: p.continuousTrails, dead: p.dead, shield: p.shield },
    camera: c && { pos: c.pos, up: c.up, right: c.right, fwd: c.fwd, fov: c.fov, tanHalf: c.tanHalf, aspect: c.aspect, vp: [...c.vp] },
    canvas: { width: ui.width, height: ui.height, rect: ui.getBoundingClientRect().toJSON(), worldWidth: gl.width, worldHeight: gl.height },
    vapor: g.vapor.map(v => ({ pos: v.pos, side: v.side, life: v.life })),
    enemies: g.enemies.filter(e => !e.dead).map(e => ({ id: e.showIndex, pos: { ...e.pos }, distance: Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y, e.pos.z - p.pos.z) })),
    lock: { phase: g.lock.phase, targetId: g.lock.target?.showIndex ?? null, targetKind: g.lock.target?.kind ?? null }, errors: [...__PI.errors], exceptions: [...__PI.exceptions] };
}
const state = () => evaluate(`(${pageState})()`);
const step = seconds => evaluate(`__PI.step(${seconds}); __SKY.sync(); (${pageState})()`);
const paint = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
async function key(code, down = true, autoRepeat = false) {
  const map = { Escape: ['Escape', 27], Space: [' ', 32], ShiftLeft: ['Shift', 16], KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], KeyR: ['r', 82], KeyQ: ['q', 81], KeyE: ['e', 69], KeyF: ['f', 70], Home: ['Home', 36], End: ['End', 35] };
  const [key, windowsVirtualKeyCode] = map[code];
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key, code, windowsVirtualKeyCode, autoRepeat, modifiers: code === 'ShiftLeft' && down ? 8 : 0 });
}
async function tap(code) { await key(code); await key(code, false); }
async function point(selector) {
  const r = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e||e.disabled)throw Error('Unavailable ${selector}'); if(e.closest('.sky-dialog'))e.scrollIntoView({block:'center',behavior:'instant'}); const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y); return {x,y,width:r.width,height:r.height,hit:h===e||e.contains(h)}; })()`);
  assert(r.hit && r.width > 0 && r.height > 0, `Unreachable ${selector}: ${JSON.stringify(r)}`); return r;
}
async function move(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
async function click(selector, mobile = false) {
  const p = await point(selector);
  if (mobile) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await move(p.x, p.y);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
}
async function shot(name) {
  await paint(); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const relative = `shots/sky_playability_${name}.png`; fs.writeFileSync(path.join(ROOT, relative), Buffer.from(r.data, 'base64'));
  if (!report.screenshots.includes(relative)) report.screenshots.push(relative); return relative;
}
async function navigate(size = sizes[0], adapt = false) {
  events = []; await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: `${BASE}${adapt ? '' : '?adapt=0'}` });
  await until('!!window.__PI?.ready()'); assert.equal(await evaluate('__PI.boot.error || null'), null);
}
async function start(mode = 'free') {
  await click({ free: '#sky-cruise', intercept: '#sky-intercept', inland: '#sky-inland' }[mode]);
  await evaluate('__PI.freeze(true)');
  return state();
}
async function restart() { return evaluate(`__SKY.restart(); __PI.freeze(true); (${pageState})()`); }
async function selectView(view) { for (let n = 0; (await state()).view !== view && n < 3; n++) { await click('#sky-camera'); await step(1.15); } assert.equal((await state()).view, view); }
async function configure(cruise) {
  await tap('Escape'); assert.equal((await state()).mode, 'paused');
  if (cruise === 'default') await click('#sky-speed-reset');
  else await evaluate(`(() => {
    const input = document.getElementById('sky-cruise-speed');
    input.value = ${JSON.stringify(cruise)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await tap('Escape'); assert.equal((await state()).mode, 'play');
}
function projection(world, s) {
  const c = s.camera, d = { x: world.x - c.pos.x, y: world.y - c.pos.y, z: world.z - c.pos.z };
  const dot = a => d.x * a.x + d.y * a.y + d.z * a.z, depth = dot(c.fwd);
  return { x: (.5 + dot(c.right) / (2 * depth * c.tanHalf * c.aspect)) * s.canvas.rect.width, y: (.5 - dot(c.up) / (2 * depth * c.tanHalf)) * s.canvas.rect.height };
}
function projectedAxis(s, axis, length) { return projection({ x: s.p.pos.x + axis.x * length, y: s.p.pos.y + axis.y * length, z: s.p.pos.z + axis.z * length }, s); }
function geometry(s) {
  const b = s.p.renderBasis, nose = projectedAxis(s, b.fwd, 6.59), tail = projectedAxis(s, b.fwd, -4.3), left = projectedAxis(s, b.right, -4.9), right = projectedAxis(s, b.right, 4.9);
  return { cameraHeight: s.camera.pos.y - s.p.pos.y, fov: s.camera.fov, sceneHeight: 2 * (s.camera.pos.y - s.p.pos.y) * s.camera.tanHalf, lengthFraction: Math.hypot(nose.x - tail.x, nose.y - tail.y) / s.canvas.rect.height, spanFraction: Math.hypot(left.x - right.x, left.y - right.y) / s.canvas.rect.width };
}
// Capture actual pixels' text/line draw calls without changing game state.
function installPaintCapture() {
  const proto = CanvasRenderingContext2D.prototype, fill = proto.fillText, image = proto.drawImage, line = proto.lineTo, glyphs = new WeakMap();
  const output = window.__playabilityPaint = { enabled: true, texts: [], lines: [] };
  function record(ctx, value, x, y, w, h, color, alpha) {
    const m = ctx.getTransform(), canvas = ctx.canvas, r = canvas.getBoundingClientRect();
    output.texts.push({ value, color, alpha, x: r.left + (m.a * x + m.e) / canvas.width * r.width, y: r.top + (m.d * y + m.f) / canvas.height * r.height, w: m.a * w / canvas.width * r.width, h: m.d * h / canvas.height * r.height });
    if (output.texts.length > 2000) output.texts.splice(0, 1000);
  }
  proto.fillText = function (value, x, y, ...args) {
    if (!output.enabled) return fill.call(this, value, x, y, ...args);
    const size = +(this.font.match(/([\d.]+)px/)?.[1] || 8), width = this.measureText(value).width;
    if (this.canvas.id === 'ui') record(this, String(value), x - (this.textAlign === 'center' ? width / 2 : this.textAlign === 'right' ? width : 0), y - size, width, size, this.fillStyle, this.globalAlpha);
    else glyphs.set(this.canvas, { value: String(value), x, y, size, width, color: this.fillStyle });
    return fill.call(this, value, x, y, ...args);
  };
  proto.drawImage = function (source, ...args) {
    if (!output.enabled) return image.call(this, source, ...args);
    const glyph = glyphs.get(source);
    if (this.canvas.id === 'ui' && glyph && args.length === 4) {
      const [x, y, w, h] = args, scale = w / source.width;
      record(this, glyph.value, x + glyph.x * scale, y + (glyph.y - glyph.size) * scale, glyph.width * scale, glyph.size * scale, glyph.color, this.globalAlpha);
    }
    return image.call(this, source, ...args);
  };
  proto.lineTo = function (x, y) {
    if (output.enabled && this.canvas.id === 'ui' && this.strokeStyle === '#e8f1f4') { output.lines.push({ x, y }); if (output.lines.length > 1200) output.lines.splice(0, 600); }
    return line.call(this, x, y);
  };
}
async function painted() { await evaluate('__playabilityPaint.texts=[]; __playabilityPaint.lines=[]'); await paint(); return evaluate('__playabilityPaint'); }
async function trailCheck(s, external) {
  assert.equal(s.p.continuousTrails, true);
  for (const side of [-1, 1]) assert(s.vapor.some(v => v.side === side), `Missing continuous side ${side}`);
  if (!external) return { samples: s.vapor.length, sides: [...new Set(s.vapor.map(v => v.side))], external: false };
  const p = await painted(), VW = 340 * s.canvas.rect.width / s.canvas.rect.height;
  const attached = [-1, 1].map(side => {
    const b = s.p.renderBasis, tip = { x: s.p.pos.x + b.right.x * 4.9 * side - b.fwd.x * 1.3, y: s.p.pos.y + b.right.y * 4.9 * side - b.fwd.y * 1.3, z: s.p.pos.z + b.right.z * 4.9 * side - b.fwd.z * 1.3 };
    const expected = projection(tip, s), x = expected.x / s.canvas.rect.width * VW, y = expected.y / s.canvas.rect.height * 340;
    return { side, attached: p.lines.some(v => Math.hypot(v.x - x, v.y - y) < 1), expected: { x, y } };
  });
  assert(attached.every(v => v.attached), `Actual trail endpoints do not meet wing tips: ${JSON.stringify(attached)}`);
  return { samples: s.vapor.length, attached, external: true };
}
async function topCase(r) {
  r.viewports = [];
  for (const size of sizes) {
    await navigate(size); await start('intercept'); await selectView(0); const s = await step(.3), g = geometry(s);
    assert(g.lengthFraction >= .08 && g.lengthFraction <= .18 && g.spanFraction < .4); near(g.cameraHeight, 85, 'Top distance'); near(g.fov, 1.10, 'Top FOV'); assert(g.sceneHeight >= 100);
    const trails = await trailCheck(s, true), text = (await painted()).texts;
    const paintedLabels = text.filter(t => /(?:敌机|防空|装甲|锁定).*(?:km|米|\bm)/.test(t.value) && ['#ffb2a3', '#b9ddff', '#ffe39a'].includes(String(t.color).toLowerCase()));
    assert(paintedLabels.length, `No readable natural enemy cues at ${size.name}`);
    const labels = [...new Map(paintedLabels.map(t => [`${t.value}|${Math.round(t.x)}|${Math.round(t.y)}`, t])).values()];
    assert(labels.every(t => t.h >= 14 - .5 && t.alpha >= .89 && t.x >= 0 && t.y >= 0 && t.x + t.w <= size.width + 1 && t.y + t.h <= size.height + 1), `Unreadable cue: ${JSON.stringify(labels)}`);
    const weaponStatus = text.filter(t => ['机炮', '加力', '待发', '待命'].includes(t.value) && t.y > size.height * .62 && t.h >= 7);
    assert(weaponStatus.some(t => t.value === '加力'), `Missing painted boost status at ${size.name}`);
    for (const label of labels) for (const weapon of weaponStatus)
      assert(!(label.x < weapon.x + weapon.w && label.x + label.w > weapon.x && label.y < weapon.y + weapon.h && label.y + label.h > weapon.y), `${size.name} cue ${label.value} covers ${weapon.value}`);
    const recoverButton = await point('[data-sky-action="recover"]');
    r.viewports.push({ ...size, geometry: g, trails, labels, naturalEnemies: s.enemies, recoverButton, screenshot: await shot(`top_${size.name}`) });
    assert.deepEqual(s.errors, []); assert.deepEqual(s.exceptions, []); assert.deepEqual(runtimeErrors(), []);
  }
  // Low-speed emission must survive expiration of every original sample.
  await navigate(); await start(); await configure(300); await restart(); await selectView(0); const first = await step(.3), firstPositions = first.vapor.map(v => JSON.stringify(v.pos));
  const later = await step(.7); r.lowSpeedTop = { speed: later.p.speed, trails: await trailCheck(later, true) };
  assert(later.vapor.every(v => !firstPositions.includes(JSON.stringify(v.pos))));
  await selectView(1); const chase = await step(.7); r.lowSpeedChase = { speed: chase.p.speed, trails: await trailCheck(chase, true), screenshot: await shot('trails_100kt_chase') };
  await selectView(2); const cockpit = await step(.7); r.lowSpeedCockpit = { speed: cockpit.p.speed, trails: await trailCheck(cockpit, false) };
  r.nativeCueLock = await nativeCueLock();
}
async function nativeCueLock() {
  await navigate(); await start('intercept'); await selectView(0);
  let s = await state(), target = s.enemies.find(e => e.distance < 2600);
  assert(target, 'No natural enemy aircraft in lock range'); const id = target.id;
  for (let frame = 0; frame < 180; frame++) {
    s = await state(); target = s.enemies.find(e => e.id === id); assert(target);
    const error = wrap(Math.atan2(target.pos.x - s.p.pos.x, -(target.pos.z - s.p.pos.z)) - s.p.yaw);
    if (Math.abs(error) < .25) break;
    const code = error > 0 ? 'KeyD' : 'KeyA'; await key(code); await step(.05); await key(code, false);
  }
  let aimedAt;
  for (let frame = 0; frame < 45; frame++) {
    s = await state(); target = s.enemies.find(e => e.id === id); assert(target);
    const suffix = target.distance >= 1000 ? (target.distance / 1000).toFixed(1) + ' km' : Math.round(target.distance) + ' m';
    const label = (await painted()).texts.find(t => /^(敌机|锁定中|已锁定) /.test(t.value) && t.value.endsWith(suffix) && ['#ffb2a3', '#b9ddff', '#ffe39a'].includes(String(t.color).toLowerCase()));
    assert(label, `No actual painted label for natural enemy ${id}/${suffix}`); aimedAt = { x: label.x + label.w / 2, y: label.y + label.h / 2 };
    await move(aimedAt.x, aimedAt.y); await step(.04); s = await state(); if (s.lock.phase === 'locked' && s.lock.targetId === id) break;
  }
  assert.equal(s.lock.phase, 'locked'); assert.equal(s.lock.targetId, id);
  const screenshot = await shot('native_enemy_lock'); await tap('KeyE');
  const tracksActualTarget = await evaluate(`__PI.G.missiles.some(m=>m.owner==='player' && m.target===__PI.G.lock.target && m.target?.showIndex===${JSON.stringify(id)})`); assert(tracksActualTarget);
  const rect = s.canvas.rect; await move(rect.left + rect.width - (aimedAt.x - rect.left), rect.top + rect.height - (aimedAt.y - rect.top)); await step(.35);
  const opposite = await state(); assert(opposite.lock.phase !== 'locked' || opposite.lock.targetId !== id);
  return { targetId: id, targetDistance: target.distance, nativePointer: aimedAt, tracksActualTarget, oppositePhase: opposite.lock.phase, screenshot };
}
async function gesture(code = 'KeyD') { await key(code); await step(2.1); await key(code, false); await step(.1); await tap(code); await step(.12); await tap(code); assert((await state()).p.halfRoll); }
function basisAngle(a, b) { const dot = (u, v) => u.x * v.x + u.y * v.y + u.z * v.z; return Math.acos(Math.max(-1, Math.min(1, (dot(a.up, b.up) + dot(a.right, b.right) + dot(a.fwd, b.fwd) - 1) / 2))); }
async function recoverySequence(view, useButton, size = sizes[0]) {
  await navigate(size); await start(); await selectView(view); await gesture(); await step(1.6); await key('KeyW'); await step(.2); await key('KeyW', false);
  const before = await state(); assert(before.p.renderBasis.up.y < -.8); const frames = [], rows = [];
  if (useButton) await click('[data-sky-action="recover"]', size.mobile); else await tap('KeyR');
  const triggered = await state(); assert(triggered.p.recovery); near(basisAngle(before.p.renderBasis, triggered.p.renderBasis), 0, 'R trigger attitude jumped');
  frames.push({ t: 0, screenshot: await shot(`recovery_${size.name}_${view}_0000`) });
  for (const t of [.4, .8, 1.2, 1.6]) {
    const section = await evaluate(`(() => { const rows=[]; for(let i=0;i<24;i++){__PI.step(1/60); const g=__PI.G,p=g.player;rows.push({time:g.time,missionTime:g.missionTime,yaw:p.yaw,pitch:p.pitch,roll:p.roll,inversionRoll:p.inversionRoll,renderBasis:p.renderBasis,recovery:!!p.recovery,pos:{...p.pos}});}return rows;})()`);
    rows.push(...section); frames.push({ t, screenshot: await shot(`recovery_${size.name}_${view}_${String(Math.round(t * 1000)).padStart(4, '0')}`) });
    if (t === .4) { await key('KeyR', true, true); await key('KeyR', false); await tap('KeyQ'); assert((await state()).p.recovery); }
    if (t === .8) {
      await tap('Escape'); const paused = await state(); await step(.5); const held = await state(); near(held.p.recovery.time, paused.p.recovery.time, 'Pause advanced recovery'); near(distance(held.p.pos, paused.p.pos), 0, 'Pause moved aircraft'); await tap('Escape');
    }
  }
  const after = await state(), all = [before.p.renderBasis, ...rows.map(v => v.renderBasis)], maxStep = Math.max(...all.slice(1).map((v, i) => basisAngle(v, all[i])));
  assert(maxStep <= 4 / 60 + 1e-5, `Recovery stepped ${maxStep}rad in one frame`); assert(!after.p.recovery && after.p.basis.up.y > .999); near(after.p.pitch, 0, 'R pitch'); near(after.p.inversionRoll, 0, 'R inversion'); near(after.p.yaw, before.p.yaw, 'R changed heading'); near(after.missionTime - before.missionTime, 1.6, 'R reset mission'); assert(distance(after.p.pos, before.p.pos) > before.p.speed * 1.5, 'R interrupted real forward flight');
  return { view, useButton, size, before, after, maxStep, frames, rows };
}
async function recoveryCase(r) { r.cockpitKeyboard = await recoverySequence(2, false); r.externalButton = await recoverySequence(1, true); r.portraitTouchButton = await recoverySequence(1, true, sizes[1]); }
async function handlingCase(r) {
  await navigate(); await start(); await selectView(2); await step(1.25);
  r.sky = await shot('cockpit_blue_hour');
  r.views = [];
  for (const view of [1, 0, 2]) {
    await restart(); await selectView(view);
    const before = await state();
    await key('KeyD'); const onset = await step(1 / 60); const turning = await step(1.65);
    await key('KeyD', false); const settled = await step(1.5);
    const onsetYawRate = wrap(onset.p.yaw - before.p.yaw) * 60;
    const turnDegrees = wrap(turning.p.yaw - before.p.yaw) * 180 / Math.PI;
    assert(onsetYawRate > 0 && onsetYawRate < .025 && turnDegrees > 10 && turnDegrees < 50, `Turn onset or steady response ${view}: ${onsetYawRate}, ${turnDegrees}`);
    assert(Math.abs(settled.p.roll) < .08);
    if (view !== 2) near(turning.camera.right.y, 0, 'External horizon should stay level');
    await key('KeyW'); const aimed = await step(.4); await key('KeyW', false);
    const held = await step(.8);
    near(aimed.p.pitch, .208, 'Aim pitch'); near(held.p.pitch, aimed.p.pitch, 'Aim angle after W release');
    const mission = held.missionTime;
    await tap('KeyR'); const leveled = await step(1.6);
    near(leveled.p.pitch, 0, 'R after pitch hold'); near(leveled.missionTime, mission + 1.6, 'R during normal flight');
    r.views.push({ view, onsetYawRate, turnDegrees, beforeRelease: aimed.p.pitch, afterRelease: held.p.pitch });
  }
  near(r.views[0].turnDegrees, r.views[2].turnDegrees, 'Chase uses the same turn rate as cockpit');
  near(r.views[1].turnDegrees, r.views[2].turnDegrees, 'Top uses the same turn rate as cockpit');
}
async function impactCase(r) {
  await navigate(); await start('inland');
  async function collision(missile) {
    await key('KeyS'); const aimed = await step(.4); await key('KeyS', false);
    await tap(missile ? 'KeyE' : 'KeyF');
    const result = await evaluate(`(() => {
      const g = __PI.G, projectiles = ${missile} ? 'missiles' : 'bullets';
      const projectile = g[projectiles].find(p => p.owner === 'player');
      if (!projectile) throw Error('Missing player projectile');
      for (let frame = 1; frame <= 180; frame++) {
        __PI.step(1 / 60);
        if (!g[projectiles].includes(projectile)) {
          const effect = g.effects.find(e => ${missile} ? e.type === 'fire' : e.type === 'mist' && e.color === '#b99a70');
          if (!effect || !projectile.dead || projectile.life <= 0 || g.mode !== 'play') throw Error('Missing terrain impact');
          return { seconds: frame / 60, ground: g.map.heightAt(effect.pos.x, effect.pos.z), impact: effect.pos, size: effect.size, effects: g.effects.map(e => e.type), collisionSpeed: Math.hypot(projectile.vel.x, projectile.vel.y, projectile.vel.z) };
        }
      }
      throw Error('The real projectile did not reach terrain');
    })()`);
    assert(result.ground > 0 && Math.abs(result.impact.y - result.ground) < 3);
    near((await state()).p.pitch, aimed.p.pitch, 'Impact approach retained pitch after S release');
    result.screenshot = await shot(missile ? 'missile_ground' : 'gun_ground');
    return result;
  }
  r.gun = await collision(false);
  await restart(); r.missile = await collision(true);
  assert(r.missile.size > 3 * r.gun.size && r.missile.effects.includes('smoke'));
  await step(.8); r.smoke = await shot('missile_smoke');
}
async function wallMeasure(name, seconds = 5, shift = false) {
  if (shift) await key('ShiftLeft');
  const data = await evaluate(`new Promise(resolve => {
    const rows = [], start = performance.now();
    function frame(now) {
      const g = __PI.G, p = g.player, c = g.camera;
      rows.push({ wall: now / 1000, sim: g.time, real: g.realTime, fps: g.fps, speed: p.speed,
        target: p.targetSpeed, fuel: p.fuel, burning: p.burning, pos: { ...p.pos }, fov: c.fov, mode: g.mode, freeze: g.freeze });
      if (now - start < ${seconds * 1000}) requestAnimationFrame(frame);
      else resolve({ rows });
    }
    requestAnimationFrame(frame);
  })`);
  if (shift) await key('ShiftLeft', false);
  const rows = data.rows, first = rows[0], last = rows.at(-1), wall = last.wall - first.wall, sim = last.sim - first.sim;
  const gaps = rows.slice(1).map((v, i) => v.wall - rows[i].wall), length = rows.slice(1).reduce((sum, v, i) => sum + distance(v.pos, rows[i].pos), 0), cappedElapsed = gaps.reduce((sum, v) => sum + Math.min(.5, v), 0);
  const tail = rows.filter(v => v.wall >= last.wall - 1.5), tailWall = tail.at(-1).wall - tail[0].wall, tailDistance = tail.slice(1).reduce((sum, v, i) => sum + distance(v.pos, tail[i].pos), 0);
  assert(rows.every(v => v.mode === 'play' && v.freeze === false), 'Wall-clock measurement changed play/freeze state'); near(Math.max(...rows.map(v => v.fov)), Math.min(...rows.map(v => v.fov)), 'RAF speed pumped FOV');
  const formerLostTime = gaps.reduce((sum, gap) => sum + Math.max(0, gap - .05), 0);
  const summary = { wall, sim, simWall: sim / wall, capAdjustedRatio: sim / cappedElapsed, actualFps: (rows.length - 1) / wall, hudFps: last.fps, distance: length, wallMps: length / wall, tailWallMps: tailDistance / tailWall, finalSpeed: last.speed, finalFuel: last.fuel, maxGap: Math.max(...gaps), gapsOverCap: gaps.filter(v => v > .5).length, boundedElapsed: cappedElapsed, formerLostTime };
  if (shift) assert(rows.some(row => row.burning) && last.fuel < first.fuel, 'Shift was never applied during the sample');
  assert(summary.capAdjustedRatio > .88 && summary.capAdjustedRatio < 1.12, `RAF lost bounded wall time: ${JSON.stringify(summary)}`);
  console.log(`MEASURE ${name} ${JSON.stringify(summary)}`); return { name, shift, summary, rows };
}
async function walltimeCase(r) {
  await navigate(); await evaluate('__playabilityPaint.enabled=false'); await start(); r.measurements = [];
  // 300 档是旧 100 节的最低实速；500 档起档位与实速一致。
  for (const [name, value, shift] of [['dial300_100kt', 300, false], ['dial500_500kt', 500, false], ['default', 'default', false], ['default_shift', 'default', true]]) {
    await configure(value); await restart(); await selectView(0); await evaluate('__PI.freeze(false)');
    const before = await state();
    const { x, z } = before.p.pos;
    const ground = { x, y: await evaluate(`Math.max(0, __PI.G.map.heightAt(${x}, ${z}))`), z };
    const a = projection(ground, before), sample = await wallMeasure(name, 5, shift), after = await state(), b = projection(ground, after);
    sample.groundProjection = { world: ground, before: a, after: b, pixels: Math.hypot(b.x - a.x, b.y - a.y) }; sample.screenshot = await shot(`speed_${name}`); r.measurements.push(sample); await evaluate('__PI.freeze(true)');
  }
  const [slow, fast, normal, boost] = r.measurements;
  r.speedRatio = fast.summary.wallMps / slow.summary.wallMps; r.shiftSteadyRatio = boost.summary.tailWallMps / normal.summary.tailWallMps;
  r.shiftPixelRatio = boost.groundProjection.pixels / normal.groundProjection.pixels;
  // 默认 Shift 从 300 档（实速 100 节）爬到 500 档（500 节），稳定后是 5 倍世界位移。
  assert(r.speedRatio > 4.8 && r.speedRatio < 5.2); assert(r.shiftSteadyRatio > 4.8 && r.shiftSteadyRatio < 5.2); assert(fast.groundProjection.pixels / fast.summary.wall > slow.groundProjection.pixels / slow.summary.wall * 4.6);
  // 用户口径是“景、机相对位移”：同一地面地标在 Shift 下的屏幕位移必须同样拉开。
  assert(r.shiftPixelRatio > 3.5, `Shift did not visibly move the same ground landmark: ${r.shiftPixelRatio}`);
  await configure('default'); await restart(); await selectView(0); await evaluate('__PI.freeze(false)'); await send('Emulation.setCPUThrottlingRate', { rate: 48 }); await sleep(1800);
  const low = await wallMeasure('cpu48_default', 6); r.measurements.push(low);
  await send('Emulation.setCPUThrottlingRate', { rate: 1 }); await evaluate('__PI.freeze(true)'); await restart(); await selectView(0); await evaluate('__PI.freeze(false)'); await send('Emulation.setCPUThrottlingRate', { rate: 48 }); await sleep(1800);
  const lowBoost = await wallMeasure('cpu48_shift', 6, true); r.measurements.push(lowBoost); await send('Emulation.setCPUThrottlingRate', { rate: 1 }); await evaluate('__PI.freeze(true)');
  for (const sample of [low, lowBoost]) assert(sample.summary.formerLostTime > .25, 'CPU stress must exercise stalls beyond the former 50ms limit');
  for (const sample of [low, lowBoost]) if (!sample.summary.gapsOverCap) assert(sample.summary.simWall > .88, 'Low FPS retained slow-motion inside the bounded recovery window');
  if (!low.summary.gapsOverCap && !lowBoost.summary.gapsOverCap) assert(lowBoost.summary.tailWallMps > low.summary.tailWallMps * 2);
  assert(Math.abs(low.summary.hudFps - low.summary.actualFps) < Math.max(3, low.summary.actualFps * .3), 'HUD frame rate is inflated');
}
async function runCase(name, fn) {
  const result = { name, result: 'RUNNING', startedAt: new Date().toISOString(), command: report.command }; report.cases.push(result);
  try { await fn(result); const s = await state(); assert.deepEqual(s.errors, []); assert.deepEqual(s.exceptions, []); assert.deepEqual(runtimeErrors(), []); result.result = 'PASS'; result.runtimeErrors = []; console.log(`PASS ${name}`); }
  catch (error) { result.result = 'FAIL'; result.error = error.stack; result.lastState = await state().catch(() => null); result.runtimeErrors = runtimeErrors(); try { result.failureScreenshot = await shot(`${name}_failed`); } catch {} console.error(`FAIL ${name}: ${error.message}`); }
  result.finishedAt = new Date().toISOString();
}
async function main() {
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true }); profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-playability-')); let stderr = '';
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  try {
    let port; for (let i = 0; i < 150; i++) { try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (port) break; } catch {} await sleep(100); }
    assert(port, `Chrome did not start: ${stderr}`); const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); report.browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = event => { const m = JSON.parse(event.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method) events.push(m); };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installPaintCapture})()` });
    if (!only || only === 'top') await runCase('top', topCase);
    if (!only || only === 'recovery') await runCase('recovery', recoveryCase);
    if (!only || only === 'handling') await runCase('handling', handlingCase);
    if (!only || only === 'impacts') await runCase('impacts', impactCase);
    if (!only || only === 'walltime') await runCase('walltime', walltimeCase);
    report.result = report.cases.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL';
  } finally {
    ws?.close(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Closed own Chrome')); } pending.clear();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGTERM'); for (let i = 0; i < 30 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100); if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await new Promise(resolve => chrome.once('exit', resolve)); } }
    if (profile) fs.rmSync(profile, { recursive: true, force: true }); report.cleanup = { ownChromeStopped: !chrome || chrome.exitCode !== null || chrome.signalCode !== null, ownProfileDeleted: !profile || !fs.existsSync(profile) }; report.finishedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); console.log(`RESULT ${report.result}: shots/sky_playability_results.json`);
  }
  if (report.result !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

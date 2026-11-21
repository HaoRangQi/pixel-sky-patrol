#!/usr/bin/env node
// Real CDP input and real flight; never assigns player pose, speed, time or AI.
// Requires the existing 8765 service. No dependencies or desktop browser access.
// Usage: node tools/verify_sky_comfort.mjs [--only=flight|pause|legacy|crossview]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8765', KT = 1.94384;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const only = process.argv.find(v => v.startsWith('--only='))?.slice(7);
assert(!only || ['flight', 'pause', 'legacy', 'crossview'].includes(only), 'Unknown --only');
const sizes = [{ name: 'desktop', width: 1440, height: 900, mobile: false }, { name: 'portrait', width: 390, height: 844, mobile: true }, { name: 'landscape', width: 844, height: 390, mobile: true }];
const previousFile = path.join(ROOT, 'shots', 'sky_comfort_results.json');
const replacedCases = only === 'pause' ? ['pause_layout_and_flare'] : only === 'crossview' ? ['inverted_crossview', 'overlap_ad_rejection'] : [];
const previous = replacedCases.length && fs.existsSync(previousFile) ? JSON.parse(fs.readFileSync(previousFile, 'utf8')) : null;
const report = { startedAt: new Date().toISOString(), command: `node tools/verify_sky_comfort.mjs${only ? ` --only=${only}` : ''}`, result: 'RUNNING', cases: previous?.cases.filter(c => !replacedCases.includes(c.name)) || [], screenshots: previous?.screenshots.filter(s => !path.basename(s).startsWith(only === 'pause' ? 'sky_comfort_pause_' : 'sky_comfort_crossview_')) || [], ...(previous ? { retainedFlightEvidence: { ...(previous.retainedFlightEvidence || { command: previous.command, startedAt: previous.startedAt, finishedAt: previous.finishedAt }), priorAggregate: { command: previous.command, startedAt: previous.startedAt, finishedAt: previous.finishedAt }, reason: 'Unaffected checks retain their successful evidence. The cases named by this scoped invocation are refreshed against the current candidate.' } } : {}), inputPath: 'CDP native keyboard/mouse/touch. Page settings use actual pause inputs. __PI.freeze/step advances the real engine including G.realTime. Restarts use the existing __SKY API atomically; no pose/speed/time/AI assignment.' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const near = (a, b, why, eps = 1e-7) => assert(Math.abs(a - b) <= eps, `${why}: ${a} != ${b}`);
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
function pageState() {
  const g = __PI.G, p = g.player, c = g.camera, ui = document.getElementById('ui');
  const range = id => { const e = document.getElementById(id); return e && { min: +e.min, max: +e.max, step: +e.step, value: +e.value, disabled: e.disabled, output: document.getElementById(`${id}-value`)?.textContent }; };
  return {
    mode: g.mode, time: g.time, realTime: g.realTime, view: g.view, viewBlend: g.viewBlend, cockpitAlpha: g.cockpitAlpha,
    shots: g.stats.shots, enemySpeedScale: g.enemySpeedScale ?? null, flightMode: window.__SKY?.flightMode,
    p: { pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, roll: p.roll, yawRate: p.yawRate, speed: p.speed, targetSpeed: p.targetSpeed, fuel: p.fuel, burning: p.burning, cruiseSpeed: p.cruiseSpeed ?? null, burnSpeed: p.burnSpeed ?? null, mouseSteering: p.mouseSteering ?? null, inversionRoll: p.inversionRoll ?? 0, spin: p.spin, rollT: p.rollT, halfRoll: p.halfRoll ?? null, basis: p.basis, renderBasis: p.renderBasis, steering: p.steering, shield: p.shield, dead: p.dead, flares: p.flares, flareCd: p.flareCd, missiles: p.missiles },
    camera: c && { pos: c.pos, up: c.up, right: c.right, fwd: c.fwd, fov: c.fov, vp: [...c.vp] },
    canvas: { width: ui.width, height: ui.height, rect: ui.getBoundingClientRect().toJSON() },
    settings: { cruise: range('sky-cruise-speed'), burn: range('sky-burn-speed'), enemy: range('sky-enemy-speed'), mouse: document.getElementById('sky-mouse-steering')?.checked },
    errors: [...__PI.errors], exceptions: [...__PI.exceptions],
  };
}
const state = () => evaluate(`(${pageState})()`);
const paint = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
const step = sec => evaluate(`__PI.step(${sec}); window.__SKY?.sync(); (${pageState})()`);
const runtimeErrors = () => events.filter(e => e.method === 'Runtime.exceptionThrown' || e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' || e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network');
async function key(code, down = true, autoRepeat = false) {
  const map = { Escape: ['Escape', 27], Space: [' ', 32], ShiftLeft: ['Shift', 16], KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyQ: ['q', 81], KeyC: ['c', 67] };
  const [key, windowsVirtualKeyCode] = map[code];
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key, code, windowsVirtualKeyCode, autoRepeat, ...(down && code === 'KeyC' ? { text: 'c', unmodifiedText: 'c' } : {}) });
}
async function tap(code) { await key(code); await key(code, false); }
async function point(selector, fx = 0.5, fy = 0.5) {
  const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) throw Error('Unavailable target ' + ${JSON.stringify(selector)}); if (e.closest('.sky-dialog')) e.scrollIntoView({ block:'center', behavior:'instant' }); const r=e.getBoundingClientRect(), x=r.x+r.width*${fx}, y=r.y+r.height*${fy}, h=document.elementFromPoint(x,y); return { x,y,width:r.width,height:r.height,hit:h===e||e.contains(h),hitId:h?.id,visible:r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight }; })()`);
  assert(p.visible && p.hit, `Target not reachable ${selector}: ${JSON.stringify(p)}`); return p;
}
async function mouseMove(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
async function click(selector, fx = 0.5, fy = 0.5) {
  const p = await point(selector, fx, fy); await mouseMove(p.x, p.y);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
async function touch(type, x, y) { await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] }); }
async function shot(name) {
  await paint();
  const file = path.join(ROOT, 'shots', `sky_comfort_${name}.png`), r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  const relative = path.relative(ROOT, file);
  report.screenshots.push(relative); return relative;
}
async function navigate(size = sizes[0], legacy = false) {
  events = [];
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: `${BASE}/${legacy ? '' : 'sky-patrol/'}?adapt=0` });
  const end = Date.now() + 60000;
  while (!events.some(e => e.method === 'Page.loadEventFired')) { assert(Date.now() < end, 'Page load timed out'); await sleep(50); }
  while (!(await evaluate('!!window.__PI?.ready()'))) { assert(Date.now() < end, 'Terrain readiness timed out'); await sleep(100); }
  assert.equal(await evaluate('__PI.boot.error || null'), null);
}
async function start(mode = 'free') { return evaluate(`__SKY.start(${JSON.stringify(mode)}); __PI.freeze(true); (${pageState})()`); }
async function restart() { return evaluate(`__SKY.restart(); __PI.freeze(true); (${pageState})()`); }
async function pause() { if ((await state()).mode !== 'paused') await tap('Escape'); assert.equal((await state()).mode, 'paused'); }
async function resume() { await tap('Escape'); assert.equal((await state()).mode, 'play'); }
async function range(id, value) { await evaluate(`(() => { const e=document.getElementById(${JSON.stringify(id)}); e.value=${value}; e.dispatchEvent(new Event('input',{bubbles:true})); })()`); }
async function configure({ cruise, burn, enemy, mouse, defaults = false } = {}) {
  await pause();
  if (defaults) await click('#sky-speed-reset');
  if (cruise !== undefined) await range('sky-cruise-speed', cruise);
  if (burn !== undefined) await range('sky-burn-speed', burn);
  if (enemy !== undefined) await range('sky-enemy-speed', enemy);
  if (mouse !== undefined && (await state()).settings.mouse !== mouse) await click('#sky-mouse-steering');
  await resume();
}
function project(world, s) {
  const m = s.camera.vp, { x, y, z } = world;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return { x: ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * s.canvas.rect.width, y: (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * s.canvas.rect.height, w };
}
async function straightRun(cruise, shift = false, seconds = 4, commonGroundPoint) {
  if (cruise === 'default') await configure({ defaults: true, mouse: false });
  else await configure({ cruise, burn: 500, mouse: false });
  const spawn = await restart();
  const groundPoint = commonGroundPoint || await evaluate(`(() => { const g=__PI.G,p=g.player,f=p.basis.fwd; const x=p.pos.x+f.x*2200,z=p.pos.z+f.z*2200; return {x,y:Math.max(0,g.map.heightAt(x,z)),z}; })()`);
  const initial = await step(1 / 60), beforeProjection = project(groundPoint, initial);
  if (shift) await key('ShiftLeft');
  const samples = [];
  for (let i = 0; i < seconds * 2; i++) {
    const s = await step(0.5); assert.equal(s.mode, 'play'); assert(!s.p.dead);
    samples.push({ time: s.time - initial.time, speed: s.p.speed, pos: s.p.pos, fuel: s.p.fuel, burning: s.p.burning, fov: s.camera.fov });
  }
  if (shift) await key('ShiftLeft', false);
  const final = await state(), afterProjection = project(groundPoint, final);
  const fovs = samples.map(s => s.fov);
  near(Math.max(...fovs), Math.min(...fovs), 'Speed comparison changed the chase FOV');
  return { selection: cruise, shift, seconds, spawn: spawn.p.pos, initial: { pos: initial.p.pos, speed: initial.p.speed, time: initial.time }, final: { pos: final.p.pos, speed: final.p.speed, time: final.time, fuel: final.p.fuel, burning: final.p.burning }, distance: distance(final.p.pos, initial.p.pos), groundPoint, projection: { before: beforeProjection, after: afterProjection, pixelMotion: Math.hypot(afterProjection.x - beforeProjection.x, afterProjection.y - beforeProjection.y) }, samples, screenshot: await shot(`speed_${cruise}${shift ? '_shift' : ''}_${seconds}s`) };
}
async function speedCase(r) {
  await navigate(); await start();
  const slow = r.slow = await straightRun(100), fast = r.fast = await straightRun(500, false, 4, slow.groundPoint);
  assert.deepEqual(slow.spawn, fast.spawn, '100/500 comparison did not restart on the same route');
  assert(fast.distance > slow.distance * 4.9 && fast.distance < slow.distance * 5.1, '100/500 actual displacement ratio is not five');
  assert(fast.projection.pixelMotion > slow.projection.pixelMotion * 2, 'Ground world-point projection did not reveal speed difference');
  const normal = r.normal = await straightRun('default', false, 3), boost = r.boost = await straightRun('default', true, 3, normal.groundPoint);
  near(normal.initial.speed, 112, 'Default cruise was rounded'); near(boost.initial.speed, 112, 'Default boost start was rounded');
  near(boost.final.speed, 500 / KT, 'Three seconds of Shift did not reach 500 knots');
  assert(boost.distance > normal.distance * 1.45, 'Shift did not materially increase actual displacement');
  const high = await straightRun(500, true, 3);
  near(high.final.fuel, 100, '500-knot cruise Shift wasted fuel'); assert.equal(high.final.burning, false);
  await configure({ cruise: 100, burn: 500 }); await restart();
  const transitionBefore = await state(); await configure({ cruise: 500 }); const selected = await state();
  near(selected.p.speed, transitionBefore.p.speed, 'Paused 100-to-500 change snapped actual speed');
  const twoSeconds = await step(2), target = 500 / KT;
  const achievedFraction = (twoSeconds.p.speed - transitionBefore.p.speed) / (target - transitionBefore.p.speed);
  assert(achievedFraction > 0.95 && achievedFraction < 1, `Two-second cruise response is too slow or snapped: ${achievedFraction}`);
  near(twoSeconds.p.speed, target + (100 / KT - target) * Math.exp(-1.6 * 2), 'Cruise response does not use the chosen 1.6 per-second convergence');
  r.slow = slow; r.fast = fast; r.ratio = fast.distance / slow.distance; r.normal = normal; r.boost = boost; r.atCap = high;
  r.twoSecondResponse = { before: transitionBefore.p.speed, target, after: twoSeconds.p.speed, achievedFraction, distance: distance(transitionBefore.p.pos, twoSeconds.p.pos), time: twoSeconds.time - transitionBefore.time };
}
async function pointerDrive(fraction, seconds = 0.6) {
  const p = await point('#gl', fraction, 0.52), before = await state();
  for (let i = 0; i < Math.round(seconds * 20); i++) { await mouseMove(p.x, p.y); await step(0.05); }
  return { before, after: await state() };
}
async function mouseCase(r) {
  await start(); await configure({ defaults: true, mouse: false }); await restart(); await step(0.2);
  const off = await pointerDrive(0.78);
  near(angle(off.after.p.yaw, off.before.p.yaw), 0, 'Default-disabled mouse changed direction'); near(off.after.p.roll, 0, 'Default-disabled mouse banked the aircraft');
  await click('#gl', 0.5, 0.45); const fired = await step(0.2);
  assert(fired.shots > off.after.shots, 'Disabled mouse steering disabled cannon fire');
  await restart(); await key('KeyD'); const keyboard = await step(0.6); await key('KeyD', false);
  assert(Math.abs(keyboard.p.roll) > 0.2 && Math.abs(keyboard.p.yaw + 0.08) > 0.02, 'WASD failed while mouse direction was disabled');
  await restart(); await step(0.1);
  const origin = await point('#gl', 0.5, 0.5), moved = await point('#gl', 0.73, 0.5);
  const beforeTouch = await state();
  await touch('touchStart', origin.x, origin.y); await touch('touchMove', moved.x, moved.y);
  const touchHeld = await step(0.5); await touch('touchEnd');
  assert(Math.abs(angle(touchHeld.p.yaw, beforeTouch.p.yaw)) > 0.02 && Math.abs(touchHeld.p.steering.sx) > 0.2, 'Native touch stick failed with mouse steering off');
  await restart(); await configure({ mouse: true }); await restart();
  const on = await pointerDrive(0.78);
  assert(Math.abs(angle(on.after.p.yaw, on.before.p.yaw)) > 0.03 && on.after.p.steering.sx > 0.4, 'Enabled mouse did not steer aircraft');
  r.off = { yawChange: angle(off.after.p.yaw, off.before.p.yaw), bank: off.after.p.roll, shotsBefore: off.after.shots, shotsAfter: fired.shots };
  r.keyboard = { yaw: keyboard.p.yaw, bank: keyboard.p.roll, steering: keyboard.p.steering };
  r.touch = { yawChange: angle(touchHeld.p.yaw, beforeTouch.p.yaw), steering: touchHeld.p.steering };
  r.on = { yawChange: angle(on.after.p.yaw, on.before.p.yaw), steering: on.after.p.steering };
  await configure({ mouse: false });
}
async function sampleFrames(count) {
  return evaluate(`(() => {
    const rows=[];
    for(let i=0;i<${count};i++) {
      __PI.step(1/60);
      const g=__PI.G,p=g.player,c=g.camera,b=p.renderBasis;
      rows.push({time:g.time,realTime:g.realTime,mode:g.mode,view:g.view,viewBlend:g.viewBlend,roll:p.roll,yaw:p.yaw,yawRate:p.yawRate,inversionRoll:p.inversionRoll??0,spin:p.spin,rollT:p.rollT,bodyUpY:p.basis.up.y,renderBank:Math.atan2(b.right.y,b.up.y),cameraBank:Math.atan2(c.right.y,c.up.y),cameraUpY:c.up.y,cameraUp:{...c.up},cameraFwd:{...c.fwd},alignment:c.up.x*b.up.x+c.up.y*b.up.y+c.up.z*b.up.z,cameraRoll:Math.asin(Math.max(-1,Math.min(1,c.right.y)))});
    }
    return rows;
  })()`);
}
async function cockpitStart() { await start(); await configure({ defaults: true, mouse: false }); await restart(); await tap('Space'); await step(1.25); const s = await state(); assert.equal(s.view, 2); assert(s.viewBlend >= 1 && s.cockpitAlpha > 0.99); return s; }
async function armAndDouble(code = 'KeyD') {
  const before = await state(); await key(code); await step(2.1); await key(code, false); await step(0.1);
  await tap(code); await step(0.12); await tap(code);
  return { before: before.p.inversionRoll, trigger: await state() };
}
async function inversionSequence(name) {
  const trigger = await armAndDouble();
  const rows = [], frames = [{ t: 0, state: await state(), screenshot: await shot(`${name}_0000`) }];
  for (const [n, t] of [[24, 0.4], [24, 0.8], [24, 1.2], [24, 1.6]]) { rows.push(...await sampleFrames(n)); frames.push({ t, state: await state(), screenshot: await shot(`${name}_${String(Math.round(t * 1000)).padStart(4, '0')}`) }); }
  return { trigger, rows, frames };
}
async function cockpitCase(r) {
  const initial = await cockpitStart(), rows = [], frames = [{ t: 0, state: initial, screenshot: await shot('cockpit_ad_0000') }];
  await key('KeyD');
  for (const [n, t] of [[30, 0.5], [30, 1], [36, 1.6]]) { rows.push(...await sampleFrames(n)); frames.push({ t, state: await state(), screenshot: await shot(`cockpit_ad_${String(Math.round(t * 1000)).padStart(4, '0')}`) }); }
  await key('KeyD', false);
  const all = [{ roll: initial.p.roll, yaw: initial.p.yaw }, ...rows];
  const maxBank = Math.max(...rows.map(v => Math.abs(v.roll))), maxBankRate = Math.max(...all.slice(1).map((v, i) => Math.abs(angle(v.roll, all[i].roll)) * 60));
  const maxYawRate = Math.max(...all.slice(1).map((v, i) => Math.abs(angle(v.yaw, all[i].yaw)) * 60));
  assert(maxBank <= 32 * Math.PI / 180 + 1e-6 && maxBank > 0.45, `Ordinary cockpit bank limit: ${maxBank}`);
  assert(maxBankRate <= 0.60001, `Ordinary cockpit bank rate: ${maxBankRate}`); assert(maxYawRate <= 0.44001, `Ordinary cockpit yaw rate: ${maxYawRate}`);
  assert(rows.every(v => Math.abs(angle(v.cameraBank, v.renderBank)) < 1e-5 && v.alignment > 0.99999), 'Cockpit world camera does not follow rendered aircraft basis');
  r.ordinary = { maxBank, maxBankRate, maxYawRate, frames, rows };
  await cockpitStart();
  const inverted = await inversionSequence('inverted');
  const down = await step(1.3);
  near(Math.abs(down.p.inversionRoll), Math.PI, 'Half-roll did not persist at 180 degrees', 1e-6); assert(down.p.basis.up.y < -0.99 && down.camera.up.y < -0.99, 'Body/cockpit did not remain inverted');
  assert(inverted.rows.some(v => Math.abs(v.inversionRoll) > 0.2 && Math.abs(v.inversionRoll) < Math.PI - 0.2), 'Half-roll skipped its smooth intermediate poses');
  await tap('KeyQ'); const qRows = await sampleFrames(60), qDone = await state();
  assert(Math.max(...qRows.map(v => Math.abs(v.spin))) > 6, 'Q full barrel roll stopped working'); near(Math.abs(qDone.p.inversionRoll), Math.PI, 'Q changed inverted baseline', 1e-6); near(qDone.p.spin, 0, 'Q did not finish'); assert(qDone.camera.up.y < -0.98);
  const upright = await inversionSequence('upright'); await step(1.3); const up = await state();
  near(up.p.inversionRoll, 0, 'Same gesture did not flip back upright', 1e-6); assert(up.p.basis.up.y > 0.99 && up.camera.up.y > 0.99);
  r.inverted = inverted; r.invertedHeld = down; r.qWhileInverted = { rows: qRows, final: qDone }; r.upright = upright; r.uprightHeld = up;
  r.finalScreenshot = await shot('upright_held');
  await cockpitStart();
  await armAndDouble('KeyA'); await step(1.6); const leftInverted = await state();
  near(leftInverted.p.inversionRoll, Math.PI, 'Native A gesture did not invert left', 1e-6);
  await step(1.2); await armAndDouble('KeyA'); await step(1.6); const leftUpright = await state();
  near(leftUpright.p.inversionRoll, 0, 'Second native A gesture did not return upright', 1e-6);
  r.nativeAGesture = { inverted: leftInverted.p.inversionRoll, upright: leftUpright.p.inversionRoll };
}
async function gestureCase(r) {
  const cases = [];
  async function fresh() { await cockpitStart(); }
  async function noFlip(label) { const rows = await sampleFrames(105); near((await state()).p.inversionRoll, 0, `${label} falsely triggered a half-roll`); cases.push({ label, maxInversion: Math.max(...rows.map(v => Math.abs(v.inversionRoll))) }); }
  await fresh(); await key('KeyD'); await step(0.5); await key('KeyD', false); await tap('KeyD'); await step(0.1); await tap('KeyD'); await noFlip('short hold');
  await fresh(); await key('KeyD'); await step(2.1); await key('KeyD', false); await step(0.1); await key('KeyD'); await step(0.1); await key('KeyD', true, true); await key('KeyD', false); await noFlip('autoRepeat is not a double tap');
  await fresh(); await key('KeyD'); await step(2.1); await key('KeyD', false); await tap('KeyD'); await tap('KeyA'); await step(0.1); await tap('KeyD'); await noFlip('mixed directions');
  await fresh(); await key('KeyD'); await step(2.1); await key('KeyD', false); await step(1.3); await tap('KeyD'); await step(0.1); await tap('KeyD'); await noFlip('expired 1.2-second window');
  await fresh(); await key('KeyD'); await step(2.1); await key('KeyD', false); await pause(); await resume(); await tap('KeyD'); await step(0.1); await tap('KeyD'); await noFlip('pause cleared armed gesture');
  await fresh(); await key('KeyD'); await step(2.1); await key('KeyD', false); await evaluate("window.dispatchEvent(new Event('blur'))"); await tap('KeyD'); await step(0.1); await tap('KeyD'); await noFlip('blur event cleared armed gesture');
  r.cases = cases; r.blurPath = 'Dispatch window blur event; all A/D events are native CDP and all timing uses __PI.step/G.realTime';
}
async function enemyState() { return evaluate('({scale:__PI.G.enemySpeedScale,playerSpeed:__PI.G.player.speed,time:__PI.G.time,enemies:__PI.G.enemies.map(e=>({id:e.showIndex,speed:e.speed,state:e.state,leaving:e.leaving,energy:e.energy,pos:{...e.pos},age:e.age}))})'); }
function vectorAngle(a, b) { return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))))); }
async function crossviewCase(r) {
  r.coverage = 'Previous browser evidence covered the D-hand gesture phase only. This candidate also exercises native A with exactly four simulation seconds from the triggering second keydown, including the near-180-degree quaternion sign boundary.';
  r.phases = [];
  for (const [phaseName, code, elapsed, prefix] of [['d_original', 'KeyD', 3, 'crossview'], ['a_exact4s', 'KeyA', 4, 'crossview_a4s']]) {
    await navigate(); await start(); await configure({ defaults: true, mouse: false }); await restart();
    const gesture = await armAndDouble(code), triggeredAt = gesture.trigger.realTime;
    assert(gesture.trigger.p.halfRoll, `${phaseName} did not trigger a real half-roll`);
    // The triggering second tap is followed directly by this one step. Do not
    // separately advance the 1.6-second half-roll before the exact phase wait.
    const inverted = await step(elapsed);
    near(inverted.realTime - triggeredAt, elapsed, `${phaseName} trigger-to-switch phase`, 1e-9);
    near(Math.abs(inverted.p.inversionRoll), Math.PI, `${phaseName} did not persist inverted`, 1e-6); assert.equal(inverted.view, 1);
    const phase = { name: phaseName, code, triggerRealTime: triggeredAt, switchRealTime: inverted.realTime, elapsedSinceTrigger: inverted.realTime - triggeredAt, transitions: [] };
    r.phases.push(phase);
    // Keep the original D transition field for existing report consumers.
    if (phaseName === 'd_original') r.transitions = phase.transitions;
    for (const [name, expectedView] of [['chase_to_cockpit', 2], ['cockpit_to_top', 0], ['top_to_chase', 1]]) {
      const before = await state(), rows = [], frames = [];
      await tap('Space');
      for (const [n, t] of [[15, 0.25], [15, 0.5], [15, 0.75], [15, 1], [30, 1.5]]) {
        rows.push(...await sampleFrames(n));
        frames.push({ t, state: await state(), screenshot: await shot(`${prefix}_${name}_${String(Math.round(t * 1000)).padStart(4, '0')}`) });
      }
      const up = [before.camera.up, ...rows.map(v => v.cameraUp)], fwd = [before.camera.fwd, ...rows.map(v => v.cameraFwd)];
      const maxUpStep = Math.max(...up.slice(1).map((v, i) => vectorAngle(v, up[i]))), maxFwdStep = Math.max(...fwd.slice(1).map((v, i) => vectorAngle(v, fwd[i])));
      const maxNormError = Math.max(...[...up, ...fwd].map(v => Math.abs(Math.hypot(v.x, v.y, v.z) - 1)));
      const maxUpForwardDot = Math.max(...rows.map(v => Math.abs(v.cameraUp.x * v.cameraFwd.x + v.cameraUp.y * v.cameraFwd.y + v.cameraUp.z * v.cameraFwd.z)));
      const final = await state();
      phase.transitions.push({ name, maxUpStep, maxFwdStep, maxNormError, maxUpForwardDot, before: { view: before.view, up: before.camera.up }, final: { view: final.view, up: final.camera.up, inversionRoll: final.p.inversionRoll }, rows, frames });
      assert.equal(final.view, expectedView); near(Math.abs(final.p.inversionRoll), Math.PI, `${phaseName}/${name} changed inversion state`, 1e-6);
      assert(maxUpStep < 0.15, `${phaseName}/${name} jumped camera.up ${maxUpStep} rad in one 60Hz frame`);
      assert(maxFwdStep < 0.15, `${phaseName}/${name} jumped camera.fwd ${maxFwdStep} rad in one 60Hz frame`);
      assert(maxNormError < 1e-6 && maxUpForwardDot < 1e-6, `${phaseName}/${name} camera frame lost orthonormality`);
      if (expectedView === 2) assert(final.camera.up.y < -0.99, `${phaseName} cockpit did not finish inverted`);
      if (expectedView === 1) near(final.camera.right.y, 0, `${phaseName} chase horizon did not finish level`, 1e-6);
    }
  }
}
async function overlapCase(r) {
  await navigate(); await cockpitStart();
  const before = await state();
  await key('KeyA'); await key('KeyD'); await step(2.1); await key('KeyA', false); await key('KeyD', false); await step(0.1);
  await tap('KeyD'); await step(0.12); await tap('KeyD');
  const rows = await sampleFrames(105), final = await state();
  r.rows = rows; r.maxInversion = Math.max(...rows.map(v => Math.abs(v.inversionRoll))); r.elapsed = final.realTime - before.realTime;
  near(r.maxInversion, 0, 'Simultaneous A/D hold armed a false half-roll'); assert.equal(final.p.halfRoll, null);
}
async function enemyCase(r) {
  await start('intercept'); const spawn = await enemyState(); assert(spawn.enemies.length); near(spawn.scale, 0.65, 'Default enemy scale'); spawn.enemies.forEach(e => near(e.speed, 108 * 0.65, 'Default enemy spawn speed'));
  await step(0.6); const initial = await enemyState(); await configure({ enemy: 30 }); const selected30 = await enemyState();
  initial.enemies.forEach((e, i) => near(selected30.enemies[i].speed, e.speed, 'Paused enemy adjustment snapped actual speed'));
  await step(1 / 60); const first30 = await enemyState(); await step(3); const slow = await enemyState();
  assert(first30.enemies[0].speed < selected30.enemies[0].speed && first30.enemies[0].speed > 108 * 0.3, 'Enemy slowdown did not remain continuous'); assert(slow.enemies[0].speed < initial.enemies[0].speed * 0.8);
  await configure({ enemy: 120, mouse: true }); const selected120 = await enemyState(); await step(1 / 60); const first120 = await enemyState(); await step(3); const fast = await enemyState();
  assert(first120.enemies[0].speed > selected120.enemies[0].speed && first120.enemies[0].speed < 168 * 1.2, 'Enemy speedup did not remain continuous'); assert(fast.enemies[0].speed > slow.enemies[0].speed * 2);
  await restart(); const new120 = await enemyState(), retained = await state(); new120.enemies.forEach(e => near(e.speed, 108 * 1.2, 'New enemies lost selected speed')); assert.equal(retained.settings.mouse, true); assert.equal(retained.settings.enemy.value, 120);
  r.spawn65 = spawn; r.initial = initial; r.selected30 = selected30; r.first30 = first30; r.after30 = slow; r.selected120 = selected120; r.first120 = first120; r.after120 = fast; r.new120 = new120;
  r.existingEnemyDisplacement = { at30: distance(first30.enemies[0].pos, slow.enemies[0].pos), at120: distance(first120.enemies[0].pos, fast.enemies[0].pos) };
}
async function pauseCase(r) {
  r.viewports = [];
  for (const size of sizes) {
    await navigate(size); await start(); await pause();
    const before = await state(); assert.equal(before.settings.mouse, false); assert.equal(before.settings.enemy.value, 65);
    const reachable = {};
    for (const id of ['sky-resume', 'sky-cruise-speed', 'sky-burn-speed', 'sky-enemy-speed', 'sky-mouse-steering', 'sky-speed-reset', 'sky-restart', 'sky-home']) reachable[id] = await point(`#${id}`);
    assert.equal(before.settings.burn.disabled, false, 'Default 218-knot cruise disabled the editable afterburner slider');
    await range('sky-cruise-speed', 500); let s = await state(); assert.equal(s.settings.cruise.value, 500); assert.equal(s.settings.burn.min, 500); assert.equal(s.settings.burn.value, 500);
    assert.equal(s.settings.burn.disabled, true, '500-knot cruise left the no-op afterburner slider enabled');
    assert(s.settings.burn.output.includes('500') && s.settings.burn.output.includes('已达上限'), '500-knot cap output omitted its disabled reason');
    const atCapBurn = s.settings.burn;
    await evaluate("document.activeElement?.blur(); document.getElementById('sky-pause').scrollTop=0");
    const screenshot = await shot(`pause_${size.name}`);
    let capScreenshot;
    if (size.name === 'landscape') { await evaluate("document.getElementById('sky-burn-speed').scrollIntoView({block:'center',behavior:'instant'})"); capScreenshot = await shot('pause_landscape_cap'); }
    await evaluate("const m=document.getElementById('sky-pause');m.scrollTop=m.scrollHeight");
    const bottomScreenshot = await shot(`pause_${size.name}_bottom`);
    const scroll = await evaluate("(() => {const m=document.getElementById('sky-pause');return {top:m.scrollTop,height:m.clientHeight,contentHeight:m.scrollHeight};})()");
    await resume(); s = await step(0.2);
    const flare = await point('[data-sky-action="flare"]');
    if (size.mobile) { await touch('touchStart', flare.x, flare.y); await touch('touchEnd'); } else await click('[data-sky-action="flare"]');
    const afterFlare = await state(); assert.equal(afterFlare.p.flares, s.p.flares - 1); assert.equal(afterFlare.shots, s.shots); assert.equal(afterFlare.p.missiles, s.p.missiles); assert.equal(afterFlare.view, s.view);
    r.viewports.push({ ...size, reachable, scroll, screenshot, capScreenshot, bottomScreenshot, settings: before.settings, atCap: { cruise: 500, burn: atCapBurn }, flare: { before: s.p.flares, after: afterFlare.p.flares, cooldown: afterFlare.p.flareCd } });
    assert.deepEqual(runtimeErrors(), []);
  }
}
async function legacyCase(r) {
  await navigate(sizes[0], true);
  await evaluate("__PI.start('chase'); __PI.freeze(true)"); let s = await state();
  near(s.p.speed, 112, 'Old route cruise'); assert.equal(s.p.cruiseSpeed, null); assert.equal(s.p.burnSpeed, null); assert.equal(s.enemySpeedScale, null);
  await key('ShiftLeft'); s = await step(3); await key('ShiftLeft', false); near(s.p.speed, 204, 'Old route boost');
  await evaluate("__PI.start('chase'); __PI.freeze(true)"); const drive = await pointerDrive(0.78);
  assert(Math.abs(angle(drive.after.p.yaw, drive.before.p.yaw)) > 0.03, 'Old route lost default mouse steering');
  r.cruise = 112; r.boost = s.p.speed; r.mouseYawChange = angle(drive.after.p.yaw, drive.before.p.yaw);
}
async function runCase(name, fn) {
  const r = { name, result: 'RUNNING', command: report.command, startedAt: new Date().toISOString() }; report.cases.push(r);
  try { await fn(r); const s = await state(); assert.deepEqual(s.errors, []); assert.deepEqual(s.exceptions, []); assert.deepEqual(runtimeErrors(), []); r.result = 'PASS'; r.runtimeErrors = []; console.log(`PASS ${name}`); }
  catch (error) { r.result = 'FAIL'; r.error = error.stack; r.lastState = await state().catch(() => null); r.runtimeErrors = runtimeErrors(); try { r.failureScreenshot = await shot(`${name}_failed`); } catch {} console.error(`FAIL ${name}: ${error.message}`); }
  r.finishedAt = new Date().toISOString();
}
async function main() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-comfort-chrome-')); let stderr = '';
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  try {
    let port;
    for (let i = 0; i < 150; i++) { try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (port) break; } catch {} await sleep(100); }
    assert(port, `Chrome did not start: ${stderr}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); report.browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method) events.push(m); };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method);
    if (!only || only === 'flight') { await runCase('actual_speed', speedCase); await runCase('mouse_keyboard_touch', mouseCase); await runCase('cockpit_and_inversion', cockpitCase); await runCase('gesture_rejections', gestureCase); await runCase('enemy_speed', enemyCase); }
    if (!only || only === 'pause') await runCase('pause_layout_and_flare', pauseCase);
    if (!only || only === 'legacy') await runCase('legacy_contract', legacyCase);
    if (!only || only === 'crossview') { await runCase('inverted_crossview', crossviewCase); await runCase('overlap_ad_rejection', overlapCase); }
    report.result = report.cases.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL';
  } finally {
    ws?.close(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Closed own Chrome')); } pending.clear();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGTERM'); for (let i = 0; i < 30 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100); if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await new Promise(resolve => chrome.once('exit', resolve)); } }
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    report.cleanup = { ownChromeStopped: !chrome || chrome.exitCode !== null || chrome.signalCode !== null, ownProfileDeleted: !profile || !fs.existsSync(profile) }; report.finishedAt = new Date().toISOString();
    const file = path.join(ROOT, 'shots', 'sky_comfort_results.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); console.log(`RESULT ${report.result}: ${file}`);
  }
  if (report.result !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

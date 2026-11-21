#!/usr/bin/env node
// Real Chrome input/layout acceptance. Intentionally outside test_*.mjs: this
// launches its own Chrome and uses an already running static server.
// Usage: node tools/verify_sky_speed.mjs [--only=desktop|portrait|landscape|legacy] [--prefix=sky_comfort_speed]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8765';
const KT = 1.94384;
const option = name => process.argv.find(v => v.startsWith(`--${name}=`))?.split('=')[1];
const PREFIX = option('prefix') || 'sky_speed';
assert(/^sky_[a-z0-9_]+$/.test(PREFIX), 'Invalid artifact prefix');
const priorFile = path.join(ROOT, 'shots', `${PREFIX}_results.json`);
const prior = option('only') === 'legacy' && fs.existsSync(priorFile) ? JSON.parse(fs.readFileSync(priorFile, 'utf8')) : null;
const sizes = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'portrait', width: 390, height: 844, mobile: true },
  { name: 'landscape', width: 844, height: 390, mobile: true },
].filter(v => !option('only') || v.name === option('only'));
assert(sizes.length || option('only') === 'legacy', 'Unknown --only viewport');
const report = {
  startedAt: new Date().toISOString(), command: `node tools/verify_sky_speed.mjs${option('only') ? ` --only=${option('only')}` : ''}${option('prefix') ? ` --prefix=${PREFIX}` : ''}`,
  baseUrl: BASE, result: 'RUNNING', viewports: prior?.viewports || [], screenshots: prior?.screenshots || [], runtimeErrors: [],
  ...(prior ? { priorViewportEvidence: { command: prior.command, startedAt: prior.startedAt, finishedAt: prior.finishedAt } } : {}),
  executionPaths: {
    keyboard: 'CDP Input.dispatchKeyEvent; native ArrowRight, Tab and Shift+Tab defaults are preserved',
    touch: 'CDP Input.dispatchTouchEvent; native range drag and held boost button',
    numericFixture: 'Range value assignment followed by a bubbling input event; native editing is separately exercised',
    simulation: '__PI.freeze/step; actual pause is also checked with freeze(false) across browser frames',
    legacy: 'Existing tools/test_wasd.js plus default cruise/boost fallback checks',
  },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws, profile;
let serial = 0;
const pending = new Map();
let pageEvents = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 65000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression, description, timeout = 60000) {
  const end = Date.now() + timeout;
  do {
    if (await evaluate(expression)) return;
    await sleep(100);
  } while (Date.now() < end);
  throw new Error(`Timed out: ${description}`);
}
function snapshotPage() {
  const G = window.__PI?.G, p = G?.player;
  const range = id => {
    const el = document.getElementById(id);
    return el ? { type: el.type, min: +el.min, max: +el.max, step: +el.step, value: +el.value, disabled: el.disabled, labels: [...el.labels].map(l => l.textContent.trim()), output: document.getElementById(`${id}-value`)?.textContent.trim() } : null;
  };
  const modal = document.getElementById('sky-pause'), a = document.activeElement;
  return {
    mode: G?.mode, time: G?.time, view: G?.view, sound: G?.sound, flightMode: window.__SKY?.flightMode,
    player: p && { speed: p.speed, targetSpeed: p.targetSpeed, cruiseSpeed: p.cruiseSpeed ?? null, burnSpeed: p.burnSpeed ?? null, fuel: p.fuel, pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, roll: p.roll, burning: p.burning, steering: p.steering, missiles: p.missiles },
    shots: G?.stats.shots, cruise: range('sky-cruise-speed'), burn: range('sky-burn-speed'), enemy: range('sky-enemy-speed'),
    enemySpeedScale: G?.enemySpeedScale, mouseSteering: document.getElementById('sky-mouse-steering')?.checked,
    active: { id: a?.id || '', tag: a?.tagName, insidePause: !!modal?.contains(a), hidden: !!a?.closest('[hidden]') },
    pause: modal && { hidden: modal.hidden, scrollTop: modal.scrollTop, scrollHeight: modal.scrollHeight, clientHeight: modal.clientHeight },
    errors: window.__PI?.errors || [], exceptions: window.__PI?.exceptions || [],
  };
}
const snap = () => evaluate(`(${snapshotPage})()`);
const viewLog = () => pageEvents.filter(e =>
  e.method === 'Runtime.exceptionThrown' ||
  e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' ||
  e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network');
async function key(code, type = 'keyDown', modifiers = 0, autoRepeat = false) {
  const map = {
    Tab: ['Tab', 9], Escape: ['Escape', 27], ArrowRight: ['ArrowRight', 39],
    ShiftLeft: ['Shift', 16], Space: [' ', 32], KeyF: ['f', 70], KeyM: ['m', 77],
  };
  const [key, windowsVirtualKeyCode] = map[code] || [code, 0];
  await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode, modifiers, autoRepeat });
}
async function press(code, modifiers = 0) { await key(code, 'keyDown', modifiers); await key(code, 'keyUp', modifiers); }
async function targetPoint(selector, fraction = 0.5) {
  return evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e || e.disabled) throw new Error('Missing or disabled target: ' + ${JSON.stringify(selector)});
    e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = e.getBoundingClientRect(), m = document.getElementById('sky-pause');
    const x = r.left + r.width * ${fraction}, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, width: r.width, height: r.height, hit: hit === e || e.contains(hit), hitId: hit?.id || hit?.tagName, modalScrollTop: m?.scrollTop || 0, visible: r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight };
  })()`);
}
async function click(selector) {
  const p = await targetPoint(selector);
  assert(p.visible && p.hit, `Target is not reachable: ${selector}: ${JSON.stringify(p)}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
async function setRange(id, value) {
  await evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${value}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const s = await snap(), r = id.includes('cruise') ? s.cruise : s.burn;
  assert.equal(r.value, value, `${id} numeric fixture was rejected`);
}
async function step(seconds) { return evaluate(`__PI.step(${seconds}); (${snapshotPage})()`); }
function frozenState(s) { return { speed: s.player.speed, fuel: s.player.fuel, pos: s.player.pos, time: s.time }; }
function closeTo(actual, expected, message, tolerance = 1e-9) { assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`); }
function angleChange(to, from) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); }
function neutral(s, before) {
  assert(!s.player.burning, 'Paused Shift input leaked into resumed afterburner');
  assert.equal(s.shots, before.shots, 'Paused F or slider pointer input leaked into firing');
  assert.equal(s.view, before.view, 'Paused Space input changed the flight view');
  for (const k of ['sx', 'sy', 'turn', 'alt']) closeTo(s.player.steering[k], 0, `Paused slider input leaked into steering.${k}`);
  assert(!s.active.insidePause && !s.active.hidden, 'Resume retained focus inside the hidden pause modal');
}
async function screenshot(name) {
  const file = path.join(ROOT, 'shots', `${PREFIX}_${name}.png`);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  const relative = path.relative(ROOT, file);
  report.screenshots.push(relative);
  return relative;
}
async function navigate(size, legacy = false) {
  pageEvents = [];
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: `${BASE}/${legacy ? '' : 'sky-patrol/'}?adapt=0` });
  const loadDeadline = Date.now() + 30000;
  while (!pageEvents.some(e => e.method === 'Page.loadEventFired') && Date.now() < loadDeadline) await sleep(50);
  assert(pageEvents.some(e => e.method === 'Page.loadEventFired'), 'Navigation did not finish loading');
  await until('!!window.__PI?.ready()', 'real engine/terrain readiness');
  assert.equal(await evaluate('window.__PI.boot.error || null'), null, 'Engine boot error');
}
async function touchPoint(type, x, y) {
  await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
}
async function touchRange(id) {
  const p = await targetPoint(`#${id}`);
  assert(p.visible && p.hit, `Touch range is not reachable: ${id}`);
  const r = await evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}), r = e.getBoundingClientRect(); return { left: r.left, width: r.width, y: r.top + r.height / 2, ratio: (e.value - e.min) / (e.max - e.min), before: +e.value }; })()`);
  const x0 = r.left + 8 + (r.width - 16) * r.ratio;
  const x1 = Math.min(r.left + r.width - 10, x0 + r.width * 0.17);
  await touchPoint('touchStart', x0, r.y);
  for (let i = 1; i <= 8; i++) { await touchPoint('touchMove', x0 + (x1 - x0) * i / 8, r.y); await sleep(20); }
  await touchPoint('touchEnd');
  const s = await snap(), after = id.includes('cruise') ? s.cruise.value : s.burn.value;
  assert(after > r.before, `Native touch drag did not increase ${id}: ${r.before} -> ${after}`);
  return { before: r.before, after, start: { x: x0, y: r.y }, end: { x: x1, y: r.y } };
}
async function checkFocusCycle() {
  const order = ['sky-resume', 'sky-cruise-speed', 'sky-burn-speed', 'sky-enemy-speed', 'sky-mouse-steering', 'sky-speed-reset', 'sky-restart', 'sky-home'];
  await evaluate("document.getElementById('sky-resume').focus()");
  const forward = [], backward = [];
  for (let i = 1; i <= order.length; i++) { await press('Tab'); const id = (await snap()).active.id; forward.push(id); assert.equal(id, order[i % order.length], 'Native Tab focus order'); }
  for (let i = order.length - 1; i >= 0; i--) { await press('Tab', 8); const id = (await snap()).active.id; backward.push(id); assert.equal(id, order[i], 'Native Shift+Tab focus order'); }
  return { forward, backward };
}
async function checkPausedAudio() {
  const before = await snap();
  assert.equal(before.mode, 'paused');
  assert.equal(before.active.id, 'sky-cruise-speed');
  // INPUT lives inside the game's closure. A test listener at the same bubble
  // phase as the core key listener checks that modal capture stops delivery.
  await evaluate(`(() => {
    window.__skySpeedAudioProbe = { keydowns: 0, handler: e => { if (e.code === 'KeyM') window.__skySpeedAudioProbe.keydowns++; } };
    window.addEventListener('keydown', window.__skySpeedAudioProbe.handler);
  })()`);
  const states = [];
  const check = async (phase, expectedSound) => {
    const s = await snap();
    assert.equal(s.sound, expectedSound, `Paused native M ${phase} audio state`);
    assert.equal(s.mode, 'paused', `Paused native M ${phase} changed mode`);
    assert.equal(s.active.id, before.active.id, `Paused native M ${phase} lost range focus`);
    assert.deepEqual(frozenState(s), frozenState(before), `Paused native M ${phase} changed simulation`);
    const bubbleKeydowns = await evaluate('window.__skySpeedAudioProbe.keydowns');
    assert.equal(bubbleKeydowns, 0, `Paused native M ${phase} reached the core keydown listener phase`);
    assert.equal(s.shots, before.shots); assert.equal(s.view, before.view);
    states.push({ phase, sound: s.sound, mode: s.mode, bubbleKeydowns });
  };
  try {
    await key('KeyM'); await check('first keydown', !before.sound);
    await key('KeyM', 'keyDown', 0, true); await check('autoRepeat keydown', !before.sound);
    await key('KeyM', 'keyUp'); await check('keyup', !before.sound);
    await press('KeyM'); await check('second press restores audio', before.sound);
  } finally {
    await evaluate("window.removeEventListener('keydown', window.__skySpeedAudioProbe.handler); delete window.__skySpeedAudioProbe");
  }
  return { before: before.sound, states, restored: before.sound };
}
async function shortScreenReachability() {
  await evaluate("document.getElementById('sky-pause').scrollTop = 0");
  const m = await evaluate("(() => { const e = document.getElementById('sky-pause'), r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight }; })()");
  assert(m.scrollHeight > m.clientHeight, 'Short landscape acceptance did not exercise an overflowing popup');
  const x = m.right - 18, y0 = m.bottom - 24, y1 = m.top + 25;
  await touchPoint('touchStart', x, y0);
  for (let i = 1; i <= 12; i++) { await touchPoint('touchMove', x, y0 + (y1 - y0) * i / 12); await sleep(24); }
  await touchPoint('touchEnd');
  await sleep(180);
  const touchScrollTop = (await snap()).pause.scrollTop;
  assert(touchScrollTop > 0, 'Native vertical touch gesture did not scroll the short popup');
  const reachable = {};
  for (const id of ['sky-resume', 'sky-cruise-speed', 'sky-burn-speed', 'sky-enemy-speed', 'sky-mouse-steering', 'sky-speed-reset', 'sky-restart', 'sky-home']) {
    reachable[id] = await targetPoint(`#${id}`);
    assert(reachable[id].visible && reachable[id].hit, `${id} is not hittable after popup scrolling`);
  }
  return { touchScrollTop, reachable, ...m };
}
async function checkConvergence(result) {
  let s = await snap();
  const before = s, target = s.player.cruiseSpeed;
  s = await step(1 / 60);
  assert(s.player.speed > before.player.speed && s.player.speed < target, 'Resume snapped or failed to accelerate toward chosen cruise');
  neutral(s, before);
  result.resumeFirstFrame = { before: before.player.speed, after: s.player.speed, target };
  s = await step(17);
  closeTo(s.player.speed, target, 'Cruise convergence', 0.01);
  const fuelBefore = s.player.fuel;
  await key('ShiftLeft', 'keyDown', 8);
  s = await step(1 / 60);
  assert(s.player.burning && s.player.speed > target && s.player.speed < s.player.burnSpeed, 'Native Shift did not start continuous acceleration');
  s = await step(3);
  closeTo(s.player.speed, 480 / KT, 'Chosen afterburner cap', 1e-7);
  assert(s.player.fuel < fuelBefore, 'Afterburner no longer consumes fuel');
  const burnSpeed = s.player.speed;
  await key('ShiftLeft', 'keyUp');
  s = await step(1 / 60);
  assert(!s.player.burning && s.player.speed < burnSpeed && s.player.speed > target, 'Releasing Shift snapped or failed to decelerate');
  result.convergence = { cruise: target, burn: burnSpeed, releaseFirstFrame: s.player.speed };
  await press('Escape');
  const paused = await snap();
  await setRange('sky-burn-speed', 350);
  assert.deepEqual(frozenState(await snap()), frozenState(paused), 'Lowering cap changed paused flight');
  await press('Escape');
  await key('ShiftLeft', 'keyDown', 8);
  s = await step(1 / 60);
  assert(s.player.speed < paused.player.speed && s.player.speed > 350 / KT, 'Lowering afterburner cap clipped actual speed');
  result.lowerCap = { before: paused.player.speed, afterFirstFrame: s.player.speed, target: s.player.targetSpeed };
  await evaluate('__PI.G.player.fuel = 0.6');
  s = await step(2 / 60);
  assert(!s.player.burning && s.player.targetSpeed === s.player.cruiseSpeed, 'Fuel exhaustion did not return to chosen cruise');
  await key('ShiftLeft', 'keyUp');
  result.fuelCutoff = { fuel: s.player.fuel, target: s.player.targetSpeed, burning: s.player.burning };
}
async function checkTouchBoost(result) {
  await step(1);
  const p = await targetPoint('[data-sky-action="boost"]');
  assert(p.visible && p.hit, 'Touch boost button is not reachable');
  await touchPoint('touchStart', p.x, p.y);
  const held = await step(0.2);
  assert(held.player.burning, 'Native touch hold did not activate boost');
  await touchPoint('touchEnd');
  const released = await step(0.2);
  assert(!released.player.burning, 'Native touch release left boost held');
  result.touchBoost = { held: held.player.burning, released: released.player.burning, cap: held.player.burnSpeed };
}
async function checkRetention(result) {
  await press('Escape');
  await setRange('sky-cruise-speed', 280); await setRange('sky-burn-speed', 480);
  await click('#sky-restart'); await evaluate('__PI.freeze(true)');
  let s = await snap();
  closeTo(s.player.speed, 280 / KT, 'Restart takeoff speed');
  closeTo(s.player.burnSpeed, 480 / KT, 'Restart burn selection');
  assert.equal(s.flightMode, 'free'); assert.equal(s.mode, 'play');
  result.restart = { speed: s.player.speed, cruiseSpeed: s.player.cruiseSpeed, burnSpeed: s.player.burnSpeed, mode: s.flightMode };
  await press('Escape'); await click('#sky-home'); await evaluate('__PI.freeze(true)');
  s = await snap();
  assert.equal(s.mode, 'title');
  assert.equal(s.player.cruiseSpeed, null); assert.equal(s.player.burnSpeed, null);
  closeTo(s.player.speed, 112, 'Title demonstration changed speed');
  await click('#sky-intercept'); await evaluate('__PI.freeze(true)');
  s = await snap();
  assert.equal(s.flightMode, 'intercept'); assert.equal(s.mode, 'play');
  closeTo(s.player.speed, 280 / KT, 'Switching mode lost chosen cruise');
  closeTo(s.player.burnSpeed, 480 / KT, 'Switching mode lost chosen boost');
  result.modeSwitch = { speed: s.player.speed, cruiseSpeed: s.player.cruiseSpeed, burnSpeed: s.player.burnSpeed, mode: s.flightMode };
}
async function checkViewport(size) {
  const result = { ...size, result: 'RUNNING' };
  report.viewports.push(result);
  try {
    await navigate(size);
    await click('#sky-cruise'); await evaluate('__PI.freeze(true)');
    let s = await snap();
    assert.equal(s.mode, 'play');
    closeTo(s.player.speed, 112, 'Default takeoff speed');
    closeTo(s.player.cruiseSpeed, 112, 'Exact default cruise');
    closeTo(s.player.burnSpeed, 500 / KT, 'Exact default burn');
    result.defaults = { cruiseSpeed: s.player.cruiseSpeed, burnSpeed: s.player.burnSpeed };
    await press('Escape');
    s = await snap();
    assert.equal(s.mode, 'paused'); assert(!s.pause.hidden);
    assert.deepEqual([s.cruise.type, s.cruise.min, s.cruise.max, s.cruise.step], ['range', 100, 500, 1]);
    assert.deepEqual([s.burn.type, s.burn.min, s.burn.max, s.burn.step], ['range', Math.min(500, s.cruise.value + 50), 500, 1]);
    assert.deepEqual([s.enemy.type, s.enemy.min, s.enemy.max, s.enemy.step, s.enemy.value], ['range', 30, 120, 5, 65]);
    assert.equal(s.enemySpeedScale, 0.65); assert.equal(s.mouseSteering, false);
    assert(s.cruise.labels.length && s.burn.labels.length, 'Range labels are not associated');
    assert(s.cruise.output.includes(String(Math.round(112 * KT))) && s.burn.output.includes('500'), 'Default knot outputs are incorrect');
    result.focusCycle = await checkFocusCycle();
    await evaluate('__PI.freeze(false)');
    const paused = await snap();
    await sleep(250); await step(0.5);
    assert.deepEqual(frozenState(await snap()), frozenState(paused), 'Paused simulation advanced while RAF and explicit stepping ran');
    await evaluate('__PI.freeze(true)');
    await evaluate("document.getElementById('sky-cruise-speed').focus()");
    result.pausedAudioShortcut = await checkPausedAudio();
    const initial = (await snap()).cruise.value;
    await press('ArrowRight');
    s = await snap();
    assert.equal(s.cruise.value, initial + 1, 'Native ArrowRight did not increment the slider');
    closeTo(s.player.cruiseSpeed, s.cruise.value / KT, 'Native slider did not update flight target');
    result.nativeArrow = { before: initial, after: s.cruise.value, output: s.cruise.output };
    await setRange('sky-cruise-speed', 200); await setRange('sky-burn-speed', 250); await setRange('sky-cruise-speed', 300);
    s = await snap();
    assert.equal(s.burn.value, 350); assert.equal(s.burn.min, 350);
    result.linkedBounds = { cruise: s.cruise.value, burn: s.burn.value, burnMin: s.burn.min };
    await click('#sky-speed-reset');
    s = await snap();
    closeTo(s.player.cruiseSpeed, 112, 'Reset did not restore exact cruise'); closeTo(s.player.burnSpeed, 500 / KT, 'Reset did not restore exact burn');
    result.reset = { cruiseSpeed: s.player.cruiseSpeed, burnSpeed: s.player.burnSpeed, cruiseDisplay: s.cruise.value, burnDisplay: s.burn.value };
    await setRange('sky-cruise-speed', 230);
    result.touchSlider = await touchRange('sky-cruise-speed');
    assert.deepEqual(frozenState(await snap()), frozenState(paused), 'Editing ranges changed paused current speed/fuel/position/time');
    result.pausedFrozen = frozenState(await snap());
    await setRange('sky-cruise-speed', 280); await setRange('sky-burn-speed', 480);
    await click('#sky-resume');
    const buttonResume = await step(1 / 60);
    assert.equal(buttonResume.mode, 'play');
    closeTo(buttonResume.player.cruiseSpeed, 280 / KT, 'Continue button lost cruise selection');
    closeTo(buttonResume.player.burnSpeed, 480 / KT, 'Continue button lost boost selection');
    neutral(buttonResume, paused);
    result.resumeButton = { cruiseSpeed: buttonResume.player.cruiseSpeed, burnSpeed: buttonResume.player.burnSpeed, active: buttonResume.active };
    await press('Escape');
    if (size.name === 'landscape') result.shortPopup = await shortScreenReachability();
    await evaluate("document.activeElement?.blur(); document.getElementById('sky-pause').scrollTop = 0");
    await sleep(80);
    result.screenshot = await screenshot(size.name);
    result.screenshotValues = { cruise: (await snap()).cruise.value, burn: (await snap()).burn.value };
    if (size.name === 'landscape') {
      await evaluate("const m = document.getElementById('sky-pause'); m.scrollTop = m.scrollHeight");
      result.bottomScreenshot = await screenshot('landscape_bottom');
    }
    await evaluate("document.getElementById('sky-cruise-speed').focus()");
    const beforeKeys = await snap();
    for (const code of ['ArrowRight', 'ShiftLeft', 'KeyF', 'Space']) await key(code);
    s = await snap();
    assert.equal(s.cruise.value, beforeKeys.cruise.value + 1, 'Held native arrow did not edit range');
    assert.equal(s.shots, beforeKeys.shots); assert.equal(s.view, beforeKeys.view);
    await press('Escape');
    s = await snap();
    assert.equal(s.mode, 'play'); assert(!s.active.insidePause && !s.active.hidden, 'Esc left hidden slider focus');
    const beforeKeyup = await step(1 / 60);
    neutral(beforeKeyup, beforeKeys);
    result.isolationBeforeKeyup = { view: beforeKeyup.view, shots: beforeKeyup.shots, burning: beforeKeyup.player.burning, steering: beforeKeyup.player.steering };
    for (const code of ['ArrowRight', 'ShiftLeft', 'KeyF', 'Space']) await key(code, 'keyUp');
    if (size.name === 'desktop') await checkConvergence(result);
    else neutral(await step(1 / 60), beforeKeys);
    result.resumeIsolation = true;
    await checkTouchBoost(result);
    await checkRetention(result);
    s = await snap();
    assert.deepEqual(s.errors, []); assert.deepEqual(s.exceptions, []); assert.deepEqual(viewLog(), []);
    result.runtimeErrors = []; result.result = 'PASS';
    console.log(`PASS ${size.name} ${size.width}x${size.height}: native keyboard/touch, pause, reset, retention${size.name === 'desktop' ? ', speed convergence' : ''}`);
  } catch (error) {
    result.result = 'FAIL'; result.error = error.stack;
    result.lastState = await snap().catch(() => null); result.runtimeErrors = viewLog();
    try { result.failureScreenshot = await screenshot(`${size.name}_failed`); } catch {}
    console.error(`FAIL ${size.name}: ${error.message}`);
  }
}
async function checkLegacy() {
  const result = report.legacy = { result: 'RUNNING' };
  try {
    await navigate({ width: 1440, height: 900, mobile: false }, true);
    assert.equal(await evaluate("document.querySelector('[id^=sky-cruise-speed]') !== null"), false, 'Legacy entry received settings UI');
    const code = fs.readFileSync(path.join(ROOT, 'tools/test_wasd.js'), 'utf8');
    result.wasd = await evaluate(`(async () => { ${code}\n })()`);
    const { chase: c, top: t } = result.wasd;
    assert(angleChange(c.yD, c.y0) > 0 && angleChange(c.yA, c.yD) < 0 && c.pW > c.p0 && c.pS < c.pW, 'Legacy chase WASD changed');
    assert(angleChange(t.yTopD, t.yTop0) > 0 && t.altW > t.alt0 && t.altS < t.altW, 'Legacy top WASD changed');
    await evaluate("__PI.start('chase'); __PI.freeze(true)");
    let s = await snap();
    closeTo(s.player.speed, 112, 'Legacy cruise changed');
    assert.equal(s.player.cruiseSpeed, null); assert.equal(s.player.burnSpeed, null);
    await key('ShiftLeft', 'keyDown', 8); s = await step(2); await key('ShiftLeft', 'keyUp');
    closeTo(s.player.speed, 204, 'Legacy boost cap changed');
    result.defaults = { cruise: 112, burn: s.player.speed };
    assert.deepEqual(s.errors, []); assert.deepEqual(s.exceptions, []); assert.deepEqual(viewLog(), []);
    result.result = 'PASS'; console.log('PASS legacy: existing WASD case and exact 112/204 m/s defaults');
  } catch (error) { result.result = 'FAIL'; result.error = error.stack; result.runtimeErrors = viewLog(); console.error(`FAIL legacy: ${error.message}`); }
}
async function main() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-speed-chrome-'));
  let stderr = '';
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  chrome.on('error', e => { stderr += e.message; });
  try {
    let port;
    for (let i = 0; i < 150; i++) {
      try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (port) break; } catch {}
      if (chrome.exitCode !== null) break;
      await sleep(100);
    }
    assert(port, `Chrome failed to start: ${stderr}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    report.browser = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = e => {
      const m = JSON.parse(e.data), p = pending.get(m.id);
      if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method) pageEvents.push(m);
    };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method);
    for (const size of sizes) await checkViewport(size);
    if (!option('only') || option('only') === 'desktop' || option('only') === 'legacy') await checkLegacy();
    report.result = report.viewports.every(v => v.result === 'PASS') && (!report.legacy || report.legacy.result === 'PASS') ? 'PASS' : 'FAIL';
  } finally {
    if (ws) ws.close();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Chrome acceptance finished')); }
    pending.clear();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill('SIGTERM');
      for (let i = 0; i < 30 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await new Promise(resolve => chrome.once('exit', resolve)); }
    }
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    report.cleanup = { ownChromeStopped: !chrome || chrome.exitCode !== null || chrome.signalCode !== null, ownProfileDeleted: !profile || !fs.existsSync(profile) };
    report.finishedAt = new Date().toISOString();
    const out = path.join(ROOT, 'shots', `${PREFIX}_results.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(`RESULT ${report.result}: ${out}`);
  }
  if (report.result !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

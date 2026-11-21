#!/usr/bin/env node
// Real Chrome acceptance for the existing flare action; uses the running 8765
// server and a disposable headless profile, following tools/cdp.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8765/sky-patrol/?adapt=0';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FLARE = '[data-sky-action="flare"]';
const only = process.argv.find(v => v.startsWith('--only='))?.slice(7);
const sizes = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'portrait', width: 390, height: 844, mobile: true },
  { name: 'landscape', width: 844, height: 390, mobile: true },
].filter(s => !only || s.name === only);
assert(sizes.length, 'Unknown --only viewport');
const report = { startedAt: new Date().toISOString(), url: BASE, result: 'RUNNING', viewports: [], screenshots: [], errors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, profile, ws, serial = 0, pageEvents = [];
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 55000 });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
function pageSnapshot() {
  const g = __PI.G, p = g.player, b = document.querySelector('[data-sky-action="flare"]');
  const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  return {
    mode: g.mode, time: g.time, realTime: g.realTime, view: g.view, shots: g.stats.shots,
    flares: p.flares, flareCd: p.flareCd, missiles: p.missiles, dead: p.dead,
    flareEffects: g.effects.filter(e => e.type === 'flare').length,
    button: b && { text: b.textContent.trim(), key: b.querySelector('kbd')?.textContent, disabled: b.disabled, title: b.title, ariaLabel: b.getAttribute('aria-label'), rect: rect(b) },
    systemFlare: document.getElementById('sky-system-flare-value')?.textContent,
    stage: rect(document.getElementById('stage')), footer: rect(document.getElementById('sky-controls')),
    status: { rect: rect(document.getElementById('sky-status')), text: document.getElementById('sky-status').textContent,
      css: Object.fromEntries(['bottom', 'fontSize', 'lineHeight', 'whiteSpace', 'maxWidth'].map(k => [k, getComputedStyle(document.getElementById('sky-status'))[k]])) },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight },
    active: document.activeElement?.dataset?.skyAction || document.activeElement?.id,
    errors: [...__PI.errors], exceptions: [...__PI.exceptions],
  };
}
const snap = () => evaluate(`(${pageSnapshot})()`);
const step = seconds => evaluate(`__PI.step(${seconds}); __SKY.sync(); (${pageSnapshot})()`);
const paint = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
function isolated(after, before, label) {
  assert.equal(after.shots, before.shots, `${label}: leaked into cannon fire`);
  assert.equal(after.missiles, before.missiles, `${label}: leaked into missile fire`);
  assert.equal(after.view, before.view, `${label}: leaked into view switching`);
}
function feedback(s, cooldown) {
  const text = `${s.button.title} ${s.button.ariaLabel}`;
  assert(text.includes('干扰弹') && text.includes(String(s.flares)), `Flare feedback omitted actual remaining count: ${text}`);
  if (cooldown) assert(text.includes(String(Math.ceil(s.flareCd))), `Flare feedback omitted actual cooldown: ${text}`);
}
async function footerLayout(label) {
  const s = await snap();
  assert(s.document.width <= s.document.viewportWidth && s.document.height <= s.document.viewportHeight, `${label}: page overflowed the viewport`);
  const controls = await evaluate(`(() => { const es = [...document.querySelectorAll('#sky-controls button, .sky-direction, .sky-ammo-cluster')]; return es.map(e => { const r=e.getBoundingClientRect(); return {label:e.textContent.trim(), x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; }).filter(r => r.width && r.height); })()`);
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5;
  for (const r of controls) assert(r.x >= 0 && r.y >= 0 && r.right <= s.document.viewportWidth && r.bottom <= s.document.viewportHeight, `${label}: footer item clipped: ${r.label}`);
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) assert(!overlaps(controls[i], controls[j]), `${label}: footer items overlap: ${controls[i].label}/${controls[j].label}`);
  for (const r of controls) assert(!overlaps(r, s.status.rect), `${label}: status overlaps footer item: ${r.label}`);
  return { button: await point(FLARE), stage: s.stage, footer: s.footer, controls, status: s.status };
}
async function point(selector) {
  const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing target'); if (e.closest('.sky-dialog')) e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); const r = e.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2, hit = document.elementFromPoint(x,y); return {x,y,width:r.width,height:r.height,hit:hit===e||e.contains(hit),visible:r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}; })()`);
  assert(p.visible && p.hit, `Target not hittable: ${selector}: ${JSON.stringify(p)}`);
  return p;
}
async function click(selector, touch = false) {
  const { x, y } = await point(selector);
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}
async function press(code) {
  const [key, windowsVirtualKeyCode] = { Enter: ['Enter', 13], Space: [' ', 32], Escape: ['Escape', 27], KeyC: ['c', 67], KeyX: ['x', 88] }[code];
  // Text on keyDown makes CDP generate the native keypress/default action on
  // macOS, matching the character-producing Enter/Space/C/X physical keys.
  const text = code === 'Enter' ? '\r' : code === 'Space' ? ' ' : code === 'KeyC' ? 'c' : code === 'KeyX' ? 'x' : undefined;
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, ...(type === 'keyDown' && text ? { text, unmodifiedText: text } : {}) });
}
async function screenshot(name) {
  await paint();
  const file = path.join(ROOT, 'shots', `sky_flare_${name}.png`);
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  const relative = path.relative(ROOT, file);
  report.screenshots.push(relative); return relative;
}
function runtimeErrors() {
  return pageEvents.filter(e => e.method === 'Runtime.exceptionThrown' || e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' || e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network');
}
async function navigate(size) {
  pageEvents = [];
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: BASE });
  const deadline = Date.now() + 60000;
  while (!pageEvents.some(e => e.method === 'Page.loadEventFired')) { assert(Date.now() < deadline, 'Page loading timed out'); await sleep(50); }
  while (!(await evaluate('!!window.__PI?.ready()'))) { assert(Date.now() < deadline, 'Real engine readiness timed out'); await sleep(100); }
  assert.equal(await evaluate('__PI.boot.error || null'), null);
}
async function checkViewport(size) {
  const result = { ...size, result: 'RUNNING', errors: [] }; report.viewports.push(result);
  try {
    await navigate(size);
    let s = await snap();
    assert.equal(s.mode, 'title'); assert(s.button?.disabled, 'Standby flare button is enabled');
    assert.equal(s.button.key, 'C'); assert(s.button.text.includes('干扰弹'));
    result.standby = s.button;
    await click('#sky-cruise'); await evaluate('__PI.freeze(true)'); s = await step(0.4);
    assert.equal(s.mode, 'play'); assert.equal(s.flares, 3); assert(!s.dead && !s.button.disabled);
    feedback(s, false);
    result.layout = await footerLayout('Ready');
    const before = s;
    await click(FLARE, size.mobile); s = await snap();
    assert.equal(s.flares, 2); assert.equal(s.flareCd, 7); assert.equal(s.flareEffects, 6); assert(s.button.disabled);
    isolated(s, before, 'Native pointer flare'); feedback(s, true);
    result.pointer = { method: size.mobile ? 'CDP native touch' : 'CDP native mouse', before: before.flares, after: s.flares, effects: s.flareEffects, cooldown: s.flareCd, feedback: s.button };
    s = await step(0.08); assert.equal(s.flareEffects, 6);
    result.cooldownLayout = await footerLayout('Cooldown');
    result.screenshot = await screenshot(size.name); result.screenshotState = await snap();
    const cooling = s;
    await click(FLARE, size.mobile); s = await step(1);
    assert.equal(s.flares, 2); assert(s.button.disabled); isolated(s, cooling, 'Disabled cooldown click'); feedback(s, true);
    assert(s.flareCd < cooling.flareCd && s.flareCd > 0); result.cooldownTick = { before: cooling.flareCd, after: s.flareCd, feedback: s.button };
    s = await step(6); assert(!s.button.disabled && s.flareCd <= 0); result.recovered = s.button;
    for (const code of ['Enter', 'Space']) {
      const beforeKey = s;
      await evaluate(`document.querySelector(${JSON.stringify(FLARE)}).focus()`); await press(code); s = await snap();
      assert.equal(s.flares, beforeKey.flares - 1, `Native ${code} did not fire exactly once`);
      assert.equal(s.flareEffects, 6); assert.equal(s.flareCd, 7); isolated(s, beforeKey, `Native button ${code}`); feedback(s, true);
      result[code.toLowerCase()] = { before: beforeKey.flares, after: s.flares, effects: s.flareEffects, view: s.view, shots: s.shots, missiles: s.missiles };
      s = await step(7.1);
    }
    assert.equal(s.flares, 0); assert(s.button.disabled); feedback(s, false);
    result.exhaustedLayout = await footerLayout('Exhausted');
    const empty = s; await click(FLARE, size.mobile); await press('KeyC'); await press('KeyX'); s = await snap();
    assert.equal(s.flares, 0); assert.equal(s.flareEffects, 0); isolated(s, empty, 'Exhausted inputs'); result.exhausted = s.button;
    await press('Escape'); await click('#sky-restart'); await evaluate('__PI.freeze(true)'); s = await step(0.4);
    result.shortcuts = [];
    for (const code of ['KeyC', 'KeyX']) {
      const beforeKey = s; await press(code); s = await snap();
      assert.equal(s.flares, beforeKey.flares - 1, `${code} shortcut no longer fires`); assert.equal(s.flareEffects, 6); isolated(s, beforeKey, code);
      result.shortcuts.push({ code, before: beforeKey.flares, after: s.flares, effects: s.flareEffects });
      if (code === 'KeyC') s = await step(7.1);
    }
    await press('Escape'); s = await snap(); assert.equal(s.mode, 'paused'); assert(s.button.disabled);
    const paused = s; await press('KeyC'); await press('KeyX'); s = await step(1);
    assert.equal(s.flares, paused.flares); assert.equal(s.flareCd, paused.flareCd); isolated(s, paused, 'Paused flare shortcuts'); result.paused = s.button;
    await click('#sky-home'); await evaluate('__PI.freeze(true)'); s = await snap();
    assert.equal(s.mode, 'title'); assert(s.button.disabled);
    const standby = s; await click(FLARE, size.mobile); await press('KeyC'); await press('KeyX'); s = await snap();
    assert.equal(s.mode, 'title'); assert.equal(s.flares, standby.flares); assert.equal(s.flareEffects, 0); isolated(s, standby, 'Standby flare inputs');
    assert.deepEqual(s.errors, []); assert.deepEqual(s.exceptions, []); assert.deepEqual(runtimeErrors(), []);
    result.result = 'PASS'; result.runtimeErrors = []; console.log(`PASS ${size.name}: pointer/Enter/Space, 7s recovery, empty/pause/standby, C/X, isolation, layout`);
  } catch (e) {
    result.result = 'FAIL'; result.errors.push(e.stack); report.errors.push(`${size.name}: ${e.message}`);
    result.lastState = await snap().catch(() => null); result.runtimeErrors = runtimeErrors();
    try { result.failureScreenshot = await screenshot(`${size.name}_failed`); } catch {}
    console.error(`FAIL ${size.name}: ${e.message}`);
  }
}
async function main() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-flare-chrome-'));
  let stderr = '';
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
  try {
    let port;
    for (let i = 0; i < 150; i++) { try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (port) break; } catch {} if (chrome.exitCode !== null) break; await sleep(100); }
    assert(port, `Chrome failed to start: ${stderr}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    report.browser = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method) pageEvents.push(m); };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method);
    for (const size of sizes) await checkViewport(size);
    report.result = report.viewports.every(v => v.result === 'PASS') ? 'PASS' : 'FAIL';
  } catch (e) { report.result = 'FAIL'; report.errors.push(e.stack); throw e; }
  finally {
    ws?.close(); for (const p of pending.values()) clearTimeout(p.timer); pending.clear();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGTERM'); for (let i = 0; i < 30 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100); if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await new Promise(resolve => chrome.once('exit', resolve)); } }
    fs.rmSync(profile, { recursive: true, force: true });
    report.cleanup = { ownChromeStopped: chrome.exitCode !== null || chrome.signalCode !== null, ownProfileDeleted: !fs.existsSync(profile) };
    report.finishedAt = new Date().toISOString();
    const file = path.join(ROOT, 'shots', 'sky_flare_results.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log(`RESULT ${report.result}: ${file}`);
  }
  if (report.result !== 'PASS') process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });

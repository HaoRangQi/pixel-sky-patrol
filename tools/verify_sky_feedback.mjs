#!/usr/bin/env node
// 浏览器验收：音量滑轨对实际主增益的作用、机炮/导弹离架点、同帧弹道，以及
// 巡航→加力联动和 1200 档满转向。输入与状态全部走正式页面控件和 __PI.step。
// 用法：node tools/verify_sky_feedback.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8765/sky-patrol/?adapt=0';
const KT = 1.94384;
const PREFIX = 'sky_feedback';
const report = { startedAt: new Date().toISOString(), command: 'node tools/verify_sky_feedback.mjs', result: 'RUNNING', screenshots: [], runtimeErrors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws, profile, serial = 0;
const pending = new Map(), events = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 65000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression, why = expression) {
  const end = Date.now() + 60000;
  while (!(await evaluate(expression))) { assert(Date.now() < end, `超时：${why}`); await sleep(80); }
}
const runtimeErrors = () => events.filter(e => e.method === 'Runtime.exceptionThrown' ||
  e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' ||
  e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network');
async function key(code, type = 'keyDown', modifiers = 0) {
  const map = { Escape: ['Escape', 27], KeyF: ['f', 70], KeyE: ['e', 69], Space: [' ', 32], ShiftLeft: ['Shift', 16] };
  const [k, vk] = map[code];
  await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, modifiers });
}
async function tap(code) { await key(code); await key(code, 'keyUp'); }
async function paintTwice() { await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); }
async function shot(name) {
  await paintTwice();
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const relative = `shots/${PREFIX}_${name}.png`;
  fs.writeFileSync(path.join(ROOT, relative), Buffer.from(r.data, 'base64'));
  report.screenshots.push(relative);
  return relative;
}
// AudioParam 的真实调度值由页面内补丁记录，不改音频实现。
const audioProbe = `(() => {
  window.__audioProbe = { ramps: [] };
  const proto = (window.AudioParam || {}).prototype;
  if (proto) {
    const ramp = proto.linearRampToValueAtTime;
    proto.linearRampToValueAtTime = function (value, time) {
      try { window.__audioProbe.ramps.push({ value, time, wall: performance.now() }); } catch {}
      return ramp.call(this, value, time);
    };
  }
})()`;
const status = () => evaluate(`(() => {
  const g = __PI.G, ui = document.getElementById('ui'), out = id => document.getElementById(id)?.textContent;
  return {
    mode: g.mode, view: g.view, volume: g.volume, sound: g.sound, time: g.time,
    cruise: +document.getElementById('sky-cruise-speed').value, burn: +document.getElementById('sky-burn-speed').value,
    turn: +document.getElementById('sky-turn-rate').value, turnLocked: document.getElementById('sky-turn-lock').checked,
    cruiseText: out('sky-cruise-speed-value'), burnText: out('sky-burn-speed-value'), turnText: out('sky-turn-rate-value'),
    volumeText: out('sky-volume-value'),
    player: g.player && { speed: g.player.speed, fuel: g.player.fuel, pos: { ...g.player.pos }, basis: g.player.renderBasis || g.player.basis, missiles: g.player.missiles, nextRail: g.player.nextRail, dead: g.player.dead },
    bullets: g.bullets.length, liveMissiles: g.missiles.length,
    ramps: window.__audioProbe ? window.__audioProbe.ramps.slice(-6) : null,
  };
})()`);
async function setRange(id, value) {
  await evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${value}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}
async function pause() { if ((await status()).mode !== 'paused') { await tap('Escape'); assert.equal((await status()).mode, 'paused'); } }
async function play() { if ((await status()).mode !== 'play') { await tap('Escape'); assert.equal((await status()).mode, 'play'); } }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

async function volume(result) {
  await pause();
  // 音效默认关闭；先打开，滑块才驱动主增益。
  await evaluate("document.getElementById('sky-sound').click()");
  let s = await status();
  if (!s.sound) { await evaluate("document.getElementById('sky-sound').click()"); s = await status(); }
  assert.equal(s.sound, true, '音效没有开启');
  assert.equal(s.volume, .55, '默认主音量不是 55%');
  await setRange('sky-volume', 40);
  s = await status();
  assert.equal(s.volume, .4); assert.equal(s.volumeText, '40%');
  await setRange('sky-volume', 100);
  s = await status();
  assert.equal(s.volume, 1); assert.equal(s.volumeText, '100%');
  const loud = s.ramps;
  assert(loud && loud.length, '主增益没有调度记录');
  assert(Math.abs(loud.at(-1).value - 1) < 1e-6, `100% 未调度到 1.0：${loud.at(-1).value}`);
  await setRange('sky-volume', 55);
  s = await status();
  assert.equal(s.volume, .55);
  assert(Math.abs(s.ramps.at(-1).value - .55) < 1e-6, `55% 未调度到 0.55：${s.ramps.at(-1).value}`);
  await setRange('sky-volume', 0);
  s = await status();
  assert.equal(s.volume, 0);
  assert(Math.abs(s.ramps.at(-1).value - 0.0001) < 1e-6, `0% 未静音：${s.ramps.at(-1).value}`);
  assert.equal(s.sound, true, '0% 不应关闭音效开关');
  await setRange('sky-volume', 100);
  await setRange('sky-volume', 55);
  result.volume = { loud: loud.at(-1), quiet: s.ramps.at(-1), soundStillOn: s.sound, screenshot: await shot('volume_panel') };
  await play();
}

async function linkage(result) {
  await pause();
  await setRange('sky-cruise-speed', 498);
  let s = await status();
  assert.equal(s.cruise, 498);
  assert.equal(s.burn, 698, `巡航 498 时加力档应跟到 698：${s.burn}`);
  assert.equal(s.cruiseText, '498 档 · 实速 496 节'); assert.equal(s.burnText, '698 节');
  await setRange('sky-burn-speed', 1200);
  s = await status();
  assert.equal(s.burn, 1200); assert.equal(s.burnText, '1200 节');
  await setRange('sky-cruise-speed', 1500);
  s = await status();
  assert.equal(s.burn, 1500); assert.match(s.burnText, /已达上限/);
  await setRange('sky-cruise-speed', 498); await setRange('sky-burn-speed', 698);
  // 转向曲线：876→88、1199→119、1200→120；默认锁在速度上。
  for (const [dial, degrees] of [[300, 30], [800, 80], [876, 88], [1199, 119], [1200, 120], [1500, 120]]) {
    await setRange('sky-cruise-speed', dial);
    s = await status();
    assert.equal(s.turn, degrees, `巡航 ${dial} 档转向应为 ${degrees}°/秒：${s.turn}`);
    assert.equal(s.turnLocked, true, '默认转向应锁在速度上');
    assert.equal(s.turnText, `${degrees}°/秒 · 随速度`, `巡航 ${dial} 档转向文字`);
  }
  await setRange('sky-cruise-speed', 498);
  s = await status();
  assert.equal(s.turn, 50, `498 档转向应为 50°/秒：${s.turn}`);
  result.linkage = { cruise: s.cruise, burn: s.burn, turn: s.turn, turnText: s.turnText, screenshot: await shot('linkage_panel') };
  await play();
}

async function weapons(result) {
  await pause(); await setRange('sky-cruise-speed', 300); await setRange('sky-burn-speed', 500); await play();
  await evaluate('__PI.freeze(true)');
  // 同一帧按下 F 与 E：机炮从机鼻下方、导弹从翼下挂架。
  await key('KeyF'); await key('KeyE');
  await evaluate('__PI.step(1 / 60)');
  await key('KeyF', 'keyUp'); await key('KeyE', 'keyUp');
  const launches = await evaluate(`(() => {
    const g = __PI.G, p = g.player, b = p.renderBasis || p.basis;
    const rel = q => ({ fwd: (q.x - p.pos.x) * b.fwd.x + (q.y - p.pos.y) * b.fwd.y + (q.z - p.pos.z) * b.fwd.z,
      right: (q.x - p.pos.x) * b.right.x + (q.y - p.pos.y) * b.right.y + (q.z - p.pos.z) * b.right.z,
      up: (q.x - p.pos.x) * b.up.x + (q.y - p.pos.y) * b.up.y + (q.z - p.pos.z) * b.up.z });
    const bullet = g.bullets.find(v => v.owner === 'player'), missile = g.missiles.find(v => v.owner === 'player');
    return { bullet: bullet && rel(bullet.pos), missile: missile && rel(missile.pos), nextRail: p.nextRail, missiles: p.missiles };
  })()`);
  assert(launches.bullet && launches.missile, '同帧没有同时产生机炮与导弹');
  assert(launches.bullet.up < -0.3, `机炮应从机腹下方射出：up=${launches.bullet.up}`);
  assert(launches.missile.up < -0.3, `导弹应从翼下挂架射出：up=${launches.missile.up}`);
  assert(Math.abs(launches.bullet.right) < 0.2, '机炮应位于机身中线');
  assert(Math.abs(launches.missile.right) > 1.8, `导弹应偏在机翼一侧：right=${launches.missile.right}`);
  result.weapons = { launches, screenshot: await shot('weapons_launch') };

  // 连续四发：四个挂点两对，符号交替、内外两组。
  await evaluate('Object.assign(__PI.G.player, { missiles: 4, reloads: [], gunCd: 0 }); __PI.G.missiles.length = 0; __PI.G.bullets.length = 0');
  const rails = [];
  for (let i = 0; i < 4; i++) {
    await key('KeyE');
    await evaluate('__PI.step(1 / 60)');
    await key('KeyE', 'keyUp');
    rails.push(await evaluate(`(() => { const g = __PI.G, p = g.player, b = p.renderBasis || p.basis, m = g.missiles.filter(v => v.owner === 'player').at(-1);
      return { fwd: (m.pos.x - p.pos.x) * b.fwd.x + (m.pos.y - p.pos.y) * b.fwd.y + (m.pos.z - p.pos.z) * b.fwd.z,
        right: (m.pos.x - p.pos.x) * b.right.x + (m.pos.y - p.pos.y) * b.right.y + (m.pos.z - p.pos.z) * b.right.z,
        up: (m.pos.x - p.pos.x) * b.up.x + (m.pos.y - p.pos.y) * b.up.y + (m.pos.z - p.pos.z) * b.up.z }; })()`));
  }
  const signs = rails.map(v => Math.sign(Math.round(v.right * 10)));
  // 首个挂点取决于上一发后的 nextRail；只要求四发左右交替。
  assert(signs.every((v, i) => !i || v === -signs[i - 1]), `四个挂点应左右交替：${signs}`);
  assert(new Set(rails.map(v => Math.round(Math.abs(v.right) * 10))).size === 2, '四个挂点应分内外两组');
  assert(rails.every(v => v.up < -0.3), '四个挂点都应在翼下');
  result.rails = rails;

  // 同帧弹道：真实按 F、E 各发一发，再逐帧步进引擎，比较各自相对离架点的前进与下坠。
  const flight = await evaluate(`(() => {
    const g = __PI.G, p = g.player;
    g.bullets.length = 0; g.missiles.length = 0; p.missiles = 4; p.reloads = []; p.gunCd = 0;
    return new Promise(resolve => {
      // 同一帧按下两键，由页面自己的输入分发产生两件武器。
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      __PI.step(1 / 60);
      const bullet = g.bullets.find(v => v.owner === 'player'), missile = g.missiles.find(v => v.owner === 'player');
      if (!bullet || !missile) { resolve({ error: '同帧没有同时产生机炮与导弹' }); return; }
      const b0 = { ...bullet.pos }, m0 = { ...missile.pos }, rows = [], b = p.renderBasis || p.basis;
      const speed = v => Math.hypot(v.vel.x, v.vel.y, v.vel.z);
      const forward = q => (q.x - b0.x) * b.fwd.x + (q.y - b0.y) * b.fwd.y + (q.z - b0.z) * b.fwd.z;
      const forwardM = q => (q.x - m0.x) * b.fwd.x + (q.y - m0.y) * b.fwd.y + (q.z - m0.z) * b.fwd.z;
      rows.push({ t: 0, bulletSpeed: speed(bullet), missileSpeed: speed(missile), bulletForward: 0, missileForward: 0, bulletDrop: 0, missileDrop: 0 });
      for (let i = 1; i <= 60 && !bullet.dead && !missile.dead; i++) {
        __PI.step(1 / 60);
        rows.push({ t: i / 60, bulletSpeed: speed(bullet), missileSpeed: speed(missile),
          bulletForward: forward(bullet.pos), missileForward: forwardM(missile.pos),
          bulletDrop: b0.y - bullet.pos.y, missileDrop: m0.y - missile.pos.y });
      }
      resolve(rows);
    });
  })()`);
  assert(!flight.error, flight.error);
  const moved = flight.filter(r => r.t > 0);
  assert(moved.length > 50, '两种弹体都应真实飞行一整秒');
  assert(moved.every(r => r.missileSpeed > r.bulletSpeed), '一秒内导弹弹速必须始终高于机炮');
  assert(moved.every(r => r.missileForward > r.bulletForward), '导弹飞出的距离必须始终大于机炮');
  assert(moved.every(r => r.missileDrop < r.bulletDrop), '下坠更快的必须是机炮，不是导弹');
  result.ballistics = { first: flight[0], quarter: flight.find(r => Math.abs(r.t - 0.25) < 1e-6), half: flight.find(r => Math.abs(r.t - 0.5) < 1e-6), last: flight.at(-1) };
  await evaluate('__PI.freeze(true)');
}

async function main() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-feedback-'));
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
    assert(port, `Chrome 未启动：${stderr}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    report.browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = e => {
      const m = JSON.parse(e.data), p = pending.get(m.id);
      if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method) events.push(m);
    };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: audioProbe });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE });
    await until('!!window.__PI?.ready()', '真实地形就绪');
    assert.equal(await evaluate('__PI.boot.error || null'), null, '引擎启动错误');
    await evaluate("document.getElementById('sky-inland').click()");
    await evaluate('__PI.freeze(true)');
    await until('__PI.G.mode === "play"', '进入飞行');
    await evaluate('__PI.step(1)');

    await volume(report);
    await linkage(report);
    await weapons(report);

    assert.deepEqual(await evaluate('[...__PI.errors, ...__PI.exceptions]'), [], '运行期错误');
    assert.deepEqual(runtimeErrors(), []);
    report.result = 'PASS'; report.finishedAt = new Date().toISOString();
    console.log('PASS feedback: 音量滑轨、巡航联动、1200 档满转向、四挂点与同帧弹道');
  } catch (error) {
    report.result = 'FAIL'; report.error = error.stack; report.runtimeErrors = runtimeErrors();
    console.error(`FAIL feedback: ${error.message}`);
    try { report.failureScreenshot = await shot('failed'); } catch {}
    process.exitCode = 1;
  } finally {
    ws?.close();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('验收结束')); }
    pending.clear();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill('SIGTERM');
      for (let i = 0; i < 30 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await new Promise(resolve => chrome.once('exit', resolve)); }
    }
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'shots', `${PREFIX}_results.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(`RESULT ${report.result}: shots/${PREFIX}_results.json`);
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

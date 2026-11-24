#!/usr/bin/env node
// 浏览器像素证据：机身后方的弹坑焦痕在 2D 覆盖层上绘制时，机体真实屏幕轮廓内不得留下
// 任何焦痕像素，轮廓外仍须照常可见。做法是同一冻结画面里“有焦痕 / 无焦痕”两帧逐像素相减：
// 轮廓内的差值必须为零。只向 G.decals 追加一枚与导弹落点同尺寸的合成焦痕；玩家姿态、
// 速度、相机与时间都来自真实起飞和真实俯视切换。用法：node tools/verify_sky_occlusion.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8765/sky-patrol/?adapt=0';
const PREFIX = 'sky_occlusion';
const report = { startedAt: new Date().toISOString(), command: 'node tools/verify_sky_occlusion.mjs', result: 'RUNNING', screenshots: [], runtimeErrors: [] };
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
const paintTwice = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))';
async function shot(name) {
  await evaluate(paintTwice);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const relative = `shots/${PREFIX}_${name}.png`;
  fs.writeFileSync(path.join(ROOT, relative), Buffer.from(r.data, 'base64'));
  report.screenshots.push(relative);
  return relative;
}

// 页面内：同一次冻结里先带焦痕、再移除焦痕各画两帧，逐像素比较 ui 覆盖层。
const measure = `(async () => {
  const g = __PI.G, p = g.player, cam = g.camera, ui = document.getElementById('ui'), c2 = ui.getContext('2d');
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // 投影使用 HUD 逻辑坐标（BASE_H=340，宽度随画幅变化）；设备像素按画布/逻辑比换算。
  const VH = 340, VW = ui.width / (ui.height / VH), sx = ui.width / VW, sy = ui.height / VH;
  const vp = cam.vp, b = p.renderBasis || p.basis;
  const project = q => {
    const cw = vp[3] * q.x + vp[7] * q.y + vp[11] * q.z + vp[15];
    return { x: ((vp[0] * q.x + vp[4] * q.y + vp[8] * q.z + vp[12]) / cw * 0.5 + 0.5) * VW,
             y: (1 - ((vp[1] * q.x + vp[5] * q.y + vp[9] * q.z + vp[13]) / cw * 0.5 + 0.5)) * VH };
  };
  const hull = [[6.59, 0], [-1.9, 4.9], [-4.3, 0], [-1.9, -4.9]].map(([f, r]) => project({
    x: p.pos.x + b.fwd.x * f + b.right.x * r,
    y: p.pos.y + b.fwd.y * f + b.right.y * r,
    z: p.pos.z + b.fwd.z * f + b.right.z * r,
  }));
  const d = g.decals.at(-1);
  const ds = project(d.pos);
  const depth = Math.hypot(d.pos.x - cam.pos.x, d.pos.y - cam.pos.y, d.pos.z - cam.pos.z);
  const ppm = VH / (2 * Math.max(1, depth) * Math.tan(cam.fov * 0.5));
  const radius = d.size * ppm;
  const inside = (x, y) => {
    let side = 0;
    for (let i = 0; i < 4; i++) {
      const a = hull[i], b2 = hull[(i + 1) % 4];
      const cross = (b2.x - a.x) * (y - a.y) - (b2.y - a.y) * (x - a.x);
      if (!cross) continue;
      const s2 = cross > 0 ? 1 : -1;
      if (!side) side = s2; else if (s2 !== side) return false;
    }
    return true;
  };
  const inDecal = (x, y) => { const u = (x - ds.x) / radius, v = (y - ds.y) / (radius * 0.45); return u * u + v * v <= 1; };
  const grab = () => c2.getImageData(0, 0, ui.width, ui.height).data;
  const withDecal = grab();
  // 移除同一枚焦痕后重画，两帧唯一的差别就是这枚焦痕。
  g.decals.pop();
  await nextFrame();
  const withoutDecal = grab();
  const diff = (i) => Math.abs(withDecal[i] - withoutDecal[i]) + Math.abs(withDecal[i + 1] - withoutDecal[i + 1])
    + Math.abs(withDecal[i + 2] - withoutDecal[i + 2]) + Math.abs(withDecal[i + 3] - withoutDecal[i + 3]);
  let insidePixels = 0, insideDiff = 0, outsidePixels = 0, outsideDiff = 0;
  for (let y = 0; y < ui.height; y++) for (let x = 0; x < ui.width; x++) {
    const lx = (x + 0.5) / sx, ly = (y + 0.5) / sy;
    if (!inDecal(lx, ly)) continue;
    const i = (y * ui.width + x) * 4, delta = diff(i);
    if (inside(lx, ly)) { insidePixels++; if (delta > 2) insideDiff++; }
    else { outsidePixels++; if (delta > 2) outsideDiff++; }
  }
  return { view: g.view, vw: VW, hull, decal: { screen: ds, radius }, insidePixels, insideDiff, outsidePixels, outsideDiff, time: g.time };
})()`;

async function main() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-occlusion-'));
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE });
    await until('!!window.__PI?.ready()', '真实地形就绪');
    assert.equal(await evaluate('__PI.boot.error || null'), null, '引擎启动错误');

    // 真实起飞到秋林低飞，再切到俯视；相机、速度、时间都来自常规入口。
    await evaluate("document.getElementById('sky-inland').click()");
    await evaluate('__PI.freeze(true)');
    await until('__PI.G.mode === "play"', '进入飞行');
    for (let n = 0; n < 3 && (await evaluate('__PI.G.view')) !== 0; n++) {
      await evaluate("document.getElementById('sky-camera').click()");
      await evaluate('__PI.step(1.15)');
    }
    assert.equal(await evaluate('__PI.G.view'), 0, '未切到俯视');
    const plain = await evaluate('(() => { const p = __PI.G.player, b = p.renderBasis || p.basis; return { pos: p.pos, fwd: b.fwd, right: b.right, agl: p.agl }; })()');
    // 合成一枚与导弹落点同尺寸（18 米）的焦痕，落在机身右侧 8 米、后 3 米的地面上，
    // 让它压住机体轮廓；高度取真实地貌，与导弹触地留痕一致。
    const site = await evaluate(`(() => {
      const g = __PI.G, p = g.player, b = p.renderBasis || p.basis;
      const d = { x: p.pos.x + b.right.x * 8 + b.fwd.x * -3, z: p.pos.z + b.right.z * 8 + b.fwd.z * -3 };
      const y = Math.max(0, g.map.heightAt(d.x, d.z));
      g.decals.push({ pos: { x: d.x, y: y + 0.5, z: d.z }, size: 18, life: 26, maxLife: 26 });
      return { x: d.x, y, z: d.z };
    })()`);
    await evaluate(paintTwice);
    const result = await evaluate(measure);
    result.site = site;
    report.measurement = result;
    // 把带焦痕的画面重新放回去截一张，便于人工核对。
    await evaluate("__PI.G.decals.push({ pos: " + JSON.stringify(site) + ", size: 18, life: 26, maxLife: 26 })");
    result.screenshot = await shot('top_decal_over_hull');
    assert(result.view === 0, '测量时不在俯视');
    assert(result.insidePixels > 200, `焦痕与机体轮廓重叠区域太小：${result.insidePixels} 像素`);
    assert(result.outsideDiff > 200, `轮廓外的焦痕没有绘制：${result.outsideDiff} 像素`);
    assert.equal(result.insideDiff, 0, `机体轮廓内仍有 ${result.insideDiff} 个焦痕像素`);
    assert.deepEqual(await evaluate('[...__PI.errors, ...__PI.exceptions]'), [], '运行期错误');
    assert.deepEqual(runtimeErrors(), []);
    report.result = 'PASS';
    console.log(`PASS occlusion: hull=${result.insidePixels}px with ${result.insideDiff} changed, outside=${result.outsideDiff}/${result.outsidePixels}px changed, decal radius=${result.decal.radius.toFixed(1)}px`);
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.result = 'FAIL'; report.error = error.stack; report.runtimeErrors = runtimeErrors();
    console.error(`FAIL occlusion: ${error.message}`);
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

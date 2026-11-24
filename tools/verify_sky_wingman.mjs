#!/usr/bin/env node
// Real Chrome acceptance for the wingman + optional OpenAI-compatible AI link.
// Self-contained: starts its own static server and a local /v1/chat/completions
// stub, so it does not depend on the 8765 preview server or any external API.
//
// Usage: node tools/verify_sky_wingman.mjs [--prefix=sky_wingman]
//
// The fake API key never leaves this process' memory. It is never written to the
// report, screenshots, storage assertions, or stub logs; request evidence keeps
// only booleans and a redacted Authorization marker.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1];
const PREFIX = option('prefix') || 'sky_wingman';
assert(/^sky_[a-z0-9_]+$/.test(PREFIX), 'Invalid artifact prefix');
const KEY = 'sk-wingman-acceptance-2f7c9d';
const MODEL = 'stub-wingman-1';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// ---- local static server + OpenAI-compatible stub -------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};
let stubMode = 'success';
const stubRequests = [];
const heldResponses = [];
const aiCommand = { intent: 'cover_player', aggression: 'high' };
const aiPayload = command => ({
  id: 'chatcmpl-stub', object: 'chat.completion', model: MODEL,
  choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(command) }, finish_reason: 'stop' }],
});
function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    return res.end();
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const record = {
      at: new Date().toISOString(), path: url.pathname, search: url.search,
      authorization: req.headers.authorization ? 'Bearer ***' : null,
      authorizationMatched: req.headers.authorization === `Bearer ${KEY}`,
      contentType: req.headers['content-type'] || null,
      bodyBytes: Buffer.byteLength(body), keyInBody: body.includes(KEY), keyInUrl: url.href.includes(KEY),
    };
    try {
      const parsed = JSON.parse(body);
      record.model = parsed.model; record.stream = parsed.stream; record.temperature = parsed.temperature;
      record.maxTokens = parsed.max_tokens; record.roles = parsed.messages?.map(message => message.role);
      record.userContext = parsed.messages?.find(message => message.role === 'user')?.content || '';
    } catch (error) { record.parseError = true; }
    stubRequests.push(record);
    res.on('close', () => { record.clientAborted = !res.writableEnded; });
    if (stubMode === 'delay') { heldResponses.push(res); return; }
    if (stubMode === 'timeout') return;
    if (stubMode === 'close') { req.socket.destroy(); return; }
    if (stubMode === 'http') return sendJson(res, 500, { error: { message: 'stub failure' } });
    if (stubMode === 'invalid') return sendJson(res, 200, aiPayload({ intent: 'nuke_player', aggression: 'high' }));
    return sendJson(res, 200, aiPayload(aiCommand));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (error) { res.writeHead(400); return res.end('bad path'); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(ROOT, `.${pathname}`);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});
function releaseHeld(command = { intent: 'attack_player_target', aggression: 'high' }) {
  while (heldResponses.length) sendJson(heldResponses.pop(), 200, aiPayload(command));
}

// ---- CDP plumbing ---------------------------------------------------------
let chrome, ws, profile;
let BASE = '';
let serial = 0;
const pending = new Map();
let pageEvents = [];
const allPageEvents = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 65000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    if (await evaluate(expression)) return;
    await sleep(80);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}
async function step(seconds) {
  await evaluate(`__PI.step(${seconds}); __SKY.sync(); null`);
}
function pageState() {
  const G = window.__PI?.G;
  const wingman = G?.allies?.[0];
  const element = id => document.getElementById(id);
  const dump = storage => {
    try {
      const out = {};
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        out[key] = storage.getItem(key);
      }
      return out;
    } catch (error) { return { error: String(error) }; }
  };
  const command = wingman?.command;
  const input = id => element(id);
  return {
    mode: G?.mode, view: G?.view, time: G?.time, sound: G?.sound,
    wingmanCount: window.__SKY?.wingmanCount?.() ?? -1,
    aiStatus: window.__SKY?.aiStatus?.() ?? null,
    wingman: wingman ? {
      pos: { ...wingman.pos }, state: wingman.state,
      command: command ? { intent: command.intent, aggression: command.aggression, source: command.source, expiresAt: command.expiresAt, active: G.time < command.expiresAt } : null,
    } : null,
    player: G?.player ? { shield: G.player.shield, dead: G.player.dead, pos: { ...G.player.pos } } : null,
    enemies: G?.enemies?.filter(enemy => !enemy.dead).length ?? -1,
    allyBullets: G?.bullets?.filter(bullet => bullet.owner === 'ally').length ?? -1,
    allyKills: G?.allyKills ?? -1,
    ui: {
      wingmanChecked: !!element('sky-wingman')?.checked,
      wingmanDisabled: !!element('sky-wingman')?.disabled,
      aiChecked: !!element('sky-ai-enabled')?.checked,
      aiDisabled: !!element('sky-ai-enabled')?.disabled,
      aiDetailsHidden: !!element('sky-ai-details')?.hidden,
      endpointDisabled: !!element('sky-ai-endpoint')?.disabled,
      modelDisabled: !!element('sky-ai-model')?.disabled,
      keyDisabled: !!element('sky-ai-key')?.disabled,
      testDisabled: !!element('sky-ai-test')?.disabled,
      statusText: element('sky-ai-status')?.textContent ?? null,
      endpoint: element('sky-ai-endpoint')?.value || '',
      model: element('sky-ai-model')?.value || '',
      keyType: element('sky-ai-key')?.type || null,
      keyLength: (element('sky-ai-key')?.value || '').length,
      difficulty: element('sky-difficulty')?.value || null,
      difficultySummary: element('sky-difficulty-summary')?.textContent || null,
      activeId: document.activeElement?.id || document.activeElement?.tagName || '',
    },
    storage: { local: dump(localStorage), session: dump(sessionStorage) },
    errors: window.__PI?.errors || [], exceptions: window.__PI?.exceptions || [],
    unhandled: window.__unhandled || [],
  };
}
const snap = () => evaluate(`(${pageState})()`);
const storageJson = state => JSON.stringify(state.storage);
const pageEventJson = event => JSON.stringify(event);

// ---- report ---------------------------------------------------------------
const report = {
  startedAt: new Date().toISOString(),
  command: `node tools/verify_sky_wingman.mjs${option('prefix') ? ` --prefix=${PREFIX}` : ''}`,
  baseUrl: null,
  result: 'RUNNING',
  keyPolicy: {
    storage: 'API Key 只存在于 password 输入框的当前页面内存；不写 localStorage/sessionStorage/日志/验收 JSON',
    redaction: 'stub 日志只记录 Bearer *** 与布尔匹配结果',
  },
  phases: [], checks: [], screenshots: [], ai: { stubRequests: [] }, runtimeErrors: [],
};
function check(name, condition, detail = '') {
  assert(condition, `${name}${detail ? `: ${detail}` : ''}`);
  report.checks.push(name);
}
async function phase(name, work) {
  const entry = { name, result: 'RUNNING' };
  report.phases.push(entry);
  const started = Date.now();
  try {
    await work(entry);
    entry.result = 'PASS';
    entry.durationMs = Date.now() - started;
    console.log(`PASS ${name}`);
  } catch (error) {
    entry.result = 'FAIL';
    entry.error = error.stack;
    entry.durationMs = Date.now() - started;
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}
async function screenshot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const file = path.join(ROOT, 'shots', `${PREFIX}_${name}.png`);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  report.screenshots.push(path.relative(ROOT, file));
  return path.relative(ROOT, file);
}

// ---- browser setup --------------------------------------------------------
async function navigate(size = { width: 1440, height: 900, mobile: false }) {
  pageEvents = [];
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: `${BASE}/sky-patrol/?adapt=0` });
  const deadline = Date.now() + 30000;
  while (!pageEvents.some(event => event.method === 'Page.loadEventFired') && Date.now() < deadline) await sleep(50);
  assert(pageEvents.some(event => event.method === 'Page.loadEventFired'), 'Navigation did not finish loading');
  await until('!!window.__PI?.ready()', 'engine readiness');
  assert.equal(await evaluate('window.__PI.boot.error || null'), null, 'Engine boot error');
}
const keyMap = { Tab: ['Tab', 9], Escape: ['Escape', 27], KeyM: ['m', 77] };
async function press(code, modifiers = 0) {
  const [key, windowsVirtualKeyCode] = keyMap[code] || [code, 0];
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode, modifiers });
}
async function typeCharacter(code, key, text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, text, windowsVirtualKeyCode: key.charCodeAt(0) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
}
async function pauseGame() {
  await evaluate("__PI.togglePause(); __PI.freeze(true); __SKY.sync(); null");
  await until("__PI.G.mode === 'paused'", 'pause mode');
  await sleep(50);
}
async function resumeGame() {
  await evaluate("document.getElementById('sky-resume').click(); __PI.freeze(true); __SKY.sync(); null");
  await until("__PI.G.mode === 'play'", 'resume mode');
  await sleep(50);
}
async function restartRun() {
  await evaluate("__SKY.restart(); __PI.freeze(true); __SKY.sync(); null");
  await until("__PI.G.mode === 'play'", 'restart mode');
  await sleep(50);
}
async function setCheckbox(id, checked) {
  await evaluate(`(() => { const element = document.getElementById(${JSON.stringify(id)}); element.checked = ${!!checked}; element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(50);
}
async function setInput(id, value, eventName = 'change') {
  await evaluate(`(() => { const element = document.getElementById(${JSON.stringify(id)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true })); })()`);
}
async function waitStubRequests(count, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    if (stubRequests.length >= count) return;
    await sleep(60);
    await step(0.05);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}; stub requests=${stubRequests.length}, wanted=${count}`);
}
function assertCleanRuntime(state) {
  assert.deepEqual(state.errors, [], 'Engine errors');
  assert.deepEqual(state.exceptions, [], 'Engine exceptions');
  assert.deepEqual(state.unhandled, [], 'Unhandled promise rejections');
}
function assertNoSecretIn(value, where) {
  assert(!value.includes(KEY), `API Key leaked into ${where}`);
}
async function configureAi(endpoint) {
  await setCheckbox('sky-ai-enabled', true);
  await setInput('sky-ai-endpoint', endpoint);
  await setInput('sky-ai-model', MODEL);
  await setInput('sky-ai-key', KEY, 'input');
  await evaluate("__SKY.sync(); null");
  const state = await snap();
  check('AI 详情在开启后展开', state.ui.aiDetailsHidden === false);
  check('AI 输入在暂停时可编辑', !state.ui.endpointDisabled && !state.ui.modelDisabled && !state.ui.keyDisabled);
  check('Key 输入保持 password 类型', state.ui.keyType === 'password');
  assertNoSecretIn(storageJson(state), 'localStorage/sessionStorage');
  assert.deepEqual(state.storage.local, {}, 'AI 设置不能写入 localStorage');
  assert.deepEqual(state.storage.session, {}, 'AI 设置不能写入 sessionStorage');
}

async function clickControl(id, touch = false) {
  const point = await evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = element.getBoundingClientRect(), x = r.x + r.width/2, y = r.y + r.height/2;
    return { x, y, hit: !element.disabled && document.elementFromPoint(x,y)?.closest('button') === element };
  })()`);
  assert(point.hit, `${id} must be visible and clickable`);
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
}

async function titleSettingsCheck() {
  await phase('主界面设置：三尺寸入口、起飞前配置、Esc返回与原生触屏', async () => {
    await evaluate('__PI.freeze(true); null');
    for (const [name, width, height, mobile] of [['desktop',1440,900,false], ['portrait',390,844,true], ['landscape',844,390,true]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await sleep(120);
      check(`${name} 主界面设置按钮可见且已启用`, await evaluate(`(() => {
        const el=document.getElementById('sky-settings'), r=el.getBoundingClientRect();
        return !el.disabled && r.width>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
      })()`));
      await screenshot(`title_${name}`);
      await clickControl('sky-settings', mobile);
      check(`${name} 设置保留待命来源`, await evaluate("__PI.G.mode === 'paused' && __PI.G.pausedFrom === 'title' && document.getElementById('sky-pause-title').textContent === '设置'"));
      await screenshot(`title_settings_${name}`);
      await clickControl('sky-resume', mobile);
      check(`${name} 返回按钮回主界面而非起飞`, (await snap()).mode === 'title');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await clickControl('sky-settings');
    await setInput('sky-cruise-speed', '500', 'input');
    await setInput('sky-volume', '70', 'input');
    await setCheckbox('sky-wingman', true);
    await configureAi(`${BASE}/v1`);
    check('待命勾选僚机不出生也不自动请求', (await snap()).wingmanCount === 0 && stubRequests.length === 0);
    await clickControl('sky-ai-test');
    await until("document.getElementById('sky-ai-status').textContent === '连接成功'", 'title connection test');
    check('起飞前可显式测试模型连接', stubRequests.length === 1);
    await press('Escape');
    check('Esc关闭设置并归还焦点', await evaluate("__PI.G.mode === 'title' && document.activeElement.id === 'sky-settings'"));
    await clickControl('sky-cruise');
    await evaluate('__PI.freeze(true); null');
    check('起飞读取主界面选定参数和僚机', await evaluate('Math.abs(__PI.G.player.cruiseSpeed*1.94384-500)<.01 && __PI.G.volume===.7 && __PI.G.allies.length===1'));
    await evaluate('__SKY.home(); __PI.freeze(true); null');
    await clickControl('sky-settings');
    await setCheckbox('sky-wingman', false); await setCheckbox('sky-ai-enabled', false);
    for (const id of ['sky-ai-endpoint','sky-ai-model','sky-ai-key']) await setInput(id, '', id==='sky-ai-key'?'input':'change');
    await setInput('sky-volume', '55', 'input');
    await clickControl('sky-speed-reset'); await press('Escape');
    assertCleanRuntime(await snap());
  });
}

async function difficultyCheck() {
  await phase('战斗难度：预设与逐兵种干扰在出航快照，当前航次不被篡改', async () => {
    await evaluate('__SKY.home();__PI.freeze(true);null');
    await until("__PI.G.mode === 'title'", 'home before difficulty');
    await clickControl('sky-settings');
    assert.equal(await evaluate("document.getElementById('sky-difficulty').disabled"),false);
    assert.match(await evaluate("document.getElementById('sky-difficulty-summary').textContent"),/标准.*6\/8\/10/);
    await evaluate("document.getElementById('sky-difficulty-advanced').open=true;document.getElementById('sky-difficulty').scrollIntoView({block:'center'});null");
    await screenshot('difficulty_standard_desktop');
    await setInput('sky-difficulty','hard','change');
    await setInput('sky-flare-fighter','4','input');
    await setInput('sky-flare-chance-fighter','80','input');
    check('难度标为自定义并继承挑战节奏',await evaluate("document.getElementById('sky-difficulty').value==='custom' && /自定义.*8\\/10\\/12/.test(document.getElementById('sky-difficulty-summary').textContent)"));
    const layout=await evaluate(`(() => {
      const ids=['sky-difficulty','sky-flare-drone','sky-flare-chance-drone','sky-flare-fighter','sky-flare-chance-fighter','sky-flare-transport','sky-flare-chance-transport'];
      return ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,w:r.width,left:r.left,right:r.right,disabled:e.disabled}});
    })()`);
    check('三兵种数量与成功率控件在桌面完整显示',layout.every(r=>r.w>20&&r.left>=0&&r.right<=1440&&!r.disabled));
    await screenshot('difficulty_custom_desktop');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(120);
    await evaluate("document.getElementById('sky-difficulty').scrollIntoView({block:'center'});null");
    const portrait=await evaluate(`(() => [...document.querySelectorAll('.sky-difficulty-settings input,.sky-difficulty-settings select')].map(e=>{const r=e.getBoundingClientRect();return {w:r.width,left:r.left,right:r.right}}))()`);
    check('竖屏触屏控件无水平溢出',portrait.length===7&&portrait.every(r=>r.w>15&&r.left>=0&&r.right<=390));
    await screenshot('difficulty_custom_portrait');
    await evaluate("document.getElementById('sky-flare-transport').scrollIntoView({block:'center'});null");
    await screenshot('difficulty_custom_portrait_transport');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
    await clickControl('sky-resume');await clickControl('sky-intercept');
    await until("__PI.G.mode === 'play'",'difficulty run');
    check('挑战自定义在新航次生效',await evaluate("__SKY.flightMode==='intercept' && __PI.G.enemies.length>0"));
    const started=await evaluate(`({rules:__PI.G.defenseRules,waveTotal:__PI.G.waveTotal,decoys:__PI.G.enemies.map(e=>[e.kind,e.flares,e.maxFlares,e.flareChance])})`);
    check('出航快照保存挑战8/10/12与自定义战斗机4发80%',JSON.stringify(started.rules.waves)==='[8,10,12]'&&started.rules.flares.fighter.count===4&&Math.abs(started.rules.flares.fighter.chance-.8)<1e-9);
    check('第一关按新批次8架生成，当前活动单位保留',started.waveTotal===8&&started.decoys.every(row=>row[0]==='drone'&&row[1]===1&&row[2]===1));
    await evaluate(`(() => { const e=__PI.G.enemies[0]; e.flareFlash=1.2; e.flareOutcome='failed'; e.flares=0;
      __PI.G.lock={target:e,phase:'locked',progress:1}; __PI.freeze(true); })()`);
    await screenshot('difficulty_countermeasure_failed');
    await evaluate(`(() => { const e=__PI.G.enemies[0]; e.flareFlash=0; e.tacticPhase='warning'; })()`);
    await screenshot('difficulty_break_warning');
    await evaluate('__PI.freeze(false);null');
    await pauseGame();
    await setInput('sky-difficulty','easy','change');
    check('暂停改预设不改当前航次快照',await evaluate("__PI.G.defenseRules.waves.join(',')==='8,10,12'&&__PI.G.enemies[0].maxFlares===1"));
    await clickControl('sky-restart');await until("__PI.G.mode === 'play'",'easy restart');
    const easy=await evaluate(`({rules:__PI.G.defenseRules,waveTotal:__PI.G.waveTotal})`);
    check('下一次出航读取轻松4/5/6',easy.rules.preset==='easy'&&easy.rules.waves.join(',')==='4,5,6'&&easy.waveTotal===4);
    await pauseGame();await setInput('sky-difficulty','standard','change');
    await clickControl('sky-restart');await until("__PI.G.mode === 'play'",'standard restart');
    report.difficulty={custom:started,easy,standard:await evaluate("__PI.G.defenseRules")};
    await evaluate('__SKY.home();__PI.freeze(true);null');
    assertCleanRuntime(await snap());
  });
}

async function gunPursuitCheck() {
  await phase('自然生成敌机：追入566米，等待两秒后用原生F机炮命中', async () => {
    await clickControl('sky-settings'); await setInput('sky-cruise-speed','500','input'); await press('Escape');
    await clickControl('sky-intercept');
    await evaluate('__PI.freeze(true); window.__gunTarget=__PI.G.enemies[0]; null');
    const held = new Set(), keys = { KeyA:['a',65], KeyD:['d',68], KeyW:['w',87], KeyS:['s',83], KeyF:['f',70] };
    const samples = []; let entered = null, hitAt = null;
    const hold = async (code,on) => {
      if (held.has(code) === on) return;
      const [key,windowsVirtualKeyCode]=keys[code];
      await send('Input.dispatchKeyEvent', { type:on?'keyDown':'keyUp',code,key,windowsVirtualKeyCode });
      on ? held.add(code) : held.delete(code);
    };
    try {
      for (let frame=0;frame<1800;frame++) {
        const s=await evaluate(`(() => {
          const p=__PI.G.player,e=window.__gunTarget,dx=e.pos.x-p.pos.x,dy=e.pos.y-p.pos.y,dz=e.pos.z-p.pos.z;
          const distance=Math.hypot(dx,dy,dz), camera=__PI.G.camera;
          const rx=e.basis.fwd.x*e.speed-p.basis.fwd.x*p.speed,
            ry=e.basis.fwd.y*e.speed-p.basis.fwd.y*p.speed,
            rz=e.basis.fwd.z*e.speed-p.basis.fwd.z*p.speed;
          const closing=720-(rx*dx+ry*dy+rz*dz)/distance;
          const flight=distance/Math.max(80,closing);
          const cx=e.pos.x+rx*flight-camera.pos.x,
            cy=e.pos.y+.8+ry*flight-camera.pos.y,
            cz=e.pos.z+rz*flight-camera.pos.z;
          const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
          const sightLift=Math.atan((p.gunSightOffset||0)/170*camera.tanHalf);
          return { time:__PI.G.time,distance,bearing:wrap(Math.atan2(dx,-dz)-p.yaw),
            aimYaw:wrap(Math.atan2(cx,-cz)-Math.atan2(camera.fwd.x,-camera.fwd.z)),
            aimPitch:Math.atan2(cy,Math.hypot(cx,cz))-Math.asin(camera.fwd.y)-sightLift,
            yawRate:p.yawRate||0,hp:e.hp,maxHp:e.maxHp,dead:e.dead,playerDead:p.dead,lock:__PI.G.lock.phase };
        })()`);
        assert(!s.playerDead,'natural pursuit must keep the player alive');
        if (frame%15===0) samples.push(s);
        if (entered===null && s.distance<=566) { entered=s.time; await screenshot('gun_566m_before_fire'); }
        const elapsed=entered===null?0:s.time-entered;
        if (entered!==null && elapsed<=2) checkAtWindow(s);
        if (s.hp<s.maxHp) { hitAt=s.time; await screenshot('gun_hit_after_wait'); break; }
        const steer=s.aimYaw-s.yawRate*.4;
        await hold('KeyA',steer<-.006); await hold('KeyD',steer>.006);
        await hold('KeyW',s.aimPitch>.005); await hold('KeyS',s.aimPitch<-.005);
        await hold('KeyF',entered!==null && elapsed>=2);
        await step(1/30);
      }
      report.gunPursuit={entryTime:entered,firstHitTime:hitAt,reactionSeconds:2,samples};
      check('自然生成的同一目标可追入566米',entered!==null);
      check('辨认和瞄准两秒后机炮确实命中',hitAt!==null && hitAt-entered>=2 && hitAt-entered<5);
    } finally { for(const code of [...held]) await hold(code,false); }
    await evaluate('__SKY.home(); __PI.freeze(true); null');
    await clickControl('sky-settings'); await clickControl('sky-speed-reset'); await press('Escape');
    assertCleanRuntime(await snap());
    function checkAtWindow(state) { assert(Math.abs(state.bearing)<.18 && state.distance>80,'两秒反应期间目标必须连续留在机头前方'); }
  });
}

async function wingmanBalanceCheck() {
  await phase('僚机削弱：自然战斗中低伤慢射、仍可支援且不代替玩家清场', async () => {
    await clickControl('sky-intercept');
    await evaluate('__PI.freeze(true); null');
    await pauseGame(); await setCheckbox('sky-wingman', true); await resumeGame();
    const sample = await evaluate(`(() => {
      const seen = new WeakSet(), bullets = [], times = [], states = new Set();
      const started = __PI.G.time;
      for (let frame = 0; frame < 45*60; frame++) {
        __PI.step(1/60);
        if (__PI.G.allies[0]) states.add(__PI.G.allies[0].state);
        for (const bullet of __PI.G.bullets) if (bullet.owner === 'ally' && !seen.has(bullet)) {
          seen.add(bullet); bullets.push(bullet.damage); times.push(__PI.G.time-started);
        }
      }
      return { seconds: __PI.G.time-started, rounds: bullets.length, damageValues: [...new Set(bullets)],
        minShotInterval: times.length > 1 ? Math.min(...times.slice(1).map((time,index)=>time-times[index])) : null,
        allyKills: __PI.G.allyKills, playerShots: __PI.G.stats.shots, playerDead: __PI.G.player.dead,
        liveEnemies: __PI.G.enemies.filter(enemy=>!enemy.dead).length, wave: __PI.G.wave, states: [...states] };
    })()`);
    check('实际僚机仍能在自然战斗中开火', sample.rounds > 0);
    check('实际友军子弹单发伤害为4', JSON.stringify(sample.damageValues) === '[4]');
    check('实际普通模式开火间隔不小于0.42秒', sample.minShotInterval >= .42 - 1/60);
    check('玩家不射击时仍保留待清敌机', sample.playerShots === 0 && sample.liveEnemies > 0 && sample.wave === 1);
    check('僚机自然交战中会主动截击并拉开',sample.states.includes('engage') && sample.states.includes('break'));
    report.wingmanBalance = sample;
    await screenshot('wingman_support_after_45s');
    await evaluate('__SKY.home(); __PI.freeze(true); null');
    await clickControl('sky-settings'); await setCheckbox('sky-wingman', false); await press('Escape');
    assertCleanRuntime(await snap());
  });
}

async function resourceCycleCheck() {
  await phase('资源闭环：玩家机炮耗尽/补给、僚机低盾缺弹撤出、开关防刷与三屏读数', async () => {
    await clickControl('sky-cruise'); await evaluate('__PI.freeze(true); null');
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyF',key:'f',windowsVirtualKeyCode:70});
    await step(19);
    await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyF',key:'f',windowsVirtualKeyCode:70});
    const empty=await evaluate('({ammo:__PI.G.player.gunAmmo,reload:__PI.G.player.gunReload,shots:__PI.G.stats.shots})');
    check('原生F持续射击只消耗180发库存',empty.ammo===0 && empty.shots===180 && empty.reload>0);
    check('机炮按钮显示补给且禁用',await evaluate("document.getElementById('sky-gun-action-label').textContent.includes('补给') && document.querySelector('[data-sky-action=gun]').disabled"));
    await screenshot('player_gun_empty');
    await pauseGame(); await step(2);
    check('玩家暂停不推进补给',await evaluate(`__PI.G.player.gunReload === ${empty.reload}`));
    await resumeGame(); await step(empty.reload+.1);
    check('补给时间结束才恢复180发',await evaluate('__PI.G.player.gunAmmo===180 && __PI.G.player.gunReload===0'));
    await pauseGame(); await setCheckbox('sky-wingman',true); await resumeGame();
    // 仅资源状态夹具：不修改双方位置、朝向、弹速或敌方耐久。
    await evaluate('__PI.G.allies[0].ammo=0;__PI.G.allies[0].shield=16;null'); await step(.1);
    const low=await evaluate('({shield:__PI.G.allies[0].shield,ammo:__PI.G.allies[0].ammo,serviceT:__PI.G.allies[0].serviceT,state:__PI.G.allies[0].state})');
    check('僚机缺弹低盾自主进入18秒补给',low.ammo===0 && low.shield===16 && low.state==='resupply' && low.serviceT>17);
    for(const [name,width,height,mobile] of [['desktop',1440,900,false],['portrait',390,844,true],['landscape',844,390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile}); await sleep(120);
      check(`${name}僚机真实资源读数可见`,await evaluate(`(() => {
        const el=document.getElementById('sky-wingman-status'),r=el.getBoundingClientRect();
        return !el.hidden && el.textContent.includes('16/80') && el.textContent.includes('补给') && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
      })()`));
      await screenshot(`wingman_resources_${name}`);
    }
    await pauseGame();await setCheckbox('sky-wingman',false);await setCheckbox('sky-wingman',true);
    check('关闭再开启不能刷新僚机库存护盾',await evaluate('__PI.G.allies[0].ammo===0 && __PI.G.allies[0].shield===16'));
    await resumeGame();await step(17);
    check('十八秒前僚机仍无弹',await evaluate('__PI.G.allies[0].ammo===0'));
    await step(1.2);
    check('安全补给结束僚机恢复有限资源',await evaluate('__PI.G.allies[0].ammo===36 && __PI.G.allies[0].shield===80'));
    await evaluate("__PI.setView('cockpit');null");await step(.7);
    for(const [name,width,height,mobile] of [['desktop',1440,900,false],['portrait',390,844,true],['landscape',844,390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await sleep(120);
      await screenshot(`cockpit_resources_${name}`);
    }
    report.resourceCycle={player:empty,wingman:low,fixture:'只将僚机库存设0、护盾设16，验证补给与UI；敌方实体伤害另由引擎回归覆盖'};
    await evaluate('__SKY.home();__PI.freeze(true);null');await clickControl('sky-settings');await setCheckbox('sky-wingman',false);await press('Escape');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    assertCleanRuntime(await snap());
  });
}

async function wingmanOrbitCheck() {
  await phase('环绕伴飞：围绕前进中的玩家覆盖四周，转向加力后回到周围', async () => {
    await clickControl('sky-cruise');await evaluate('__PI.freeze(true);null');
    await pauseGame();await setCheckbox('sky-wingman',true);await resumeGame();
    // Clear-air fixture only changes altitude, keeping the full orbit above terrain.
    await evaluate('__PI.G.player.pos.y=1500;__PI.G.allies[0].pos.y=1526;null');
    const samples=[],sectors=new Set();let rear=0;
    for(let i=0;i<240;i++){
      await step(.25);
      const s=await evaluate(`(() => {
        const p=__PI.G.player,w=__PI.G.allies[0],dx=w.pos.x-p.pos.x,dy=w.pos.y-p.pos.y,dz=w.pos.z-p.pos.z;
        const front=dx*p.basis.fwd.x+dy*p.basis.fwd.y+dz*p.basis.fwd.z;
        const right=dx*p.basis.right.x+dy*p.basis.right.y+dz*p.basis.right.z;
        return {time:__PI.G.time,front,right,gap:Math.hypot(dx,dy,dz),ammo:w.ammo,shield:w.shield,
          sector:Math.abs(front)>Math.abs(right)?front>0?'front':'rear':right>0?'right':'left'};
      })()`);
      samples.push(s);if(s.sector==='rear')rear++;
      if(!sectors.has(s.sector)){sectors.add(s.sector);await screenshot(`orbit_${s.sector}`);}
    }
    const min=Math.min(...samples.map(s=>s.gap)),max=Math.max(...samples.map(s=>s.gap));
    check('真实连续飞行覆盖玩家前后左右',sectors.size===4);
    check('机尾停留低于四成',rear/samples.length<.4);
    check('伴飞与玩家保持安全且有限距离',min>65&&max<500,`${min}..${max}`);
    check('无敌伴飞不消耗护盾和弹药',samples.every(s=>s.ammo===36&&s.shield===80));
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyD',key:'d',windowsVirtualKeyCode:68});await step(4);
    await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyD',key:'d',windowsVirtualKeyCode:68});
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'ShiftLeft',key:'Shift',windowsVirtualKeyCode:16});await step(3);
    await send('Input.dispatchKeyEvent',{type:'keyUp',code:'ShiftLeft',key:'Shift',windowsVirtualKeyCode:16});await step(15);
    const gap=await evaluate('Math.hypot(__PI.G.player.pos.x-__PI.G.allies[0].pos.x,__PI.G.player.pos.y-__PI.G.allies[0].pos.y,__PI.G.player.pos.z-__PI.G.allies[0].pos.z)');
    check('转向和加力后仍回到环绕伴飞范围',gap>65&&gap<500,String(gap));
    await screenshot('orbit_after_turn_boost');
    report.wingmanOrbit={seconds:60,min,max,rearFraction:rear/samples.length,sectors:[...sectors],gapAfterTurnBoost:gap,samples,
      fixture:'只抬高玩家和僚机至1500/1526m，避免完整环绕航次被地形打断；不修改水平位置、姿态、速度或每帧运动。'};
    await evaluate('__SKY.home();__PI.freeze(true);null');await clickControl('sky-settings');await setCheckbox('sky-wingman',false);await press('Escape');
    assertCleanRuntime(await snap());
  });
}

async function run() {
  // ---- phase 1: defaults ----
  await phase('默认关闭：标题界面无僚机、无请求、无存储', async () => {
    const state = await snap();
    check('标题界面没有僚机', state.wingmanCount === 0 && state.wingman === null);
    check('僚机开关默认关闭且在标题界面禁用', state.ui.wingmanChecked === false && state.ui.wingmanDisabled === true);
    check('AI 开关默认关闭且详情隐藏', state.ui.aiChecked === false && state.ui.aiDetailsHidden === true);
    check('AI 详情控件默认禁用', state.ui.endpointDisabled && state.ui.modelDisabled && state.ui.keyDisabled && state.ui.testDisabled);
    check('AI 状态为关闭', state.aiStatus === 'off');
    assert.equal(stubRequests.length, 0, '默认状态不能发出任何 AI 请求');
    assert.deepEqual(state.storage.local, {}, '默认状态不能写 localStorage');
    assert.deepEqual(state.storage.session, {}, '默认状态不能写 sessionStorage');
    assertCleanRuntime(state);
  });

  await titleSettingsCheck();
  await difficultyCheck();
  await gunPursuitCheck();
  await resourceCycleCheck();
  await wingmanOrbitCheck();
  await wingmanBalanceCheck();

  // ---- phase 2: wingman lifecycle, follow, views ----
  await phase('开启僚机：恰好一架、跟随玩家、三视角标记', async () => {
    await evaluate("__SKY.start('intercept'); __PI.freeze(true); __SKY.sync(); null");
    await until("__PI.G.mode === 'play'", 'intercept run');
    await step(1);
    let state = await snap();
    check('开始战斗后僚机仍默认关闭', state.wingmanCount === 0);
    await pauseGame();
    state = await snap();
    check('暂停后僚机开关可用', state.ui.wingmanDisabled === false);
    await setCheckbox('sky-wingman', true);
    state = await snap();
    check('开启后本局恰好生成一架僚机', state.wingmanCount === 1 && state.wingman);
    check('僚机初始状态为跟随', state.wingman?.state === 'follow');
    await resumeGame();
    await step(2.5);
    state = await snap();
    assert(state.wingman, '僚机不存在');
    assert(Number.isFinite(state.wingman.pos.x) && Number.isFinite(state.wingman.pos.y) && Number.isFinite(state.wingman.pos.z), '僚机位置必须是有限值');
    const distance = Math.hypot(state.wingman.pos.x - state.player.pos.x, state.wingman.pos.y - state.player.pos.y, state.wingman.pos.z - state.player.pos.z);
    check('僚机保持在玩家附近', distance > 20 && distance < 420, `${distance.toFixed(1)}m`);
    check('僚机高度保持在安全线以上', state.wingman.pos.y > 20 + 40);
    check('开启僚机未产生玩家伤害或统计污染', state.allyKills >= 0);
    for (const view of ['chase', 'top', 'cockpit']) {
      await evaluate(`__PI.setView(${JSON.stringify(view)}); __SKY.sync(); null`);
      await sleep(120);
      await screenshot(`desktop_${view}`);
    }
    await evaluate("__PI.setView('chase'); __SKY.sync(); null");
    assertCleanRuntime(await snap());
  });

  // ---- phase 3: AI configuration + connection test ----
  await phase('AI 接入：配置、测试连接成功/失败、Key 不落存储', async () => {
    await pauseGame();
    const endpoint = `${BASE}/v1`;
    await configureAi(endpoint);
    const before = stubRequests.length;
    check('AI 测试按钮在配置后可用', (await snap()).ui.testDisabled === false);
    await evaluate("document.getElementById('sky-ai-test').click(); null");
    await until("document.getElementById('sky-ai-status')?.textContent === '连接成功'", 'successful connection test');
    const request = stubRequests.at(-1);
    assert.equal(stubRequests.length, before + 1, '测试连接必须恰好发出一个请求');
    check('请求打到 /v1/chat/completions', request.path === '/v1/chat/completions');
    check('Authorization 走 Header 且为 Bearer Key', request.authorizationMatched === true && request.authorization === 'Bearer ***');
    check('Key 不出现在 URL 或请求体', request.keyInUrl === false && request.keyInBody === false);
    check('请求体固定 temperature/stream/max_tokens', request.temperature === 0 && request.stream === false && request.maxTokens === 120);
    check('请求体包含 system/user', JSON.stringify(request.roles) === '["system","user"]');
    let state = await snap();
    check('连接成功后状态文本明确', state.ui.statusText === '连接成功' && state.aiStatus === 'ok');
    await screenshot('pause_ai_desktop');
    // failure path
    stubMode = 'http';
    await evaluate("document.getElementById('sky-ai-test').click(); null");
    await until("document.getElementById('sky-ai-status')?.textContent === '连接失败（已回退本地）'", 'failed connection test');
    state = await snap();
    check('连接失败回退本地且状态固定', state.aiStatus === 'error' && state.ui.statusText.includes('回退本地'));
    stubMode = 'success';
    await setInput('sky-ai-key', KEY, 'input'); // clear the failed test text without changing the key
    await evaluate("__SKY.sync(); null");
    assertNoSecretIn(storageJson(await snap()), 'storage after AI tests');
    assertNoSecretIn(await evaluate('document.body.innerHTML'), 'rendered DOM');
    check('页面内存状态不暴露 Key', !(await evaluate(`JSON.stringify(Object.keys(window.__SKY))`)).includes(KEY));
  });

  // ---- phase 4: valid high-level command ----
  await phase('AI 合法命令：高层 intent 生效，本地执行飞行/开火', async () => {
    stubMode = 'success';
    await resumeGame();
    const before = stubRequests.length;
    await step(0.1);
    await waitStubRequests(before + 1, 'first in-run AI request');
    await until("__SKY.aiStatus() === 'ok'", 'AI ok status');
    await until("__PI.G.allies[0]?.command?.source === 'llm'", 'LLM command applied');
    const state = await snap();
    check('僚机接受 cover_player/high', state.wingman?.command?.intent === 'cover_player' && state.wingman?.command?.aggression === 'high');
    check('命令带 12 秒有效期', state.wingman?.command?.active === true);
    check('僚机仍在本地飞行', !!state.wingman && Number.isFinite(state.wingman.pos.x));
    check('LLM 只发一次高层请求', stubRequests.length === before + 1);
    assertCleanRuntime(state);
  });

  // ---- phase 5: invalid / HTTP / network / timeout fallbacks ----
  await phase('AI 失败回退：非法命令、HTTP 错误、断网、超时都不影响本地僚机', async () => {
    for (const [mode, status, label] of [
      ['invalid', 'invalid_response', '非法 intent'],
      ['http', 'http_error', 'HTTP 500'],
      ['close', 'error', '断网'],
    ]) {
      await pauseGame();
      stubMode = mode;
      await restartRun();
      const before = stubRequests.length;
      await step(0.1);
      await waitStubRequests(before + 1, `${label} request`);
      await until(`__SKY.aiStatus() === ${JSON.stringify(status)}`, `${label} status`);
      const state = await snap();
      check(`${label} 后无 LLM 命令`, state.wingman?.command === null);
      check(`${label} 后僚机仍存在`, state.wingmanCount === 1);
      assertCleanRuntime(state);
    }
    await pauseGame();
    stubMode = 'timeout';
    await restartRun();
    const before = stubRequests.length;
    await step(0.1);
    await waitStubRequests(before + 1, 'timeout request');
    await until("__SKY.aiStatus() === 'timeout'", 'timeout status', 20000);
    const state = await snap();
    check('超时后无 LLM 命令', state.wingman?.command === null);
    check('超时后僚机仍在本地飞行', state.wingmanCount === 1);
    check('超时后请求已结束', await evaluate("__SKY.aiStatus() !== 'requesting'"));
    assertCleanRuntime(state);
    stubMode = 'success';
  });

  // ---- phase 6: stale response after pause ----
  await phase('竞态：暂停时取消在途请求，迟到响应不写入命令', async () => {
    await pauseGame();
    stubMode = 'delay';
    await restartRun();
    const before = stubRequests.length;
    await step(0.1);
    await waitStubRequests(before + 1, 'delayed request');
    assert.equal(heldResponses.length, 1, '延迟响应应被 stub 持有');
    const delayed = heldResponses[0];
    await pauseGame();
    check('暂停会取消在途请求', await evaluate("__SKY.aiStatus() === 'idle'"));
    for (let index = 0; !delayed.destroyed && index < 25; index++) await sleep(80);
    check('暂停实际断开 fetch 响应连接', delayed.destroyed && stubRequests.at(-1).clientAborted === true);
    releaseHeld({ intent: 'attack_player_target', aggression: 'high' });
    await sleep(250);
    await step(0.1);
    let state = await snap();
    check('迟到响应不能写入 LLM 命令', state.wingman?.command === null);
    check('迟到的 attack_player_target 未生效', state.wingman?.command?.intent !== 'attack_player_target');
    await resumeGame();
    await step(0.2);
    state = await snap();
    check('恢复后旧响应仍未生效', state.wingman?.command === null);
    stubMode = 'success';
    assertCleanRuntime(state);
  });

  // ---- phase 7: retention and disable ----
  await phase('设置生命周期：重开保留、关闭立即清除、无残留友军子弹', async () => {
    await pauseGame();
    await restartRun();
    let state = await snap();
    check('重开本局保留僚机', state.wingmanCount === 1);
    await pauseGame();
    state = await snap();
    check('重开后僚机设置保持开启', state.ui.wingmanChecked === true);
    check('重开后 AI 设置保持开启', state.ui.aiChecked === true);
    check('重开后端点与模型保留在页面内存', state.ui.endpoint.endsWith('/v1') && state.ui.model === MODEL);
    check('重开后 Key 仍在 password 输入框', state.ui.keyLength === KEY.length);
    // home + free mode also retain the enabled preference
    await evaluate("__SKY.home(); __SKY.sync(); null");
    await until("__PI.G.mode === 'title'", 'home mode');
    check('回主菜单清空僚机', (await snap()).wingmanCount === 0);
    await evaluate("__SKY.start('free'); __PI.freeze(true); __SKY.sync(); null");
    await until("__PI.G.mode === 'play'", 'free run');
    await step(0.5);
    state = await snap();
    check('换模式后僚机偏好仍生效', state.wingmanCount === 1);
    await pauseGame();
    await setCheckbox('sky-wingman', false);
    state = await snap();
    check('关闭僚机立即清空', state.wingmanCount === 0);
    check('关闭僚机清空友军子弹', state.allyBullets === 0);
    const requestsBefore = stubRequests.length;
    await resumeGame();
    await step(2);
    check('无僚机时不再请求 AI', stubRequests.length === requestsBefore);
    await pauseGame();
    await setCheckbox('sky-wingman', true);
    await evaluate("__SKY.sync(); null");
    check('可再次开启僚机', (await snap()).wingmanCount === 1);
    assertCleanRuntime(await snap());
  });

  // ---- phase 8: keyboard isolation inside AI text fields ----
  await phase('键盘：AI 文本框内 Tab 顺序正确，M 不触发游戏快捷键', async () => {
    await evaluate("__SKY.sync(); document.getElementById('sky-ai-endpoint').focus(); null");
    const order = [];
    for (let index = 0; index < 3; index++) {
      await press('Tab');
      order.push(await evaluate('document.activeElement?.id || ""'));
    }
    check('AI 文本框 Tab 顺序为 model → key → test', JSON.stringify(order) === '["sky-ai-model","sky-ai-key","sky-ai-test"]', JSON.stringify(order));
    await evaluate("document.getElementById('sky-ai-endpoint').focus(); null");
    const before = await snap();
    await typeCharacter('KeyM', 'm', 'm');
    const after = await snap();
    check('文本框输入不切换音效', after.sound === before.sound);
    check('文本框输入不改变模式', after.mode === 'paused');
    check('文本输入保留原生编辑结果', after.ui.endpoint === before.ui.endpoint + 'm', after.ui.endpoint);
    await setInput('sky-ai-endpoint', `${BASE}/v1`);
    await evaluate("__SKY.sync(); null");
    assertCleanRuntime(after);
  });

  // ---- phase 9: three viewport screenshots ----
  await phase('三视口证据：桌面三视角已在阶段 2，另拍桌面/竖屏/横屏暂停面板', async () => {
    await evaluate("document.getElementById('sky-ai-settings').scrollIntoView({ block: 'center', behavior: 'instant' }); null");
    await screenshot('pause_ai_desktop_scrolled');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    await evaluate("document.getElementById('sky-ai-settings').scrollIntoView({ block: 'center', behavior: 'instant' }); null");
    await screenshot('pause_ai_portrait');
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    await evaluate("document.getElementById('sky-ai-settings').scrollIntoView({ block: 'center', behavior: 'instant' }); null");
    await screenshot('pause_ai_landscape');
    await evaluate("document.getElementById('sky-ai-test').scrollIntoView({ block: 'center', behavior: 'instant' }); null");
    const button = await evaluate(`(() => {
      const element = document.getElementById('sky-ai-test'), r = element.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        hit: document.elementFromPoint(x, y)?.closest('button')?.id === element.id };
    })()`);
    check('短横屏测试连接按钮可滚动到可视区且可命中', button.visible && button.hit);
    const before = stubRequests.length;
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x, y: button.y, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until("document.getElementById('sky-ai-status')?.textContent === '连接成功'", 'landscape touch connection test');
    check('短横屏原生触屏可测试连接且只发送一次请求', stubRequests.length === before + 1);
    await screenshot('pause_ai_landscape_bottom');
    assertCleanRuntime(await snap());
    check('三视口截图均已生成', report.screenshots.length >= 8);
  });

  // ---- phase 10: reload defaults + secret audit ----
  await phase('刷新回默认：无设置、无 Key、无存储、无请求、无异常', async () => {
    await navigate();
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const state = await snap();
    report.reloadUi = {
      mode: state.mode, wingmanCount: state.wingmanCount,
      wingmanChecked: state.ui.wingmanChecked, wingmanDisabled: state.ui.wingmanDisabled,
      aiChecked: state.ui.aiChecked, aiCheckedType: typeof state.ui.aiChecked,
      aiDetailsHidden: state.ui.aiDetailsHidden, aiStatus: state.aiStatus,
      endpointLength: state.ui.endpoint.length, modelLength: state.ui.model.length, keyLength: state.ui.keyLength,
      statusText: state.ui.statusText,
    };
    check('刷新后回到标题界面', state.mode === 'title');
    check('刷新后僚机默认关闭', state.wingmanCount === 0 && state.ui.wingmanChecked === false);
    check('刷新后 AI 默认关闭', state.ui.aiChecked === false, JSON.stringify(report.reloadUi));
    check('刷新后 AI 详情隐藏', state.ui.aiDetailsHidden === true, JSON.stringify(report.reloadUi));
    check('刷新后 AI 状态为关闭', state.aiStatus === 'off', JSON.stringify(report.reloadUi));
    check('刷新后战斗难度回标准', state.ui.difficulty === 'standard' && /标准.*6\/8\/10/.test(state.ui.difficultySummary));
    check('刷新后输入框清空', state.ui.endpoint === '' && state.ui.model === '' && state.ui.keyLength === 0);
    assert.deepEqual(state.storage.local, {}, '刷新后 localStorage 应为空');
    assert.deepEqual(state.storage.session, {}, '刷新后 sessionStorage 应为空');
    const leaked = allPageEvents.filter(event => pageEventJson(event).includes(KEY));
    check('控制台/页面事件不含 Key', leaked.length === 0);
    check('资源 URL 不含 Key', !(await evaluate('JSON.stringify(performance.getEntriesByType("resource").map(entry => entry.name))')).includes(KEY));
    assertCleanRuntime(state);
    assert.equal(stubRequests.length > 0, true, '验收应至少产生过一次 AI 请求');
  });
}

async function main() {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  report.baseUrl = BASE;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-wingman-chrome-'));
  let stderr = '';
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  chrome.on('error', error => { stderr += error.message; });
  try {
    let port;
    for (let index = 0; index < 150; index++) {
      try {
        port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        if (port) break;
      } catch (error) {}
      if (chrome.exitCode !== null) break;
      await sleep(100);
    }
    assert(port, `Chrome failed to start: ${stderr}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    report.browser = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
      } else if (message.method) { pageEvents.push(message); allPageEvents.push(message); }
    };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method);
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: "window.__unhandled = []; addEventListener('unhandledrejection', event => { window.__unhandled.push(String(event.reason?.message || event.reason || 'unknown')); });",
    });
    await navigate();
    await run();
    report.result = report.phases.every(entry => entry.result === 'PASS') ? 'PASS' : 'FAIL';
  } catch (error) {
    report.error = error.stack;
    report.result = 'FAIL';
    try { report.failureScreenshot = await screenshot('failed'); } catch (error2) {}
  } finally {
    const lastAiStatus = ws?.readyState === WebSocket.OPEN ? await evaluate('window.__SKY?.aiStatus?.() ?? null').catch(() => null) : null;
    if (ws) ws.close();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Chrome acceptance finished')); }
    pending.clear();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill('SIGTERM');
      for (let index = 0; index < 30 && chrome.exitCode === null && chrome.signalCode === null; index++) await sleep(100);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await new Promise(resolve => chrome.once('exit', resolve)); }
    }
    releaseHeld();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    report.runtimeErrors = allPageEvents.filter(event =>
      event.method === 'Runtime.exceptionThrown' ||
      event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error' ||
      event.method === 'Log.entryAdded' && event.params.entry.level === 'error' && event.params.entry.source !== 'network'
    ).map(event => event.method === 'Runtime.exceptionThrown' ? event.params.exceptionDetails?.text : event.method === 'Runtime.consoleAPICalled' ? event.params.args?.map(arg => arg.value || arg.description).join(' ') : event.params.entry.text);
    report.ai = {
      stubRequests: stubRequests.map(request => ({ ...request, userContext: undefined })),
      requestCount: stubRequests.length,
      lastStatus: lastAiStatus,
    };
    report.cleanup = { ownChromeStopped: !chrome || chrome.exitCode !== null || chrome.signalCode !== null, ownProfileDeleted: !profile || !fs.existsSync(profile), ownServerClosed: !server.listening };
    report.finishedAt = new Date().toISOString();
    const serialized = JSON.stringify(report, null, 2) + '\n';
    assert(!serialized.includes(KEY), '验收 JSON 不得包含 API Key');
    const out = path.join(ROOT, 'shots', `${PREFIX}_results.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, serialized);
    console.log(`RESULT ${report.result}: ${out}`);
  }
  if (report.result !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

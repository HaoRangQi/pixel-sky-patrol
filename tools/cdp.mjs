#!/usr/bin/env node
// Minimal Chrome DevTools Protocol driver — no npm dependencies.
// Usage:
//   node tools/cdp.mjs run <url> <scriptFile> [--width=1280] [--height=720] [--wait=3000] [--out=shots/x.png]
// The scriptFile is evaluated in the page (as an async expression body) after load+wait.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [, , cmd, url, scriptPath, ...rest] = process.argv;
const opts = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true];
}));
const W = +(opts.width || 1280), H = +(opts.height || 720);
const DPR = +(opts.dpr || 1);
const WAIT = +(opts.wait || 0);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-chrome-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    'about:blank'
  ];
  const chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', d => { stderr += d.toString(); });

  // wait for devtools endpoint
  let targets = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await r.json();
      if (targets.length) break;
    } catch {}
    await sleep(100);
  }
  if (!targets) { console.error('Chrome did not start.\n' + stderr.slice(-2000)); process.exit(2); }

  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params.type;
        const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        console.log(`[console.${type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[pageerror] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
      }
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await send('Page.navigate', { url });
  // wait for load event
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (events.some(e => e.method === 'Page.loadEventFired')) break;
    await sleep(50);
  }
  if (WAIT) await sleep(WAIT);

  if (opts.click) {
    const target = await send('Runtime.evaluate', {
      expression: `(() => { const b = document.querySelector(${JSON.stringify(opts.click)}); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`,
      returnByValue: true,
    });
    const point = target.result?.value;
    if (!point) {
      ws.close();
      chrome.kill('SIGKILL');
      await sleep(200);
      fs.rmSync(profile, { recursive: true, force: true });
      throw new Error('点击目标不可见或未启用：' + opts.click);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await sleep(150);
  }

  let result;
  if (scriptPath) {
    let expr;
    if (fs.existsSync(scriptPath)) {
      const code = fs.readFileSync(scriptPath, 'utf8');
      expr = `(async()=>{${code}\n})()`;
    } else {
      expr = /return|;|\n/.test(scriptPath) ? `(async()=>{${scriptPath}\n})()` : scriptPath;
    }
    result = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (result.exceptionDetails) {
      console.log('[evalerror] ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    } else {
      const v = result.result?.value;
      console.log('[evalresult] ' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));
    }
  }

  if (opts.out) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, Buffer.from(shot.data, 'base64'));
    console.log('[shot] ' + opts.out);
  }

  ws.close();
  try { chrome.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
main().catch(e => { console.error(e); process.exit(1); });

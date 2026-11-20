// 确认浏览器驱动产生受信任的真实鼠标点击，供全屏/音频验收。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('CDP选择器点击经过浏览器输入通道且具有用户激活', () => {
  const html = '<button id="probe" onclick="window.result={trusted:event.isTrusted,active:navigator.userActivation.isActive}">测试</button>';
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./cdp.mjs', import.meta.url)), 'run', `data:text/html,${encodeURIComponent(html)}`, 'return window.result || null;', '--click=#probe', '--wait=100'], { encoding: 'utf8', timeout: 45000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert(!run.stdout.includes('[evalerror]'), run.stdout);
  assert.match(run.stdout, /"trusted": true/, run.stdout);
  assert.match(run.stdout, /"active": true/, run.stdout);
});

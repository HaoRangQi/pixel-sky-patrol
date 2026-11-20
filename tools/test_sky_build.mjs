// 独立入口必须可构建，且不得覆盖原版或共享引擎。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const hash = name => createHash('sha256').update(read(name)).digest('hex');

test('新版单HTML独立构建，不修改原版入口与共享源码', () => {
  assert(existsSync(`${root}sky-patrol/build.mjs`), '新游戏独立构建入口尚未实现');
  const originals = ['index.html', 'build.mjs', ...readdirSync(`${root}src`).map(f => `src/${f}`)];
  const before = Object.fromEntries(originals.map(f => [f, hash(f)]));
  const build = spawnSync(process.execPath, [`${root}sky-patrol/build.mjs`], { encoding: 'utf8', cwd: '/tmp' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const html = read('sky-patrol/index.html');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>天际巡航/);
  assert.match(html, /id="stage"/);
  assert.match(html, /id="gl"/);
  assert.match(html, /id="ui"/);
  assert.match(html, /SKY PATROL/);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, '游戏应离线内联为单个脚本');
  new vm.Script(scripts[0][1], { filename: 'sky-patrol/index.html' });
  const shared = readdirSync(`${root}src`).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
  let previous = -1;
  for (const file of shared) {
    const position = html.indexOf(`// ===== ${file} =====`);
    assert(position > previous, `${file}必须按原顺序只引入一次`);
    assert.equal(position, html.lastIndexOf(`// ===== ${file} =====`));
    previous = position;
  }
  assert.deepEqual(Object.fromEntries(originals.map(f => [f, hash(f)])), before, '新版构建不得改变原版');
  const first = html;
  const repeat = spawnSync(process.execPath, [`${root}sky-patrol/build.mjs`], { encoding: 'utf8' });
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(read('sky-patrol/index.html'), first, '重复构建必须确定');
});

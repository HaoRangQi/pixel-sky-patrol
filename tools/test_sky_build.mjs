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
  for (const file of ['25_lake_world.js', '35_autumn_pixels.js', '36_autumn_forest.js', '37_player_airframe.js', '38_defense_airframes.js', '54_cockpit.js', '66_difficulty.js']) {
    assert(html.includes(`// ===== ${file} =====`), `${file}必须只在新版入口接入`);
  }
  for (const shader of ['SCENE_FS', 'CLOUD_FS', 'POST_FS', 'MESH_VS', 'MESH_FS']) {
    assert.match(html, new RegExp(`let ${shader} =`), `${shader}需在新版独立构建产物中可覆盖`);
  }
  assert.match(html, /const SUN_AZ = 0\.12;/, '新版夕照应落在正后镜头的画面右侧');
  assert(html.indexOf('// ===== 50_ui_hud.js =====') < html.indexOf('// ===== 54_cockpit.js ====='));
  assert(html.indexOf('// ===== 54_cockpit.js =====') < html.indexOf('// ===== 60_main.js ====='));
  assert.match(html, /const SUN_EL = 0\.12;/, '新版低角度夕阳应留在开阔追尾构图内');
  assert.match(html, /G\.player\.pos\.y = Math\.max\(G\.map\.heightAt\(G\.player\.pos\.x, G\.player\.pos\.z\) \+ 250, 320\);/);
  assert.match(html, /const targetAlt = Math\.max\(gh \+ 250, 320\);/);
  assert(html.indexOf('// ===== 20_world.js =====') < html.indexOf('// ===== 25_lake_world.js ====='));
  assert(html.indexOf('// ===== 30_shaders.js =====') < html.indexOf('// ===== 35_autumn_pixels.js ====='));
  assert(html.indexOf('// ===== 33_forest.js =====') < html.indexOf('// ===== 36_autumn_forest.js ====='));
  assert(html.indexOf('// ===== 32_meshes.js =====') < html.indexOf('// ===== 37_player_airframe.js ====='));
  assert(html.indexOf('// ===== 37_player_airframe.js =====') < html.indexOf('// ===== 38_defense_airframes.js ====='));
  assert(html.indexOf('// ===== 38_defense_airframes.js =====') < html.indexOf('// ===== 40_game.js ====='));
  assert(html.indexOf('// ===== 35_autumn_pixels.js =====') < html.indexOf('// ===== 60_main.js ====='));
  assert(html.indexOf('// ===== 65_app.js =====') < html.indexOf('// ===== 66_difficulty.js ====='));
  assert.deepEqual(Object.fromEntries(originals.map(f => [f, hash(f)])), before, '新版构建不得改变原版');
  const first = html;
  const repeat = spawnSync(process.execPath, [`${root}sky-patrol/build.mjs`], { encoding: 'utf8' });
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(read('sky-patrol/index.html'), first, '重复构建必须确定');
});

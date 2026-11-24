#!/usr/bin/env node
// 复用共享引擎，独立生成新版入口，不覆盖原版。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const engine = fs.readdirSync(path.join(root, 'src')).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
const parts = [{ name: '00_shell.html', directory: here }];
function replaceSource(content, before, after) {
  const first = content.indexOf(before);
  if (first < 0 || first !== content.lastIndexOf(before)) throw new Error(`新版适配点已变化：${before}`);
  return content.replace(before, after);
}
for (const name of engine) {
  if (name.startsWith('60_')) parts.push({ name: '54_cockpit.js', directory: here }, { name: '55_ui.js', directory: here });
  parts.push({ name, directory: path.join(root, 'src') });
  if (name === '20_world.js') parts.push({ name: '25_lake_world.js', directory: here });
  if (name === '30_shaders.js') parts.push({ name: '35_autumn_pixels.js', directory: here });
  if (name === '32_meshes.js') parts.push({ name: '37_player_airframe.js', directory: here }, { name: '38_defense_airframes.js', directory: here });
  if (name === '33_forest.js') parts.push({ name: '36_autumn_forest.js', directory: here });
}
parts.push({ name: '64_scene.js', directory: here }, { name: '65_app.js', directory: here },
  { name: '66_difficulty.js', directory: here }, { name: '99_tail.html', directory: path.join(root, 'src') });
let html = '';
for (const { name, directory } of parts) {
  let content = fs.readFileSync(path.join(directory, name), 'utf8');
  if (name === '10_core.js') {
    const originalAzimuth = 'const SUN_AZ = -0.62;               // light azimuth (radians, x/z); the sun itself stays hidden';
    const autumnAzimuth = 'const SUN_AZ = 0.12;                // 夕阳位于湖谷起始航线右侧';
    if (!content.includes(originalAzimuth)) throw new Error('新版夕照方向需要明确映射到原引擎光照方向');
    content = content.replace(originalAzimuth, autumnAzimuth);
    const originalElevation = 'const SUN_EL = 0.30;';
    if (!content.includes(originalElevation)) throw new Error('新版夕阳高度需要明确映射到原引擎光照方向');
    content = content.replace(originalElevation, 'const SUN_EL = 0.12;');
  }
  if (name === '30_shaders.js') {
    const shaders = /^const (SCENE_FS|CLOUD_FS|POST_FS|MESH_VS|MESH_FS) =/gm;
    if ([...content.matchAll(shaders)].length !== 5) throw new Error('新版场景与实例树 shader 接口已变化');
    content = content.replace(shaders, 'let $1 =');
  }
  if (name === '40_game.js') {
    const titleAltitude = [
      ['G.player.pos.y = Math.max(G.map.heightAt(G.player.pos.x, G.player.pos.z) + 320, 520);',
        'G.player.pos.y = Math.max(G.map.heightAt(G.player.pos.x, G.player.pos.z) + 250, 320);'],
      ['const targetAlt = Math.max(gh + 320, 520);', 'const targetAlt = Math.max(gh + 250, 320);'],
    ];
    for (const [before, after] of titleAltitude) content = replaceSource(content, before, after);
    content = replaceSource(content,
      'vmul(b.up, 0.235)), vmul(b.fwd, -2.675))',
      'vmul(b.up, 0)), vmul(b.fwd, -SKY_WING_TRAIL_REAR))');
  }
  if (name === '60_main.js') {
    content = replaceSource(content, '    for (let i = 0; i < Math.min(4, p.missiles); i++) {',
      '    for (let i = 0; !G.skyScenic && G.mode !== \'title\' && i < Math.min(4, p.missiles); i++) {');
  }
  html += name.endsWith('.html') ? content : `\n// ===== ${name} =====\n${content}\n`;
}
fs.writeFileSync(path.join(here, 'index.html'), html);
console.log(`built sky-patrol/index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

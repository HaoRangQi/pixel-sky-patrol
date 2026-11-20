#!/usr/bin/env node
// 复用共享引擎，独立生成新版入口，不覆盖原版。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const engine = fs.readdirSync(path.join(root, 'src')).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
const parts = [{ name: '00_shell.html', directory: here }];
for (const name of engine) {
  if (name.startsWith('60_')) parts.push({ name: '55_ui.js', directory: here });
  parts.push({ name, directory: path.join(root, 'src') });
}
parts.push({ name: '64_scene.js', directory: here }, { name: '65_app.js', directory: here }, { name: '99_tail.html', directory: path.join(root, 'src') });
let html = '';
for (const { name, directory } of parts) {
  const content = fs.readFileSync(path.join(directory, name), 'utf8');
  html += name.endsWith('.html') ? content : `\n// ===== ${name} =====\n${content}\n`;
}
fs.writeFileSync(path.join(here, 'index.html'), html);
console.log(`built sky-patrol/index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

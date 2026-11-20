#!/usr/bin/env node
// Concatenate src parts into a single self-contained index.html.
import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const parts = fs.readdirSync(path.join(root, 'src')).filter(f => /^\d\d_/.test(f)).sort();
let html = '';
for (const f of parts) {
  const content = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  if (f.endsWith('.html')) html += content;
  else html += `\n// ===== ${f} =====\n` + content + '\n';
}
fs.writeFileSync(path.join(root, 'index.html'), html);
const bytes = fs.statSync(path.join(root, 'index.html')).size;
console.log(`built index.html (${parts.join(', ')}) ${(bytes / 1024).toFixed(1)} KB`);

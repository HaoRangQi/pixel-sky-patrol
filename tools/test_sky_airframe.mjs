import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const model = 'sky-patrol/37_player_airframe.js';
const adapter = existsSync(new URL(`../${model}`, import.meta.url)) ? read(model) : '';
const shared = ['src/10_core.js', 'src/32_meshes.js', 'src/42_combat.js'].map(read).join('\n');
function runtime(source) {
  return vm.runInNewContext(`${shared}\n${source}\n({meshes:buildMeshes(),
    rails:[0,1,2,3].map(i=>wingRailPosition({pos:v3(),renderBasis:basisFrom(0,0,0)},i)),
    tip:typeof SKY_WING_TRAIL_REAR==='number'? SKY_WING_TRAIL_REAR : 1.30})`, {
    document: { getElementById: () => ({ getContext: () => ({}) }) },
    window: { addEventListener() {} },
    Renderer: { createMesh: data => data },
  });
}
const base = runtime('');
const { meshes, rails, tip } = runtime(adapter);
const player = meshes.player;

// 在提交给 GPU 的真实三角面上取可见表面，不靠零件名或 AABB 说飞机长什么样。
function surface(mesh, u, v, [i, j, d] = [0, 2, 1], sign = 1) {
  const p = mesh.pos;
  let hit;
  for (let k = 0; k < p.length; k += 9) {
    const a = p[k + 3 + i] - p[k + i], b = p[k + 6 + i] - p[k + i];
    const c = p[k + 3 + j] - p[k + j], e = p[k + 6 + j] - p[k + j];
    const du = u - p[k + i], dv = v - p[k + j], det = a * e - b * c;
    if (Math.abs(det) < 1e-8) continue;
    const t = (du * e - dv * b) / det, s = (dv * a - du * c) / det;
    if (t < -1e-7 || s < -1e-7 || t + s > 1 + 1e-7) continue;
    const z = p[k + d] * (1 - s - t) + p[k + 3 + d] * t + p[k + 6 + d] * s;
    if (!hit || sign * z > sign * hit.z) hit = { z, rgb: mesh.col.slice(k, k + 3), emission: mesh.emi[k / 3] };
  }
  return hit;
}
const viewDown = (x, z) => surface(player, x, z);

test('俯视有宽的后掠主翼、明确的尾翼缺口，翼线起点落在两侧外缘', () => {
  for (const side of [-1, 1]) {
    assert(viewDown(side * 3.6, 0.60), '旧机翼在半翼展恢复到这个宽度以前已收成一条窄翼');
    assert(!viewDown(side * 3.0, 2.55), '主翼与水平尾翼之间必须切出真实缺口');
    assert(viewDown(side * 2.68, 3.70), '水平尾翼应伸出两个机舱之外');
    assert(player.pos.some((x, i) => i % 3 === 0 && x === side * 4.90 && player.pos[i + 1] === 0 && player.pos[i + 2] === tip),
      '尾迹所用坐标必须是模型上实际的最外后缘顶点');
  }
});

test('从实际机背看得到深色尖鼻、突起金窗、浅灰翼板和暖冷色饰边', () => {
  const nose = viewDown(0, -6.2);
  assert(nose && nose.rgb[2] > nose.rgb[0] && nose.rgb[2] < .34, '机鼻应该以连到尖端的深蓝灰实体成形');
  const glass = viewDown(.28, -3.10);
  assert(glass && glass.z > .65 && glass.rgb[0] > .68 && glass.rgb[0] > glass.rgb[2] * 1.32, '金色窗须在机体上有高度并分占前段');
  for (const side of [-1, 1]) {
    const caps = [];
    for (let x = 3.62; x <= 4.88; x += .065) for (let z = .42; z <= 1.59; z += .065) {
      const hit = viewDown(side * x, z);
      if (hit) caps.push(hit.rgb);
    }
    assert(caps.some(([r, g, b]) => r > .66 && g < r * .72 && b < r * .65), '翼尖要有暖红橙条带');
    assert(caps.some(([r, g, b]) => r < g * .85 && b > r * 1.13), '翼尖要有低饱和青色末端');
    assert(caps.some(([r, g, b]) => r > .59 && g > .59 && b > .59 && Math.max(r, g, b) - Math.min(r, g, b) < .095), '翼板不能仅是蓝黑迷彩');
  }
});

test('正上方能读出成片的浅银副翼，识别块不是两边各盖一个相同的叉', () => {
  const silver = ({rgb}) => Math.min(...rgb) > .68 && Math.max(...rgb) - Math.min(...rgb) < .16;
  for (const side of [-1, 1]) for (const x of [2.45, 3.55]) {
    const wing = [];
    for (let z = -1.70; z < 2.25; z += .04) {
      const hit = viewDown(side*x, z);
      if (hit) wing.push(hit);
    }
    const area = wing.filter(silver).length / wing.length;
    assert(area > .32 && area < .68, `${side*x} 米处的浅翼板只占翼弦 ${area.toFixed(2)}，不能只是细后缘`);
  }
  let marks = 0;
  for (let x = 3.2; x < 4.14; x += .055) for (let z = .48; z < 1.76; z += .055) {
    const a = viewDown(-x, z), b = viewDown(x, z);
    if (a && b && a.rgb[0] > a.rgb[2] + .14 && a.rgb[0] > b.rgb[0] + .07) marks++;
  }
  assert(marks >= 12, `翼面上没有能从上方辨认的非对称暖浅色识别块：${marks}`);
});

test('从正上方能辨别左右长检修盖、接缝、后舱盖与收暗的喷口金属环', () => {
  const value = hit => hit.rgb[0]*.21 + hit.rgb[1]*.72 + hit.rgb[2]*.07;
  for (const side of [-1, 1]) {
    const [fore, seam, aft, nozzle] = [.45, 1.39, 2.58, 4.09].map(z => viewDown(side*1.25, z));
    assert([fore, seam, aft, nozzle].every(hit => hit && hit.z > .3), '检修面不能悬在实际机舱旁边');
    assert(value(fore) > value(aft) + .10 && value(aft) > value(seam) + .09,
      `发动机从前段经接缝到后段仍是一块平板：${[fore, seam, aft].map(hit => value(hit).toFixed(2))}`);
    assert(value(nozzle) < .49 && value(nozzle) + .17 < value(fore), '喷口前的收口须从机顶就能读成暗金属');
  }
  const spine = viewDown(0, 2.6), shoulder = viewDown(.57, 2.6);
  assert(spine.z > shoulder.z + .025 && Math.abs(value(spine)-value(shoulder)) > .08, '座舱后方的中脊不能整宽刷成同一块板');
});

test('左右排气口和现有四个挂点分别有实体边框，不改变接口坐标', () => {
  for (const side of [-1, 1]) {
    const warm = (x, y) => surface(player, x, y, [0, 1, 2]);
    const hot = warm(side * 1.25, 0), lip = warm(side * 1.25, .35);
    assert(hot && hot.z >= 4.05 && hot.z <= 4.30 && hot.emission > .2 && hot.rgb[0] > hot.rgb[2] * 1.25,
      '尾焰锚点应落在独立且稍向内凹的暖色喷口');
    assert(lip && lip.z >= hot.z + .035 && lip.emission === 0 && lip.rgb.every(c => c < .46),
      '从机后看，暖芯外必须有更靠后的哑光金属暗唇');
    const fin = viewDown(side * 1.74, 3.22);
    assert(fin && fin.z > 1.60, '各喷口的上方应有独立抬高的垂尾');
  }
  assert.deepEqual(JSON.stringify(rails), JSON.stringify(base.rails));
  for (const { x, y, z } of rails) {
    const pylon = surface(player, x, z + .55, [0, 2, 1], -1);
    assert(pylon && pylon.z < y + .18 && pylon.z > y - .06, `挂点附近没有相连的短挂架：${x},${y},${z}`);
  }
});

test('新版只替换原有玩家网格槽位，保留其他网格且无退化三角面', () => {
  assert.deepEqual(Object.keys(meshes), Object.keys(base.meshes));
  for (const name of Object.keys(meshes).filter(name => name !== 'player')) {
    assert.equal(JSON.stringify(meshes[name]), JSON.stringify(base.meshes[name]), `${name} 不应由玩家改款受影响`);
  }
  assert(player.pos.length / 9 <= 700, '保持单份轻量静态网格');
  for (let i = 0; i < player.pos.length; i += 9) {
    assert(Math.abs(Math.hypot(...player.nor.slice(i, i + 3)) - 1) < 1e-6, `第 ${i / 9} 个三角面法线退化`);
  }
});

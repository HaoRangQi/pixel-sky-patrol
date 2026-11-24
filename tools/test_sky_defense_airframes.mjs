import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src/60_main.js');
const collect = main.slice(main.indexOf('function collectDrawables()'), main.indexOf('function drawUIFrame()'));
const source = ['src/10_core.js', 'src/32_meshes.js', 'sky-patrol/38_defense_airframes.js'].map(read).concat(collect).join('\n');
const G = { camera: { pos: { x: 0, y: 0, z: 0 } }, enemies: [], ground: [], missiles: [] };
const { meshes, drawables, basisFrom } = vm.runInNewContext(`${source}\n({meshes:buildMeshes(),
  drawables:collectDrawables, basisFrom})`, {
  G, Renderer: { createMesh: mesh => mesh },
  document: { getElementById: () => ({ getContext: () => ({}) }) },
  window: { addEventListener() {} },
});
G.meshes = meshes;

function extents(mesh, axis) {
  const values = mesh.pos.filter((_, i) => i % 3 === axis);
  return [Math.min(...values), Math.max(...values)];
}
function surface(mesh, u, v, [i, j, d], direction = 1) {
  let hit;
  const p = mesh.pos;
  for (let k = 0; k < p.length; k += 9) {
    const a = p[k+3+i]-p[k+i], b = p[k+6+i]-p[k+i];
    const c = p[k+3+j]-p[k+j], e = p[k+6+j]-p[k+j];
    const x = u-p[k+i], y = v-p[k+j], det = a*e-b*c;
    if (Math.abs(det) < 1e-8) continue;
    const t = (x*e-y*b)/det, s = (y*a-x*c)/det;
    if (s < -1e-7 || t < -1e-7 || s+t > 1+1e-7) continue;
    const depth = p[k+d]*(1-s-t) + p[k+3+d]*t + p[k+6+d]*s;
    if (!hit || direction*depth > direction*hit.depth) hit = { depth, color: mesh.col.slice(k, k+3) };
  }
  return hit;
}
const top = (mesh, x, z) => surface(mesh, x, z, [0, 2, 1]);

test('运输机有钝鼻、宽直翼、四个发动机和内凹货舱，防御无人机没有垂尾', () => {
  const transport = meshes.transport, drone = meshes.defenseDrone;
  assert(transport && drone);
  const [left, right] = extents(transport, 0);
  assert(right-left >= 46 && right-left <= 50);
  assert(top(transport, 1.45, -21), '大宽体驾驶舱轮廓');
  const cargo = surface(transport, 0, -1, [0, 1, 2]);
  const frame = surface(transport, 2.56, -1, [0, 1, 2]);
  assert(frame.depth > cargo.depth + 1 && Math.max(...cargo.color) < .38, '机尾货舱有暗色深度和外框');
  for (const side of [-1, 1]) {
    assert(top(transport, side*22, -3) && top(transport, side*22, 1.8), '运输机外翼仍有宽弦');
    for (const x of [8, 15]) {
      const intake = surface(transport, side*x, .25, [0, 1, 2], -1);
      assert(intake && intake.depth < -8 && !surface(transport, side*(x+2.4), .25, [0, 1, 2], -1),
        '四个低于翼面的发动机短舱彼此独立');
    }
    assert(top(drone, side*9.8, 2) && !top(drone, side*8, -3), '飞翼的外缘明显后掠');
  }
  assert(extents(drone, 1)[1] < 1.9, '防御无人机是没有垂尾的低矮飞翼');
});

test('降落伞是连到装甲车顶的暖浅色分区伞面，新增网格轻量且无退化面', () => {
  const chute = meshes.parachute;
  assert(chute);
  const [base, crown] = extents(chute, 1);
  assert(base > 1.1 && base < 2.5 && crown >= 14 && crown <= 18);
  assert(extents(chute, 0)[1] >= 6);
  const fabric = top(chute, 2, 0);
  assert(fabric.depth > 12 && fabric.color[0] > fabric.color[2] && fabric.color[0] > .75);
  for (const mesh of [meshes.transport, meshes.defenseDrone, chute]) {
    assert(mesh.pos.length / 9 <= 700);
    for (let i = 0; i < mesh.nor.length; i += 9) {
      assert(Math.abs(Math.hypot(...mesh.nor.slice(i, i+3))-1) < 1e-6);
    }
  }
});

test('防御敌种使用各自网格，降落伞随装甲车并在落地时消失，旧无人机保持原网格和比例', () => {
  assert(meshes.transport && meshes.defenseDrone && meshes.parachute);
  const pos = { x: 20, y: 25, z: -30 }, basis = basisFrom(.8, .4, -.2);
  G.defenseStage = {};
  G.enemies = ['drone', 'fighter', 'transport'].map(kind => ({ kind, pos, basis }));
  const armor = { type: 'vehicle', pos, yaw: 1.2, airdrop: { groundY: 10 } };
  G.ground = [armor];
  const [drone, fighter, transport, vehicle, chute] = drawables();
  assert.equal(drone.mesh, meshes.defenseDrone);
  assert.equal(fighter.mesh, meshes.drone);
  assert.equal(transport.mesh, meshes.transport);
  assert.equal(vehicle.mesh, meshes.vehicle);
  assert.equal(chute.mesh, meshes.parachute);
  assert.deepEqual(chute.matrix, vehicle.matrix);
  assert(Math.abs(Math.hypot(...transport.matrix.slice(0, 3))-1) < 1e-6);
  delete armor.airdrop;
  assert(!drawables().some(item => item.mesh === meshes.parachute));
  G.defenseStage = null;
  G.enemies.length = 1;
  const [legacy] = drawables();
  assert.equal(legacy.mesh, meshes.drone);
  assert.deepEqual(legacy.matrix, fighter.matrix);
});

test('僚机绘制使用有限的 RGB 三通道色值，沿用玩家网格且不改变实体位置', () => {
  G.enemies = []; G.ground = [];
  const pos = { x: 40, y: 80, z: -60 }, basis = basisFrom(.3, .1, -.2);
  G.allies = [{ pos, basis, renderBasis: basis }];
  const [wingman] = drawables();
  assert.equal(wingman.mesh, meshes.player);
  assert(Array.isArray(wingman.tint), 'Renderer 需要 RGB 数组，不能接收 CSS 色值字符串');
  assert.equal(wingman.tint.length, 3);
  assert(wingman.tint.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.deepEqual(Array.from(wingman.tint), [159 / 255, 230 / 255, 200 / 255]);
  assert.deepEqual(Array.from(wingman.matrix.slice(12, 15)), [pos.x, pos.y, pos.z]);
});

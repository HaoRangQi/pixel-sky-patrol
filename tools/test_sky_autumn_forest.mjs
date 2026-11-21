#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const WORLD_SIZE = 8192;
const adapterURL = new URL('../sky-patrol/36_autumn_forest.js', import.meta.url);
const adapter = existsSync(adapterURL) ? readFileSync(adapterURL, 'utf8') : '';
const forest = readFileSync(new URL('../src/33_forest.js', import.meta.url), 'utf8');
const meshSource = readFileSync(new URL('../src/32_meshes.js', import.meta.url), 'utf8');
const meshes = { pineTree: { name: 'pine' }, autumnTree: { name: 'autumn' }, player: { name: 'aircraft' } };
const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const view = { height: 640, aspect: 1.8, top: true };
const camera = (x = 4096, z = 4096) => ({ pos: { x, y: 2100, z }, right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: -1 }, fwd: { x: 0, y: -1, z: 0 }, fov: 1.2, aspect: 1.8 });
const count = batches => batches.reduce((sum, batch) => sum + batch.instanceCount, 0);
const autumnCount = batches => batches.find(batch => batch.mesh === meshes.autumnTree)?.instanceCount || 0;
const rows = batches => batches.flatMap(batch => Array.from({ length: batch.instanceCount }, (_, i) => ({
  kind: batch.mesh === meshes.autumnTree ? 'autumn' : 'pine', values: Array.from(batch.instances.subarray(i * 8, i * 8 + 8)),
})));
const key = row => row.values.slice(0, 7).join('/');
const byIdentity = batches => new Map(rows(batches).map(row => [key(row), row]));
const batch = (mesh, values) => ({ mesh, instances: new Float32Array(values), instanceCount: values.length / 8,
  matrix: identity, outline: false, rim: false, dist: 0 });
const instance = (x, z, i = 0) => [x, 180, z, 0.8 + (i % 40) * 0.01, Math.cos(i), Math.sin(i), 0.9 + (i % 20) * 0.01, 0.82 + (i % 28) * 0.01];

function runtime({ source, context = {} } = {}) {
  const sandbox = vm.createContext({ Math, Float32Array, Uint8Array, WORLD_SIZE, TAU: Math.PI * 2,
    SUN_DIR: { x: -0.55, y: 0.3, z: -0.78 }, ...context });
  vm.runInContext(meshSource + '\n' + (source || forest) + '\nglobalThis.originalCollect = Forest.collect;\n' + adapter + '\nglobalThis.subject = Forest;', sandbox);
  return sandbox;
}
function synthetic(pine, autumn = [], options = {}) {
  return runtime({ source: 'const Forest = { collect(camera, player, meshes, view) { return makeBatches.call(this, camera, player, meshes, view); } };',
    context: { makeBatches: () => [batch(meshes.pineTree, pine), batch(meshes.autumnTree, autumn)], ...options } });
}
function collect(subject, cam = camera()) { return subject.collect(cam, { pos: { x: cam.pos.x, y: 400, z: cam.pos.z } }, meshes, view); }
let real;
function actual() {
  if (!real) {
    real = runtime();
    const N = 64, calls = { height: 0, forest: 0, slope: 0 };
    real.map = { N, heights: new Float32Array(N * N).fill(180), calls,
      heightAt() { calls.height++; return 180; }, forestAt() { calls.forest++; return 1; }, slopeAt() { calls.slope++; return 0; } };
    real.subject.init(real.map, 1337);
  }
  return real;
}

// 水平截面来自最终提交 GPU 的三角形，不依靠模型名称或声明的 crownRadius。
function slice(mesh, y, angle = 0) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < mesh.pos.length; i += 9) for (let e = 0; e < 3; e++) {
    const a = i + e * 3, b = i + ((e + 1) % 3) * 3, v = mesh.pos;
    if ((v[a + 1] > y) === (v[b + 1] > y)) continue;
    const t = (y - v[a + 1]) / (v[b + 1] - v[a + 1]);
    const x = v[a] + (v[b] - v[a]) * t, z = v[a + 2] + (v[b + 2] - v[a + 2]) * t;
    const lateral = x * Math.cos(angle) + z * Math.sin(angle);
    min = Math.min(min, lateral); max = Math.max(max, lateral);
  }
  return { width: max - min, center: (max + min) * 0.5 };
}

test('低飞要能看见站在地上的树干、松树裙边之间的缺口和略偏心的宽阔叶冠', () => {
  const context = runtime({ context: { Renderer: { createMesh: mesh => mesh }, clamp01: x => Math.min(1, Math.max(0, x)) } });
  const { pineTree: pine, autumnTree: leaf } = vm.runInContext('buildMeshes()', context);
  const trunk = [pine, leaf].map(m => slice(m, 3.2).width);
  assert(trunk.every(w => w >= 2.2 && w <= 4.5), `两种树在近景都应有占据数像素的独立树干，实际宽 ${trunk}`);
  const skirt = [6.5, 9.2, 12.2, 16.1, 19.2, 22.2, 25.4].map(y => slice(pine, y).width);
  assert(skirt[0] > 18 && skirt[1] < skirt[0] * 0.64 && skirt[2] > skirt[1] * 1.35 && skirt[4] > skirt[3] * 1.25 && skirt[6] > skirt[5] * 1.22,
    `沿松树轮廓至少应有三道清晰的伸枝与收腰：${skirt}`);
  assert(slice(leaf, 5.7).width < 8 && slice(leaf, 14).width > 21 && slice(leaf, 22).width > 12,
    '低处空出分叉树干，中上部保持宽圆冠体，不是锥尖或贴地树球');
  assert(Math.abs(slice(leaf, 22).center - slice(leaf, 14).center) > 1.1, '主冠与侧冠不能沿着一根轴对称堆叠');
  for (let y = 3.25; y < 35.5; y += 0.25) assert(slice(pine, y).width > 0, `松树轮廓在 ${y} 米断开，上方枝裙浮空`);
  assert(pine.pos.length / 9 <= 100 && leaf.pos.length / 9 <= 160, '树形细节不能靠堆高每株三角面数获得');
  assert(leaf.emi.some(v => v === -1) && leaf.emi.some(v => v === 0), '只有阔叶冠随群落染秋色');
  assert(pine.emi.includes(-2) && pine.emi.every(v => v === -2 || v === 0) && pine.emi.includes(0), '针叶上表面应另标为常青细簇，树干与枝底不加叶纹');
});

test('俯视能看出不同方向伸出的冠团，而不是一个凸多边形宝石', t => {
  const leaf = vm.runInContext('buildAutumnTree()', runtime());
  const a = leaf.pos, outline = [], step = Math.PI / 90;
  // 沿地面射线求与全部真实叶面投影的最远交点，统计轮廓的凹口，不把树干算作叶团。
  for (let k = 0; k < 180; k++) {
    const dx = Math.cos(k * step), dz = Math.sin(k * step);
    let radius = 0;
    for (let i = 0; i < a.length; i += 9) if (leaf.emi[i/3] < 0) for (let j = 0; j < 3; j++) {
      const m = i + 3*j, n = i + 3*((j+1)%3), ex = a[n]-a[m], ez = a[n+2]-a[m+2];
      const det = dx*ez-dz*ex, along = (a[m]*ez-a[m+2]*ex)/det, edge = (a[m]*dz-a[m+2]*dx)/det;
      if (edge >= 0 && edge <= 1) radius = Math.max(radius, along);
    }
    outline.push(radius);
  }
  const valleys = outline.map((r,i) => Math.min(outline[(i+170)%180],outline[(i+10)%180])*Math.cos(10*step)-r);
  const gaps = valleys.filter((d,i) => d > 0.8 && d >= valleys[(i+179)%180] && d > valleys[(i+1)%180]);
  t.diagnostic(`实际俯视叶缘：${gaps.length}个凹口，最深${Math.max(...valleys).toFixed(2)}米`);
  assert(gaps.length >= 3 && Math.max(...valleys) > 1.3, '冠缘须有至少三个错开的缺口，不应由一个凸壳包住所有侧冠');
});

// Exercise the real cached/culling path, not a replacement tree generator.
test('autumn adapter exists and promotes a substantial fraction of real pine instances', () => {
  assert.ok(existsSync(adapterURL), 'missing sky-patrol/36_autumn_forest.js implementation');
  const { subject, originalCollect } = actual();
  let total = 0, autumn = 0, originalAutumn = 0;
  for (const [x, z] of [[4096, 4096], [2048, 2048], [6144, 2048], [2048, 6144]]) {
    const cam = camera(x, z), before = collect({ collect: originalCollect }, cam), after = collect(subject, cam);
    assert.equal(count(after), count(before));
    assert.ok(count(after) > 6000, 'keep the original substantial visible forest budget');
    total += count(after); autumn += autumnCount(after); originalAutumn += autumnCount(before);
  }
  const ratio = autumn / total;
  assert.ok(ratio > 0.4 && ratio < 0.75, `mixed autumn groves must occupy 40–75%, got ${(ratio * 100).toFixed(1)}%`);
  assert.ok(autumn - originalAutumn > total * 0.2, 'switch actual mesh species, not only tint or brightness');
});

test('regrouping preserves every real tree, 8 floats, world position, metre scale, unit yaw, and draw flags', () => {
  const { subject, originalCollect, map } = actual();
  const cam = camera(), before = collect({ collect: originalCollect }, cam), calls = { ...map.calls };
  const after = collect(subject, cam), previous = byIdentity(before), current = byIdentity(after);
  assert.equal(count(after), count(before));
  assert.equal(current.size, previous.size, 'never drop or duplicate tree identities');
  let promoted = 0;
  for (const [id, row] of current) {
    const old = previous.get(id);
    assert.ok(old, `position/scale/yaw/width changed for ${id}`);
    if (old.kind === 'autumn') assert.equal(row.kind, 'autumn', 'existing autumn trees stay autumn');
    if (old.kind === 'pine' && row.kind === 'autumn') promoted++;
    assert.deepEqual(row.values, old.values, 'regrouping preserves all 8 floats, including natural brightness');
    assert.ok(Math.abs(row.values[4] ** 2 + row.values[5] ** 2 - 1) < 1e-5);
    assert.ok(row.values[7] >= 0.8 && row.values[7] <= 1.11, 'do not wash crowns white');
  }
  assert.ok(promoted > 1000, 'must really move pines into the existing autumn mesh batch');
  assert.deepEqual(map.calls, calls, 'collect must not resample terrain or create new tree positions');
  assert.equal(after.length, 2, 'at most one draw batch per existing species');
  for (const b of after) {
    assert.ok(b.mesh === meshes.pineTree || b.mesh === meshes.autumnTree, 'reuse the uploaded meshes');
    assert.ok(b.instances instanceof Float32Array);
    assert.equal(b.instances.length, b.instanceCount * 8);
    assert.deepEqual(Array.from(b.matrix), Array.from(identity));
    assert.equal(b.outline, false); assert.equal(b.rim, false); assert.equal(b.dist, 0);
  }
});

test('species form contiguous groves rather than independent random tree speckles', () => {
  const n = 64, pine = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) pine.push(...instance((x + 0.5) * 128, (z + 0.5) * 128, z * n + x));
  const { subject } = synthetic(pine), output = collect(subject), kinds = new Map();
  for (const row of rows(output)) kinds.set(`${row.values[0]}/${row.values[2]}`, row.kind);
  const ratio = autumnCount(output) / count(output);
  assert.ok(ratio > 0.25 && ratio < 0.7, `promote some, not all pines: ${ratio}`);
  let same = 0, neighbors = 0;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const kind = kinds.get(`${(x + 0.5) * 128}/${(z + 0.5) * 128}`);
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (kind === kinds.get(`${((x + dx) % n + 0.5) * 128}/${((z + dz) % n + 0.5) * 128}`)) same++;
      neighbors++;
    }
  }
  const randomAgreement = ratio ** 2 + (1 - ratio) ** 2;
  assert.ok(same / neighbors > 0.78 && same / neighbors > randomAgreement + 0.2,
    `nearby trees must cluster above independent assignment: ${same / neighbors} vs ${randomAgreement}`);
});

test('groves cross grid boundaries and the world seam continuously', () => {
  const pine = [];
  for (let line = 0; line < WORLD_SIZE; line += 256) for (let p = 64; p < WORLD_SIZE; p += 256) {
    pine.push(...instance(line - 0.25, p), ...instance(line + 0.25, p));
    pine.push(...instance(p, line - 0.25), ...instance(p, line + 0.25));
  }
  const output = collect(synthetic(pine).subject), kinds = new Map(rows(output).map(row => [`${row.values[0]}/${row.values[2]}`, row.kind]));
  assert.ok(autumnCount(output) > 500, 'continuity cannot pass by leaving every tree pine');
  let same = 0, pairs = 0;
  for (let i = 0; i < pine.length; i += 16) {
    if (kinds.get(`${pine[i]}/${pine[i + 2]}`) === kinds.get(`${pine[i + 8]}/${pine[i + 10]}`)) same++;
    pairs++;
  }
  assert.ok(same / pairs > 0.99, `noise must interpolate across boundaries, not classify grid cells: ${same / pairs}`);
});

test('species repeat over positive and negative 8192m shifts independently on both axes', () => {
  const points = [];
  for (let z = 73; z < WORLD_SIZE; z += 256) for (let x = 117; x < WORLD_SIZE; x += 256) points.push([x, z]);
  const classify = (dx, dz) => {
    const pine = points.flatMap(([x, z], i) => instance(x + dx, z + dz, i));
    return new Map(rows(collect(synthetic(pine).subject)).map(row => [
      `${row.values[0] - dx}/${row.values[2] - dz}`, row.kind,
    ]));
  };
  const first = classify(0, 0);
  assert.ok(new Set(first.values()).size === 2, 'periodic test needs both real species');
  for (const [dx, dz] of [[WORLD_SIZE, 0], [0, WORLD_SIZE], [-WORLD_SIZE, 0], [0, -WORLD_SIZE], [WORLD_SIZE * 2, -WORLD_SIZE * 3]]) {
    assert.deepEqual(classify(dx, dz), first, `world period changed classification at ${dx}/${dz}`);
  }
});

test('real periodic forest identities retain their new species after a whole-world camera shift', () => {
  const { subject } = actual();
  const normalized = (dx, dz) => new Map(rows(collect(subject, camera(dx, dz))).map(row => [
    row.values.slice(3).join('/'), { kind: row.kind, x: row.values[0] - dx, z: row.values[2] - dz },
  ]));
  const first = normalized(0, 0);
  for (const [dx, dz] of [[WORLD_SIZE, 0], [0, -WORLD_SIZE], [WORLD_SIZE, WORLD_SIZE]]) {
    const shifted = normalized(dx, dz);
    assert.equal(shifted.size, first.size);
    for (const [id, old] of first) {
      const row = shifted.get(id);
      assert.ok(row, 'keep each real tree identity across a world wrap');
      assert.equal(row.kind, old.kind);
      assert.ok(Math.abs(row.x - old.x) < 0.01 && Math.abs(row.z - old.z) < 0.01, 'only world-copy translation may change');
    }
  }
});

test('empty, single-species, and completely promoted batches never become identity-origin trees', () => {
  assert.deepEqual(Array.from(collect(synthetic([]).subject)), [], 'remove both empty drawables: renderer otherwise falls back to drawing at identity');
  const autumn = instance(12, 19), onlyAutumn = collect(synthetic([], autumn).subject);
  assert.equal(onlyAutumn.length, 1); assert.equal(onlyAutumn[0].mesh, meshes.autumnTree);
  assert.deepEqual(Array.from(onlyAutumn[0].instances), Array.from(new Float32Array(autumn)));

  const all = [];
  for (let z = 17; z < WORLD_SIZE; z += 256) for (let x = 29; x < WORLD_SIZE; x += 256) all.push(...instance(x, z));
  const mixed = rows(collect(synthetic(all).subject));
  for (const kind of ['pine', 'autumn']) {
    const selected = mixed.find(row => row.kind === kind);
    assert.ok(selected, `need a ${kind} point to exercise a fully empty output species`);
    const out = collect(synthetic(selected.values).subject);
    assert.equal(out.length, 1, 'drop the species with zero instances after regrouping');
    assert.equal(out[0].instanceCount, 1);
    assert.equal(out[0].mesh, kind === 'pine' ? meshes.pineTree : meshes.autumnTree);
  }
  const uninitialized = runtime();
  assert.deepEqual(Array.from(collect(uninitialized.subject)), [], 'do not create trees before Forest.init');
});

test('wrapper delegates unchanged arguments/receiver and never edits aircraft meshes', () => {
  const cam = camera(), player = { pos: cam.pos }, receiver = { marker: 17 };
  const aircraft = batch(meshes.player, instance(10, 20)), snapshot = structuredClone(meshes);
  let delegated = 0;
  const subject = synthetic([], [], { makeBatches(c, p, m, v) {
    assert.equal(this, receiver); assert.equal(c, cam); assert.equal(p, player); assert.equal(m, meshes); assert.equal(v, view);
    delegated++;
    return [batch(meshes.pineTree, []), batch(meshes.autumnTree, []), aircraft];
  } }).subject;
  const output = subject.collect.call(receiver, cam, player, meshes, view);
  assert.equal(delegated, 1); assert.deepEqual(meshes, snapshot);
  assert.deepEqual(Array.from(output), [aircraft], 'non-forest drawables must pass through untouched');
});

test('dense regrouping reuses high-water buffers and stays deterministic between frames', () => {
  const allocations = [];
  const tracked = Type => new Proxy(Type, { construct(target, args) {
    if (typeof args[0] === 'number' && args[0] > 64) allocations.push(args[0] * Type.BYTES_PER_ELEMENT);
    return new target(...args);
  } });
  const pine = [];
  for (let z = 0; z < 80; z++) for (let x = 0; x < 100; x++) pine.push(...instance(x * 80 + 17, z * 100 + 23, z * 100 + x));
  const { subject } = synthetic(pine, instance(10, 20), { Float32Array: tracked(Float32Array), Uint8Array: tracked(Uint8Array) });
  const snapshot = () => rows(collect(subject));
  const first = snapshot();
  assert.ok(first.some(row => row.kind === 'autumn' && row.values[0] !== 10), 'exercise the regrouping buffers');
  allocations.length = 0;
  for (let i = 0; i < 5; i++) assert.deepEqual(snapshot(), first);
  assert.deepEqual(allocations, [], 'after warm-up, no fresh large typed arrays per collect');
});

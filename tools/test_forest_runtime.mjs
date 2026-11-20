#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const forestPath = path.join(root, 'src', '33_forest.js');
const WORLD_SIZE = 8192;
const wrap = n => ((n % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const meshes = { pineTree: { height: 36, crownRadius: 10.5, crownBase: 4 }, autumnTree: { height: 25, crownRadius: 12, crownBase: 4 } };
function runtime(maxTrees = 8800) {
  const context = vm.createContext({ console, Math, Float32Array, Uint8Array, WORLD_SIZE, SUN_DIR: { x: -0.55, y: 0.3, z: -0.78 } });
  const implementation = fs.existsSync(forestPath) ? fs.readFileSync(forestPath, 'utf8').replace('const MAX_TREES = 8800;', `const MAX_TREES = ${maxTrees};`) : '';
  vm.runInContext(implementation + '\nglobalThis.subject = typeof Forest === "undefined" ? null : Forest;', context);
  assert.ok(context.subject?.init && context.subject?.collect, 'Forest.init/collect must exist before the world is uploaded');
  return context.subject;
}
function map({ forest = () => 1, height = () => 180, slope = () => 0, N = 512 } = {}) {
  const calls = { height: 0, forest: 0, slope: 0 };
  const heights = Float32Array.from({ length: N * N }, (_, i) => height(i % N / N * WORLD_SIZE, Math.floor(i / N) / N * WORLD_SIZE));
  return { N, heights, calls,
    heightAt(x, z) { calls.height++; return height(wrap(x), wrap(z)); },
    forestAt(x, z) { calls.forest++; return forest(wrap(x), wrap(z)); },
    slopeAt(x, z) { calls.slope++; return slope(wrap(x), wrap(z)); },
  };
}
function camera(x = 4096, z = 4096, y = 2100, top = true) {
  return { pos: { x, y, z }, right: { x: 1, y: 0, z: 0 },
    up: top ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 },
    fwd: top ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: 1 }, fov: 1.2, aspect: 1.8 };
}
const view = { height: 640, aspect: 1.8, top: true };
function collect(forest, cam, opts = view) { return forest.collect(cam, { pos: { x: cam.pos.x, y: 400, z: cam.pos.z } }, meshes, opts); }
const count = batches => batches.reduce((sum, b) => sum + b.instanceCount, 0);
const snapshot = batches => batches.map(b => ({ kind: b.mesh === meshes.pineTree ? 0 : 1, values: Array.from(b.instances) }));
function records(batches) {
  return batches.flatMap(b => Array.from({ length: b.instanceCount }, (_, i) => ({ kind: b.mesh === meshes.pineTree ? 0 : 1, data: b.instances.slice(i * 8, i * 8 + 8) })));
}

test('forest batches are deterministic, seeded, cached, and within a substantial fixed budget', () => {
  const f = runtime(), m = map();
  f.init(m, 1337);
  const before = { ...m.calls }, cam = camera();
  const first = snapshot(collect(f, cam));
  const batches = collect(f, cam);
  assert.ok(count(batches) >= 6000 && count(batches) <= 9000, `dense view must use 6000–9000 instances, got ${count(batches)}`);
  assert.equal(batches.length, 2, 'one batch per tree species');
  assert.deepEqual(snapshot(batches), first);
  assert.deepEqual(m.calls, before, 'collect must never resample static terrain');
  const shade = m.treeShade.slice();
  f.init(m, 1337);
  assert.deepEqual(snapshot(collect(f, cam)), first);
  assert.deepEqual(m.treeShade, shade, 'tree shadows must use the same deterministic tree identities');
  f.init(m, 7331);
  assert.notDeepEqual(snapshot(collect(f, cam)), first, 'the seed must affect the forest');
});

test('instance layout preserves metre-scale models, unit yaw, green majority, and stable near identities', () => {
  const f = runtime(); f.init(map(), 1337);
  const batches = collect(f, camera());
  for (const b of batches) {
    assert.ok(b.instances instanceof Float32Array);
    assert.equal(b.instances.length, b.instanceCount * 8);
    assert.equal(b.outline, false); assert.equal(b.rim, false); assert.equal(b.dist, 0);
    for (let i = 0; i < b.instances.length; i += 8) {
      const [x, y, z, scale, c, s, width, brightness] = b.instances.subarray(i, i + 8);
      assert.ok([x, y, z, scale, c, s, width, brightness].every(Number.isFinite));
      assert.ok(scale >= 0.799 && scale <= 1.251, 'heightScale must stay near 1, not normalize the mesh');
      assert.ok(Math.abs(c * c + s * s - 1) < 1e-5);
      assert.ok(width >= 0.85 && width <= 1.25);
      assert.ok(brightness >= 0.75 && brightness <= 1.15);
    }
  }
  const pine = batches.find(b => b.mesh === meshes.pineTree).instanceCount;
  assert.ok(pine / count(batches) > 0.70, 'green conifers must dominate');
  const keys = rows => new Set(rows.filter(r => Math.hypot(r.data[0] - 4096, r.data[2] - 4096) < 500).map(r => `${r.kind}/${r.data[0]}/${r.data[2]}`));
  const first = keys(records(batches));
  const moved = keys(records(collect(f, camera(4097, 4096))));
  assert.ok(first.size > 300);
  assert.equal([...first].filter(k => moved.has(k)).length, first.size, 'tiny camera motion must not arbitrarily replace near trees');
});

test('tree positions, variation, and shadows repeat over the complete 8192m world period', () => {
  const f = runtime(100000); f.init(map(), 1234);
  const normalize = (batches, dx, dz) => records(batches).map(r => [r.kind, ...Array.from(r.data, (v, i) => i === 0 ? Math.round((v - dx) * 100) / 100 : i === 2 ? Math.round((v - dz) * 100) / 100 : v)]).sort((a, b) => a[0] - b[0] || a[4] - b[4] || a[5] - b[5] || a[6] - b[6] || a[7] - b[7] || a[8] - b[8] || a[1] - b[1] || a[3] - b[3]);
  const first = normalize(collect(f, camera(0, 0)), 0, 0);
  const shifted = normalize(collect(f, camera(WORLD_SIZE, WORLD_SIZE)), WORLD_SIZE, WORLD_SIZE);
  assert.equal(shifted.length, first.length);
  const ids = rows => new Set(rows.map(row => JSON.stringify(row.slice(4))));
  const firstIds = ids(first), shiftedIds = ids(shifted);
  assert.deepEqual(shiftedIds, firstIds, 'full-world shift must preserve every visible tree identity');
  for (let i = 0; i < first.length; i++) {
    assert.equal(shifted[i][0], first[i][0]);
    assert.ok(Math.abs(shifted[i][1] - first[i][1]) < 0.1 && Math.abs(shifted[i][3] - first[i][3]) < 0.1, `periodic positions tolerate float32 world-coordinate precision at ${i}/${first.length} (dx=${shifted[i][1] - first[i][1]}, dz=${shifted[i][3] - first[i][3]}; a=${JSON.stringify(first[i])}; b=${JSON.stringify(shifted[i])})`);
    assert.deepEqual(shifted[i].slice(4), first[i].slice(4));
  }
});

test('ordinary flight sees continuous middle-distance forest; crown volumes survive root-point culling', () => {
  const f = runtime(); f.init(map(), 55);
  for (const [x, z] of [[2000, 1000], [5100, 4300], [-1400, 6200]]) {
    const cam = camera(x, z, 235, false), batches = collect(f, cam, { ...view, top: false });
    assert.ok(count(batches) > 1000, 'forest must render during ordinary flight, not only a staged pose');
    assert.ok(records(batches).some(r => r.data[2] - z > 1600), 'forest must extend well beyond the old 900m ring');
    assert.ok(records(batches).every(r => Math.hypot(r.data[0] - x, r.data[2] - z) < 2240));
  }
  const cam = camera(4096, 4096, 235, false);
  cam.fov = 0.18;
  assert.ok(count(collect(f, cam, { ...view, top: false })) > 10, 'crowns entering the frustum must remain visible when their roots are below it');
});

test('top view rejects subpixel crowns instead of leaving distant bright dots', () => {
  const f = runtime(); f.init(map(), 77);
  assert.equal(count(collect(f, camera(4096, 4096, 20000), { ...view, height: 240 })), 0);
  assert.ok(count(collect(f, camera(4096, 4096, 2100))) > 1000, 'normal top view must retain real trees');
});

test('soft tree shadows follow actual roots, leave clearings clean, and never darken water', () => {
  const f = runtime();
  const m = map({ N: 1024, height: x => x < 1024 ? -20 : 180, forest: (x, z) => x > 2700 && x < 5500 && z > 2700 && z < 5500 ? 1 : 0 });
  f.init(m, 1337);
  assert.ok(m.treeShade instanceof Uint8Array); assert.equal(m.treeShade.length, m.N * m.N);
  const rows = records(collect(f, camera()));
  assert.ok(rows.length > 1000);
  let associated = 0, soft = 0;
  for (const r of rows) {
    const ix = Math.floor(wrap(r.data[0]) / WORLD_SIZE * m.N) % m.N;
    const iz = Math.floor(wrap(r.data[2]) / WORLD_SIZE * m.N) % m.N;
    if (m.treeShade[iz * m.N + ix] < 248) associated++;
  }
  assert.ok(associated / rows.length > 0.98, 'visible trees must own a soft root shadow');
  for (let i = 0; i < m.treeShade.length; i++) {
    const value = m.treeShade[i], x = i % m.N / m.N * WORLD_SIZE, z = Math.floor(i / m.N) / m.N * WORLD_SIZE;
    assert.ok(value >= 155 && value <= 255);
    if (value > 190 && value < 250) soft++;
    if (x < 1024 || x < 2560 || x > 5640 || z < 2560 || z > 5640) assert.equal(value, 255, 'water and remote tree-free clearings must stay unshadowed');
  }
  assert.ok(soft > 1000, 'shadow edges must be graded rather than hard stamps');
  const empty = map({ forest: () => 0 }); f.init(empty, 1337);
  assert.ok(empty.treeShade.every(v => v === 255));
  assert.equal(count(collect(f, camera())), 0);
});

test('steep terrain and water cannot receive trees or tree shadows', () => {
  const f = runtime();
  for (const m of [map({ height: () => -8 }), map({ slope: () => 0.9 })]) {
    f.init(m, 1337);
    assert.equal(count(collect(f, camera())), 0);
    assert.ok(m.treeShade.every(v => v === 255));
  }
});

test('mature tree geometry keeps full world dimensions and each crown has local outward normals', () => {
  const context = vm.createContext({ Math, TAU: Math.PI * 2 });
  vm.runInContext(source('32_meshes.js') + '\nglobalThis.modelAPI = { MeshBuilder, addTreeCone, addTreeCrown, buildPineTree, buildAutumnTree };', context);
  const api = context.modelAPI, colors = [[0.1, 0.3, 0.15]];
  const mb = new api.MeshBuilder({ x: 0, y: 0, z: 0 });
  api.addTreeCone(mb, 4, 22, -3, 8, 9, colors);
  let caps = 0;
  for (let i = 0; i < mb.pos.length; i += 9) if ([mb.pos[i + 1], mb.pos[i + 4], mb.pos[i + 7]].every(y => y === 22)) {
    caps++; assert.ok(mb.nor[i + 1] < -0.99, 'even the upper canopy tier must have a downward-facing bottom');
  }
  assert.equal(caps, 7);
  assert.equal(mb.center.y, 0, 'tree-local normal centers must not change unrelated mesh construction');
  const crown = new api.MeshBuilder({ x: 0, y: 0, z: 0 });
  api.addTreeCrown(crown, 4, 22, -3, 8, 7, 8, colors);
  for (let i = 0; i < crown.pos.length; i += 9) {
    const center = [0, 1, 2].map(a => (crown.pos[i + a] + crown.pos[i + 3 + a] + crown.pos[i + 6 + a]) / 3 - [4, 22, -3][a]);
    assert.ok(center.reduce((sum, v, a) => sum + v * crown.nor[i + a], 0) > 0, 'each crown uses its own center, not the complete tree center');
  }
  for (const [data, minH, maxH, minW, maxW] of [[api.buildPineTree(), 30, 38, 16, 22], [api.buildAutumnTree(), 22, 28, 18, 26]]) {
    const axes = [0, 1, 2].map(a => data.pos.filter((_, i) => i % 3 === a));
    const h = Math.max(...axes[1]) - Math.min(...axes[1]);
    const w = Math.max(Math.max(...axes[0]) - Math.min(...axes[0]), Math.max(...axes[2]) - Math.min(...axes[2]));
    assert.ok(h >= minH && h <= maxH, `model height ${h} must be ${minH}–${maxH}m`);
    assert.ok(w >= minW && w <= maxW, `model crown width ${w} must be ${minW}–${maxW}m`);
    assert.ok(data.emi.every(v => v === 0), 'trees have no emissive white pinpoints');
  }
});

function fakeGL() {
  let serial = 0, vao = null, buffer = null, program = null;
  const calls = [], values = new Map(), attrs = new Map();
  const gl = new Proxy({ calls, values, attrs, drawingBufferWidth: 1152, drawingBufferHeight: 640,
    createVertexArray() { return { vao: ++serial }; }, bindVertexArray(v) { vao = v; },
    createBuffer() { return { buffer: ++serial }; }, bindBuffer(_target, b) { buffer = b; },
    createShader() { return {}; }, createProgram() { return { program: ++serial }; },
    getShaderParameter() { return true; }, getProgramParameter() { return true; }, getExtension() { return true; },
    getUniformLocation(p, name) { return { p, name }; }, useProgram(p) { program = p; },
    uniform1f(u, v) { values.set(`${u.p.program}/${u.name}`, v); }, uniform1i(u, v) { values.set(`${u.p.program}/${u.name}`, v); },
    vertexAttribPointer(loc, size, type, normalized, stride, offset) { attrs.set(`${vao?.vao}/${loc}`, { buffer, loc, size, stride, offset }); },
    vertexAttribDivisor(loc, divisor) { const a = attrs.get(`${vao?.vao}/${loc}`); if (a) a.divisor = divisor; },
    bufferData(_target, data) { calls.push({ type: 'bufferData', buffer, data }); },
    bufferSubData(_target, offset, data) { calls.push({ type: 'bufferSubData', buffer, offset, data }); },
    texImage2D(...args) { calls.push({ type: 'texImage2D', args }); },
    drawArrays(...args) { calls.push({ type: 'draw', vao, args, uniforms: new Map(values), program }); },
    drawArraysInstanced(...args) { calls.push({ type: 'instanced', vao, args, uniforms: new Map(values), program }); },
    depthMask(value) { calls.push({ type: 'depthMask', value }); },
    checkFramebufferStatus() { return 'FRAMEBUFFER_COMPLETE'; },
  }, { get(target, key) { if (key in target) return target[key]; if (/^[A-Z0-9_]+$/.test(key)) return key; if (/^create/.test(key)) return () => ({ id: ++serial }); return () => {}; } });
  return gl;
}

test('renderer wires reusable 8-float instancing, tree rim-off, ordinary rim-on, and aux alpha shadows', () => {
  const gl = fakeGL(), context = vm.createContext({ console, Math, Float32Array, Uint8Array,
    mat4: identity, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), HMAP_N: 2, WORLD_SIZE,
    SUN_DIR: { x: -0.55, y: 0.3, z: -0.78 }, CLOUD_BASE: 1000, CLOUD_TOP: 2000, CLOUD_SIZE: 8192,
    FULLSCREEN_VS: '', SCENE_FS: '', CLOUD_FS: '', MESH_VS: '', MESH_FS: '', POST_FS: '',
  });
  vm.runInContext(source('31_render.js') + '\nglobalThis.subject = Renderer;', context);
  const r = context.subject;
  assert.equal(r.init({ getContext: () => gl, addEventListener() {} }), true);
  r.resize(1152, 640);
  const shade = new Uint8Array([155, 192, 230, 255]);
  const m = { heights: new Float32Array(4), forest: new Uint8Array(4), tint: new Uint8Array(4), shadow: new Uint8Array(4), treeShade: shade, cloudN: 1, cloudTex: new Uint8Array(1), maxH: 600, cloudDriftX: 0, cloudDriftZ: 0 };
  r.uploadWorld(m);
  const aux = gl.calls.find(c => c.type === 'texImage2D' && c.args[2] === gl.RGBA8 && c.args.at(-1)?.length).args.at(-1);
  assert.deepEqual(Array.from(aux).filter((_, i) => i % 4 === 3), Array.from(shade));
  const data = { pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], nor: [0, 1, 0, 0, 1, 0, 0, 1, 0], col: [0, 1, 0, 0, 1, 0, 0, 1, 0], emi: [0, 0, 0] };
  const tree = r.createMesh(data), plane = r.createMesh(data), inst = new Float32Array([0, 180, 0, 1, 1, 0, 1, 1]);
  const drawables = [{ mesh: tree, matrix: identity(), instances: inst, instanceCount: 1, outline: false, rim: false, dist: 0 }, { mesh: plane, matrix: identity(), dist: 0 }];
  const cam = { ...camera(), vp: identity() };
  r.render(cam, m, 0, drawables, {});
  const firstBuffer = tree.instanceBuffer;
  assert.ok(firstBuffer, 'tree mesh retains its instance buffer');
  for (const [loc, offset] of [[4, 0], [5, 16]]) {
    const attr = gl.attrs.get(`${tree.vao.vao}/${loc}`);
    assert.equal(attr.buffer, firstBuffer); assert.equal(attr.size, 4); assert.equal(attr.stride, 32); assert.equal(attr.offset, offset); assert.equal(attr.divisor, 1);
  }
  r.render(cam, m, 1, drawables, {});
  assert.equal(tree.instanceBuffer, firstBuffer, 'reuse the buffer across frames');
  const treeDraws = gl.calls.filter(c => c.type === 'instanced');
  assert.equal(treeDraws.length, 2, 'one instanced draw per tree species per frame');
  for (const c of treeDraws) {
    assert.equal(c.args[3], 1);
    assert.equal(c.uniforms.get(`${c.program.program}/uInstanced`), 1);
    assert.equal(c.uniforms.get(`${c.program.program}/uRim`), 0);
  }
  const planeDraws = gl.calls.filter(c => c.type === 'draw' && c.vao === plane.vao);
  assert.equal(planeDraws.length, 4, 'aircraft keep outline and fill passes');
  for (const c of planeDraws) {
    assert.equal(c.uniforms.get(`${c.program.program}/uInstanced`), 0);
    assert.equal(c.uniforms.get(`${c.program.program}/uRim`), 1);
  }
  assert.ok(gl.calls.some(c => c.type === 'depthMask' && c.value === false));
  delete m.treeShade; r.uploadWorld(m);
  const fallback = gl.calls.filter(c => c.type === 'texImage2D' && c.args[2] === gl.RGBA8 && c.args.at(-1)?.length).at(-1).args.at(-1);
  assert.ok(Array.from(fallback).filter((_, i) => i % 4 === 3).every(v => v === 255));
});

test('boot initializes shadows before upload and the normal drawable path uses Forest.collect', () => {
  const main = source('60_main.js');
  assert.match(main, /Forest\.init\(map,\s*G\.seed\)/);
  assert.ok(main.indexOf('Forest.init(map, G.seed)') < main.indexOf('Renderer.uploadWorld(map)'));
  assert.match(main, /Forest\.collect\(/);
  assert.doesNotMatch(main, /addTreeGrid|candidates\.slice\(0,\s*130\)|function terrainTreeHash/);
});

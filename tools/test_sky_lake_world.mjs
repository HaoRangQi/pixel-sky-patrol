import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Worker as NodeWorker } from 'node:worker_threads';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const core = read('src/10_core.js');
const sunlight = core.slice(core.indexOf('const TAU ='), core.indexOf('const PAL ='))
  .replace('const SUN_AZ = -0.62;', 'const SUN_AZ = 0.12;')
  .replace('const SUN_EL = 0.30;', 'const SUN_EL = 0.12;');
const world = read('src/20_world.js');
const forestSource = read('src/33_forest.js');
const lakeURL = new URL('../sky-patrol/25_lake_world.js', import.meta.url);
const lake = existsSync(lakeURL) ? readFileSync(lakeURL, 'utf8') : '';
const WORLD = 8192;

function workerPlatform({ fail = false } = {}) {
  const sources = new Map(); let workers = 0, blobs = 0, revoked = 0;
  class SourceBlob { constructor(parts) { this.source = parts.join(''); } }
  const objectURL = {
    createObjectURL(blob) { const url = `blob:lake-${++blobs}`; sources.set(url, blob.source); return url; },
    revokeObjectURL(url) { sources.delete(url); revoked++; },
  };
  class BrowserWorker {
    constructor(url) {
      workers++;
      const source = sources.get(url);
      assert.ok(source?.includes('skyApplyLakeValley'), 'worker URL must contain the independent lake generator');
      if (fail) return;
      const bridge = `const { parentPort } = require('node:worker_threads');\nconst self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };\nparentPort.on('message', data => self.onmessage({ data }));\n`;
      this.worker = new NodeWorker(bridge + source, { eval: true });
      this.worker.on('message', data => this.onmessage?.({ data }));
      this.worker.on('error', error => this.onerror?.({ message: error.message, error }));
    }
    postMessage(data, transfer) {
      if (fail) { queueMicrotask(() => this.onerror?.({ message: 'synthetic lake worker failure' })); return; }
      this.worker.postMessage(data, transfer);
    }
    terminate() { return this.worker?.terminate(); }
  }
  return { globals: { Worker: BrowserWorker, Blob: SourceBlob, URL: objectURL },
    workers: () => workers, blobs: () => blobs, revoked: () => revoked };
}

function harness(original = async () => { throw Error('unexpected worker generation'); }, globals = {}) {
  const context = vm.createContext({ Float32Array, Uint8Array, setTimeout, ...globals, __original: original });
  vm.runInContext(`${sunlight}\n${world}\ngenerateWorld = __original;\n${lake}\n${forestSource}\n` +
    'let applicationCount = 0; if (typeof skyApplyLakeValley === "function") { const apply = skyApplyLakeValley; skyApplyLakeValley = function(...args) { applicationCount++; return apply(...args); }; }\n' +
    'globalThis.api = { WorldMap, SUN_DIR, Forest, generateWorld, apply: typeof skyApplyLakeValley === "function" ? skyApplyLakeValley : undefined, get applicationCount() { return applicationCount; } };', context);
  return context.api;
}
const api = harness();

function emptyMap(N = 128, fill = 17, runtime = api) {
  const map = new runtime.WorldMap(new Float32Array(N * N).fill(9999),
    new Uint8Array(N * N).fill(fill), new Uint8Array(N * N).fill(fill),
    new Uint8Array(N * N).fill(fill), 9999, 9999, new Uint8Array([11]), 1);
  map.N = N;
  return map;
}
function apply(map, seed = 1337, runtime = api) {
  assert.equal(typeof runtime.apply, 'function', 'skyApplyLakeValley(map, seed) is required');
  return runtime.apply(map, seed);
}
function generated(N = 128, seed = 1337, runtime = api) {
  const map = emptyMap(N, 17, runtime);
  apply(map, seed, runtime);
  return map;
}

// Flood-fill the actual periodic height cells, not a terrain tag or a separate preview.
function components(map, isMember) {
  const N = map.N, seen = new Uint8Array(N * N), groups = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isMember(map.heights[start])) continue;
    const group = [start]; seen[start] = 1;
    for (let n = 0; n < group.length; n++) {
      const i = group[n], x = i % N, z = Math.floor(i / N);
      for (const next of [z * N + (x + 1) % N, z * N + (x + N - 1) % N,
        ((z + 1) % N) * N + x, ((z + N - 1) % N) * N + x]) {
        if (!seen[next] && isMember(map.heights[next])) { seen[next] = 1; group.push(next); }
      }
    }
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length);
}

let defaultMap;
const terrain = () => defaultMap ||= generated();

test('in-place adapter retains WorldMap samplers, typed arrays and cloud data at small map.N', () => {
  for (const N of [16, 32, 63, 96]) {
    const map = emptyMap(N), fields = ['heights', 'forest', 'tint', 'shadow', 'cloudTex'];
    const original = Object.fromEntries(fields.map(key => [key, map[key]]));
    const heightAt = map.heightAt, forestAt = map.forestAt;
    assert.equal(apply(map), map, 'the same map must reach Forest.init and uploadWorld');
    for (const key of fields) assert.equal(map[key], original[key], `${key} identity must be retained`);
    assert.equal(map.N, N); assert.equal(map.heightAt, heightAt); assert.equal(map.forestAt, forestAt);
    assert.equal(map.heights.length, N * N);
    for (const key of ['forest', 'tint', 'shadow']) {
      assert.ok(map[key] instanceof Uint8Array); assert.equal(map[key].length, N * N);
      assert.ok(map[key].every(v => Number.isInteger(v) && v >= 0 && v <= 255));
    }
    assert.ok(map.heights.every(Number.isFinite));
    assert.equal(map.minH, Math.min(...map.heights)); assert.equal(map.maxH, Math.max(...map.heights));
    assert.ok(map.minH < -15 && map.maxH > 650 && map.maxH < 1400,
      `水下湖床和独立山峰必须保留真实高差：${map.minH} / ${map.maxH}`);
    assert.equal(map.cloudTex[0], 11); assert.equal(map.cloudN, 1);
  }
});

test('同一条水路贯穿湖区，沿途有宽湖、窄口和偏向两岸的弯道', () => {
  const map = terrain(), N = map.N, cell = WORLD / N;
  const main = components(map, h => h < 0)[0];
  const sections = Array.from({ length: N }, () => []);
  for (const i of main) sections[Math.floor(i / N)].push((i % N) * cell);
  assert(sections.every(row => row.length), '水路不能被湖首和湖尾的一圈陆地封死');
  const widths = sections.map(row => row.length * cell);
  assert(Math.min(...widths) < 1000 && Math.max(...widths) > 2200, '航程中须经过宽湖和收窄的水道');
  const centres = sections.map(row => (Math.min(...row) + Math.max(...row)) / 2);
  assert(Math.max(...centres) - Math.min(...centres) > 1100, '左右岸线不能只是宽窄略变的直槽');
  assert(main.length > N * N * 0.12 && main.length < N * N * 0.45);
});

test('默认直飞六公里经过水面与陆地，左右岸有林地、草坡和开口', () => {
  const map = terrain(), yaw = -0.08, heights = [], edges = [[], []];
  for (let d = 0; d <= 6500; d += 80) {
    const x = 4990 + d * Math.sin(yaw), z = 7100 - d * Math.cos(yaw);
    heights.push(map.heightAt(x, z));
    for (let side = 0; side < 2; side++) {
      const sx = x + (side ? 1 : -1) * 650;
      edges[side].push({ h: map.heightAt(sx, z), f: map.forestAt(sx, z) });
    }
  }
  assert(Math.max(...heights) < 360, '前方通道不能被同心山环截断');
  assert(heights.filter(h => h < -3).length > 12 && heights.filter(h => h > 8).length > 6);
  for (const edge of edges) {
    assert(edge.some(e => e.h < 0) && edge.some(e => e.h > 15 && e.f > 0.36));
    assert(edge.some(e => e.h > 15 && e.f < 0.2));
  }
});

function inlandFlight(map) {
  const yaw = 0.00755, startH = map.heightAt(6970, 7200);
  return Array.from({ length: 46 }, (_, sec) => {
    const x = 6970 + 112 * sec * Math.sin(yaw), z = 7200 - 112 * sec * Math.cos(yaw);
    const h = map.heightAt(x, z), wooded = [-1, 1].map(side => [40, 80, 120, 160, 200].some(d => {
      const xx = x + side * d;
      return map.forestAt(xx, z) > 0.50 && map.slopeAt(xx, z) < 0.46;
    }));
    return { x, z, h, clearance: startH + 125 - h, wooded };
  });
}

test('东岸内陆低飞五公里不断谷；不同种子均有近林交替和开敞草场', () => {
  for (const seed of [1337, 77, -1]) {
    const map = seed === 1337 ? terrain() : generated(128, seed), route = inlandFlight(map);
    const min = Math.min(...route.map(s => s.clearance));
    assert(min > 50 && route.every(s => s.h > 15 && s.h < 260), `种子 ${seed} 的谷底被山体截断；最低净空 ${min.toFixed(1)} 米`);
    for (const side of [0, 1]) assert(route.filter(s => s.wooded[side]).length >= 4, `种子 ${seed} 的第 ${side} 侧没有可种树的近景林舌`);
    const clear = route.filter(s => !s.wooded.some(Boolean) && map.forestAt(s.x,s.z) < .20);
    assert(clear.length >= 10, `种子 ${seed} 的两侧林线之间缺少草甸`);
  }
});

test('谷地两边的山脊都有切口，且横向支谷不在主谷同一个截面', () => {
  const map = terrain(), outlets = [];
  for (const side of [-1, 1]) {
    const ridges = [];
    for (let z = 2750; z <= 6850; z += 100) {
      let high = -Infinity;
      for (let d = 560; d <= 1030; d += 35) high = Math.max(high, map.heightAt(6970 + side*d, z));
      ridges.push(high - map.heightAt(6970,z));
    }
    assert(ridges.filter(relief => relief > 180).length > ridges.length * .86, `第 ${side} 侧没有连绵谷脊`);
    const notches = ridges.map((v,i) => i >= 4 && i < ridges.length-4 && Math.min(ridges[i-4],ridges[i+4]) - v > 85 ? 2750 + i*100 : null).filter(Boolean);
    assert(notches.length, `第 ${side} 侧没有能透出远坡的横向支谷`);
    outlets.push(notches);
  }
  assert(outlets.every((zs,i) => zs.some(z => outlets[1-i].every(zz => Math.abs(z-zz)>450))), '两侧山脊不能同时收束为对称圆盆');
});

test('高处俯看东支谷是宽斜鞍部，草坡上方能越过中景低肩望见对面的高岭', () => {
  const map = terrain(), eye = map.heightAt(6970,4820) + 125, middle = [], beyond = [];
  // 从主谷沿东北方向越过东肩，角度比较用同一条真实视线，不拿全图最高点充数。
  for (let x = 360; x <= 2400; x += 30) {
    const z = 4820 - .47*x, angle = (map.heightAt(6970+x,z) - eye)/Math.hypot(x,.47*x);
    (x <= 1120 ? middle : beyond).push(angle);
  }
  assert(Math.max(...middle) < .05 && Math.max(...beyond) > Math.max(...middle) + .035,
    `近肩还在封住远山：坡角正切 ${Math.max(...middle).toFixed(2)} / ${Math.max(...beyond).toFixed(2)}`);
  // 切口不仅是一道窄缝：三个相隔 160 米的剖面都要低于前、后两座肩。
  const channel = z => Math.max(...Array.from({length:16},(_,i)=>map.heightAt(6970+560+i*30,z-.47*(560+i*30))));
  const opening = Math.max(...[4660,4820,4980].map(channel));
  const shoulder = Math.min(channel(3750),channel(5850));
  assert(opening < shoulder - 125, `东侧宽鞍部未成形：窗口 ${opening.toFixed(0)}，两邻肩最低 ${shoulder.toFixed(0)}`);
});

test('山肩上半坡不是等宽峭壁，脊顶两侧有上升与回落的弧面', () => {
  const map = terrain();
  for (const side of [-1,1]) {
    let round = 0, peaks = [];
    for (let z=2700;z<=6800;z+=125) {
      const profile = Array.from({length:25},(_,i)=>map.heightAt(6970+side*(380+i*30),z));
      const peak=Math.max(...profile), i=profile.indexOf(peak), foot=map.heightAt(6970,z), relief=peak-foot;
      if (relief < 180) continue;
      peaks.push(380+i*30);
      if (i < 3 || i > profile.length-4) continue;
      const slopes = profile.slice(1,i+1).map((h,k)=>(h-profile[k])/30);
      if (peak-profile[i-3]>8 && peak-profile[i+3]>8 && Math.max(...slopes)<1.5) round++;
    }
    assert(round>=10 && Math.max(...peaks)-Math.min(...peaks)>=220, `第 ${side} 侧仍是等宽截顶台地：宽圆顶剖面 ${round}，脊线横移 ${Math.max(...peaks)-Math.min(...peaks)} 米`);
  }
});

test('山肩和旧坡的接合处不会沿航线反复形成陡直岩墙', () => {
  const map = terrain();
  for (const side of [-1, 1]) {
    const slopes = [];
    for (let z = 2700; z <= 6900; z += 125) {
      let last = map.heightAt(6970 + side*350, z);
      for (let d = 400; d <= 1150; d += 50) {
        const h = map.heightAt(6970 + side*d, z);
        slopes.push(Math.abs(h-last)/50); last = h;
      }
    }
    slopes.sort((a,b) => a-b);
    const p95 = slopes[Math.floor(slopes.length*.95)];
    assert(p95 < 1.65 && slopes.at(-1) < 2.2, `第 ${side} 侧反复接成陡壁：坡度 P95 ${p95.toFixed(2)}，峰值 ${slopes.at(-1).toFixed(2)}`);
  }
});

test('同一架次左右交错掠过真实树冠，并有一段近处林木退开', () => {
  const map = terrain(), route = inlandFlight(map), near = [];
  api.Forest.init(map, 1337);
  for (let i = 0; i < 44; i += 2) {
    const p = route[i], cam = { pos: { x:p.x,y:route[0].h+125,z:p.z }, fov: 1.01,
      fwd:{x:0,y:-.22,z:-.976}, right:{x:1,y:0,z:0}, up:{x:0,y:.976,z:-.22} };
    const batches = api.Forest.collect(cam,null,{ pineTree:'pine',autumnTree:'autumn' },{ aspect:1.8,height:480 });
    const sides = [0,0];
    for (const { instances } of batches) for (let k=0;k<instances.length;k+=8) {
      const x=instances[k]-p.x, z=p.z-instances[k+2];
      if (Math.abs(x)<200 && z>40 && z<310) sides[+(x>0)]++;
    }
    if (p.clearance > 45 && p.clearance < 240) near.push(sides);
  }
  assert(near.some(([l,r])=>l>=9 && r<l/2) && near.some(([l,r])=>r>=9 && l<r/2), '必须依次从林舌两边飞过，而不是只在一侧撒树');
  assert(near.filter(([l,r])=>l+r<4).length>=3, '低飞时前方也须出现开敞草甸');
});

test('湖区包含多个大小不同、有林冠的真实岛屿', () => {
  const map = terrain(), land = components(map, h => h >= 0);
  const islands = land.slice(1).filter(group => group.length >= 10 && Math.max(...group.map(i => map.heights[i])) > 25);
  assert.ok(islands.length >= 3, `可飞越的独立岛屿只有 ${islands.length} 座`);
  assert.ok(islands[0].length > islands.at(-1).length * 2, '群岛不应是同一山包的等大复制');
  assert.ok(islands.filter(group => group.some(i => map.forest[i] > 0.36 * 255)).length >= 2, '至少两座岛上可长出真实树木');
});

test('shallow submerged shelves, low shores and open distant shoulders surround the valley', () => {
  const map = terrain(), H = map.heights, size = H.length;
  assert.ok(H.filter(h => h > -8 && h < -0.1).length > size * 0.005, 'shallow turquoise-water shelf must have actual depth');
  assert.ok(H.filter(h => h >= 0 && h <= 40).length > size * 0.01, 'a low dry shoreline must separate water and slopes');
  assert.ok(H.filter(h => h > 350).length > size * 0.02, 'distant shoulders should still define a valley');
  const skyline = Array.from({ length: 24 }, (_, i) => {
    const angle = i * Math.PI / 12;
    let high = 0;
    for (let d = 1600; d <= 3900; d += 80) {
      high = Math.max(high, map.heightAt(4096 + Math.cos(angle) * d, 4096 + Math.sin(angle) * d));
    }
    return high;
  });
  assert(skyline.filter(h => h < 250).length >= 3, '中远景须有多个敞开的方向，不可四面环山');
  assert(skyline.filter(h => h > 650).length >= 3, '开口两侧仍应有高低分明的实体山峰');
});

test('patchy shore woodland survives while all water, including bilinear shore cells, stays treeless', () => {
  const map = terrain(), N = map.N, cell = WORLD / N;
  let shoreGroves = 0, shoreClearings = 0;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x, h = map.heights[i], f = map.forest[i];
    if (h <= 0 || h > 680) assert.equal(f, 0);
    assert.ok(f <= 220, 'the new shore woodland must retain sparse groves, not solid canopy');
    if (h >= 15 && h <= 220) {
      if (f >= 0.36 * 255) shoreGroves++;
      if (f < 0.1 * 255) shoreClearings++;
    }
    for (const [dx, dz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const wx = (x + dx) * cell, wz = (z + dz) * cell;
      if (map.heightAt(wx, wz) <= 0) assert.equal(map.forestAt(wx, wz), 0, 'bilinear forest leakage into the water');
    }
  }
  assert.ok(shoreGroves > 30, `too few shore cells can spawn trees: ${shoreGroves}`);
  assert.ok(shoreClearings > 30, 'shore slopes must retain clearings between groves');
  assert.ok(new Set(map.tint).size > 30, 'tint must be rebuilt as varied material data');
});

test('南段两岸均有可长出树林的坡面，不是只有一小撮树的裸坡', () => {
  const map = terrain();
  for (const [cx, cz] of [[2910, 5360], [5620, 5550]]) {
    let ground = 0, wooded = 0, clearing = 0;
    for (let z = cz - 550; z <= cz + 550; z += 40) for (let x = cx - 700; x <= cx + 700; x += 40) {
      const h = map.heightAt(x, z);
      if (h < 12 || h > 400) continue;
      ground++;
      if (map.forestAt(x, z) >= 0.50 && map.slopeAt(x, z) < 0.46) wooded++;
      if (map.forestAt(x, z) < 0.32) clearing++;
    }
    assert(wooded > ground * 0.13 && clearing > ground * 0.09,
      `湖岸 ${cx},${cz} 的林地／空地／总数：${wooded}/${clearing}/${ground}`);
  }
});

test('the real Forest module places both autumn and pine groves on the new dry shore', () => {
  const map = terrain(), count = api.Forest.init(map, 1337);
  assert.ok(count > 50, 'height/forest data must support actual tree instances');
  const camera = { pos: { x: 4990, y: 320, z: 7100 }, fwd: { x: -0.078, y: -0.23, z: -0.970 },
    right: { x: 0.997, y: 0, z: -0.080 }, up: { x: -0.018, y: 0.973, z: -0.229 }, fov: 0.92 };
  const batches = api.Forest.collect(camera, null, { pineTree: 'pine', autumnTree: 'autumn' }, { aspect: 2, height: 640, top: true });
  for (const mesh of ['pine', 'autumn']) {
    const batch = batches.find(b => b.mesh === mesh);
    assert.ok(batch.instanceCount > 0, `departure view needs an actual ${mesh} grove`);
    for (let i = 0; i < batch.instances.length; i += 8) {
      const [x, y, z] = batch.instances.subarray(i, i + 3);
      assert.ok(map.heightAt(x, z) >= 8); assert.ok(Math.abs(map.heightAt(x, z) - y) < 0.001);
    }
  }
});

test('WorldMap retains its 8192m periodic bilinear contract without a duplicated endpoint', () => {
  const map = terrain(), cell = WORLD / map.N;
  const wrap = n => (n % map.N + map.N) % map.N;
  for (const [x, z] of [[-15.25, 27.5], [WORLD - 0.25, 1200.5], [-WORLD * 2 - 0.125, WORLD * 3 + 0.375], [4101.5, 6200.25]]) {
    const fx = x / cell, fz = z / cell, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const [a, b, c, d] = [[ix, iz], [ix + 1, iz], [ix, iz + 1], [ix + 1, iz + 1]].map(([u, v]) => map.heights[wrap(v) * map.N + wrap(u)]);
    const expected = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    assert.ok(Math.abs(map.heightAt(x, z) - expected) < 1e-8);
    assert.ok(Math.abs(map.heightUV(x / WORLD, z / WORLD) - expected) < 1e-8);
    for (const [dx, dz] of [[WORLD, 0], [-WORLD, WORLD], [WORLD * 3, -WORLD * 2]]) {
      assert.ok(Math.abs(map.heightAt(x + dx, z + dz) - expected) < 1e-8);
      assert.ok(Math.abs(map.forestAt(x + dx, z + dz) - map.forestAt(x, z)) < 1e-8);
      assert.equal(map.shadowAt(x + dx, z + dz), map.shadowAt(x, z));
    }
  }
  let seam = 0, interior = 0, differingEndpoints = 0;
  for (let i = 0; i < map.N; i++) {
    seam = Math.max(seam, Math.abs(map.heights[i * map.N] - map.heights[i * map.N + map.N - 1]),
      Math.abs(map.heights[i] - map.heights[(map.N - 1) * map.N + i]));
    if (map.heights[i * map.N] !== map.heights[i * map.N + map.N - 1]) differingEndpoints++;
  }
  for (let z = 1; z < map.N; z++) for (let x = 1; x < map.N; x++) {
    const i = z * map.N + x;
    interior = Math.max(interior, Math.abs(map.heights[i] - map.heights[i - 1]), Math.abs(map.heights[i] - map.heights[i - map.N]));
  }
  assert.ok(seam < interior * 1.25 + 1, `periodic seam is a cliff: ${seam} vs ${interior}`);
  assert.ok(differingEndpoints > map.N / 2, 'sample x=N-1 is not the duplicated x=N endpoint');
});

test('seeded generation is deterministic, input-independent and repeatable across seeds', () => {
  const first = generated(64), second = emptyMap(64, 233);
  second.heights.fill(-300); apply(second);
  for (const field of ['heights', 'forest', 'tint', 'shadow']) assert.deepEqual(first[field], second[field]);
  apply(second);
  for (const field of ['heights', 'forest', 'tint', 'shadow']) assert.deepEqual(first[field], second[field], 'reapplying must not accumulate terrain');
  const other = generated(64, 1338);
  for (const field of ['heights', 'forest', 'tint', 'shadow']) assert.notDeepEqual(first[field], other[field], `${field} must respond to seed changes`);
  for (const seed of [0, 1, 77, -1, 2147483647]) {
    const map = generated(64, seed), water = components(map, h => h < 0);
    assert.ok(water[0].length > map.heights.length * 0.12, `seed ${seed} lost the lake`);
    assert.ok(components(map, h => h >= 0).length >= 2, `seed ${seed} lost all islands`);
  }
});

test('shadow bytes match sun rays cast through the finished periodic bilinear height field', () => {
  const map = generated(64), cell = WORLD / map.N, sun = api.SUN_DIR;
  let lit = 0, shaded = 0;
  for (let z = 0; z < map.N; z++) for (let x = 0; x < map.N; x++) {
    const i = z * map.N + x, h = map.heights[i];
    let expected = 0;
    if (h >= 0) {
      for (let s = 1; s <= 92; s++) {
        const t = s * 26;
        if (map.heightAt(x * cell + sun.x * t, z * cell + sun.z * t) > h + 3 + sun.y * t) { expected = 255; break; }
      }
      if (expected) shaded++; else lit++;
    }
    assert.equal(map.shadow[i], expected, `stale or misaligned ridge shadow at ${x},${z}`);
  }
  assert.ok(lit > 100 && shaded > 100, 'map must have both sunlit land and terrain shadows');
  const reversed = harness();
  reversed.SUN_DIR.x *= -1; reversed.SUN_DIR.z *= -1;
  const reverseMap = generated(64, 1337, reversed);
  assert.deepEqual(reverseMap.heights, map.heights);
  assert.notDeepEqual(reverseMap.shadow, map.shadow, 'baking must use current SUN_DIR, not a hard-coded light');
});

test('generateWorld applies the lake adapter once and maps original progress into the first 70%', async () => {
  let receivedSeed, receivedProgress;
  const progress = [], onProgress = (p, label) => progress.push({ p, label });
  let runtime;
  runtime = harness(async (seed, callback) => {
    receivedSeed = seed; receivedProgress = callback;
    callback?.(0.25, 'original quarter'); callback?.(1, 'original complete');
    return emptyMap(32, 73, runtime);
  });
  const result = await runtime.generateWorld(23, onProgress);
  assert.equal(receivedSeed, 23);
  assert.notEqual(receivedProgress, onProgress, 'base progress must be scaled to reserve room for lake generation');
  assert.deepEqual(progress.slice(0, 2), [
    { p: 0.175, label: 'original quarter' }, { p: 0.7, label: 'original complete' },
  ]);
  assert.equal(runtime.applicationCount, 1, 'skyApplyLakeValley must run exactly once');
  assert.equal(result.minH < -15, true, 'adapter must modify the generated map before resolving');
  assert.equal(progress.at(-1).p, 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i].p >= progress[i - 1].p);
});

test('generateWorld waits for the original map, then resolves only after terrain/shadow replacement with progress', async () => {
  let resolveBase, call;
  const ready = new Promise(resolve => { resolveBase = resolve; });
  const runtime = harness((seed, onProgress) => {
    call = { seed, onProgress }; onProgress?.(0.5, 'original terrain'); return ready;
  });
  const map = emptyMap(32, 73, runtime), progress = [];
  const pending = runtime.generateWorld(1337, (p, label) => progress.push({ p, label }));
  assert.equal(call.seed, 1337);
  assert.equal(map.heights[0], 9999, 'must await the original map before applying the adapter');
  call.onProgress?.(1, 'original ready'); resolveBase(map);
  assert.equal(await pending, map, 'boot must receive the modified original instance');
  assert.ok(map.minH < 0 && map.maxH > 650);
  assert.ok(map.shadow.some(v => v !== 73), 'shadow bake must finish before Forest.init/upload can observe the map');
  assert.ok(progress.some(e => /湖|谷/.test(e.label)), 'report the independent lake-valley generation stage');
  assert.ok(progress.some(e => /播种湖岸疏林/.test(e.label)), 'report woodland generation progress even where the periodic edge is not forested');
  assert.ok(progress.some(e => /影/.test(e.label)), 'report new terrain shadow work');
  assert.equal(progress.at(-1).p, 1);
  for (let i = 0; i < progress.length; i++) {
    assert.ok(progress[i].p >= 0 && progress[i].p <= 1);
    if (i) assert.ok(progress[i].p >= progress[i - 1].p, 'progress must not jump backwards after the original world finishes');
  }
});

test('generateWorld uses a Blob Worker, returns fields to the same map, and preserves monotonic progress', async () => {
  const platform = workerPlatform();
  let runtime, map;
  runtime = harness(async (seed, callback) => {
    callback?.(0.25, 'original quarter'); callback?.(1, 'original complete');
    map = emptyMap(32, 73, runtime); return map;
  }, platform.globals);
  const progress = [], onProgress = (p, label) => progress.push({ p, label });
  const pending = runtime.generateWorld(42, onProgress);
  const arrays = Object.fromEntries(['heights', 'forest', 'tint', 'shadow', 'cloudTex'].map(key => [key, map[key]]));
  const result = await pending;
  assert.equal(result, map);
  for (const key of Object.keys(arrays)) assert.equal(map[key], arrays[key], `${key} keeps its original identity`);
  assert.deepEqual([...map.cloudTex], [11]);
  assert.ok(map.minH < -15 && map.maxH > 650);
  assert.ok(map.shadow.some(v => v !== 73));
  assert.equal(platform.workers(), 1, 'browser generation must run in an independent worker');
  assert.equal(platform.blobs(), 1, 'worker source must be packaged as a Blob');
  assert.equal(platform.revoked(), 1, 'release the worker object URL after completion');
  assert.ok(progress.some(event => /湖|谷/.test(event.label)));
  assert.ok(progress.some(event => /播种湖岸疏林/.test(event.label)));
  assert.ok(progress.some(event => /影/.test(event.label)));
  assert.equal(progress.at(-1).p, 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i].p >= progress[i - 1].p, 'worker progress must not move backwards');
});

test('generateWorld propagates a lake worker failure without falling back to the blocking sync path', async () => {
  const platform = workerPlatform({ fail: true });
  let runtime, map;
  runtime = harness(async () => map = emptyMap(16, 73, runtime), platform.globals);
  await assert.rejects(runtime.generateWorld(19), /synthetic lake worker failure/);
  assert.equal(platform.workers(), 1);
  assert.equal(platform.revoked(), 1);
  assert.equal(map.minH, 9999, 'worker errors must propagate without partially replacing the base map');
  assert.ok(map.heights.every(value => value === 9999));
});

test('generateWorld propagates original failures and allows the progress callback to be omitted', async () => {
  const failure = Error('worker failed'), broken = harness(async () => { throw failure; });
  await assert.rejects(broken.generateWorld(77), error => error === failure);
  let map;
  const runtime = harness(async () => map);
  map = emptyMap(16, 17, runtime);
  assert.equal(await runtime.generateWorld(1337), map);
  assert.ok(map.minH < -15 && map.maxH > 650);
});

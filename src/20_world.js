// ---------------------------------------------------------------------------
// WORLD: seamless tiling height field + cloud noise, built in Web Workers.
// N=1024 height cells over 8192 m (8 m per cell); 128^3 cloud volume.
// ---------------------------------------------------------------------------
const WORLD_SIZE = 8192;
const HMAP_N = 1024;
const CELL = WORLD_SIZE / HMAP_N;
const CLOUD_BASE = 1200;
const CLOUD_TOP = 1670;
const CLOUD_SIZE = 6400;
const CLOUD_N = 128;
const CLOUD_RES = CLOUD_N;

const WORKER_SRC = String.raw`
'use strict';
let N = 1024, WORLD = 8192, SEED = 1, SUN = { x: -0.5, y: 0.2, z: -0.8 };
let cloudCS = 128;

function ihash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = t => t * t * (3 - 2 * t);
function vnoise(u, v, period, s) {
  const fx = u * period, fy = v * period;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = smooth(fx - ix), ty = smooth(fy - iy);
  const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((iy % period) + period) % period, y1 = (y0 + 1) % period;
  const a = ihash(x0, y0, s), b = ihash(x1, y0, s), c = ihash(x0, y1, s), d = ihash(x1, y1, s);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
function fbm(u, v, period, oct, s, ridge) {
  let sum = 0, amp = 0.5, norm = 0, p = period;
  for (let o = 0; o < oct; o++) {
    let n = vnoise(u, v, p, s + o * 101);
    if (ridge) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp; norm += amp; amp *= 0.5; p *= 2;
  }
  return sum / norm;
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function heightAt(u, v) {
  const w1 = fbm(u, v, 3, 3, SEED + 11) - 0.5;
  const w2 = fbm(u, v, 4, 3, SEED + 23) - 0.5;
  const uu = u + w1 * 0.11, vv = v + w2 * 0.11;
  const base = fbm(uu, vv, 3, 5, SEED + 1);
  const mask = sstep(0.38, 0.64, fbm(uu + 0.31, vv + 0.17, 2, 4, SEED + 7));
  let ridge = fbm(uu, vv, 4, 5, SEED + 31, true);
  ridge = Math.pow(ridge, 1.35);
  const detail = fbm(u, v, 64, 2, SEED + 91) - 0.5;
  let h = -18 + (base - 0.50) * 640 + mask * ridge * 1500 + detail * 22;
  h += sstep(0.45, 0.72, fbm(uu + 0.6, vv + 0.2, 3, 3, SEED + 77)) * 130;
  h += (fbm(u, v, 12, 3, SEED + 123) - 0.5) * 70;
  h += (fbm(u, v, 32, 2, SEED + 222) - 0.5) * 26;
  return h;
}
function forestAt(u, v, h) {
  const fn = fbm(u + 0.37, v + 0.71, 6, 4, SEED + 55);
  let f = sstep(0.405, 0.545, fn);
  f *= sstep(2, 24, h) * (1 - sstep(680, 900, h));
  f *= 0.86 + 0.14 * fbm(u, v, 24, 2, SEED + 66);
  return Math.max(0, Math.min(1, f));
}

function genRows(m) {
  const { row0, row1 } = m;
  const rn = row1 - row0;
  const heights = new Float32Array(rn * N);
  const forest = new Uint8Array(rn * N);
  const tint = new Uint8Array(rn * N);
  let minH = 1e9, maxH = -1e9;
  const report = Math.max(1, Math.floor(rn / 14));
  for (let j = 0; j < rn; j++) {
    const v = (row0 + j) / N;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const h = heightAt(u, v);
      heights[j * N + i] = h;
      forest[j * N + i] = forestAt(u, v, h) * 255;
      tint[j * N + i] = fbm(u + 0.13, v + 0.29, 9, 3, SEED + 88) * 255;
      if (h < minH) minH = h; if (h > maxH) maxH = h;
    }
    if (j % report === 0) self.postMessage({ type: 'progress', task: 'height', done: j / rn });
  }
  self.postMessage({ type: 'genRows', row0, row1, heights, forest, tint, minH, maxH }, [heights.buffer, forest.buffer, tint.buffer]);
}

let fullHeights = null;
function nearestH(px, pz) {
  let i = Math.floor(px / WORLD * N) % N; if (i < 0) i += N;
  let j = Math.floor(pz / WORLD * N) % N; if (j < 0) j += N;
  return fullHeights[j * N + i];
}
function shadowRows(m) {
  const { row0, row1 } = m;
  fullHeights = m.heights;
  const rn = row1 - row0;
  const out = new Uint8Array(rn * N);
  const sx = SUN.x, sy = SUN.y, sz = SUN.z;
  const stepM = 26;
  const report = Math.max(1, Math.floor(rn / 24));
  for (let j = 0; j < rn; j++) {
    const row = row0 + j;
    const wz = (row + 0.5) * WORLD / N;
    for (let i = 0; i < N; i++) {
      const h = fullHeights[row * N + i];
      if (h < -1) { out[j * N + i] = 0; continue; }
      const wx = (i + 0.5) * WORLD / N;
      let px = wx, py = h + 3, pz = wz, shade = 0;
      for (let s = 0; s < 92; s++) {
        px += sx * stepM; py += sy * stepM; pz += sz * stepM;
        if (py > 1450) break;
        if (nearestH(px, pz) > py) { shade = 255; break; }
      }
      out[j * N + i] = shade;
    }
    if (j % report === 0) self.postMessage({ type: 'progress', task: 'shadow', done: j / rn });
  }
  self.postMessage({ type: 'shadowRows', row0, row1, shadow: out }, [out.buffer]);
}

function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z, period, s) {
  const fx = x * period, fy = y * period, fz = z * period;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = smooth(fx - ix), ty = smooth(fy - iy), tz = smooth(fz - iz);
  const wrap = v => ((v % period) + period) % period;
  const x0 = wrap(ix), x1 = wrap(ix + 1), y0 = wrap(iy), y1 = wrap(iy + 1), z0 = wrap(iz), z1 = wrap(iz + 1);
  function c(a, b, cc) { return hash3(a, b, cc, s); }
  const c000 = c(x0, y0, z0), c100 = c(x1, y0, z0), c010 = c(x0, y1, z0), c110 = c(x1, y1, z0);
  const c001 = c(x0, y0, z1), c101 = c(x1, y0, z1), c011 = c(x0, y1, z1), c111 = c(x1, y1, z1);
  const a = (c000 + (c100 - c000) * tx) * (1 - ty) + (c010 + (c110 - c010) * tx) * ty;
  const b = (c001 + (c101 - c001) * tx) * (1 - ty) + (c011 + (c111 - c011) * tx) * ty;
  return a + (b - a) * tz;
}
function genCloud() {
  const CS = cloudCS;
  const out = new Uint8Array(CS * CS * CS);
  const periods = [8, 16, 32, 64];
  const amps = [0.53, 0.26, 0.14, 0.07];
  for (let z = 0; z < CS; z++) {
    for (let y = 0; y < CS; y++) {
      for (let x = 0; x < CS; x++) {
        let n = 0;
        const u = x / CS, v = y / CS, w = z / CS;
        for (let o = 0; o < 4; o++) n += vnoise3(u, v, w, periods[o], SEED + 200 + o * 17) * amps[o];
        // torus-ish vertical shaping so the volume stacks into puff towers
        let val = n;
        val *= 0.82 + 0.18 * vnoise3(u, v, w, 122, SEED + 502);
        out[(z * CS + y) * CS + x] = Math.max(0, Math.min(255, (val - 0.20) / 0.62 * 255));
      }
    }
    if (z % 8 === 0) self.postMessage({ type: 'progress', task: 'cloud', done: z / CS });
  }
  self.postMessage({ type: 'cloud', data: out, CS }, [out.buffer]);
}

self.onmessage = function (e) {
  const m = e.data;
  if (m.type === 'init') {
    N = m.N; WORLD = m.WORLD; SEED = m.seed; SUN = m.sun; cloudCS = m.cloudCS || 128;
  } else if (m.type === 'gen') genRows(m);
  else if (m.type === 'shadow') shadowRows(m);
  else if (m.type === 'cloud') genCloud();
};
`;

// ---------------------------------------------------------------------------
class WorldMap {
  constructor(heights, forest, tint, shadow, minH, maxH, cloudTex, cloudN) {
    this.N = HMAP_N;
    this.heights = heights;
    this.forest = forest;
    this.tint = tint;
    this.shadow = shadow;
    this.minH = minH;
    this.maxH = maxH;
    this.cloudTex = cloudTex;
    this.cloudN = cloudN;
    this.cloudDriftX = 0;
    this.cloudDriftZ = 0;
    this._c = { x: 0, y: 0, z: 0 };
  }
  _wrapIdx(i, n) { return ((i % n) + n) % n; }
  heightAt(x, z) {
    const N = this.N;
    let fx = x / WORLD_SIZE * N, fz = z / WORLD_SIZE * N;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const x0 = this._wrapIdx(ix, N), x1 = this._wrapIdx(ix + 1, N);
    const z0 = this._wrapIdx(iz, N), z1 = this._wrapIdx(iz + 1, N);
    const H = this.heights;
    const a = H[z0 * N + x0], b = H[z0 * N + x1], c = H[z1 * N + x0], d = H[z1 * N + x1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  heightUV(u, v) {
    const N = this.N;
    let fx = u * N, fz = v * N;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const x0 = this._wrapIdx(ix, N), x1 = this._wrapIdx(ix + 1, N);
    const z0 = this._wrapIdx(iz, N), z1 = this._wrapIdx(iz + 1, N);
    const H = this.heights;
    const a = H[z0 * N + x0], b = H[z0 * N + x1], c = H[z1 * N + x0], d = H[z1 * N + x1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  slopeAt(x, z) {
    const e = CELL * 1.5;
    const h = this.heightAt(x, z);
    const hx = this.heightAt(x + e, z), hz = this.heightAt(x, z + e);
    return Math.hypot(hx - h, hz - h) / e;
  }
  forestAt(x, z) {
    const N = this.N;
    const fx = x / WORLD_SIZE * N, fz = z / WORLD_SIZE * N;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const x0 = this._wrapIdx(ix, N), x1 = this._wrapIdx(ix + 1, N);
    const z0 = this._wrapIdx(iz, N), z1 = this._wrapIdx(iz + 1, N);
    const F = this.forest;
    const a = F[z0 * N + x0], b = F[z0 * N + x1], c = F[z1 * N + x0], d = F[z1 * N + x1];
    return ((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz) / 255;
  }
  shadowAt(x, z) {
    const N = this.N;
    let ix = Math.floor(x / WORLD_SIZE * N) % N; if (ix < 0) ix += N;
    let iz = Math.floor(z / WORLD_SIZE * N) % N; if (iz < 0) iz += N;
    return this.shadow[iz * N + ix] / 255;
  }
  // --- trilinear cloud volume sample, matching the GLSL ---
  _tex3(u, v, w) {
    const N = this.cloudN, T = this.cloudTex;
    u = u - Math.floor(u); w = w - Math.floor(w);
    v = clamp(v, 0.002, 0.998);
    const fx = u * N, fy = v * (N - 1), fz = w * N;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const w0 = ((ix % N) + N) % N, w1 = (w0 + 1) % N;
    const z0 = ((iz % N) + N) % N, z1 = (z0 + 1) % N;
    const y0 = clamp(iy, 0, N - 2), y1 = y0 + 1;
    const idx = (y, z, x) => (z * N + y) * N + x;
    const c000 = T[idx(y0, z0, w0)], c100 = T[idx(y0, z0, w1)];
    const c010 = T[idx(y1, z0, w0)], c110 = T[idx(y1, z0, w1)];
    const c001 = T[idx(y0, z1, w0)], c101 = T[idx(y0, z1, w1)];
    const c011 = T[idx(y1, z1, w0)], c111 = T[idx(y1, z1, w1)];
    const a = (c000 + (c100 - c000) * tx) * (1 - ty) + (c010 + (c110 - c010) * tx) * ty;
    const b = (c001 + (c101 - c001) * tx) * (1 - ty) + (c011 + (c111 - c011) * tx) * ty;
    return (a + (b - a) * tz) / 255;
  }
  cloudDensity(x, y, z) {
    if (y < CLOUD_BASE - 20 || y > CLOUD_TOP + 20) return 0;
    const hf = clamp01((y - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE));
    const dx = this.cloudDriftX, dz = this.cloudDriftZ;
    const c1 = this._tex3(x / CLOUD_SIZE + dx, hf * 0.42 + 0.06, z / CLOUD_SIZE + dz);
    const c2 = this._tex3(x / 2280 - dx * 1.6 + 0.31, hf * 0.28 + 0.52, z / 2280 + dz * 1.4 + 0.17);
    const n = c1 * 0.76 + c2 * 0.24;
    const vert = smoothstep(0.0, 0.10, hf) * (1 - smoothstep(0.68, 1.0, hf));
    return smoothstep(0.555, 0.705, n) * vert;
  }
  inCloud(x, y, z, threshold = 0.34) { return this.cloudDensity(x, y, z) > threshold; }
  // find a scenic alpine start point: forest in the foreground, a lake, and
  // snow-capped ridges in view (deterministic)
  findScenicSpawn(seed = 77) {
    const R = mulberry32(seed ^ 0x9e3779b9);
    let best = null, bestScore = -1;
    for (let k = 0; k < 340; k++) {
      const x = (R() - 0.5) * WORLD_SIZE * 0.8;
      const z = (R() - 0.5) * WORLD_SIZE * 0.8;
      const h = this.heightAt(x, z);
      if (h < 18 || h > 360) continue;
      if (this.slopeAt(x, z) > 0.55) continue;
      let water = 1e9, maxNear = 0, alpine = 0, forestNear = 0;
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * TAU;
        for (let d = 120; d <= 2350; d += 130) {
          const hh = this.heightAt(x + Math.cos(ang) * d, z + Math.sin(ang) * d);
          if (hh < -4) { water = Math.min(water, d); break; }
          if (d <= 1300) maxNear = Math.max(maxNear, hh);
          if (hh > 560) alpine += 0.7 + Math.min(1.4, (hh - 560) / 460);
          if (d >= 240 && d <= 900) forestNear += this.forestAt(x + Math.cos(ang) * d, z + Math.sin(ang) * d);
        }
      }
      if (water > 1400) continue;
      // favour the forest/snow ecotone: autumn woods nearby, a snowy massif
      // in the surroundings, and water for a scenic title shot
      const score = 120 - Math.abs(water - 620) * 0.055 + Math.min(maxNear, 900) * 0.03
        + this.forestAt(x, z) * 24 + forestNear * 1.15 + alpine * 2.0;
      if (score > bestScore) { bestScore = score; best = { x, z, h, water, maxNear, alpine, forestNear }; }
    }
    if (!best) {
      // fallback: center
      const x = 512, z = 512;
      best = { x, z, h: Math.max(20, this.heightAt(x, z)), water: 900, maxNear: 200, alpine: 0 };
    }
    // pick the most alpine-looking heading: snowy peaks, green forest below,
    // a lake in the middle distance. No sun-facing bias.
    let bestAng = 0, bestView = -1e9;
    for (let a = 0; a < 28; a++) {
      const ang = a / 28 * TAU;
      const cfx = Math.sin(ang), cfz = -Math.cos(ang);
      let snow = 0, forest = 0, water = 0, relief = 0, nearForest = 0, wall = 0;
      // sample a three-ray fan so the wide chase view can show autumn woods
      // on one side and snowy peaks on the other
      for (let s = -1; s <= 1; s++) {
        const aa = ang + s * 0.22;
        const fx = Math.sin(aa), fz = -Math.cos(aa);
        const sideW = s === 0 ? 1.0 : 0.62;
        for (let d = 180; d <= 2300; d += 130) {
          const px = best.x + fx * d, pz = best.z + fz * d;
          const hh = this.heightAt(px, pz);
          const ff = this.forestAt(px, pz);
          if (hh < -4) { water += (d < 1300 ? 1.25 : 0.65) * sideW; continue; }
          if (hh > 500) snow += (0.8 + Math.min(1.2, (hh - 500) / 400)) * sideW;
          if (hh > 900) snow += 0.4 * sideW;
          if (ff > 0.38 && hh < 700) forest += (d < 900 ? 1.0 : 0.55) * sideW;
          if (d < 700 && ff > 0.40 && hh < 560) nearForest += 0.5 * sideW;
          if (hh > 240) relief += 0.15 * sideW;
          // avoid aiming straight up a wall of terrain: keep the near
          // corridor below the aircraft's opening altitude
          if (d < 1200 && hh > best.h + 380) wall += (hh - (best.h + 380)) / 300 * sideW;
        }
      }
      const fgForest = this.forestAt(best.x + cfx * 320, best.z + cfz * 320);
      const fgForest2 = this.forestAt(best.x + cfx * 600, best.z + cfz * 600);
      // reward headings that contain both woods and snow (the product term),
      // with dense forest close to the jet and no wall of terrain ahead
      const both = Math.sqrt(Math.max(0, forest) * Math.max(0, snow));
      const v = both * 2.0 + nearForest * 1.5 + fgForest * 4.0 + fgForest2 * 3.0
        + water * 0.5 - wall * 3.5;
      if (v > bestView) { bestView = v; bestAng = ang; }
    }
    // slight offset keeps the massif off dead centre, which reads better
    return Object.assign(best, { heading: bestAng + 0.06 });
  }
}

async function generateWorld(seed, onProgress) {
  const workers = [];
  const makeWorker = () => {
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
    const w = new Worker(URL.createObjectURL(blob));
    w.postMessage({
      type: 'init', N: HMAP_N, WORLD: WORLD_SIZE, seed, cloudCS: CLOUD_N,
      sun: { x: SUN_DIR.x, y: SUN_DIR.y, z: SUN_DIR.z }
    });
    w._pending = [];
    w.addEventListener('message', ev => {
      const m = ev.data;
      if (m.type === 'progress') { if (w._onProgress) w._onProgress(m); }
      else if (w._resolve) { const fn = w._resolve; w._resolve = null; fn(m); }
    });
    workers.push(w);
    return w;
  };
  const request = (w, msg) => new Promise(resolve => { w._resolve = resolve; w.postMessage(msg); });

  const progress = { height: [0, 0, 0], shadow: [0, 0, 0], cloud: 0 };
  const report = () => {
    const h = (progress.height[0] + progress.height[1] + progress.height[2]) / 3;
    const sh = (progress.shadow[0] + progress.shadow[1] + progress.shadow[2]) / 3;
    const frac = h * 0.40 + progress.cloud * 0.10 + sh * 0.50;
    const label = frac < 0.38 ? '绘制湖泊与山脊' : frac < 0.9 ? '烘焙山脊阴影' : '播撒积云';
    onProgress && onProgress(Math.min(1, frac), label);
  };

  const terrainWorkers = [makeWorker(), makeWorker(), makeWorker()];
  const cloudWorker = makeWorker();
  const heights = new Float32Array(HMAP_N * HMAP_N);
  const forest = new Uint8Array(HMAP_N * HMAP_N);
  const tint = new Uint8Array(HMAP_N * HMAP_N);
  let minH = 1e9, maxH = -1e9;

  const rowChunks = [
    [0, Math.ceil(HMAP_N / 3)],
    [Math.ceil(HMAP_N / 3), Math.ceil(HMAP_N * 2 / 3)],
    [Math.ceil(HMAP_N * 2 / 3), HMAP_N],
  ];
  const heightJobs = terrainWorkers.map((w, i) => {
    w._onProgress = m => { if (m.task === 'height') { progress.height[i] = m.done; report(); } };
    return request(w, { type: 'gen', row0: rowChunks[i][0], row1: rowChunks[i][1] }).then(m => {
      for (let j = 0; j < m.row1 - m.row0; j++) {
        const src = j * HMAP_N, dst = (m.row0 + j) * HMAP_N;
        heights.set(m.heights.subarray(src, src + HMAP_N), dst);
        forest.set(m.forest.subarray(src, src + HMAP_N), dst);
        tint.set(m.tint.subarray(src, src + HMAP_N), dst);
      }
      minH = Math.min(minH, m.minH); maxH = Math.max(maxH, m.maxH);
      progress.height[i] = 1; report();
    });
  });
  cloudWorker._onProgress = m => { if (m.task === 'cloud') { progress.cloud = m.done; report(); } };
  const cloudJob = request(cloudWorker, { type: 'cloud' });
  await Promise.all([...heightJobs, cloudJob.then(m => {
    progress.cloud = 1; report(); return m;
  })]);
  const cloudMsg = await cloudJob;

  // Bake shadows in parallel using the finished height field.
  const shadow = new Uint8Array(HMAP_N * HMAP_N);
  const shadowJobs = terrainWorkers.map((w, i) => {
    const [r0, r1] = rowChunks[i];
    progress.shadow[i] = 0;
    w._onProgress = m => { if (m.task === 'shadow') { progress.shadow[i] = m.done; report(); } };
    const copy = heights.slice();
    return request(w, { type: 'shadow', heights: copy, row0: r0, row1: r1 }).then(m => {
      shadow.set(m.shadow, r0 * HMAP_N);
      progress.shadow[i] = 1; report();
    });
  });
  await Promise.all(shadowJobs);
  report();

  workers.forEach(w => w.terminate());
  const map = new WorldMap(heights, forest, tint, shadow, minH, maxH, new Uint8Array(cloudMsg.data), cloudMsg.CS);
  return map;
}

// A tiny CPU-side 2D dither helper shared by ground scatter.
function findFlatSpot(map, cx, cz, radiusMin, radiusMax, maxSlope = 0.32, hMin = 4, hMax = 500, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const ang = rand() * TAU;
    const d = lerp(radiusMin, radiusMax, Math.sqrt(rand()));
    const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
    const h = map.heightAt(x, z);
    if (h < hMin || h > hMax) continue;
    if (map.slopeAt(x, z) > maxSlope) continue;
    return { x, z, h };
  }
  return null;
}

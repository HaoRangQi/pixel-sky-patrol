// Prototype of the height field to calibrate land/water/mountain distribution.
const N = 1024, SEED = 1337;
function ihash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2147483647);
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
  h += sstep(0.45,0.72, fbm(uu+0.6, vv+0.2, 3, 3, SEED+77)) * 130;
  return h;
}
// sample histogram + water fraction
let below = 0, total = 0, sum = 0;
const hist = new Array(24).fill(0);
const step = 4;
const heights = new Float32Array((N / step) * (N / step));
for (let y = 0; y < N; y += step) {
  for (let x = 0; x < N; x += step) {
    const h = heightAt(x / N, y / N);
    heights[(y / step) * (N / step) + x / step] = h;
    total++; sum += h;
    if (h < 0) below++;
    hist[Math.max(0, Math.min(23, Math.floor((h + 200) / 100)))]++;
  }
}
console.log('mean height', (sum / total).toFixed(1), 'water %', (below / total * 100).toFixed(1));
hist.forEach((c, i) => console.log(`${(i * 100 - 200).toString().padStart(5)}m .. ${(i * 100 - 100).toString().padStart(5)}m  ${(c / total * 100).toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(c / total * 120))}`));
// ascii map (72 x 30)
const W = 72, H = 30;
let out = '';
const chars = ' .:~-=+*#%@';
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const u = i / W, v = j / H;
    const h = heightAt(u, v);
    let c;
    if (h < -20) c = ' ';
    else if (h < 0) c = '.';
    else if (h < 40) c = ':';
    else if (h < 120) c = '~';
    else if (h < 250) c = '-';
    else if (h < 400) c = '=';
    else if (h < 600) c = '+';
    else if (h < 800) c = '*';
    else c = '#';
    out += c;
  }
  out += '\n';
}
console.log(out);
// wrap check
const e = 1e-5;
console.log('wrap seam diff (should be tiny):', Math.abs(heightAt(0, 0.3) - heightAt(1 - e, 0.3)).toFixed(3), Math.abs(heightAt(0.3, 0) - heightAt(0.3, 1 - e)).toFixed(3));

// Independent SKY terrain adapter; arrays retain WorldMap's 8192m periodic grid.
function skyApplyLakeValley(map, seed, onProgress) {
  const N = map.N, cell = WORLD_SIZE / N;
  const { heights, forest, tint, shadow } = map;
  const report = (fraction, label) => { if (typeof onProgress === 'function') onProgress(fraction, label); };
  const reportEvery = Math.max(1, Math.floor(N / 10));
  seed |= 0;
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function hash(x, z, salt) {
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed ^ salt, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise(u, v, period, salt) {
    const x = u * period, z = v * period, ix = Math.floor(x), iz = Math.floor(z);
    const tx = smooth(0, 1, x - ix), tz = smooth(0, 1, z - iz);
    const x0 = (ix % period + period) % period, z0 = (iz % period + period) % period;
    const x1 = (x0 + 1) % period, z1 = (z0 + 1) % period;
    const a = hash(x0, z0, salt), b = hash(x1, z0, salt), c = hash(x0, z1, salt), d = hash(x1, z1, salt);
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  // 两岸各有自己的控制点；周期样条在地图接缝处保留水路宽度和切线。
  const banks = [
    [2480, 3610], [2570, 3840], [2280, 4840], [2050, 4620],
    [2600, 4100], [3080, 5060], [3250, 5970], [3650, 6320],
    [3590, 5640], [3850, 4560], [3040, 4900], [2430, 5400],
    [2720, 5760], [3340, 5450], [3320, 4730], [2840, 4420],
  ];
  function bankAt(v, side) {
    const k = v * banks.length, j = Math.floor(k), t = k - j;
    const at = off => banks[(j + off + banks.length) % banks.length][side];
    const a = at(-1), b = at(0), c = at(1), d = at(2);
    return b + 0.5 * t * ((c - a) + t * ((2*a - 5*b + 4*c - d) + t * (3*(b - c) + d - a)));
  }
  // 长轴错开的山脊与岛脊，不随距湖心的距离抬升。参数：中心、两轴半径、倾斜、相对高度。
  const spines = [
    [1270, 5110, 1390, 1980, -0.36, 825], [2070, 3980, 1030, 1400, -0.57, 540],
    [1680, 4560, 860, 1200, 0.45, 670],
    [1080, 2640, 950, 1330, 0.44, 670], [1270, 770, 1560, 1600, 0.50, 1070],
    [440, 7350, 900, 1140, -0.45, 570], [7100, 5930, 1110, 1940, 0.55, 610],
    [7050, 3190, 1450, 2010, -0.40, 930], [6570, 2710, 1260, 1150, 0.40, 740],
    [5940, 1740, 1040, 1340, -0.55, 825],
    [5200, 7900, 950, 1130, -0.65, 725], [7840, 600, 1000, 1150, 0.32, 640],
    [3980, 6110, 655, 420, 0.55, 165], [4310, 5960, 400, 320, -0.38, 132],
    [4730, 5460, 250, 365, -0.58, 125], [5080, 3580, 465, 675, 0.56, 199],
    [4810, 3360, 310, 310, 0.35, 154], [3960, 2860, 300, 255, -0.75, 127],
    [3220, 1280, 290, 460, -0.55, 178], [3520, 7320, 265, 230, 0.48, 132],
  ];
  const wrapDelta = d => d - WORLD_SIZE * Math.round(d / WORLD_SIZE);
  // 东部内陆：林地沿斜出的丘肩探入草谷，支谷则切开更高的外脊。两端在地图接缝前接回旧地形。
  const rows = [], inlandWood = new Uint8Array(N * N);
  const shoulders = [[-1, 6710, -0.40, 275, 116], [1, 5630, 0.34, 325, 139],
    [-1, 4440, 0.37, 310, 128], [1, 3230, -0.34, 265, 151]];
  const ravines = [[-1, 6100, -0.42, 275], [-1, 3650, 0.34, 240]];
  for (let z = 0; z < N; z++) {
    const wz = z * cell, t = (7200 - wz) / 5600, a = t * 2 * Math.PI;
    rows.push({ mix: smooth(1450, 2000, wz) * (1 - smooth(7300, 7750, wz)),
      axis: 6898 + 100*t + 80*Math.sin(a*1.15+.55) + 35*Math.sin(a*2.7+2.1),
      floor: 100 + 30*Math.sin(a*.9+.4) + 13*Math.sin(a*2.35+1.7),
      ridges: [724 + 151*Math.sin(a*1.05+2.2) + 45*Math.sin(a*2.5+1.4), 763 + 171*Math.sin(a*1.3+1.1) + 54*Math.sin(a*2.9+.6)],
      crests: [371 + 90*Math.sin(a*1.15+.2) + 72*Math.sin(a*2.6+2), 346 + 104*Math.sin(a*.8+1.9) + 77*Math.sin(a*2.2+.3)],
      belt: a*3.1 });
  }
  const inlandWeight = (row, dx) => row.mix * (1 - smooth(690, dx < 0 ? 1150 : 1080, Math.abs(dx)));
  let minH = Infinity, maxH = -Infinity;
  for (let z = 0; z < N; z++) {
    const v = z / N, wz = z * cell, left = bankAt(v, 0), right = bankAt(v, 1);
    const braid = smooth(1450, 2250, wz) * (1 - smooth(2380, 3360, wz));
    const crossSections = [];
    for (const [cx, cz, rx, rz, tilt, top] of spines) {
      const dz = wrapDelta(wz - cz), slice = 1 - (dz / rz) ** 2;
      if (slice > 0) crossSections.push({ x: cx + tilt * dz, width: rx * Math.sqrt(slice), top: top * slice * slice });
    }
    for (let x = 0; x < N; x++) {
      const u = x / N, i = z * N + x, wx = x * cell;
      const broad = noise(u, v, 7, 11), detail = noise(u, v, 19, 23);
      const warp = (broad - 0.5) * 340 + (detail - 0.5) * 105;
      const shoreX = wx + warp;
      let shore = Math.max(left - shoreX, shoreX - right);
      // 西汊从主水道分出，绕过林地长洲，再从下一处河口汇入。
      shore = Math.min(shore, Math.max(left + 170 - 1480 * braid - shoreX, shoreX - (left + 540 - 1080 * braid)));
      const dry = smooth(30, 1150, shore);
      let h = -55 + 52 * smooth(-620, -46, shore) + 30 * smooth(-64, 220, shore);
      h += dry * (29 + 89 * broad + 25 * detail);
      let relief = 0;
      for (const section of crossSections) {
        const dx = Math.abs(wrapDelta(wx + warp * 0.66 - section.x)) / section.width;
        if (dx >= 1) continue;
        const edge = 1 - dx * dx;
        relief = Math.max(relief, section.top * edge * edge * (1 - dx * 0.35));
      }
      // 把沟壑刻进实体坡面；岛、谷口和平地不共享一圈统一的山肩。
      const crease = Math.abs(noise(u, v, 14, 31) * 2 - 1);
      h += relief * (0.79 + 0.24 * broad - 0.17 * crease + 0.09 * detail);
      const row = rows[z], dx = wx - row.axis, weight = inlandWeight(row, dx);
      if (weight > 0) {
        const side = dx < 0 ? -1 : 1, k = dx < 0 ? 0 : 1, d = Math.abs(dx);
        const bank = d + (broad-.5)*94, ridge = row.ridges[k];
        // 宽脊有内外两个下坡方向；副脊与主脊斜交而非阶梯式同时封顶。
        const crest = (bank-ridge)/(355+100*broad), shoulder = (bank-.68*ridge)/(225+55*detail);
        let rise = smooth(115,560,bank) * ((k ? .97 : .76)*row.crests[k]*Math.exp(-crest*crest)*(.79+.38*broad-.10*crease+.10*detail)
          + 74*Math.exp(-shoulder*shoulder) + 30*smooth(210,895,bank));
        let wood = 0;
        for (const [which,cz,tilt,width,peak] of shoulders) {
          if (which !== side && d > 230) continue;
          const lateral = dx*which, across = (wz-cz-tilt*(lateral-240) + (detail-.5)*100)/width;
          const finger = Math.exp(-across*across) * smooth(-135,220,lateral) * (1-smooth(660,880,lateral));
          rise += peak*finger;
          wood = Math.max(wood, .84*smooth(.16,.61,finger));
        }
        let cut = 0;
        for (const [which,cz,tilt,width] of ravines) if (side === which) {
          cut = Math.max(cut, (1-smooth(105,width,Math.abs(wz-cz-tilt*(d-260)))) * smooth(210,330,d));
        }
        rise = rise*(1-.72*cut) + 55*cut*smooth(280,900,d);
        if (side > 0) {
          // 东北向侧谷从内部整片草场越过中脊，谷口边缘缓升至两座独立的山肩。
          const offset = wz - (4820 - .47*(wx-6970));
          const window = Math.exp(-((offset/350)**2)) * smooth(260,530,d);
          rise = rise*(1-.89*window) + 53*window*smooth(340,1050,d);
        }
        const floor = row.floor + (broad-.5)*18 + (detail-.5)*14;
        h += (floor + rise - h) * weight;
        const belt = smooth(.24,.67,.5+.5*Math.sin(row.belt+(k?1.4:3.9)+(broad-.5)*2.3));
        wood = Math.max(wood, smooth(5,32,rise)*(1-smooth(245,365,rise))*(.14+.67*belt));
        inlandWood[i] = Math.round(255 * (.035 + wood*(.83+.16*detail)));
      }
      heights[i] = h;
      minH = Math.min(minH, heights[i]); maxH = Math.max(maxH, heights[i]);
      tint[i] = Math.round(85 + noise(u + 0.13, v + 0.29, 9, 88) * 160);
    }
    if ((z + 1) % reportEvery === 0) report((z + 1) / N * 0.22, '绘制湖湾、汊口与断续山脊');
  }
  map.minH = minH; map.maxH = maxH;

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x, h = heights[i];
      forest[i] = 0;
      if (h < 8 || h > 640) continue;
      let dry = true;
      // A one-texel dry margin also prevents bilinear forest interpolation into the lake.
      for (let dz = -1; dz <= 1 && dry; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (heights[((z + dz + N) % N) * N + (x + dx + N) % N] < 8) { dry = false; break; }
      }
      if (!dry) continue;
      const left = heights[z * N + (x + N - 1) % N], right = heights[z * N + (x + 1) % N];
      const down = heights[((z + N - 1) % N) * N + x], up = heights[((z + 1) % N) * N + x];
      const slope = Math.hypot(right - left, up - down) / (cell * 2);
      const grove = smooth(0.34, 0.65, noise(x / N + 0.37, z / N + 0.71, 10, 55));
      const patch = noise(x / N, z / N, 24, 66);
      const copse = smooth(0.30, 0.65, 0.64 * patch + 0.36 * noise(x / N, z / N, 8, 103));
      const cover = Math.min(0.84, 0.09 + copse * 0.59 + grove * (0.22 + 0.15 * patch));
      const shores = 255 * cover * smooth(8, 29, h) * (1 - smooth(370, 640, h)) * (1 - smooth(0.36, 0.68, slope));
      const weight = inlandWeight(rows[z], x * cell - rows[z].axis);
      const woods = Math.min(218, inlandWood[i]) * (1-smooth(.36,.50,slope)) * (1-smooth(490,640,h));
      forest[i] = Math.round(shores + (woods - shores)*weight);
    }
    if ((z + 1) % reportEvery === 0) report(0.22 + (z + 1) / N * 0.20, '播种湖岸疏林');
  }

  // Bake the engine's 92 x 26m sun rays against the finished, bilinear periodic field.
  const rays = [];
  for (let s = 1; s <= 92; s++) {
    const t = s * 26, dx = SUN_DIR.x * t / cell, dz = SUN_DIR.z * t / cell;
    const ix = Math.floor(dx), iz = Math.floor(dz);
    rays.push({ ix, iz, tx: dx - ix, tz: dz - iz, rise: 3 + SUN_DIR.y * t });
  }
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x, h = heights[i];
    shadow[i] = 0;
    if (h < 0) continue;
    for (const ray of rays) {
      if (h + ray.rise > maxH) break;
      const x0 = (x + ray.ix + N) % N, x1 = (x0 + 1) % N;
      const z0 = (z + ray.iz + N) % N, z1 = (z0 + 1) % N;
      const a = heights[z0 * N + x0], b = heights[z0 * N + x1];
      const c = heights[z1 * N + x0], d = heights[z1 * N + x1];
      const blocker = (a + (b - a) * ray.tx) * (1 - ray.tz) + (c + (d - c) * ray.tx) * ray.tz;
      if (blocker > h + ray.rise) { shadow[i] = 255; break; }
    }
    if (x === N - 1 && (z + 1) % reportEvery === 0) report(0.42 + (z + 1) / N * 0.58, '重算湖谷地形阴影');
  }
  report(1, '湖谷地形与阴影就绪');
  return map;
}
const SKY_LAKE_APPLY_SOURCE = skyApplyLakeValley.toString();

async function skyApplyLakeValleyOffThread(map, seed, onProgress) {
  if (typeof Worker !== 'function') return skyApplyLakeValley(map, seed, onProgress);
  if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Lake terrain worker requires Blob URLs');
  }
  const source = `const WORLD_SIZE = 8192; let SUN_DIR;\nconst skyApplyLakeValley = ${SKY_LAKE_APPLY_SOURCE};\n` +
    `self.onmessage = ({ data }) => {\n  SUN_DIR = data.sun;\n  const map = { N: data.N, heights: new Float32Array(data.heights), forest: new Uint8Array(data.forest), tint: new Uint8Array(data.tint), shadow: new Uint8Array(data.shadow) };\n` +
    `  try {\n    skyApplyLakeValley(map, data.seed, (fraction, label) => self.postMessage({ type: 'progress', fraction, label }));\n` +
    `    self.postMessage({ type: 'done', minH: map.minH, maxH: map.maxH, heights: map.heights.buffer, forest: map.forest.buffer, tint: map.tint.buffer, shadow: map.shadow.buffer }, [map.heights.buffer, map.forest.buffer, map.tint.buffer, map.shadow.buffer]);\n` +
    `  } catch (error) { self.postMessage({ type: 'error', message: error && error.message || String(error) }); }\n};`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker;
  try { worker = new Worker(url); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
  const arrays = { heights: map.heights.slice(), forest: map.forest.slice(), tint: map.tint.slice(), shadow: map.shadow.slice() };
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, message) => {
      if (settled) return;
      settled = true;
      worker.terminate(); URL.revokeObjectURL(url);
      if (error) { reject(error); return; }
      const result = Object.fromEntries(Object.keys(arrays).map(key => [key,
        key === 'heights' ? new Float32Array(message[key]) : new Uint8Array(message[key])]));
      for (const key of Object.keys(arrays)) {
        if (result[key].length !== map[key].length) { reject(new Error(`Lake worker returned an invalid ${key} array`)); return; }
      }
      for (const key of Object.keys(arrays)) map[key].set(result[key]);
      map.minH = message.minH; map.maxH = message.maxH;
      resolve(map);
    };
    worker.onmessage = event => {
      const message = event.data;
      if (message.type === 'progress') {
        try { onProgress?.(Math.max(0, Math.min(1, message.fraction)), message.label); }
        catch (error) { finish(error); }
      } else if (message.type === 'error') finish(new Error(message.message));
      else if (message.type === 'done') finish(null, message);
    };
    worker.onerror = event => finish(event.error || new Error(event.message || 'Lake terrain worker failed'));
    try {
      worker.postMessage({ type: 'apply', N: map.N, seed, sun: { x: SUN_DIR.x, y: SUN_DIR.y, z: SUN_DIR.z },
        heights: arrays.heights.buffer, forest: arrays.forest.buffer, tint: arrays.tint.buffer, shadow: arrays.shadow.buffer },
      [arrays.heights.buffer, arrays.forest.buffer, arrays.tint.buffer, arrays.shadow.buffer]);
    } catch (error) { finish(error); }
  });
}

// Preserve the engine's worker-built map and replace its landscape only after it resolves.
const skyGenerateBaseWorld = generateWorld;
generateWorld = async function (seed, onProgress) {
  let progress = 0;
  const report = (fraction, label) => {
    progress = Math.max(progress, Math.max(0, Math.min(1, Number(fraction) || 0)));
    if (typeof onProgress === 'function') onProgress(progress, label);
  };
  const map = await skyGenerateBaseWorld(seed, typeof onProgress === 'function'
    ? (fraction, label) => report((Number(fraction) || 0) * 0.7, label) : undefined);
  await skyApplyLakeValleyOffThread(map, seed, typeof onProgress === 'function'
    ? (fraction, label) => report(0.7 + Math.max(0, Math.min(1, fraction)) * 0.3, label) : undefined);
  return map;
};

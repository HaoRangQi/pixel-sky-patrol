// ---------------------------------------------------------------------------
// Deterministic, periodic forest cache and instanced tree batches.
// ---------------------------------------------------------------------------
const Forest = (() => {
  const SPACING = 20.48;
  const CELLS = Math.round(WORLD_SIZE / SPACING);
  const BLOCK_CELLS = 10;
  const MAX_TREES = 8800;
  const DRAW_RANGE = 2200;
  const clampForest = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothForest = (a, b, x) => {
    const t = clampForest((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function hash(x, z, seed, salt = 0) {
    let h = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5) ^ Math.imul(salt | 0, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  function valueNoise(x, z, seed, period) {
    const px = x / CELLS * period, pz = z / CELLS * period;
    const ix = Math.floor(px), iz = Math.floor(pz), tx = px - ix, tz = pz - iz;
    const x0 = ((ix % period) + period) % period, z0 = ((iz % period) + period) % period;
    const x1 = (x0 + 1) % period, z1 = (z0 + 1) % period;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const a = hash(x0, z0, seed), b = hash(x1, z0, seed), c = hash(x0, z1, seed), d = hash(x1, z1, seed);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  }
  function cellShade(map, x, z, shade) {
    const n = map.N, cell = WORLD_SIZE / n, radius = cell * 1.8;
    const wx = x - Math.floor(x / WORLD_SIZE) * WORLD_SIZE, wz = z - Math.floor(z / WORLD_SIZE) * WORLD_SIZE;
    const cx = Math.floor(wx / cell), cz = Math.floor(wz / cell);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const ix = (cx + dx + n) % n, iz = (cz + dz + n) % n, at = iz * n + ix;
      if (map.heights[at] <= 0) continue;
      let ox = (dx + 0.5) * cell - (wx - cx * cell), oz = (dz + 0.5) * cell - (wz - cz * cell);
      if (ox > WORLD_SIZE * 0.5) ox -= WORLD_SIZE; else if (ox < -WORLD_SIZE * 0.5) ox += WORLD_SIZE;
      if (oz > WORLD_SIZE * 0.5) oz -= WORLD_SIZE; else if (oz < -WORLD_SIZE * 0.5) oz += WORLD_SIZE;
      const falloff = Math.max(0, 1 - Math.hypot(ox, oz) / radius);
      if (!falloff) continue;
      map.treeShade[at] = Math.min(map.treeShade[at], Math.round(255 - (255 - shade) * falloff * falloff));
    }
  }
  function castShadow(map, tree, seed) {
    const angle = Math.atan2(tree.sinYaw, tree.cosYaw);
    const sx = -SUN_DIR.x, sz = -SUN_DIR.z, sl = Math.hypot(sx, sz) || 1;
    const length = 9 + hash(tree.gx, tree.gz, seed, 8) * 10;
    const x = tree.x + sx / sl * length, z = tree.z + sz / sl * length;
    // The root is lightly shaded; a compact, offset patch reads as a short crown shadow.
    cellShade(map, tree.x, tree.z, 190);
    cellShade(map, tree.x + Math.cos(angle) * 4, tree.z - Math.sin(angle) * 4, 205);
    cellShade(map, x, z, 170);
    cellShade(map, x + sx / sl * 5, z + sz / sl * 5, 205);
  }
  function init(map, seed) {
    const trees = [], blocks = new Array((CELLS / BLOCK_CELLS) ** 2);
    for (let bz = 0; bz < CELLS / BLOCK_CELLS; bz++) for (let bx = 0; bx < CELLS / BLOCK_CELLS; bx++) {
      blocks[bz * (CELLS / BLOCK_CELLS) + bx] = { x: (bx + 0.5) * BLOCK_CELLS * SPACING, z: (bz + 0.5) * BLOCK_CELLS * SPACING, trees: [] };
    }
    map.treeShade = new Uint8Array(map.N * map.N);
    map.treeShade.fill(255);
    for (let gz = 0; gz < CELLS; gz++) for (let gx = 0; gx < CELLS; gx++) {
      const jx = hash(gx, gz, seed, 1), jz = hash(gx, gz, seed, 2);
      const x = (gx + 0.5 + (jx - 0.5) * 0.46) * SPACING;
      const z = (gz + 0.5 + (jz - 0.5) * 0.46) * SPACING;
      const h = map.heightAt(x, z);
      if (h < 8 || h > 680 || map.slopeAt(x, z) > 0.46) continue;
      const forest = map.forestAt(x, z);
      if (forest < 0.36) continue;
      const patch = valueNoise(gx, gz, seed ^ 0x5bd1e995, 14);
      const density = smoothForest(0.35, 0.72, forest) * (0.24 + patch * 0.76);
      if (hash(gx, gz, seed, 3) > density) continue;
      const localAutumn = valueNoise(gx, gz, seed ^ 0x6d2b79f5, 28);
      const autumn = hash(gx, gz, seed, 4) < 0.07 + localAutumn * 0.22;
      const yaw = hash(gx, gz, seed, 5) * Math.PI * 2;
      const tree = { gx, gz, x, y: h, z, yaw, cosYaw: Math.cos(yaw), sinYaw: Math.sin(yaw),
        scale: 0.8 + hash(gx, gz, seed, 6) * 0.45,
        width: 0.88 + hash(gx, gz, seed, 7) * 0.32,
        brightness: 0.82 + hash(gx, gz, seed, 9) * 0.28,
        autumn, crownRadius: autumn ? 12 : 10.5, height: autumn ? 25 : 36 };
      trees.push(tree);
      blocks[Math.floor(gz / BLOCK_CELLS) * (CELLS / BLOCK_CELLS) + Math.floor(gx / BLOCK_CELLS)].trees.push(tree);
      castShadow(map, tree, seed);
    }
    return { map, seed, trees, blocks };
  }
  let state = null;
  function visible(tree, dx, dz, cam, tan, aspect, height, top) {
    const dy = tree.y + tree.height * tree.scale * 0.5 - cam.pos.y;
    const depth = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
    const radius = Math.hypot(tree.crownRadius * tree.width * tree.scale, tree.height * tree.scale * 0.62);
    const depthLimit = DRAW_RANGE + (top ? Math.max(0, cam.pos.y - tree.y) : 0);
    if (depth < -radius || depth > depthLimit + radius) return false;
    if (Math.abs(dx * cam.right.x + dy * cam.right.y + dz * cam.right.z) > (Math.max(0, depth) + radius) * tan * aspect + radius) return false;
    if (Math.abs(dx * cam.up.x + dy * cam.up.y + dz * cam.up.z) > (Math.max(0, depth) + radius) * tan + radius) return false;
    const crownPixels = tree.crownRadius * tree.width * tree.scale * height / Math.max(1, (Math.max(depth, 1) + radius * 0.25) * tan);
    return crownPixels >= 0.8;
  }
  function collect(camera, player, meshes, view = {}) {
    if (!state) return [];
    const cam = camera, tan = Math.tan(cam.fov * 0.5), aspect = view.aspect || cam.aspect || 1.8, height = view.height || 640;
    const nearby = [];
    const camX = cam.pos.x - Math.floor(cam.pos.x / WORLD_SIZE) * WORLD_SIZE;
    const camZ = cam.pos.z - Math.floor(cam.pos.z / WORLD_SIZE) * WORLD_SIZE;
    for (const block of state.blocks) {
      let bx = block.x - camX, bz = block.z - camZ;
      if (bx > WORLD_SIZE * 0.5) bx -= WORLD_SIZE; else if (bx < -WORLD_SIZE * 0.5) bx += WORLD_SIZE;
      if (bz > WORLD_SIZE * 0.5) bz -= WORLD_SIZE; else if (bz < -WORLD_SIZE * 0.5) bz += WORLD_SIZE;
      if (Math.hypot(bx, bz) > DRAW_RANGE + BLOCK_CELLS * SPACING * 0.72) continue;
      const blockDy = 340 - cam.pos.y, blockRadius = BLOCK_CELLS * SPACING * 0.72 + 360;
      const blockDepth = bx * cam.fwd.x + blockDy * cam.fwd.y + bz * cam.fwd.z;
      const blockDepthLimit = DRAW_RANGE + (view.top ? Math.max(0, cam.pos.y - 340) : 0);
      if (blockDepth < -blockRadius || blockDepth > blockDepthLimit + blockRadius) continue;
      for (const tree of block.trees) {
        let dx = tree.x - camX, dz = tree.z - camZ;
        if (dx > WORLD_SIZE * 0.5) dx -= WORLD_SIZE; else if (dx < -WORLD_SIZE * 0.5) dx += WORLD_SIZE;
        if (dz > WORLD_SIZE * 0.5) dz -= WORLD_SIZE; else if (dz < -WORLD_SIZE * 0.5) dz += WORLD_SIZE;
        if (Math.hypot(dx, dz) > DRAW_RANGE) continue;
        if (!visible(tree, dx, dz, cam, tan, aspect, height, view.top)) continue;
        const dy = tree.y + tree.height * tree.scale * 0.5 - cam.pos.y;
        nearby.push({ tree, distance2: dx * dx + dy * dy + dz * dz, x: cam.pos.x + dx, z: cam.pos.z + dz });
      }
    }
    nearby.sort((a, b) => a.distance2 - b.distance2 || a.tree.gz - b.tree.gz || a.tree.gx - b.tree.gx);
    if (nearby.length > MAX_TREES) nearby.length = MAX_TREES;
    const groups = [[], []];
    for (const item of nearby) {
      const t = item.tree, out = groups[t.autumn ? 1 : 0];
      out.push(item.x, t.y, item.z, t.scale, t.cosYaw, t.sinYaw, t.width, t.brightness);
    }
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return groups.map((values, i) => ({
      mesh: i === 0 ? meshes.pineTree : meshes.autumnTree,
      instances: new Float32Array(values), instanceCount: values.length / 8,
      outline: false, rim: false, dist: 0, matrix: identity,
    }));
  }
  return { init(map, seed) { state = init(map, seed | 0); return state.trees.length; }, collect };
})();

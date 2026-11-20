// ---------------------------------------------------------------------------
// Procedural low-poly meshes. Nose points toward -Z, +Y is up.
// Faces are non-indexed so shading stays flat; normals are oriented outward.
// ---------------------------------------------------------------------------
function hexRGB(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}
const rgb = hexRGB;

class MeshBuilder {
  constructor(center = { x: 0, y: 0, z: 0 }) {
    this.pos = []; this.nor = []; this.col = []; this.emi = [];
    this.center = center;
  }
  tri(a, b, c, color, emi = 0) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const cx = (a.x + b.x + c.x) / 3 - this.center.x;
    const cy = (a.y + b.y + c.y) / 3 - this.center.y;
    const cz = (a.z + b.z + c.z) / 3 - this.center.z;
    if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(nx, ny, nz);
      this.col.push(color[0], color[1], color[2]);
      this.emi.push(emi);
    }
  }
  quad(a, b, c, d, color, emi = 0) {
    this.tri(a, b, c, color, emi);
    this.tri(a, c, d, color, emi);
  }
  poly(points, color, emi = 0) {
    for (let i = 1; i < points.length - 1; i++) this.tri(points[0], points[i], points[i + 1], color, emi);
  }
  box(cx, cy, cz, sx, sy, sz, colors, emi = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const cs = Array.isArray(colors[0]) ? colors : [colors, colors, colors, colors, colors, colors];
    const p = {
      x0y0z0: { x: x0, y: y0, z: z0 }, x1y0z0: { x: x1, y: y0, z: z0 },
      x0y1z0: { x: x0, y: y1, z: z0 }, x1y1z0: { x: x1, y: y1, z: z0 },
      x0y0z1: { x: x0, y: y0, z: z1 }, x1y0z1: { x: x1, y: y0, z: z1 },
      x0y1z1: { x: x0, y: y1, z: z1 }, x1y1z1: { x: x1, y: y1, z: z1 },
    };
    this.quad(p.x1y1z0, p.x1y0z0, p.x0y0z0, p.x0y1z0, cs[0], emi); // front -z? labeled color 0
    this.quad(p.x0y1z1, p.x0y0z1, p.x1y0z1, p.x1y1z1, cs[1], emi);
    this.quad(p.x0y1z1, p.x1y1z1, p.x1y1z0, p.x0y1z0, cs[2], emi);
    this.quad(p.x0y0z0, p.x1y0z0, p.x1y0z1, p.x0y0z1, cs[3], emi);
    this.quad(p.x0y0z1, p.x1y0z1, p.x1y1z1, p.x0y1z1, cs[4], emi);
    this.quad(p.x1y0z0, p.x1y1z0, p.x1y1z1, p.x1y0z1, cs[5], emi);
    return this;
  }
  beam(a, b, halfW, halfH, color, emi = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dir = { x: dx / dl, y: dy / dl, z: dz / dl };
    const upRef = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    let sx = dir.y * upRef.z - dir.z * upRef.y;
    let sy = dir.z * upRef.x - dir.x * upRef.z;
    let sz = dir.x * upRef.y - dir.y * upRef.x;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * dir.z - sz * dir.y, uy = sz * dir.x - sx * dir.z, uz = sx * dir.y - sy * dir.x;
    const corners = (p) => [
      { x: p.x + sx * halfW + ux * halfH, y: p.y + sy * halfW + uy * halfH, z: p.z + sz * halfW + uz * halfH },
      { x: p.x - sx * halfW + ux * halfH, y: p.y - sy * halfW + uy * halfH, z: p.z - sz * halfW + uz * halfH },
      { x: p.x - sx * halfW - ux * halfH, y: p.y - sy * halfW - uy * halfH, z: p.z - sz * halfW - uz * halfH },
      { x: p.x + sx * halfW - ux * halfH, y: p.y + sy * halfW - uy * halfH, z: p.z + sz * halfW - uz * halfH },
    ];
    const ca = corners(a), cb = corners(b);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(ca[i], ca[j], cb[j], cb[i], color, emi);
    }
    this.quad(ca[3], ca[2], ca[1], ca[0], color, emi);
    this.quad(cb[0], cb[1], cb[2], cb[3], color, emi);
    return this;
  }
  disc(cx, cy, cz, r, segs, color, emi = 0, axis = 'z') {
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const a = i / segs * TAU;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      pts.push(axis === 'z' ? { x: cx + x, y: cy + y, z: cz }
        : axis === 'y' ? { x: cx + x, y: cy, z: cz + y }
          : { x: cx, y: cy + x, z: cz + y });
    }
    const center = axis === 'z' ? { x: cx, y: cy, z: cz } : axis === 'y' ? { x: cx, y: cy, z: cz } : { x: cx, y: cy, z: cz };
    for (let i = 0; i < segs; i++) {
      this.tri(center, pts[i], pts[(i + 1) % segs], color, emi);
    }
    return this;
  }
  extrudedPlate(points, y, thick, topColor, bottomColor, edgeColor) {
    const top = points.map(p => ({ x: p[0], y: y + thick * 0.5, z: p[1] }));
    const bot = points.map(p => ({ x: p[0], y: y - thick * 0.5, z: p[1] }));
    this.poly(top, topColor);
    this.poly(bot.slice().reverse(), bottomColor);
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      this.quad(top[i], top[j], bot[j], bot[i], edgeColor);
    }
    return this;
  }
  fin(points, x, thick, color, capColor, capY) {
    const p0 = points.map(p => ({ x: x - thick * 0.5, y: p[1], z: p[0] }));
    const p1 = points.map(p => ({ x: x + thick * 0.5, y: p[1], z: p[0] }));
    this.poly(p0, color);
    this.poly(p1.slice().reverse(), color);
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      this.quad(p0[i], p0[j], p1[j], p1[i], color);
    }
    if (capColor) {
      const high = points.filter(p => p[1] >= capY);
      if (high.length >= 2) {
        const zmin = Math.min(...high.map(p => p[0])), zmax = Math.max(...high.map(p => p[0]));
        this.box(x, capY, (zmin + zmax) / 2, thick + 0.04, 0.16, Math.max(0.12, zmax - zmin), capColor);
      }
    }
    return this;
  }
  radius(r) { this._radius = r; return this; }
  build() { return { pos: this.pos, nor: this.nor, col: this.col, emi: this.emi, radius: this._radius || 6 }; }
}

// ---------------------------------------------------------------------------
function buildFighter(kind) {
  const foe = kind === 'drone';
  const pal = foe ? {
    camo: ['#a05e57', '#78423e', '#bc7a68'].map(rgb),
    top: rgb('#cf9982'), belly: rgb('#584047'),
    radome: rgb('#30262d'), canopy: rgb('#526b7b'), canopyHi: rgb('#accbd2'),
    fin: rgb('#b86757'), cap: rgb('#efb995'),
    nozzle: rgb('#ff5a3c'), glow: rgb('#ffb17a'),
    gear: rgb('#2b1c22'), accent: rgb('#ff6b52')
  } : {
    camo: ['#434c5b', '#566170', '#697584'].map(rgb),
    top: rgb('#727d8e'), belly: rgb('#313744'),
    radome: rgb('#252831'), canopy: rgb('#d2a24a'), canopyHi: rgb('#ffe4a0'),
    fin: rgb('#66707f'), cap: rgb('#d0493f'),
    nozzle: rgb('#4a4038'), glow: rgb('#ffb066'),
    gear: rgb('#373d48'), accent: rgb('#dde2ea')
  };

  const mb = new MeshBuilder({ x: 0, y: 0.1, z: -0.4 });
  // fuselage rings: nose -> tail
  const rings = [
    { z: -6.0, w: 0.045, h: 0.04, y: 0.02 },
    { z: -5.2, w: 0.26, h: 0.20, y: 0.06 },
    { z: -4.3, w: 0.46, h: 0.34, y: 0.08 },
    { z: -3.5, w: 0.62, h: 0.46, y: 0.06 },
    { z: -2.4, w: 0.78, h: 0.55, y: 0.02 },
    { z: -1.0, w: 0.95, h: 0.62, y: 0.00 },
    { z: 0.8, w: 1.10, h: 0.66, y: 0.00 },
    { z: 2.6, w: 1.18, h: 0.60, y: 0.04 },
    { z: 4.0, w: 1.00, h: 0.52, y: 0.06 },
    { z: 4.9, w: 0.66, h: 0.42, y: 0.06 },
  ];
  const ringPts = rings.map((r, i) => {
    const z = r.z, w = r.w, h = r.h, y = r.y;
    return {
      left: { x: -w, y, z }, top: { x: 0, y: y + h, z },
      right: { x: w, y, z }, bottom: { x: 0, y: y - h * 0.78, z }
    };
  });
  for (let i = 0; i < ringPts.length - 1; i++) {
    const a = ringPts[i], b = ringPts[i + 1];
    const isNose = i < 3;
    const lt = isNose ? pal.radome : pal.camo[i % 3];
    const rt = isNose ? pal.radome : pal.camo[(i + 1) % 3];
    const tp = isNose ? pal.radome : (i > 5 ? pal.top : pal.camo[(i + 2) % 3]);
    const bt = isNose ? pal.radome : pal.belly;
    mb.quad(a.left, a.top, b.top, b.left, lt);
    mb.quad(b.top, a.top, a.right, b.right, tp);
    mb.quad(a.right, a.bottom, b.bottom, b.right, rt);
    mb.quad(b.bottom, a.bottom, a.left, b.left, bt);
  }
  // canopy bubble
  const can = [
    { z: -2.75, w: 0.34, y: 0.50 },
    { z: -2.15, w: 0.50, y: 0.94 },
    { z: -1.0, w: 0.54, y: 1.06 },
    { z: 0.15, w: 0.42, y: 0.94 },
    { z: 0.65, w: 0.26, y: 0.60 },
  ];
  const canPts = can.map(r => ({
    l: { x: -r.w, y: r.y - 0.42, z: r.z }, t: { x: 0, y: r.y, z: r.z }, r: { x: r.w, y: r.y - 0.42, z: r.z }
  }));
  for (let i = 0; i < canPts.length - 1; i++) {
    const a = canPts[i], b = canPts[i + 1];
    mb.tri(a.l, a.t, b.t, foe ? pal.canopy : (i === 0 ? pal.canopy : pal.canopyHi));
    mb.tri(a.l, b.t, b.l, pal.canopy);
    mb.tri(a.t, a.r, b.r, pal.canopyHi);
    mb.tri(a.t, b.r, b.t, pal.canopy);
  }
  // canopy frame lip + centre rail
  mb.box(0, 0.53, -1.0, 1.05, 0.07, 3.35, pal.gear);
  mb.box(0, 1.02, -1.05, 0.09, 0.06, 3.2, pal.gear);

  // cropped delta wings
  const wingRight = foe
    ? [[0.85, 0.4], [5.3, -0.4], [4.75, 1.25], [0.85, 2.55]]
    : [[0.85, -0.55], [5.15, 1.95], [4.65, 2.75], [0.85, 2.85]];
  mb.extrudedPlate(wingRight, -0.02, 0.20, pal.camo[1], pal.belly, pal.camo[0]);
  mb.extrudedPlate(wingRight.map(p => [-p[0], p[1]]), -0.02, 0.20, pal.camo[2], pal.belly, pal.camo[0]);
  // splintered camo panels sit proud of the wing skin, not buried inside it
  if (!foe) {
    for (const s of [-1, 1]) {
      mb.box(s * 2.55, 0.222, 0.85, 1.30, 0.045, 0.58, pal.camo[0]);
      mb.box(s * 3.55, 0.222, 1.65, 0.95, 0.045, 0.46, pal.gear);
      mb.box(s * 2.05, 0.222, 2.05, 0.75, 0.045, 0.40, pal.belly);
      // dark leading-edge spar defines the cropped delta
      mb.beam({ x: s * 0.9, y: 0.185, z: -0.5 }, { x: s * 5.1, y: 0.185, z: 1.93 }, 0.09, 0.09, pal.gear);
    }
  }
  // wing tip accent
  for (const s of [-1, 1]) {
    const tipX = s * (foe ? 5.0 : 4.9), tipZ = foe ? 0.5 : 2.3;
    mb.box(tipX, 0.235, tipZ, 0.17, 0.05, 0.75, pal.accent);
  }
  // missile rails
  for (const s of [-1, 1]) {
    mb.box(s * 3.0, -0.18, 1.15, 0.11, 0.11, 1.5, pal.gear);
    mb.box(s * 3.9, -0.18, 1.85, 0.11, 0.11, 1.2, pal.gear);
  }

  // twin canted fins, built as thin plates rather than solid wedges
  for (const s of [-1, 1]) {
    const finPts = [[2.45, 0.45], [4.42, 0.42], [4.12, 1.98], [3.28, 2.10]];
    const xAt = y => 0.95 + clamp01((y - 0.45) / 1.65) * 0.95;
    const a = finPts.map(p => ({ x: s * (xAt(p[1]) - 0.055), y: p[1], z: p[0] }));
    const b = finPts.map(p => ({ x: s * (xAt(p[1]) + 0.055), y: p[1], z: p[0] }));
    mb.poly(a, pal.fin, 0.05);
    mb.poly(b.slice().reverse(), pal.fin, 0.05);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      mb.quad(a[i], a[j], b[j], b[i], pal.fin, 0.06);
    }
    // red tip cap + formation strip
    mb.box(s * 1.94, 2.06, 3.72, 0.17, 0.14, 0.84, pal.cap, 0.72);
    mb.box(s * 1.82, 1.84, 3.98, 0.10, 0.26, 0.48, pal.cap, 0.28);
    // tail boom: slim nacelle, camo on top, dark underneath
    mb.box(s * 1.25, 0.10, 3.56, 0.56, 0.44, 2.62,
      [pal.camo[0], pal.gear, pal.camo[1], pal.belly, pal.camo[2], pal.camo[0]]);
    // engine nozzle
    mb.disc(s * 1.25, 0.05, 4.87, 0.17, 8, pal.nozzle, 0.14);
    mb.disc(s * 1.25, 0.05, 4.90, 0.075, 6, pal.glow, 0.85);
    // intake highlight
    mb.box(s * 0.9, 0.12, 1.1, 0.38, 0.30, 1.4, pal.camo[0]);
  }
  // tail formation light
  if (!foe) mb.box(0, 0.7, 4.78, 0.16, 0.12, 0.12, rgb('#ff6a52'), 1.0);
  // horizontal stabilizers
  mb.extrudedPlate([[0.8, 3.15], [2.7, 4.0], [2.6, 4.55], [0.8, 4.35]], 0.18, 0.14, pal.camo[0], pal.belly, pal.camo[1]);
  mb.extrudedPlate([[-0.8, 3.15], [-2.7, 4.0], [-2.6, 4.55], [-0.8, 4.35]], 0.18, 0.14, pal.camo[1], pal.belly, pal.camo[2]);
  // dorsal splinter stripe
  mb.box(0, 0.68, 1.9, 0.34, 0.08, 2.4, pal.camo[0]);
  // nose sensor / pitot
  if (foe) {
    mb.tri({ x: 0, y: 0.10, z: -6.45 }, { x: 0.38, y: 0.10, z: -5.1 }, { x: -0.38, y: 0.10, z: -5.1 }, pal.accent, 1.0);
    mb.box(0, 0.42, -3.9, 0.22, 0.08, 0.9, pal.accent, 1.0);
    // shock spines for silhouette
    for (const s of [-1, 1]) mb.box(s * 2.4, 0.28, -0.1, 0.10, 0.36, 0.9, pal.cap);
  } else {
    mb.beam({ x: 0, y: 0.02, z: -6.05 }, { x: 0, y: 0.02, z: -6.9 }, 0.035, 0.035, pal.gear);
    // navigation lights
    mb.box(4.9, 0.245, 2.3, 0.12, 0.05, 0.12, rgb('#ff5a4e'), 1.0);
    mb.box(-4.9, 0.245, 2.3, 0.12, 0.05, 0.12, rgb('#7dffb0'), 1.0);
  }
  return mb.radius(7.2).build();
}

// ---------------------------------------------------------------------------
function buildSAM() {
  const mb = new MeshBuilder({ x: 0, y: 1.6, z: 0 });
  const olive = rgb('#585843'), olive2 = rgb('#44483a'), dark = rgb('#2b2c2a');
  const metal = rgb('#767a64'), red = rgb('#d64a3a'), warn = rgb('#ffb347');
  mb.box(0, 0.5, 0, 6.4, 1.0, 6.4, [olive2, olive2, olive, dark, olive2, olive2]);
  // outriggers / tracks
  for (const s of [-1, 1]) {
    mb.box(s * 2.6, 0.42, 0, 1.4, 0.8, 6.8, dark);
    mb.box(s * 2.6, 0.78, 0, 1.0, 0.3, 6.4, olive2);
  }
  // cab
  mb.box(-2.0, 1.45, 2.2, 2.0, 1.1, 1.6, [olive, olive2, metal, dark, olive, olive2]);
  // turret base
  mb.box(0, 1.35, 0, 3.2, 0.8, 3.2, [olive, olive2, metal, dark, olive, olive2]);
  // launcher frame
  mb.box(0, 2.2, -0.2, 3.6, 0.35, 2.4, metal);
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 === 0 ? -0.85 : 0.85);
    const z = (i < 2 ? -0.7 : 0.5);
    const a = { x, y: 2.35, z };
    const b = { x: x * 0.82, y: 4.2, z: z - 1.7 };
    mb.beam(a, b, 0.28, 0.28, metal);
    mb.disc(b.x, b.y, b.z, 0.22, 6, red, 1.0);
  }
  // radar dish
  mb.beam({ x: 2.0, y: 1.6, z: 0.5 }, { x: 2.0, y: 3.5, z: 0.5 }, 0.08, 0.08, metal);
  mb.box(2.0, 3.6, 0.5, 1.5, 0.75, 0.14, [metal, metal, metal, metal, metal, metal]);
  mb.box(2.0, 3.6, 0.5, 0.25, 0.25, 0.2, warn, 1.0);
  // hazard stripes
  mb.box(0, 0.45, 3.22, 2.4, 0.18, 0.08, [red, red, red, red, red, red], 0.4);
  mb.box(-2.0, 1.45, 3.01, 1.2, 0.16, 0.06, warn, 0.3);
  return mb.radius(6.5).build();
}

function buildVehicle() {
  const mb = new MeshBuilder({ x: 0, y: 1.0, z: 0 });
  const olive = rgb('#4e5542'), olive2 = rgb('#3a4034'), dark = rgb('#23261f');
  const metal = rgb('#666c55'), red = rgb('#d64a3a');
  // tracks
  for (const s of [-1, 1]) {
    mb.box(s * 1.6, 0.38, 0, 0.8, 0.72, 5.4, dark);
    mb.box(s * 1.6, 0.74, 0, 0.9, 0.22, 5.0, olive2);
  }
  // hull
  mb.box(0, 1.15, 0, 2.6, 0.95, 4.9, [olive, olive2, metal, dark, olive, olive2]);
  // sloped front
  mb.tri({ x: -1.3, y: 1.62, z: 2.45 }, { x: 1.3, y: 1.62, z: 2.45 }, { x: 0, y: 0.95, z: 2.9 }, olive);
  // turret
  mb.box(0, 1.95, -0.15, 2.1, 0.8, 2.3, [olive2, olive, metal, dark, olive, olive2]);
  mb.box(0.35, 2.45, -0.3, 0.5, 0.3, 0.5, metal);
  // barrel
  mb.beam({ x: 0, y: 2.0, z: 1.0 }, { x: 0, y: 2.0, z: 3.9 }, 0.09, 0.09, metal);
  mb.box(0, 2.0, 3.75, 0.24, 0.2, 0.4, dark);
  // stowage
  mb.box(-0.8, 1.7, -1.6, 0.6, 0.3, 1.0, olive2);
  // marker light
  mb.box(1.07, 1.65, 0.8, 0.08, 0.1, 0.1, red, 1.0);
  return mb.radius(3.8).build();
}

function buildMissile() {
  const mb = new MeshBuilder({ x: 0, y: 0, z: 0 });
  const body = rgb('#e6e0cf'), shade = rgb('#b5ae9c'), tip = rgb('#9e3a30'),
    fin = rgb('#767c87'), glow = rgb('#ffb347'), band = rgb('#c9a24b');
  // long tapered airframe with a slightly wider tail
  mb.beam({ x: 0, y: 0, z: -1.72 }, { x: 0, y: 0, z: 0.24 }, 0.125, 0.125, body);
  mb.beam({ x: 0, y: 0, z: 0.24 }, { x: 0, y: 0, z: 1.22 }, 0.175, 0.175, body);
  // yellow identification band + dark mid seam
  mb.beam({ x: 0, y: 0, z: -0.62 }, { x: 0, y: 0, z: -0.44 }, 0.135, 0.135, band);
  mb.beam({ x: 0, y: 0, z: 0.58 }, { x: 0, y: 0, z: 0.72 }, 0.18, 0.18, shade);
  // dark red seeker cone
  mb.disc(0, 0, -1.73, 0.13, 8, tip);
  mb.tri({ x: 0, y: 0, z: -2.28 }, { x: 0.135, y: 0, z: -1.68 }, { x: -0.135, y: 0, z: -1.68 }, tip);
  mb.tri({ x: 0, y: 0.135, z: -1.68 }, { x: 0, y: -0.135, z: -1.68 }, { x: 0, y: 0, z: -2.28 }, tip);
  // four swept tail fins in a cross
  for (const s of [-1, 1]) {
    mb.box(s * 0.34, 0, 1.02, 0.46, 0.06, 0.5, fin);
    mb.box(0, s * 0.34, 1.02, 0.06, 0.46, 0.5, fin);
    mb.box(s * 0.57, 0, 1.18, 0.14, 0.04, 0.2, fin);
    mb.box(0, s * 0.57, 1.18, 0.04, 0.14, 0.2, fin);
  }
  // nozzle + hot exhaust
  mb.disc(0, 0, 1.23, 0.155, 8, shade);
  mb.disc(0, 0, 1.245, 0.105, 8, glow, 1.0);
  mb.disc(0, 0, 1.255, 0.05, 6, rgb('#fff3cf'), 1.0);
  return mb.radius(1.6).build();
}

function addTreeCone(mb, cx, baseY, cz, radius, height, colors, phase = 0) {
  // Each tier is a closed solid: the whole tree's center would flip upper caps upward.
  const center = mb.center;
  mb.center = { x: cx, y: baseY + height / 3, z: cz };
  const tip = { x: cx, y: baseY + height, z: cz };
  const base = { x: cx, y: baseY, z: cz };
  const segments = 7;
  for (let i = 0; i < segments; i++) {
    const a0 = (i + phase) / segments * TAU;
    const a1 = (i + 1 + phase) / segments * TAU;
    const p0 = { x: cx + Math.cos(a0) * radius, y: baseY, z: cz + Math.sin(a0) * radius };
    const p1 = { x: cx + Math.cos(a1) * radius, y: baseY, z: cz + Math.sin(a1) * radius };
    mb.tri(p0, p1, tip, colors[i % colors.length]);
    mb.tri(base, p1, p0, colors[(i + 1) % colors.length]);
  }
  mb.center = center;
}

function addTreeCrown(mb, cx, cy, cz, rx, ry, rz, colors, phase = 0) {
  const center = mb.center;
  mb.center = { x: cx, y: cy, z: cz };
  const bottom = { x: cx, y: cy - ry, z: cz };
  const top = { x: cx, y: cy + ry, z: cz };
  const segments = 7, lower = [], upper = [];
  for (let i = 0; i < segments; i++) {
    const a = (i + phase) / segments * TAU;
    lower.push({ x: cx + Math.cos(a) * rx * 0.72, y: cy - ry * 0.30, z: cz + Math.sin(a) * rz * 0.72 });
    upper.push({ x: cx + Math.cos(a + 0.08) * rx * 0.62, y: cy + ry * 0.24, z: cz + Math.sin(a + 0.08) * rz * 0.62 });
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments, color = colors[(i + phase) % colors.length];
    mb.tri(bottom, lower[i], lower[j], color);
    mb.quad(lower[i], upper[i], upper[j], lower[j], color);
    mb.tri(top, upper[j], upper[i], colors[(i + phase + 1) % colors.length]);
  }
  mb.center = center;
}

function buildPineTree() {
  const mb = new MeshBuilder({ x: 0, y: 4, z: 0 });
  const bark = [rgb('#493b2c'), rgb('#654a31'), rgb('#342c23'), rgb('#554331'), rgb('#46392a'), rgb('#61482e')];
  const greens = [rgb('#254b2d'), rgb('#2d5931'), rgb('#386739'), rgb('#477543'), rgb('#537e49')];
  mb.box(0, 4.0, 0, 1.05, 8.0, 1.05, bark);
  for (let i = 0; i < 5; i++) {
    addTreeCone(mb, 0, 4.0 + i * 5.9, 0, 10.5 - i * 1.65, 12.0 - i * 0.9, greens, i % 3);
  }
  return Object.assign(mb.radius(23).build(), { height: 36, crownRadius: 10.5, crownBase: 4 });
}

function buildAutumnTree() {
  const mb = new MeshBuilder({ x: 0, y: 4, z: 0 });
  const bark = [rgb('#59402c'), rgb('#765035'), rgb('#392d24'), rgb('#62452e'), rgb('#483729'), rgb('#6b4b30')];
  const leaves = [rgb('#4a6836'), rgb('#607b3e'), rgb('#819046'), rgb('#a68a3d'), rgb('#b49a46'), rgb('#89783b'), rgb('#58783b')];
  mb.box(0, 4, 0, 1.05, 8, 1.05, bark);
  mb.beam({ x: 0, y: 4.0, z: 0 }, { x: -4.8, y: 12.8, z: 0.2 }, 0.30, 0.30, bark[1]);
  mb.beam({ x: 0, y: 4.5, z: 0 }, { x: 4.6, y: 13.3, z: 0.6 }, 0.28, 0.28, bark[0]);
  mb.beam({ x: 0, y: 5.0, z: 0 }, { x: 0.4, y: 17, z: -3.0 }, 0.26, 0.26, bark[3]);
  addTreeCrown(mb, 0, 15, 0, 10.8, 10, 10.5, leaves, 0);
  addTreeCrown(mb, -5.0, 13.0, 0.2, 9.0, 8.5, 8.8, leaves, 2);
  addTreeCrown(mb, 4.8, 13.5, 0.6, 9.0, 8.5, 9.0, leaves, 4);
  addTreeCrown(mb, 0.3, 17.0, -3.0, 9.4, 8.0, 9.0, leaves, 1);
  return Object.assign(mb.radius(19).build(), { height: 25, crownRadius: 12, crownBase: 4 });
}

function buildMeshes() {
  return {
    player: Renderer.createMesh(buildFighter('player')),
    drone: Renderer.createMesh(buildFighter('drone')),
    sam: Renderer.createMesh(buildSAM()),
    vehicle: Renderer.createMesh(buildVehicle()),
    missile: Renderer.createMesh(buildMissile()),
    pineTree: Renderer.createMesh(buildPineTree()),
    autumnTree: Renderer.createMesh(buildAutumnTree()),
  };
}

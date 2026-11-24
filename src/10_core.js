// ---------------------------------------------------------------------------
// PATROL: INTERCEPT — core constants, math, input, audio.
// All world units are metres. Logical UI resolution is VW x 340.
// ---------------------------------------------------------------------------
const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const ctx = uiCanvas.getContext('2d', { alpha: true });
ctx.imageSmoothingEnabled = false;

const BASE_H = 340;
let VW = 604, VH = BASE_H;          // logical HUD space
let WORLD_H = 340;                  // world render height (auto quality)
let VIEW_ASPECT = 16 / 9;
let UI_DPR = 1;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SUN_AZ = -0.62;               // light azimuth (radians, x/z); the sun itself stays hidden
const SUN_EL = 0.30;                // soft alpine light, ~17 deg above the horizon
const SUN_DIR = (() => {
  const ce = Math.cos(SUN_EL);
  return { x: Math.sin(SUN_AZ) * ce, y: Math.sin(SUN_EL), z: -Math.cos(SUN_AZ) * ce };
})();

const PAL = {
  void:      '#0b0912',
  ink:       '#171321',
  ink2:      '#221c30',
  panel:     '#1b1726',
  panelLit:  '#292233',
  line:      '#4b4056',
  cream:     '#f4e4bf',
  gold:      '#f0c05a',
  goldHot:   '#ffe39a',
  amber:     '#ffae3d',
  orange:    '#e8763c',
  red:       '#ff5a4e',
  redDark:   '#9e2f2f',
  cyan:      '#8fe3d6',
  paleCyan:  '#d7f4e8',
  lilac:     '#b9a4d0',
  violet:    '#6c5a86',
  slate:     '#7b8794',
  white:     '#fff8e8',
  green:     '#9fd06a',
  smoke:     '#41404d',
  smokeDark: '#2a2834',
  waterHi:   '#9ee1cf',
  enemy:     '#ff6b5c',
};

// ----------------------------------------------------------------- math ----
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const invLerp = (a, b, v) => clamp01((v - a) / (b - a));
const sign = v => v < 0 ? -1 : 1;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const wrapAngle = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const angleLerp = (a, b, t) => a + wrapAngle(b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; };
const dist3 = (a, b) => Math.sqrt(dist2(a, b));
const hdist = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return Math.hypot(dx, dz); };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(0x51CE77);
const rand = () => rng();
const rr = (a, b) => a + (b - a) * rng();
const ri = (a, b) => Math.floor(a + (b - a + 1) * rng());
const pick = arr => arr[Math.floor(rng() * arr.length) % arr.length];

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- tiny vec3 helpers (plain objects; CPU volume is modest) ----
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const vcopy = a => ({ x: a.x, y: a.y, z: a.z });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vmul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vmad = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vcross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const vlen = a => Math.hypot(a.x, a.y, a.z);
const vnorm = a => { const l = vlen(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const vlerp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function headingTo(x, z, dir = { x: 0, y: 0, z: -1 }) {
  return Math.atan2(dir.x, -dir.z);
}

// Build an orthonormal basis from forward + roll.
function basisFrom(yaw, pitch, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = { x: Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp };
  const worldUp = Math.abs(fwd.y) > 0.985 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
  let right = vnorm(vcross(fwd, worldUp));
  let up = vcross(right, fwd);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rr2 = { x: right.x * cr + up.x * sr, y: right.y * cr + up.y * sr, z: right.z * cr + up.z * sr };
  const uu2 = { x: up.x * cr - right.x * sr, y: up.y * cr - right.y * sr, z: up.z * cr - right.z * sr };
  return { fwd, right: rr2, up: uu2 };
}

// ------------------------------------------------------------ matrices ----
function mat4() { return new Float32Array(16); }
function m4identity(o) {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}
function m4mul(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}
function m4perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  return out;
}
function m4lookAt(out, eye, center, up) {
  let zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
  return out;
}
// model matrix from basis (x=right,y=up,z=back) + translation
function m4basis(out, right, up, back, pos, scale = 1) {
  out[0] = right.x * scale; out[1] = right.y * scale; out[2] = right.z * scale; out[3] = 0;
  out[4] = up.x * scale; out[5] = up.y * scale; out[6] = up.z * scale; out[7] = 0;
  out[8] = back.x * scale; out[9] = back.y * scale; out[10] = back.z * scale; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}
function projectPoint(p, vp, out) {
  const x = p.x, y = p.y, z = p.z;
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 0.001) return false;
  out.x = (cx / cw * 0.5 + 0.5) * VW;
  out.y = (1 - (cy / cw * 0.5 + 0.5)) * VH;
  out.w = cw;
  out.inv = 1 / cw;
  return true;
}

// Bayer 4x4 threshold (0..1) for 2D dithering on the overlay canvas.
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
];
const bayer = (x, y) => (BAYER4[((y & 3) << 2) + (x & 3)] + 0.5) / 16;

// --------------------------------------------------------------- input ----
const INPUT = {
  mx: 0, my: 0,       // logical UI coordinates
  px: 0, py: 0,       // previous
  dx: 0, dy: 0,
  left: false,
  keys: new Set(),
  touchMode: false,
  touchId: -1, touchStartX: 0, touchStartY: 0, touchX: 0, touchY: 0, touchDX: 0, touchDY: 0,
  touchBurn: false, touchGun: false, touchSteer: false,
  uiHits: [],          // rebuilt each frame by UI
  overUI: false,
  lastActivity: 0,
  mouseSteerAge: Infinity,
};

const TOUCH = { id: -1, active: false, x: 0, y: 0, startX: 0, startY: 0 };
const UI_HOLDS = new Map();

function setPointer(e) {
  const rect = stageRect();
  const x = (e.clientX - rect.left) / Math.max(1, rect.width) * VW;
  const y = (e.clientY - rect.top) / Math.max(1, rect.height) * VH;
  INPUT.mx = clamp(x, 0, VW); INPUT.my = clamp(y, 0, VH);
  INPUT.lastActivity = performance.now();
}
function resetMouseSteering() {
  INPUT.mx = VW / 2;
  INPUT.my = VH * 0.52;
  INPUT.mouseSteerAge = Infinity;
}
function stageRect() {
  const r = uiCanvas.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return r;
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
function pointerUI(e) {
  const rect = stageRect();
  const x = clamp((e.clientX - rect.left) / Math.max(1, rect.width) * VW, 0, VW);
  const y = clamp((e.clientY - rect.top) / Math.max(1, rect.height) * VH, 0, VH);
  return { x, y };
}

function isUIAt(x, y) {
  for (const h of INPUT.uiHits) {
    if (h.active !== false && x >= h.x && y >= h.y && x < h.x + h.w && y < h.y + h.h) return h;
  }
  return null;
}

function onPointerDown(e) {
  const pointerId = e.pointerId ?? -1;
  if (e.pointerType === 'touch') INPUT.touchMode = true;
  if (e.pointerType === 'touch') {
    const t = pointerUI(e);
    const ui = isUIAt(t.x, t.y);
    INPUT.lastActivity = performance.now();
    if (ui) {
      if (ui.onDown) ui.onDown();
      UI_HOLDS.set(pointerId, ui);
      e.preventDefault();
      return;
    }
    if (!TOUCH.active) {
      setPointer(e);
      TOUCH.active = true; TOUCH.id = pointerId;
      TOUCH.startX = INPUT.mx; TOUCH.startY = INPUT.my;
      TOUCH.x = INPUT.mx; TOUCH.y = INPUT.my;
    }
    e.preventDefault();
    return;
  }
  setPointer(e);
  if (e.button === 0) {
    const ui = isUIAt(INPUT.mx, INPUT.my);
    if (ui) {
      if (ui.onDown) ui.onDown();
      UI_HOLDS.set(pointerId, ui);
      return;
    }
    INPUT.left = true;
    onPrimaryDown();
  } else if (e.button === 2) {
    onSecondaryDown();
  }
}

function onPointerUp(e) {
  const pointerId = e.pointerId ?? -1;
  if (e.pointerType === 'touch' || e.button === 0 || e.type === 'pointercancel') {
    const held = UI_HOLDS.get(pointerId);
    if (held && held.onUp) held.onUp();
    UI_HOLDS.delete(pointerId);
  }
  if (e.pointerType === 'touch') {
    if (TOUCH.id === pointerId) {
      TOUCH.active = false; TOUCH.id = -1;
    }
    return;
  }
  setPointer(e);
  if (e.button === 0 || e.type === 'pointercancel') INPUT.left = false;
}

window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    if (TOUCH.active && e.pointerId === TOUCH.id) {
      setPointer(e);
      TOUCH.x = INPUT.mx; TOUCH.y = INPUT.my;
    }
    return;
  }
  setPointer(e);
  if (e.pointerType !== 'touch') INPUT.mouseSteerAge = 0;
}, { passive: true });
// Mouse events report both buttons even when one is already held.
window.addEventListener('mousedown', onPointerDown);
window.addEventListener('mouseup', onPointerUp);
window.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') onPointerDown(e); });
window.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') onPointerUp(e); });
window.addEventListener('pointercancel', onPointerUp);
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('blur', () => {
  INPUT.left = INPUT.touchBurn = INPUT.touchGun = false;
  UI_HOLDS.clear();
  INPUT.keys.clear();
  resetMouseSteering();
  TOUCH.active = false; TOUCH.id = -1;
});
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  INPUT.keys.add(e.code);
  INPUT.lastActivity = performance.now();
  if (typeof onKeyDown === 'function') onKeyDown(e.code);
});
window.addEventListener('keyup', e => INPUT.keys.delete(e.code));
window.addEventListener('resize', () => { if (typeof resizeAll === 'function') resizeAll(); });

// --------------------------------------------------------------- audio ----
const AudioSys = {
  ctx: null, master: null, noiseBuf: null, enabled: false,
  // 55% 保留旧版默认听感（总增益 0.55），100% 到 1.0，0% 静音。
  volume: .55,
  engineNodes: null, engineGain: null,
  warnedLow: 0, inited: false,
  init() {
    if (this.inited) return;
    this.inited = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.0001;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5;
      comp.attack.value = 0.003; comp.release.value = 0.18;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.startEngine();
    } catch (err) { console.warn('audio unavailable', err); }
  },
  setEnabled(on) {
    this.enabled = on;
    if (on) {
      this.init();
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.3);
      }
    } else if (this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12);
    }
  },
  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.ctx && this.enabled) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(Math.max(0.0001, this.volume), this.ctx.currentTime + 0.08);
    }
    return this.volume;
  },
  now() { return this.ctx ? this.ctx.currentTime : 0; },
  noise(dur, gain, filterType, freq, q = 1, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.now() + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },
  tone(freq, dur, type = 'square', gain = 0.06, delay = 0, glideTo = null) {
    if (!this.enabled || !this.ctx) return;
    const t = this.now() + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  },
  startEngine() {
    if (!this.ctx) return;
    const t = this.now();
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 46;
    const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 69;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 2;
    const g = this.ctx.createGain(); g.gain.value = 0.0001;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 7.3;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.009;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
    this.engineNodes = { o1, o2, f }; this.engineGain = g;
  },
  updateEngine(on, throttle, damaged) {
    if (!this.ctx || !this.engineGain) return;
    const t = this.now();
    const target = on ? (0.028 + throttle * 0.035) * (damaged ? 0.7 : 1) : 0.0001;
    this.engineGain.gain.setTargetAtTime(target, t, 0.25);
    if (this.engineNodes) {
      this.engineNodes.o1.frequency.setTargetAtTime(42 + throttle * 40, t, 0.3);
      this.engineNodes.o2.frequency.setTargetAtTime(66 + throttle * 55, t, 0.3);
      this.engineNodes.f.frequency.setTargetAtTime(260 + throttle * 700, t, 0.3);
    }
  },
  lockTick(progress) {
    const f = 620 + progress * 500;
    this.tone(f, 0.045, 'square', 0.025);
  },
  lockTone() {
    this.tone(1180, 0.09, 'square', 0.045);
    this.tone(1560, 0.14, 'square', 0.038, 0.09);
  },
  launch() {
    this.noise(0.5, 0.22, 'highpass', 1200, 0.7);
    this.tone(320, 0.4, 'sawtooth', 0.06, 0, 70);
    this.noise(0.7, 0.13, 'lowpass', 700, 0.8, 0.06);
  },
  explosion(near = 1, big = false) {
    const g = (big ? 0.4 : 0.26) * near;
    this.noise(big ? 1.6 : 1.1, g, 'lowpass', 420, 0.8);
    this.tone(big ? 58 : 78, big ? 0.9 : 0.55, 'sine', g * 0.9, 0, 28);
    this.noise(0.3, g * 0.4, 'highpass', 2600, 0.6, 0.015);
    this.tone(180, 0.16, 'square', g * 0.18, 0, 60);
  },
  shieldHit() {
    this.noise(0.35, 0.3, 'bandpass', 900, 1.4);
    this.tone(150, 0.3, 'sawtooth', 0.1, 0, 55);
    this.tone(2100, 0.07, 'square', 0.04);
  },
  missileWarning() {
    this.tone(880, 0.07, 'square', 0.035);
    this.tone(660, 0.07, 'square', 0.03, 0.09);
  },
  lowWarn() {
    this.tone(270, 0.12, 'square', 0.045);
    this.tone(230, 0.14, 'square', 0.04, 0.13);
  },
  flare() {
    for (let i = 0; i < 5; i++) this.noise(0.09, 0.12 - i * 0.015, 'highpass', 1800 + i * 300, 0.8, i * 0.035);
    this.tone(520, 0.2, 'triangle', 0.03, 0, 900);
  },
  gunshot(near) {
    this.noise(0.07, 0.035 * near, 'bandpass', 2200 + Math.random() * 600, 1.2);
  },
  waveClear() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.22, 'triangle', 0.055, i * 0.1));
    this.tone(261, 0.6, 'sine', 0.035, 0.05);
  },
  waveStart() {
    this.tone(392, 0.12, 'square', 0.035);
    this.tone(523, 0.18, 'square', 0.04, 0.13);
  },
  missionFail() {
    const notes = [392, 350, 294, 196];
    notes.forEach((n, i) => this.tone(n, 0.5, 'sawtooth', 0.035, i * 0.22, n * 0.85));
    this.noise(1.5, 0.08, 'lowpass', 280, 0.7);
  },
  uiTick() { this.tone(900, 0.035, 'square', 0.02); },
  chime() { this.tone(1318, 0.1, 'triangle', 0.035); this.tone(1760, 0.16, 'triangle', 0.03, 0.08); },
};

// ------------------------------------------------------- text drawing -----
const FONT_PIXEL = 'Silkscreen, monospace';
const FONT_MONO = '"Share Tech Mono", monospace';
const FONT_CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif';
const CJK_RE = /[　-〿㐀-鿿豈-﫿！-｠]/;
const CJK_CACHE = new Map();
let CJK_MEASURE = null;

function setFont(size, mono = false, bold = false) {
  ctx.font = `${bold ? '700 ' : '400 '}${size}px ${mono ? FONT_MONO : FONT_PIXEL}`;
}
function textWidth(str, size, mono = false, bold = false) {
  if (CJK_RE.test(str)) {
    if (!CJK_MEASURE) CJK_MEASURE = document.createElement('canvas').getContext('2d');
    const ss = Math.max(1, Math.min(4, Math.round(UI_DPR) || 1));
    CJK_MEASURE.font = `${bold ? 600 : 500} ${Math.max(8, size) * ss}px ${FONT_CJK}`;
    return CJK_MEASURE.measureText(str).width / ss;
  }
  setFont(size, mono, bold);
  return ctx.measureText(str).width;
}
// CJK text cannot use Silkscreen. Render it with the system UI font, then
// threshold the alpha to hard pixels so it keeps the pixel-art look. Glyphs
// are rasterised at the UI supersample factor so text stays sharp when the
// canvas backing store is scaled up.
function cjkBitmap(str, size, bold, color) {
  const ss = Math.max(1, Math.min(4, Math.round(UI_DPR) || 1));
  const key = `${ss}|${size}|${bold ? 1 : 0}|${color}|${str}`;
  const hit = CJK_CACHE.get(key);
  if (hit) return hit;
  if (!CJK_MEASURE) CJK_MEASURE = document.createElement('canvas').getContext('2d');
  size = Math.max(8, size);
  const px = size * ss;
  const font = `${bold ? 600 : 500} ${px}px ${FONT_CJK}`;
  CJK_MEASURE.font = font;
  const advDev = Math.ceil(CJK_MEASURE.measureText(str).width);
  const pad = 4;
  const W = Math.max(2, advDev) + pad * ss * 2;
  const H = Math.ceil(px * 1.75) + pad * ss * 2;
  const baseU = pad + Math.round(size * 1.18);
  const base = baseU * ss;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { alpha: true });
  g.font = font;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = color;
  g.fillText(str, pad * ss, base);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 92 ? 255 : 0;
  g.putImageData(img, 0, 0);
  const bmp = { canvas: c, w: W, h: H, adv: advDev / ss, pad, base: baseU, ss };
  if (CJK_CACHE.size > 400) CJK_CACHE.clear();
  CJK_CACHE.set(key, bmp);
  return bmp;
}
function drawCJK(str, x, y, o) {
  const { size = 10, bold = false, color = PAL.cream, align = 'left',
    alpha = 1, shadow = null, outline = null } = o;
  const bmp = cjkBitmap(str, size, bold, color);
  const ss = bmp.ss || 1;
  let pen = x;
  if (align === 'center') pen = x - bmp.adv / 2;
  else if (align === 'right') pen = x - bmp.adv;
  const dx = Math.round(pen - bmp.pad);
  const dy = Math.round(y - bmp.base);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (outline) {
    const ob = cjkBitmap(str, size, bold, outline);
    const r = o.outlineW || 1;
    for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
      if (ox || oy) ctx.drawImage(ob.canvas, dx + ox, dy + oy, ob.w / ss, ob.h / ss);
    }
  }
  if (shadow) {
    const sb = cjkBitmap(str, size, bold, shadow);
    ctx.drawImage(sb.canvas, dx + 1, dy + 1, sb.w / ss, sb.h / ss);
  }
  ctx.drawImage(bmp.canvas, dx, dy, bmp.w / ss, bmp.h / ss);
  ctx.restore();
}
function drawText(str, x, y, o = {}) {
  if (CJK_RE.test(str)) { drawCJK(str, x, y, o); return; }
  const { size = 8, mono = false, bold = false, color = PAL.cream, align = 'left',
    baseline = 'alphabetic', alpha = 1, shadow = null, outline = null, spacing = 0 } = o;
  ctx.save();
  ctx.globalAlpha *= alpha;
  setFont(size, mono, bold);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (spacing) ctx.letterSpacing = spacing + 'px';
  if (outline) {
    ctx.fillStyle = outline;
    const r = o.outlineW || 1;
    for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
      if (ox || oy) ctx.fillText(str, Math.round(x + ox), Math.round(y + oy));
    }
  }
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(str, Math.round(x + 1), Math.round(y + 1));
  }
  ctx.fillStyle = color;
  ctx.fillText(str, Math.round(x), Math.round(y));
  ctx.restore();
}
function line(x1, y1, x2, y2, color, w = 1, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5); ctx.stroke(); ctx.restore();
}
function rect(x, y, w, h, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); ctx.restore();
}
function rectLine(x, y, w, h, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  ctx.restore();
}
function circleFill(x, y, r, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, TAU); ctx.fill(); ctx.restore();
}
function circleLine(x, y, r, color, alpha = 1, w = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, TAU); ctx.stroke(); ctx.restore();
}
function fmt(n, d = 0) {
  const v = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
  return String(v);
}
function pad(n, len, ch = '0') {
  let s = String(Math.floor(n));
  while (s.length < len) s = ch + s;
  return s;
}
function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${pad(m, 2)}:${pad(s, 2)}`;
}

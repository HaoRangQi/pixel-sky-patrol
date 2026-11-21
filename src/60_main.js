// ---------------------------------------------------------------------------
// Boot, resize, render loop, screenshots/test harness.
// ---------------------------------------------------------------------------
const BOOT = {
  startTime: performance.now(),
  progress: 0,
  stage: '初始化飞行系统',
  error: null,
  ready: false,
};

const TEST = {
  errors: [],
  exceptions: [],
  readyAt: 0,
};
window.addEventListener('error', e => {
  TEST.errors.push(String(e.message || 'error'));
  if (TEST.errors.length > 40) TEST.errors.shift();
});
window.addEventListener('unhandledrejection', e => {
  TEST.exceptions.push(String(e.reason && (e.reason.stack || e.reason.message) || e.reason));
  if (TEST.exceptions.length > 40) TEST.exceptions.shift();
});

const PARAMS = new URLSearchParams(location.search);
G.seed = +(PARAMS.get('seed') || 1337);
G.sound = PARAMS.get('sound') === '1';
G.debug = PARAMS.get('debug') === '1';
G.scenarioName = PARAMS.get('scenario') || '';
const FIXED_QUALITY = PARAMS.get('quality') ? +PARAMS.get('quality') : 0;
const ADAPT_QUALITY = PARAMS.get('adapt') !== '0';
let qualityIndex = 0;
let worldHInit = false;
const QUALITY_STEPS = [640, 560, 480, 400, 340, 288, 240];
let cssRect = { left: 0, top: 0, width: 1, height: 1 };

function resizeAll() {
  const iw = Math.max(1, window.innerWidth);
  const ih = Math.max(1, window.innerHeight);
  const winAspect = iw / ih;
  const aspect = clamp(winAspect, 1.45, 2.7);
  let w = iw, h = w / aspect;
  if (h > ih) { h = ih; w = h * aspect; }
  cssRect = { left: (iw - w) / 2, top: (ih - h) / 2, width: w, height: h };
  VW = Math.round(BASE_H * aspect);
  VH = BASE_H;
  VIEW_ASPECT = aspect;
  for (const c of [glCanvas, uiCanvas]) {
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.style.left = cssRect.left + 'px';
    c.style.top = cssRect.top + 'px';
  }
  // Back the UI canvas at (near) device-pixel density so text and lines stay
  // crisp instead of being stretched from a 604x340 buffer.
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const uiSS = clamp(Math.round((h * dpr) / VH), 1, 3);
  if (uiSS !== UI_DPR) CJK_CACHE.clear();
  UI_DPR = uiSS;
  uiCanvas.width = Math.round(VW * UI_DPR);
  uiCanvas.height = Math.round(VH * UI_DPR);
  ctx.imageSmoothingEnabled = false;
  if (FIXED_QUALITY) WORLD_H = clamp(FIXED_QUALITY, 180, 720);
  else if (!worldHInit) {
    WORLD_H = clamp(Math.round(h * 0.72), 360, 640);
    worldHInit = true;
  }
  WORLD_H = clamp(WORLD_H, 180, 720);
  const ww = Math.max(64, Math.round(WORLD_H * aspect));
  glCanvas.width = ww;
  glCanvas.height = WORLD_H;
  Renderer.resize(ww, WORLD_H);
  INPUT.mx = clamp(INPUT.mx || VW / 2, 0, VW);
  INPUT.my = clamp(INPUT.my || VH * 0.52, 0, VH);
  if (!INPUT.mx || !INPUT.my) { INPUT.mx = VW / 2; INPUT.my = VH * 0.52; }
}

function setBodyClass() {
  const interactive = G.mode === 'loading' || G.mode === 'title' || G.mode === 'failed' || G.mode === 'paused';
  document.body.classList.toggle('playing', !interactive);
  document.body.classList.toggle('title', interactive);
}

// ---------------------------------------------------------------- boot ------
function waitForFonts() {
  return new Promise(resolve => {
    if (!document.fonts) { resolve(); return; }
    const timer = setTimeout(resolve, 2600);
    document.fonts.ready.then(() => { clearTimeout(timer); resolve(); }).catch(() => { clearTimeout(timer); resolve(); });
  });
}

async function boot() {
  resizeAll();
  BOOT.progress = 0.02;
  BOOT.stage = '初始化飞行系统';
  const ok = Renderer.init(glCanvas);
  if (!ok) {
    BOOT.error = 'WebGL2 context unavailable. Try Chrome, Edge, Firefox or Safari 15+.';
    drawUIFrame();
    return;
  }
  resizeAll(); // the renderer only allocates its FBO once a GL context exists
  requestAnimationFrame(loop);

  const fontWait = waitForFonts();
  let map = null;
  try {
    map = await generateWorld(G.seed, (p, label) => {
      BOOT.progress = 0.03 + p * 0.92;
      BOOT.stage = label;
    });
  } catch (err) {
    console.error(err);
    BOOT.error = 'World generation failed: ' + (err && err.message ? err.message : err);
    drawUIFrame();
    return;
  }
  BOOT.progress = 0.96;
  BOOT.stage = '编译地形与飞行系统';
  await fontWait;
  try {
    G.map = map;
    Forest.init(map, G.seed);
    Renderer.uploadWorld(map);
    G.meshes = buildMeshes();
    G.highScore = loadHighScore();
    G.spawn = map.findScenicSpawn(G.seed);
    setupTitleWorld();
    G.mode = 'title';
    G.camera = buildCamera(computePose(1, false), 0);
    BOOT.progress = 1;
    BOOT.stage = '就绪';
    BOOT.ready = true;
    TEST.readyAt = performance.now();
    if (PARAMS.get('autostart') === '1') {
      startRun();
      applyScenario(G.scenarioName);
    } else if (G.scenarioName && G.scenarioName !== 'title') {
      startRun();
      applyScenario(G.scenarioName);
    }
    if ($bootfallback) $bootfallback.style.display = 'none';
  } catch (err) {
    console.error(err);
    BOOT.error = 'Boot failed: ' + (err && err.message ? err.message : err);
  }
}

// --------------------------------------------------------------- frame ------
let lastFrame = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsSample = 60, fpsBelow = 0, qualityCooldown = 0;
let lastUiDraw = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!isFinite(dt) || dt <= 0) dt = 0.016;
  dt = Math.min(0.05, dt);
  G.lastDt = dt;
  if (!G.freeze && !BOOT.error) updateGame(dt);
  if (G.freeze) G.realTime += 0;
  if (G.map && G.meshes && G.camera && !BOOT.error) {
    const drawables = collectDrawables();
    Renderer.render(G.camera, G.map, G.time, drawables, {
      damage: G.damageFlash,
      cloudWhite: G.cloudWhite,
      fade: G.fade,
      sunGlow: G.sunGlow,
      cloudOn: true,
    });
  }
  drawUIFrame();
  // fps + dynamic internal resolution
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 1.8) {
    fpsSample = damp(fpsSample, fpsFrames / fpsAcc, 0.6, 1);
    G.fps = fpsSample;
    fpsAcc = 0; fpsFrames = 0;
    if (ADAPT_QUALITY && !FIXED_QUALITY && (G.mode === 'play' || G.mode === 'waveclear')) {
      qualityCooldown -= 1.8;
      if (fpsSample < 45 && qualityIndex < QUALITY_STEPS.length - 1 && qualityCooldown <= 0) {
        qualityIndex++;
        WORLD_H = Math.max(240, Math.round(WORLD_H * 0.86));
        qualityCooldown = 6;
        resizeAll();
      }
      fpsBelow = fpsSample < 45 ? fpsBelow + 1 : 0;
    }
  }
}

function collectDrawables() {
  const out = [];
  const p = G.player;
  const cam = G.camera;
  if (!cam) return out;
  const md = new Float32Array(16);
  const push = (mesh, pos, basis, scale, opts = {}) => {
    if (!mesh) return;
    const dist = vdist(pos, cam.pos);
    if (dist > (opts.maxDist || 7000)) return;
    const back = { x: -basis.fwd.x, y: -basis.fwd.y, z: -basis.fwd.z };
    m4basis(md, basis.right, basis.up, back, pos, scale);
    out.push({
      mesh, dist, matrix: md.slice(), alpha: opts.alpha === undefined ? 1 : opts.alpha,
      tint: opts.tint, outline: G.outlines !== false && opts.outline !== false,
    });
  };
  if (p && !p.dead && G.cockpitAlpha < 0.62) {
    push(G.meshes.player, p.pos, p.renderBasis, 1, { maxDist: 10000 });
    // under-wing stores
    for (let i = 0; i < Math.min(4, p.missiles); i++) {
      const slot = ((p.nextRail || 0) + i) % 4;
      push(G.meshes.missile, wingRailPosition(p, slot), p.renderBasis, 0.9, { maxDist: 800 });
    }
  }
  for (const e of G.enemies) {
    if (e.dead) continue;
    push(G.meshes.drone, e.pos, e.basis, 2.5, { maxDist: 6500 });
  }
  for (const g of G.ground) {
    if (g.dead) continue;
    const basis = basisFrom(g.yaw || 0, 0, 0);
    push(g.type === 'sam' ? G.meshes.sam : G.meshes.vehicle, g.pos, basis, 1, { maxDist: 6000, outline: true });
  }
  if (G.map && G.meshes.pineTree && p && !p.dead) {
    out.push(...Forest.collect(cam, p, G.meshes, { height: WORLD_H, aspect: VIEW_ASPECT, top: G.view === 0 }));
  }
  for (const m of G.missiles) {
    if (m.dead) continue;
    const sp = vlen(m.vel) || 1;
    const yaw = Math.atan2(m.vel.x, -m.vel.z);
    const pitch = Math.asin(clamp(m.vel.y / sp, -1, 1));
    const basis = basisFrom(yaw, pitch, 0);
    push(G.meshes.missile, m.pos, basis, 1, { maxDist: 3000 });
  }
  return out;
}

function drawUIFrame() {
  INPUT.uiHits.length = 0;
  setBodyClass();
  ctx.setTransform(UI_DPR, 0, 0, UI_DPR, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, VW, VH);
  ctx.imageSmoothingEnabled = false;
  if (BOOT.error || !BOOT.ready) {
    drawLoading();
    return;
  }
  if (G.map && G.player && G.camera) {
    drawWorldOverlay();
    if (G.cockpitAlpha > 0.01) drawCockpit(G.cockpitAlpha);
    drawScreenFeedback();
  }
  if (G.mode === 'title') {
    drawTitle();
    if (G.debug) drawDebug();
    return;
  }
  if (G.mode === 'play' || G.mode === 'waveclear' || G.mode === 'paused' || G.mode === 'dying') {
    drawHUD();
  }
  if ((G.mode === 'play' || G.mode === 'waveclear') && INPUT.touchMode) drawTouchControls();
  if (G.mode === 'waveclear') drawWaveClear();
  if (G.mode === 'paused') drawPause();
  if (G.mode === 'failed') drawFailed();
  if (G.mode === 'dying') drawDying();
  if (G.debug) drawDebug();
}

function drawScreenFeedback() {
  if (G.damageFlash > 0.012) {
    const a = clamp01(G.damageFlash);
    ctx.save();
    for (let i = 0; i < 6; i++) {
      ctx.globalAlpha = a * (0.18 - i * 0.024);
      ctx.fillStyle = '#d2372f';
      ctx.fillRect(0, i * 7, VW, 7);
      ctx.fillRect(0, VH - (i + 1) * 7, VW, 7);
      ctx.fillRect(i * 9, 0, 9, VH);
      ctx.fillRect(VW - (i + 1) * 9, 0, 9, VH);
    }
    ctx.restore();
  }
  if (G.flash > 0.015) {
    rect(0, 0, VW, VH, '#fff6e8', clamp01(G.flash) * 0.32);
  }
  if (G.mode === 'dying') {
    rect(0, 0, VW, VH, 'rgba(26,5,8,0.20)');
  }
}

function drawDying() {
  const pulse = 0.55 + 0.45 * Math.sin(G.realTime * 16);
  drawText('机体损毁', VW / 2, VH * 0.42, {
    size: 16, color: '#ff7967', align: 'center', spacing: 1, alpha: pulse,
    outline: '#12080b', bold: true
  });
  drawText('信号中断 // 正在恢复遥测', VW / 2, VH * 0.42 + 17, {
    size: 8, color: '#c5988d', align: 'center'
  });
}

function drawDebug() {
  const lines = [
    `FPS ${G.fps.toFixed(0)}  WORLD ${glCanvas.width}x${glCanvas.height}  UI ${VW}x${VH}`,
    `MODE ${G.mode}  VIEW ${G.view}  BLEND ${G.viewBlend.toFixed(2)}  COCKPIT ${G.cockpitAlpha.toFixed(2)}`,
    `SEED ${G.seed}  WAVE ${G.wave}  KILLS ${G.waveKills}/${G.waveTotal}  SCORE ${Math.floor(G.score)}`,
    `ENT ${G.enemies.length} GND ${G.ground.length} MSL ${G.missiles.length} FX ${G.effects.length} VPR ${G.vapor.length}`,
    `P ${G.player ? G.player.pos.x.toFixed(0) + ',' + G.player.pos.y.toFixed(0) + ',' + G.player.pos.z.toFixed(0) : '-'} AGL ${G.player ? G.player.agl.toFixed(0) : '-'}`,
  ];
  const w = 280, h = lines.length * 8 + 8;
  panel(8, VH - h - 8, w, h, { fill: 'rgba(8,6,12,0.85)', stroke: '#4d6b62', alpha: 0.9 });
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], 13, VH - h + 8 + i * 8, { size: 5, color: '#a9ded2', mono: true });
  }
}

// ------------------------------------------------------------ scenarios -----
function setViewName(name) {
  const v = name === 'top' ? 0 : (name === 'cockpit' ? 2 : 1);
  G.view = v; G.prevView = v; G.viewBlend = 1; G.chaseInit = false;
  if (v === 2) G.cockpitAlpha = 1; else G.cockpitAlpha = 0;
  if (G.player) G.camera = buildCamera(computePose(v, false), 0);
}

function ensurePlay() {
  const fresh = !G.player || G.mode === 'title' || G.mode === 'loading' || G.mode === 'failed';
  trace('ensurePlayClear', `enemies=${G.enemies.length} mode=${G.mode} fresh=${fresh}`);
  G.enemies.length = 0;
  G.ground.length = 0;
  G.missiles.length = 0;
  G.missileTrails.length = 0;
  G.bullets.length = 0;
  G.effects.length = 0;
  G.tracers.length = 0;
  G.popups.length = 0;
  G.decals.length = 0;
  G.vapor.length = 0;
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  // startRun repopulates the first wave; clearing must happen before it,
  // otherwise the freshly spawned wave is wiped and can never complete.
  if (fresh) startRun();
  else G.banner = null;
  G.mode = 'play';
  G.freeze = false;
  document.body.classList.add('playing');
  document.body.classList.remove('title');
}

function placeDroneAhead(dist = 700, side = 160, dAlt = 30) {
  const p = G.player;
  if (!p) return null;
  G.waveSpawned = Math.max(0, G.waveSpawned - 1);
  const e = spawnDrone(0);
  if (!e) return null;
  const b = p.renderBasis || p.basis;
  const pos = vadd(vadd(vadd(p.pos, vmul(b.fwd, dist)), vmul(b.right, side)), { x: 0, y: dAlt, z: 0 });
  pos.y = Math.max(pos.y, G.map.heightAt(pos.x, pos.z) + 180);
  e.pos = pos;
  e.yaw = Math.atan2(p.pos.x - pos.x, -(p.pos.z - pos.z));
  e.pitch = 0; e.roll = 0;
  e.basis = basisFrom(e.yaw, 0, 0);
  e.state = 'patrol';
  e.aware = 0;
  e.speed = 105;
  return e;
}

function lookAtPoint(point, extraPitch = 0) {
  const p = G.player;
  if (!p) return;
  p.yaw = Math.atan2(point.x - p.pos.x, -(point.z - p.pos.z));
  const horiz = Math.hypot(point.x - p.pos.x, point.z - p.pos.z) || 1;
  p.pitch = clamp(Math.atan2(point.y - p.pos.y, horiz) + extraPitch, -0.85, 0.85);
  p.basis = basisFrom(p.yaw, p.pitch, 0);
  p.renderBasis = p.basis;
  G.chaseInit = false;
  G.camera = buildCamera(computePose(G.view, false), 0);
}

function placeLockTarget() {
  const p = G.player;
  if (!p) return null;
  ensurePlay();
  setViewName('chase');
  let e = placeDroneAhead(760, 0, 0);
  if (!e) return null;
  // nudge until it is visible, out of cloud and has line of sight
  const b = p.basis;
  for (let i = 0; i < 8; i++) {
    const d = 620 + i * 45;
    const side = (i % 2 ? 50 : -50) * Math.floor((i + 1) / 2);
    const pos = vadd(vadd(vadd(p.pos, vmul(b.fwd, d)), vmul(b.right, side)), { x: 0, y: -20 + i * 10, z: 0 });
    pos.y = Math.max(pos.y, G.map.heightAt(pos.x, pos.z) + 220);
    e.pos = pos;
    e.basis = basisFrom(Math.atan2(p.pos.x - pos.x, -(p.pos.z - pos.z)), 0, 0);
    if (!targetConcealed(e) && lineOfSightClear(p.pos, pos, 10)) break;
  }
  e.state = 'engage'; e.aware = 3;
  G.lock.target = e; G.lock.progress = 1; G.lock.phase = 'locked';
  G.camera = buildCamera(computePose(1, false), 0);
  return e;
}

function applyScenario(name) {
  if (!name || name === 'title') return;
  G.freeze = false;
  ensurePlay();
  if (name === 'top' || name === 'chase' || name === 'cockpit') {
    setViewName(name);
    placeDroneAhead(560, -190, 40);
    placeDroneAhead(880, 240, -10);
    placeDroneAhead(1400, 40, 100);
    G.player.pos.y = Math.max(G.player.pos.y, G.map.heightAt(G.player.pos.x, G.player.pos.z) + 720);
    G.camera = buildCamera(computePose(G.view, false), 0);
    return;
  }
  if (name === 'lock') {
    placeLockTarget();
    G.freeze = true;
    return;
  }
  if (name === 'explosion' || name === 'strike') {
    setViewName('chase');
    const p = G.player;
    const e = placeDroneAhead(560, 30, -25);
    if (e) {
      const b = p.basis;
      const at = vadd(vadd(p.pos, vmul(b.fwd, 540)), vmul(b.right, 20));
      at.y = p.pos.y - 20;
      spawnExplosion(at, 1.5, 'air', { drone: true, smoke: 16 });
      for (let i = 0; i < 7; i++) spawnDebris(vadd(at, { x: rr(-6, 6), y: rr(-4, 4), z: rr(-6, 6) }), vmul(vnorm({ x: rr(-1, 1), y: rr(-0.3, 1), z: rr(-1, 1) }), rr(40, 90)));
      e.dead = true;
      G.enemies = G.enemies.filter(x => !x.dead);
      G.flash = 0.55; G.shake = 1.2;
    }
    G.freeze = true;
    return;
  }
  if (name === 'wave') {
    setViewName('chase');
    G.wave = 2;
    G.secondary = { type: 'sam', need: 2, killed: 2, text: '摧毁 2 个防空阵地' };
    G.secondaryDone = true;
    G.mode = 'waveclear'; G.respite = 6.2;
    G.freeze = true;
    return;
  }
  if (name === 'fail') {
    setViewName('chase');
    G.score = 14850; G.wave = 4; G.stats.kills = 17; G.missionTime = 214;
    G.newHigh = true; G.highScore = Math.max(G.highScore, G.score);
    G.mode = 'failed'; G.failTimer = 2;
    G.freeze = false;
    return;
  }
}

// --------------------------------------------------------- test harness -----
function screenshotSetup(kind) {
  ensurePlay();
  G.freeze = false;
  if (kind === 'title') {
    G.mode = 'title';
    setupTitleWorld();
    G.camera = buildCamera(computePose(1, false), 0);
    return { mode: G.mode, view: G.view };
  }
  if (kind === 'strike') {
    ensurePlay();
    setViewName('chase');
    // find water ahead for a missile splash; fall back to an airburst
    const p = G.player;
    let at = null;
    for (let a = 0; a < 20; a++) {
      const ang = p.yaw + (a % 2 ? 1 : -1) * (0.12 + Math.floor(a / 2) * 0.16);
      const d = 520 + (a % 3) * 120;
      const x = p.pos.x + Math.sin(ang) * d;
      const z = p.pos.z - Math.cos(ang) * d;
      if (G.map.heightAt(x, z) < -2) { at = { x, y: 0.5, z }; break; }
    }
    const tgt = placeDroneAhead(600, 30, 10);
    if (tgt) {
      const b = p.basis;
      at = vadd(vadd(p.pos, vmul(b.fwd, 620)), vmul(b.right, 40));
      at.y = p.pos.y - 30;
      tgt.pos = vcopy(at);
      tgt.dead = true;
      G.enemies = G.enemies.filter(x => !x.dead);
      spawnExplosion(at, 1.6, 'air', { drone: true, smoke: 18 });
      for (let i = 0; i < 8; i++) {
        spawnDebris(vadd(at, { x: rr(-5, 5), y: rr(-4, 4), z: rr(-5, 5) }), { x: rr(-40, 40), y: rr(-15, 55), z: rr(-40, 40) });
      }
      G.score += 450;
      G.popups.push({ pos: at, text: '+450', tag: '导弹击杀', color: '#ffe39a', t: 0, life: 2.3 });
      G.flash = 0.4; G.shake = 1.0;
      for (let i = 0; i < 10; i++) updateGame(0.02);
      G.flash = 0.35; G.shake = 0.9;
      G.freeze = true;
    } else {
      G.freeze = true;
    }
    return { mode: G.mode, view: G.view };
  }
  if (kind === 'explosion') {
    ensurePlay();
    setViewName('chase');
    const p = G.player;
    const b = p.basis;
    const at = vadd(vadd(vadd(p.pos, vmul(b.fwd, 330)), vmul(b.right, 22)), { x: 0, y: -16, z: 0 });
    const e = placeDroneAhead(330, 22, -16);
    if (e) { e.pos = vcopy(at); e.dead = true; G.enemies = G.enemies.filter(x => !x.dead); }
    spawnExplosion(at, 2.1, 'air', { drone: true, smoke: 26 });
    for (let i = 0; i < 16; i++) {
      spawnDebris(vadd(at, { x: rr(-6, 6), y: rr(-4, 4), z: rr(-6, 6) }), { x: rr(-60, 60), y: rr(-25, 80), z: rr(-60, 60) });
    }
    G.flash = 0.65; G.shake = 1.4;
    for (let i = 0; i < 8; i++) updateGame(0.02);
    G.flash = 0.5; G.shake = 1.1;
    G.freeze = true;
    return { mode: G.mode, view: G.view };
  }
  if (kind === 'lock') {
    placeLockTarget();
    G.freeze = true;
    return { mode: G.mode, view: G.view };
  }
  if (kind === 'top' || kind === 'chase' || kind === 'cockpit') {
    setViewName(kind);
    G.player.pos.y = Math.max(G.player.pos.y, G.map.heightAt(G.player.pos.x, G.player.pos.z) + 640);
    placeDroneAhead(500, -170, 60);
    placeDroneAhead(760, 220, 10);
    placeDroneAhead(1100, -60, 120);
    G.camera = buildCamera(computePose(G.view, false), 0);
    G.freeze = true;
    return { mode: G.mode, view: G.view };
  }
  return { error: 'unknown' };
}

function simulate(seconds, opts = {}) {
  const result = {
    seconds: 0, steps: 0, errors: [], fails: 0, restarts: 0,
    maxWave: G.wave, kills: 0, shots: 0, hits: 0, minEnemyClearance: 1e9,
    maxEnemyStuck: 0, maxWaveDuration: 0, deaths: 0, endMode: G.mode,
    minPlayerAgl: 1e9, maxEnemiesAirborne: 0, nan: 0, waveTimes: [],
  };
  const started = performance.now();
  try {
    G.trace = true;
    if (!G.player || opts.continueRun !== true) startRun();
    result.startEnemies = G.enemies.length;
    result.startWaveSpawned = G.waveSpawned;
    trace('simStart', `enemies=${G.enemies.length} spawned=${G.waveSpawned} total=${G.waveTotal} cap=${G.activeCap}`);
    G.mode = 'play';
    G.freeze = true;
    setViewName('top');
    INPUT.mx = VW / 2; INPUT.my = VH / 2;
    const h = 1 / 40;
    let t = 0, lastFire = -99, lastFlare = -99, nextJink = 3, jinkT = 0;
    let waveStart = 0, lastWave = G.wave, wasFailed = false;
    const watches = new Map();
    let stepGuard = 0;
    while (t < seconds) {
      const p = G.player;
      if (!p) break;
      const dt = h;
      stepGuard++;
      // bot: top-down pilot chases the nearest target, fires when locked
      let target = null, best = 1e9;
      for (const e of G.enemies) {
        if (e.dead || e.leaving) continue;
        const d = vdist(e.pos, p.pos);
        if (d < best) { best = d; target = e; }
      }
      let mx = VW / 2, my = VH / 2;
      if (target) {
        const s = {};
        if (projectToScreen(target.pos, s) && s.w > 0) {
          mx = clamp(s.x + rr(-14, 14), 10, VW - 10);
          my = clamp(s.y + rr(-14, 14), 10, VH - 10);
        } else {
          const bearing = Math.atan2(target.pos.x - p.pos.x, -(target.pos.z - p.pos.z));
          mx = VW / 2 + Math.sin(bearing) * 90;
          my = VH / 2 - Math.cos(bearing) * 90;
        }
      }
      if (Math.random() < 0.008) { nextJink = t; jinkT = 0.45; }
      if (t - nextJink < jinkT) {
        mx += rr(-120, 120); my += rr(-120, 120);
      }
      INPUT.mx = clamp(mx, 2, VW - 2);
      INPUT.my = clamp(my, 2, VH - 2);
      const threat = G.threatList.length ? G.threatList.reduce((a, b) => a.d < b.d ? a : b) : null;
      const alt = p.agl < 260 ? 1 : (p.pos.y > 1900 && Math.random() < 0.01 ? -1 : 0);
      const burn = (target && best > 1800) || (threat && threat.d < 700);
      G.testInput = { sx: 0, sy: 0, burn, alt, mx: INPUT.mx, my: INPUT.my };
      // periodic actions (direct API = deterministic)
      if (G.lock.phase === 'locked' && p.missiles > 0 && t - lastFire > 2.6 && best < 1900) {
        firePlayerMissile(); lastFire = t;
      }
      if (threat && threat.d < 900 && p.flares > 0 && t - lastFlare > 3.2) {
        tryFlares(); lastFlare = t;
      }
      if (p.rollCd <= 0 && threat && threat.d < 480 && Math.random() < 0.02) triggerBarrelRoll();
      // keep the fight fed if wave logic stalls
      updateGame(dt);
      t += dt;
      if (G.mode === 'failed') {
        if (!wasFailed) { result.fails++; result.deaths++; wasFailed = true; }
        if (G.failTimer > 1.0) { restartRun(); result.restarts++; G.mode = 'play'; setViewName('top'); wasFailed = false; }
      } else if (G.mode === 'play') wasFailed = false;
      if (G.mode === 'waveclear' && G.respite < 0.2) { /* updateGame advances next wave */ }
      if (G.wave !== lastWave) {
        const dur = +(t - waveStart).toFixed(1);
        result.waveTimes.push(dur);
        result.maxWaveDuration = Math.max(result.maxWaveDuration, dur);
        waveStart = t; lastWave = G.wave;
        result.maxWave = Math.max(result.maxWave, G.wave);
      }
      // health checks
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (!isFinite(e.pos.x) || !isFinite(e.pos.y) || !isFinite(e.pos.z)) { result.nan++; e.dead = true; continue; }
        const clear = e.pos.y - Math.max(G.map.heightAt(e.pos.x, e.pos.z), 0);
        result.minEnemyClearance = Math.min(result.minEnemyClearance, clear);
        const w = watches.get(e);
        if (!w) watches.set(e, { x: e.pos.x, y: e.pos.y, z: e.pos.z, t });
        else if (t - w.t > 4) {
          const moved = Math.hypot(e.pos.x - w.x, e.pos.y - w.y, e.pos.z - w.z);
          if (moved < 2 && e.state !== 'leaving') result.maxEnemyStuck = Math.max(result.maxEnemyStuck, t - w.t);
          watches.set(e, { x: e.pos.x, y: e.pos.y, z: e.pos.z, t });
        }
      }
      if (G.player && !G.player.dead) result.minPlayerAgl = Math.min(result.minPlayerAgl, G.player.agl);
      result.maxEnemiesAirborne = Math.max(result.maxEnemiesAirborne, G.enemies.filter(e => !e.dead).length);
      if (stepGuard % 4000 === 0) { /* long sims: yield not needed */ }
    }
    G.testInput = null;
    result.seconds = +t.toFixed(1);
    result.steps = stepGuard;
    result.kills = G.stats.kills;
    result.shots = G.stats.shots;
    result.hits = G.stats.hits;
    result.score = Math.floor(G.score);
    result.wave = G.wave;
    result.endMode = G.mode;
    result.minEnemyClearance = result.minEnemyClearance === 1e9 ? null : +result.minEnemyClearance.toFixed(1);
    result.minPlayerAgl = result.minPlayerAgl === 1e9 ? null : +result.minPlayerAgl.toFixed(1);
    result.maxEnemyStuck = +result.maxEnemyStuck.toFixed(1);
    result.cpuMs = Math.round(performance.now() - started);
    result.errorsPage = TEST.errors.slice(-5);
    result.waveTimes = result.waveTimes.slice(0, 20);
    result.enemyCount = G.enemies.length;
    result.groundCount = G.ground.length;
    result.missiles = G.missiles.length;
    result.waveKills = G.waveKills;
    result.waveSpawned = G.waveSpawned;
    result.waveTotal = G.waveTotal;
    result.activeCap = G.activeCap;
    result.spawnTimer = +G.spawnTimer.toFixed(2);
    result.enemiesLeaving = G.enemies.filter(e => e.leaving).length;
    result.playerDead = !!(G.player && G.player.dead);
    result.stats = Object.assign({}, G.stats);
    result.debugLog = G.debugLog.slice(-60);
    G.trace = false;
    G.freeze = false;
  } catch (err) {
    result.errors.push(String(err && (err.stack || err.message) || err));
    G.testInput = null;
    G.freeze = false;
  }
  return result;
}

window.__PI = {
  get G() { return G; },
  get boot() { return BOOT; },
  get renderer() { return Renderer; },
  errors: TEST.errors,
  exceptions: TEST.exceptions,
  ready() { return BOOT.ready; },
  snapshot() {
    return {
      ready: BOOT.ready, mode: G.mode, view: G.view, score: G.score, wave: G.wave,
      player: G.player ? {
        pos: G.player.pos, yaw: G.player.yaw, pitch: G.player.pitch, roll: G.player.roll,
        speed: G.player.speed, shield: G.player.shield, fuel: G.player.fuel,
        missiles: G.player.missiles, flares: G.player.flares, agl: G.player.agl, dead: G.player.dead,
      } : null,
      enemies: G.enemies.length, ground: G.ground.length, missiles: G.missiles.length,
      effects: G.effects.length, lock: G.lock.phase, fps: G.fps,
      calls: { drawCalls: 0 },
    };
  },
  start(view = 'chase') {
    if (!BOOT.ready) return { error: 'not ready' };
    G.trace = true;
    G.debugLog.length = 0;
    trace('apiStart');
    ensurePlay();
    trace('afterEnsurePlay', `enemies=${G.enemies.length} spawned=${G.waveSpawned}`);
    setViewName(view);
    G.freeze = false;
    G.player.pos.y = Math.max(G.player.pos.y, G.map.heightAt(G.player.pos.x, G.player.pos.z) + 700);
    placeDroneAhead(540, -180, 30);
    trace('afterPlace1', `enemies=${G.enemies.length} spawned=${G.waveSpawned}`);
    placeDroneAhead(820, 220, 40);
    trace('afterPlace2', `enemies=${G.enemies.length} spawned=${G.waveSpawned}`);
    G.camera = buildCamera(computePose(G.view, false), 0);
    return this.snapshot();
  },
  screenshot(kind) { return screenshotSetup(kind); },
  setView(view) { setViewName(view); return this.snapshot(); },
  closeup() {
    if (!G.player) return { error: 'no player' };
    G.freeze = true;
    const p = G.player, b = p.renderBasis;
    const pose = {
      pos: vadd(vadd(vadd(p.pos, vmul(b.fwd, -11)), vmul(b.up, 3.6)), vmul(b.right, 2.6)),
      target: vadd(p.pos, vmul(b.up, 0.5)),
      up: { x: 0, y: 1, z: 0 },
      fov: 0.85,
    };
    G.camera = buildCamera(pose, 0);
    return { ok: true };
  },
  freeze(v) { G.freeze = !!v; return G.freeze; },
  step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) updateGame(1 / 60); return this.snapshot(); },
  lock() { placeLockTarget(); return this.snapshot(); },
  explosion() { return screenshotSetup('explosion'); },
  strike() { return screenshotSetup('strike'); },
  simulate(sec, opts) { return simulate(sec, opts); },
  togglePause() { togglePause(); return G.mode; },
  sound(on) { G.sound = !!on; AudioSys.setEnabled(G.sound); return G.sound; },
  outlines(v) { G.outlines = !!v; return G.outlines; },
  hide() { if ($bootfallback) $bootfallback.style.display = 'none'; },
};

// --------------------------------------------------------------- start ------
boot().catch(err => {
  console.error(err);
  BOOT.error = 'Fatal boot error: ' + (err && err.message ? err.message : err);
});

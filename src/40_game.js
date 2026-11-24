// ---------------------------------------------------------------------------
// GAME — state, flight model, cameras, waves, scoring.
// ---------------------------------------------------------------------------
const SPEED_CRUISE = 112;
const SPEED_BURN = 204;
const BANK_MAX = 1.02;
const LOCK_TIME = 0.8;
const MISSILE_RELOAD = 4.0;
const PLAYER_MAX_SHIELD = 100;
const DRONE_MAX_HP = 100;
const GUN_INTERVAL = 0.1;
const GUN_RANGE = 1100;
const GUN_DAMAGE = 12;
const GUN_BULLET_SPEED = 720;
const GUN_BULLET_GRAVITY = 38;
const GUN_BULLET_LIFE = 2.2;
// 导弹靠持续推力飞行，重力只留下轻微下坠；离架速度高于机炮，再加速到上限，
// 同一帧同发时导弹在距离和高度上都领先，不会比机炮更早落在近处。
const MISSILE_GRAVITY = 16;
const MISSILE_PLAYER_SPEED = 820;
const MISSILE_PLAYER_MAX_SPEED = 1000;
const MISSILE_ENEMY_SPEED = 280;
const MISSILE_ENEMY_MAX_SPEED = 430;
const MISSILE_TRAIL_SPACING = 15;
const MISSILE_TRAIL_LIFE = 1.8;
const MOUSE_STEER_TIMEOUT = 0.42;

const G = {
  mode: 'loading',        // loading | title | play | waveclear | victory | dying | failed | paused
  pausedFrom: null,
  time: 0, realTime: 0, missionTime: 0,
  missionWaveGoal: 0, defenseStage: null,
  map: null, meshes: null, seed: 1337,
  player: null, camera: null,
  enemies: [], ground: [], missiles: [], missileTrails: [], bullets: [], effects: [], tracers: [], popups: [], decals: [], vapor: [],
  view: 1, prevView: 1, viewBlend: 1,
  cockpitAlpha: 0,
  shake: 0, damageFlash: 0, flash: 0, hitStop: 0, fade: 0,
  lock: { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 },
  wave: 1, waveKills: 0, waveSpawned: 0, waveTotal: 3, activeCap: 3, spawnTimer: 0,
  secondary: null, secondaryDone: false, droneTotal: 0,
  score: 0, highScore: 0, combo: 1, lastKillTime: -99,
  banner: null, respite: 0, waveTimer: 0, waveElapsed: 0,
  stats: { kills: 0, sam: 0, veh: 0, shots: 0, hits: 0, dmg: 0 },
  failTimer: 0, dyingTimer: 0,
  clockStart: 18 * 3600 + 43 * 60,
  sound: false, titleTime: 0, titleMode: false,
  cloudWhite: 0, sunGlow: 1,
  lastWarn: -99, lastLowWarn: -99, lastFuelWarn: -99,
  lastFlareTime: -99, freeze: false, debug: false,
  chasePos: { x: 0, y: 0, z: 0 }, chaseUp: { x: 0, y: 1, z: 0 }, chaseInit: false,
  touchStick: null,
  testInput: null,
  fps: 60, qualityH: 340, qualityStep: 0,
  scenarioName: '',
  spawn: null,
  introCamera: 0,
  threatList: [],
  allies: [], wingmanWanted: false, allyKills: 0,
  warnLamp: 0,
  debugLog: [],
};

// --------------------------------------------------------------- helpers ----
function hudFontSize(n) { return Math.round(n); }

function addShake(v) { G.shake = Math.min(3.2, G.shake + v); }

function trace(event, extra = '') {
  if (!G.trace && !G.debug) return;
  G.debugLog.push(`${G.time.toFixed(1)} ${event} ${extra}`);
  if (G.debugLog.length > 400) G.debugLog.shift();
}

function playerAlive() { return G.player && !G.player.dead && G.mode !== 'failed' && G.mode !== 'dying'; }

function skillOfWave(n) { return Math.min(1, (n - 1) / 10); }

function makePlayer(map, forTitle = false) {
  const sp = G.spawn || map.findScenicSpawn(G.seed);
  G.spawn = sp;
  const alt = Math.max(0, map.heightAt(sp.x, sp.z)) + 600;
  const p = {
    pos: { x: sp.x, y: Math.min(alt, 2100), z: sp.z },
    yaw: sp.heading || 0.6, pitch: 0.02, roll: 0,
    speed: SPEED_CRUISE, targetSpeed: SPEED_CRUISE,
    shield: PLAYER_MAX_SHIELD, fuel: 100,
    agl: 0, groundH: 0, gLoad: 1, pitchRate: 0, yawRate: 0,
    rollT: 0, rollCd: 0, invuln: 0, spin: 0,
    missiles: 4, nextRail: 0, reloads: [], flares: 3, flareCd: 0, gunCd: 0,
    lastHit: -99, dead: false, burning: false,
    inCloud: 0, skimming: false, terrainWarn: false, speedDisplay: 0,
    basis: null, renderBasis: null,
    vaporTimer: 0, sprayTimer: 0, plumeTimer: 0,
    titleBank: 0,
  };
  p.basis = basisFrom(p.yaw, p.pitch, p.roll);
  p.renderBasis = p.basis;
  return p;
}

function setupTitleWorld() {
  G.player = makePlayer(G.map, true);
  G.player.pos.y = Math.max(G.map.heightAt(G.player.pos.x, G.player.pos.z) + 320, 520);
  G.enemies.length = 0; G.ground.length = 0; G.allies.length = 0; G.missiles.length = 0; G.missileTrails.length = 0; G.bullets.length = 0;
  G.effects.length = 0; G.tracers.length = 0; G.popups.length = 0; G.decals.length = 0; G.vapor.length = 0;
  G.view = 1; G.prevView = 1; G.viewBlend = 1; G.cockpitAlpha = 0;
  G.chaseInit = false;
  G.titleTime = 0;
  if (typeof wingmanOnStop === 'function') wingmanOnStop('title');
  const top = -30 + Math.random() * 0; // keep deterministic
  G.playerTitleYaw = G.player.yaw;
}

function startRun() {
  resetMouseSteering();
  G.mode = 'play';
  G.debugLog.length = 0;
  trace('startRun');
  G.score = 0;
  G.wave = 1;
  G.stats = { kills: 0, sam: 0, veh: 0, shots: 0, hits: 0, dmg: 0 };
  G.combo = 1; G.lastKillTime = -99;
  G.allyKills = 0;
  G.missionTime = 0;
  G.time = 0;
  G.player = makePlayer(G.map, false);
  G.enemies.length = 0; G.ground.length = 0; G.allies.length = 0; G.missiles.length = 0; G.missileTrails.length = 0; G.bullets.length = 0;
  G.effects.length = 0; G.tracers.length = 0; G.popups.length = 0; G.decals.length = 0; G.vapor.length = 0;
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  G.score = 0;
  G.view = 1; G.prevView = 1; G.viewBlend = 1; G.cockpitAlpha = 0;
  G.chaseInit = false; G.shake = 0; G.damageFlash = 0; G.flash = 0; G.hitStop = 0; G.fade = 0;
  G.waveKills = 0; G.waveSpawned = 0; G.waveElapsed = 0;
  G.respite = 0; G.dyingTimer = 0; G.failTimer = 0;
  G.banner = { title: '第 01 波', sub: '', t: 0, life: 3.2 };
  G.spawnTimer = 0;
  document.body.classList.add('playing');
  document.body.classList.remove('title');
  beginWave(1);
  AudioSys.waveStart();
  if (AudioSys.enabled) AudioSys.setEnabled(true);
  if (typeof wingmanOnRunStart === 'function') wingmanOnRunStart();
}

function restartRun() {
  AudioSys.uiTick();
  startRun();
}

function failMission() {
  if (G.mode === 'failed') return;
  G.mode = 'failed';
  G.failTimer = 0;
  G.newHigh = G.score > (G.highScore || 0);
  saveHighScore();
  AudioSys.missionFail();
  AudioSys.updateEngine(false, 0, true);
  if (typeof wingmanOnStop === 'function') wingmanOnStop('failed');
  document.body.classList.add('title');
  document.body.classList.remove('playing');
}

function killPlayer() {
  if (!G.player || G.player.dead) return;
  const p = G.player;
  p.dead = true;
  p.shield = 0;
  G.mode = 'dying';
  G.dyingTimer = 1.7;
  G.shake = 2.2;
  G.flash = 0.85;
  G.hitStop = 0.08;
  spawnExplosion(p.pos, 1.6, 'air', { color: 'player', smoke: 14 });
  for (let i = 0; i < 4; i++) {
    spawnExplosion({ x: p.pos.x + rr(-7, 7), y: p.pos.y + rr(-4, 4), z: p.pos.z + rr(-7, 7) }, rr(0.5, 1.1), 'air', { delay: i * 0.12 });
  }
  AudioSys.explosion(1, true);
  saveHighScore();
}

function highScoreKey() { return 'patrol-intercept-hs-v1'; }
function loadHighScore() {
  try { G.highScore = +(localStorage.getItem(highScoreKey()) || 0) || 0; } catch (e) { G.highScore = 0; }
}
function saveHighScore() {
  if (G.score > (G.highScore || 0)) {
    G.highScore = Math.floor(G.score);
    try { localStorage.setItem(highScoreKey(), String(G.highScore)); } catch (e) {}
  }
}

// --------------------------------------------------------------- views ------
function cycleView() {
  if (G.mode !== 'play' && G.mode !== 'waveclear' && G.mode !== 'title') return;
  resetMouseSteering();
  G.prevView = G.view;
  G.view = (G.view + 1) % 3;
  G.viewBlend = 0;
  G.chaseInit = false;
  AudioSys.uiTick();
}

function computePose(view, allowSmooth = true) {
  const p = G.player;
  const b = p.basis;
  if (view === 0) {
    const aspect = VW / VH;
    const fit = Math.max(.8, Math.min(1, 1.84 / aspect), .68 / aspect);
    return {
      pos: { x: p.pos.x, y: p.pos.y + 26 * fit, z: p.pos.z },
      target: vcopy(p.pos),
      up: { x: 0, y: 0, z: -1 },
      fov: 0.95
    };
  }
  if (view === 2) {
    const cockpit = p.renderBasis;
    const pos = vadd(vadd(p.pos, vmul(cockpit.fwd, 1.8)), vmul(cockpit.up, 0.72));
    return {
      pos,
      target: vadd(pos, vmul(cockpit.fwd, 160)),
      up: vcopy(cockpit.up),
      fov: p.flightComfort ? 1.18 : 1.18 + clamp((p.speed - SPEED_CRUISE) / 500, 0, 0.06)
    };
  }
  // chase
  const titleShift = G.mode === 'title' ? vmul(b.right, -9.5 * VW / VH) : { x: 0, y: 0, z: 0 };
  const desired = vadd(vadd(vadd(p.pos, vmul(b.fwd, -22.5)), vmul(b.up, 8.0)), titleShift);
  const viewUp = vnorm(vlerp({ x: 0, y: 1, z: 0 }, b.up, 0.78));
  if (!G.chaseInit || !allowSmooth) {
    G.chasePos = vcopy(desired); G.chaseUp = vcopy(viewUp); G.chaseInit = true;
  } else {
    G.chasePos = vlerp(G.chasePos, desired, 1 - Math.exp(-11 * (G.lastDt || 0.016)));
    G.chaseUp = vnorm(vlerp(G.chaseUp, viewUp, 1 - Math.exp(-8 * (G.lastDt || 0.016))));
  }
  let cp = vcopy(G.chasePos);
  // keep the chase camera out of the ground
  if (G.map) {
    const gh = Math.max(G.map.heightAt(cp.x, cp.z), 0);
    if (cp.y < gh + 4.5) cp.y = gh + 4.5;
  }
  const target = vadd(vadd(vadd(p.pos, vmul(b.fwd, 32)), vmul(b.up, 1.6)), titleShift);
  return { pos: cp, target, up: vcopy(G.chaseUp), fov: 1.01 + clamp((p.speed - SPEED_CRUISE) / 700, 0, 0.05) };
}

function buildCamera(pose, shakeAmt = 0) {
  const view = mat4(), proj = mat4(), vp = mat4();
  let pos = vcopy(pose.pos);
  let target = vcopy(pose.target);
  let up = pose.up;
  if (shakeAmt > 0.001) {
    const a = Math.random() * TAU, b2 = Math.random() * TAU;
    const s = shakeAmt;
    pos.x += Math.sin(a) * s * 1.3;
    pos.y += Math.cos(a * 1.7) * s * 0.9;
    pos.z += Math.cos(b2) * s * 1.3;
    target.x += Math.sin(b2 * 1.3) * s * 0.9;
    target.y += Math.cos(a) * s * 0.7;
  }
  m4lookAt(view, pos, target, up);
  m4perspective(proj, pose.fov, VW / VH, 0.8, 30000);
  m4mul(vp, proj, view);
  const right = { x: view[0], y: view[4], z: view[8] };
  const upv = { x: view[1], y: view[5], z: view[9] };
  const back = { x: view[2], y: view[6], z: view[10] };
  const fwd = { x: -back.x, y: -back.y, z: -back.z };
  return {
    pos, target, up: upv, right, fwd, fov: pose.fov,
    view, proj, vp, tanHalf: Math.tan(pose.fov * 0.5),
    aspect: VW / VH
  };
}

function blendCameraPose(a, b, t, arc) {
  // 球面插值完整朝向，避免正飞与倒飞的up向量在中点抵消。
  const orientation = pose => {
    const f = vnorm(vsub(pose.target, pose.pos)), r = vnorm(vcross(f, pose.up)), u = vcross(r, f);
    const m = [[r.x, u.x, -f.x], [r.y, u.y, -f.y], [r.z, u.z, -f.z]], q = [0, 0, 0, 0];
    const trace = m[0][0] + m[1][1] + m[2][2];
    if (trace > 0) {
      const s = 2 * Math.sqrt(1 + trace);
      q[3] = s / 4;
      q[0] = (m[2][1] - m[1][2]) / s; q[1] = (m[0][2] - m[2][0]) / s; q[2] = (m[1][0] - m[0][1]) / s;
    } else {
      const i = m[0][0] > m[1][1] && m[0][0] > m[2][2] ? 0 : m[1][1] > m[2][2] ? 1 : 2;
      const j = (i + 1) % 3, k = (i + 2) % 3, s = 2 * Math.sqrt(1 + m[i][i] - m[j][j] - m[k][k]);
      q[i] = s / 4; q[3] = (m[k][j] - m[j][k]) / s;
      q[j] = (m[j][i] + m[i][j]) / s; q[k] = (m[k][i] + m[i][k]) / s;
    }
    return q;
  };
  const qa = orientation(a), qb = orientation(b), dotOf = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  // 一次过渡只选一次弧；近180°时不能让浮点符号逐帧改变旋转方向。
  if (arc.from) {
    for (const [q, previous] of [[qa, arc.from], [qb, arc.to]])
      if (dotOf(q, previous) < 0) for (let i = 0; i < 4; i++) q[i] = -q[i];
  } else if (dotOf(qa, qb) < 0) for (let i = 0; i < 4; i++) qb[i] = -qb[i];
  arc.from = qa; arc.to = qb;
  const dot = dotOf(qa, qb);
  const angle = Math.acos(clamp(dot, -1, 1)), sine = Math.sin(angle);
  const wa = sine > 1e-5 ? Math.sin((1 - t) * angle) / sine : 1 - t;
  const wb = sine > 1e-5 ? Math.sin(t * angle) / sine : t;
  const q = qa.map((v, i) => v * wa + qb[i] * wb), length = Math.hypot(...q);
  const [x, y, z, w] = q.map(v => v / length);
  const fwd = { x: -2 * (x * z + y * w), y: -2 * (y * z - x * w), z: 2 * (x * x + y * y) - 1 };
  const up = { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) };
  const pos = vlerp(a.pos, b.pos, t);
  return { pos, target: vmad(pos, fwd, lerp(vdist(a.pos, a.target), vdist(b.pos, b.target), t)), up, fov: lerp(a.fov, b.fov, t) };
}

function updateCamera(dt) {
  if (!G.player) return;
  const p = G.player;
  // base basis of the airframe (flight), then a render basis with barrel-roll spin
  p.basis = basisFrom(p.yaw, p.pitch, p.roll + (p.inversionRoll || 0));
  const rp = p.roll + (p.inversionRoll || 0) + p.spin;
  p.renderBasis = basisFrom(p.yaw, p.pitch, rp);

  let pose;
  if (G.viewBlend < 1 && G.prevView !== G.view) {
    const a = computePose(G.prevView, false);
    const b = computePose(G.view, false);
    const t = smoothstep(0, 1, clamp01(G.viewBlend));
    if (p.flightComfort && (!G.cameraBlendArc || G.viewBlend === 0)) G.cameraBlendArc = {};
    pose = p.flightComfort ? blendCameraPose(a, b, t, G.cameraBlendArc) : {
      pos: vlerp(a.pos, b.pos, t),
      target: vlerp(a.target, b.target, t),
      up: vnorm(vlerp(a.up, b.up, t)),
      fov: lerp(a.fov, b.fov, t)
    };
    G.viewBlend = Math.min(1, G.viewBlend + dt / 1.0);
  } else {
    G.cameraBlendArc = null;
    pose = computePose(G.view, true);
  }
  // clamp camera above the terrain even in a blended pose
  if (G.map) {
    const gh = Math.max(G.map.heightAt(pose.pos.x, pose.pos.z), 0);
    if (pose.pos.y < gh + 3) pose.pos.y = gh + 3;
  }
  // 外部镜头不随机晃动；受击仍保留护盾读数、告警、闪边和音效。
  const shake = G.view === 2 ? G.shake * 0.45 : 0;
  G.camera = buildCamera(pose, shake);

  // cockpit overlay fades with view intent
  const targetCockpit = G.view === 2 ? 1 : 0;
  const rate = G.viewBlend < 1 ? 5.5 : 8;
  G.cockpitAlpha = damp(G.cockpitAlpha, targetCockpit, rate, dt);
  if (G.cockpitAlpha < 0.01) G.cockpitAlpha = 0;
}

function projectToScreen(p, out = {}) {
  if (!G.camera) return false;
  const ok = projectPoint(p, G.camera.vp, out);
  if (!ok) return false;
  out.visible = out.x > -40 && out.x < VW + 40 && out.y > -40 && out.y < VH + 40;
  out.dist = out.w;
  return true;
}

function screenPixelPerMetre(dist) {
  return VH / (2 * Math.max(1, dist) * Math.tan((G.camera ? G.camera.fov : 1) * 0.5));
}

function lineOfSightClear(a, b, steps = 14) {
  if (!G.map) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), z = lerp(a.z, b.z, t);
    const h = Math.max(G.map.heightAt(x, z), 0);
    if (y < h + 1.5) return false;
  }
  return true;
}

// ----------------------------------------------------------- flight ---------
function readSteering() {
  const p = G.player;
  const topView = G.view === 0;
  const mouseBlend = G.testInput || TOUCH.active ? 1 : p.mouseSteering === false ? 0
    : INPUT.touchMode && !Number.isFinite(INPUT.mouseSteerAge) ? 1 : 1 - clamp((INPUT.mouseSteerAge - 0.14) / (MOUSE_STEER_TIMEOUT - 0.14), 0, 1);
  let sx = 0, sy = 0, burn = false, alt = 0, turn = 0;
  const keyLeft = INPUT.keys.has('KeyA') || INPUT.keys.has('ArrowLeft');
  const keyRight = INPUT.keys.has('KeyD') || INPUT.keys.has('ArrowRight');
  const keyUp = INPUT.keys.has('KeyW') || INPUT.keys.has('ArrowUp');
  const keyDown = INPUT.keys.has('KeyS') || INPUT.keys.has('ArrowDown');
  if (G.testInput) {
    const ti = G.testInput;
    sx = ti.sx || 0; sy = ti.sy || 0; burn = !!ti.burn; alt = ti.alt || 0; turn = ti.turn || 0;
    if (ti.mx !== undefined) INPUT.mx = ti.mx;
    if (ti.my !== undefined) INPUT.my = ti.my;
  } else {
    if (!topView) {
      const cx = VW * 0.5, cy = VH * 0.52;
      sx = (INPUT.mx - cx) / (VW * 0.30);
      sy = (cy - INPUT.my) / (VH * 0.31);
      const dz = 0.055;
      if (Math.abs(sx) < dz) sx = 0; else sx = sign(sx) * (Math.abs(sx) - dz) / (1 - dz);
      if (Math.abs(sy) < dz) sy = 0; else sy = sign(sy) * (Math.abs(sy) - dz) / (1 - dz);
      sx = clamp(sx, -1, 1); sy = clamp(sy, -1, 1);
      sx *= mouseBlend; sy *= mouseBlend;
      // WASD takes over while held; mouse steering resumes on release
      const kx = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
      const ky = (keyUp ? 1 : 0) - (keyDown ? 1 : 0);
      if (kx) sx = kx;
      if (ky) sy = ky;
    } else {
      turn = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    }
    alt = (keyUp ? 1 : 0) - (keyDown ? 1 : 0);
  }
  if (G.touchStick) {
    sx = G.touchStick.x; sy = G.touchStick.y;
  }
  const holdBurn = INPUT.keys.has('ShiftLeft') || INPUT.keys.has('ShiftRight') || INPUT.touchBurn;
  burn = burn || holdBurn;
  if (p.recovery) sx = sy = alt = turn = 0;
  return { sx, sy, burn, alt, turn, topView, mouseBlend };
}

function topHeadingError(p, mouseBlend) {
  if (G.testInput && G.testInput.heading !== undefined) return wrapAngle(G.testInput.heading - p.yaw);
  const dx = (INPUT.mx - VW * 0.5) * mouseBlend, dy = (INPUT.my - VH * 0.5) * mouseBlend;
  return Math.hypot(dx, dy) > 12 ? wrapAngle(Math.atan2(dx, -dy) - p.yaw) : 0;
}

// 玩家和战役敌机共用同一个转向限幅，均以本帧真实空速计算。
function flightTurnLimit(p) { return p?.turnRateAtSpeed?.(p.speed) ?? p?.turnRateLimit ?? 22 * DEG; }

function updateFlight(dt) {
  const p = G.player;
  if (!p || p.dead) return;
  if (INPUT.touchMode && !TOUCH.active) {
    // ease the virtual stick back to neutral after a finger lifts
    INPUT.mx = damp(INPUT.mx, VW / 2, 2.6, dt);
    INPUT.my = damp(INPUT.my, VH * 0.52, 2.6, dt);
  }
  if (Number.isFinite(INPUT.mouseSteerAge)) INPUT.mouseSteerAge += dt;
  const st = readSteering();
  p.steering = st;
  G.lastDt = dt;

  // afterburner / fuel
  const wantBurn = st.burn && p.fuel > 0.5 && G.mode !== 'failed' && (!p.speedResponse || (p.burnSpeed ?? SPEED_BURN) > (p.cruiseSpeed ?? SPEED_CRUISE) + 0.01);
  p.burning = wantBurn;
  const targetSpeed = p.targetSpeed = wantBurn ? (p.burnSpeed ?? SPEED_BURN) : (p.cruiseSpeed ?? SPEED_CRUISE);
  p.speed = wantBurn && p.speed <= targetSpeed
    ? Math.min(targetSpeed, p.speed + (p.burnAcceleration ?? 62) * dt)
    : damp(p.speed, targetSpeed, p.speedResponse ?? (p.speed > targetSpeed ? 0.75 : 0.55), dt);
  p.fuel = wantBurn ? Math.max(0, p.fuel - 15.5 * dt) : Math.min(100, p.fuel + 10.5 * dt);
  const speedFactor = clamp(125 / Math.max(80, p.speed), 0.56, 1.15);
  const comfortable = !!p.flightComfort;

  if (p.recovery) {
    p.yawRate = p.pitchRate = 0;
    p.gLoad = 1;
  } else if (st.topView && !comfortable) {
    // top-down: A/D turns, W/S trims altitude; the cursor still steers
    const maxTurn = 1.85 * speedFactor;
    let turn = 0;
    if (st.turn) {
      turn = st.turn * maxTurn;
      const targetRoll = -st.turn * BANK_MAX * 0.8;
      p.roll = angleLerp(p.roll, targetRoll, 1 - Math.exp(-5 * dt));
    } else {
      const dy2 = topHeadingError(p, st.mouseBlend);
      turn = clamp(dy2 * 3.0, -maxTurn, maxTurn);
      const targetRoll = clamp(dy2 * 1.4, -BANK_MAX, BANK_MAX);
      p.roll = angleLerp(p.roll, targetRoll, 1 - Math.exp(-5 * dt));
    }
    p.yaw = wrapAngle(p.yaw + turn * dt);
    p.yawRate = turn;
    let targetPitch = 0;
    if (st.alt > 0) targetPitch = 0.46;
    else if (st.alt < 0) targetPitch = -0.46;
    p.pitch = damp(p.pitch, targetPitch, 3, dt);
    p.pitchRate = 0;
    p.gLoad = clamp(1 + Math.abs(turn) * p.speed / 9.81 * 0.10, 1, 6);
  } else {
    const bankInput = st.topView ? st.turn || clamp(topHeadingError(p, st.mouseBlend) * 2.2, -1, 1) : st.sx;
    const pitchInput = st.topView ? st.alt : st.sy;
    const bankLimit = comfortable ? 0.56 : BANK_MAX;
    const targetRoll = -bankInput * bankLimit;
    const bankStep = wrapAngle(targetRoll - p.roll) * (1 - Math.exp(-(comfortable ? 2.2 : 6.5) * dt));
    p.roll += comfortable ? clamp(bankStep, -0.6 * dt, 0.6 * dt) : bankStep;
    const oldPitch = p.pitch;
    const pitchRate = pitchInput * (comfortable ? 0.52 : 1.08);
    if (Math.abs(pitchInput) > 0.03) p.pitch += pitchRate * dt;
    else if (!comfortable) p.pitch = damp(p.pitch, 0, 2.2, dt);
    p.pitch = clamp(p.pitch, -1.02, 1.02);
    p.pitchRate = (p.pitch - oldPitch) / Math.max(dt, 1e-6);
    if (!comfortable && Math.abs(bankInput) < 0.03 && Math.abs(p.roll) < 0.25) p.roll *= 1 - 1.6 * dt;
    const turnLimit = flightTurnLimit(p);
    const yawDelta = comfortable
      ? -Math.sin(p.roll) / Math.sin(bankLimit) * turnLimit
      : -Math.sin(p.roll) * (1.28 * speedFactor * (p.burning ? 0.70 : 1) * (1 - Math.abs(p.pitch) * 0.25));
    p.yaw = wrapAngle(p.yaw + yawDelta * dt);
    p.yawRate = yawDelta;
    p.gLoad = clamp(1 + Math.abs(yawDelta) * p.speed / 9.81 * 0.42 + Math.abs(pitchRate) * 0.6, 1, 9);
  }
  p.basis = basisFrom(p.yaw, p.pitch, p.roll + (p.inversionRoll || 0));

  // barrel roll
  if (p.rollT > 0) {
    p.rollT -= dt;
    p.invuln = Math.max(p.invuln, Math.min(0.6, p.rollT));
    const prog = 1 - p.rollT / 0.72;
    p.spin = (p.rollDir || 1) * Math.PI * 2 * (prog * prog * (3 - 2 * prog));
    if (p.rollT <= 0) { p.rollT = 0; p.spin = 0; }
  }
  if (p.rollCd > 0) p.rollCd -= dt;
  if (p.invuln > 0) p.invuln -= dt;
  if (p.flareCd > 0) p.flareCd -= dt;

  // missiles reload
  for (let i = p.reloads.length - 1; i >= 0; i--) {
    p.reloads[i] -= dt;
    if (p.reloads[i] <= 0) {
      p.reloads.splice(i, 1);
      p.missiles = Math.min(4, p.missiles + 1);
    }
  }

  // integrate
  const fwd = p.basis.fwd;
  p.pos.x += fwd.x * p.speed * dt;
  p.pos.y += fwd.y * p.speed * dt;
  p.pos.z += fwd.z * p.speed * dt;

  // terrain awareness
  const hHere = G.map.heightAt(p.pos.x, p.pos.z);
  const surf = Math.max(hHere, 0);
  p.groundH = hHere;
  p.agl = p.pos.y - hHere;
  p.terrainWarn = p.agl < 130;
  const aheadDist = Math.max(70, p.speed * 1.1);
  const af = vadd(p.pos, vmul(fwd, aheadDist));
  const aheadH = G.map.heightAt(af.x, af.z);
  if (aheadH > p.pos.y - 35) {
    p.pitch = Math.max(p.pitch, 0.28);
    p.terrainWarn = true;
  }
  if (p.pos.y < surf + 24) {
    p.pos.y = Math.max(p.pos.y, surf + 24);
    p.pitch = Math.max(p.pitch, 0.36);
    p.terrainWarn = true;
    if (p.agl < 12) {
      damagePlayer(9 * dt, 'terrain', true);
      if (Math.random() < 0.3) spawnSparks(vadd(p.pos, { x: 0, y: -8, z: 0 }), 2, '#ffd27a');
      G.shake = Math.max(G.shake, 0.5);
    }
  }
  if (p.pos.y < surf + 6) { p.pos.y = surf + 6; }
  if (p.pos.y > 2400) {
    p.pos.y = 2400;
    p.pitch = Math.min(p.pitch, 0);
  }

  // water skimming + spray
  const overWater = hHere < -0.5;
  p.skimming = overWater && p.agl < 16 && p.speed > 45;
  if (p.skimming) {
    p.sprayTimer -= dt;
    if (p.sprayTimer <= 0) {
      p.sprayTimer = 0.025;
      spawnSpray(vadd(p.pos, { x: 0, y: -p.agl, z: 0 }));
    }
  }

  // clouds
  const dens = G.map.cloudDensity(p.pos.x, p.pos.y, p.pos.z);
  p.inCloud = dens;
  G.cloudWhite = damp(G.cloudWhite, smoothstep(0.16, 0.7, dens) * 0.85, 7, dt);

  // shield regen
  if (p.shield < PLAYER_MAX_SHIELD && G.time - p.lastHit > 3.8 && G.mode === 'play') {
    p.shield = Math.min(PLAYER_MAX_SHIELD, p.shield + 4.2 * dt);
  }

  // 新版持续保留真实翼尖航迹；原入口仍按机动状态生成。
  p.vaporTimer -= dt;
  const vap = p.continuousTrails || ((G.view === 0 || p.gLoad > 3.6 || p.speed > 178 || p.rollT > 0) && G.view !== 2);
  if (vap && p.vaporTimer <= 0) {
    p.vaporTimer += 0.05;
    const b = basisFrom(p.yaw, p.pitch, p.roll + (p.inversionRoll || 0) + p.spin);
    addWingTrail(wingTipPosition(p, b, 1), 1);
    addWingTrail(wingTipPosition(p, b, -1), -1);
  }

  // engine plume puffs
  p.plumeTimer -= dt;
  if (p.plumeTimer <= 0) {
    p.plumeTimer = 0.05;
    // handled by draw; nothing simulated
  }

  p.speedDisplay = p.speed;

  // audio + warnings
  AudioSys.updateEngine(G.mode === 'play' || G.mode === 'waveclear', p.burning ? 1 : clamp01((p.speed - 90) / 120), p.shield < 30);
  if (G.time - G.lastLowWarn > 2.0 && (p.agl < 80 || p.shield < 22 || p.fuel < 15)) {
    G.lastLowWarn = G.time;
    AudioSys.lowWarn();
  }
  if (G.mode === 'play') G.missionTime += dt;
}

function wingTipPosition(p, b, side) {
  return vadd(vadd(vadd(p.pos, vmul(b.right, 4.9 * side)), vmul(b.up, 0.235)), vmul(b.fwd, -2.675));
}

function triggerBarrelRoll() {
  if (G.mode !== 'play') return;
  const p = G.player;
  if (!p || p.dead || p.rollCd > 0) return;
  p.rollT = 0.72;
  p.rollDir = (p.roll < 0 ? 1 : -1) || 1;
  p.rollCd = 1.05;
  p.spin = 0.001;
  G.shake = Math.max(G.shake, 0.18);
  AudioSys.flare();
  // barrel rolls break missile locks and confuse inbound missiles
  for (const m of G.missiles) {
    if (m.owner !== 'enemy' || m.dead) continue;
    const d = vdist(m.pos, p.pos);
    if (d < 1500 && Math.random() < 0.55 + 0.25 * (1 - d / 1500)) {
      m.lost = true;
      m.lostTimer = 1.2;
      m.vel = vadd(m.vel, { x: rr(-30, 30), y: rr(-10, 10), z: rr(-30, 30) });
    }
  }
  // pilot style above the canopy
  for (let i = 0; i < 2; i++) addWingTrail(wingTipPosition(p, basisFrom(p.yaw, p.pitch, p.roll + (p.inversionRoll || 0) + p.spin), i ? 1 : -1), i ? 1 : -1, true);
}

// ------------------------------------------------------------ life cycle ----
function beginWave(n) {
  G.wave = n;
  G.waveKills = 0;
  G.waveSpawned = 0;
  G.waveElapsed = 0;
  G.waveTimer = 0;
  G.respite = 0;
  trace('beginWave', n);
  prepareWave(n);
  G.banner = {
    title: G.defenseStage?.title ?? `第 ${pad(n, 2)} 波`,
    sub: G.defenseStage?.brief ?? (G.secondary ? G.secondary.text : '拦截敌机'),
    t: 0, life: 3.4
  };
  G.mode = 'play';
  document.body.classList.add('playing');
  document.body.classList.remove('title');
  AudioSys.waveStart();
}

function beginNextWave() {
  const p = G.player;
  p.shield = PLAYER_MAX_SHIELD;
  p.fuel = 100;
  p.missiles = 4;
  p.reloads.length = 0;
  p.flares = 3;
  beginWave(G.wave + 1);
}

function completeWave() {
  if (G.mode !== 'play') return;
  trace('completeWave', G.wave);
  const victory = G.missionWaveGoal > 0 && G.wave >= G.missionWaveGoal;
  G.mode = victory ? 'victory' : 'waveclear';
  G.respite = victory ? 0 : 8;
  if (G.player) {
    G.player.missiles = 4;
    G.player.reloads.length = 0;
    G.player.flares = Math.max(G.player.flares, 3);
  }
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  // secondary bonus
  G.secondaryDone = isSecondaryComplete();
  if (G.secondaryDone) G.score += 350 + G.wave * 25;
  G.score += 200 + G.wave * 20;
  G.banner = null;
  AudioSys.waveClear();
  // enemy missiles fizzle out
  for (const m of G.missiles) {
    if (m.owner === 'enemy' && !m.dead) {
      m.dead = true;
      spawnExplosion(m.pos, 0.35, 'air', { smoke: 3 });
    }
  }
  for (const e of G.enemies) e.leaving = true;
  if (victory) {
    G.missiles.length = G.bullets.length = G.threatList.length = 0;
    G.flash = G.damageFlash = G.shake = G.hitStop = 0;
    AudioSys.updateEngine(false, 0, false);
  }
  saveHighScore();
}

function isSecondaryComplete() {
  const s = G.secondary;
  if (!s) return false;
  if (s.type === 'sam') return s.killed >= s.need;
  if (s.type === 'vehicle') return s.killed >= s.need;
  if (s.type === 'low') return !!s.done;
  if (s.type === 'shield') return G.player && G.player.shield >= s.need;
  if (s.type === 'lowmissile') return !!s.done;
  return false;
}

function secondaryProgressText() {
  const s = G.secondary;
  if (!s) return '';
  if (s.type === 'sam') return `${Math.min(s.killed, s.need)}/${s.need} 防空阵地`;
  if (s.type === 'vehicle') return `${Math.min(s.killed, s.need)}/${s.need} 装甲车`;
  if (s.type === 'low') return s.done ? '低空击杀：完成' : '低空击杀';
  if (s.type === 'shield') return `保持 ${s.need}% 护盾`;
  return s.text;
}

// --------------------------------------------------------------- frame ------
function updateGame(dtRaw) {
  const raw = Math.min(dtRaw, 0.05);
  G.realTime += raw;
  if (G.mode === 'paused' || G.mode === 'loading' || G.mode === 'victory') {
    if (G.mode === 'paused') G.fade = damp(G.fade, 0.15, 8, raw);
    return;
  }
  let scale = 1;
  if (G.hitStop > 0) {
    G.hitStop -= raw;
    scale = 0.22;
  }
  const dt = raw * scale;
  G.time += dt;
  G.shake = damp(G.shake, 0, 4.5, raw);
  G.damageFlash = damp(G.damageFlash, 0, 5.5, raw);
  G.flash = damp(G.flash, 0, 7.5, raw);
  G.fade = damp(G.fade, 0, 6, raw);
  if (G.banner) G.banner.t += raw;

  if (G.mode === 'title') {
    updateTitle(dt);
  } else if (G.mode === 'play') {
    updateFlight(dt);
    updateCamera(dt);
    updateLockOn(dt);
    if (G.allies.length && typeof updateWingman === 'function') updateWingman(dt);
    updateMissiles(dt);
    updateEnemies(dt);
    updateGround(dt);
    updateGunBullets(dt);
    updatePlayerGuns(dt);
    updateEffects(dt);
    updateVapor(dt);
    updateWaveLogic(dt);
    computeThreats();
    G.missionTime += 0;
    G.waveElapsed += dt;
  } else if (G.mode === 'waveclear') {
    updateFlight(dt);
    updateCamera(dt);
    updateEffects(dt);
    updateVapor(dt);
    updateEnemies(dt);
    if (G.allies.length && typeof updateWingman === 'function') updateWingman(dt);
    updateMissiles(dt);
    updateGunBullets(dt);
    updatePlayerGuns(dt);
    updateGround(dt);
    G.respite -= dt;
    const p = G.player;
    if (p) {
      p.shield = Math.min(PLAYER_MAX_SHIELD, p.shield + 18 * dt);
      p.fuel = Math.min(100, p.fuel + 22 * dt);
      p.invuln = Math.max(p.invuln, 0.2);
    }
    G.cloudWhite = damp(G.cloudWhite, 0, 4, dt);
    if (G.respite <= 0) beginNextWave();
  } else if (G.mode === 'dying') {
    G.dyingTimer -= raw;
    updateEffects(dt);
    updateMissiles(dt);
    updateGunBullets(dt);
    updateVapor(dt);
    updateEnemies(dt * 0.6);
    updateCamera(dt);
    if (G.dyingTimer <= 0) failMission();
  } else if (G.mode === 'failed') {
    updateEffects(raw * 0.7);
    updateVapor(raw * 0.5);
    updateEnemies(raw * 0.4);
    updateCamera(raw);
    G.failTimer += raw;
    G.cloudWhite = damp(G.cloudWhite, 0, 3, raw);
  }
  // UI bookkeeping
  G.warnLamp += raw;
  if (G.banner && G.banner.t > G.banner.life + 0.6) G.banner = null;
  if (G.viewBlend < 1 && G.prevView === G.view) G.viewBlend = 1;
}

function updateTitle(dt) {
  G.titleTime += dt;
  const p = G.player;
  if (!p) return;
  // serene autopilot: follow the terrain, gentle S-turns
  const t = G.titleTime;
  p.yaw = wrapAngle((G.playerTitleYaw || 0.6) + Math.sin(t * 0.085) * 0.32 + Math.sin(t * 0.031 + 1.4) * 0.15);
  const gh = G.map.heightAt(p.pos.x, p.pos.z);
  const targetAlt = Math.max(gh + 320, 520);
  p.pitch = clamp((targetAlt - p.pos.y) / 900, -0.10, 0.10);
  p.roll = Math.sin(t * 0.6) * 0.07;
  p.speed = 92;
  p.basis = basisFrom(p.yaw, p.pitch, p.roll);
  p.renderBasis = p.basis;
  const fwd = p.basis.fwd;
  p.pos.x += fwd.x * p.speed * dt;
  p.pos.z += fwd.z * p.speed * dt;
  p.pos.y += fwd.y * p.speed * dt;
  if (p.pos.y < gh + 160) p.pos.y = gh + 160;
  if (G.map.heightAt(p.pos.x, p.pos.z) > p.pos.y - 60) p.pitch = 0.2;
  // subtle paired wing-tip trails
  p.vaporTimer -= dt;
  if (p.vaporTimer <= 0) {
    p.vaporTimer = 0.05;
    const b = basisFrom(p.yaw, p.pitch, p.roll + p.spin);
    addWingTrail(wingTipPosition(p, b, 1), 1);
    addWingTrail(wingTipPosition(p, b, -1), -1);
  }
  updateCamera(dt);
  updateEffects(dt);
  updateVapor(dt);
  G.cloudWhite = 0;
}

function updateWaveLogic(dt) {
  const s = G.secondary;
  if (s && s.type === 'shield') s.current = G.player.shield;
  if (G.waveKills >= G.waveTotal && G.mode === 'play') {
    if (!G.defenseStage || !G.ground.some(g => !g.dead)) completeWave();
    return;
  }
  // stream in replacements while the wave is incomplete
  const active = G.enemies.filter(e => !e.dead && !e.leaving).length;
  G.spawnTimer -= dt;
  if (active < G.activeCap && G.waveKills + active < G.waveTotal && G.spawnTimer <= 0) {
    G.spawnTimer = Math.max(0.8, 2.6 - G.wave * 0.12);
    spawnDrone();
  }
}

// --------------------------------------------------------------- threats ----
function computeThreats() {
  const p = G.player;
  G.threatList.length = 0;
  if (!p || p.dead || !G.camera) return;
  for (const m of G.missiles) {
    if (m.dead || m.owner !== 'enemy') continue;
    if (m.target?.team === 'ally') continue;
    const d = vdist(m.pos, p.pos);
    if (d > 2400) continue;
    const sp = {};
    let ang;
    if (projectToScreen(m.pos, sp) && sp.visible) {
      ang = Math.atan2(sp.y - VH / 2, sp.x - VW / 2);
    } else {
      const dir = vsub(m.pos, p.pos);
      ang = Math.atan2(dir.x, -dir.z) - p.yaw;
    }
    G.threatList.push({ m, d, ang });
  }
  // warning audio
  if (G.threatList.length && G.realTime - G.lastWarn > 0.8) {
    G.lastWarn = G.realTime;
    AudioSys.missileWarning();
  }
}

// --------------------------------------------------------------- damage -----
function damagePlayer(amount, source, silent = false) {
  const p = G.player;
  if (!p || p.dead) return;
  if (p.invuln > 0 && source !== 'terrain') return;
  p.shield -= amount;
  p.lastHit = G.time;
  G.stats.dmg += amount;
  if (!silent) {
    G.damageFlash = Math.min(1, 0.65 + amount / 50);
    addShake(clamp(0.45 + amount * 0.012, 0.45, 1.4));
    AudioSys.shieldHit();
  }
  spawnSparks(p.pos, 4 + Math.floor(amount / 8), '#ffcf8a');
  if (p.shield <= 0) {
    p.shield = 0;
    killPlayer();
  }
}

function tryFlares() {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'play') return;
  if (G.realTime - G.lastFlareTime < 0.3) return;
  if (p.flares <= 0 || p.flareCd > 0) {
    AudioSys.uiTick();
    return;
  }
  G.lastFlareTime = G.realTime;
  p.flares--;
  p.flareCd = 7;
  const b = p.basis;
  for (let i = 0; i < 6; i++) {
    const off = vadd(vmul(b.right, (i - 2.5) * 3.4), vmul(b.up, -1.4));
    spawnFlare(vadd(p.pos, off), vmul(b.fwd, -18));
  }
  addShake(0.25);
  AudioSys.flare();
  // decoy enemy missiles
  for (const m of G.missiles) {
    if (m.owner !== 'enemy' || m.dead) continue;
    if (vdist(m.pos, p.pos) < 1600 && Math.random() < 0.8) {
      m.decoy = true;
      m.lost = true;
      m.lostTimer = 1.4;
    }
  }
}

// --------------------------------------------------------------- scoring ----
function styleTags(agl, inCloud, burning) {
  const tags = [];
  let bonus = 0;
  if (agl < 45) { tags.push('LOW KILL'); bonus += 75; }
  if (inCloud > 0.3) { tags.push('CLOUD KILL'); bonus += 50; }
  if (burning) { tags.push('BURN KILL'); bonus += 40; }
  return { tags, bonus };
}

function awardKill(kind, pos, opts = {}) {
  const p = G.player;
  const base = kind === 'drone' ? 100 + G.wave * 15 : kind === 'sam' ? 180 : 90;
  if (opts.credit === 'ally') {
    const points = Math.round(base * .5);
    G.score += points;
    if (kind === 'drone') G.waveKills++;
    G.allyKills++;
    G.popups.push({ pos: vcopy(pos), text: `+${points}`, tag: '僚机', color: '#9fe6c8', life: 1.6, t: 0 });
    if (G.popups.length > 14) G.popups.shift();
    G.flash = Math.max(G.flash, .1);
    return;
  }
  const now = G.time;
  if (now - G.lastKillTime < 1.6) G.combo = Math.min(4, G.combo + 1);
  else G.combo = 1;
  G.lastKillTime = now;
  let points = base;
  let tags = [];
  if (kind === 'drone' && p) {
    const st = styleTags(p.agl, p.inCloud, p.burning);
    points += st.bonus;
    tags = st.tags;
    if (st.tags.includes('LOW KILL') && G.secondary && G.secondary.type === 'low') G.secondary.done = true;
    if (p.skimming && G.secondary && G.secondary.type === 'lowmissile') G.secondary.done = true;
  }
  points *= G.combo;
  G.score += points;
  if (kind === 'drone') { G.stats.kills++; G.waveKills++; }
  if (kind === 'sam') { G.stats.sam++; if (G.secondary && G.secondary.type === 'sam') G.secondary.killed++; }
  if (kind === 'vehicle') { G.stats.veh++; if (G.secondary && G.secondary.type === 'vehicle') G.secondary.killed++; }
  const tagZh = { 'LOW KILL': '低空击杀', 'CLOUD KILL': '云中击杀', 'BURN KILL': '加力击杀' };
  const comboZh = G.combo === 2 ? '双杀' : G.combo === 3 ? '三杀' : '多杀';
  const pop = {
    pos: vcopy(pos),
    text: `+${points}`,
    tag: G.combo > 1 ? comboZh : (tagZh[tags[0]] || ''),
    color: G.combo > 1 ? '#ffd67a' : (tags.length ? '#ffe9ae' : '#f0c05a'),
    life: 1.8,
    t: 0
  };
  G.popups.push(pop);
  if (G.popups.length > 14) G.popups.shift();
  if (G.score > G.highScore) { G.highScore = Math.floor(G.score); saveHighScore(); }
  G.flash = Math.max(G.flash, kind === 'drone' ? 0.22 : 0.16);
  G.hitStop = Math.max(G.hitStop, kind === 'drone' ? 0.055 : 0.03);
  if (G.secondary && G.secondary.type === 'lowmissile') {
    // not used yet; reserved
  }
}

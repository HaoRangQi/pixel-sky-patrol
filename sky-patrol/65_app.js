// 使用运行时赋值，避免函数声明提升到原版boot之前。
let flightMode = 'intercept', inlandFlight = false;
const skyGet = id => document.getElementById(id);
const skyApp = skyGet('sky-app');
const skyStage = skyGet('stage');
const skyButtons = [...skyApp.querySelectorAll('button')];
const skyActions = [...skyApp.querySelectorAll('[data-sky-action]')];
const skyAmmo = [...skyApp.querySelectorAll('[data-ammo-slot]')];
const skyPointerHolds = new Map();
const skyKeyHolds = new Map();
const skyKeyClicks = new WeakSet();
let skyNotice = '', skyNoticeUntil = 0, skyLastMode = '';
let skyBoostTimer = 0;
const SKY_SPEED_MIN_KT = 300, SKY_SPEED_MAX_KT = 1500;
const SKY_CRUISE_DEFAULT_KT = 300, SKY_BURN_DEFAULT_KT = 500;
const SKY_MIN_BURN_GAP = 50, SKY_TURN_FULL_KT = 1200, SKY_TURN_MIN = 8, SKY_TURN_MAX = 120;
const SKY_KNOTS_PER_MPS = 1.94384;
const SKY_DEFENSE_STAGES = [
  { title: '无人机入侵', brief: '拦截进入湖谷的无人机', air: Array(4).fill('drone') },
  { title: '战斗机入侵', brief: '迎击敌方战斗机编队', air: Array(5).fill('fighter') },
  { title: '空投突袭', brief: '拦截运输机和护航，清除空投装甲',
    air: ['transport', 'fighter', 'drone', 'fighter', 'drone', 'fighter'] },
];
// 只重标低速段：300 档保留原 100 节的位移，500 档起沿用原实速。
// 物理、瞄准、敌机和空速表仍一律使用实际 m/s，不移动地形来模拟加力。
const skySpeedDials = { cruise: SKY_CRUISE_DEFAULT_KT, burnGap: SKY_BURN_DEFAULT_KT - SKY_CRUISE_DEFAULT_KT };
function skyActualKnots(dial) { return dial < 500 ? 500 - (500 - dial) * 2 : dial; }
function skyDialAtSpeed(mps) {
  const kt = mps * SKY_KNOTS_PER_MPS;
  return kt < 500 ? 500 - (500 - kt) / 2 : kt;
}
function skyBurnDial() { return Math.min(SKY_SPEED_MAX_KT, skySpeedDials.cruise + skySpeedDials.burnGap); }
function skyTurnDegrees(dial) { return Math.max(SKY_TURN_MIN, Math.min(SKY_TURN_MAX, dial / SKY_TURN_FULL_KT * SKY_TURN_MAX)); }
function skyTurnAtSpeed(mps) { return skyTurnDegrees(skyDialAtSpeed(mps)) * DEG; }
function skyTurnOnSlider() {
  const dial = skySpeedDials.cruise;
  return dial >= SKY_TURN_FULL_KT ? SKY_TURN_MAX : Math.min(SKY_TURN_MAX - 1, Math.round(skyTurnDegrees(dial)));
}
const skyControlSettings = { mouse: false, enemySpeed: 0.65, turnAuto: true, turnRate: skyTurnOnSlider(), wingman: false };
const skyAiUi = { enabled: false, status: 'off', testing: false, testText: '' };
const skyAiConfig = { endpoint: '', model: '' };
G.enemySpeedScale = skyControlSettings.enemySpeed;
G.wingmanWanted = skyControlSettings.wingman;
let skyTurnGesture = null;

function skyApplyFlightSettings(p) {
  if (p === G.player && (G.mode === 'title' || G.pausedFrom === 'title')) return;
  p.cruiseSpeed = skyActualKnots(skySpeedDials.cruise) / SKY_KNOTS_PER_MPS;
  p.burnSpeed = skyActualKnots(skyBurnDial()) / SKY_KNOTS_PER_MPS;
  // 常用档差在 0.85 秒内拉满；极端档差限加速度，避免一帧瞬移。
  p.burnAcceleration = clamp((p.burnSpeed - p.cruiseSpeed) / .85, 62, 400);
  p.turnRateLimit = skyControlSettings.turnRate * DEG;
  p.turnRateAtSpeed = skyControlSettings.turnAuto ? skyTurnAtSpeed : null;
}

function skySetFlightSpeed(kind, knots) {
  if (G.mode !== 'paused' || !['cruise', 'burn'].includes(kind) || !Number.isFinite(Number(knots))) return;
  const value = Math.round(Number(knots));
  if (kind === 'cruise') {
    skySpeedDials.cruise = clamp(value, SKY_SPEED_MIN_KT, SKY_SPEED_MAX_KT);
  } else if (skySpeedDials.cruise + SKY_MIN_BURN_GAP < SKY_SPEED_MAX_KT && value !== skyBurnDial()) {
    skySpeedDials.burnGap = clamp(value - skySpeedDials.cruise, SKY_MIN_BURN_GAP, SKY_SPEED_MAX_KT - skySpeedDials.cruise);
  }
  if (skyControlSettings.turnAuto) skyControlSettings.turnRate = skyTurnOnSlider();
  skyApplyFlightSettings(G.player);
  skySync();
}
function skyResetFlightSpeeds() {
  if (G.mode !== 'paused') return;
  skySpeedDials.cruise = SKY_CRUISE_DEFAULT_KT;
  skySpeedDials.burnGap = SKY_BURN_DEFAULT_KT - SKY_CRUISE_DEFAULT_KT;
  skyControlSettings.turnAuto = true;
  skyControlSettings.turnRate = skyTurnOnSlider();
  skyApplyFlightSettings(G.player);
  skySync();
}
function skySyncFlightSpeeds() {
  const enabled = BOOT.ready && !BOOT.error && G.mode === 'paused';
  for (const kind of ['cruise', 'burn']) {
    const input = skyGet(`sky-${kind}-speed`);
    const dial = kind === 'cruise' ? skySpeedDials.cruise : skyBurnDial(), actual = skyActualKnots(dial);
    const atCap = kind === 'burn' && skySpeedDials.cruise + SKY_MIN_BURN_GAP >= SKY_SPEED_MAX_KT;
    input.disabled = !enabled || atCap;
    if (input.value !== String(dial)) input.value = String(dial);
    const label = `${dial}${actual === dial ? ' 节' : ` 档 · 实速 ${actual} 节`}${atCap ? ' · 已达上限' : ''}`;
    skyAttribute(input, 'aria-valuetext', label);
    skyText(`sky-${kind}-speed-value`, label);
  }
  const turn = skyGet('sky-turn-rate');
  const turnLabel = `${skyControlSettings.turnRate}°/秒${skyControlSettings.turnAuto ? ' · 随速度' : ''}`;
  turn.disabled = !enabled || skyControlSettings.turnAuto;
  if (turn.value !== String(skyControlSettings.turnRate)) turn.value = String(skyControlSettings.turnRate);
  skyText('sky-turn-rate-value', turnLabel);
  skyAttribute(turn, 'aria-valuetext', turnLabel);
  const turnLock = skyGet('sky-turn-lock');
  turnLock.disabled = !enabled;
  turnLock.checked = skyControlSettings.turnAuto;
  const enemy = skyGet('sky-enemy-speed'), mouse = skyGet('sky-mouse-steering');
  enemy.disabled = mouse.disabled = !enabled;
  enemy.value = String(Math.round(skyControlSettings.enemySpeed * 100));
  mouse.checked = skyControlSettings.mouse;
  skyText('sky-enemy-speed-value', `${enemy.value}%`);
  skyAttribute(enemy, 'aria-valuetext', `${enemy.value}%`);
  const volume = skyGet('sky-volume');
  if (volume) {
    const percent = Math.round(Math.max(0, Math.min(1, G.volume ?? .55)) * 100);
    volume.disabled = !enabled;
    volume.value = String(percent);
    const label = `${percent}%`;
    skyText('sky-volume-value', label);
    skyAttribute(volume, 'aria-valuetext', label);
  }
}

function skyApplyAiConfig() {
  WingmanAdvisor.configure({
    enabled: skyAiUi.enabled,
    endpoint: skyAiConfig.endpoint,
    model: skyAiConfig.model,
    getKey: () => String(skyGet('sky-ai-key')?.value || ''),
  });
}

function skySyncAiSettings() {
  const paused = BOOT.ready && !BOOT.error && G.mode === 'paused';
  const wingman = skyGet('sky-wingman');
  if (wingman) {
    if (wingman.checked !== skyControlSettings.wingman) wingman.checked = skyControlSettings.wingman;
    if (wingman.disabled !== !paused) wingman.disabled = !paused;
  }
  const master = skyGet('sky-ai-enabled');
  if (master) {
    if (master.checked !== skyAiUi.enabled) master.checked = skyAiUi.enabled;
    if (master.disabled !== !paused) master.disabled = !paused;
  }
  const details = skyGet('sky-ai-details');
  if (details && details.hidden !== !skyAiUi.enabled) details.hidden = !skyAiUi.enabled;
  for (const id of ['sky-ai-endpoint', 'sky-ai-model', 'sky-ai-key']) {
    const input = skyGet(id);
    if (!input) continue;
    const off = !paused || !skyAiUi.enabled;
    if (input.disabled !== off) input.disabled = off;
  }
  const status = skyGet('sky-ai-status');
  if (status) {
    const current = typeof WingmanAdvisor !== 'undefined' ? WingmanAdvisor.runtime.status : 'off';
    const text = skyAiUi.testing ? '连接中…' : (skyAiUi.testText || (typeof AI_STATUS_TEXT !== 'undefined' ? AI_STATUS_TEXT[current] : '关闭'));
    if (status.textContent !== text) status.textContent = text;
  }
}

function skySetWingman(on) {
  if (G.mode !== 'paused') return;
  skyControlSettings.wingman = !!on;
  G.wingmanWanted = !!on;
  if (on) {
    if (G.pausedFrom !== 'title') wingmanSpawn();
    skyApplyAiConfig();
  } else {
    WingmanAdvisor.cancel('silent');
    wingmanClear('disabled');
  }
  skySync();
}

function skySetAiEnabled(on) {
  if (G.mode !== 'paused') return;
  skyAiUi.enabled = !!on;
  skyAiUi.testText = '';
  if (!on) {
    WingmanAdvisor.cancel('ai-off');
    wingmanClearCommand('llm');
  }
  skyAiConfig.endpoint = skyGet('sky-ai-endpoint')?.value ?? skyAiConfig.endpoint;
  skyAiConfig.model = skyGet('sky-ai-model')?.value ?? skyAiConfig.model;
  skyApplyAiConfig();
  skySync();
  if (!on) skyGet('sky-ai-enabled')?.focus();
}

function skyAiConfigChanged() {
  skyAiConfig.endpoint = skyGet('sky-ai-endpoint')?.value ?? '';
  skyAiConfig.model = skyGet('sky-ai-model')?.value ?? '';
  skyAiUi.testText = '';
  skyApplyAiConfig();
  skySync();
}

async function skyTestAiConnection() {
  if (G.mode !== 'paused' || !skyAiUi.enabled || skyAiUi.testing) return;
  skyAiUi.testing = true;
  skyAiUi.testText = '';
  skySync();
  let result = { ok: false, status: 'error' };
  try {
    result = await WingmanAdvisor.testConnection({
      endpoint: skyGet('sky-ai-endpoint')?.value || '',
      model: skyGet('sky-ai-model')?.value || '',
      key: skyGet('sky-ai-key')?.value || '',
    });
  } catch (error) {
    result = { ok: false, status: 'error' };
  } finally {
    skyAiUi.testing = false;
  }
  skyAiUi.testText = result?.ok ? '连接成功' : '连接失败（已回退本地）';
  skyAiUi.status = result?.ok ? 'ok' : 'error';
  WingmanAdvisor.setStatus(skyAiUi.status);
  skySync();
}

function skySetControlSetting(kind, value) {
  if (G.mode !== 'paused') return;
  if (kind === 'mouse' && typeof value === 'boolean') {
    skyControlSettings.mouse = value;
    if (G.pausedFrom !== 'title') G.player.mouseSteering = value;
    resetMouseSteering();
  } else if (kind === 'enemySpeed' && Number.isFinite(Number(value))) {
    skyControlSettings.enemySpeed = G.enemySpeedScale = clamp(Math.round(Number(value) / 5) * 5, 30, 120) / 100;
  } else if (kind === 'turn' && !skyControlSettings.turnAuto && Number.isFinite(Number(value))) {
    skyControlSettings.turnRate = clamp(Math.round(Number(value)), SKY_TURN_MIN, SKY_TURN_MAX);
    skyApplyFlightSettings(G.player);
  } else if (kind === 'volume' && Number.isFinite(Number(value))) {
    G.volume = clamp(Math.round(Number(value)), 0, 100) / 100;
    AudioSys.setVolume(G.volume);
  } else if (kind === 'turnAuto' && typeof value === 'boolean') {
    skyControlSettings.turnAuto = value;
    if (value) skyControlSettings.turnRate = skyTurnOnSlider();
    skyApplyFlightSettings(G.player);
  }
  skySync();
}

function skyTrackTurnGesture(code, down, repeat = false) {
  if (!['KeyA', 'KeyD'].includes(code) || repeat || G.mode !== 'play') return;
  const p = G.player, now = G.realTime;
  if (!p || p.dead || p.halfRoll || p.recovery || p.rollT > 0) { skyTurnGesture = null; return; }
  const other = code === 'KeyA' ? 'KeyD' : 'KeyA';
  if (INPUT.keys.has(other)) { skyTurnGesture = null; return; }
  if (down) {
    if (skyTurnGesture?.code === code && now <= skyTurnGesture.armedUntil) {
      if (skyTurnGesture.tap != null && now - skyTurnGesture.tap <= 0.35) {
        const from = p.inversionRoll || 0, direction = code === 'KeyA' ? 1 : -1;
        p.halfRoll = { from, to: from + direction * Math.PI, time: 0 };
        skyReport('正在翻转 180°');
        skyTurnGesture = null;
        return;
      }
      skyTurnGesture.tap = now;
    } else skyTurnGesture = { code, started: now, armedUntil: -1, tap: null };
  } else if (skyTurnGesture?.code === code && now - skyTurnGesture.started >= 2 - 1e-6 && skyTurnGesture.armedUntil < 0) {
    skyTurnGesture.armedUntil = now + 1.2;
    skyReport(`双击 ${code === 'KeyA' ? 'A' : 'D'}：翻转 180°`);
  }
}

function skyRecoverUpright() {
  const p = G.player;
  if (!skyActive() || !p || p.dead || p.recovery) return;
  const totalRoll = p.roll + (p.inversionRoll || 0) + p.spin;
  p.recovery = { fromRoll: wrapAngle(totalRoll), fromPitch: p.pitch, time: 0, duration: 1.6 };
  p.inversionRoll = totalRoll;
  p.roll = p.spin = p.rollT = 0;
  p.halfRoll = null;
  p.basis = p.renderBasis;
  skyTurnGesture = null;
  skyReport('正在平滑回正');
}

const skyUpdateFlight = updateFlight;
updateFlight = function (dt) {
  const p = G.player;
  const recovery = p?.recovery;
  if (recovery && !p.dead) {
    recovery.time = Math.min(recovery.duration, recovery.time + dt);
    const remaining = 1 - smoothstep(0, recovery.duration, recovery.time);
    p.inversionRoll = recovery.fromRoll * remaining;
    p.pitch = recovery.fromPitch * remaining;
  } else if (p?.halfRoll && !p.dead) {
    const r = p.halfRoll;
    r.time = Math.min(1.6, r.time + dt);
    p.inversionRoll = lerp(r.from, r.to, smoothstep(0, 1.6, r.time));
    if (r.time >= 1.6 - 1e-6) {
      p.inversionRoll = Math.abs(Math.cos(r.to) + 1) < 1e-6 ? (r.to < 0 ? -Math.PI : Math.PI) : 0;
      p.halfRoll = null;
      skyReport(p.inversionRoll ? '已倒飞 · 重复操作可翻回' : '已恢复正飞');
    }
  }
  skyUpdateFlight(dt);
  if (recovery && recovery.time >= recovery.duration - 1e-6) {
    p.recovery = null;
    skyReport('已恢复水平正飞');
  }
};

function skyText(id, value) {
  const el = typeof id === 'string' ? skyGet(id) : id, text = String(value);
  if (el && el.textContent !== text) el.textContent = text;
}
function skyAttribute(el, name, value) {
  if (el && el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
}
function skyNumber(value) { return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-US'); }
function skyActive() { return BOOT.ready && !BOOT.error && (G.mode === 'play' || G.mode === 'waveclear'); }
function skyReport(message) {
  skyNotice = message;
  skyNoticeUntil = performance.now() + 5000;
  skyText('sky-status', message);
}
function skyRefreshHolds() {
  const held = [...skyPointerHolds.values(), ...skyKeyHolds.values()];
  INPUT.touchBurn = held.some(b => b.dataset.skyAction === 'boost');
  INPUT.touchGun = held.some(b => b.dataset.skyAction === 'gun');
  for (const b of skyActions) {
    if (b.dataset.skyAction !== 'boost' && b.dataset.skyAction !== 'gun') continue;
    const on = held.includes(b);
    skyAttribute(b, 'aria-pressed', on);
    skyAttribute(b, 'data-held', on);
  }
}
function skyClearInput() {
  skyTurnGesture = null;
  clearTimeout(skyBoostTimer); skyBoostTimer = 0;
  skyPointerHolds.clear(); skyKeyHolds.clear();
  for (const held of UI_HOLDS.values()) if (held.onUp) held.onUp();
  UI_HOLDS.clear();
  INPUT.keys.clear();
  INPUT.left = INPUT.touchBurn = INPUT.touchGun = INPUT.touchSteer = false;
  INPUT.touchId = -1; INPUT.touchDX = INPUT.touchDY = INPUT.dx = INPUT.dy = 0;
  TOUCH.active = false; TOUCH.id = -1;
  G.touchStick = null; G.testInput = null;
  resetMouseSteering();
  skyRefreshHolds();
}

const skyPrepareWave = prepareWave;
prepareWave = function (n) {
  if (flightMode === 'intercept') {
    const count = G.defenseRules?.waves?.[n - 1] ?? SKY_DEFENSE_STAGES[n - 1]?.air.length;
    const generated = typeof skyDifficultyStageAir === 'function' && count ? skyDifficultyStageAir(n, count) : null;
    const stage = SKY_DEFENSE_STAGES[n - 1] ? { ...SKY_DEFENSE_STAGES[n - 1], air: generated ?? SKY_DEFENSE_STAGES[n - 1].air } : {
      title: '拦截增援', brief: '迎击后续空中编队',
      air: generated ?? Array.from({ length: Math.min(9, 3 + n) }, (_, i) => i % 2 ? 'drone' : 'fighter'),
    };
    return skyPrepareWave(n, stage);
  }
  G.defenseStage = null;
  G.enemies.length = G.ground.length = G.missiles.length = 0;
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  G.waveKills = G.waveSpawned = G.waveTotal = G.activeCap = 0;
  G.secondary = null; G.secondaryDone = false; G.spawnTimer = 0;
};
const skyWaveLogic = updateWaveLogic;
updateWaveLogic = function (dt) {
  if (flightMode === 'free') return;
  return skyWaveLogic(dt);
};
const skyDamagePlayer = damagePlayer;
damagePlayer = function (amount, source, silent = false) {
  if (flightMode === 'free' && source !== 'terrain') return;
  return skyDamagePlayer(amount, source, silent);
};

highScoreKey = () => 'sky-patrol-hs-v1';
const skyLoadHighScore = loadHighScore;
loadHighScore = function () {
  skyLoadHighScore();
  G.highScore = Number.isFinite(G.highScore) ? Math.max(0, G.highScore) : 0;
  return G.highScore;
};

const skyMakePlayer = makePlayer;
makePlayer = function (map, forTitle = false) {
  const p = skyMakePlayer(map, forTitle);
  if (!forTitle) {
    skyApplyFlightSettings(p);
    p.speed = p.targetSpeed = p.cruiseSpeed;
    p.mouseSteering = skyControlSettings.mouse;
    p.flightComfort = true;
    p.speedResponse = 1.6;
    p.inversionRoll = 0;
    p.continuousTrails = true;
    p.detailedSurfaceImpacts = true;
    p.gunEffectiveRange = 900;
    p.gunSightOffset = 16;
    p.lockRadius = 38;
    p.gunCapacity = p.gunAmmo = 180;
    p.gunReload = 0; p.gunReloadSeconds = 10;
    p.pitch = 0;
    p.basis = p.renderBasis = basisFrom(p.yaw, p.pitch, p.roll);
  }
  if (!forTitle && inlandFlight) {
    // 东侧草谷轴不随种子移动；种子只改变林斑、地表与山肩细节。
    const x = 6970, z = 7200;
    p.groundH = map.heightAt(x, z); p.agl = 125;
    p.pos = { x, y: p.groundH + p.agl, z };
    p.yaw = 0.00755; p.basis = p.renderBasis = basisFrom(p.yaw, p.pitch, p.roll);
  }
  return p;
};
const skyStartRun = startRun;
startRun = function (mode = flightMode, inland = inlandFlight) {
  if (!BOOT.ready || BOOT.error || !G.map) return false;
  if (mode !== 'free' && mode !== 'intercept') return false;
  flightMode = mode; inlandFlight = mode === 'free' && inland;
  G.missionWaveGoal = mode === 'intercept' ? SKY_DEFENSE_STAGES.length : 0;
  G.skyScenic = mode === 'free' ? { oblique: false, from: 0, changedAt: 0 } : null;
  if (mode === 'intercept' && typeof skyPrepareDifficultyRun === 'function') skyPrepareDifficultyRun();
  skyNotice = '';
  skyClearInput();
  G.pausedFrom = null; G.freeze = false;
  skyStartRun();
  if (flightMode === 'free') {
    G.banner = { title: inlandFlight ? '秋林低飞' : '自由巡航', sub: '无战斗伤害，仍需避开地形', t: 0, life: 3.4 };
  }
  setViewName('chase');
  skySync();
  return true;
};
function skyStart(mode = 'intercept', inland = false) {
  if (!BOOT.ready || BOOT.error) return false;
  AudioSys.init();
  if (G.sound) AudioSys.setEnabled(true);
  return startRun(mode, inland);
}
function skyHome() {
  if (!BOOT.ready || BOOT.error || !G.map) return false;
  skyClearInput(); skyNotice = '';
  G.skyScenic = null;
  G.missionWaveGoal = 0;
  G.defenseStage = null;
  G.mode = 'title'; G.pausedFrom = null; G.freeze = false;
  G.banner = null; G.shake = G.damageFlash = G.flash = G.hitStop = G.fade = 0;
  G.threatList.length = 0;
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  setupTitleWorld();
  setViewName('chase');
  AudioSys.updateEngine(false, 0, false);
  skySync();
  return true;
}
function skyContinueChallenge() {
  if (G.mode !== 'victory') return;
  skyClearInput();
  G.missionWaveGoal = 0;
  beginNextWave();
}
const skyTogglePause = togglePause;
togglePause = function () {
  const before = G.mode;
  const fromTitle = before === 'paused' && G.pausedFrom === 'title';
  skyTogglePause();
  if (G.mode !== before) skyClearInput();
  skySync();
  if (fromTitle) skyGet('sky-settings').focus();
};
const skyToggleSound = toggleSound;
toggleSound = function () {
  AudioSys.init();
  skyToggleSound();
  skySync();
};
const skyKeyDown = onKeyDown;
const skyBarrelRoll = triggerBarrelRoll;
triggerBarrelRoll = function () { if (!G.player?.halfRoll && !G.player?.recovery) skyBarrelRoll(); };
onKeyDown = function (code) {
  if (G.mode === 'title') {
    if (code === 'Enter' || code === 'NumpadEnter') skyStart('intercept');
    else if (code === 'KeyM' && BOOT.ready) toggleSound();
    return;
  }
  if (G.mode === 'victory') {
    if (code === 'Enter' || code === 'NumpadEnter') startRun(flightMode);
    return;
  }
  if (code === 'KeyR' && skyActive()) { skyRecoverUpright(); skySync(); return; }
  skyKeyDown(code);
  skySync();
};

resizeAll = function () {
  const r = skyStage.getBoundingClientRect();
  const w = Math.max(1, skyStage.clientWidth || r.width);
  const h = Math.max(1, skyStage.clientHeight || r.height);
  const aspect = w / h;
  cssRect = { left: r.left, top: r.top, width: w, height: h };
  VW = Math.max(1, Math.round(BASE_H * aspect)); VH = BASE_H; VIEW_ASPECT = aspect;
  for (const c of [glCanvas, uiCanvas]) {
    c.style.left = '0px'; c.style.top = '0px'; c.style.width = w + 'px'; c.style.height = h + 'px';
  }
  const ss = clamp(Math.round(h * Math.min(window.devicePixelRatio || 1, 2.5) / VH), 1, 3);
  if (ss !== UI_DPR) CJK_CACHE.clear();
  UI_DPR = ss;
  uiCanvas.width = Math.round(VW * ss); uiCanvas.height = Math.round(VH * ss);
  ctx.imageSmoothingEnabled = false;
  if (FIXED_QUALITY) WORLD_H = clamp(FIXED_QUALITY, 180, 720);
  else if (!worldHInit) { WORLD_H = clamp(Math.round(h * 0.72), 360, 640); worldHInit = true; }
  WORLD_H = clamp(WORLD_H, 180, 720);
  glCanvas.width = Math.max(64, Math.round(WORLD_H * aspect)); glCanvas.height = WORLD_H;
  Renderer.resize(glCanvas.width, WORLD_H);
  resetMouseSteering();
  skySync();
};

function skySync() {
  const ready = BOOT.ready && !BOOT.error;
  const mode = ready ? G.mode : 'loading';
  const active = skyActive();
  const won = mode === 'victory', resultOpen = won || mode === 'failed';
  const titleSettings = mode === 'paused' && G.pausedFrom === 'title';
  const view = ['top', 'chase', 'cockpit'][G.view] || 'chase';
  const chase = skyGet('sky-chase'), showChase = !!G.skyScenic && view === 'chase' && (active || mode === 'paused');
  if (chase.hidden === showChase) chase.hidden = !showChase;
  skyAttribute(chase, 'aria-pressed', showChase && G.skyScenic.oblique);
  const scenic = skyScenicView();
  skyAttribute(skyApp, 'data-scenic', scenic);
  skyAttribute(skyApp, 'data-mode', mode);
  skyAttribute(skyApp, 'data-view', view);
  skyAttribute(skyApp, 'data-flight', flightMode);
  const fullHUD = !titleSettings && !!G.player && view !== 'cockpit' && ['play', 'waveclear', 'paused', 'dying'].includes(mode);
  skyAttribute(skyApp, 'data-hud', fullHUD ? 'flight' : 'shell');
  const modalOpen = mode === 'paused' || resultOpen;
  const start = skyGet('sky-start');
  if (start.inert !== modalOpen) start.inert = modalOpen;
  skyText('sky-pause-title', titleSettings ? '设置' : '航程暂停');
  skyText('sky-pause-description', titleSettings ? '出航前调整飞行、音量和辅助僚机。关闭后选择航程。' : '云与远山，等你继续。按 Esc 或选择下方按钮返回飞行。');
  skyText('sky-resume', titleSettings ? '返回主界面' : '继续飞行');
  const flightActions = skyGet('sky-pause-flight-actions');
  if (flightActions.hidden !== titleSettings) flightActions.hidden = titleSettings;
  for (const id of ['sky-header', 'sky-controls']) {
    const el = skyGet(id);
    if (el && el.inert !== modalOpen) el.inert = modalOpen;
  }
  for (const [id, show] of [['sky-start', ready && mode === 'title'], ['sky-pause', ready && mode === 'paused'], ['sky-result', resultOpen], ['sky-continue-challenge', won], ['sky-combat', ready && flightMode === 'intercept' && mode !== 'title' && !titleSettings]]) {
    const el = skyGet(id); if (el && el.hidden === show) el.hidden = !show;
  }
  const enabled = {
    'sky-intercept': ready && mode === 'title', 'sky-cruise': ready && mode === 'title', 'sky-inland': ready && mode === 'title',
    'sky-settings': ready && mode === 'title',
    'sky-camera': ready && (active || mode === 'title'), 'sky-chase': showChase && active, 'sky-sound': ready,
    'sky-fullscreen': ready && typeof skyApp.requestFullscreen === 'function' && document.fullscreenEnabled !== false,
    'sky-resume': ready && mode === 'paused', 'sky-restart': ready && mode === 'paused' && !titleSettings, 'sky-home': ready && mode === 'paused' && !titleSettings,
    'sky-speed-reset': ready && mode === 'paused',
    'sky-ai-test': ready && mode === 'paused' && skyAiUi.enabled && !skyAiUi.testing,
    'sky-again': won || (mode === 'failed' && G.failTimer > 0.5), 'sky-result-home': resultOpen, 'sky-continue-challenge': won
  };
  for (const b of skyButtons) {
    const action = b.dataset.skyAction;
    let on = action ? (action === 'pause' ? active || (ready && mode === 'paused') : action === 'roll' ? active && mode === 'play' && !G.player?.recovery : action === 'recover' ? active && !G.player?.recovery : active) : !!enabled[b.id];
    if (action === 'flare') {
      on = ready && mode === 'play' && G.player && !G.player.dead && G.player.flares > 0 && G.player.flareCd <= 0;
      const remaining = G.player?.flares ?? 3, cooldown = Math.max(0, Math.ceil(G.player?.flareCd || 0));
      skyText(b.querySelector('span'), remaining <= 0 ? '干扰弹 用尽' : cooldown ? `干扰弹 ${cooldown}s` : `干扰弹 ${remaining}`);
      const label = `干扰弹，C 或 X；剩余 ${remaining}，冷却 ${cooldown} 秒`;
      skyAttribute(b, 'aria-label', label); skyAttribute(b, 'title', label);
    }
    if (action === 'gun' && G.player?.gunCapacity) {
      const p = G.player, supply = p.gunReload > 0;
      on = on && p.gunAmmo > 0 && !supply;
      skyText('sky-gun-action-label', supply ? `补给 ${Math.ceil(p.gunReload)}s` : `机炮 ${p.gunAmmo}`);
      skyAttribute(b, 'aria-label', supply ? `机炮补给，剩余${Math.ceil(p.gunReload)}秒` : `机炮，剩余${p.gunAmmo}发，F或鼠标左键`);
    }
    if (b.disabled === on) b.disabled = !on;
  }
  skySyncFlightSpeeds();
  skySyncAiSettings();
  skyText('sky-mode-label', mode === 'title' ? '待命 / READY TO FLY' : inlandFlight ? '秋林低飞 / VALLEY RUN' : flightMode === 'free' ? '自由巡航 / FREE FLIGHT' : '守卫湖谷 / DEFENSE');
  const viewName = { top: '俯瞰视角', chase: scenic ? '斜后视角' : '追尾视角', cockpit: '座舱视角' }[view];
  skyText('sky-camera', viewName);
  skyAttribute(skyGet('sky-camera'), 'aria-label', `切换视角，当前${viewName}`);
  const sound = skyGet('sky-sound'), soundText = G.sound ? '音效开启' : '音效关闭';
  skyText(sound.querySelector('span') || sound, soundText);
  skyAttribute(sound, 'aria-label', soundText);
  skyAttribute(sound, 'aria-pressed', !!G.sound);
  const fullscreen = document.fullscreenElement === skyApp;
  skyAttribute(skyGet('sky-fullscreen'), 'aria-pressed', fullscreen);
  skyAttribute(skyGet('sky-fullscreen'), 'aria-label', fullscreen ? '退出全屏' : '进入全屏');
  const p = G.player;
  skyText('sky-direction-label', skyControlSettings.mouse ? '鼠标 / WASD 转向' : 'WASD / 方向键转向');
  const allyStatus = skyGet('sky-wingman-status');
  if (allyStatus) {
    allyStatus.hidden = !(G.allies?.length && (active || mode === 'paused' && !titleSettings));
    if (!allyStatus.hidden) skyText(allyStatus, wingmanStatusText());
  }
  const boost = skyActions.find(b => b.dataset.skyAction === 'boost');
  if (boost) {
    const capped = !!p && p.burnSpeed <= p.cruiseSpeed + .01;
    skyText(boost.querySelector('span'), capped ? '已达上限' : p?.burning ? `加力 ${Math.round(p.targetSpeed * 1.94384)}节` : '加速');
  }
  skyText('sky-alt', p ? skyNumber(p.pos.y * 3.28084) : '—');
  skyText('sky-speed', p ? skyNumber(p.speed * 1.94384) : '—');
  skyText('sky-wave-label', G.defenseStage?.title || '关卡');
  skyText('sky-wave', `${skyWaveTitle()} · ${G.waveKills}/${G.waveTotal}`);
  skyText('sky-score', skyNumber(G.score));
  skyText('sky-shield', p ? Math.ceil(Math.max(0, p.shield)) : 100);
  skyText('sky-fuel', p ? Math.ceil(Math.max(0, p.fuel)) : 100);
  const armorRow = skyGet('sky-armor'), armorStatus = skyDefenseArmorStatus(), showArmor = !!armorStatus;
  if (armorRow && armorRow.hidden === showArmor) armorRow.hidden = !showArmor;
  if (showArmor) skyText('sky-armor-status', armorStatus);
  const systems = skyGet('sky-systems');
  const showSystems = !titleSettings && !!p && view !== 'cockpit' && (active || mode === 'paused');
  if (systems && systems.hidden === showSystems) systems.hidden = !showSystems;
  if (p) {
    for (const [i, [, value, state]] of skySystemReadings(p).entries()) {
      const id = ['fuel', 'shield', 'gun', 'missile', 'boost', 'flare'][i];
      skyText(`sky-system-${id}-value`, value);
      skyAttribute(skyGet(`sky-system-${id}`), 'data-state', state);
    }
    for (const id of ['fuel', 'shield']) {
      skyAttribute(skyGet(`sky-system-${id}-meter`), 'value', Math.round(clamp01(p[id] / 100) * 1000) / 10);
    }
  }
  skyText('sky-result-title', won ? '守卫湖谷成功' : '本次航程结束');
  skyText('sky-result-message', won ? '三股入侵已击退。你可以继续迎击增援。' : '可以再次出航或返回待命。');
  skyText('sky-result-score', skyNumber(G.score));
  skyText('sky-result-kills', skyNumber(G.stats.kills + G.stats.veh));
  const ammo = p ? p.missiles : 4;
  skyText('sky-ammo-count', `${pad(ammo, 2)}/04`);
  for (let i = 0; i < skyAmmo.length; i++) {
    skyAttribute(skyAmmo[i], 'data-ready', i < ammo);
    skyAttribute(skyAmmo[i], 'data-empty', i >= ammo);
  }
  skyAttribute(skyGet('sky-ammo'), 'aria-label', `导弹 ${ammo} / 4`);
  const status = BOOT.error || (!ready ? `正在准备飞行 · ${BOOT.stage}` : mode === 'title' ? '驾驶战机守卫湖谷，迎击三股入侵。' : mode === 'paused' ? '飞行已暂停。' : won ? '守卫湖谷成功。' : mode === 'failed' ? '飞行结束，可重新起飞或返回主界面。' : flightMode === 'free' ? '自由巡航：不受战斗伤害，撞地仍会损毁。' : G.defenseStage?.brief || '迎击入侵编队。');
  skyText('sky-status', skyNotice && performance.now() < skyNoticeUntil ? skyNotice : status);
  if (!Number.isFinite(G.highScore)) G.highScore = 0;
  SKY_OCCLUSION.length = 0;
  const stage = uiCanvas.getBoundingClientRect();
  if (systems && stage.height) skyAttribute(systems, 'style', `--hud-unit:${stage.height / VH}px`);
  if (stage.width && stage.height) for (const id of ['sky-brand', 'sky-telemetry', 'sky-camera', 'sky-chase', 'sky-combat', 'sky-systems']) {
    const el = skyGet(id);
    if (!el || el.hidden || fullHUD && ['sky-telemetry', 'sky-combat', 'sky-systems'].includes(id) || (id === 'sky-brand' && (mode !== 'title' && mode !== 'loading' || view === 'cockpit' || view === 'top' || scenic)) || (id === 'sky-telemetry' && view === 'cockpit')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) SKY_OCCLUSION.push({ x: (r.left - stage.left) / stage.width * VW - 3, y: (r.top - stage.top) / stage.height * VH - 3, w: r.width / stage.width * VW + 6, h: r.height / stage.height * VH + 6 });
  }
  setBodyClass();
  if (mode !== skyLastMode) {
    skyLastMode = mode;
    if (typeof WingmanAdvisor !== 'undefined') WingmanAdvisor.syncMode(mode);
    if (won) { skyClearInput(); skyNotice = ''; }
    const focus = mode === 'paused' ? skyGet('sky-resume') : won ? skyGet('sky-again') : mode === 'failed' ? skyGet('sky-result-home') : null;
    if (focus) focus.focus();
    else if ((mode === 'play' || mode === 'waveclear') && ['BUTTON', 'INPUT'].includes(document.activeElement?.tagName)) document.activeElement.blur();
  }
}

function skyFlightTarget(target) { return target === uiCanvas || target === glCanvas || target === skyStage; }
function skyHold(button, key, keyboard = false) {
  if (!button || button.disabled || !skyActive()) return;
  const action = button.dataset.skyAction;
  if (action !== 'boost' && action !== 'gun') return;
  (keyboard ? skyKeyHolds : skyPointerHolds).set(key, button);
  skyRefreshHolds();
  if (action === 'gun') firePlayerGuns();
}
// 原监听器已注册在window，通过捕获阶段隔离，避免重绑或重复触发。
for (const type of ['pointerdown', 'mousedown', 'pointermove']) window.addEventListener(type, e => {
  const flight = skyFlightTarget(e.target) && skyActive();
  if (flight) return;
  if (e.pointerType !== 'touch') resetMouseSteering();
  if (type === 'pointerdown' && e.button === 0) {
    if (e.pointerType === 'touch') INPUT.touchMode = true;
    skyHold(e.target.closest?.('button'), e.pointerId);
  }
  e.stopImmediatePropagation();
}, true);
for (const type of ['pointerup', 'pointercancel', 'mouseup']) window.addEventListener(type, e => {
  if (type !== 'mouseup') { skyPointerHolds.delete(e.pointerId); skyRefreshHolds(); }
  if (!skyFlightTarget(e.target) && e.pointerType !== 'touch') resetMouseSteering();
  // 释放事件继续传递，画布按下后移到工具栏松开也不能粘键。
}, true);
function skyVisibleControl(element) {
  for (let node = element; node; node = node.parentElement) if (node.hidden) return false;
  return true;
}
function skyTextEntry(target) {
  if (!target) return false;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  return ['text', 'password', 'url', 'search', 'email', 'tel', 'number'].includes(String(target.type || 'text').toLowerCase());
}
window.addEventListener('keydown', e => {
  const modal = G.mode === 'paused' ? skyGet('sky-pause') : ['failed', 'victory'].includes(G.mode) ? skyGet('sky-result') : null;
  if (modal && e.code === 'Tab') {
    const controls = [...modal.querySelectorAll('button, input')].filter(b => !b.disabled && skyVisibleControl(b));
    const index = controls.indexOf(document.activeElement);
    if (index < 0 || (e.shiftKey ? index === 0 : index === controls.length - 1)) {
      e.preventDefault();
      controls[e.shiftKey ? controls.length - 1 : 0]?.focus();
    }
    e.stopImmediatePropagation();
    return;
  }
  if (G.mode === 'paused') {
    if (skyTextEntry(e.target) && e.code !== 'Escape') {
      // 输入框需要保留原生 M/P/Enter/空格等行为，但不让它们进入飞行输入。
      e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'KeyM') {
      if (!e.repeat) toggleSound();
    } else if (['Escape', 'KeyP'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (['Enter', 'NumpadEnter'].includes(e.code) && e.target.tagName !== 'BUTTON' && !skyTextEntry(e.target)) {
      e.preventDefault();
      if (!e.repeat) togglePause();
    }
    e.stopImmediatePropagation();
    return; // 保留控件原生行为，暂停按键不进入飞行输入。
  }
  if (G.mode === 'victory') {
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if ((enter || e.code === 'Space') && e.repeat) e.preventDefault();
    if (enter && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      if (!e.repeat) onKeyDown(e.code);
    }
    e.stopImmediatePropagation();
    return;
  }
  const button = e.target.closest?.('button');
  skyTrackTurnGesture(e.code, true, e.repeat);
  if (!button || !['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;
  if (!e.repeat) { skyHold(button, e.code, true); skyKeyClicks.add(button); }
  e.stopImmediatePropagation(); // 保留按钮原生激活，不拦截WASD等其他快捷键。
}, true);
window.addEventListener('keyup', e => {
  skyTrackTurnGesture(e.code, false);
  skyKeyHolds.delete(e.code); skyRefreshHolds();
}, true);
window.addEventListener('blur', skyClearInput);

function skyClick(id, action) {
  const button = skyGet(id);
  button.addEventListener('click', () => { if (!button.disabled) { action(); skySync(); } });
}
skyClick('sky-intercept', () => skyStart('intercept'));
skyClick('sky-cruise', () => skyStart('free'));
skyClick('sky-inland', () => skyStart('free', true));
skyClick('sky-settings', () => {
  if (G.mode !== 'title') return;
  skyClearInput(); G.pausedFrom = 'title'; G.mode = 'paused';
});
skyClick('sky-resume', () => togglePause());
skyClick('sky-speed-reset', skyResetFlightSpeeds);
for (const kind of ['cruise', 'burn']) {
  const input = skyGet(`sky-${kind}-speed`);
  input.addEventListener('input', () => skySetFlightSpeed(kind, input.value));
}
skyGet('sky-enemy-speed').addEventListener('input', e => skySetControlSetting('enemySpeed', e.target.value));
skyGet('sky-turn-rate').addEventListener('input', e => skySetControlSetting('turn', e.target.value));
skyGet('sky-turn-lock').addEventListener('change', e => skySetControlSetting('turnAuto', e.target.checked));
skyGet('sky-volume').addEventListener('input', e => skySetControlSetting('volume', e.target.value));
skyGet('sky-mouse-steering').addEventListener('change', e => skySetControlSetting('mouse', e.target.checked));
skyGet('sky-wingman').addEventListener('change', e => skySetWingman(e.target.checked));
skyGet('sky-ai-enabled').addEventListener('change', e => skySetAiEnabled(e.target.checked));
skyGet('sky-ai-endpoint').addEventListener('change', skyAiConfigChanged);
skyGet('sky-ai-model').addEventListener('change', skyAiConfigChanged);
skyGet('sky-ai-key').addEventListener('input', () => { skyAiUi.testText = ''; });
skyGet('sky-ai-test').addEventListener('click', () => { skyTestAiConnection().catch(() => {}); });
skyClick('sky-restart', () => startRun(flightMode));
skyClick('sky-again', () => startRun(flightMode));
skyClick('sky-continue-challenge', skyContinueChallenge);
skyClick('sky-home', skyHome); skyClick('sky-result-home', skyHome);
skyClick('sky-camera', () => cycleView()); skyClick('sky-sound', () => toggleSound());
skyClick('sky-chase', () => {
  const scenic = G.skyScenic;
  scenic.from = skyChaseBlend(); scenic.changedAt = G.time;
  scenic.oblique = !scenic.oblique;
  AudioSys.uiTick();
});
skyClick('sky-fullscreen', async () => {
  try {
    if (document.fullscreenElement === skyApp) await document.exitFullscreen();
    else await skyApp.requestFullscreen();
  } catch (error) { skyReport('全屏未能开启；可继续窗口飞行。'); }
  skySync();
});
document.addEventListener('fullscreenchange', () => { resizeAll(); skySync(); });
for (const button of skyActions) button.addEventListener('click', e => {
  if (button.disabled) return;
  const action = button.dataset.skyAction;
  if (action === 'boost' || action === 'gun') {
    if (e.detail === 0 && !skyKeyClicks.has(button)) {
      if (action === 'gun') firePlayerGuns();
      else {
        skyHold(button, 'assistive-boost');
        clearTimeout(skyBoostTimer);
        skyBoostTimer = setTimeout(() => {
          skyPointerHolds.delete('assistive-boost');
          skyRefreshHolds(); skyBoostTimer = 0;
        }, 1200);
        skyReport('短时加速1.2秒；按住Shift可持续加速。');
      }
    }
    skyKeyClicks.delete(button);
  } else if (action === 'roll') triggerBarrelRoll();
  else if (action === 'recover') skyRecoverUpright();
  else if (action === 'missile') firePlayerMissile();
  else if (action === 'flare') tryFlares();
  else if (action === 'view') cycleView();
  else if (action === 'pause') togglePause();
  skySync();
});

const skyDrawUIFrame = drawUIFrame;
drawUIFrame = function () { skyDrawUIFrame(); skySync(); };
window.__SKY = {
  start: skyStart, home: skyHome, restart: () => startRun(flightMode),
  get flightMode() { return flightMode; }, sync: skySync,
  wingmanCount: () => G.allies.length,
  aiStatus: () => WingmanAdvisor.runtime.status,
};
skyApplyAiConfig();
worldHInit = false;
resizeAll();
if (window.ResizeObserver) new window.ResizeObserver(() => resizeAll()).observe(skyStage);

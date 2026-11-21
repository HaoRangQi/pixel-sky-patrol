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
const skyFlightSpeeds = { cruise: SPEED_CRUISE, burn: 500 / 1.94384 };
const skyControlSettings = { mouse: false, enemySpeed: 0.65 };
G.enemySpeedScale = skyControlSettings.enemySpeed;
let skyTurnGesture = null;

function skyBurnMinimum() { return Math.min(500, Math.round(skyFlightSpeeds.cruise * 1.94384) + 50); }

function skySetFlightSpeed(kind, knots) {
  if (G.mode !== 'paused' || !['cruise', 'burn'].includes(kind) || !Number.isFinite(Number(knots))) return;
  const value = Math.round(Number(knots));
  if (kind === 'cruise') {
    skyFlightSpeeds.cruise = clamp(value, 100, 500) / 1.94384;
    skyFlightSpeeds.burn = Math.max(skyFlightSpeeds.burn, skyBurnMinimum() / 1.94384);
  } else {
    skyFlightSpeeds.burn = clamp(value, skyBurnMinimum(), 500) / 1.94384;
  }
  G.player.cruiseSpeed = skyFlightSpeeds.cruise;
  G.player.burnSpeed = skyFlightSpeeds.burn;
  skySync();
}
function skyResetFlightSpeeds() {
  if (G.mode !== 'paused') return;
  skyFlightSpeeds.cruise = G.player.cruiseSpeed = SPEED_CRUISE;
  skyFlightSpeeds.burn = G.player.burnSpeed = 500 / 1.94384;
  skySync();
}
function skySyncFlightSpeeds() {
  for (const kind of ['cruise', 'burn']) {
    const input = skyGet(`sky-${kind}-speed`);
    const knots = String(Math.round(skyFlightSpeeds[kind] * 1.94384));
    input.disabled = !BOOT.ready || !!BOOT.error || G.mode !== 'paused';
    input.min = kind === 'burn' ? String(skyBurnMinimum()) : '100';
    if (kind === 'burn' && input.min === '500') input.disabled = true;
    if (input.value !== knots) input.value = knots;
    skyAttribute(input, 'aria-valuetext', `${knots} 节`);
    skyText(`sky-${kind}-speed-value`, `${knots} 节${kind === 'burn' && input.min === '500' ? ' · 已达上限' : ''}`);
  }
  const enabled = BOOT.ready && !BOOT.error && G.mode === 'paused';
  const enemy = skyGet('sky-enemy-speed'), mouse = skyGet('sky-mouse-steering');
  enemy.disabled = mouse.disabled = !enabled;
  enemy.value = String(Math.round(skyControlSettings.enemySpeed * 100));
  mouse.checked = skyControlSettings.mouse;
  skyText('sky-enemy-speed-value', `${enemy.value}%`);
  skyAttribute(enemy, 'aria-valuetext', `${enemy.value}%`);
}

function skySetControlSetting(kind, value) {
  if (G.mode !== 'paused') return;
  if (kind === 'mouse' && typeof value === 'boolean') {
    skyControlSettings.mouse = G.player.mouseSteering = value;
    resetMouseSteering();
  } else if (kind === 'enemySpeed' && Number.isFinite(Number(value))) {
    skyControlSettings.enemySpeed = G.enemySpeedScale = clamp(Math.round(Number(value) / 5) * 5, 30, 120) / 100;
  }
  skySync();
}

function skyTrackTurnGesture(code, down, repeat = false) {
  if (!['KeyA', 'KeyD'].includes(code) || repeat || G.mode !== 'play') return;
  const p = G.player, now = G.realTime;
  if (!p || p.dead || p.halfRoll || p.rollT > 0) { skyTurnGesture = null; return; }
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

const skyUpdateFlight = updateFlight;
updateFlight = function (dt) {
  const p = G.player;
  if (p?.halfRoll && !p.dead) {
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
  if (flightMode === 'intercept') return skyPrepareWave(n);
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
    p.cruiseSpeed = skyFlightSpeeds.cruise;
    p.burnSpeed = skyFlightSpeeds.burn;
    p.speed = p.targetSpeed = p.cruiseSpeed;
    p.mouseSteering = skyControlSettings.mouse;
    p.cockpitComfort = true; p.speedResponse = 1.6; p.inversionRoll = 0;
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
  G.skyScenic = mode === 'free' ? { oblique: false, from: 0, changedAt: 0 } : null;
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
const skyTogglePause = togglePause;
togglePause = function () {
  const before = G.mode;
  skyTogglePause();
  if (G.mode !== before) skyClearInput();
  skySync();
};
const skyToggleSound = toggleSound;
toggleSound = function () {
  AudioSys.init();
  skyToggleSound();
  skySync();
};
const skyKeyDown = onKeyDown;
const skyBarrelRoll = triggerBarrelRoll;
triggerBarrelRoll = function () { if (!G.player?.halfRoll) skyBarrelRoll(); };
onKeyDown = function (code) {
  if (G.mode === 'title') {
    if (code === 'Enter' || code === 'NumpadEnter') skyStart('intercept');
    else if (code === 'KeyM' && BOOT.ready) toggleSound();
    return;
  }
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
  const view = ['top', 'chase', 'cockpit'][G.view] || 'chase';
  const chase = skyGet('sky-chase'), showChase = !!G.skyScenic && view === 'chase' && (active || mode === 'paused');
  if (chase.hidden === showChase) chase.hidden = !showChase;
  skyAttribute(chase, 'aria-pressed', showChase && G.skyScenic.oblique);
  const scenic = skyScenicView();
  skyAttribute(skyApp, 'data-scenic', scenic);
  skyAttribute(skyApp, 'data-mode', mode);
  skyAttribute(skyApp, 'data-view', view);
  skyAttribute(skyApp, 'data-flight', flightMode);
  const fullHUD = !!G.player && view !== 'cockpit' && ['play', 'waveclear', 'paused', 'dying'].includes(mode);
  skyAttribute(skyApp, 'data-hud', fullHUD ? 'flight' : 'shell');
  const modalOpen = ready && (mode === 'paused' || mode === 'failed');
  for (const id of ['sky-header', 'sky-controls']) {
    const el = skyGet(id);
    if (el && el.inert !== modalOpen) el.inert = modalOpen;
  }
  for (const [id, show] of [['sky-start', ready && mode === 'title'], ['sky-pause', ready && mode === 'paused'], ['sky-result', ready && mode === 'failed'], ['sky-combat', ready && flightMode === 'intercept' && mode !== 'title']]) {
    const el = skyGet(id); if (el && el.hidden === show) el.hidden = !show;
  }
  const enabled = {
    'sky-intercept': ready && mode === 'title', 'sky-cruise': ready && mode === 'title', 'sky-inland': ready && mode === 'title',
    'sky-camera': ready && (active || mode === 'title'), 'sky-chase': showChase && active, 'sky-sound': ready,
    'sky-fullscreen': ready && typeof skyApp.requestFullscreen === 'function' && document.fullscreenEnabled !== false,
    'sky-resume': ready && mode === 'paused', 'sky-restart': ready && mode === 'paused', 'sky-home': ready && mode === 'paused',
    'sky-speed-reset': ready && mode === 'paused',
    'sky-again': ready && mode === 'failed' && G.failTimer > 0.5, 'sky-result-home': ready && mode === 'failed'
  };
  for (const b of skyButtons) {
    const action = b.dataset.skyAction;
    let on = action ? (action === 'pause' ? active || (ready && mode === 'paused') : action === 'roll' ? active && mode === 'play' : active) : !!enabled[b.id];
    if (action === 'flare') {
      on = ready && mode === 'play' && G.player && !G.player.dead && G.player.flares > 0 && G.player.flareCd <= 0;
      const remaining = G.player?.flares ?? 3, cooldown = Math.max(0, Math.ceil(G.player?.flareCd || 0));
      skyText(b.querySelector('span'), remaining <= 0 ? '干扰弹 用尽' : cooldown ? `干扰弹 ${cooldown}s` : `干扰弹 ${remaining}`);
      const label = `干扰弹，C 或 X；剩余 ${remaining}，冷却 ${cooldown} 秒`;
      skyAttribute(b, 'aria-label', label); skyAttribute(b, 'title', label);
    }
    if (b.disabled === on) b.disabled = !on;
  }
  skySyncFlightSpeeds();
  skyText('sky-mode-label', mode === 'title' ? '待命 / READY TO FLY' : inlandFlight ? '秋林低飞 / VALLEY RUN' : flightMode === 'free' ? '自由巡航 / FREE FLIGHT' : '截击任务 / INTERCEPT');
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
  const boost = skyActions.find(b => b.dataset.skyAction === 'boost');
  if (boost) {
    const capped = !!p && p.burnSpeed <= p.cruiseSpeed + .01;
    skyText(boost.querySelector('span'), capped ? '已达上限' : p?.burning ? `加力 ${Math.round(p.targetSpeed * 1.94384)}节` : '加速');
  }
  skyText('sky-alt', p ? skyNumber(p.pos.y * 3.28084) : '—');
  skyText('sky-speed', p ? skyNumber(p.speed * 1.94384) : '—');
  skyText('sky-wave', `第 ${pad(G.wave, 2)} 波 · ${G.waveKills}/${G.waveTotal}`);
  skyText('sky-score', skyNumber(G.score));
  skyText('sky-shield', p ? Math.ceil(Math.max(0, p.shield)) : 100);
  skyText('sky-fuel', p ? Math.ceil(Math.max(0, p.fuel)) : 100);
  const systems = skyGet('sky-systems');
  const showSystems = !!p && view !== 'cockpit' && (active || mode === 'paused');
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
  skyText('sky-result-score', skyNumber(G.score)); skyText('sky-result-kills', skyNumber(G.stats.kills));
  const ammo = p ? p.missiles : 4;
  skyText('sky-ammo-count', `${pad(ammo, 2)}/04`);
  for (let i = 0; i < skyAmmo.length; i++) {
    skyAttribute(skyAmmo[i], 'data-ready', i < ammo);
    skyAttribute(skyAmmo[i], 'data-empty', i >= ammo);
  }
  skyAttribute(skyGet('sky-ammo'), 'aria-label', `导弹 ${ammo} / 4`);
  const status = BOOT.error || (!ready ? `正在准备飞行 · ${BOOT.stage}` : mode === 'title' ? '可从湖岸或秋林起飞；回车开始截击。' : mode === 'paused' ? '飞行已暂停。' : mode === 'failed' ? '飞行结束，可重新起飞或返回主界面。' : flightMode === 'free' ? '自由巡航：不受战斗伤害，撞地仍会损毁。' : '截击任务：消灭敌机，注意地形与来袭导弹。');
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
    const focus = mode === 'paused' ? skyGet('sky-resume') : mode === 'failed' ? skyGet('sky-result-home') : null;
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
window.addEventListener('keydown', e => {
  const modal = G.mode === 'paused' ? skyGet('sky-pause') : G.mode === 'failed' ? skyGet('sky-result') : null;
  if (modal && e.code === 'Tab') {
    const controls = [...modal.querySelectorAll('button, input')].filter(b => !b.disabled);
    const index = controls.indexOf(document.activeElement);
    if (index < 0 || (e.shiftKey ? index === 0 : index === controls.length - 1)) {
      e.preventDefault();
      controls[e.shiftKey ? controls.length - 1 : 0]?.focus();
    }
    e.stopImmediatePropagation();
    return;
  }
  if (G.mode === 'paused') {
    if (e.code === 'KeyM') {
      if (!e.repeat) toggleSound();
    } else if (['Escape', 'KeyP'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (['Enter', 'NumpadEnter'].includes(e.code) && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      if (!e.repeat) togglePause();
    }
    e.stopImmediatePropagation();
    return; // 保留控件原生行为，暂停按键不进入飞行输入。
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
skyClick('sky-resume', () => togglePause());
skyClick('sky-speed-reset', skyResetFlightSpeeds);
for (const kind of ['cruise', 'burn']) {
  const input = skyGet(`sky-${kind}-speed`);
  input.addEventListener('input', () => skySetFlightSpeed(kind, input.value));
}
skyGet('sky-enemy-speed').addEventListener('input', e => skySetControlSetting('enemySpeed', e.target.value));
skyGet('sky-mouse-steering').addEventListener('change', e => skySetControlSetting('mouse', e.target.checked));
skyClick('sky-restart', () => startRun(flightMode));
skyClick('sky-again', () => startRun(flightMode));
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
  else if (action === 'missile') firePlayerMissile();
  else if (action === 'flare') tryFlares();
  else if (action === 'view') cycleView();
  else if (action === 'pause') togglePause();
  skySync();
});

const skyDrawUIFrame = drawUIFrame;
drawUIFrame = function () { skyDrawUIFrame(); skySync(); };
window.__SKY = { start: skyStart, home: skyHome, restart: () => startRun(flightMode), get flightMode() { return flightMode; }, sync: skySync };
worldHInit = false;
resizeAll();
if (window.ResizeObserver) new window.ResizeObserver(() => resizeAll()).observe(skyStage);

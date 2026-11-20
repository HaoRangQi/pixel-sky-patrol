// 使用运行时赋值，避免函数声明提升到原版boot之前。
let flightMode = 'intercept';
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

const skyStartRun = startRun;
startRun = function (mode = flightMode) {
  if (!BOOT.ready || BOOT.error || !G.map) return false;
  if (mode !== 'free' && mode !== 'intercept') return false;
  flightMode = mode;
  skyNotice = '';
  skyClearInput();
  G.pausedFrom = null; G.freeze = false;
  skyStartRun();
  if (flightMode === 'free') {
    G.banner = { title: '自由巡航', sub: '无战斗伤害，仍需避开地形', t: 0, life: 3.4 };
  }
  setViewName('chase');
  skySync();
  return true;
};
function skyStart(mode = 'intercept') {
  if (!BOOT.ready || BOOT.error) return false;
  AudioSys.init();
  if (G.sound) AudioSys.setEnabled(true);
  return startRun(mode);
}
function skyHome() {
  if (!BOOT.ready || BOOT.error || !G.map) return false;
  skyClearInput(); skyNotice = '';
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
  skyAttribute(skyApp, 'data-mode', mode);
  skyAttribute(skyApp, 'data-view', view);
  skyAttribute(skyApp, 'data-flight', flightMode);
  const modalOpen = ready && (mode === 'paused' || mode === 'failed');
  for (const id of ['sky-header', 'sky-controls']) {
    const el = skyGet(id);
    if (el && el.inert !== modalOpen) el.inert = modalOpen;
  }
  for (const [id, show] of [['sky-start', ready && mode === 'title'], ['sky-pause', ready && mode === 'paused'], ['sky-result', ready && mode === 'failed'], ['sky-combat', ready && flightMode === 'intercept' && mode !== 'title']]) {
    const el = skyGet(id); if (el && el.hidden === show) el.hidden = !show;
  }
  const enabled = {
    'sky-intercept': ready && mode === 'title', 'sky-cruise': ready && mode === 'title',
    'sky-camera': ready && (active || mode === 'title'), 'sky-sound': ready,
    'sky-fullscreen': ready && typeof skyApp.requestFullscreen === 'function' && document.fullscreenEnabled !== false,
    'sky-resume': ready && mode === 'paused', 'sky-restart': ready && mode === 'paused', 'sky-home': ready && mode === 'paused',
    'sky-again': ready && mode === 'failed' && G.failTimer > 0.5, 'sky-result-home': ready && mode === 'failed'
  };
  for (const b of skyButtons) {
    const action = b.dataset.skyAction;
    const on = action ? (action === 'pause' ? active || (ready && mode === 'paused') : action === 'roll' ? active && mode === 'play' : active) : !!enabled[b.id];
    if (b.disabled === on) b.disabled = !on;
  }
  skyText('sky-mode-label', mode === 'title' ? '待命 / READY TO FLY' : flightMode === 'free' ? '自由巡航 / FREE FLIGHT' : '截击任务 / INTERCEPT');
  const viewName = { top: '俯瞰视角', chase: '追尾视角', cockpit: '座舱视角' }[view];
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
  skyText('sky-alt', p ? skyNumber(p.pos.y * 3.28084) : '—');
  skyText('sky-speed', p ? skyNumber(p.speed * 1.94384) : '—');
  skyText('sky-wave', `第 ${pad(G.wave, 2)} 波 · ${G.waveKills}/${G.waveTotal}`);
  skyText('sky-score', skyNumber(G.score));
  skyText('sky-shield', p ? Math.ceil(Math.max(0, p.shield)) : 100);
  skyText('sky-fuel', p ? Math.ceil(Math.max(0, p.fuel)) : 100);
  skyText('sky-result-score', skyNumber(G.score)); skyText('sky-result-kills', skyNumber(G.stats.kills));
  const ammo = p ? p.missiles : 4;
  skyText('sky-ammo-count', `${pad(ammo, 2)}/04`);
  for (let i = 0; i < skyAmmo.length; i++) {
    skyAttribute(skyAmmo[i], 'data-ready', i < ammo);
    skyAttribute(skyAmmo[i], 'data-empty', i >= ammo);
  }
  skyAttribute(skyGet('sky-ammo'), 'aria-label', `导弹 ${ammo} / 4`);
  const status = BOOT.error || (!ready ? `正在准备飞行 · ${BOOT.stage}` : mode === 'title' ? '选择开始截击或自由巡航；回车开始截击。' : mode === 'paused' ? '飞行已暂停。' : mode === 'failed' ? '飞行结束，可重新起飞或返回主界面。' : flightMode === 'free' ? '自由巡航：不受战斗伤害，撞地仍会损毁。' : '截击任务：消灭敌机，注意地形与来袭导弹。');
  skyText('sky-status', skyNotice && performance.now() < skyNoticeUntil ? skyNotice : status);
  if (!Number.isFinite(G.highScore)) G.highScore = 0;
  SKY_OCCLUSION.length = 0;
  const stage = uiCanvas.getBoundingClientRect();
  if (stage.width && stage.height) for (const id of ['sky-brand', 'sky-telemetry', 'sky-camera', 'sky-combat']) {
    const el = skyGet(id);
    if (!el || el.hidden || (view === 'cockpit' && (id === 'sky-brand' || id === 'sky-telemetry'))) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) SKY_OCCLUSION.push({ x: (r.left - stage.left) / stage.width * VW - 3, y: (r.top - stage.top) / stage.height * VH - 3, w: r.width / stage.width * VW + 6, h: r.height / stage.height * VH + 6 });
  }
  setBodyClass();
  if (mode !== skyLastMode) {
    skyLastMode = mode;
    const focus = mode === 'paused' ? skyGet('sky-resume') : mode === 'failed' ? skyGet('sky-result-home') : null;
    if (focus) focus.focus({ preventScroll: true });
    else if (mode === 'play' && document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
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
    const buttons = [...modal.querySelectorAll('button')].filter(b => !b.disabled);
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || (e.shiftKey ? index === 0 : index === buttons.length - 1)) {
      e.preventDefault();
      buttons[e.shiftKey ? buttons.length - 1 : 0]?.focus({ preventScroll: true });
    }
    e.stopImmediatePropagation();
    return;
  }
  const button = e.target.closest?.('button');
  if (!button || !['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;
  if (!e.repeat) { skyHold(button, e.code, true); skyKeyClicks.add(button); }
  e.stopImmediatePropagation(); // 保留按钮原生激活，不拦截WASD等其他快捷键。
}, true);
window.addEventListener('keyup', e => {
  skyKeyHolds.delete(e.code); skyRefreshHolds();
}, true);
window.addEventListener('blur', skyClearInput);

function skyClick(id, action) {
  const button = skyGet(id);
  button.addEventListener('click', () => { if (!button.disabled) { action(); skySync(); } });
}
skyClick('sky-intercept', () => skyStart('intercept'));
skyClick('sky-cruise', () => skyStart('free'));
skyClick('sky-resume', () => togglePause());
skyClick('sky-restart', () => startRun(flightMode));
skyClick('sky-again', () => startRun(flightMode));
skyClick('sky-home', skyHome); skyClick('sky-result-home', skyHome);
skyClick('sky-camera', () => cycleView()); skyClick('sky-sound', () => toggleSound());
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

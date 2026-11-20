// ---------------------------------------------------------------------------
// UI: screens, touch controls, input actions.
// ---------------------------------------------------------------------------
function toggleSound() {
  G.sound = !G.sound;
  AudioSys.setEnabled(G.sound);
  if (G.sound) AudioSys.uiTick();
}

function beginSortie() {
  if (G.mode !== 'title') return;
  AudioSys.init();
  if (G.sound) AudioSys.setEnabled(true);
  resetMouseSteering();
  startRun();
}

function togglePause() {
  if (G.mode === 'play' || G.mode === 'waveclear') {
    resetMouseSteering();
    G.pausedFrom = G.mode;
    G.mode = 'paused';
    INPUT.left = INPUT.touchBurn = INPUT.touchGun = false;
    INPUT.keys.clear();
    AudioSys.updateEngine(false, 0, true);
    AudioSys.uiTick();
  } else if (G.mode === 'paused') {
    resetMouseSteering();
    G.mode = G.pausedFrom || 'play';
    G.pausedFrom = null;
    AudioSys.uiTick();
  }
}

// ------------------------------------------------------------- input --------
function onPrimaryDown() {
  if (G.mode === 'play' || G.mode === 'waveclear') firePlayerGuns();
}
function onSecondaryDown() {
  if (G.mode === 'play' || G.mode === 'waveclear') firePlayerMissile();
}
function onKeyDown(code) {
  if (code === 'KeyM') { toggleSound(); return; }
  if (G.mode === 'loading') return;
  if (code === 'Enter' || code === 'NumpadEnter') {
    if (G.mode === 'title') { beginSortie(); return; }
    if (G.mode === 'failed' && G.failTimer > 0.5) { restartRun(); return; }
    if (G.mode === 'paused') { togglePause(); return; }
  }
  if (code === 'Space') {
    if (G.mode === 'title') beginSortie();
    else if (G.mode === 'play' || G.mode === 'waveclear') cycleView();
    return;
  }
  if (code === 'Escape' || code === 'KeyP') {
    if (G.mode === 'play' || G.mode === 'waveclear' || G.mode === 'paused') togglePause();
    return;
  }
  if (code === 'KeyR') {
    if (G.mode === 'failed' && G.failTimer > 0.35) restartRun();
    return;
  }
  if (code === 'KeyQ') {
    triggerBarrelRoll();
    return;
  }
  if (code === 'KeyE') {
    if (G.mode === 'play' || G.mode === 'waveclear') firePlayerMissile();
    return;
  }
  if (code === 'KeyF') {
    if (G.mode === 'play' || G.mode === 'waveclear') firePlayerGuns();
    return;
  }
  if (code === 'KeyX' || code === 'KeyC') {
    if (G.mode === 'play' || G.mode === 'waveclear') tryFlares();
    return;
  }
}

// ------------------------------------------------------------ screens -------
function drawLoading() {
  const t = BOOT.startTime ? (performance.now() - BOOT.startTime) / 1000 : G.realTime;
  // cold alpine sky bands: slate overhead, pale blue-grey at the horizon
  const bands = [
    '#121c29', '#172233', '#1c2a3c', '#233345', '#2b3d4f',
    '#35495a', '#425665', '#526572', '#667781', '#829199'
  ];
  const horizon = Math.round(VH * 0.56);
  for (let i = 0; i < bands.length; i++) {
    const y0 = Math.round(i * horizon / bands.length);
    const y1 = Math.round((i + 1) * horizon / bands.length);
    rect(0, y0, VW, y1 - y0, bands[i]);
    // dither the seam into the next band
    if (i < bands.length - 1) {
      ctx.save(); ctx.globalAlpha = 0.45;
      for (let x = (i % 2) * 2; x < VW; x += 4) {
        ctx.fillStyle = bands[i + 1];
        ctx.fillRect(x, y1 - 1, 2, 1);
        ctx.fillRect(x + 1, y1, 1, 1);
      }
      ctx.restore();
    }
  }
  // soft horizon haze, no sun disc
  const sx = Math.round(VW * 0.64);
  ctx.save(); ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#b9c7ce';
  ctx.fillRect(0, horizon - 9, VW, 3);
  ctx.fillRect(0, horizon - 5, VW, 2);
  ctx.restore();
  // high cirrus, neutral grey-blue
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) {
    const x = (i * 149 + 60) % VW;
    const y = 34 + (i * 31) % 80;
    ctx.fillStyle = i % 2 ? '#8fa0aa' : '#b3c0c8';
    ctx.fillRect(x, y, 46 + i * 8, 1);
    ctx.fillRect(x + 9, y + 2, 31, 1);
  }
  ctx.restore();
  // mountain ridges with snow caps
  const ridgeLayers = [
    { base: horizon - 40, amp: 46, col: '#3c4d5e', snow: '#aab8c2', step: 23, seed: 1, snowAt: 0.34 },
    { base: horizon - 22, amp: 30, col: '#2c3b4a', snow: '#8fa0ad', step: 17, seed: 2, snowAt: 0.50 },
    { base: horizon - 8, amp: 15, col: '#1e2a36', step: 11, seed: 3, snow: null, snowAt: 1 },
  ];
  for (const L of ridgeLayers) {
    ctx.fillStyle = L.col;
    for (let x = 0; x < VW; x += L.step) {
      const n = hash2(Math.floor(x / L.step) + L.seed * 91, L.seed, 13);
      const h = Math.round(L.base - n * L.amp);
      ctx.fillRect(x, h, L.step, horizon + 6 - h);
    }
    if (L.snow) {
      ctx.fillStyle = L.snow;
      for (let x = 0; x < VW; x += L.step) {
        const n = hash2(Math.floor(x / L.step) + L.seed * 91, L.seed, 13);
        if (n <= L.snowAt) continue;
        const h = Math.round(L.base - n * L.amp);
        const cap = Math.min(6, 1 + Math.round((n - L.snowAt) * 9));
        ctx.fillRect(x + 1, h, L.step - 2, cap);
        ctx.fillRect(x + 3, h - 1, Math.max(2, L.step - 6), 1);
      }
    }
  }
  // dark conifer fringe on the far shore
  ctx.fillStyle = '#142019';
  for (let x = 0; x < VW; x += 2) {
    const n = hash2(x * 7 + 3, 5, 41);
    const th = 2 + Math.floor(n * 5);
    ctx.fillRect(x, horizon + 5 - th, 1 + (x % 3 === 0 ? 1 : 0), th);
  }
  // lake
  rect(0, horizon + 4, VW, VH - horizon - 4, '#16232b');
  for (let y = horizon + 7; y < VH; y += 3) {
    const a = 1 - (y - horizon) / (VH - horizon);
    ctx.globalAlpha = 0.18 * a;
    ctx.fillStyle = y % 6 === 0 ? '#a7b6bd' : '#4d6470';
    const w = 16 + ((y * 17) % 64);
    ctx.fillRect(sx - w / 2 + ((y * 13) % 9) - 4, y, w, 1);
  }
  ctx.globalAlpha = 1;
  // silhouetted lead aircraft
  const px = Math.round(VW * (0.22 + 0.03 * Math.sin(t * 0.22)));
  const py = Math.round(horizon * 0.34 + Math.sin(t * 0.6) * 2);
  drawPixelJet(px, py, 1, '#0f0c16');
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#ffcb88';
  ctx.fillRect(px - 15, py + 2, 11, 1);
  ctx.globalAlpha = 1;

  // title + loading
  drawText('巡逻：截击', VW / 2, 44, {
    size: 26, color: '#ffe7b8', align: 'center', spacing: 2, outline: '#18101a', bold: true
  });
  drawText('湖区 // 当地时间 07:12', VW / 2, 58, {
    size: 9, color: '#c2ced8', align: 'center', spacing: 0
  });
  const label = BOOT.stage || '准备出击';
  drawText(label, VW / 2, VH - 78, {
    size: 9, color: '#dde6ee', align: 'center', spacing: 0.5, shadow: '#120c12'
  });
  const pw = Math.min(300, Math.round(VW * 0.56));
  const pxx = Math.round(VW / 2 - pw / 2), pyy = VH - 66;
  rect(pxx - 1, pyy - 1, pw + 2, 10, '#0e0b13');
  rectLine(pxx - 1, pyy - 1, pw + 2, 10, '#6d563b');
  const fill = Math.round(pw * clamp01(BOOT.progress || 0));
  rect(pxx, pyy, fill, 8, '#d5a955');
  for (let x = pxx; x < pxx + fill; x += 6) {
    rect(x, pyy, 1, 8, '#ffe6a0');
  }
  drawText(`${Math.floor(clamp01(BOOT.progress || 0) * 100)}%`, VW / 2, VH - 45, {
    size: 7, color: '#ccd8e0', align: 'center', mono: true
  });
  drawText('提示：云层与森林可遮蔽你的雷达信号', VW / 2, VH - 24, {
    size: 9, color: '#a8b7c1', align: 'center'
  });
  if (BOOT.error) {
    rect(0, 0, VW, VH, 'rgba(10,7,12,0.86)');
    drawText('无法启动', VW / 2, VH / 2 - 16, { size: 18, color: '#ff7a62', align: 'center', spacing: 1 });
    drawText(BOOT.error, VW / 2, VH / 2 + 4, { size: 8, color: '#f0e3c6', align: 'center', mono: true });
    drawText('需要 WebGL2 才能渲染地形与体积云', VW / 2, VH / 2 + 24, {
      size: 9, color: '#c2ab80', align: 'center'
    });
  }
}

function drawPixelJet(x, y, s, col) {
  ctx.fillStyle = col;
  ctx.fillRect(x - 14 * s, y, 28 * s, 2 * s);
  ctx.fillRect(x - 5 * s, y - 3 * s, 10 * s, 3 * s);
  ctx.fillRect(x - 2 * s, y - 5 * s, 4 * s, 2 * s);
  ctx.fillRect(x - 22 * s, y + 1 * s, 7 * s, 1 * s);
  ctx.fillRect(x + 15 * s, y + 1 * s, 7 * s, 1 * s);
  ctx.fillRect(x - 8 * s, y + 2 * s, 2 * s, 2 * s);
  ctx.fillRect(x + 6 * s, y + 2 * s, 2 * s, 2 * s);
}

function drawTitle() {
  const t = G.realTime;
  // base dim + left legibility panel with dithered edge
  rect(0, 0, VW, VH, 'rgba(8,6,13,0.24)');
  const panelW = Math.min(396, VW * 0.63);
  rect(0, 0, panelW, VH, 'rgba(12,9,18,0.42)');
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#0c0912';
  for (let y = 0; y < VH; y += 2) {
    const w = 3 + ((y * 7) % 5);
    ctx.fillRect(panelW, y, w, 1);
    if (y % 4 === 0) ctx.fillRect(panelW + w, y + 1, 2, 1);
  }
  ctx.restore();
  // corner brackets
  ctx.strokeStyle = 'rgba(213,169,85,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, 26); ctx.lineTo(10, 10); ctx.lineTo(26, 10);
  ctx.moveTo(VW - 26, 10); ctx.lineTo(VW - 10, 10); ctx.lineTo(VW - 10, 26);
  ctx.stroke();
  drawText('第18截击中队  //  湖滨战区', 42, 27, {
    size: 9, color: '#c9ad86', spacing: 0
  });
  drawText('雪线行动', VW - 42, 27, { size: 9, color: '#c9ad86', align: 'right' });
  // title lockup
  drawText('巡逻：', 44, 94, {
    size: 34, color: '#fff0c8', spacing: 2, outline: '#1a1014', shadow: '#8d5a2e', bold: true
  });
  drawText('截击', 48, 126, {
    size: 28, color: '#f0c05a', spacing: 9, outline: '#1a1014', shadow: '#6b3a27', bold: true
  });
  drawText('PATROL: INTERCEPT', 48, 139, {
    size: 6, color: '#9d8261', mono: true, spacing: 1
  });
  line(44, 145, 308, 145, '#b8894d', 1);
  line(44, 147, 250, 147, 'rgba(184,137,77,0.4)', 1);
  drawText('阿尔卑斯制空  //  无尽出击', 46, 162, {
    size: 10, color: '#e2cfab', spacing: 0
  });
  drawText('最高分', 46, 184, { size: 10, color: '#a99276' });
  drawText(pad(Math.floor(G.highScore), 6), 124, 184, { size: 9, color: '#ffe0a0', mono: true });
  // sortie prompt
  const blink = Math.sin(t * 4.2) > -0.25;
  const bx = 44, by = 194, bw = 236, bh = 30;
  panel(bx, by, bw, bh, {
    fill: blink ? '#2e241c' : '#1a151d', stroke: blink ? '#ffd67a' : '#7a6241',
    alpha: 0.92, corners: true
  });
  drawText(INPUT.touchMode ? '轻触出击' : '按任意键出击', bx + bw / 2, by + 20, {
    size: 13, color: blink ? '#ffe7ae' : '#c7ad81', align: 'center', spacing: 2, bold: true
  });
  drawText(INPUT.touchMode ? '拖动操纵  /  屏上武器按钮' : '点击或按回车', bx + bw / 2, by + 40, {
    size: 10, color: '#d3bd97', align: 'center'
  });
  drawText('任务：截击  /  附加目标  /  无召回', 46, 251, {
    size: 10, color: '#c6ac89'
  });
  drawText('音效默认关闭，按 M 开关', 46, 264, { size: 9, color: '#a99276' });

  // bottom control strip
  const sy = VH - 46;
  panel(0, sy, VW, 46, { alpha: 0.9, fill: '#0e0b13', stroke: '#4e4031', border: true });
  line(10, sy, VW - 10, sy, '#7a6241', 1);
  const p = G.player;
  if (INPUT.touchMode) {
    drawText('拖动 操纵', 18, sy + 13, { size: 10, color: '#e2cfab' });
    drawText('桶滚', 108, sy + 13, { size: 10, color: '#e2cfab' });
    drawText('长按 加力', 158, sy + 13, { size: 10, color: '#e2cfab' });
    drawText('导弹', 248, sy + 13, { size: 10, color: '#e2cfab' });
    drawText('干扰', 288, sy + 13, { size: 10, color: '#e2cfab' });
    drawText('视角', 326, sy + 13, { size: 10, color: '#e2cfab' });
    drawText('触屏控制已启用', 18, sy + 29, { size: 9, color: '#a99276' });
  } else {
    drawText('WASD / 鼠标 操纵    左键 / F 机炮扫射    Q 桶滚', 18, sy + 13, {
      size: 10, color: '#e2cfab'
    });
    drawText('右键 / E 导弹    Shift 加力    X 干扰    空格 视角    ESC 暂停', 18, sy + 26, {
      size: 10, color: '#c3ab8c'
    });
    drawText('A / D 转向    W / S 俯仰    俯视：W / S 升降    M 音效', 18, sy + 38, {
      size: 10, color: '#a08a6e'
    });
  }
  // missile pips
  const mx = VW - 198, my = sy + 15;
  drawText('导弹', mx - 27, my + 7, { size: 9, color: '#a99276' });
  for (let i = 0; i < 4; i++) {
    const ix2 = mx + i * 8;
    const ready = i < (p ? p.missiles : 4);
    rect(ix2, my, 5, 9, ready ? '#e5c273' : '#302736');
    rectLine(ix2, my, 5, 9, '#6b573e');
    if (ready) {
      rect(ix2 + 2, my + 1, 1, 1, '#b04a3a');
      rect(ix2 + 1, my + 2, 3, 4, '#f0d791');
      rect(ix2, my + 6, 1, 2, '#b59a55');
      rect(ix2 + 4, my + 6, 1, 2, '#b59a55');
    }
  }
  drawText('护盾', mx + 38, my + 7, { size: 9, color: '#a99276' });
  segBar(mx + 60, my + 2, 40, 5, p ? p.shield / 100 : 1, '#7fd8cd', '#2a2030', 10);
  drawSoundButton(VW - 92, sy + 30, 78, 12);
  // full-screen start hit (registered last so specific buttons win)
  addHit(0, 0, VW, VH, beginSortie, null);
}

function drawSoundButton(x, y, w, h) {
  const on = G.sound;
  panel(x, y, w, h, {
    fill: on ? '#2c2820' : '#1b1721', stroke: on ? '#e0b96b' : '#5c4c3b',
    alpha: 0.95
  });
  // speaker
  const ix = x + 6, iy = y + Math.round(h / 2);
  ctx.fillStyle = on ? '#ffe0a0' : '#9d8b71';
  ctx.fillRect(ix, iy - 2, 3, 4);
  ctx.beginPath();
  ctx.moveTo(ix + 3, iy - 2); ctx.lineTo(ix + 6, iy - 4); ctx.lineTo(ix + 6, iy + 4); ctx.lineTo(ix + 3, iy + 2);
  ctx.fill();
  if (on) {
    ctx.fillRect(ix + 8, iy - 3, 1, 6);
    ctx.fillRect(ix + 10, iy - 2, 1, 4);
  } else {
    ctx.fillStyle = '#7d6955';
    ctx.fillRect(ix + 8, iy - 3, 1, 1); ctx.fillRect(ix + 9, iy - 2, 1, 1);
    ctx.fillRect(ix + 10, iy - 1, 1, 1); ctx.fillRect(ix + 10, iy + 1, 1, 1);
    ctx.fillRect(ix + 9, iy + 1, 1, 1); ctx.fillRect(ix + 8, iy + 3, 1, 1);
  }
  drawText(on ? '音效 开' : '音效 关', x + w - 5, y + h / 2 + 3, {
    size: 9, color: on ? '#ffe0a0' : '#9d8b71', align: 'right'
  });
  addHit(x, y, w, h, toggleSound, null);
}

function drawWaveClear() {
  const p = G.player;
  const w = Math.min(360, VW - 30), h = 150;
  const x = Math.round(VW / 2 - w / 2), y = 66;
  panel(x, y, w, h, { fill: '#14101b', stroke: '#d5a955', alpha: 0.9, corners: true });
  drawText('区域肃清', VW / 2, y + 24, { size: 20, color: '#ffe3a3', align: 'center', spacing: 2, outline: '#120b10', bold: true });
  drawText(`第 ${pad(G.wave, 2)} 波完成`, VW / 2, y + 39, { size: 10, color: '#cdb57f', align: 'center', spacing: 0 });
  line(x + 20, y + 46, x + w - 20, y + 46, '#6b573e', 1);
  drawText('主目标清扫', x + 22, y + 63, { size: 10, color: '#a99276' });
  drawText(`+${200 + G.wave * 20}`, x + w - 22, y + 63, { size: 8, color: '#ffe0a0', align: 'right', mono: true });
  drawText('附加目标', x + 22, y + 80, { size: 10, color: '#a99276' });
  if (G.secondary) {
    drawText(G.secondaryDone ? '完成' : '失败', x + w - 22, y + 80, {
      size: 10, color: G.secondaryDone ? '#bce7a0' : '#c27b6b', align: 'right'
    });
    drawText(G.secondary.text, x + 22, y + 96, { size: 9, color: '#9e8a74' });
    if (G.secondaryDone) drawText(`+${350 + G.wave * 25}`, x + w - 22, y + 96, { size: 8, color: '#ffe0a0', align: 'right', mono: true });
  }
  line(x + 20, y + 107, x + w - 20, y + 107, '#4d3f30', 1);
  drawText('装弹 / 护盾回充 / 加油', VW / 2, y + 120, {
    size: 9, color: '#bce7e0', align: 'center', spacing: 0
  });
  const secs = Math.max(0, Math.ceil(G.respite));
  drawText(`下一波 00:${pad(secs, 2)}`, VW / 2, y + 137, {
    size: 10, color: secs <= 3 ? '#ffd27a' : '#e7d3ad', align: 'center', spacing: 0
  });
  const bw = w - 44, bx = x + 22, by = y + 141;
  segBar(bx, by, bw, 4, 1 - clamp01(G.respite / 8), '#c89a4a', '#261d2c', 24);
  // small keep-flying note
  drawText('可继续操纵并切换视角', VW / 2, y + h + 13, {
    size: 9, color: '#a99276', align: 'center'
  });
}

function drawFailed() {
  const t = G.realTime;
  rect(0, 0, VW, VH, 'rgba(10,6,10,0.62)');
  // red edge bands
  ctx.save();
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.035 + i * 0.012;
    ctx.fillStyle = '#8f2020';
    ctx.fillRect(0, i * 8, VW, 8);
    ctx.fillRect(0, VH - (i + 1) * 8, VW, 8);
  }
  ctx.restore();
  const w = Math.min(330, VW - 24), h = 186;
  const x = Math.round(VW / 2 - w / 2), y = 58;
  panel(x, y, w, h, { fill: '#150f18', stroke: '#8e3d39', alpha: 0.95, corners: '#ff7a62' });
  drawText('任务失败', VW / 2, y + 30, {
    size: 22, color: '#ff6f5e', align: 'center', spacing: 2, outline: '#10070a', bold: true
  });
  drawText('机体损毁 // 信号中断', VW / 2, y + 45, {
    size: 10, color: '#c4968a', align: 'center'
  });
  line(x + 20, y + 53, x + w - 20, y + 53, '#603a36', 1);
  const rows = [
    ['得分', pad(Math.floor(G.score), 6)],
    ['到达波次', pad(G.wave, 2)],
    ['击落无人机', pad(G.stats.kills, 2)],
    ['任务时间', fmtTime(G.missionTime)],
  ];
  for (let i = 0; i < rows.length; i++) {
    const yy = y + 69 + i * 13;
    drawText(rows[i][0], x + 28, yy, { size: 10, color: '#a99276' });
    drawText(rows[i][1], x + w - 28, yy, { size: 9, color: '#eadcb9', align: 'right', mono: true });
  }
  drawText('最高分', x + 28, y + 122, { size: 10, color: '#a99276' });
  drawText(pad(G.highScore, 6), x + w - 28, y + 122, { size: 9, color: '#ffe0a0', align: 'right', mono: true });
  if (G.newHigh) {
    const b = Math.sin(t * 6) > -0.2;
    drawText('新纪录', VW / 2, y + 136, { size: 10, color: b ? '#ffe06a' : '#c9a14e', align: 'center', spacing: 0 });
  }
  const ready = G.failTimer > 0.55;
  drawButton(VW / 2 - 70, y + 144, 140, 26, ready ? '重新出击' : '请稍候…', () => {
    if (G.failTimer > 0.5) restartRun();
  }, { size: 9, alpha: 1, color: ready ? PAL.goldHot : '#8a7c66' });
  drawText('按 R 或点击重试', VW / 2, y + 180, { size: 9, color: '#a99276', align: 'center' });
  drawSoundButton(VW - 94, VH - 24, 80, 13);
}

function drawPause() {
  rect(0, 0, VW, VH, 'rgba(8,6,12,0.58)');
  const w = Math.min(280, VW - 30), h = 150;
  const x = Math.round(VW / 2 - w / 2), y = 84;
  panel(x, y, w, h, { fill: '#15111c', stroke: '#b09055', alpha: 0.95, corners: true });
  drawText('已暂停', VW / 2, y + 32, { size: 22, color: '#ffe3a3', align: 'center', spacing: 3, outline: '#100b12', bold: true });
  drawText('出击挂起', VW / 2, y + 46, { size: 10, color: '#bd9f80', align: 'center', spacing: 0 });
  line(x + 20, y + 54, x + w - 20, y + 54, '#5c4a36', 1);
  drawButton(VW / 2 - 68, y + 64, 136, 24, '继续', togglePause, { size: 9 });
  drawText('ESC / P 继续', VW / 2, y + 104, { size: 10, color: '#bda07e', align: 'center' });
  drawText('点击或轻触继续', VW / 2, y + 116, { size: 10, color: '#9a8468', align: 'center' });
  drawSoundButton(VW / 2 - 40, y + 122, 80, 13);
}

// --------------------------------------------------------- touch controls ---
function drawTouchControls() {
  const p = G.player;
  if (!p) return;
  const bx = VW - 66;
  const bw = 54, bh = 32;
  let by = VH - 64;
  // BURN (hold)
  drawButton(bx, by, bw, bh, '加力', () => { INPUT.touchBurn = true; AudioSys.uiTick(); }, {
    size: 10, alpha: 0.9, color: INPUT.touchBurn ? '#ffe0a0' : PAL.cream,
    onUp: () => { INPUT.touchBurn = false; }
  });
  // overlay active bar
  if (INPUT.touchBurn) {
    rect(bx + 5, by + bh - 5, bw - 10, 2, '#ffb347');
  }
  by -= 36;
  drawButton(bx, by, bw, bh, `干扰 ${p.flares}`, () => {
    if (G.mode === 'play' || G.mode === 'waveclear') tryFlares();
  }, { size: 9, alpha: 0.9, color: p.flares ? '#ffd27a' : '#8a7c66' });
  by -= 36;
  drawButton(bx, by, bw, bh, `导弹 ${p.missiles}`, () => {
    if (G.mode === 'play' || G.mode === 'waveclear') firePlayerMissile();
  }, { size: 9, alpha: 0.9, color: p.missiles ? '#ffd27a' : '#8a7c66' });
  by -= 36;
  drawButton(bx, by, bw, bh, '桶滚', () => {
    if (G.mode === 'play' || G.mode === 'waveclear') triggerBarrelRoll();
  }, { size: 10, alpha: 0.9 });
  by -= 36;
  drawButton(bx, by, bw, bh, '机炮', () => {
    INPUT.touchGun = true;
    firePlayerGuns();
  }, { size: 10, alpha: 0.9, onUp: () => { INPUT.touchGun = false; } });
  // view + pause small
  const sx = VW - 46, sw = 38, sh = 20;
  let sy = 58;
  drawButton(sx, sy, sw, sh, '视角', () => cycleView(), { size: 9, alpha: 0.88 });
  sy += 24;
  drawButton(sx, sy, sw, sh, 'II', () => togglePause(), { size: 7, alpha: 0.88 });
  // steering hint / active stick
  if (TOUCH.active) {
    const x = Math.round(TOUCH.x), y = Math.round(TOUCH.y);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#bfe9de';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#d7f4e8';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.restore();
  } else if (!INPUT.touchBurn) {
    drawText('拖动转向', 18, VH - 24, { size: 10, color: '#bd9f80', shadow: '#0b0912' });
  }
}

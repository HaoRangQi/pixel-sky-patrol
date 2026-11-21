// 完整飞行HUD复用初版仪表；DOM保留菜单、按钮和无障碍读数。
// 本文件在60_main前载入，BOOT只能在稍后执行的绘制函数中读取。
const SKY_OCCLUSION = [];
const skyBaseHudBlocked = hudBlocked;
function skyCompactHUD() {
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  return VW < 420 || unit < 1.2;
}
function skyScenicView() {
  return !!G.skyScenic && (G.view === 0 || G.view === 1 && G.skyScenic.oblique);
}

function skyHeadingTape(full = false) {
  if (!G.player) return;
  const heading = compassDeg(G.player.yaw), cx = VW / 2, narrow = VW < 420;
  const span = full ? Math.min(82, narrow ? Math.max(10, (VW - 160) / 2) : VW * .20) : Math.min(88, VW * .23);
  const scale = span / 35, cockpit = G.cockpitAlpha > .5;
  const ink = cockpit ? SKY_PHOSPHOR : '#fff0d7', y = cockpit ? 16 : 0;
  if (full) panel(cx - span - 5, 8, span * 2 + 10, 15, { alpha: .56, fill: '#24212a', stroke: '#9b8055' });
  for (let d = Math.ceil((heading - 35) / 5) * 5; d <= heading + 35; d += 5) {
    const x = cx + (d - heading) * scale, major = d % 15 === 0;
    line(x, 10 + y, x, (major ? 15 : 13) + y, major ? '#f5ce8c' : ink, 1, .85);
    if (major && !narrow) drawText(pad((d % 360 + 360) % 360, 3), x, 21 + y, {
      size: 6, mono: true, align: 'center', color: ink, shadow: '#35323a'
    });
  }
  line(cx - 2, 25 + y, cx, 28 + y, '#f5c38a');
  line(cx + 2, 25 + y, cx, 28 + y, '#f5c38a');
  if (full) drawText(pad(Math.round(heading) % 360, 3), cx, 38, {
    size: 8, mono: true, align: 'center', color: '#fff0d7', shadow: '#24212a'
  });
}

function skyFlightLayout() {
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  const s = Math.max(1, 1.5 / unit), narrow = VW < 420;
  const side = narrow ? Math.min(64, (VW - 54) / 2) : 82 * s;
  const resources = narrow ? { x: 8, y: 49, w: VW - 16, h: 20 } : { x: 8, y: 61, w: 112 * s, h: 48 };
  const radar = { x: VW - (narrow ? 33 : 44), y: VH - (narrow ? 76 : 58), r: narrow ? 24 : 34 };
  return { s, narrow, resources, side, speedY: 124, speedH: 37 * s, radar,
    regions: [
      { x: 4, y: 2, w: narrow ? 70 : 124 * s, h: 43 },
      { x: VW - (narrow ? 70 : 124 * s) - 4, y: 2, w: narrow ? 70 : 124 * s, h: 43 },
      resources,
      { x: 6, y: 120, w: side + 4, h: 66 * s },
      { x: VW - side - 10, y: 120, w: side + 4, h: 66 * s },
      { x: 6, y: VH - 45, w: VW - 12, h: 43 },
      { x: radar.x - radar.r - 4, y: radar.y - radar.r - 9, w: radar.r * 2 + 8, h: radar.r * 2 + 16 }
    ] };
}

function skyCompactFlightPanels(l) {
  const p = G.player, { s, narrow, resources: r, side: w, speedY: y } = l;
  const ink = '#fff0d7', muted = '#dcc092', mint = '#b8e0d5';
  const labelSize = narrow ? 8 : 8 * s, small = narrow ? 7 : 7 * s;
  const write = (value, x, y, size = labelSize, color = ink, align = 'left') => drawText(value, x, y, { size, color, align, shadow: '#28212a', mono: !/[㐀-鿿]/.test(String(value)) });
  const box = (x, y, w, h) => panel(x, y, w, h, { fill: '#24212a', stroke: '#9b8055', alpha: .56 });
  box(4, 2, narrow ? 69 : 124 * s, 41);
  box(VW - (narrow ? 73 : 124 * s + 4), 2, narrow ? 69 : 124 * s, 41);
  write(flightMode === 'intercept' ? '截击任务' : '自由巡航', 8, 13, labelSize, muted);
  write(flightMode === 'intercept' ? `第 ${pad(G.wave, 2)} 波` : '秋日湖谷', 8, 27, labelSize);
  if (flightMode === 'intercept') write(`目标 ${G.waveKills}/${G.waveTotal}`, 8, 39, small, muted);
  write('得分', VW - 8, 13, labelSize, muted, 'right');
  write(pad(Math.floor(G.score), 6), VW - 8, 28, narrow ? 11 : 12 * s, ink, 'right');
  write(`T+${fmtTime(G.missionTime)}`, VW - 8, 39, small, muted, 'right');
  box(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
  for (const [i, id] of ['shield', 'fuel'].entries()) {
    const x = r.x + (narrow ? i * (r.w / 2 + 3) : 0), yy = r.y + (narrow ? 8 : 8 + i * 23);
    const width = narrow ? r.w / 2 - 7 : r.w, color = id === 'shield' ? mint : '#f7ce8d';
    write(id === 'shield' ? '护盾' : '燃油', x, yy, labelSize, color);
    write(`${Math.ceil(Math.max(0, p[id]))}%`, x + width, yy, small, color, 'right');
    segBar(x, yy + 4, width, narrow ? 7 : 8, p[id] / 100, color, '#43363d', narrow ? 12 : 20);
  }
  box(6, y, w, l.speedH); box(VW - w - 6, y, w, l.speedH);
  write('空速', 10, y + 8 * s, labelSize, muted);
  write(String(Math.round(p.speed * 1.94384)), w + 2, y + 23 * s, 17 * s, ink, 'right');
  write('节', w + 2, y + 33 * s, labelSize, muted, 'right');
  write('高度', VW - 10, y + 8 * s, labelSize, muted, 'right');
  write(String(Math.round(p.pos.y * 3.28084)), VW - w - 2, y + 23 * s, 17 * s);
  write('英尺', VW - 10, y + 33 * s, labelSize, muted, 'right');
  write('离地', 8, y + 48 * s, labelSize, mint);
  write(String(Math.round(Math.max(0, p.agl) * 3.28084)), w + 2, y + 48 * s, small, mint, 'right');
  write('坡度', 8, y + 60 * s, labelSize, muted);
  const bank = Math.round(-wrapAngle(p.roll + (p.inversionRoll || 0)) / DEG);
  write(`${bank >= 0 ? '右' : '左'} ${Math.abs(bank)}°`, w + 2, y + 60 * s, small, ink, 'right');
  write('升降', VW - w - 2, y + 48 * s, labelSize, muted);
  const vsi = Math.round(p.basis.fwd.y * p.speed * 196.85);
  write(`${vsi >= 0 ? '+' : ''}${vsi}`, VW - 8, y + 48 * s, small, ink, 'right');
  write(`G ${p.gLoad.toFixed(1)}`, VW - 8, y + 60 * s, small, mint, 'right');
}

function skyWeaponStatus(compact = false) {
  const p = G.player, readings = skySystemReadings(p), cx = VW / 2;
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  const scale = compact ? Math.max(1, 1.5 / unit) : 1;
  const size = 8 * scale, width = Math.min(VW - 16, 190 * scale);
  const x = cx - width / 2, y = VH - (compact ? (scale > 1 ? 55 : 45) : 57);
  if (compact) panel(x - 3, y - 10, width + 6, VH - y + 5, { alpha: .50, fill: '#24212a', stroke: '#9b8055', border: false });
  for (const [index, xx] of [[2, x], [4, cx + 7]]) {
    const [tag, value, state] = readings[index], color = state === 'active' ? '#ffd18d' : '#e4d8bd';
    drawText(tag, xx, y, { size, color: '#dcc092', shadow: '#28212a' });
    drawText(value, xx + 25 * scale, y, { size, color, shadow: '#28212a' });
  }
  if (compact) {
    const yy = VH - 36, iconScale = Math.min(scale, 1.2, (width - 83 * scale) / 48);
    drawText('导弹', x, yy + 9, { size, color: '#dcc092', shadow: '#28212a' });
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(x + 25 * scale + i * 11 * iconScale, yy - 4); ctx.scale(iconScale, iconScale);
      const load = i === p.missiles && p.reloads.length ? clamp01(1 - p.reloads[0] / MISSILE_RELOAD) : 0;
      drawMissilePip(0, 0, i < p.missiles, load); ctx.restore();
    }
    drawText(readings[3][1], cx + 18 * scale, yy + 9, { size: 7 * scale, mono: true, color: '#fff0d7', shadow: '#28212a' });
    drawText('干扰', x, VH - 8, { size, color: '#dcc092', shadow: '#28212a' });
    drawText(readings[5][1], x + 25 * scale, VH - 8, { size: 7 * scale, mono: true, color: '#fff0d7', shadow: '#28212a' });
  } else {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, VW, VH - 15); ctx.clip(); ctx.translate(0, -8); drawWeaponPips(); ctx.restore();
    if (p.reloads.length) drawText(readings[3][1], cx - 17, VH - 4, { size: 7, mono: true, color: '#e4d8bd', shadow: '#28212a', align: 'center' });
    if (p.flareCd > .1) drawText(readings[5][1], cx + 63, VH - 4, { size: 7, mono: true, color: '#e4d8bd', shadow: '#28212a', align: 'center' });
  }
}

hudBlocked = (x, y) => {
  const external = G.cockpitAlpha < .45 && G.mode !== 'title';
  if (external && !skyCompactHUD() && skyBaseHudBlocked(x, y)) return true;
  if (external && skyCompactHUD() && skyFlightLayout().regions.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) return true;
  return (Math.abs(x - VW / 2) < Math.min(94, VW * .25) && y < 40)
    || SKY_OCCLUSION.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
};

drawHUD = function () {
  if (!G.player || !G.camera) return;
  const scenic = skyScenicView(), top = G.view === 0 && G.viewBlend > .55;
  const cockpit = G.cockpitAlpha > .5, external = G.cockpitAlpha < .45;
  if (!top) drawPitchLadder(G.cockpitAlpha);
  if (top) {
    const x = VW / 2;
    drawText('N', x, 15, { size: 7, mono: true, align: 'center', color: '#fff0d7', shadow: '#35323a' });
    line(x - 3, 23, x, 19, '#f5c38a'); line(x + 3, 23, x, 19, '#f5c38a');
  } else skyHeadingTape(external);
  if (flightMode === 'intercept' && !cockpit) drawTargetMarkers();
  if (external) {
    const compact = skyCompactHUD();
    if (compact) {
      const layout = skyFlightLayout();
      skyCompactFlightPanels(layout);
      const r = layout.radar; drawRadarScope(r.x, r.y, r.r, false);
    } else {
      if (flightMode === 'intercept') drawObjectivesPanel();
      else {
        panel(6, 2, 116, 54, { alpha: .38, fill: '#24212a', border: false });
        drawText('自由巡航', 10, 19, { size: 10, color: '#ead3ab', shadow: '#28212a' });
        drawText('秋日湖谷', 10, 35, { size: 10, color: '#fff0d7', shadow: '#28212a' });
        drawText('无战斗目标', 10, 49, { size: 8, color: '#b8ded2', shadow: '#28212a' });
      }
      drawScorePanel(); drawSpeedAlt(); drawShieldFuel(); drawMiniRadar();
    }
    skyWeaponStatus(compact);
  }
  if (scenic) for (const x of [4, VW - 4]) for (const y of [4, VH - 4]) {
    line(x, y, x + (x === 4 ? 4 : -4), y, '#ffe7c6', 1, .45);
    line(x, y, x, y + (y === 4 ? 4 : -4), '#ffe7c6', 1, .45);
  }
  if (flightMode === 'intercept') {
    ctx.save();
    if (cockpit) { ctx.beginPath(); ctx.rect(0, 0, VW, VH - 99); ctx.clip(); drawTargetMarkers(); }
    if (!cockpit) drawAimReticle();
    drawThreats();
    ctx.restore();
  }
  drawWarnings();
  if (G.banner && G.banner.t < G.banner.life && G.mode === 'play') {
    const alpha = Math.min(clamp01(G.banner.t / 0.4), clamp01((G.banner.life - G.banner.t) / 0.6));
    const y = hudBlocked(VW / 2, 49) ? 124 : 49;
    drawText(G.banner.title, VW / 2, y, { size: 10, align: 'center', color: '#ffe2bb', shadow: '#24232c', alpha });
  }
  if ((G.mode === 'play' || G.mode === 'waveclear') && (!INPUT.touchMode || TOUCH.active)
      && (!(scenic || top) || TOUCH.active || INPUT.mouseSteerAge < MOUSE_STEER_TIMEOUT)
      && (!cockpit || Math.hypot(INPUT.mx - VW/2, INPUT.my - VH/2) > 9)) {
    drawMousePip(INPUT.mx, INPUT.my, '#e7eadc');
  }
};

drawTitle = function () { skyHeadingTape(); };

drawLoading = function () {
  rect(0, 0, VW, VH, '#263440');
  rect(0, VH * 0.6, VW, VH * 0.4, '#1b2a31');
  const w = Math.min(220, VW * 0.6), x = (VW - w) / 2, y = VH * 0.69;
  drawText(BOOT.error ? '无法起飞' : '准备飞行', VW / 2, y - 15, {
    size: 14, color: '#f6e7d3', align: 'center', bold: true
  });
  rect(x, y, w, 2, '#4a535a');
  rect(x, y, w * clamp01(BOOT.progress), 2, '#f1bd83');
  drawText(BOOT.error ? '请查看页面上方提示' : (BOOT.stage || '初始化'), VW / 2, y + 17, {
    size: 9, color: '#c3cbc9', align: 'center'
  });
};

drawWaveClear = function () {
  const w = Math.min(230, VW - 28), x = (VW - w) / 2;
  panel(x, 39, w, 36, { fill: '#202328', stroke: '#b8a18c', alpha: 0.88 });
  drawText(`第 ${pad(G.wave, 2)} 波完成`, VW / 2, 53, { size: 11, align: 'center', color: '#f6e5cb' });
  drawText(`补给中 · ${Math.max(0, Math.ceil(G.respite))} 秒后继续`, VW / 2, 67, {
    size: 9, align: 'center', color: '#c5d5cb'
  });
};

drawPause = function () { rect(0, 0, VW, VH, 'rgba(15,18,23,0.38)'); };
drawFailed = function () { rect(0, 0, VW, VH, 'rgba(20,16,22,0.52)'); };

drawTouchControls = function () {
  if (!G.player || !TOUCH.active) return;
  circleLine(TOUCH.startX, TOUCH.startY, 22, '#e7eadc', 0.28);
  circleLine(TOUCH.x, TOUCH.y, 14, '#e7eadc', 0.55);
  circleFill(TOUCH.x, TOUCH.y, 2, '#f8e9cf', 0.8);
};

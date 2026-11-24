// 完整飞行HUD复用初版仪表；DOM保留菜单、按钮和无障碍读数。
// 本文件在60_main前载入，BOOT只能在稍后执行的绘制函数中读取。
const SKY_OCCLUSION = [];
const skyBaseHudBlocked = hudBlocked;
const SKY_LOCKING_COLOR = '#b9ddff';
const SKY_TRACKING_COLOR = '#e4e9e5';
function skyCompactHUD() {
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  return VW < 420 || unit < 1.2;
}
function skyScenicView() {
  return !!G.skyScenic && (G.view === 0 || G.view === 1 && G.skyScenic.oblique);
}

function skyWaveTitle(compact = false) {
  if (!(G.missionWaveGoal > 0)) return `第 ${pad(G.wave, 2)} 波`;
  if (G.defenseStage) return `第 ${G.wave}/${G.missionWaveGoal} 关`;
  const wave = compact ? G.wave : pad(G.wave, 2);
  const goal = compact ? G.missionWaveGoal : pad(G.missionWaveGoal, 2);
  return `第 ${wave}/${goal} 波`;
}

function skyDefenseArmorStatus() {
  if (!G.defenseStage?.air.includes('transport')) return '';
  const remaining = G.ground.filter(g => !g.dead).length;
  if (remaining) return `剩余 ${remaining}`;
  return G.enemies.some(e => !e.dead && e.cargoRemaining > 0) ? '待空投' : '已清除';
}

function skyActiveBanner() {
  return G.mode === 'play' && G.banner && G.banner.t < G.banner.life ? G.banner : null;
}

function skyBannerLayout(banner) {
  const wave = skyWaveTitle(skyCompactHUD());
  const title = G.defenseStage ? `${wave} · ${G.defenseStage.title}`
    : flightMode === 'intercept' && G.missionWaveGoal > 0 ? wave : banner.title;
  const size = 10;
  const box = skyMessageBox(textWidth(title, size) + 4, size + 4, [41, 113, 135, 98, 69, VH / 2 + 30]);
  return box && { title, size, y: box.y + size + 1, box };
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
  const armor = !!G.defenseStage?.air.includes('transport');
  const cardWidth = narrow ? 69 : 124 * s, missionHeight = armor ? 54 : 41;
  const resources = narrow ? { x: 8, y: missionHeight + 8, w: VW - 16, h: 20 } : { x: 8, y: 61, w: 112 * s, h: 48 };
  const radar = { x: VW - (narrow ? 33 : 44), y: VH - (narrow ? 76 : 58), r: narrow ? 24 : 34 };
  return { s, narrow, resources, side, speedY: 124, speedH: 37 * s, radar, cardWidth, missionHeight,
    regions: [
      { x: 4, y: 2, w: cardWidth + 1, h: missionHeight + 2 },
      { x: VW - (narrow ? 70 : 124 * s) - 4, y: 2, w: narrow ? 70 : 124 * s, h: 43 },
      resources,
      { x: 6, y: 120, w: side + 4, h: 66 * s },
      { x: VW - side - 10, y: 120, w: side + 4, h: 66 * s },
      skyWeaponLayout(true).region,
      { x: radar.x - radar.r - 4, y: radar.y - radar.r - 9, w: radar.r * 2 + 8, h: radar.r * 2 + 16 }
    ] };
}

function skyCompactFlightPanels(l) {
  const p = G.player, { s, narrow, resources: r, side: w, speedY: y, cardWidth, missionHeight } = l;
  const ink = '#fff0d7', muted = '#dcc092', mint = '#b8e0d5';
  const labelSize = narrow ? 8 : 8 * s, small = narrow ? 7 : 7 * s;
  const write = (value, x, y, size = labelSize, color = ink, align = 'left') => drawText(value, x, y, { size, color, align, shadow: '#28212a', mono: !/[㐀-鿿]/.test(String(value)) });
  const box = (x, y, w, h) => panel(x, y, w, h, { fill: '#24212a', stroke: '#9b8055', alpha: .56 });
  const titleY = Math.max(13, labelSize + 4), waveY = Math.max(27, titleY + labelSize + 2);
  box(4, 2, cardWidth, missionHeight);
  box(VW - cardWidth - 4, 2, cardWidth, 41);
  write(flightMode === 'intercept' ? (G.defenseStage?.title || '截击任务') : '自由巡航', 8, titleY, labelSize, muted);
  write(flightMode === 'intercept' ? skyWaveTitle(true) : '秋日湖谷', 8, waveY, labelSize);
  if (flightMode === 'intercept') {
    write(`${G.defenseStage ? '空中' : '目标'} ${G.waveKills}/${G.waveTotal}`, narrow ? 8 : cardWidth, narrow ? 39 : waveY, small, muted, narrow ? 'left' : 'right');
    const armor = skyDefenseArmorStatus();
    if (armor) write(`装甲 ${armor}`, 8, narrow ? 51 : waveY + labelSize + 2, small, mint);
  }
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

function skyWeaponLayout(compact = skyCompactHUD()) {
  const cx = VW / 2;
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  const scale = compact ? Math.max(1, 1.5 / unit) : 1;
  const size = 8 * scale, width = Math.min(VW - 16, 190 * scale);
  const x = cx - width / 2, y = VH - (compact ? (scale > 1 ? 55 : 45) : 57);
  const top = Math.min(y - 10, y - size - 2);
  return { cx, scale, size, width, x, y, region: { x: x - 3, y: top, w: width + 6, h: VH - top } };
}

function skyWeaponStatus(compact = false) {
  const p = G.player, readings = skySystemReadings(p);
  const { cx, scale, size, width, x, y } = skyWeaponLayout(compact);
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
  if (external && !skyCompactHUD()) {
    const r = skyWeaponLayout(false).region;
    if (skyBaseHudBlocked(x, y) || x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  if (external && skyCompactHUD() && skyFlightLayout().regions.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) return true;
  return (Math.abs(x - VW / 2) < Math.min(94, VW * .25) && y < 40)
    || SKY_OCCLUSION.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
};

const skyProjectTargetMarker = projectTargetMarker, skyDrawEdgeCue = drawEdgeCue;

const skyHudBounds = r => ({ left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h });
const skyHudOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function skyFixedHudRegions() {
  const heading = Math.min(94, VW * .25);
  const blocked = [{ left: VW / 2 - heading, right: VW / 2 + heading, top: 0, bottom: 40 }, ...SKY_OCCLUSION.map(skyHudBounds)];
  if (G.cockpitAlpha >= .45) return blocked;
  if (skyCompactHUD()) blocked.push(...skyFlightLayout().regions.map(skyHudBounds));
  else blocked.push(...hudRegions(), skyHudBounds(skyWeaponLayout(false).region));
  return blocked;
}

function skyHudWarningRegions() {
  const blocked = [], p = G.player, cx = VW / 2;
  const warn = (top, bottom, x = cx, halfWidth = cx) => blocked.push({ left: x - halfWidth, right: x + halfWidth, top, bottom });
  if (G.threatList?.length) warn(80, 108);
  if (p.shield < 25) warn(108, 123);
  if (p.fuel < 18) warn(121, 135);
  const y = VH - (G.cockpitAlpha > .4 ? 112 : 44);
  if (p.terrainWarn && G.mode === 'play') warn(y - 16, y + 4, cx, textWidth('拉起！', 14, false, true) / 2 + 3);
  if (p.agl < 90 && G.mode === 'play') warn(y - 28, y - 13, cx, textWidth('低空', 10) / 2 + 2);
  if (p.inCloud > .28 || p.skimming) warn(y - 22, y - 7, cx + 70, textWidth('云中', 10) / 2 + 2);
  return blocked;
}

function skyMessageBox(w, h, rows, extra = []) {
  const blocked = [...skyFixedHudRegions(), ...skyHudWarningRegions(), ...extra.map(skyHudBounds)];
  const x = (VW - w) / 2;
  if (x < 2) return null;
  for (const y of rows) {
    const box = { x, y, w, h };
    const bounds = skyHudBounds(box);
    if (!blocked.some(r => skyHudOverlap(bounds, r))) return box;
  }
  return null;
}

function skyLockStatus(target) {
  if (G.lock.target !== target) return '';
  if (G.lock.phase === 'locked') return '已锁定';
  if (G.lock.phase === 'locking') return `锁定中 ${Math.floor(G.lock.progress * 100)}%`;
  return '';
}

function skyCockpitTrackTarget() {
  const p = G.player;
  const visible = target => target && G.enemies.includes(target) && !target.dead
    && vdist(p.pos, target.pos) <= 3400 && !targetConcealed(target) && lineOfSightClear(p.pos, target.pos, 10);
  const locked = G.lock.phase === 'locked' ? G.lock.target : null;
  const locking = G.lock.phase === 'locking' ? G.lock.target : null;
  for (const target of [locked, p.trackedAirTarget, locking]) if (visible(target)) return target;
  let nearest = null, range = Infinity;
  for (const target of G.enemies) {
    const distance = vdist(p.pos, target.pos);
    if (distance < range && visible(target)) { nearest = target; range = distance; }
  }
  return nearest;
}

function skyCleanupTarget() {
  if (!G.defenseStage || G.mode !== 'play' || G.waveKills < G.waveTotal) return null;
  let nearest = null, range = Infinity;
  for (const armor of G.ground) {
    if (armor.dead) continue;
    const distance = vdist(G.player.pos, armor.pos);
    if (distance < range) { nearest = armor; range = distance; }
  }
  return nearest;
}

function skyTrackLabel(target) {
  const p = G.player, relative = vsub(target.pos, p.pos), range = vdist(target.pos, p.pos);
  const bearing = wrapAngle(Math.atan2(relative.x, -relative.z) - p.yaw) / DEG;
  const angle = Math.abs(bearing), side = bearing < 0 ? '左' : '右';
  let direction = '正前';
  if (angle > 178) direction = '正后';
  else if (angle > 112.5) direction = `${side}后`;
  else if (angle > 67.5) direction = `${side}方`;
  else if (angle > 10) direction = `${side}前`;
  if (Math.hypot(relative.x, relative.z) < 1) direction = '';
  const altitude = Math.abs(relative.y) < 5 ? '同高' : `${relative.y > 0 ? '高' : '低'} ${Math.round(Math.abs(relative.y))} m`;
  const rangeLabel = range >= 1000 ? `${(range / 1000).toFixed(1)} km` : `${Math.round(range)} m`;
  if (target.isGround) return ['装甲', direction, rangeLabel].filter(Boolean).join(' · ');
  const status = skyLockStatus(target) || '跟踪';
  const type = G.defenseStage ? ` ${defenseContactName(target)}` : '';
  return [status + type, direction, altitude, rangeLabel].filter(Boolean).join(' · ');
}

function skyTrackingLayout(target, blocked) {
  const label = skyTrackLabel(target);
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  const size = Math.max(8, 14 / unit);
  const box = skyMessageBox(textWidth(label, size) + 12, size + 6, [56, VH / 2 + 7, 137, 109, VH / 2 + 26], blocked);
  return box && { label, size, box };
}

function drawSkyMessage(message, color) {
  const { label, size, box: { x, y, w, h } } = message;
  panel(x, y, w, h, { fill: '#18252e', alpha: .83, stroke: '#536571' });
  drawText(label, VW / 2, y + size + 2, { size, color, align: 'center', shadow: '#101820' });
}

function skyDefenseCombatLayout(blocked) {
  if (!G.defenseStage) return null;
  const flare = G.enemies.filter(e => !e.dead && e.flareFlash > 0)
    .sort((a, b) => vdist(a.pos, G.player.pos) - vdist(b.pos, G.player.pos))[0];
  let label = '', color = '';
  if (flare) {
    const success = flare.flareOutcome !== 'failed';
    const remaining = Number.isFinite(flare.flares) ? ` · 剩${flare.flares}发` : '';
    label = success ? `${defenseContactName(flare)}诱饵成功${remaining} · 用机炮` : `${defenseContactName(flare)}干扰失败${remaining} · 导弹继续`;
    color = success ? '#ffd495' : '#b9f0d2';
  } else if (G.lock.target && !G.lock.target.dead && G.lock.target.tacticPhase === 'warning') {
    label = `${defenseContactName(G.lock.target)}准备脱离 · 用机炮咬住`;
    color = '#ffdf9b';
  }
  if (!label) return null;
  const size = Math.max(8, 14 / (cssRect.height / VH));
  const box = skyMessageBox(textWidth(label, size) + 12, size + 6, [83, 110, 137, VH / 2 + 7], blocked);
  return box && { label, size, box, color };
}

function skyDefenseTargetReadouts(messages, cockpitBottom) {
  const blocked = [...skyFixedHudRegions(), ...skyHudWarningRegions(), ...messages.map(skyHudBounds)];
  if (cockpitBottom != null) for (const readout of skyGlassReadouts(G.player)) {
    blocked.push(skyHudBounds({ x: readout.x - 2, y: readout.y - 1, w: readout.w + 4, h: readout.h + readout.unitSize + 3 }));
    const w = textWidth(readout.aux, 6, true) + 4;
    blocked.push(skyHudBounds({ x: readout.center - w / 2, y: VH / 2 + 20, w, h: 10 }));
  }
  let lockBox = null;
  return (target, { x, y, r, d, col, isLock, isTracked }) => {
    const marker = isLock ? (G.player.lockRadius ? 22 : 41) : r + 2;
    if (isLock) {
      lockBox = { left: x - marker, right: x + marker, top: y - marker, bottom: y + marker };
      blocked.push(lockBox);
    } else if (lockBox && skyHudOverlap(lockBox, { left: x - r, right: x + r, top: y - r, bottom: y + r })) {
      return;
    }
    const range = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    const decoys = G.defenseRules && !target.isGround && Number.isFinite(target.flares) ? ` · 干扰${target.flares}` : '';
    const label = isTracked ? '' : `${isLock ? skyLockStatus(target) + ' ' : ''}${defenseContactName(target)}${decoys} · ${range}`;
    const air = !target.isGround, size = isLock ? 10 : 9;
    const h = (label ? size + 4 : 0) + (air ? 8 : 0);
    if (!h) return;
    const w = Math.max(air ? 46 : 0, textWidth(label, size) + 4);
    const cx = clamp(x, w / 2 + 2, VW - w / 2 - 2);
    const above = y - marker - h - 3, below = y + marker + 3;
    const positions = isLock && label ? [[cx, below], [cx, above], [x + marker + w / 2 + 4, y - h / 2], [x - marker - w / 2 - 4, y - h / 2]]
      : [[cx, above], [cx, below]];
    for (const [center, top] of positions) {
      const box = { left: center - w / 2, right: center + w / 2, top, bottom: top + h };
      if (top < 2 || box.bottom > (cockpitBottom ?? VH) || box.left < 2 || box.right > VW - 2
          || blocked.some(region => skyHudOverlap(box, region))) continue;
      if (air) drawTargetHealth(target, center - 21, top + 1);
      if (label) drawText(label, center, box.bottom - 3, { size, color: col, align: 'center', shadow: '#0b0912' });
      blocked.push(box);
      return;
    }
  };
}

let skyTopCueCache = null;
function skyTopCueLayout() {
  const unit = typeof cssRect === 'object' && cssRect.height ? cssRect.height / VH : 2;
  const occlusion = SKY_OCCLUSION.map(r => `${r.x},${r.y},${r.w},${r.h}`).join(';');
  const banner = skyActiveBanner();
  const stamp = [G.time, G.camera, VW, VH, unit, G.lock.target, G.lock.phase, occlusion, banner];
  if (skyTopCueCache && stamp.every((v, i) => v === skyTopCueCache.stamp[i])) return skyTopCueCache.layout;
  const layout = new Map(), occupied = [], cx = VW / 2, cy = VH / 2, size = Math.max(8, 14 / unit);
  const intersects = (a, b) => a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
  const blocked = skyFixedHudRegions(), messages = [];
  const entry = banner && skyBannerLayout(banner);
  if (entry) messages.push(entry.box);
  const cleanup = skyCleanupTarget(), navigation = cleanup && skyTrackingLayout(cleanup, messages);
  if (navigation) messages.push(navigation.box);
  const flare = skyDefenseCombatLayout(messages);
  if (flare) messages.push(flare.box);
  blocked.push(...messages.map(skyHudBounds));
  const free = b => !occupied.some(other => intersects(b, other))
    && !blocked.some(r => b.x - 2 < r.right && b.x + b.w + 2 > r.left && b.y - 2 < r.bottom && b.y + b.h + 2 > r.top);
  occupied.push({ x: cx - 20, y: cy - 24, w: 40, h: 48 });
  const targets = collectTargets().filter(t => vdist(G.player.pos, t.pos) <= 3400 && !targetConcealed(t));
  targets.sort((a, b) => vdist(G.player.pos, a.pos) - vdist(G.player.pos, b.pos));
  for (const target of targets) {
    const s = {};
    if (!skyProjectTargetMarker({ x: target.pos.x, y: target.pos.y + (target.isGround ? 2 : 1.2), z: target.pos.z }, s, target) || !s.edge) continue;
    const d = vdist(G.player.pos, target.pos), angle = Math.atan2(s.y - cy, s.x - cx);
    const selected = target === G.lock.target && G.lock.phase !== 'search';
    const type = defenseContactName(target);
    const lockText = G.defenseStage ? ` ${type}` : '';
    const name = selected ? `${G.lock.phase === 'locked' ? '已锁定' : '锁定中'}${lockText}` : type;
    const distance = d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    const label = `${name} ${distance}`;
    // 给锁定文案预留宽度，获取锁定不能令提示搬家、离开当前瞄准点。
    const w = Math.max(textWidth(label, size), textWidth(`锁定中${lockText} ${distance}`, size)) + 20, h = size + 8;
    let placed = null;
    // 沿真实方位优先向内避让，同向多个目标分开占位；箭头本身始终指真实方位。
    for (let turn = 0; turn < 38 && !placed; turn++) {
      const offset = turn ? Math.ceil(turn / 2) * .16 * (turn % 2 ? 1 : -1) : 0;
      const dx = Math.cos(angle + offset), dy = Math.sin(angle + offset);
      const edge = Math.min((cx - w / 2 - 5) / Math.max(.001, Math.abs(dx)), (cy - h / 2 - 5) / Math.max(.001, Math.abs(dy)));
      for (let inward = 0; inward < edge; inward += 4) {
        const box = { x: cx + dx * (edge - inward) - w / 2, y: cy + dy * (edge - inward) - h / 2, w, h };
        if (free(box)) { placed = { ...box, angle, size, label, selected }; break; }
      }
    }
    if (placed) { layout.set(target, placed); occupied.push(placed); }
  }
  skyTopCueCache = { stamp, layout };
  return layout;
}

projectTargetMarker = function (pos, s, target) {
  delete s.skyCue;
  const projected = skyProjectTargetMarker(pos, s, target);
  if (projected && s.edge && target && G.view === 0 && G.viewBlend >= 1) {
    const cue = skyTopCueLayout().get(target);
    if (cue) { s.x = cue.x + cue.w / 2; s.y = cue.y + cue.h / 2; s.skyCue = cue; }
  }
  return projected;
};

drawEdgeCue = function (s, d, target, lockingColor = SKY_LOCKING_COLOR) {
  const cue = s.skyCue;
  if (!cue || G.view !== 0) return skyDrawEdgeCue(s, d, target, lockingColor);
  const color = cue.selected ? (G.lock.phase === 'locked' ? PAL.goldHot : SKY_LOCKING_COLOR) : '#ffb2a3';
  ctx.save();
  ctx.globalAlpha = .96;
  ctx.translate(cue.x + 7, cue.y + cue.h / 2); ctx.rotate(cue.angle);
  ctx.fillStyle = color; ctx.strokeStyle = '#201820'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.restore();
  drawText(cue.label, cue.x + 17, cue.y + cue.size + 3, { size: cue.size, color, alpha: 1, shadow: '#16131b' });
};

function skyGunLeadMarker() {
  const target = G.lock.target;
  if (!G.player.gunEffectiveRange || G.lock.phase !== 'locked' || !target) return;
  const point = playerGunLead(target), lead = {}, contact = {};
  if (!point || !projectToScreen(point, lead) || !lead.visible || !projectToScreen(target.pos, contact)) return;
  if (Math.hypot(lead.x-contact.x,lead.y-contact.y) < 3 || hudBlocked(lead.x,lead.y)) return;
  line(contact.x,contact.y,lead.x,lead.y,'#b9ddff',1,.6);
  circleLine(lead.x,lead.y,4,'#b9ddff',.95);
  line(lead.x-7,lead.y,lead.x-4,lead.y,'#b9ddff'); line(lead.x+4,lead.y,lead.x+7,lead.y,'#b9ddff');
}

drawHUD = function () {
  if (!G.player || !G.camera) return;
  const scenic = skyScenicView(), top = G.view === 0 && G.viewBlend > .55;
  const cockpit = G.cockpitAlpha > .5, external = G.cockpitAlpha < .45;
  const intercept = flightMode === 'intercept', bottom = cockpit ? skyCockpitPanelTop() - 7 : undefined;
  const banner = skyActiveBanner(), entry = banner && skyBannerLayout(banner);
  const messages = entry ? [entry.box] : [];
  const tracked = intercept && (skyCleanupTarget() || (cockpit ? skyCockpitTrackTarget() : null));
  const tracking = tracked && skyTrackingLayout(tracked, messages);
  if (tracking) messages.push(tracking.box);
  const flare = intercept && skyDefenseCombatLayout(messages);
  if (flare) messages.push(flare.box);
  const drawReadout = intercept && G.defenseStage ? skyDefenseTargetReadouts(messages, bottom) : undefined;
  if (!top && !cockpit) drawPitchLadder(G.cockpitAlpha);
  if (top) {
    const x = VW / 2;
    drawText('N', x, 15, { size: 7, mono: true, align: 'center', color: '#fff0d7', shadow: '#35323a' });
    line(x - 3, 23, x, 19, '#f5c38a'); line(x + 3, 23, x, 19, '#f5c38a');
  } else skyHeadingTape(external);
  if (intercept && !cockpit) drawTargetMarkers(SKY_LOCKING_COLOR, undefined, drawReadout);
  if (!cockpit) drawWingmanMarker({ bottom });
  if (external) {
    const compact = skyCompactHUD();
    if (compact) {
      const layout = skyFlightLayout();
      skyCompactFlightPanels(layout);
      const r = layout.radar; drawRadarScope(r.x, r.y, r.r, false);
    } else {
      if (flightMode === 'intercept') drawObjectivesPanel(skyWaveTitle(), skyDefenseArmorStatus());
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
  if (intercept) {
    let color = SKY_TRACKING_COLOR;
    if (cockpit) {
      if (tracked && skyLockStatus(tracked)) color = G.lock.phase === 'locked' ? PAL.goldHot : SKY_LOCKING_COLOR;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, VW, bottom); ctx.clip();
      drawTargetMarkers(SKY_LOCKING_COLOR, { bottom, target: tracking && tracked, color }, drawReadout);
      drawWingmanMarker({ bottom });
      ctx.restore();
    } else drawAimReticle(SKY_LOCKING_COLOR);
    skyGunLeadMarker();
    if (tracking) drawSkyMessage(tracking, color);
    if (flare) drawSkyMessage(flare, flare.color);
    drawThreats();
  }
  drawWarnings();
  if (entry) {
    const alpha = Math.min(clamp01(banner.t / 0.4), clamp01((banner.life - banner.t) / 0.6));
    const { title, size, y } = entry;
    drawText(title, VW / 2, y, { size, align: 'center', color: '#ffe2bb', shadow: '#24232c', alpha });
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
  const box = skyMessageBox(Math.min(230, VW - 28), 36, [41, 111, 137, VH / 2 + 17]);
  if (!box) return;
  panel(box.x, box.y, box.w, box.h, { fill: '#202328', stroke: '#b8a18c', alpha: 0.88 });
  drawText(`${skyWaveTitle(skyCompactHUD())}完成`, VW / 2, box.y + 14, { size: 11, align: 'center', color: '#f6e5cb' });
  drawText(`补给中 · ${Math.max(0, Math.ceil(G.respite))} 秒后继续`, VW / 2, box.y + 28, {
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

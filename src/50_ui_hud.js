// ---------------------------------------------------------------------------
// UI: world-space overlay, HUD, pixel cockpit.
// All coordinates are in logical VW x 340 space and are drawn with hard pixels.
// ---------------------------------------------------------------------------
const RADAR = { canvas: null, rctx: null, lastT: -10, lastX: 1e9, lastZ: 1e9 };

function addHit(x, y, w, h, onDown, onUp) {
  INPUT.uiHits.push({ x, y, w, h, onDown, onUp });
}

function panel(x, y, w, h, o = {}) {
  ctx.save();
  ctx.globalAlpha *= (o.alpha === undefined ? 0.82 : o.alpha);
  ctx.fillStyle = o.fill || 'rgba(15,12,24,0.92)';
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  if (o.border !== false) {
    ctx.strokeStyle = o.stroke || '#6a5743';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }
  if (o.corners) {
    const c = o.corners === true ? (o.stroke || '#d5a955') : o.corners;
    ctx.fillStyle = c;
    const s = 3;
    ctx.fillRect(Math.round(x), Math.round(y), s, 1);
    ctx.fillRect(Math.round(x), Math.round(y), 1, s);
    ctx.fillRect(Math.round(x + w - s), Math.round(y), s, 1);
    ctx.fillRect(Math.round(x + w - 1), Math.round(y), 1, s);
    ctx.fillRect(Math.round(x), Math.round(y + h - 1), s, 1);
    ctx.fillRect(Math.round(x), Math.round(y + h - s), 1, s);
    ctx.fillRect(Math.round(x + w - s), Math.round(y + h - 1), s, 1);
    ctx.fillRect(Math.round(x + w - 1), Math.round(y + h - s), 1, s);
  }
  ctx.restore();
}

function segBar(x, y, w, h, frac, color, bg = '#2a2030', segs = 20) {
  frac = clamp01(frac);
  rect(x, y, w, h, bg);
  rectLine(x, y, w, h, '#0b0912', 0.9);
  const on = Math.round(frac * segs);
  for (let i = 0; i < on; i++) {
    const sx = x + 1 + Math.floor(i * (w - 2) / segs);
    const sw = Math.max(1, Math.floor((w - 2) / segs) - (segs > 12 ? 1 : 0));
    rect(sx, y + 1, sw, h - 2, color);
  }
}

function drawButton(x, y, w, h, label, onDown, o = {}) {
  const hover = INPUT.mx >= x && INPUT.mx < x + w && INPUT.my >= y && INPUT.my < y + h;
  const fill = o.danger ? '#3a1718' : (hover ? '#3a3042' : '#201a2a');
  const stroke = o.danger ? '#ff6f5e' : (hover ? '#ffd67a' : '#8a6f47');
  panel(x, y, w, h, { fill, stroke, alpha: o.alpha === undefined ? 0.94 : o.alpha, corners: true });
  drawText(label, x + w / 2, y + h / 2 + (o.size || 8) / 2 - 1, {
    size: o.size || 8, color: o.color || PAL.cream, align: 'center',
    spacing: o.spacing || 0, bold: o.bold
  });
  if (o.sub) drawText(o.sub, x + w / 2, y + h - 3, { size: 5, color: '#b09a72', align: 'center' });
  if (onDown) addHit(x, y, w, h, onDown, o.onUp);
}

// 8x15 mini missile silhouette for the weapon bar / title strip
function drawMissilePip(x, y, ready, loadFrac = 0) {
  rect(x, y, 8, 15, '#171220');
  rectLine(x, y, 8, 15, ready ? '#d5a955' : '#4b4052');
  const body = ready ? '#e5c273' : '#4a4050';
  const nose = ready ? '#e0664f' : '#5a3038';
  const fin = ready ? '#b59a55' : '#3c3444';
  // seeker cone
  rect(x + 3, y + 1, 2, 1, nose);
  rect(x + 2, y + 2, 4, 1, nose);
  // airframe + highlight
  rect(x + 2, y + 3, 4, 6, body);
  rect(x + 3, y + 3, 1, 5, ready ? '#fff0bb' : '#5a5060');
  // tail fins
  rect(x + 1, y + 9, 1, 2, fin);
  rect(x + 6, y + 9, 1, 2, fin);
  rect(x + 2, y + 9, 1, 1, fin);
  rect(x + 5, y + 9, 1, 1, fin);
  if (ready) {
    rect(x + 3, y + 11, 2, 2, '#ff9a3d');
    rect(x + 3, y + 13, 1, 1, '#fff0bb');
  } else if (loadFrac > 0) {
    const fh = Math.round(10 * clamp01(loadFrac));
    rect(x + 2, y + 14 - fh, 4, fh, '#5a4a2a');
  }
}

function drawMousePip(mx, my, color = PAL.paleCyan) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  const x = Math.round(mx), y = Math.round(my);
  ctx.fillStyle = '#0b0912';
  ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x - 4, y, 2, 1); ctx.fillRect(x + 3, y, 2, 1);
  ctx.fillRect(x, y - 4, 1, 2); ctx.fillRect(x, y + 3, 1, 2);
  ctx.restore();
}

// --------------------------------------------------------- world overlay ----
function pxPerM(dist) { return screenPixelPerMetre(dist); }

function shadowVisible(ground) {
  if (!G.player) return true;
  // approximate: if clouds sit between the aircraft and its shadow, skip it
  const mid = vlerp(G.player.pos, ground, 0.5);
  return G.map.cloudDensity(mid.x, mid.y, mid.z) < 0.22;
}

// 世界特效和焦痕画在 2D 覆盖层上，没有深度缓冲。先剔除被机体或山体挡住的部分，
// 否则导弹落点的焦痕会盖在机身上，看起来像武器从机背穿出来。
// 挖空轮廓取机鼻、双翼尖和机尾的实际投影，跟着本帧滚转与俯视偏航走；固定椭圆
// 在机翼外侧或长机身前留空，仍会漏出压在机身上的像素。翼尖按真实后掠取到翼面
// 最后缘（模型 z≈1.78 → 机身前向 -1.9），否则翼尖后缘一窄条会漏画。
const PLAYER_HULL = [[6.59, 0], [-1.9, 4.9], [-4.3, 0], [-1.9, -4.9]];
let playerOccluderCache = { time: null, view: -1, value: null };
function playerOccluder() {
  const p = G.player;
  if (!p || p.dead || G.view === 2 || (G.cockpitAlpha ?? 0) > 0.6) return null;
  if (playerOccluderCache.time === G.time && playerOccluderCache.view === G.view) return playerOccluderCache.value;
  const b = p.renderBasis || p.basis, ps = {}, pts = [];
  if (!projectToScreen(p.pos, ps) || !ps.visible) { playerOccluderCache = { time: G.time, view: G.view, value: null }; return null; }
  for (const [fwd, right] of PLAYER_HULL) {
    const pos = vadd(vadd(p.pos, vmul(b.fwd, fwd)), vmul(b.right, right)), s = {};
    if (!projectToScreen(pos, s)) { pts.length = 0; break; }
    pts.push({ x: s.x, y: s.y });
  }
  const value = pts.length === 4
    ? { poly: pts, dist: ps.dist }
    : { x: ps.x, y: ps.y, dist: ps.dist, rx: Math.max(12, 5.6 * pxPerM(ps.dist)), ry: Math.max(8, 2.1 * pxPerM(ps.dist)) };
  playerOccluderCache = { time: G.time, view: G.view, value };
  return value;
}

function playerScreenCovers(s, dist) {
  const hole = playerOccluder();
  // 地面焦痕与机身的深度差可达数百米；只有深度接近的物件（导弹、翼尖曳光）才按
  // “离相机更远”判断。地面物件始终按屏幕轮廓覆盖判定。
  if (!hole || (dist <= hole.dist + 2 && dist < hole.dist * 1.5)) return false;
  if (!hole.poly) {
    const dx = (s.x - hole.x) / hole.rx, dy = (s.y - hole.y) / hole.ry;
    return dx * dx + dy * dy <= 1;
  }
  // 凸四边形内外判定：四个端点同向绕行，符号最稳。
  let side = 0;
  for (let i = 0; i < 4; i++) {
    const a = hole.poly[i], b = hole.poly[(i + 1) % 4];
    const cross = (b.x - a.x) * (s.y - a.y) - (b.y - a.y) * (s.x - a.x);
    if (cross === 0) continue;
    const sign = cross > 0 ? 1 : -1;
    if (side === 0) side = sign;
    else if (sign !== side) return false;
  }
  return true;
}

// 位于机体之后的焦痕或特效，绘制时把机体的屏幕轮廓挖空；仅按中心点整团丢弃会留下
// 边缘压在机翼上的像素。没有 Path2D 的环境（VM 回归）退回整团绘制。
function drawBehindPlayer(occluder, dist, draw) {
  if (!occluder || dist <= occluder.dist + 2) { draw(); return; }
  if (typeof Path2D !== 'function') { draw(); return; }
  const path = new Path2D();
  path.rect(0, 0, VW, VH);
  if (occluder.poly) {
    // 裁剪边本身也抗锯齿：按质心向外放 1.5 像素，免得轮廓内沿留一圈半透明焦痕像素。
    const p = occluder.poly;
    let cx = 0, cy = 0;
    for (const v of p) { cx += v.x; cy += v.y; }
    cx /= 4; cy /= 4;
    const grow = v => {
      const dx = v.x - cx, dy = v.y - cy, len = Math.hypot(dx, dy) || 1;
      return { x: v.x + dx / len * 1.5, y: v.y + dy / len * 1.5 };
    };
    const q = p.map(grow);
    path.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) path.lineTo(q[i].x, q[i].y);
    path.closePath();
  } else {
    path.ellipse(occluder.x, occluder.y, occluder.rx, occluder.ry, 0, 0, TAU);
  }
  ctx.save();
  ctx.clip(path, 'evenodd');
  draw();
  ctx.restore();
}

function terrainBlocks(cam, pos) {
  if (!G.map || !cam) return false;
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const x = lerp(cam.x, pos.x, t), y = lerp(cam.y, pos.y, t), z = lerp(cam.z, pos.z, t);
    if (y < G.map.heightAt(x, z) + 0.9) return true;
  }
  return false;
}

function terrainOccluded(pos) {
  return terrainBlocks(G.camera?.pos, pos);
}

// 导弹与曳光这类贴着机身飞行的物件按中心点剔除；地面焦痕、爆点和阴影不能用中心点
// 整团丢弃：中心落在机体轮廓内时，其余露在轮廓外的像素本应可见。
function overlayOccluded(pos, s, dist = s.dist) {
  if (!s.visible) return true;
  if (playerScreenCovers(s, dist)) return true;
  return terrainOccluded(pos);
}

function drawGroundShadow(pos, basis, size, alpha = 0.35, occluder = null) {
  if (!G.map) return;
  const gh = G.map.heightAt(pos.x, pos.z);
  if (gh > pos.y - 8) return;
  const ground = { x: pos.x, y: Math.max(gh, 0) + 0.4, z: pos.z };
  if (!shadowVisible(ground)) return;
  const s = {};
  if (!projectToScreen(ground, s) || !s.visible) return;
  const p2 = { x: ground.x + basis.fwd.x * 20, y: ground.y, z: ground.z + basis.fwd.z * 20 };
  const s2 = {};
  if (!projectToScreen(p2, s2)) return;
  const ang = Math.atan2(s2.y - s.y, s2.x - s.x);
  const ppm = pxPerM(s.dist);
  const w = Math.max(2, 11 * size * ppm);
  const h = Math.max(1, 4.6 * size * ppm);
  const altFade = clamp01(1 - (pos.y - ground.y) / 1800);
  drawBehindPlayer(occluder, s.dist, () => {
    ctx.save();
    ctx.globalAlpha = alpha * altFade;
    ctx.translate(Math.round(s.x), Math.round(s.y));
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(10,7,16,0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha *= 0.7;
    ctx.fillRect(-w * 0.24, -h * 0.08, w * 0.55, Math.max(1, h * 0.16));
    ctx.restore();
  });
}

function drawScorchDecals() {
  const occluder = playerOccluder();
  for (const d of G.decals) {
    const s = {};
    const pos = { x: d.pos.x, y: d.pos.y + 0.5, z: d.pos.z };
    // 焦痕落在开阔地面上：中心点被机体盖住不算整体被挡，挖空轮廓后仍要画外围像素。
    if (!projectToScreen(pos, s) || terrainOccluded(pos)) continue;
    const ppm = pxPerM(s.dist);
    const r = Math.max(1.5, d.size * ppm);
    const a = clamp01(d.life / d.maxLife);
    drawBehindPlayer(occluder, s.dist, () => {
      ctx.save();
      ctx.globalAlpha = 0.5 * a;
      ctx.fillStyle = '#1b1218';
      ctx.beginPath(); ctx.ellipse(Math.round(s.x), Math.round(s.y), r, r * 0.45, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35 * a;
      ctx.fillStyle = '#0c080d';
      ctx.beginPath(); ctx.ellipse(Math.round(s.x), Math.round(s.y), r * 0.6, r * 0.28, 0, 0, TAU); ctx.fill();
      ctx.restore();
    });
  }
}

function drawVaporPoints() {
  const bySide = new Map();
  for (const v of G.vapor) {
    const s = {};
    if (!projectToScreen(v.pos, s) || !s.visible) continue;
    const side = v.side || 0;
    const points = bySide.get(side) || [];
    points.push({ v, s });
    bySide.set(side, points);
  }
  for (const [side, points] of bySide) {
    const last = points.at(-1).v;
    if (side && G.player && !G.player.dead && G.view !== 2 && last.maxLife - last.life <= 0.1) {
      // 衔接当帧真实翼尖，避免采样间隔和滚转带来的近端断口。
      const pos = wingTipPosition(G.player, G.player.renderBasis, side), s = {};
      if (projectToScreen(pos, s) && s.visible) points.push({ v: { pos, life: 1, maxLife: 1 }, s });
    }
    if (points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = '#e8f1f4';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < points.length; i++) {
      const { v, s } = points[i];
      const prev = points[i - 1];
      const gap = prev && vdist(prev.v.pos, v.pos) > 120;
      if (!open || gap) {
        ctx.moveTo(s.x, s.y);
        open = true;
      } else {
        ctx.lineTo(s.x, s.y);
      }
    }
    const life = points.reduce((sum, point) => sum + clamp01(point.v.life / point.v.maxLife), 0) / points.length;
    const ppm = points.reduce((sum, point) => sum + pxPerM(point.s.dist), 0) / points.length;
    ctx.globalAlpha = life * 0.42;
    ctx.lineWidth = Math.max(0.85, Math.min(1.65, ppm * 0.45));
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawTracers() {
  for (const t of G.tracers) {
    const a = {}, b = {};
    if (!projectToScreen(t.a, a) || !projectToScreen(t.b, b)) continue;
    if (a.w < 0 || b.w < 0) continue;
    const mid = { x: (t.a.x + t.b.x) * 0.5, y: (t.a.y + t.b.y) * 0.5, z: (t.a.z + t.b.z) * 0.5 }, ms = {};
    if (!projectToScreen(mid, ms) || overlayOccluded(mid, ms)) continue;
    const alpha = clamp01(t.life / t.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#241407';
    ctx.lineWidth = (t.width || 1) + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = t.width || 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (t.width > 1) {
      ctx.strokeStyle = '#fff6da';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(lerp(a.x, b.x, 0.7), lerp(a.y, b.y, 0.7)); ctx.stroke();
    }
    ctx.restore();
  }
  drawGunTracers();
}

function drawGunTracers() {
  const occluder = playerOccluder();
  for (const b of G.bullets) {
    const head = {};
    if (b.dead || !projectToScreen(b.pos, head) || overlayOccluded(b.pos, head)) continue;
    const fade = clamp01(b.life / .16);
    drawBehindPlayer(occluder, head.dist, () => {
      ctx.save(); ctx.lineCap = 'butt';
      // 近段透视也只能留下短曳光，不能从炮口到弹头拉满整块风挡。
      let remaining = 8;
      for (let i = b.trail.length - 1; i > 0 && remaining > 0; i--) {
        const from = b.trail[i - 1], to = b.trail[i], a = {}, s = {};
        if (!projectToScreen(from, a) || !projectToScreen(to, s) || terrainOccluded(vlerp(from, to, .5))) continue;
        const length = Math.hypot(a.x - s.x, a.y - s.y), drawn = Math.min(length, remaining);
        if (length > remaining) {
          a.x = lerp(s.x, a.x, remaining / length); a.y = lerp(s.y, a.y, remaining / length);
        }
        const alpha = fade * (.25 + .65 * (remaining - drawn / 2) / 8);
        remaining -= drawn;
        ctx.globalAlpha = alpha * .35;
        ctx.strokeStyle = '#342515'; ctx.lineWidth = 2.1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = b.color; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = '#fff6cf'; ctx.lineWidth = .85; ctx.stroke();
      }
      // 视线方向的远段会缩到亚像素，亮弹头保持至少一个逻辑像素，仍受地形和机体遮挡。
      const size = clamp(pxPerM(head.dist) * .28, 1.25, 2.4);
      const x = Math.round(head.x), y = Math.round(head.y);
      ctx.globalAlpha = fade * .35;
      ctx.fillStyle = '#342515'; ctx.fillRect(x - size / 2 - .6, y - size / 2 - .6, size + 1.2, size + 1.2);
      ctx.globalAlpha = fade;
      ctx.fillStyle = b.color; ctx.fillRect(x - size / 2 - .4, y - size / 2 - .4, size + .8, size + .8);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#fff6cf'; ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.restore();
    });
  }
}

let missileSmokeStamp;
function drawMissileTrails() {
  if (!G.missileTrails.length) return;
  if (!missileSmokeStamp) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 24;
    const ink = tile.getContext('2d'), colors = ['#a49aa1', '#cbbcb4', '#e8d9c4', '#fff0d2'];
    // 原创的小烟团只画一次；亮面和透空边缘随烟走，不在屏幕上抖动。
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const u = (x - 11.5) / 12, v = (y - 11.5) / 12;
      const edge = Math.min(Math.hypot(u + 0.23, v + 0.10) / 0.68,
        Math.hypot(u - 0.22, v - 0.05) / 0.67, Math.hypot(u + 0.03, v - 0.28) / 0.59);
      const grain = bayer(x, y);
      if (edge > 1.07 - grain * 0.22) continue;
      ink.fillStyle = colors[clamp(Math.floor(2.65 - v * 1.4 - u * 0.72 - edge * 0.85 + grain * 0.90), 0, 3)];
      ink.fillRect(x, y, 1, 1);
    }
    missileSmokeStamp = tile;
  }
  ctx.save();
  ctx.lineCap = 'butt';
  const a = {}, b = {}, drift = {};
  for (const trail of G.missileTrails) {
    let prev = a, next = b, projected = false;
    for (let i = 0; i <= trail.points.length; i++) {
      const tip = i === trail.points.length;
      const pos = tip ? trail.tip : trail.points[i].pos;
      const life = tip ? trail.tipLife : trail.points[i].life;
      if (!pos || life <= 0) { projected = false; continue; }
      const fresh = clamp01(life / MISSILE_TRAIL_LIFE), age = 1 - fresh;
      // 只让冷烟在绘制时轻微上浮、卷散；不搬动飞行留下的世界采样点。
      const phase = pos.x * 0.037 + pos.y * 0.021 + pos.z * 0.046;
      const curl = age * age, ripple = Math.sin(phase);
      drift.x = pos.x + curl * ripple * 1.8;
      drift.y = pos.y + curl * (2.1 + Math.cos(phase * 0.72));
      drift.z = pos.z + curl * Math.cos(phase) * 1.3;
      const ok = projectToScreen(drift, next) && next.dist > 3;
      const hidden = ok && overlayOccluded(drift, next, next.dist);
      if (projected && ok && !hidden && (prev.visible || next.visible)) {
        const depth = (prev.dist + next.dist) * 0.5;
        const width = clamp(pxPerM(depth) * (0.44 + age * 1.25) * (1 + 0.20 * age * ripple), 0.70, 2.8);
        const alpha = Math.pow(fresh, 1.25) * (0.18 + 0.82 * smoothstep(12, 70, depth)) * (1 + age * 0.15 * ripple);
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(next.x, next.y);
        ctx.lineWidth = width; ctx.strokeStyle = '#bdb5ae'; ctx.globalAlpha = 0.13 * alpha; ctx.stroke();
        ctx.lineWidth = width * 0.62; ctx.strokeStyle = fresh > 0.72 ? '#ffedc9' : fresh > 0.4 ? '#e0d4c4' : '#c4c0bc';
        ctx.globalAlpha = (0.10 + 0.28 * fresh) * alpha; ctx.stroke();
      }
      if (!tip && ok && !hidden && next.visible) {
        const size = clamp(pxPerM(next.dist) * (3.2 + 12 * age) * (1 + 0.15 * ripple), 1.1, 44);
        const separation = projected ? Math.hypot(next.x - prev.x, next.y - prev.y) : size;
        ctx.globalAlpha = Math.pow(fresh, 0.85) * (0.28 + 0.55 * smoothstep(9, 58, next.dist))
          * clamp(separation / (size * 0.55), 0.23, 1);
        ctx.drawImage(missileSmokeStamp, Math.round(next.x - size / 2), Math.round(next.y - size * 0.46), size, size * 0.92);
      }
      projected = ok;
      const swap = prev; prev = next; next = swap;
    }
  }
  ctx.restore();
}

function drawEffects() {
  drawMissileTrails();
  const tmp = {}, occluder = playerOccluder();
  // smoke belongs behind the fireball and sparks, not on top of them
  const smokeRank = f => (f.type === 'smoke' || f.type === 'mist') ? 0 : 1;
  G.effects.sort((a, b) => smokeRank(a) - smokeRank(b));
  for (const f of G.effects) {
    if (f.delay > 0) continue;
    const b = projectToScreen(f.pos, tmp);
    if (!b || overlayOccluded(f.pos, tmp)) continue;
    drawBehindPlayer(occluder, tmp.dist, () => drawWorldEffect(f, tmp, pxPerM(tmp.dist)));
  }
  ctx.globalAlpha = 1;
}

function drawWorldEffect(f, tmp, ppm) {
  const lifeF = clamp01(f.life / f.maxLife);
  const x = Math.round(tmp.x), y = Math.round(tmp.y);
  if (f.type === 'smoke' || f.type === 'mist') {
    // cap screen-space radius so launch puffs next to the camera can never
    // smear across the view; fade very near puffs instead of blowing up
    const cap = f.type === 'mist' ? 60 : (f.dark ? 38 : 46);
    const r = Math.min(cap, Math.max(f.minRadius ?? 0.8, f.size * ppm));
    const near = clamp01((tmp.dist - 16) / 55);
    const a = (f.opacity ?? (f.type === 'mist' ? 0.32 : 0.5)) * lifeF * (0.22 + 0.78 * near);
    if (a > 0.01) {
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color ?? (f.type === 'mist' ? '#c9c3cf' : (f.dark ? '#34303e' : '#777080'));
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = f.highlight ?? (f.dark ? '#17131e' : '#a49aa6');
      ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.18, r * 0.62, 0, TAU); ctx.fill();
    }
  } else if (f.type === 'fire') {
    const r = Math.max(f.minRadius ?? 1, f.size * ppm);
    const a = clamp01(lifeF * 1.3);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ff7a3a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(x - r * 0.12, y - r * 0.15, r * 0.68, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff6dc';
    ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.22, r * 0.36, 0, TAU); ctx.fill();
    // chunky embers at the rim
    ctx.fillStyle = '#ffb348';
    for (let i = 0; i < 4; i++) {
      const ang = i * 1.9 + lifeF;
      ctx.fillRect(Math.round(x + Math.cos(ang) * r * 1.1), Math.round(y + Math.sin(ang) * r * 1.1), 1, 1);
    }
  } else if (f.type === 'spark' || f.type === 'ember') {
    const a = clamp01(lifeF * 1.6);
    const sz = Math.max(1, Math.round(f.size * (f.type === 'spark' ? 1 : 1)));
    ctx.globalAlpha = a;
    ctx.fillStyle = f.color;
    ctx.fillRect(x, y, sz, sz);
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = '#ffb35a';
    ctx.fillRect(x - 1, y, sz + 2, 1);
  } else if (f.type === 'spray') {
    const a = clamp01(lifeF);
    const sz = Math.max(1, Math.round(f.size * 0.8));
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = f.color;
    ctx.fillRect(x, y, sz, sz);
    ctx.globalAlpha = a * 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y - 1, 1, 1);
  } else if (f.type === 'foam') {
    const r = Math.max(f.minRadius ?? 1, f.size * ppm);
    ctx.globalAlpha = (f.opacity ?? 0.35) * lifeF;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.35, 0, 0, TAU); ctx.stroke();
  } else if (f.type === 'ring') {
    const r = Math.max(1, f.size * ppm);
    ctx.globalAlpha = clamp01(lifeF * 1.4) * 0.9;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = f.flat ? 1 : 2;
    ctx.beginPath();
    if (f.flat) ctx.ellipse(x, y, r, r * 0.38, 0, 0, TAU);
    else ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha *= 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (f.flat) ctx.ellipse(x, y, r * 1.06, r * 0.40, 0, 0, TAU);
    else ctx.arc(x, y, r * 1.05, 0, TAU);
    ctx.stroke();
  } else if (f.type === 'debris') {
    const a = clamp01(lifeF);
    const sz = Math.max(1, f.size * ppm * 1.8);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(f.rot || 0);
    ctx.fillStyle = f.color;
    ctx.fillRect(-sz * 0.5, -sz * 0.5, sz, Math.max(1, sz * 0.6));
    ctx.restore();
    f.rot = (f.rot || 0) + (f.rotV || 0) * 0.016;
  } else if (f.type === 'flare') {
    ctx.globalAlpha = 0.95 * lifeF;
    ctx.fillStyle = '#fff6c9';
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.globalAlpha = 0.5 * lifeF;
    ctx.fillStyle = '#ffb84d';
    ctx.fillRect(x - 3, y, 7, 1);
    ctx.fillRect(x, y - 3, 1, 7);
  }
}

// hard-pixel line: no anti-aliasing, every stamp lands on an integer pixel
function pixelLine(x0, y0, x1, y1, color, thick = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = (thick - 1) >> 1;
  ctx.fillStyle = color;
  for (let guard = 0; guard < 400; guard++) {
    ctx.fillRect(x0 - o, y0 - o, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawMissilesAndGlows() {
  const tmp = {}, t2 = {};
  for (const m of G.missiles) {
    if (m.dead) continue;
    if (!projectToScreen(m.pos, tmp) || overlayOccluded(m.pos, tmp)) continue;
    const sp = Math.hypot(m.vel.x, m.vel.y, m.vel.z) || 1;
    const ux = m.vel.x / sp, uy = m.vel.y / sp, uz = m.vel.z / sp;
    // project a point behind the round so the sprite follows screen velocity
    const back = { x: m.pos.x - ux * 8, y: m.pos.y - uy * 8, z: m.pos.z - uz * 8 };
    if (!projectToScreen(back, t2)) continue;
    let dx = tmp.x - t2.x, dy = tmp.y - t2.y;
    const dl = Math.hypot(dx, dy);
    dx /= dl || 1; dy /= dl || 1;
    const ppm = pxPerM(tmp.dist), x = tmp.x, y = tmp.y;
    // 端视时可见的是点状尾焰，不能把几乎为零的投影切线放大成一根黑棍。
    const len = clamp(Math.min(4.2 * ppm, 1.6 + 0.65 * dl), 1.2, 18);
    const enemy = m.owner === 'enemy', flameCol = enemy ? '#ff8a3d' : '#ffc46a';
    if (len <= 2.6) {
      const ix = Math.round(x), iy = Math.round(y);
      ctx.save(); ctx.globalAlpha = 0.52; ctx.fillStyle = flameCol; ctx.fillRect(ix - 1, iy - 1, 3, 3);
      ctx.globalAlpha = 0.94; ctx.fillStyle = '#fff3d2'; ctx.fillRect(ix, iy, 1, 1); ctx.restore();
      continue;
    }
    const nx = x + dx * len * 0.62, ny = y + dy * len * 0.62;
    const tx = x - dx * len * 0.38, ty = y - dy * len * 0.38;
    const px = -dy, py = dx;
    const bodyCol = enemy ? '#d9c9b6' : '#efe8d4';
    const finCol = enemy ? '#6e2f2a' : '#8e929c';
    const noseCol = enemy ? '#ff5d47' : '#c24534';
    const flick = 0.75 + 0.25 * Math.sin(G.realTime * 40 + (m.age || 0) * 7);
    const flameLen = (0.7 + len * 0.35) * flick;
    const ex = tx - dx * flameLen, ey = ty - dy * flameLen;
    const thick = len > 8 ? 2 : 1;
    if (len > 6) {
      const fs = Math.max(1, len * 0.14);
      pixelLine(tx, ty, nx, ny, '#51474c', thick + 1);
      pixelLine(tx - dx * 2 + px * fs, ty - dy * 2 + py * fs, tx + px * (fs + 1), ty + py * (fs + 1), finCol, 1);
      pixelLine(tx - dx * 2 - px * fs, ty - dy * 2 - py * fs, tx - px * (fs + 1), ty - py * (fs + 1), finCol, 1);
    }
    // body + red seeker
    pixelLine(tx, ty, nx, ny, bodyCol, thick);
    pixelLine(lerp(tx, nx, 0.76), lerp(ty, ny, 0.76), nx, ny, noseCol, thick);
    // exhaust flame with a white-hot core
    pixelLine(ex, ey, tx, ty, flameCol, thick);
    pixelLine(lerp(ex, tx, 0.35), lerp(ey, ty, 0.35), tx, ty, '#fff3c8', 1);
    ctx.save();
    const qx = Math.round(tx), qy = Math.round(ty), glow = len > 7 ? 2 : 1;
    ctx.globalAlpha = 0.18; ctx.fillStyle = flameCol;
    ctx.fillRect(qx - glow, qy, 2 * glow + 1, 1); ctx.fillRect(qx, qy - glow, 1, 2 * glow + 1);
    ctx.globalAlpha = 0.94; ctx.fillStyle = '#fff6d8'; ctx.fillRect(qx, qy, 1, 1);
    ctx.restore();
  }
  // engine glows
  const p = G.player;
  if (!p) return;
  if (G.cockpitAlpha < 0.6) {
    const b = p.renderBasis;
    for (const side of [-1.25, 1.25]) {
      const nozzle = vadd(vadd(p.pos, vmul(b.right, side)), vmul(b.fwd, -4.3));
      if (!projectToScreen(nozzle, tmp) || !tmp.visible) continue;
      const glow = p.burning ? 3 : 2;
      ctx.save();
      ctx.globalAlpha = p.burning ? 0.9 : 0.62;
      const x = Math.round(tmp.x), y = Math.round(tmp.y);
      ctx.fillStyle = '#ff9a42';
      ctx.fillRect(x - Math.round(glow), y - Math.round(glow * 0.55), Math.round(glow * 2), Math.round(glow * 1.1));
      ctx.fillStyle = '#ffe7b0';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      const tail = vsub(nozzle, vmul(b.fwd, p.burning ? 6.5 : 0.75));
      const t2 = {};
      if (projectToScreen(tail, t2)) {
        const dx = t2.x - x, dy = t2.y - y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const w = clamp(0.55 + 5 / Math.max(6, vdist(nozzle, G.camera.pos)), 0.7, 2.4);
        ctx.globalAlpha = p.burning ? 0.62 : 0.3;
        ctx.fillStyle = p.burning ? '#8fdcff' : '#ff9a45';
        ctx.beginPath();
        ctx.moveTo(x + nx * w, y + ny * w);
        ctx.lineTo(t2.x, t2.y);
        ctx.lineTo(x - nx * w, y - ny * w);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = p.burning ? 0.85 : 0.5;
        ctx.fillStyle = '#fff1c8';
        ctx.beginPath();
        ctx.moveTo(x + nx * 0.7, y + ny * 0.7);
        ctx.lineTo(lerp(x, t2.x, 0.55), lerp(y, t2.y, 0.55));
        ctx.lineTo(x - nx * 0.7, y - ny * 0.7);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (!projectToScreen(vadd(e.pos, vmul(e.basis.fwd, -4.3)), tmp) || !tmp.visible) continue;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#ff5a3c';
    ctx.fillRect(Math.round(tmp.x) - 1, Math.round(tmp.y) - 1, 3, 2);
    ctx.fillStyle = '#ffc08a';
    ctx.fillRect(Math.round(tmp.x), Math.round(tmp.y), 1, 1);
    ctx.restore();
  }
}

function drawPopups() {
  for (const p of G.popups) {
    const s = {};
    if (!projectToScreen(p.pos, s) || !s.visible) continue;
    const a = Math.min(1, (p.life - p.t) * 2.2) * Math.min(1, p.t * 8 + 0.2);
    drawText(p.text, s.x, s.y, {
      size: 9, color: p.color, align: 'center', alpha: a,
      outline: '#100b14', bold: true
    });
    if (p.tag) drawText(p.tag, s.x, s.y - 11, {
      size: 9, color: '#ffe8b0', align: 'center', alpha: a,
      outline: '#100b14', spacing: 0
    });
  }
}

function drawWorldOverlay() {
  if (!G.map || !G.player) return;
  ctx.save();
  const occluder = playerOccluder();
  // shadows
  for (const g of G.ground) {
    if (g.dead) continue;
    const d = vdist(g.pos, G.player.pos);
    if (d > 2600) continue;
    drawGroundShadow(g.pos, { fwd: { x: 0, y: 0, z: -1 } }, g.type === 'sam' ? 0.8 : 0.55, 0.28, occluder);
  }
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = vdist(e.pos, G.player.pos);
    if (d > 2200) continue;
    drawGroundShadow(e.pos, e.basis, 0.5, 0.22, occluder);
  }
  drawScorchDecals();
  drawVaporPoints();
  drawTracers();
  drawEffects();
  drawMissilesAndGlows();
  drawPopups();
  ctx.restore();
}

// ---------------------------------------------------------------- HUD -------
function compassDeg(yaw) {
  let d = (yaw * 180 / Math.PI) % 360;
  if (d < 0) d += 360;
  return d;
}

function compassLabel(deg) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(deg / 45) % 8];
}

function drawHUD() {
  const p = G.player;
  if (!p || !G.camera) return;
  const cockpit = G.cockpitAlpha;
  drawPitchLadder(cockpit);
  drawHeadingTape();
  // target boxes sit under the instrument panels so they never scribble
  // over the shield/fuel/score readouts
  drawTargetMarkers();
  drawObjectivesPanel();
  drawScorePanel();
  drawSpeedAlt();
  drawShieldFuel();
  drawAimReticle();
  drawThreats();
  if (cockpit < 0.45) {
    drawWeaponPips();
    drawMiniRadar();
  }
  drawWarnings();
  drawBanner();
  if ((G.mode === 'play' || G.mode === 'waveclear' || G.mode === 'dying') && (!INPUT.touchMode || TOUCH.active)
      && (G.view !== 0 || TOUCH.active || INPUT.mouseSteerAge < MOUSE_STEER_TIMEOUT)) {
    drawMousePip(INPUT.mx, INPUT.my, cockpit > 0.5 ? '#b7e9df' : '#d8efe8');
  }
}

function drawPitchLadder(cockpitFade) {
  if (G.view === 0 && G.viewBlend > 0.5) return;
  const p = G.player;
  if (!p) return;
  const clipTop = 35;
  const clipBottom = cockpitFade > 0.35 ? VH - 104 : VH - 54;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, clipTop, VW, Math.max(10, clipBottom - clipTop));
  ctx.clip();
  const rightDir = { x: Math.cos(p.yaw), y: 0, z: Math.sin(p.yaw) };
  const pts = {};
  const tmp = {};
  for (let deg = -40; deg <= 40; deg += 10) {
    const a = deg * DEG;
    const dir = {
      x: Math.sin(p.yaw) * Math.cos(a),
      y: Math.sin(a),
      z: -Math.cos(p.yaw) * Math.cos(a)
    };
    const far = 1600;
    const half = 520;
    const c = vadd(p.pos, vmul(dir, far));
    const a1 = { x: c.x - rightDir.x * half, y: c.y, z: c.z - rightDir.z * half };
    const a2 = { x: c.x + rightDir.x * half, y: c.y, z: c.z + rightDir.z * half };
    const s1 = {}, s2 = {};
    if (!projectToScreen(a1, s1) || !projectToScreen(a2, s2)) continue;
    if (s1.w < 1 || s2.w < 1) continue;
    if (!s1.visible && !s2.visible) continue;
    const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2;
    if (my < clipTop - 20 || my > clipBottom + 20) continue;
    if (mx < -300 || mx > VW + 300) continue;
    const len = Math.hypot(s2.x - s1.x, s2.y - s1.y);
    if (len < 12) continue;
    const ux = (s2.x - s1.x) / len, uy = (s2.y - s1.y) / len;
    const halfLen = Math.min(len * 0.32, 90);
    const gap = deg === 0 ? 32 : 16;
    const isHorizon = deg === 0;
    const col = isHorizon ? 'rgba(240,192,90,0.95)' : 'rgba(173,235,225,0.62)';
    const width = isHorizon ? 2 : 1;
    if (len > gap * 2 + 8) {
      ctx.strokeStyle = 'rgba(8,6,12,0.85)';
      ctx.lineWidth = width + 1;
      ctx.beginPath();
      ctx.moveTo(mx - ux * (gap + halfLen), my - uy * (gap + halfLen));
      ctx.lineTo(mx - ux * gap, my - uy * gap);
      ctx.moveTo(mx + ux * gap, my + uy * gap);
      ctx.lineTo(mx + ux * (gap + halfLen), my + uy * (gap + halfLen));
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(mx - ux * (gap + halfLen), my - uy * (gap + halfLen));
      ctx.lineTo(mx - ux * gap, my - uy * gap);
      ctx.moveTo(mx + ux * gap, my + uy * gap);
      ctx.lineTo(mx + ux * (gap + halfLen), my + uy * (gap + halfLen));
      ctx.stroke();
    }
    if (deg !== 0) {
      const label = (deg > 0 ? '+' : '') + deg;
      drawText(label, mx - ux * (gap + halfLen) - 3, my - uy * (gap + halfLen) - 2, {
        size: 6, color: 'rgba(190,240,230,0.85)', align: 'right', shadow: 'rgba(8,6,12,0.8)'
      });
      drawText(label, mx + ux * (gap + halfLen) + 3, my + uy * (gap + halfLen) + 6, {
        size: 6, color: 'rgba(190,240,230,0.85)', align: 'left', shadow: 'rgba(8,6,12,0.8)'
      });
    } else {
      drawText('地平线', mx - ux * (gap + halfLen) - 3, my - uy * (gap + halfLen) - 3, {
        size: 8, color: 'rgba(240,192,90,0.8)', align: 'right', shadow: 'rgba(8,6,12,0.9)'
      });
    }
  }
  ctx.restore();
}

function drawHeadingTape() {
  const p = G.player;
  const deg = compassDeg(p.yaw);
  const w = 168, h = 15;
  const x = Math.round(VW / 2 - w / 2), y = 8;
  panel(x, y, w, h, { alpha: 0.68, fill: '#100d18', stroke: '#5d4c39', corners: false });
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 1, y, w - 2, h); ctx.clip();
  const pxPerDeg = 2.3;
  for (let d = -36; d <= 36; d += 5) {
    const td = deg + d;
    const tx = VW / 2 + d * pxPerDeg;
    const val = ((td % 360) + 360) % 360;
    const isMajor = Math.abs(d) % 30 === 0;
    const isMid = Math.abs(d) % 10 === 0;
    const tickH = isMajor ? 4 : (isMid ? 3 : 2);
    rect(tx, y + 2, 1, tickH, isMajor ? '#f0c05a' : '#8f7a5e');
    if (isMajor) {
      drawText(pad(Math.round(val / 10) % 36, 2), tx, y + 11, { size: 6, color: '#e3d3b2', align: 'center' });
    }
  }
  ctx.restore();
  // center caret + current heading readout
  ctx.save();
  ctx.fillStyle = PAL.gold;
  ctx.beginPath();
  ctx.moveTo(VW / 2 - 3, y + h);
  ctx.lineTo(VW / 2 + 3, y + h);
  ctx.lineTo(VW / 2, y + h + 4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  drawText(`${pad(Math.round(deg), 3)}`, VW / 2, y + h + 12, {
    size: 7, color: PAL.cream, align: 'center', shadow: '#0b0912', spacing: 1
  });
  drawText(compassLabel(deg), VW / 2 + 30, y + 11, { size: 6, color: PAL.gold, align: 'left' });
}

function drawObjectivesPanel(waveTitle = `第 ${pad(G.wave, 2)} 波`, armorStatus = '') {
  const x = 10, y = 10;
  panel(6, 2, 116, 62, { alpha: 0.38, fill: '#0c0912', stroke: '#3f342a', border: false });
  drawText(G.defenseStage?.title || '巡逻 / 截击', x, y + 7, { size: 10, color: '#d8bd94', spacing: 0 });
  panel(x, y + 11, 92, 16, { alpha: 0.72, fill: '#191320', stroke: '#8a6f47', corners: true });
  drawText(waveTitle, x + 6, y + 23, { size: 10, color: PAL.goldHot, spacing: 0, bold: true });
  drawText(G.defenseStage ? '空中' : '无人机', x, y + 39, { size: 10, color: '#f0e3c6', shadow: '#0b0912' });
  drawText(`${Math.min(G.waveKills, G.waveTotal)}/${G.waveTotal}`, x + 34, y + 39, {
    size: 9, color: '#f0e3c6', mono: true, shadow: '#0b0912'
  });
  if (armorStatus) {
    drawText(`装甲 ${armorStatus}`, x, y + 51, { size: 9, color: '#b8e0d5', shadow: '#0b0912' });
  } else if (G.secondary) {
    const settlesWithWave = G.player?.flightComfort && G.secondary.type === 'shield';
    const done = settlesWithWave ? G.secondaryDone : isSecondaryComplete();
    const txt = (done ? '附加完成  ' : '附加  ') + secondaryProgressText();
    drawText(txt, x, y + 51, {
      size: 9, color: done ? '#bce7a0' : '#cdb57f', shadow: '#0b0912'
    });
  }
}

function drawScorePanel() {
  const p = G.player;
  const x = VW - 10;
  panel(VW - 118, 2, 112, 54, { alpha: 0.38, fill: '#0c0912', stroke: '#3f342a', border: false });
  drawText('得分', x, 16, { size: 10, color: '#d8bd94', align: 'right' });
  drawText(pad(Math.floor(G.score), 6), x, 31, { size: 12, color: PAL.goldHot, align: 'right', shadow: '#0b0912', spacing: 0.5 });
  const hsStr = pad(Math.floor(G.highScore), 6);
  const hsW = textWidth(hsStr, 8, true);
  drawText(hsStr, x, 42, { size: 8, color: '#c9b48c', align: 'right', mono: true });
  drawText('最高', x - hsW - 4, 42, { size: 9, color: '#a99276', align: 'right' });
  drawText(`T+${fmtTime(G.missionTime)}`, x, 50, { size: 6, color: '#8f7a5e', align: 'right', mono: true });
}

function drawSpeedAlt() {
  const p = G.player;
  const knots = Math.round(p.speed * 1.94384);
  const altFt = Math.round(p.pos.y * 3.28084);
  const aglFt = Math.round(Math.max(0, p.agl) * 3.28084);
  const vspd = Math.round(p.basis.fwd.y * p.speed * 196.85);
  const y1 = 124;
  // speed
  panel(10, y1, 82, 37, { alpha: 0.68, fill: '#0f0c16', stroke: '#5d4c39' });
  drawText('空速', 14, y1 + 8, { size: 10, color: '#c5ae8b' });
  drawText(String(knots), 88, y1 + 23, { size: 17, color: PAL.cream, align: 'right', shadow: '#0b0912' });
  drawText('节', 88, y1 + 33, { size: 10, color: '#a99276', align: 'right' });
  // altitude
  panel(VW - 92, y1, 82, 37, { alpha: 0.68, fill: '#0f0c16', stroke: '#5d4c39' });
  drawText('高度', VW - 14, y1 + 8, { size: 10, color: '#c5ae8b', align: 'right' });
  drawText(String(altFt), VW - 88, y1 + 23, { size: 17, color: PAL.cream, align: 'left', shadow: '#0b0912' });
  drawText('英尺', VW - 14, y1 + 33, { size: 10, color: '#a99276', align: 'right' });
  // radar alt + vertical speed + G
  drawText('离地', 10, y1 + 48, { size: 10, color: p.agl < 130 ? PAL.amber : '#bce7e0', shadow: '#0b0912' });
  drawText(pad(Math.round(aglFt), 4), 33, y1 + 48, { size: 9, color: p.agl < 130 ? PAL.amber : '#bce7e0', mono: true, shadow: '#0b0912' });
  const vsStr = `${vspd >= 0 ? '+' : ''}${vspd}`;
  const vsW = textWidth(vsStr, 9, true);
  drawText(vsStr, VW - 10, y1 + 48, { size: 9, color: '#cbbd9f', mono: true, align: 'right', shadow: '#0b0912' });
  drawText('升降', VW - 16 - vsW, y1 + 48, { size: 10, color: '#a99276', align: 'right', shadow: '#0b0912' });
  drawText(`G ${p.gLoad.toFixed(1)}`, VW - 10, y1 + 58, {
    size: 8, color: p.gLoad > 6.2 ? PAL.red : (p.gLoad > 4.5 ? PAL.amber : '#bce7e0'), align: 'right', shadow: '#0b0912'
  });
  // bank indicator
  const bx = 10, by = y1 + 58;
  drawText('坡度', bx, by, { size: 10, color: '#a99276' });
  const bankDeg = Math.round(-wrapAngle(p.roll + (p.inversionRoll || 0)) * 180 / Math.PI);
  const bankStr = String(Math.abs(bankDeg));
  const bankW = textWidth(bankStr, 9, true);
  drawText(bankStr, bx + 66, by, { size: 9, color: '#cbbd9f', mono: true, align: 'right', shadow: '#0b0912' });
  drawText(bankDeg >= 0 ? '右' : '左', bx + 62 - bankW, by, {
    size: 10, color: '#cbbd9f', align: 'right', shadow: '#0b0912'
  });
}

function drawShieldFuel() {
  const p = G.player;
  const x = 10, y = 74;
  const w = 104;
  panel(6, y - 2, 112, 48, { alpha: 0.44, fill: '#0c0912', stroke: '#3f342a', border: false });
  drawText('护盾', x, y + 7, { size: 10, color: p.shield < 25 ? PAL.red : '#bce7e0' });
  drawText(String(Math.ceil(p.shield)), x + w, y + 8, { size: 8, color: '#d4eae2', align: 'right', mono: true });
  segBar(x, y + 10, w, 5, p.shield / 100, p.shield < 25 ? PAL.red : (p.shield < 55 ? PAL.amber : '#7fd8cd'), '#2a2030', 20);
  drawText('燃油', x, y + 24, { size: 10, color: p.fuel < 18 ? PAL.amber : '#c9b48c' });
  drawText(`${Math.ceil(p.fuel)}%`, x + w, y + 25, { size: 8, color: '#d4c6a6', align: 'right', mono: true });
  segBar(x, y + 27, w, 4, p.fuel / 100, p.burning ? '#ffb347' : '#c2913e', '#2a2030', 20);
  let fx = x;
  for (let i = 0; i < 3; i++) {
    rect(fx + i * 9, y + 33, 6, 4, i < p.flares ? '#ffd27a' : '#3a2a2a');
    rectLine(fx + i * 9, y + 33, 6, 4, '#0b0912');
  }
  drawText('干扰', fx + 30, y + 39, { size: 10, color: '#a99276' });
  if (p.flareCd > 0.1) drawText(`${p.flareCd.toFixed(0)}`, fx + 52, y + 39, { size: 8, color: '#8f7a5e' });
  if (p.burning) drawText('加力', x + w + 2, y + 39, { size: 10, color: '#ffb347', align: 'left' });
}

function hudRegions() {
  const W = VW, H = VH;
  return [
    { left: -Infinity, right: 132, top: -Infinity, bottom: 128 },
    { left: W - 136, right: Infinity, top: -Infinity, bottom: 64 },
    { left: -Infinity, right: 100, top: 116, bottom: 172 },
    { left: W - 100, right: Infinity, top: 116, bottom: 172 },
    { left: W / 2 - 120, right: W / 2 + 120, top: -Infinity, bottom: 64 },
    { left: W / 2 - 84, right: W / 2 + 84, top: H - 56, bottom: Infinity },
    { left: W - 86, right: Infinity, top: H - 98, bottom: Infinity },
  ];
}

function hudBlocked(x, y) {
  return hudRegions().some(r => x > r.left && x < r.right && y > r.top && y < r.bottom);
}

function defenseContactName(target) {
  if (target.isGround) return target.type === 'sam' ? '防空' : '装甲';
  if (!G.defenseStage) return '敌机';
  if (target.kind === 'drone') return '无人机';
  if (target.kind === 'fighter') return '战斗机';
  if (target.kind === 'transport') return '运输机';
  return '敌机';
}

function drawTargetMarkers(lockingColor, windscreen, drawReadout) {
  const p = G.player;
  let targets = collectTargets();
  const lock = G.lock.phase !== 'search' && G.lock.target;
  if (drawReadout && lock && targets.includes(lock)) targets = [lock, ...targets.filter(t => t !== lock)];
  let count = 0;
  for (const t of targets) {
    if (count > 10) break;
    const d = vdist(p.pos, t.pos);
    if (d > 3400) continue;
    if (targetConcealed(t)) continue;
    const s = {};
    if (!projectTargetMarker({ x: t.pos.x, y: t.pos.y + (t.isGround ? 2 : 1.2), z: t.pos.z }, s, t)) continue;
    if (s.edge) {
      if (!windscreen) drawEdgeCue(s, d, t, lockingColor);
      continue;
    }
    if (!s.visible) {
      // edge cue for off-screen enemies
      if (!windscreen && !t.isGround && d < 3200 && s.w > 0) drawEdgeCue(s, d, t, lockingColor);
      continue;
    }
    // never scribble target brackets over the fixed instrument panels
    if (windscreen && (s.x < 8 || s.x > VW - 8 || s.y + 8 > windscreen.bottom)) continue;
    if (hudBlocked(s.x, s.y)) continue;
    count++;
    const isLock = G.lock.target === t && (!lockingColor || G.lock.phase !== 'search');
    const pendingColor = isLock && G.lock.phase === 'locking' ? lockingColor : undefined;
    const isTracked = windscreen?.target === t;
    const isDrone = t.kind === 'drone';
    const col = isLock ? pendingColor || PAL.goldHot : (isTracked ? windscreen.color : isDrone ? '#ff9083' : '#ffc25e');
    const a = clamp01(0.9 - Math.max(0, d - 2100) / 2200);
    const compactLock = !!p.lockRadius;
    const r = isLock ? (compactLock ? 8 : 12) : (isDrone ? 8 : 7);
    const x = Math.round(s.x), y = Math.round(s.y);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(8,6,12,0.9)';
    ctx.lineWidth = 3;
    drawBracket(x, y, r + 1, isLock ? 'diamond' : 'square', ctx);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    drawBracket(x, y, r, isLock ? 'diamond' : 'square', ctx);
    if (!isLock && !isDrone) {
      ctx.fillStyle = col;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.restore();
    if (isLock) {
      const locked = G.lock.phase === 'locked';
      const ringCol = locked ? PAL.goldHot : pendingColor || '#c4f4e9';
      const pulse = 0.5 + 0.5 * Math.sin(G.realTime * (locked ? 5.5 : 8.5));
      const rad = r + (compactLock ? 7 : 17) + pulse * (compactLock ? 1 : 2);
      const rot = G.realTime * (locked ? 2.2 : 3.4);
      ctx.save();
      ctx.globalAlpha = 0.95;
      // heavy dark base: the ring stays readable over bright snow and clouds
      ctx.strokeStyle = 'rgba(6,8,12,0.85)';
      ctx.lineWidth = compactLock ? 3 : 5;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.stroke();
      // rotating segmented highlight ring
      ctx.strokeStyle = ringCol;
      ctx.lineWidth = compactLock ? 1 : 2;
      for (let i = 0; i < 8; i++) {
        const a0 = rot + i * TAU / 8;
        ctx.beginPath(); ctx.arc(x, y, rad, a0, a0 + TAU / 8 - 0.22); ctx.stroke();
      }
      // four cardinal ticks outside the ring
      ctx.lineWidth = compactLock ? 1 : 2;
      for (let i = 0; i < 4; i++) {
        const a = rot * 0.5 + i * TAU / 4;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(x + ca * (rad + (compactLock ? 2 : 3)), y + sa * (rad + (compactLock ? 2 : 3)));
        ctx.lineTo(x + ca * (rad + (compactLock ? 5 : 8)), y + sa * (rad + (compactLock ? 5 : 8)));
        ctx.stroke();
      }
      // lock-on progress ring just inside the brackets
      const prog = clamp01(G.lock.progress);
      ctx.strokeStyle = 'rgba(6,8,12,0.9)';
      ctx.lineWidth = compactLock ? 2 : 4;
      const progressRadius = r + (compactLock ? 3 : 6);
      ctx.beginPath(); ctx.arc(x, y, progressRadius, 0, TAU); ctx.stroke();
      ctx.strokeStyle = ringCol;
      ctx.lineWidth = compactLock ? 1 : 2;
      ctx.beginPath(); ctx.arc(x, y, progressRadius, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, prog) * TAU); ctx.stroke();
      if (locked && !compactLock) {
        // slow expanding confirmation echo
        ctx.globalAlpha = 0.28 + 0.4 * (1 - pulse);
        ctx.strokeStyle = '#fff3c2';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, rad + 4 + (1 - pulse) * 6, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
    if (drawReadout) {
      drawReadout(t, { x, y, r, d, col, isLock, isTracked });
      continue;
    }
    const distY = isLock ? y + 46 : y + r + 13;
    if (!isTracked) drawText(`${d > 1000 ? (d / 1000).toFixed(1) + 'K' : Math.round(d)}`, x, distY, {
      size: 8, color: col, align: 'center', shadow: '#0b0912', mono: true
    });
    const above = y - (isLock ? 44 : r + 7);
    const labelY = hudBlocked(x, above) || hudBlocked(x, above - 19) ? y + (isLock ? 84 : r + 42) : above;
    if (!isTracked) drawText(defenseContactName(t), x, labelY, {
      size: 10, color: col, align: 'center', alpha: 0.9, shadow: '#0b0912'
    });
    if (isDrone || G.defenseStage && !t.isGround) {
      const barX = clamp(x - 21, 3, VW - 45);
      const barY = Math.max(4, labelY - 19);
      drawTargetHealth(t, barX, barY);
    }
    if (isLock && !isTracked) {
      if (G.lock.phase === 'locked') {
        drawText('已锁定', x, y + 59, {
          size: 10, color: PAL.goldHot, align: 'center', shadow: '#0b0912'
        });
      } else if (pendingColor) {
        drawText(`锁定中 ${Math.floor(G.lock.progress * 100)}%`, x, y + 59, {
          size: 10, color: pendingColor, align: 'center', shadow: '#0b0912'
        });
      } else {
        const pctStr = `${Math.floor(G.lock.progress * 100)}%`;
        const lw = textWidth('锁定中', 10);
        const pw = textWidth(pctStr, 9, true);
        const left = x - (lw + 4 + pw) / 2;
        drawText('锁定中', left, y + 59, { size: 10, color: '#f0e3c6', shadow: '#0b0912' });
        drawText(pctStr, left + lw + 4, y + 59, { size: 9, color: '#f0e3c6', mono: true, shadow: '#0b0912' });
      }
    }
  }
}

// 友军标记只读取 G.allies，不进入锁定、目标数组或敌方威胁统计。
function drawWingmanMarker(opts = {}) {
  const wingman = G.allies?.[0];
  if (!wingman || wingman.dead || !G.player) return;
  const s = {};
  if (!projectToScreen({ x: wingman.pos.x, y: wingman.pos.y + 1.2, z: wingman.pos.z }, s) || !s.visible) return;
  if (s.x < 8 || s.x > VW - 8 || s.y < 8) return;
  if (opts.bottom !== undefined && s.y + 8 > opts.bottom) return;
  if (hudBlocked(s.x, s.y)) return;
  const distance = vdist(G.player.pos, wingman.pos);
  const x = Math.round(s.x), y = Math.round(s.y);
  ctx.save();
  ctx.globalAlpha = .92;
  ctx.strokeStyle = 'rgba(8,6,12,0.9)'; ctx.lineWidth = 3;
  drawBracket(x, y, 7, 'square', ctx);
  ctx.strokeStyle = '#9fe6c8'; ctx.lineWidth = 1;
  drawBracket(x, y, 7, 'square', ctx);
  ctx.restore();
  drawText('僚机', x, y - 12, { size: 6, color: '#9fe6c8', align: 'center', shadow: '#0b0912' });
  drawText(`${(distance / 1000).toFixed(1)}`, x, y + 16, { size: 5, color: '#9fe6c8', align: 'center', alpha: .72, shadow: '#0b0912' });
}

function drawTargetHealth(t, x, y) {
  const hp = clamp01(t.hp / (t.maxHp ?? DRONE_MAX_HP));
  rect(x, y, 42, 6, '#101922');
  rect(x + 1, y + 1, 40 * hp, 4, hp > .5 ? '#69d5a2' : hp > .25 ? '#dfb466' : '#e67468');
  rectLine(x, y, 42, 6, '#93a7ad');
}

function drawBracket(x, y, r, shape, c) {
  const k = Math.max(3, Math.round(r * 0.55));
  if (shape === 'square') {
    c.beginPath();
    c.moveTo(x - r, y - r + k); c.lineTo(x - r, y - r); c.lineTo(x - r + k, y - r);
    c.moveTo(x + r - k, y - r); c.lineTo(x + r, y - r); c.lineTo(x + r, y - r + k);
    c.moveTo(x - r, y + r - k); c.lineTo(x - r, y + r); c.lineTo(x - r + k, y + r);
    c.moveTo(x + r - k, y + r); c.lineTo(x + r, y + r); c.lineTo(x + r, y + r - k);
    c.stroke();
  } else {
    const d = Math.round(r * 0.72);
    c.beginPath();
    c.moveTo(x, y - d - 3); c.lineTo(x + 3, y - d + 1); c.lineTo(x + d + 3, y - d + 1);
    c.moveTo(x, y - d - 3); c.lineTo(x - 3, y - d + 1); c.lineTo(x - d - 3, y - d + 1);
    c.moveTo(x, y + d + 3); c.lineTo(x + 3, y + d - 1); c.lineTo(x + d + 3, y + d - 1);
    c.moveTo(x, y + d + 3); c.lineTo(x - 3, y + d - 1); c.lineTo(x - d - 3, y + d - 1);
    c.moveTo(x - d - 3, y - 2); c.lineTo(x - d - 3, y + 2);
    c.moveTo(x + d + 3, y - 2); c.lineTo(x + d + 3, y + 2);
    c.stroke();
  }
}

function drawEdgeCue(s, d, t, lockingColor) {
  const cx = VW / 2, cy = VH / 2;
  let dx = s.x - cx, dy = s.y - cy;
  if (!isFinite(dx) || !isFinite(dy)) return;
  const margin = 18;
  const sx = (VW / 2 - margin) / Math.max(1, Math.abs(dx));
  const sy = (VH / 2 - margin) / Math.max(1, Math.abs(dy));
  const f = Math.min(sx, sy);
  const x = cx + dx * f, y = cy + dy * f;
  const a = Math.atan2(dy, dx);
  ctx.save();
  const selected = G.lock.target === t && (!lockingColor || G.lock.phase !== 'search');
  const color = selected ? (G.lock.phase === 'locking' && lockingColor || '#ffe39a') : '#ff9b8c';
  ctx.globalAlpha = selected ? .95 : .45;
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
  ctx.restore();
  const status = selected && s.edge ? (G.lock.phase === 'locked' ? '已锁定 ' : '锁定中 ') : '';
  const type = G.defenseStage ? `${defenseContactName(t)} ` : '';
  drawText(`${status}${type}${(d / 1000).toFixed(1)}`, x - Math.cos(a) * 10, y - Math.sin(a) * 10 + 3, {
    size: 5, color: selected ? color : '#ffb2a3', align: 'center', alpha: selected ? 1 : .6, shadow: '#0b0912'
  });
}

function drawAimReticle(lockingColor = '#f0d39a') {
  if (G.view === 0) {
    if (!TOUCH.active && !(INPUT.mouseSteerAge < MOUSE_STEER_TIMEOUT)) return;
    // 仅在实际鼠标或触控瞄准时绘制，闲置光标不能盖住近距机身。
    const x = Math.round(INPUT.mx), y = Math.round(INPUT.my);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#bfe9de';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 13, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 13);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const { x: cx, y: cy } = playerGunSight();
  const p = G.player;
  const col = G.lock.phase === 'locked' ? '#ffe39a' : (G.lock.phase === 'locking' ? lockingColor : '#b7e5db');
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = 'rgba(8,6,12,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 14, 0, TAU); ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  // four segmented arcs
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI / 2 + 0.28, a1 = (i + 1) * Math.PI / 2 - 0.28;
    ctx.beginPath(); ctx.arc(cx, cy, 14, a0, a1); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy); ctx.lineTo(cx - 16, cy);
  ctx.moveTo(cx + 16, cy); ctx.lineTo(cx + 20, cy);
  ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy - 16);
  ctx.moveTo(cx, cy + 16); ctx.lineTo(cx, cy + 20);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
  ctx.restore();
}

function drawThreats() {
  if (!G.threatList.length) return;
  const cx = VW / 2, cy = VH / 2;
  let nearest = 1e9;
  for (const t of G.threatList) nearest = Math.min(nearest, t.d);
  const pulse = 0.55 + 0.45 * Math.sin(G.realTime * 14);
  for (const t of G.threatList) {
    const ang = t.ang || 0;
    const r = 54;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.4 * pulse;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = '#ff5a4e';
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  drawText('导弹来袭', cx, 94, {
    size: 12, color: '#ff6b5e', align: 'center', alpha: 0.55 + 0.45 * pulse,
    outline: '#13080b', spacing: 1, bold: true
  });
  const nStr = String(Math.round(nearest));
  const nW = textWidth(nStr, 9, true);
  const nLeft = cx - (nW + 13) / 2;
  drawText(nStr, nLeft, 105, { size: 9, color: '#ffb1a6', mono: true, shadow: '#13080b' });
  drawText('米', nLeft + nW + 4, 105, { size: 10, color: '#ffb1a6', shadow: '#13080b' });
}

function drawWarnings() {
  const p = G.player;
  const cx = VW / 2;
  const y = VH - (G.cockpitAlpha > 0.4 ? 112 : 44);
  const pulse = Math.sin(G.realTime * 10) > 0;
  if (p.terrainWarn && G.mode === 'play' && pulse) {
    drawText('拉起！', cx, y, {
      size: 14, color: '#ff5a4e', align: 'center', outline: '#120709', spacing: 1, bold: true
    });
  }
  if (p.agl < 90 && G.mode === 'play') {
    drawText('低空', cx, y - 16, { size: 10, color: '#ffb347', align: 'center', shadow: '#0b0912' });
  }
  if (p.inCloud > 0.28) {
    drawText('云中', cx + 70, VH - (G.cockpitAlpha > 0.4 ? 122 : 54), { size: 10, color: '#d6d0e2', align: 'center', shadow: '#0b0912' });
  } else if (p.skimming) {
    drawText('掠飞', cx + 70, VH - (G.cockpitAlpha > 0.4 ? 122 : 54), { size: 10, color: '#a8e6dd', align: 'center', shadow: '#0b0912' });
  }
  if (p.shield < 25 && G.mode === 'play') {
    drawText('护盾告急', cx, 120, { size: 11, color: '#ff6b5e', align: 'center', alpha: pulse ? 1 : 0.5, shadow: '#0b0912' });
  }
  if (p.fuel < 18) {
    drawText('燃油告急', cx, 132, { size: 10, color: '#ffb347', align: 'center', alpha: pulse ? 1 : 0.6, shadow: '#0b0912' });
  }
}

function drawWeaponPips() {
  const p = G.player;
  const cx = VW / 2;
  const y = VH - 26;
  panel(cx - 74, y - 5, 150, 27, { alpha: 0.34, fill: '#0c0912', stroke: '#3f342a', border: false });
  drawText('导弹', cx - 46, y + 8, { size: 10, color: '#d8bd94', align: 'right' });
  for (let i = 0; i < 4; i++) {
    const x = cx - 38 + i * 12;
    const ready = i < p.missiles;
    // reload progress for the next round
    const rt = (!ready && i === p.missiles && p.reloads.length) ? clamp01(1 - p.reloads[0] / MISSILE_RELOAD) : 0;
    drawMissilePip(x, y, ready, rt);
  }
  drawText(`${p.missiles}`, cx + 22, y + 9, { size: 8, color: PAL.cream });
  drawText('干扰', cx + 36, y + 8, { size: 10, color: '#cdb57f' });
  drawText(`${p.flares}`, cx + 58, y + 8, { size: 9, color: '#cdb57f', mono: true });
  if (p.reloads.length) {
    const next = Math.max(0, p.reloads[0]).toFixed(1);
    const rw = textWidth(next, 9, true);
    const lw = textWidth('装填', 9);
    const left = cx - 12 - (lw + 4 + rw) / 2;
    drawText('装填', left, y + 27, { size: 9, color: '#a99276' });
    drawText(next, left + lw + 4, y + 27, { size: 9, color: '#a99276', mono: true });
  }
}

// -------------------------------------------------------------- radar -------
function ensureRadarCanvas() {
  if (RADAR.canvas) return;
  RADAR.canvas = document.createElement('canvas');
  RADAR.canvas.width = 56; RADAR.canvas.height = 56;
  RADAR.rctx = RADAR.canvas.getContext('2d');
  RADAR.rctx.imageSmoothingEnabled = false;
}

function updateRadarMap() {
  if (!G.map || !G.player) return;
  ensureRadarCanvas();
  const p = G.player;
  if (G.realTime - RADAR.lastT < 0.32 && hdist(p.pos, { x: RADAR.lastX, z: RADAR.lastZ }) < 55) return;
  RADAR.lastT = G.realTime;
  RADAR.lastX = p.pos.x; RADAR.lastZ = p.pos.z;
  const N = 56, range = 3000;
  const img = RADAR.rctx.createImageData(N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const wx = p.pos.x + (x - N / 2 + 0.5) / N * range * 2;
      const wz = p.pos.z + (y - N / 2 + 0.5) / N * range * 2;
      const h = G.map.heightAt(wx, wz);
      const f = G.map.forestAt(wx, wz);
      let r, g, b;
      if (h < 0) { r = 16; g = 15; b = 17; }
      else {
        const hv = clamp01(h / 800);
        r = 70 + hv * 150;
        g = 46 + hv * 92 - f * 26;
        b = 18 + hv * 22;
        if (h > 620) { r += 35; g += 30; b += 25; }
        if (h < 8) { r = 110; g = 86; b = 40; }
      }
      const i = (y * N + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  RADAR.rctx.putImageData(img, 0, 0);
}

function drawDefenseRadarContact(target, x, y) {
  if (target.isGround) {
    rectLine(x - 2, y - 2, 5, 5, '#e1bdff');
  } else if (target.kind === 'transport') {
    rect(x - 4, y - 1, 9, 3, '#ffd483');
    rect(x - 1, y - 2, 3, 5, '#fff0cc');
  } else if (target.kind === 'fighter') {
    ctx.fillStyle = '#fff0cc';
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 3, y + 2); ctx.lineTo(x - 3, y + 2); ctx.closePath(); ctx.fill();
  } else {
    circleFill(x, y, 1.8, '#ff8f84');
  }
}

function drawRadarScope(cx, cy, r, detailed = false) {
  updateRadarMap();
  const range = 2800;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  rect(cx - r, cy - r, r * 2, r * 2, '#141008');
  // ground map
  ctx.globalAlpha = detailed ? 0.9 : 0.72;
  ctx.drawImage(RADAR.canvas, cx - r, cy - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  // dark scope shading
  ctx.fillStyle = 'rgba(18,12,8,0.30)';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // range rings
  ctx.strokeStyle = 'rgba(255,180,63,0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.98, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  // scanlines
  ctx.globalAlpha = 0.12;
  for (let yy = cy - r; yy < cy + r; yy += 3) rect(cx - r, yy, r * 2, 1, '#ffca6a');
  ctx.globalAlpha = 1;
  // sweep
  const sweep = G.time * 1.9;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(sweep);
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#ffbb55';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, -0.5, 0); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r, 0); ctx.stroke();
  ctx.restore();
  // ground targets
  for (const g of G.ground) {
    if (g.dead) continue;
    const dx = (g.pos.x - G.player.pos.x) / range * r;
    const dz = (g.pos.z - G.player.pos.z) / range * r;
    if (dx * dx + dz * dz > (r - 2) * (r - 2)) continue;
    const x = cx + dx, y = cy + dz;
    if (G.defenseStage) { drawDefenseRadarContact(g, x, y); continue; }
    ctx.fillStyle = '#ffd27a';
    if (g.type === 'sam') {
      ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.lineTo(x + 2, y); ctx.lineTo(x, y + 2); ctx.lineTo(x - 2, y); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    }
  }
  // enemies
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (targetConcealed(e)) continue;
    const dx = (e.pos.x - G.player.pos.x) / range * r;
    const dz = (e.pos.z - G.player.pos.z) / range * r;
    if (dx * dx + dz * dz > (r - 2) * (r - 2)) continue;
    const x = cx + dx, y = cy + dz;
    if (G.defenseStage) { drawDefenseRadarContact(e, x, y); continue; }
    const a = 0.55 + 0.45 * Math.sin(G.realTime * 5 + e.engineSeed);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ff7a62';
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    ctx.fillStyle = '#fff1d0';
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    ctx.globalAlpha = 1;
  }
  // wingman — mint diamond, never a threat ring
  for (const a of G.allies || []) {
    if (a.dead) continue;
    const dx = (a.pos.x - G.player.pos.x) / range * r;
    const dz = (a.pos.z - G.player.pos.z) / range * r;
    if (dx * dx + dz * dz > (r - 2) * (r - 2)) continue;
    const x = cx + dx, y = cy + dz;
    ctx.fillStyle = '#9fe6c8';
    ctx.beginPath(); ctx.moveTo(x, y - 2.5); ctx.lineTo(x + 2.5, y); ctx.lineTo(x, y + 2.5); ctx.lineTo(x - 2.5, y); ctx.closePath(); ctx.fill();
  }
  // missiles — bright warning tracks
  for (const m of G.missiles) {
    if (m.dead || m.owner !== 'enemy') continue;
    const dx = (m.pos.x - G.player.pos.x) / range * r;
    const dz = (m.pos.z - G.player.pos.z) / range * r;
    if (dx * dx + dz * dz > (r - 2) * (r - 2)) continue;
    const blink = Math.sin(G.realTime * 22) > 0;
    ctx.fillStyle = blink ? '#ff5a4e' : '#ffd27a';
    ctx.fillRect(Math.round(cx + dx) - 1, Math.round(cy + dz) - 1, 2, 2);
  }
  // ownship
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(G.player.yaw);
  ctx.fillStyle = '#d9f6ee';
  ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 3); ctx.lineTo(0, 1.5); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
  ctx.restore();
  // compass marks
  ctx.fillStyle = 'rgba(255,203,115,0.8)';
  ctx.font = '6px Silkscreen';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - r + 8);
  ctx.fillStyle = 'rgba(255,203,115,0.45)';
  ctx.fillText('S', cx, cy + r - 3);
  ctx.fillText('E', cx + r - 5, cy + 3);
  ctx.fillText('W', cx - r + 5, cy + 3);
  ctx.restore();
  ctx.strokeStyle = '#8a6f47';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r + 0.5, 0, TAU); ctx.stroke();
  // missile warning ring
  if (G.threatList.length) {
    const pulse = 0.4 + 0.6 * (Math.sin(G.realTime * 16) * 0.5 + 0.5);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ff5a4e';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, TAU); ctx.stroke();
    ctx.restore();
    drawText('导弹', cx, cy - r - 5, { size: 8, color: '#ff7a62', align: 'center', shadow: '#0b0912' });
  }
  drawText('雷达 2.8', cx - r + 5, cy - r + 9, {
    size: 9, color: '#ffcb73', align: 'left', shadow: '#0a0705'
  });
}

function drawMiniRadar() {
  const r = 34;
  const x = INPUT.touchMode ? 46 : VW - 44;
  const y = VH - 44;
  drawRadarScope(x, y, r, false);
}

// -------------------------------------------------------------- cockpit -----
function drawCockpit(alpha) {
  if (alpha <= 0.01) return;
  const p = G.player;
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const panelTop = VH - 100;

  // canopy frame
  ctx.fillStyle = '#17121e';
  ctx.fillRect(0, 0, VW, 4);
  ctx.fillStyle = '#0d0a12';
  ctx.fillRect(0, 4, VW, 1);
  // side bolsters
  ctx.fillStyle = '#1b1622';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(VW * 0.135, 0); ctx.lineTo(VW * 0.105, 96);
  ctx.lineTo(VW * 0.055, panelTop); ctx.lineTo(0, panelTop);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(VW, 0); ctx.lineTo(VW * 0.865, 0); ctx.lineTo(VW * 0.895, 96);
  ctx.lineTo(VW * 0.945, panelTop); ctx.lineTo(VW, panelTop);
  ctx.closePath(); ctx.fill();
  // frame highlights
  ctx.strokeStyle = '#3a3040';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1, 5); ctx.lineTo(VW * 0.132, 5); ctx.lineTo(VW * 0.102, 95);
  ctx.moveTo(VW - 1, 5); ctx.lineTo(VW * 0.868, 5); ctx.lineTo(VW * 0.898, 95);
  ctx.stroke();
  // canopy bow
  ctx.fillStyle = '#221b2a';
  ctx.beginPath();
  ctx.moveTo(VW * 0.44, 0); ctx.lineTo(VW * 0.56, 0); ctx.lineTo(VW * 0.545, 8);
  ctx.lineTo(VW * 0.455, 8); ctx.closePath(); ctx.fill();
  // glass glare streaks
  ctx.globalAlpha = alpha * 0.05;
  ctx.fillStyle = '#ffe2bd';
  ctx.beginPath(); ctx.moveTo(VW * 0.16, 120); ctx.lineTo(VW * 0.30, 0); ctx.lineTo(VW * 0.37, 0); ctx.lineTo(VW * 0.23, 120); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = alpha;

  // instrument panel
  drawCockpitPanel(p, panelTop);

  ctx.restore();
}

function drawCockpitPanel(p, top) {
  const w = VW, bottom = VH;
  // panel body
  ctx.fillStyle = '#1b1623';
  ctx.fillRect(0, top, w, bottom - top);
  ctx.fillStyle = '#2c2334';
  ctx.fillRect(0, top, w, 4);
  ctx.fillStyle = '#6b563f';
  ctx.fillRect(0, top, w, 1);
  ctx.fillStyle = '#3a2f40';
  ctx.fillRect(0, top + 4, w, 1);
  // bevel glare
  ctx.globalAlpha *= 0.7;
  ctx.fillStyle = '#100d16';
  ctx.fillRect(0, bottom - 2, w, 2);
  ctx.globalAlpha /= 0.7;
  // plate seams + rivets
  ctx.fillStyle = '#0f0c15';
  for (const rx of [0.24, 0.47, 0.68]) ctx.fillRect(Math.round(w * rx), top + 6, 1, bottom - top - 8);
  ctx.fillStyle = '#3b3044';
  for (let x = 14; x < w; x += 46) { ctx.fillRect(x, top + 6, 1, 1); ctx.fillRect(x, bottom - 5, 1, 1); }

  const cy = top + 48;
  const iscale = clamp((w - 116) / 488, 0.70, 1);
  const ix = x => 8 + (x - 8) * iscale;
  const radarR = w >= 560 ? 34 : 29;
  ctx.save();
  ctx.translate(0, 0);
  // throttle quadrant
  const thrX = 9;
  rect(thrX, cy - 20, 8, 60, '#0f0c15');
  rectLine(thrX, cy - 20, 8, 60, '#4f4152');
  const thr = clamp01(p.speed / SPEED_BURN);
  const knobY = cy + 36 - Math.round(thr * 50);
  rect(thrX + 1, knobY, 6, 8, p.burning ? '#ffb347' : '#b9aa8a');
  rectLine(thrX + 1, knobY, 6, 8, '#0b0912');
  drawText('油门', thrX + 4, cy + 48, { size: 8, color: '#8f7a5e', align: 'center' });

  // warning lamps strip
  const lampDefs = [
    ['弹警', G.threatList.length > 0, '#ff5a4e'],
    ['锁定', G.lock.phase === 'locked', '#ffd27a'],
    ['地形', p.agl < 130, '#ff8a4a'],
    ['燃油', p.fuel < 18, '#ffb347'],
    ['护盾', p.shield < 30, '#ff6b5e'],
  ];
  let lx = ix(196);
  for (const [label, on, col] of lampDefs) {
    ctx.globalAlpha = 1;
    rect(lx, top + 8, 22, 8, on ? '#3a1618' : '#0f0c15');
    rectLine(lx, top + 8, 22, 8, on ? col : '#312839');
    drawText(label, lx + 11, top + 15, { size: 8, color: on ? col : '#5e5266', align: 'center' });
    lx += 25;
  }
  // local clock
  const tSec = (G.clockStart + G.missionTime) % 86400;
  const hh = Math.floor(tSec / 3600), mm = Math.floor((tSec % 3600) / 60);
  const clockX = ix(420);
  rect(clockX, top + 7, 46, 12, '#0f0c15');
  rectLine(clockX, top + 7, 46, 12, '#4f4152');
  drawText(`${pad(hh, 2)}:${pad(mm, 2)}`, clockX + 23, top + 16, { size: 7, color: '#ffcf86', align: 'center', mono: true });
  drawText('当地', clockX + 23, top + 25, { size: 8, color: '#7f6b52', align: 'center' });

  // Airspeed
  drawAirspeedGauge(ix(52), cy + 4, 24, p);
  // ADI
  drawADI(ix(112), cy + 4, 24, p);
  // Altimeter
  drawAltimeter(ix(146), top + 20, 56, 38, p);
  // turn & slip
  drawTurnSlip(ix(218), cy + 4, 15, p);
  // VSI
  drawVSI(ix(254), cy + 4, 15, p);
  // heading
  drawHeadingBox(ix(276), top + 17, 72, 26, p);
  // engines
  drawEngineDial(ix(364), cy + 6, 13, clamp01((p.burning ? 0.92 : 0.55) + (p.speed - SPEED_CRUISE) / 400), 'L');
  drawEngineDial(ix(396), cy + 6, 13, clamp01((p.burning ? 0.94 : 0.55) + (p.speed - SPEED_CRUISE) / 400), 'R');
  // radar
  drawRadarScope(VW - 48, cy + 4, radarR, true);
  // shield / fuel / weapons strip at the bottom
  const by = VH - 21;
  drawText('护盾', ix(74), by + 5, { size: 8, color: '#8f7a5e' });
  segBar(ix(100), by, 66, 5, p.shield / 100, p.shield < 25 ? PAL.red : '#7fd8cd', '#2a2030', 16);
  drawText('燃油', ix(174), by + 5, { size: 8, color: '#8f7a5e' });
  segBar(ix(198), by, 58, 5, p.fuel / 100, p.burning ? '#ffb347' : '#c2913e', '#2a2030', 14);
  drawText(`导弹 ${p.missiles}`, ix(266), by + 5, { size: 8, color: '#e5c273' });
  drawText(`干扰 ${p.flares}`, ix(302), by + 5, { size: 8, color: '#cdb57f' });
  drawText(`G ${p.gLoad.toFixed(1)}`, ix(338), by + 5, { size: 5, color: p.gLoad > 6 ? PAL.red : '#bce7e0' });
  drawText(`${pad(Math.round(p.speed * 1.94384), 3)}`, ix(378), by + 5, { size: 5, color: '#cbbd9f', mono: true });
  drawText('节', ix(394), by + 5, { size: 8, color: '#cbbd9f' });
  // radar altitude digital
  drawText('离地', ix(426), by + 5, { size: 8, color: p.agl < 130 ? '#ff9a62' : '#9fd6cc' });
  drawText(`${pad(Math.round(Math.max(0, p.agl) * 3.28084), 4)}`, ix(444), by + 5, {
    size: 5, color: p.agl < 130 ? '#ff9a62' : '#9fd6cc', mono: true
  });
  ctx.restore();

  // canopy sill / lower frame over panel edge
  ctx.fillStyle = '#221b2a';
  ctx.fillRect(0, top - 2, w, 2);
  ctx.fillStyle = '#0e0b13';
  ctx.fillRect(0, top - 3, w, 1);
}

function drawAirspeedGauge(cx, cy, r, p) {
  const knots = p.speed * 1.94384;
  circleFill(cx, cy, r, '#0e0c13');
  circleLine(cx, cy, r, '#6f5c42', 1, 1);
  circleLine(cx, cy, r - 1, '#2d2535', 1, 1);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.save();
  for (let i = 0; i <= 10; i++) {
    const a = lerp(a1, a0, i / 10); // sweep from bottom-left to bottom-right
    const x1 = cx + Math.cos(a) * (r - 3), y1 = cy - Math.sin(a) * (r - 3);
    const x2 = cx + Math.cos(a) * (r - (i % 5 === 0 ? 7 : 5)), y2 = cy - Math.sin(a) * (r - (i % 5 === 0 ? 7 : 5));
    line(x1, y1, x2, y2, i >= 8 ? '#c25945' : '#b8a47b', 1);
    if (i % 2 === 0) {
      drawText(String(i * 80), cx + Math.cos(a) * (r - 12), cy - Math.sin(a) * (r - 12) + 2, {
        size: 4, color: '#8f7a5e', align: 'center'
      });
    }
  }
  const frac = clamp01(knots / 800);
  const na = lerp(a1, a0, frac);
  line(cx, cy, cx + Math.cos(na) * (r - 7), cy - Math.sin(na) * (r - 7), '#ffd27a', 1);
  circleFill(cx, cy, 2, '#d7c49c');
  drawText('空速', cx, cy + r + 7, { size: 8, color: '#8f7a5e', align: 'center' });
  drawText(String(Math.round(knots)), cx, cy + 12, { size: 6, color: '#f0e3c6', align: 'center', mono: true });
  ctx.restore();
}

function drawADI(cx, cy, r, p) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(p.roll);
  const pitchPx = clamp(p.pitch, -1, 1) / DEG * 0.7;
  ctx.translate(0, pitchPx);
  ctx.fillStyle = '#8d7b9d';
  ctx.fillRect(-r * 2, -r * 3, r * 4, r * 3);
  ctx.fillStyle = '#443854';
  ctx.fillRect(-r * 2, 0, r * 4, r * 3);
  // sky bands
  ctx.fillStyle = 'rgba(240,182,138,0.25)';
  ctx.fillRect(-r * 2, -r * 3, r * 4, 5);
  ctx.fillStyle = 'rgba(255,214,162,0.22)';
  ctx.fillRect(-r * 2, -r * 3 + 5, r * 4, 4);
  ctx.fillStyle = '#f0d3a8';
  ctx.fillRect(-r * 2, -1, r * 4, 2);
  ctx.strokeStyle = 'rgba(240,230,205,0.7)';
  ctx.lineWidth = 1;
  for (let a = -20; a <= 20; a += 10) {
    if (a === 0) continue;
    const yy = -a * 0.7;
    const ww = Math.abs(a) === 20 ? 7 : 5;
    ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.stroke();
  }
  ctx.restore();
  // bank pointer
  ctx.save();
  ctx.strokeStyle = '#b8a47b';
  ctx.beginPath();
  for (let a = -60; a <= 60; a += 15) {
    const ang = -Math.PI / 2 + a * DEG;
    const x1 = cx + Math.cos(ang) * (r - 2), y1 = cy + Math.sin(ang) * (r - 2);
    const x2 = cx + Math.cos(ang) * (r - (Math.abs(a) % 30 === 0 ? 7 : 4));
    const y2 = cy + Math.sin(ang) * (r - (Math.abs(a) % 30 === 0 ? 7 : 4));
    line(x1, y1, x2, y2, '#d6c39a', 1);
  }
  const bankAng = -Math.PI / 2 + clamp(-p.roll, -1.2, 1.2);
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(bankAng) * (r - 1), cy + Math.sin(bankAng) * (r - 1));
  ctx.lineTo(cx + Math.cos(bankAng - 0.17) * (r - 6), cy + Math.sin(bankAng - 0.17) * (r - 6));
  ctx.lineTo(cx + Math.cos(bankAng + 0.17) * (r - 6), cy + Math.sin(bankAng + 0.17) * (r - 6));
  ctx.closePath(); ctx.fill();
  ctx.restore();
  circleLine(cx, cy, r, '#6f5c42', 1, 1);
  circleLine(cx, cy, r - 1, '#2d2535', 1, 1);
  // fixed aircraft symbol
  ctx.save();
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 11, cy); ctx.lineTo(cx - 3, cy); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx + 3, cy); ctx.lineTo(cx + 11, cy);
  ctx.stroke();
  ctx.fillStyle = '#ffd27a';
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
  ctx.restore();
  drawText('姿态', cx, cy + r + 7, { size: 8, color: '#8f7a5e', align: 'center' });
}

function drawAltimeter(x, y, w, h, p) {
  rect(x, y, w, h, '#0d0b12');
  rectLine(x, y, w, h, '#4f4152');
  const ft = Math.max(0, Math.round(p.pos.y * 3.28084));
  const digits = pad(ft, 5).split('');
  const cw = 7;
  const totalW = digits.length * cw + 3;
  let dx = x + Math.round((w - totalW) / 2) + 1;
  for (let i = 0; i < digits.length; i++) {
    rect(dx, y + 5, cw, 13, '#17131d');
    drawText(digits[i], dx + cw / 2, y + 15, { size: 8, color: i === digits.length - 1 ? '#ffd27a' : '#eadcb9', align: 'center', mono: true });
    dx += cw;
  }
  drawText('高度', x + w / 2, y + 28, { size: 8, color: '#8f7a5e', align: 'center' });
  drawText('离地', x + 4, y + 36, { size: 8, color: p.agl < 130 ? '#ff9a62' : '#9fd6cc' });
  drawText(`${pad(Math.round(Math.max(0, p.agl) * 3.28084), 4)}`, x + w - 4, y + 36, {
    size: 5, color: p.agl < 130 ? '#ff9a62' : '#9fd6cc', align: 'right', mono: true
  });
}

function drawTurnSlip(cx, cy, r, p) {
  circleFill(cx, cy, r, '#0e0c13');
  circleLine(cx, cy, r, '#6f5c42', 1, 1);
  circleLine(cx, cy, r - 1, '#2d2535', 1, 1);
  line(cx - r + 4, cy, cx + r - 4, cy, '#7d6a51', 1);
  line(cx, cy - r + 4, cx, cy + r - 4, '#7d6a51', 1);
  const turn = clamp(p.yawRate / 1.3, -1, 1);
  const nx = cx + turn * (r - 6);
  ctx.save();
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy - 3); ctx.lineTo(nx, cy + 3); ctx.stroke();
  ctx.fillStyle = '#ffd27a';
  ctx.fillRect(Math.round(nx) - 1, cy + 1, 2, 3);
  ctx.restore();
  // slip ball
  rect(cx - 7, cy + r - 8, 14, 4, '#17131d');
  rectLine(cx - 7, cy + r - 8, 14, 4, '#4f4152');
  const slip = clamp(-p.roll * 0.35, -1, 1);
  circleFill(cx + slip * 4, cy + r - 6, 1.5, '#d9c69f');
  drawText('转向', cx, cy + r + 7, { size: 8, color: '#8f7a5e', align: 'center' });
}

function drawVSI(cx, cy, r, p) {
  const vs = p.basis.fwd.y * p.speed * 196.85;
  rect(cx - 9, cy - 18, 18, 36, '#0d0b12');
  rectLine(cx - 9, cy - 18, 18, 36, '#4f4152');
  for (let i = -2; i <= 2; i++) {
    const y = cy + i * 7;
    line(cx - 7, y, cx - (i === 0 ? 3 : 5), y, '#8f7a5e', 1);
  }
  const nf = clamp(vs / 3000, -1, 1);
  const ny = cy - nf * 15;
  ctx.save();
  ctx.fillStyle = '#ffd27a';
  ctx.fillRect(cx + 2, Math.round(ny), 5, 1);
  ctx.restore();
  drawText('升降', cx, cy + 24, { size: 8, color: '#8f7a5e', align: 'center' });
  drawText(`${Math.round(vs / 100) * 100}`, cx, cy + 16, { size: 4, color: '#cbbd9f', align: 'center', mono: true });
}

function drawHeadingBox(x, y, w, h, p) {
  const deg = compassDeg(p.yaw);
  rect(x, y, w, h, '#0d0b12');
  rectLine(x, y, w, h, '#4f4152');
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h - 9); ctx.clip();
  const pxPer = 1.15;
  for (let d = -32; d <= 32; d += 10) {
    const val = ((deg + d) % 360 + 360) % 360;
    const xx = x + w / 2 + d * pxPer;
    line(xx, y + 2, xx, y + (Math.abs(d) % 30 === 0 ? 6 : 4), '#a9936d', 1);
    if (Math.abs(d) % 30 === 0) drawText(compassLabel(val), xx, y + 13, { size: 6, color: '#e6d6b4', align: 'center' });
  }
  ctx.restore();
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath(); ctx.moveTo(x + w / 2 - 2, y + h - 8); ctx.lineTo(x + w / 2 + 2, y + h - 8); ctx.lineTo(x + w / 2, y + h - 5); ctx.closePath(); ctx.fill();
  drawText(`${pad(Math.round(deg), 3)}`, x + w / 2, y + h - 0, { size: 6, color: '#ffd27a', align: 'center', mono: true });
  drawText('航向', x + w / 2, y + h + 10, { size: 8, color: '#8f7a5e', align: 'center' });
}

function drawEngineDial(cx, cy, r, val, label) {
  circleFill(cx, cy, r, '#0e0c13');
  circleLine(cx, cy, r, '#6f5c42', 1, 1);
  ctx.save();
  for (let i = 0; i <= 5; i++) {
    const a = Math.PI * 0.75 + i * Math.PI * 0.3;
    line(cx + Math.cos(a) * (r - 2), cy - Math.sin(a) * (r - 2), cx + Math.cos(a) * (r - 5), cy - Math.sin(a) * (r - 5), '#9c8968', 1);
  }
  const a = Math.PI * 0.75 + clamp01(val) * Math.PI * 1.5;
  ctx.strokeStyle = '#ffd27a';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 4), cy - Math.sin(a) * (r - 4)); ctx.stroke();
  ctx.fillStyle = '#d9c69f';
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
  if (val > 0.88) { ctx.globalAlpha = 0.5; circleLine(cx, cy, r - 2, '#ff6b4e', 1, 1); }
  ctx.restore();
  drawText(label, cx, cy + r + 6, { size: 4, color: '#8f7a5e', align: 'center' });
}

function drawBanner() {
  if (!G.banner) return;
  const b = G.banner;
  const fadeIn = clamp01(b.t / 0.35);
  const fadeOut = clamp01((b.life - b.t) / 0.6);
  const a = Math.min(fadeIn, fadeOut);
  if (a <= 0) return;
  const cx = VW / 2;
  const y = 74;
  ctx.save();
  ctx.globalAlpha = a;
  rectLine(cx - 96, y - 14, 192, 32, '#d5a955', 0.5);
  rect(cx - 94, y - 12, 188, 28, 'rgba(20,14,20,0.55)');
  drawText(b.title, cx, y + 5, { size: 14, color: '#ffe2a3', align: 'center', outline: '#120b10', spacing: 2, bold: true });
  drawText(b.sub, cx, y + 17, { size: 8, color: '#e0cba2', align: 'center', shadow: '#120b10', spacing: 0 });
  ctx.restore();
}

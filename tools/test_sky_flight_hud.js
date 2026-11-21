// 从正式截击起飞，检验实际画到飞行画布上的读数、刻度和雷达。
const check = (ok, message) => { if (!ok) throw Error(message); };
const until = performance.now() + 65000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > until) throw Error(window.__PI?.boot?.error || '空域未加载');
  await new Promise(resolve => setTimeout(resolve, 80));
}
const byId = id => document.getElementById(id);
const canvas = byId('ui'), ctx = canvas.getContext('2d'), proto = CanvasRenderingContext2D.prototype;
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
const click = id => {
  const el = byId(id), box = el.getBoundingClientRect();
  check(!el.disabled && box.width && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === el, `正式按钮不可点：${id}`);
  el.click();
};
const g = __PI.G, glyphs = new WeakMap(), original = { fillText: proto.fillText, drawImage: ctx.drawImage, clearRect: ctx.clearRect, arc: ctx.arc };
let text = [], maps = [], arcs = [];
const fontPx = context => Number(/([\d.]+)px/.exec(context.font)?.[1] || 0);
function point(x, y) {
  const tx = ctx.getTransform(), r = canvas.getBoundingClientRect();
  return { x: (x * tx.a + y * tx.c + tx.e) * r.width / canvas.width,
    y: (x * tx.b + y * tx.d + tx.f) * r.height / canvas.height,
    sy: Math.hypot(tx.c, tx.d) * r.height / canvas.height };
}
proto.fillText = function (value, x, y, ...args) {
  if (this === ctx) {
    const p = point(x, y);
    text.push({ value: String(value), x: p.x, y: p.y, size: fontPx(this) * p.sy });
  } else glyphs.set(this.canvas, { value: String(value), x, y, size: fontPx(this) });
  return original.fillText.call(this, value, x, y, ...args);
};
ctx.clearRect = function (...args) { text = []; maps = []; arcs = []; return original.clearRect.apply(this, args); };
ctx.drawImage = function (image, x, y, w, h, ...args) {
  const glyph = glyphs.get(image);
  if (glyph && args.length === 0) {
    const p = point(x + glyph.x * w / image.width, y + glyph.y * h / image.height);
    text.push({ value: glyph.value, x: p.x, y: p.y, size: glyph.size * h / image.height * p.sy });
  } else if (image.width === 56 && image.height === 56 && args.length === 0) {
    maps.push({ ...point(x, y), right: point(x + w, y + h).x, bottom: point(x + w, y + h).y });
  }
  return original.drawImage.call(this, image, x, y, w, h, ...args);
};
ctx.arc = function (x, y, r, ...args) {
  const p = point(x, y); arcs.push({ x: p.x, y: p.y, r: r * p.sy });
  return original.arc.call(this, x, y, r, ...args);
};
function has(value) { return text.some(t => t.value === value); }
function label(value) { return text.find(t => t.value === value); }
function measure(p) {
  const bounds = canvas.getBoundingClientRect();
  for (const value of ['空速', '高度', '离地', '坡度', '升降', '护盾', '燃油', '导弹', '干扰', '机炮', '加力', '得分']) {
    const t = label(value);
    check(t && t.size >= 9.8, `追尾HUD未实际绘制可读的「${value}」：${JSON.stringify(t)}`);
    check(t.x >= -1 && t.y >= 0 && t.x <= bounds.width && t.y + t.size * .25 <= bounds.height - 2, `「${value}」被画布裁切或未保留底边距`);
  }
  const speed = Math.round(p.speed * 1.94384), altitude = Math.round(p.pos.y * 3.28084);
  const primary = (value, left) => text.find(t => t.value.replaceAll(',', '') === String(value) && (t.x < bounds.width / 2) === left && t.size >= 22);
  const speedRead = primary(speed, true), altRead = primary(altitude, false);
  check(speedRead && altRead, `大字主表缺少真实空速或高度：${speed}节 / ${altitude}英尺`);
  check(speedRead.size > label('空速').size * 1.55 && altRead.size > label('高度').size * 1.55, '主数字没有明显大于小标签');
  return { speed, altitude, numberSizeCssPx: [speedRead.size, altRead.size] };
}
try {
  __SKY.home(); click('sky-intercept'); __PI.freeze(true); __PI.step(.1); await paint();
  check(g.mode === 'play' && g.view === 1, '没有从正式默认截击追尾进入');
  const p = g.player, initial = measure(p), stage = canvas.getBoundingClientRect();
  const yaw = ((Math.round(p.yaw * 180 / Math.PI) % 360) + 360) % 360;
  check(has(String(yaw).padStart(3, '0')), '顶部未实际绘制当前航向度数');
  check(has('地平线') && text.some(t => /^[+-](10|20|30|40)$/.test(t.value)), '中央缺少世界投影姿态梯线');
  check(text.some(t => t.value === `第 ${String(g.wave).padStart(2, '0')} 波`), '缺少实际任务波次');
  check(text.some(t => t.value.startsWith('雷达')), '缺少可识别的雷达标记');
  const radar = maps.find(m => m.x > stage.width * .50 && m.y > stage.height * .58);
  check(radar && arcs.some(a => Math.abs(a.x - (radar.x + radar.right) / 2) < 2 && Math.abs(a.y - (radar.y + radar.bottom) / 2) < 2 && a.r >= (radar.right - radar.x) * .45), '没有在右下实际画出带地图的圆形雷达');
  const camera = byId('sky-camera'), button = camera.getBoundingClientRect();
  check(button.right <= stage.left + radar.x || button.left >= stage.left + radar.right || button.bottom <= stage.top + radar.y || button.top >= stage.top + radar.bottom, '视角按钮遮住雷达');
  for (const id of ['sky-telemetry', 'sky-combat', 'sky-systems', 'sky-ammo-count']) {
    let el = byId(id), oldVisible = true;
    for (; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (el.hidden || style.display === 'none' || style.visibility === 'hidden' || /^inset\(50%/.test(style.clipPath)) oldVisible = false;
    }
    check(!oldVisible, `旧小面板仍重复显示：${id}`);
  }
  const fuel = p.fuel, ammo = p.missiles, flares = p.flares, shots = g.stats.shots;
  let active;
  try {
    key('ShiftLeft', true); key('KeyF', true); __PI.step(.65);
    key('KeyE', true); key('KeyE', false); key('KeyC', true); key('KeyC', false); await paint();
    active = measure(p);
    check(active.speed > initial.speed && p.fuel < fuel && has(`${Math.ceil(p.fuel)}%`), '加力后空速和燃油未跟随实际状态');
    check(has('接通') && has('连射') && g.stats.shots > shots, 'HUD未显示实际加力和机炮连射');
    check(p.missiles === ammo - 1 && text.some(t => t.value.startsWith(`${p.missiles}/4 · `)), 'HUD未显示实际导弹库存与装填');
    check(p.flares === flares - 1 && text.some(t => t.value.startsWith(`${p.flares} · `)), 'HUD未显示实际干扰库存与冷却');
  } finally { key('ShiftLeft', false); key('KeyF', false); }
  click('sky-camera'); __PI.step(1.4); await paint();
  check(g.view === 2 && g.cockpitAlpha > .99 && !has('雷达 2.8') && !maps.some(m => m.x > stage.width * .50 && m.y > stage.height * .58 && arcs.some(a => Math.abs(a.x - (m.x + m.right) / 2) < 2 && Math.abs(a.y - (m.y + m.bottom) / 2) < 2 && a.r >= (m.right - m.x) * .45)), '外部圆雷达重复盖到座舱');
  check(!text.some(t => t.size >= initial.numberSizeCssPx[0] * .9 && /^(空速|高度|得分)$/.test(t.value)), '外部主表重复盖到座舱');
  check(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify([__PI.errors, __PI.exceptions]));
  return { result: 'PASS', viewport: [innerWidth, innerHeight], initial, active, radar, errors: __PI.errors, exceptions: __PI.exceptions };
} finally {
  proto.fillText = original.fillText; ctx.drawImage = original.drawImage; ctx.clearRect = original.clearRect; ctx.arc = original.arc;
}

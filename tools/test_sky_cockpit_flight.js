// 点击正式按钮并读取真实 UI 画布；不写姿态、不换摄影机、不依赖着色函数名。
const deadline = performance.now() + 60000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > deadline) throw Error(window.__PI?.boot?.error || '游戏未就绪');
  await new Promise(r => setTimeout(r, 80));
}
const check = (v, msg) => { if (!v) throw Error(msg); };
const ui = document.getElementById('ui'), ctx = ui.getContext('2d');
const key = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles: true }));
const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const click = id => document.getElementById(id).click();
click('sky-cruise'); __PI.freeze(true); click('sky-camera'); __PI.step(4); await paint();
const g = __PI.G, p = g.player;
check(g.mode === 'play' && g.view === 2 && g.cockpitAlpha > 0.99, '没有进入正式座舱');
const w = ui.width, h = ui.height, small = w / h < 1.1, scale = h / 340;
function readPanel() {
  const data = ctx.getImageData(0, 0, w, h).data;
  function top(x) {
    const i = Math.floor(x * w); let y = h - 1;
    while (y >= 0 && data[(w * y + i) * 4 + 3] > 240) y--;
    return (y + 1) / scale;
  }
  let glass = 0, skyX = 0, skyY = 0, sky = 0, amber = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (w*y+x)*4, r = data[i], g = data[i+1], b = data[i+2];
    if (data[i+3] < 105) continue;
    if (y > h * .15 && y < h * .62 && x > w * .07 && x < w * .93 && g > r * 1.09 && g > b * 1.1 && g > 130) glass++;
    if (y < h*.68) continue;
    if (b > r + 28 && g > r + 18 && b >= g && b > 110) { skyX += x; skyY += y; sky++; }
    if (r > 70 && r > g * 1.3 && g > b * 1.6) amber++;
  }
  return { crest:top(.50), wing:top(.17), glass:Math.round(glass / scale**2), ball:sky / scale**2, ballX:skyX/(sky || 1)/scale, ballY:skyY/(sky || 1)/scale, amber:amber / scale**2 };
}
// 读取这一帧实际画出的数字，不以玩家对象变化代替仪表变化。
async function paintedText() {
  const labels = new Set(), fillText = ctx.fillText;
  ctx.fillText = function (s, ...args) { labels.add(String(s)); return fillText.call(this,s,...args); };
  try { await paint(); } finally { ctx.fillText = fillText; }
  return labels;
}
const levelLabels = await paintedText(), level = readPanel();
check(level.crest < level.wing - 5, `遮光罩仍是一条平直的横栏：${JSON.stringify(level)}`);
check(level.glass > 70, `巡航中没有可读的绿色平显：${JSON.stringify(level)}`);
check(level.amber > (small ? 260 : 780) && level.ball > (small ? 35 : 100), `方屏或蓝褐姿态球不可辨：${JSON.stringify(level)}`);
if (!small && w / h > 1.5) {
  // 主圆表的数字窗与下方铭牌之间至少应有一行空白像素，不可叠字。
  const rgba = ctx.getImageData(0,0,w,h).data, gap = [];
  for (let y = Math.round(316*scale); y < Math.round(333*scale); y++) {
    let lit = 0;
    for (let x = Math.round(w*.18); x < Math.round(w*.226); x++) {
      const k = (y*w+x)*4;
      if(rgba[k] > 180 && rgba[k+1] > 145 && rgba[k+2] < 210) lit++;
    }
    gap.push(lit);
  }
  let last = gap.findLastIndex(n => n > 0), first = gap.findIndex(n => n > 0);
  check(first >= 0 && last > first && gap.slice(first,last).some(n => n===0), `空速数字与下方标牌重叠：${gap}`);
}
const units = () => [String(Math.round(p.speed*1.94384)), String(Math.round(p.pos.y*3.28084)), 'RA '+Math.round(Math.max(0,p.pos.y-Math.max(p.groundH,0))*3.28084)];
check(units().every(s => levelLabels.has(s)), `座舱没有显示真实的空速、海拔与水面/地面净空：${units()}`);
const initial = { speed:p.speed, agl:p.agl, height:p.pos.y };
key('ShiftLeft', true); key('KeyD', true); __PI.step(.25); key('KeyD', false); await paint();
const bank = readPanel();
check(Math.abs(p.roll) > .45 && Math.abs(bank.ballX - level.ballX) > 2, `右转时座舱姿态球未侧倾：${JSON.stringify(bank)}`);
key('KeyW', true); __PI.step(.57); key('KeyW', false); __PI.step(.7); key('ShiftLeft', false); __PI.step(.8);
const climbLabels = await paintedText();
check(p.speed > initial.speed + 20 && p.pos.y > initial.height + 25, '没有从真实输入产生速度和海拔变化');
check(units().every(s => climbLabels.has(s)), `俯仰和加速后数字窗未同步：${units()}`);
const recovered = readPanel();
key('KeyQ', true); key('KeyQ', false); __PI.step(.36); await paint();
const inverted = readPanel();
check(g.camera.up.y < -.85 && inverted.ballY > recovered.ballY + (small ? 4 : 7), `桶滚时姿态球未随座舱倒置：${JSON.stringify([recovered,inverted])}`);
__PI.step(.9); await paint(); const upright = readPanel();
check(g.camera.up.y > .9 && Math.abs(upright.ballY - level.ballY) < 3, '回正后姿态球没有恢复');
check(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify([__PI.errors, __PI.exceptions]));
return { result:'PASS', size:[w,h], level, bank, inverted, upright, speed:p.speed, height:p.pos.y };

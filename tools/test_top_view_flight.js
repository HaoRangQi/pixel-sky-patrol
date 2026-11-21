// 两个正式入口共用：俯视必须画出近距真实机体，而不是黄色地图符号。
const deadline = performance.now() + 60000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > deadline) throw Error(window.__PI?.boot?.error || '游戏未就绪');
  await new Promise(resolve => setTimeout(resolve, 80));
}
const g = __PI.G, sky = !!document.getElementById('sky-intercept');
const failures = [], scenarios = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles:true }));
function cameraButton() {
  if (sky) {
    const button = document.getElementById('sky-camera');
    if (!button || button.hidden || button.disabled) throw Error('正式视角按钮不可用');
    button.click();
  } else {
    key('Space', true); key('Space', false);
  }
  __PI.step(1.4);
}
function project(point) {
  const c = g.camera, d = { x:point.x-c.pos.x, y:point.y-c.pos.y, z:point.z-c.pos.z };
  const dot = axis => d.x*axis.x+d.y*axis.y+d.z*axis.z;
  const depth = dot(c.fwd);
  if (depth <= 0) throw Error('真实机体在相机后方');
  return { x:.5+dot(c.right)/(2*depth*c.tanHalf*c.aspect), y:.5-dot(c.up)/(2*depth*c.tanHalf) };
}
function localPoint(matrix, x, y, z) {
  return { x:matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12], y:matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13], z:matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14] };
}
function axisPoint(axis, distance) {
  const p = g.player;
  return { x:p.pos.x+axis.x*distance, y:p.pos.y+axis.y*distance, z:p.pos.z+axis.z*distance };
}
function screenHeading() {
  const p = g.player, a = project(axisPoint(p.renderBasis.fwd, 6)), b = project(axisPoint(p.renderBasis.fwd, -5));
  return Math.atan2(a.x-b.x, (b.y-a.y)/g.camera.aspect);
}
const hud = document.getElementById('ui'), ctx = hud.getContext('2d');
const { renderer } = __PI, render = renderer.render;
let playerMatrix = null;
renderer.render = function(camera, map, time, objects, options) {
  const player = objects.find(object => object.mesh === g.meshes.player);
  playerMatrix = player ? Array.from(player.matrix) : null;
  return render.call(this, camera, map, time, objects, options);
};
try {
  for (const mode of sky ? ['cruise', 'intercept'] : ['intercept']) {
    if (sky) {
      __SKY.home();
      document.getElementById(`sky-${mode}`).click();
    } else {
      key('Enter', true); key('Enter', false);
    }
    __PI.freeze(true); __PI.step(.1);
    const label = `${sky ? '新版' : '根入口'}/${mode}`;
    check(g.mode === 'play' && g.view === 1, `${label}没有从正式追尾起飞`);
    cameraButton();
    check(g.view === 2 && g.cockpitAlpha > .99, `${label}原座舱切换被破坏`);
    cameraButton(); await paint();
    check(g.mode === 'play' && g.view === 0, `${label}没有进入实际俯视玩法`);
    const p = g.player, c = g.camera, distance = c.pos.y-p.pos.y, center = project(p.pos);
    check(distance > 15 && distance < 100, `${label}仍是远距战术地图：高度差${distance.toFixed(2)}米`);
    check(c.fwd.y < -.9999 && c.up.z < -.9999 && Math.abs(c.right.y) < .001, `${label}俯视没有保持北向或随机身翻斜`);
    check(Math.abs(center.x-.5) < .04 && Math.abs(center.y-.5) < .08, `${label}真实机身不在画面中部`);
    check(!!playerMatrix && g.meshes.player.count >= 300, `${label}没有将真实玩家网格提交给渲染器`);
    let span = 0, length = 0;
    if (playerMatrix) {
      const left = project(localPoint(playerMatrix, -4.9, 0, 1.3)), right = project(localPoint(playerMatrix, 4.9, 0, 1.3));
      const nose = project(localPoint(playerMatrix, 0, 0, -6.5)), tail = project(localPoint(playerMatrix, 0, 0, 4.5));
      span = Math.hypot(right.x-left.x, (right.y-left.y)/c.aspect);
      length = Math.hypot((nose.x-tail.x)*c.aspect, nose.y-tail.y);
      const minSpan = c.aspect > 2.3 ? .14 : .17;
      check(span > minSpan && span < (c.aspect < 1 ? .80 : .34), `${label}真实机翼仍过小或被裁切：画宽占比${span.toFixed(4)}`);
      check(length > .33 && length < .65, `${label}真实机身长度不够清楚：画高占比${length.toFixed(4)}`);
    }
    const scale = hud.height/340, radius = Math.max(3, Math.round(4*scale));
    const rgba = ctx.getImageData(Math.round(center.x*hud.width)-radius, Math.round(center.y*hud.height)-radius, 2*radius, 2*radius).data;
    let yellow = 0;
    for (let i=0; i<rgba.length; i+=4) if (rgba[i+3]>230 && rgba[i]>180 && rgba[i+1]>120 && rgba[i+1]<rgba[i] && rgba[i+2]<170) yellow++;
    check(yellow < 4*scale*scale, `${label}仍用黄色地图飞机符号覆盖真实机体：${yellow}像素`);
    // 比对实际Canvas线端和真实机体矩阵，平飞、转向、桶滚分别检查。
    async function checkWingAttachment(state) {
      const wingLines = [], oldLine = ctx.lineTo;
      ctx.lineTo = function(x,y) { if (String(this.strokeStyle).toLowerCase() === '#e8f1f4') wingLines.push([x,y]); return oldLine.call(this,x,y); };
      try { await paint(); } finally { ctx.lineTo = oldLine; }
      const VW = hud.width / scale;
      const attached = playerMatrix && [-1,1].every(side => {
        const tip = project(localPoint(playerMatrix, side*4.9, sky ? 0 : .235, sky ? 1.3 : 2.675));
        return wingLines.some(([x,y]) => Math.hypot(x-tip.x*VW, y-tip.y*340) < 1);
      });
      check(attached, `${label}${state}两道尾迹没有接到当帧真实翼尖`);
    }
    await checkWingAttachment('平飞');
    const heading = screenHeading(), yaw = p.yaw;
    key('KeyD', true); __PI.step(.32); key('KeyD', false); __PI.step(.18);
    const turned = Math.atan2(Math.sin(screenHeading()-heading), Math.cos(screenHeading()-heading));
    check(Math.abs(p.yaw-yaw) > .04 && Math.abs(turned) > .04 && g.camera.up.z < -.9999, `${label}真实转向没有带动机鼻投影，或北向背景跟着旋转`);
    await checkWingAttachment('转向');
    key('KeyQ', true); key('KeyQ', false); __PI.step(.2);
    check(Math.abs(p.spin) > .1, `${label}真实桶滚没有发生`);
    await checkWingAttachment('桶滚');
    __PI.step(.6);
    const beforeShots = g.stats.shots, beforeMissiles = p.missiles;
    key('KeyF', true); key('KeyF', false);
    check(g.stats.shots === beforeShots+1 && g.bullets.some(bullet => bullet.owner === 'player'), `${label}俯视不能发射实体机炮`);
    key('KeyE', true); key('KeyE', false);
    check(p.missiles === beforeMissiles-1 && g.missiles.some(missile => missile.owner === 'player'), `${label}俯视不能发射实体导弹`);
    scenarios.push({ mode, view:g.view, distance, center, span, length, yellow, turned, shots:g.stats.shots-beforeShots, missiles:beforeMissiles-p.missiles });
    cameraButton();
    check(g.mode === 'play' && g.view === 1, `${label}俯视不能切回正后追尾`);
  }
} finally {
  key('KeyD', false); key('KeyF', false); key('KeyE', false);
  renderer.render = render;
}
check(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify([__PI.errors, __PI.exceptions]));
if (failures.length) throw Error(`${failures.join('；')}\n实测：${JSON.stringify(scenarios)}`);
return { result:'PASS', entry:sky ? 'sky-patrol' : 'root', scenarios };

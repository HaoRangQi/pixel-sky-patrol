// 从正式巡航起飞，检查两条世界尾流在平飞时从新机的真实出流边开始。
const deadline = performance.now() + 60000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > deadline) throw Error(window.__PI?.boot?.error || '游戏未就绪');
  await new Promise(r => setTimeout(r,80));
}
const check = (value, message) => { if (!value) throw Error(message); };
const g = __PI.G;
document.getElementById('sky-cruise').click(); __PI.freeze(true); __PI.step(1.15);
const p = g.player, sides = [-1,1].map(side => g.vapor.filter(sample => sample.side === side));
check(sides.every(trail => trail.length >= 5), `平飞时没有持续的两道翼流：${sides.map(x => x.length)}`);
const relative = (v, axis) => (v.x-p.pos.x)*axis.x+(v.y-p.pos.y)*axis.y+(v.z-p.pos.z)*axis.z;
for (const [i, trail] of sides.entries()) {
  const newest = trail.at(-1), distance = relative(newest.pos,p.basis.fwd);
  check(Math.abs(relative(newest.pos,p.basis.right) - (i ? 4.9 : -4.9)) < 1e-4, '两道尾流没有分别挂在两侧的翼尖');
  check(distance <= -1.299 && distance > -1.30 - 7, `尾流没有从后掠翼的后缘采样：${distance}`);
}
const ctx = document.getElementById('ui').getContext('2d');
const tips = sides.map((_,i) => {
  const side = i ? 4.9 : -4.9, b = p.renderBasis;
  return { x:p.pos.x + side*b.right.x-1.3*b.fwd.x, y:p.pos.y + side*b.right.y-1.3*b.fwd.y, z:p.pos.z + side*b.right.z-1.3*b.fwd.z };
});
const cam = g.camera, m = cam.vp, w = Math.round(340 * cam.aspect);
const screen = tips.map(({x,y,z}) => {
  const depth = m[3]*x + m[7]*y + m[11]*z + m[15];
  return { x:(.5 + .5*(m[0]*x + m[4]*y + m[8]*z + m[12])/depth)*w,
    y:(.5 - .5*(m[1]*x + m[5]*y + m[9]*z + m[13])/depth)*340 };
});
const actual = [], lineTo = ctx.lineTo;
ctx.lineTo = function(x,y) { if (this.strokeStyle === '#e8f1f4') actual.push({x,y}); lineTo.call(this,x,y); };
try { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }
finally { ctx.lineTo = lineTo; }
check(screen.every(tip => actual.some(v => Math.hypot(v.x-tip.x,v.y-tip.y) < 0.02)), '画布端的两条线没有接至这一帧翼尖');
const { renderer } = __PI, render = renderer.render;
let cruiseStores = -1, interceptStores = -1, keepCapture = true;
renderer.render = function (cam, map, time, drawables, fx) {
  const stores = drawables.filter(draw => draw.mesh === g.meshes.missile).length;
  if (keepCapture) cruiseStores = stores; else interceptStores = stores;
  return render.call(this, cam, map, time, drawables, fx);
};
try {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check(cruiseStores === 0 && p.missiles === 4, `巡航的外露弹体挡住了机翼，但不能改动弹药库存：${cruiseStores}/${p.missiles}`);
  keepCapture = false;
  __SKY.home(); document.getElementById('sky-intercept').click(); __PI.freeze(true);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check(interceptStores === 4, `截击入口的四枚挂载没有保留：${interceptStores}`);
} finally { renderer.render = render; }
check(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify([__PI.errors, __PI.exceptions]));
return { result:'PASS', samples:sides.map(trail => trail.length), attached:screen.length, cruiseStores, interceptStores };

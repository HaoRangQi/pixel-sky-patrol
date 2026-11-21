// 通过正式按钮和真实镜头矩阵验证参考构图。不改玩家姿态或出生点。
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
const until = performance.now() + 60000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > until) throw Error(window.__PI?.boot?.error || '空域未加载');
  await new Promise(r => setTimeout(r, 80));
}
const byId = id => document.getElementById(id);
const click = id => { const b = byId(id); check(b && !b.hidden && !b.disabled, `按钮不可用：${id}`); b.click(); };
const G = __PI.G, sub = (a,b) => ({ x:a.x-b.x, y:a.y-b.y, z:a.z-b.z });
const add = (a,b,k) => ({ x:a.x+b.x*k, y:a.y+b.y*k, z:a.z+b.z*k });
const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;
const side = () => {
  const d = sub(G.camera.pos,G.player.pos), yaw = G.player.yaw;
  return d.x*Math.cos(yaw)+d.z*Math.sin(yaw);
};
function project(point) {
  const cam = G.camera, d = sub(point, cam.pos), depth = dot(d,cam.fwd);
  check(depth > 0, '镜头没有看向机体');
  return { x:.5 + dot(d,cam.right)/(2*depth*cam.tanHalf*cam.aspect), y:.5 - dot(d,cam.up)/(2*depth*cam.tanHalf) };
}
function hit(button) {
  const r = button.getBoundingClientRect(), stage = byId('stage').getBoundingClientRect();
  check(r.height >= 39 && r.top >= stage.top && r.right <= stage.right && r.left >= stage.left && r.bottom <= stage.bottom, `按钮被裁切：${button.id}`);
  check(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button') === button, `按钮被遮挡：${button.id}`);
  for (const other of ['sky-camera', 'sky-telemetry']) {
    if (other === button.id) continue;
    const q = byId(other).getBoundingClientRect();
    check(r.right <= q.left || q.right <= r.left || r.bottom <= q.top || q.bottom <= r.top, `斜后入口盖住 ${other}`);
  }
}
const key = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles:true }));
click('sky-cruise'); __PI.freeze(true); __PI.step(3.6);
check(G.view === 1 && Math.abs(side()) < .001, '正式起飞不再默认正后机尾');
const chase = byId('sky-chase');
check(chase && chase.getAttribute('aria-pressed') === 'false', '自由巡航缺少未启用的斜后追踪按钮');
hit(chase);
const p = G.player, held = { x:p.pos.x, y:p.pos.y, z:p.pos.z, yaw:p.yaw, pitch:p.pitch, roll:p.roll };
click('sky-chase');
check(chase.getAttribute('aria-pressed') === 'true' && G.view === 1, '点击后没有选择斜后追踪');
check(p.pos.x === held.x && p.pos.y === held.y && p.pos.z === held.z && p.yaw === held.yaw && p.pitch === held.pitch && p.roll === held.roll, '镜头开关修改了飞机姿态');
__PI.step(.08); const earlySide = side();
__PI.step(.7);
const finalSide = side(), center = project(p.pos), b = p.renderBasis;
const nose = project(add(p.pos,b.fwd,6)), tail = project(add(p.pos,b.fwd,-5));
const span = Math.abs(project(add(p.pos,b.right,5)).x-project(add(p.pos,b.right,-5)).x);
check(finalSide > 4 && earlySide > .01 && earlySide < finalSide*.45, `没有平滑移到机尾右上：${earlySide} → ${finalSide}`);
check(nose.x > tail.x+.08 && nose.y < tail.y-.10, '没有从实际斜后视角看到右上机鼻');
check(Math.abs(center.x-.5) < .06 && center.y > .60 && center.y < .75, `飞机不在中下部：${JSON.stringify(center)}`);
check(G.camera.fwd.y > -.46 && G.camera.fwd.y < -.10 && Math.abs(G.camera.right.y) < .001, '巡航时天空不足或地平线歪斜');
check(G.camera.aspect < 1 ? span > .21 && span < .69 : span > .22 && span < .34, `翼展在视口中比例不当：${span}`);
const hud = byId('ui'), paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
await paint();
const uiScale = hud.height / 340;
function pipInk() {
  // 不要求中心完全透明：翼迹可通过此处。只数指针中心的高不透明度淡绿墨点。
  const rgba = hud.getContext('2d').getImageData(Math.floor(hud.width/2)-6*uiScale,
    Math.round(340*.52)*uiScale-6*uiScale, 12*uiScale, 12*uiScale).data;
  let ink = 0;
  for (let i=0; i<rgba.length; i+=4) {
    const [r,g,b,a] = rgba.subarray(i,i+4);
    if (a > 230 && r > 180 && g > r && g > b+7) ink++;
  }
  return ink;
}
const neutralInk = pipInk();
const bounds = byId('gl').getBoundingClientRect();
byId('gl').dispatchEvent(new PointerEvent('pointermove', { pointerType:'mouse', bubbles:true,
  clientX:bounds.left+bounds.width*.5, clientY:bounds.top+bounds.height*.52 }));
await paint();
check(pipInk() >= neutralInk+uiScale**2, '指针没有区分闲置和主动输入');
check(p.shield === 100, '展示镜头影响了飞行安全');
key('KeyD',true); __PI.step(.22); key('KeyD',false); __PI.step(.10);
check(p.yaw > held.yaw+.04 && p.roll < -.2 && Math.abs(G.camera.right.y) < .001, '轻转时相机不跟随航向或跟着机翼翻斜');
key('Escape',true); key('Escape',false);
check(G.mode === 'paused' && (chase.hidden || chase.disabled), '暂停时镜头按钮仍能操作');
click('sky-resume');
check(G.mode === 'play' && chase.getAttribute('aria-pressed') === 'true', '恢复后丢了斜后镜头');
click('sky-chase'); __PI.step(.8);
check(Math.abs(side()) < .001 && chase.getAttribute('aria-pressed') === 'false', '无法返回正后机尾轴线');
click('sky-camera'); __PI.step(1.4);
check(G.view === 2 && G.cockpitAlpha > .99 && chase.hidden, '切换一次没有到座舱，或遮挡座舱的斜后按钮仍可见');
click('sky-camera'); __PI.step(1.4);
check(G.view === 0 && G.camera.fwd.y < -.99999 && G.camera.up.z < -.99999, '巡航俯视不是北向正上方');
const topCenter = project(p.pos), topDist = G.camera.pos.y-p.pos.y;
check(Math.abs(topCenter.x-.5) < .001 && Math.abs(topCenter.y-.5) < .001 && topDist > 15 && topDist < 80, '巡航俯视没有看清居中机体');
key('KeyD',true); __PI.step(.7); key('KeyD',false); __PI.step(.35);
const topA = project(add(p.pos,p.renderBasis.fwd,6)), topB = project(add(p.pos,p.renderBasis.fwd,-5));
check(topA.x > topB.x+.07 && G.camera.up.z < -.99999, '俯视中机鼻没有随航向转动，或北向标记在转');
key('Escape',true); key('Escape',false); click('sky-home');
check(chase.hidden && ['sky-intercept','sky-cruise','sky-inland'].every(id => !byId(id).disabled), '返回待命破坏了正式入口');
click('sky-inland'); __PI.freeze(true);
check(G.view === 1 && !chase.hidden && chase.getAttribute('aria-pressed') === 'false' && Math.abs(side()) < .001, '秋林入口没有默认正后或不能选斜后');
click('sky-chase'); __PI.step(.8); key('Escape',true); key('Escape',false); click('sky-restart');
check(G.view === 1 && chase.getAttribute('aria-pressed') === 'false' && Math.abs(side()) < .001, '重开没有回到默认正后');
key('Escape',true); key('Escape',false); click('sky-home'); click('sky-intercept'); __PI.freeze(true);
check(G.view === 1 && chase.hidden, '将观景侧视带进了截击锁定');
click('sky-camera'); __PI.step(1.4); click('sky-camera'); __PI.step(1.4);
check(G.view === 0 && Math.abs(G.camera.pos.y-G.player.pos.y-topDist) < .1, '截击没有使用与巡航一致的近距真实机体俯视');
check(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify([__PI.errors,__PI.exceptions]));
return { result:'PASS', aspect:G.camera.aspect, earlySide, finalSide, center, span, topDist };

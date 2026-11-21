// 从正式起飞和真实屏边指针验证锁定，不摆敌机、不写玩家或相机姿态。
const deadline = performance.now() + 60000;
while (!window.__PI?.ready()) {
  if (__PI?.boot?.error || performance.now() > deadline) throw Error(__PI?.boot?.error || '游戏未就绪');
  await new Promise(resolve => setTimeout(resolve, 80));
}
const g = __PI.G, sky = !!document.getElementById('sky-intercept');
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles:true }));
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
if (sky) { __SKY.home(); document.getElementById('sky-intercept').click(); }
else { key('Enter', true); key('Enter', false); }
__PI.freeze(true); __PI.step(.1);
for (let i=0; i<2; i++) {
  if (sky) document.getElementById('sky-camera').click();
  else { key('Space', true); key('Space', false); }
  __PI.step(1.4);
}
if (g.mode !== 'play' || g.view !== 0 || g.viewBlend !== 1) throw Error('没有从正式入口切到俯视');
const hud = document.getElementById('ui'), ctx = hud.getContext('2d'), VW = hud.width/(hud.height/340);
function edge(target) {
  const dx = target.pos.x-g.player.pos.x, dz = target.pos.z-g.player.pos.z;
  const s = 1/Math.max(Math.abs(dx)/(VW/2-18), Math.abs(dz)/(170-18));
  return {x:VW/2+dx*s, y:170+dz*s};
}
function pointAt(s) {
  const r = hud.getBoundingClientRect();
  hud.dispatchEvent(new PointerEvent('pointermove', {pointerType:'mouse', bubbles:true,
    clientX:r.left+s.x/VW*r.width, clientY:r.top+s.y/340*r.height}));
}
const natural = [...g.enemies, ...g.ground].filter(t => !t.dead && Math.hypot(t.pos.x-g.player.pos.x,t.pos.y-g.player.pos.y,t.pos.z-g.player.pos.z) < 2600);
if (!natural.length) throw Error('正式出生没有射程内的自然目标');
// 出生敌机可能在机尾；只按真实转向键对正，不为测试摆放敌机或写航向。
const lead = natural[0];
for (let i=0; i<180; i++) {
  const bearing = Math.atan2(lead.pos.x-g.player.pos.x,-(lead.pos.z-g.player.pos.z));
  const error = Math.atan2(Math.sin(bearing-g.player.yaw),Math.cos(bearing-g.player.yaw));
  if (Math.abs(error) < .25) break;
  const code = error > 0 ? 'KeyD' : 'KeyA';
  key(code,true); __PI.step(.025); key(code,false);
}
const targets = [...g.enemies, ...g.ground].filter(t => {
  const d = {x:t.pos.x-g.player.pos.x,y:t.pos.y-g.player.pos.y,z:t.pos.z-g.player.pos.z};
  const distance = Math.hypot(d.x,d.y,d.z), b = g.player.basis.fwd;
  return !t.dead && distance < 2700 && (d.x*b.x+d.y*b.y+d.z*b.z)/distance > .4;
});
if (!targets.length) throw Error('真实转向后仍无前方自然目标');
let chosen = null;
for (const target of targets) {
  for (let i=0; i<45 && g.mode === 'play'; i++) {
    pointAt(edge(target)); __PI.step(.04);
    if (g.lock.phase === 'locked' && g.lock.target === target) { chosen = target; break; }
  }
  if (chosen) break;
}
if (!chosen) throw Error(`实际屏边指针不能锁定自然生成目标：${JSON.stringify({phase:g.lock.phase,targets:targets.length,mode:g.mode})}`);
const marker = edge(chosen), text = [], bitmaps = new WeakMap();
const oldText = CanvasRenderingContext2D.prototype.fillText, oldImage = ctx.drawImage;
CanvasRenderingContext2D.prototype.fillText = function(value,...args) {
  if (this.canvas === hud) text.push(String(value));
  else bitmaps.set(this.canvas,String(value));
  return oldText.call(this,value,...args);
};
ctx.drawImage = function(image,...args) {
  if (bitmaps.has(image)) text.push(bitmaps.get(image));
  return oldImage.call(this,image,...args);
};
try { await paint(); } finally { CanvasRenderingContext2D.prototype.fillText = oldText; ctx.drawImage = oldImage; }
if (!text.some(value => value.startsWith('已锁定 '))) throw Error('虽然状态已锁定，实际Canvas却没有画出屏边锁定文字');
const camera = g.camera, delta = {x:chosen.pos.x-camera.pos.x,y:chosen.pos.y-camera.pos.y,z:chosen.pos.z-camera.pos.z};
const dot = b => delta.x*b.x+delta.y*b.y+delta.z*b.z, depth = dot(camera.fwd);
const onScreen = depth > 0 && Math.abs(dot(camera.right)/(depth*camera.tanHalf*camera.aspect)) < 1
  && Math.abs(dot(camera.up)/(depth*camera.tanHalf)) < 1;
if (onScreen) throw Error('测试目标仍在近景画面内，未覆盖屏外锁定回归');
const before = g.player.missiles;
key('KeyE',true); key('KeyE',false);
const missile = g.missiles.findLast(m => m.owner === 'player');
if (g.player.missiles !== before-1 || !missile || missile.target !== chosen) throw Error('屏边已锁定目标没有成为实际离架导弹的追踪对象');
pointAt({x:VW-marker.x,y:340-marker.y}); __PI.step(.3);
if (g.lock.target === chosen && g.lock.phase === 'locked') throw Error('指向相反屏边后仍错误保持原目标锁定');
if (__PI.errors.length || __PI.exceptions.length) throw Error(JSON.stringify([__PI.errors,__PI.exceptions]));
return {result:'PASS',entry:sky?'sky-patrol':'root',marker,targetKind:chosen.kind,missileTracksActualTarget:missile.target === chosen,canvasLockLabel:true,oppositeEdgePhase:g.lock.phase};

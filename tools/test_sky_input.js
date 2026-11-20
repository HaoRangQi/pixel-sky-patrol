// 从实际按钮进入，验证触摸式按住/取消和画布外释放不会留下操作。
if (!__PI.ready()) throw new Error('游戏未就绪');
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
document.getElementById('sky-cruise').click();
__PI.freeze(true);
const G = __PI.G, p = G.player;
const action = name => document.querySelector(`[data-sky-action="${name}"]`);
let pointerId = 80;
function touch(target, type, id = pointerId) {
  const r = target.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
}
const boost = action('boost'), gun = action('gun');
boost.click();
__PI.step(0.1);
assert(p.burning, '辅助技术激活加速没有短时加速');
await new Promise(resolve => setTimeout(resolve, 1300));
__PI.step(0.1);
assert(!p.burning, '辅助技术短加速未自动结束');
touch(boost, 'pointerdown');
__PI.step(0.2);
assert(p.burning && boost.getAttribute('aria-pressed') === 'true', '触屏按住加速无效');
touch(document.body, 'pointerup');
__PI.step(0.1);
assert(!p.burning && boost.getAttribute('aria-pressed') === 'false', '移到按钮外松开仍在加速');

pointerId++;
const shots = G.stats.shots;
touch(gun, 'pointerdown');
__PI.step(0.3);
assert(G.stats.shots >= shots + 3, '触屏按住机炮没有连射');
touch(gun, 'pointercancel');
const cancelledShots = G.stats.shots;
__PI.step(0.2);
assert(G.stats.shots === cancelledShots && gun.getAttribute('aria-pressed') === 'false', '取消触点后机炮粘住');

const r = document.getElementById('ui').getBoundingClientRect();
const options = { bubbles: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height * 0.52 };
document.getElementById('gl').dispatchEvent(new MouseEvent('mousedown', options));
__PI.step(0.2);
document.getElementById('sky-header').dispatchEvent(new MouseEvent('mouseup', options));
const releasedShots = G.stats.shots;
__PI.step(0.2);
assert(G.stats.shots === releasedShots, '画布按下后拖到工具栏松开仍连射');

pointerId++;
touch(gun, 'pointerdown');
action('pause').click();
await settle();
assert(G.mode === 'paused', '按住机炮时无法暂停');
document.getElementById('sky-resume').click();
await settle();
const resumedShots = G.stats.shots;
__PI.step(0.2);
assert(G.stats.shots === resumedShots && gun.getAttribute('aria-pressed') === 'false', '暂停恢复继承旧触点');
assert(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify({ errors: __PI.errors, exceptions: __PI.exceptions }));
return { result: 'PASS', touchBoost: true, touchGun: true, cancelStopsGun: true, outsideRelease: true, pauseClearsHolds: true, shots: G.stats.shots };

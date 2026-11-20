if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('cockpit');
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
__PI.freeze(true);
const G = __PI.G;
const p = G.player;
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const key = (code, type = 'keydown', repeat = false) => {
  window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true }));
};
const shots = G.stats.shots;
const ammo = p.missiles;
key('KeyE');
check(G.stats.shots === shots + 1 && p.missiles === ammo - 1, 'E 没有发射一枚导弹');
const afterE = G.stats.shots;
key('KeyE', 'keydown', true);
key('KeyE', 'keyup');
check(G.stats.shots === afterE, '按住 E 重复发射');

key('KeyQ'); key('KeyQ', 'keyup');
check(p.rollT > 0, 'Q 没有触发桶滚');
const rect = document.getElementById('ui').getBoundingClientRect();
window.dispatchEvent(new PointerEvent('pointermove', {
  pointerType: 'mouse', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
}));
__PI.step(0.36);
const upsideDownY = G.camera.up.y;
check(upsideDownY < -0.8, `桶滚中驾驶位镜头没有倒转：up.y=${upsideDownY.toFixed(3)}`);
__PI.step(0.4);
check(p.rollT === 0 && G.camera.up.y > 0.8, '桶滚结束后驾驶位镜头没有回正');
check(__PI.errors.length === 0, `页面错误：${JSON.stringify(__PI.errors)}`);
if (failures.length) throw new Error(failures.join('；'));
return { result: 'PASS', upsideDownY, uprightY: G.camera.up.y, shots: G.stats.shots - shots };

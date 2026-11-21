// 在不同视口直接检查实际布局，截图用于补充目视验收。
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(window.__PI?.ready(), '游戏未就绪');
__PI.freeze(true);
const box = id => document.getElementById(id).getBoundingClientRect();
const stage = box('stage'), header = box('sky-header'), controls = box('sky-controls');
const gl = box('gl'), ui = box('ui'), brand = box('sky-brand'), ammo = box('sky-ammo');
assert(document.documentElement.scrollWidth <= innerWidth + 1, '页面横向溢出');
assert(stage.height >= Math.min(180, innerHeight * 0.45), '游戏画面高度被控件挤没');
assert(header.bottom <= stage.top + 1, '顶栏盖住游戏画面');
assert(stage.bottom <= controls.top + 1, '底栏盖住游戏画面');
assert(stage.left >= 0 && stage.right <= innerWidth + 1 && stage.top >= 0 && stage.bottom <= innerHeight + 1, 'stage超出屏幕');
assert(Math.abs(ui.left - gl.left) < 1 && Math.abs(ui.top - gl.top) < 1 && Math.abs(ui.width - gl.width) < 1 && Math.abs(ui.height - gl.height) < 1, '两层画布不重合');
assert(gl.left >= stage.left - 1 && gl.top >= stage.top - 1 && gl.right <= stage.right + 1 && gl.bottom <= stage.bottom + 1, '画布仍使用全屏几何');
assert(brand.width > 0 && brand.left >= stage.left && brand.right <= stage.right, '字标超出画面');
assert(ammo.right <= innerWidth + 1 && ammo.bottom <= innerHeight + 1, '弹药栏出屏');
const visibleButtons = [...document.querySelectorAll('button')].filter(b => !b.closest('[hidden]') && getComputedStyle(b).visibility !== 'hidden' && b.getBoundingClientRect().width > 0);
for (const button of visibleButtons) {
  const r = button.getBoundingClientRect();
  assert(r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1, `按钮出屏：${button.textContent.trim()}`);
  assert(r.width >= 26 && r.height >= 26, `按钮命中区过小：${button.textContent.trim()}`);
}
const starts = [...document.querySelectorAll('#sky-start button')];
assert(starts.some(b => b.id === 'sky-inland'), '林线缺少可见起飞入口');
for (const b of starts) {
  const r = b.getBoundingClientRect();
  assert(r.top >= stage.top && r.bottom <= stage.bottom && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button') === b, `起飞按钮被画框裁切或遮挡：${b.textContent}`);
}
assert(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify({ errors: __PI.errors, exceptions: __PI.exceptions }));
return { result: 'PASS', viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, stage: stage.toJSON(), canvas: ui.toJSON(), brand: brand.toJSON(), buttons: visibleButtons.length, errors: __PI.errors };

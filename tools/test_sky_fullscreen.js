// 使用CDP的 --click=#sky-fullscreen 先发送受信任的鼠标点击。
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(__PI.ready(), '游戏未就绪');
assert(document.fullscreenElement?.id === 'sky-app', `全屏未生效：${document.getElementById('sky-status').textContent}`);
const entered = { id: document.fullscreenElement.id, width: innerWidth, height: innerHeight };
const button = document.getElementById('sky-fullscreen');
assert(button.getAttribute('aria-pressed') === 'true' || /退出/.test(button.textContent + button.getAttribute('aria-label')), '全屏按钮没有同步浏览器真实状态');
await document.exitFullscreen();
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
assert(!document.fullscreenElement, '无法退出全屏');
assert(button.getAttribute('aria-pressed') !== 'true', '退出全屏后按钮状态卡住');
assert(__PI.G.mode === 'title', '点击全屏误触发出击');
assert(!__PI.errors.length && !__PI.exceptions.length, '全屏操作产生游戏错误');
return { result: 'PASS', entered, exited: true, status: document.getElementById('sky-status').textContent };

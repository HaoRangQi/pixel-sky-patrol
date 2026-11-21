// 从正式按钮出发，保持中立输入；不改燃油、高度、地形或相机。
const deadline = performance.now() + 50000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > deadline) throw new Error(window.__PI?.boot?.error || '游戏未就绪');
  await new Promise(resolve => setTimeout(resolve, 100));
}
const G = __PI.G;
document.getElementById('sky-cruise').click();
__PI.freeze(true);
const p = G.player, origin = { ...p.pos }, frames = [];
let minClearance = Infinity, overWater = 0, overLand = 0;
for (let second = 0; second <= 60; second++) {
  if (second) __PI.step(1);
  if (G.mode !== 'play' || __SKY.flightMode !== 'free' || G.view !== 1 || p.dead || p.shield !== 100) {
    throw new Error(`巡航中断：第 ${second} 秒，${G.mode}，护盾 ${p.shield}`);
  }
  const h = G.map.heightAt(p.pos.x, p.pos.z);
  minClearance = Math.min(minClearance, p.pos.y - Math.max(0, h));
  if (h < -3) overWater++;
  if (h > 8) overLand++;
  if (second % 20 === 0) {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    frames.push({ second, x: Math.round(p.pos.x), z: Math.round(p.pos.z), altitude: Math.round(p.pos.y), ground: Math.round(h) });
  }
}
const travelled = Math.hypot(p.pos.x - origin.x, p.pos.z - origin.z);
if (travelled < 6200 || minClearance < 70 || overLand < 4 || overWater < 8) {
  throw new Error(`默认航线没有安全穿过湖湾与陆地：${JSON.stringify({ travelled, minClearance, overLand, overWater })}`);
}
if (__PI.errors.length || __PI.exceptions.length) throw new Error('巡航存在运行时异常');
return { result: 'PASS', frames, travelled: Math.round(travelled), minClearance: Math.round(minClearance), overLand, overWater };

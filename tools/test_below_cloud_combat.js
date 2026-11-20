if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.freeze(true);
const G = __PI.G;
G.mode = 'title';
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
key('Enter', true); key('Enter', false);
const p = G.player;
const surface = pos => Math.max(0, G.map.heightAt(pos.x, pos.z));
const failures = [], samples = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const startingClearance = p.pos.y - surface(p.pos);
check(startingClearance >= 550 && startingClearance <= 650, `默认出击离地高度未降低到低空安全区：${startingClearance.toFixed(1)} 米`);
check(p.pos.y < 1000, `默认出击仍在高空：${p.pos.y.toFixed(1)} 米`);
let minPlayerClearance = startingClearance, minEnemyClearance = Infinity, maxPlayerAltitude = p.pos.y, maxEnemyAltitude = 0;
for (let seconds = 0; seconds <= 20; seconds++) {
  const clearance = p.pos.y - surface(p.pos);
  minPlayerClearance = Math.min(minPlayerClearance, clearance);
  maxPlayerAltitude = Math.max(maxPlayerAltitude, p.pos.y);
  for (const e of G.enemies) {
    if (e.dead) continue;
    const enemyClearance = e.pos.y - surface(e.pos);
    minEnemyClearance = Math.min(minEnemyClearance, enemyClearance);
    maxEnemyAltitude = Math.max(maxEnemyAltitude, e.pos.y);
    check(enemyClearance >= 24, `敌机降低高度后穿入地形：离地 ${enemyClearance.toFixed(1)} 米`);
    check(e.pos.y <= Math.max(surface(e.pos) + 400, p.pos.y + 260), `敌机离开低空交战区域：${e.pos.y.toFixed(1)} 米`);
  }
  if (seconds % 5 === 0) samples.push({ seconds, altitude: p.pos.y, clearance, enemies: G.enemies.map(e => ({ altitude: e.pos.y, clearance: e.pos.y - surface(e.pos) })) });
  check(!p.dead, '默认低空航线发生坠机');
  if (seconds < 20) __PI.step(1);
}
check(minPlayerClearance >= 80, `玩家低空航线离地过近：${minPlayerClearance.toFixed(1)} 米`);
check(maxPlayerAltitude < 1200, `默认航线进入云层：最高 ${maxPlayerAltitude.toFixed(1)} 米`);
check(maxEnemyAltitude < 1200, `常规敌机仍在云层高度：最高 ${maxEnemyAltitude.toFixed(1)} 米`);
check(__PI.errors.length === 0, `页面错误：${JSON.stringify(__PI.errors)}`);
if (failures.length) throw new Error(failures.slice(0, 8).join('；'));
return { result: 'PASS', startingClearance, minPlayerClearance, minEnemyClearance, maxPlayerAltitude, maxEnemyAltitude, samples };

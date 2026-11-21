// 正式的第二条航线：同一张图、正常巡航速度、无操纵，不补充高度或燃油。
const until = performance.now() + 60000;
while (!window.__PI?.ready()) {
  if (window.__PI?.boot?.error || performance.now() > until) throw Error(window.__PI?.boot?.error || '地图未就绪');
  await new Promise(r => setTimeout(r,80));
}
const check = (value, message) => { if (!value) throw Error(message); };
const button = document.getElementById('sky-inland');
check(button && !button.disabled, '没有可用的秋林低飞入口');
const game = __PI.G, map = game.map;
button.click(); __PI.freeze(true);
const pilot = game.player, first = { ...pilot.pos }, frames = [];
let near = Infinity, far = -Infinity, woodland = 0, open = 0, minGround = Infinity;
for(let second = 0; second <= 45; second++) {
  if(second) __PI.step(1);
  const { x,y,z } = pilot.pos, ground = map.heightAt(x,z), agl = y - Math.max(0,ground);
  near = Math.min(near,agl); far = Math.max(far,agl); minGround = Math.min(minGround,ground);
  const side = [-240,-160,-80,0,80,160,240].map(offset => map.forestAt(x+offset,z));
  if (side.some(f => f > .40)) woodland++;
  if (side.some(f => f < .18)) open++;
  if (second % 5 === 0) frames.push({ second, height: Math.round(y), ground: Math.round(ground), clearance: Math.round(agl) });
  check(game.map === map && game.mode === 'play' && game.view === 1 && pilot.shield === 100 && !pilot.dead && !game.enemies.length, `林线飞行中断：${second}秒`);
}
const travelled = Math.round(Math.hypot(pilot.pos.x-first.x,pilot.pos.z-first.z));
const metrics = { first, travelled, min:near, max:far, minGround, woodland, open, frames };
check(travelled > 4980 && minGround > 10 && near > 38 && far < 245 && woodland >= 7 && open >= 15, `第二航线没有连续低飞经过林斑和草场：${JSON.stringify(metrics)}`);
check(!__PI.errors.length && !__PI.exceptions.length, JSON.stringify([__PI.errors,__PI.exceptions]));
return { result:'PASS', ...metrics };

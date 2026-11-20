// 待命取景必须露出前方空域，飞机不能被旧标题镜头挤到最右侧。
if (!__PI.ready()) throw new Error('游戏未就绪');
__PI.freeze(true);
const G = __PI.G, p = G.player, vp = G.camera.vp;
const project = point => {
  const w = vp[3] * point.x + vp[7] * point.y + vp[11] * point.z + vp[15];
  return { x: ((vp[0] * point.x + vp[4] * point.y + vp[8] * point.z + vp[12]) / w + 1) / 2,
    y: (1 - (vp[1] * point.x + vp[5] * point.y + vp[9] * point.z + vp[13]) / w) / 2 };
};
const screen = project(p.pos);
if (screen.x < 0.38 || screen.x > 0.68 || screen.y < 0.52 || screen.y > 0.9) throw new Error(`待命飞机构图偏离中心下方：${JSON.stringify(screen)}`);
let maxForwardTerrain = -Infinity;
for (let d = 150; d <= 1200; d += 150) maxForwardTerrain = Math.max(maxForwardTerrain, G.map.heightAt(p.pos.x + p.basis.fwd.x * d, p.pos.z + p.basis.fwd.z * d));
if (maxForwardTerrain > p.pos.y + 80) throw new Error(`近处山墙挡住前方：${maxForwardTerrain.toFixed(1)}m，高于飞机${p.pos.y.toFixed(1)}m`);
if (__PI.errors.length || __PI.exceptions.length) throw new Error('待命画面存在渲染异常');
return { result: 'PASS', screen, maxForwardTerrain, altitude: p.pos.y, spawn: G.spawn };

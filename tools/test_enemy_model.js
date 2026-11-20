if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('cockpit');
__PI.freeze(true);
const G = __PI.G, p = G.player, e = G.enemies[0];
p.pos.y = 2000;
__PI.step(1 / 60);
G.enemies = [e];
G.ground = [];
G.banner = null;
const f = p.basis.fwd, r = p.basis.right;
e.pos = {
  x: p.pos.x + f.x * 500 + r.x * 65,
  y: p.pos.y + f.y * 500,
  z: p.pos.z + f.z * 500 + r.z * 65,
};
e.hp = 76;
e.yaw = p.yaw + 0.5;
e.basis = {
  fwd: { x: Math.sin(e.yaw), y: 0, z: -Math.cos(e.yaw) },
  right: { x: Math.cos(e.yaw), y: 0, z: Math.sin(e.yaw) },
  up: { x: 0, y: 1, z: 0 },
};
G.lock.target = null;
G.lock.phase = 'search';
const renderer = __PI.renderer, render = renderer.render;
let scale = 0;
renderer.render = function (camera, map, time, objects, options) {
  const enemy = objects.find(object => object.mesh === G.meshes.drone);
  if (enemy) scale = Math.hypot(enemy.matrix[0], enemy.matrix[1], enemy.matrix[2]);
  return render.call(this, camera, map, time, objects, options);
};
try {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
} finally {
  renderer.render = render;
}
if (G.meshes.drone.count < 1000) throw new Error('敌机详细网格没有载入');
if (scale < 2.49) throw new Error(`敌机模型太小：绘制比例=${scale}`);
if (__PI.errors.length) throw new Error(JSON.stringify(__PI.errors));
return { result: 'PASS', vertices: G.meshes.drone.count, scale, enemyHp: e.hp, distance: 504 };

if (!__PI.ready()) return { ready: false };
const G = __PI.G, m = G.map, sp = G.spawn, p = G.player;
const yaw = sp ? sp.heading : p.yaw;
const fx = Math.sin(yaw), fz = -Math.cos(yaw);
const samples = [];
for (let d = 0; d <= 2400; d += 150) {
  const x = sp.x + fx * d, z = sp.z + fz * d;
  samples.push({ d, h: +m.heightAt(x, z).toFixed(0), f: +(m.forestAt(x, z) * 255).toFixed(0) });
}
return {
  spawn: sp,
  ground: +m.heightAt(sp.x, sp.z).toFixed(0),
  yaw: +yaw.toFixed(3),
  currentAlt: +p.pos.y.toFixed(0),
  samples,
};
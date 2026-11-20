if (!__PI.ready()) return { ready: false };
const G = __PI.G, m = G.map;
const F = m.forest;
let fmax = 0, fsum = 0, hi = 0, hi80 = 0, hi120 = 0, hi160 = 0;
for (let i = 0; i < F.length; i++) {
  const v = F[i];
  fsum += v;
  if (v > fmax) fmax = v;
  if (v > 40) hi++;
  if (v > 80) hi80++;
  if (v > 120) hi120++;
  if (v > 160) hi160++;
}
const p = G.player;
const yaw = p.yaw;
const fwd = { x: Math.sin(yaw), z: -Math.cos(yaw) };
const samples = [];
for (let d = 0; d <= 3000; d += 200) {
  const x = p.pos.x + fwd.x * d, z = p.pos.z + fwd.z * d;
  samples.push({
    d, h: +m.heightAt(x, z).toFixed(0),
    f: +(m.forestAt(x, z) * 255).toFixed(0),
  });
}
return {
  n: F.length,
  fmax, favg: +(fsum / F.length).toFixed(1),
  frac40: +(hi / F.length).toFixed(3),
  frac80: +(hi80 / F.length).toFixed(3),
  frac120: +(hi120 / F.length).toFixed(3),
  frac160: +(hi160 / F.length).toFixed(3),
  minH: m.minH, maxH: m.maxH,
  yaw: +yaw.toFixed(2), pos: p.pos, samples,
};

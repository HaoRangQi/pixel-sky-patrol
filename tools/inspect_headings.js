if (!__PI.ready()) return { ready: false };
const G = __PI.G, m = G.map, sp = G.spawn;
const rows = [];
for (let a = 0; a < 28; a++) {
  const ang = a / 28 * Math.PI * 2;
  const cfx = Math.sin(ang), cfz = -Math.cos(ang);
  let water = 0, snowFar = 0, forest = 0, nearForest = 0, wall = 0;
  for (let s = -1; s <= 1; s++) {
    const aa = ang + s * 0.22;
    const fx = Math.sin(aa), fz = -Math.cos(aa);
    const sw = s === 0 ? 1 : 0.62;
    for (let d = 180; d <= 2300; d += 130) {
      const hh = m.heightAt(sp.x + fx * d, sp.z + fz * d);
      const ff = m.forestAt(sp.x + fx * d, sp.z + fz * d) * 255;
      if (hh < -4) { water += (d < 1500 ? 1.6 : 0.8) * sw; continue; }
      if (d > 1100 && hh > 620) snowFar += (0.5 + Math.min(1.2, (hh - 620) / 400)) * sw;
      if (d < 1200 && hh > sp.h + 380) wall += (hh - (sp.h + 380)) / 300 * sw;
      if (ff > 97 && hh < 720) forest += (d < 900 ? 1 : 0.55) * sw;
      if (d < 750 && ff > 102) nearForest += 0.5 * sw;
    }
  }
  const fg = m.forestAt(sp.x + cfx * 320, sp.z + cfz * 320) * 255;
  const fg2 = m.forestAt(sp.x + cfx * 600, sp.z + cfz * 600) * 255;
  rows.push({
    deg: +(ang * 180 / Math.PI).toFixed(0),
    water: +water.toFixed(1), snowFar: +snowFar.toFixed(1),
    forest: +forest.toFixed(1), nearForest: +nearForest.toFixed(1),
    wall: +wall.toFixed(1), fg: fg.toFixed(0), fg2: fg2.toFixed(0),
  });
}
return { ground: +sp.h.toFixed(0), currentHeadingDeg: +(sp.heading * 180 / Math.PI).toFixed(0), rows };

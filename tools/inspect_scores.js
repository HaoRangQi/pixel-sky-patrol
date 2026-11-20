if (!__PI.ready()) return { ready: false };
const G = __PI.G, m = G.map, sp = G.spawn;
const rows = [];
for (let a = 0; a < 28; a++) {
  const ang = a / 28 * Math.PI * 2;
  const cfx = Math.sin(ang), cfz = -Math.cos(ang);
  let snow = 0, forest = 0, water = 0, relief = 0, nearForest = 0, wall = 0;
  for (let s = -1; s <= 1; s++) {
    const aa = ang + s * 0.22;
    const fx = Math.sin(aa), fz = -Math.cos(aa);
    const sideW = s === 0 ? 1.0 : 0.62;
    for (let d = 180; d <= 2300; d += 130) {
      const px = sp.x + fx * d, pz = sp.z + fz * d;
      const hh = m.heightAt(px, pz);
      const ff = m.forestAt(px, pz);
      if (hh < -4) { water += (d < 1300 ? 1.25 : 0.65) * sideW; continue; }
      if (hh > 500) snow += (0.8 + Math.min(1.2, (hh - 500) / 400)) * sideW;
      if (hh > 900) snow += 0.4 * sideW;
      if (ff > 0.38 && hh < 700) forest += (d < 900 ? 1.0 : 0.55) * sideW;
      if (d < 700 && ff > 0.40 && hh < 560) nearForest += 0.5 * sideW;
      if (hh > 240) relief += 0.15 * sideW;
      if (d < 1200 && hh > sp.h + 380) wall += (hh - (sp.h + 380)) / 300 * sideW;
    }
  }
  const fgForest = m.forestAt(sp.x + cfx * 320, sp.z + cfz * 320);
  const fgForest2 = m.forestAt(sp.x + cfx * 600, sp.z + cfz * 600);
  const snowShort = Math.max(0, 12 - snow);
  const score = snow * 0.90 + forest * 1.20 + nearForest * 1.6 + water * 0.80
    + relief * 0.30 + fgForest * 1.5 + fgForest2 * 1.0
    - wall * 4.0 - snowShort;
  rows.push({
    deg: +(ang * 180 / Math.PI).toFixed(0), score: +score.toFixed(2),
    snow: +snow.toFixed(1), forest: +forest.toFixed(1), near: +nearForest.toFixed(1),
    water: +water.toFixed(1), wall: +wall.toFixed(1),
    fg: +(fgForest * 255).toFixed(0), fg2: +(fgForest2 * 255).toFixed(0),
  });
}
rows.sort((a, b) => b.score - a.score);
return { current: +(sp.heading * 180 / Math.PI).toFixed(1), top: rows.slice(0, 12), bottom: rows.slice(-3) };
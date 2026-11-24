// 湖谷防御专用网格，沿用 +Y 向上、−Z 向前，尺寸以场景米为单位。
const SKY_DEFENSE_OCTAGON = [[-.63, 1], [.63, 1], [1, .63], [1, -.63],
  [.63, -1], [-.63, -1], [-1, -.63], [-1, .63]];
function skyDefenseRing(x, y, z, width, height) {
  return SKY_DEFENSE_OCTAGON.map(([u, v]) => v3(x + u * width, y + v * height, z));
}

function skyDefenseJoin(mesh, near, far, shades) {
  for (let i = 0; i < near.length; i++) {
    const j = (i + 1) % near.length;
    mesh.quad(near[i], near[j], far[j], far[i], shades[i % shades.length]);
  }
}

function buildDefenseTransport() {
  const p = v3, mesh = new MeshBuilder(p(0, .4, 0));
  const roof = rgb('#b0b5ae'), shoulder = rgb('#8b9690'), hull = rgb('#687971');
  const belly = rgb('#3c4b4a'), iron = rgb('#303c40'), dark = rgb('#1f2b30');
  const ochre = rgb('#d3ae73'), flap = rgb('#718984'), lip = rgb('#a7ada0');
  const glass = [rgb('#344f60'), rgb('#4b6473')];
  const paint = [roof, shoulder, hull, belly, belly, belly, hull, shoulder];
  const fuselage = [
    [-22, 1.78, 1.47, -.01], [-20.4, 2.68, 2.14, .12], [-17.1, 3.64, 3.10, .48],
    [-12.7, 3.95, 3.52, .47], [8.8, 3.95, 3.52, .47], [14, 3.64, 3.21, .50], [20.5, 2.83, 2.35, -.03],
  ].map(([z, w, h, y]) => skyDefenseRing(0, y, z, w, h));
  mesh.poly(fuselage[0], shoulder);
  for (let i = 0; i < fuselage.length - 1; i++) {
    const shades = i === 1 ? [glass[0], glass[1], hull, belly, belly, belly, hull, glass[1]] : paint;
    skyDefenseJoin(mesh, fuselage[i], fuselage[i + 1], shades);
  }
  mesh.beam(p(0, 2.29, -20.4), p(0, 3.61, -17.1), .075, .035, shoulder);

  // 深色货舱比尾缘向前缩进，踏板延伸至机尾后下方。
  const door = skyDefenseRing(0, -.26, 20.5, 2.31, 1.71);
  const hold = skyDefenseRing(0, -.22, 17.55, 2.28, 1.67);
  skyDefenseJoin(mesh, fuselage.at(-1), door, [shoulder, shoulder, lip, hull, ochre, hull, lip, shoulder]);
  skyDefenseJoin(mesh, door, hold, [iron, dark, iron]);
  mesh.center = p(0, 0, 17);
  mesh.poly(hold, dark);
  mesh.center = p(0, -.7, 21);
  mesh.quad(p(-1.47, -1.98, 20.5), p(1.47, -1.98, 20.5), p(1.38, -2.79, 22.05), p(-1.38, -2.79, 22.05), hull);
  mesh.beam(p(-1.38, -2.79, 22.05), p(1.38, -2.79, 22.05), .08, .09, ochre);

  for (const side of [-1, 1]) {
    const plate = points => points.map(([x, z]) => [side * x, z]);
    mesh.center = p(side * 12, 2.58, -.9);
    mesh.extrudedPlate(plate([[3.1, -7.8], [24, -4.6], [24, 2.6], [3.1, 4.7]]), 2.58, 1.02, roof, hull, shoulder);
    mesh.extrudedPlate(plate([[4.5, 2.9], [23.2, 1.12], [23.2, 2.62], [4.5, 4.57]]), 3.105, .014, flap, flap, flap);
    mesh.box(side * 23.73, 2.58, -1.05, .53, 1.045, 7.05, ochre);

    for (const span of [8, 15]) {
      const x = side * span, y = .25, z = span === 8 ? -10.35 : -9.25;
      mesh.center = p(x, y, z + 4.5);
      const intake = skyDefenseRing(x, y, z, 1.53, 1.52);
      const cowl = skyDefenseRing(x, y, z + 1.4, 1.65, 1.64);
      const nacelle = skyDefenseRing(x, y, z + 7.85, 1.42, 1.39);
      const exhaust = skyDefenseRing(x, y, z + 9.45, 1.10, 1.07);
      const fan = skyDefenseRing(x, y, z + .60, 1.19, 1.18);
      skyDefenseJoin(mesh, intake, cowl, [lip, shoulder, shoulder, hull, hull, hull, shoulder, shoulder]);
      skyDefenseJoin(mesh, cowl, nacelle, paint);
      skyDefenseJoin(mesh, nacelle, exhaust, [iron]);
      skyDefenseJoin(mesh, intake, fan, [lip, lip, iron, iron, iron, iron, iron, lip]);
      mesh.poly(fan, dark);
      mesh.disc(x, y, z + .58, .35, 8, shoulder);
      mesh.poly(exhaust, dark);
      mesh.box(x, 2, z + 4.1, 1.24, .94, 4.6, hull);
    }
  }
  mesh.center = p(0, 4.8, 17);
  mesh.fin([[12.9, 2.7], [17.4, 9.8], [20.9, 9.8], [21.1, 2.2]], 0, .91, shoulder, ochre, 9.72);
  for (const side of [-1, 1]) {
    mesh.center = p(side * 4, 8.55, 18);
    mesh.extrudedPlate([[.30, 15.95], [9.15, 17.35], [8.75, 20], [.30, 21.1]].map(([x, z]) => [side*x, z]),
      8.55, .39, roof, hull, shoulder);
  }
  return mesh.radius(25).build();
}

function buildDefenseDrone() {
  const p = v3, mesh = new MeshBuilder(), top = rgb('#706f69'), panel = rgb('#4d5960');
  const flank = rgb('#646769'), belly = rgb('#30373c'), seam = rgb('#293742');
  const rust = rgb('#a86552'), light = rgb('#a7967b');
  const body = [[-6.9, .16, .12], [-5.3, 1.18, .46], [-3.45, 1.84, .97],
    [-.45, 2.67, 1.34], [2.45, 2.32, .65], [3.83, 1.44, .37]]
    .map(([z, w, h]) => skyDefenseRing(0, .17, z, w, h));
  mesh.poly(body[0], seam);
  for (let i = 0; i < body.length - 1; i++) {
    const shades = i === 0 ? [seam] : [top, flank, panel, belly, belly, belly, panel, flank];
    skyDefenseJoin(mesh, body[i], body[i+1], shades);
  }
  mesh.poly(body.at(-1), seam);
  mesh.disc(0, .17, 3.855, .24, 8, rgb('#cd774f'), .22);
  for (const side of [-1, 1]) {
    const plate = points => points.map(([x, z]) => [side*x, z]);
    mesh.center = p(side * 3.8, 0, 1.1);
    mesh.extrudedPlate(plate([[.65, -5], [11.85, 2.12], [11.20, 3.28], [5.25, 4.32], [.65, 3.65]]),
      .05, .41, top, belly, flank);
    mesh.extrudedPlate(plate([[2.75, -3.57], [11.75, 2.16], [10.47, 2.52], [2.75, -2.83]]),
      .267, .018, rust, rust, rust);
    mesh.box(side * 9.29, .27, 2.86, 1.70, .025, .48, light);
  }
  return mesh.radius(12.25).build();
}

function buildDefenseParachute() {
  // 伞盖和拉索的原点在车底，和装甲车共用世界变换。
  const p = v3, mesh = new MeshBuilder(p(0, 9.4, 0)), count = 12;
  const fabric = ['#f1dfb4', '#d6bb87', '#f5e6c5', '#e1c697'].map(rgb);
  const cord = rgb('#c8b68f');
  const arc = (i, r, y) => p(Math.cos(i * TAU / count) * r, y, Math.sin(i * TAU / count) * r);
  const hem = i => arc(i, i % 2 ? 7.20 : 7.65, i % 2 ? 10.05 : 9.50);
  for (let i = 0; i < count; i++) {
    const j = i + 1, bottom = hem(i), next = hem(j);
    const shoulder = arc(i, 6.16, 13.10), shoulderNext = arc(j, 6.16, 13.10);
    const inner = arc(i, 2.88, 14.88), innerNext = arc(j, 2.88, 14.88);
    const shade = fabric[i % fabric.length];
    mesh.center = p(0, 9.4, 0);
    mesh.quad(bottom, next, shoulderNext, shoulder, shade);
    mesh.quad(shoulder, shoulderNext, innerNext, inner, shade);
    mesh.tri(inner, innerNext, p(0, 15.55, 0), shade);
    if (i % 2 === 0) {
      const anchor = p(Math.sign(bottom.x) * .92, 2.16, Math.abs(bottom.z) < .1 ? 0 : Math.sign(bottom.z) * 1.08);
      mesh.center = vlerp(bottom, anchor, .5);
      mesh.beam(bottom, anchor, .067, .067, cord);
    }
  }
  return mesh.radius(15.65).build();
}

const skyBaseMeshes = buildMeshes;
buildMeshes = function () {
  return Object.assign(skyBaseMeshes(), {
    transport: Renderer.createMesh(buildDefenseTransport()),
    defenseDrone: Renderer.createMesh(buildDefenseDrone()),
    parachute: Renderer.createMesh(buildDefenseParachute()),
  });
};

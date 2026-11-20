// 默认地图采用开阔湖岸航线，其他种子沿用引擎自动选点。
const skySetupTitle = setupTitleWorld;
setupTitleWorld = function () {
  if (G.seed === 1337 && typeof G.map.forestAt === 'function') {
    G.spawn = { x: 2688, z: -3072, heading: Math.PI * 3 / 8 };
  }
  skySetupTitle();
};

const skyComputePose = computePose;
computePose = function (view, allowSmooth = true) {
  if (G.mode !== 'title' || view !== 1) return skyComputePose(view, allowSmooth);
  const p = G.player, b = p.renderBasis;
  return {
    pos: vadd(vadd(p.pos, vmul(b.fwd, -20)), { x: 0, y: 9, z: 0 }),
    target: vadd(vadd(p.pos, vmul(b.fwd, 35)), { x: 0, y: 0.5, z: 0 }),
    up: { x: 0, y: 1, z: 0 }, fov: 0.92,
  };
};

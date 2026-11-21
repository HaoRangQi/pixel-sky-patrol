// 从南岸向北穿过两段湖湾与林间窄口；其他种子保留地图选点。
const skySetupTitle = setupTitleWorld;
setupTitleWorld = function () {
  if (G.seed === 1337) G.spawn = { x: 4990, z: 7100, heading: -0.08 };
  skySetupTitle();
};

const skyComputePose = computePose;
let skyChasePitch = 0;
function skyChaseBlend() {
  const scenic = G.skyScenic;
  return scenic ? lerp(scenic.from, Number(scenic.oblique), smoothstep(0, .55, G.time - scenic.changedAt)) : 0;
}

function skyObliquePose(p) {
  const worldUp = { x: 0, y: 1, z: 0 };
  const heading = p.yaw - .62;
  const fwd = { x: Math.sin(heading), y: 0, z: -Math.cos(heading) };
  const aspect = VW / VH, fit = Math.max(.68, Math.min(1, 1.84 / aspect), 1.02 / aspect);
  const distance = 15.6 * fit;
  const pos = vmad(p.pos, fwd, -distance);
  pos.y += (8.8 - 3.3 * clamp(p.pitch, -.55, .55)) * fit;
  if (G.map) pos.y = Math.max(pos.y, Math.max(G.map.heightAt(pos.x, pos.z), 0) + 4.5);
  const fov = .94 + clamp((p.speed - SPEED_CRUISE) / 900, 0, .05);
  // 镜头沿水平航向跟转，飞机保留自己的倾斜；视轴从机体向上抬，留出山线。
  const pitch = Math.atan2(p.pos.y - pos.y, distance) + Math.atan(.39 * Math.tan(fov / 2));
  const target = vmad(pos, fwd, 64);
  target.y += 64 * Math.tan(pitch);
  return { pos, target, up: worldUp, fov };
}

computePose = function (view, allowSmooth = true) {
  const p = G.player, title = G.mode === 'title';
  if (view !== 1) return skyComputePose(view, allowSmooth);
  const blend = skyChaseBlend();
  if (blend === 1) return skyObliquePose(p);
  const distance = title ? 20 : 22.5, height = title ? 9 : 8;
  // 只缓和俯仰；位置与航向保持正后，避免世界坐标低通拖到机翼侧面。
  skyChasePitch = !G.chaseInit || !allowSmooth ? p.pitch
    : damp(skyChasePitch, p.pitch, 5, G.lastDt || 0.016);
  const b = basisFrom(p.yaw, skyChasePitch, 0), worldUp = { x: 0, y: 1, z: 0 };
  const pos = vadd(vadd(p.pos, vmul(b.fwd, -distance)), vmul(worldUp, height));
  if (G.map) pos.y = Math.max(pos.y, Math.max(G.map.heightAt(pos.x, pos.z), 0) + 4.5);
  G.chasePos = vcopy(pos); G.chaseUp = vcopy(worldUp); G.chaseInit = true;
  const rear = {
    pos,
    target: vadd(vadd(p.pos, vmul(b.fwd, title ? 35 : 32)), vmul(worldUp, title ? -4.5 : -5)),
    // 飞机自己倾斜与桶滚，外部镜头的地平线和视野不跟着翻动、伸缩。
    up: worldUp, fov: title ? 0.92 : 1.01,
  };
  if (!blend) return rear;
  const oblique = skyObliquePose(p);
  return {
    pos: vlerp(pos, oblique.pos, blend), target: vlerp(rear.target, oblique.target, blend),
    up: vnorm(vlerp(rear.up, oblique.up, blend)), fov: lerp(rear.fov, oblique.fov, blend),
  };
};

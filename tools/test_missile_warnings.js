if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('cockpit');
__PI.freeze(true);
const G = __PI.G, p = G.player;
G.enemies = []; G.ground = []; G.missiles = []; G.spawnTimer = 999;
p.pos = { x: 0, y: 1800, z: 0 }; p.yaw = 0; p.pitch = 0; p.roll = 0; p.invuln = 10;
__PI.step(1 / 60);
const camera = G.camera, canvas = document.getElementById('ui');
const expected = [];
for (const [name, horizontal, vertical] of [['上', 0, 80], ['下', 0, -80], ['左', -80, 0], ['右', 80, 0]]) {
  const pos = {};
  for (const axis of ['x', 'y', 'z']) pos[axis] = camera.pos[axis] + camera.fwd[axis] * 600 + camera.right[axis] * horizontal + camera.up[axis] * vertical;
  const missile = { owner: 'enemy', pos, vel: { x: 0, y: 0, z: 0 }, speed: 0, dead: false, life: 10, age: 0, lost: true, lostTimer: 10, smokeTimer: 999, turnRate: 1, hitRadius: 12 };
  G.missiles.push(missile);
  const vp = camera.vp;
  const x = vp[0] * pos.x + vp[4] * pos.y + vp[8] * pos.z + vp[12];
  const y = vp[1] * pos.x + vp[5] * pos.y + vp[9] * pos.z + vp[13];
  const w = vp[3] * pos.x + vp[7] * pos.y + vp[11] * pos.z + vp[15];
  expected.push({ name, missile, angle: Math.atan2(-y / w * canvas.height, x / w * canvas.width) });
}
__PI.step(1 / 60);
const samples = expected.map(({ name, missile, angle }) => {
  const threat = G.threatList.find(item => item.m === missile);
  if (!threat) throw new Error(`${name}方导弹没有生成警示`);
  const error = Math.atan2(Math.sin(threat.ang - angle), Math.cos(threat.ang - angle));
  if (Math.abs(error) > 1e-5) throw new Error(`${name}方警示方向错误：actual=${threat.ang}, expected=${angle}`);
  return { direction: name, actualDegrees: threat.ang * 180 / Math.PI, errorDegrees: error * 180 / Math.PI };
});
if (__PI.errors.length || __PI.exceptions.length) throw new Error(JSON.stringify({ errors: __PI.errors, exceptions: __PI.exceptions }));
return { result: 'PASS', samples };

if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.screenshot('title');
__PI.freeze(true);
const G = __PI.G;
const project = point => {
  const vp = G.camera.vp, { x, y, z } = point;
  const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  return {
    x: (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w * 0.5 + 0.5,
    y: 0.5 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w * 0.5,
  };
};
const samples = [];
for (const seconds of [0.02, 4, 8]) {
  __PI.step(seconds);
  const center = project(G.player.pos);
  samples.push(center);
  if (center.x < 0.74 || center.x > 0.94 || center.y < 0.40 || center.y > 0.86) {
    throw new Error(`封面飞机未位于右侧展示区：${JSON.stringify(center)}`);
  }
}
if (__PI.errors.length) throw new Error(JSON.stringify(__PI.errors));
return { result: 'PASS', samples };

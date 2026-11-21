// 新版树保留共享实例位置和尺度；只替换两张静态网格，冠影仍投在实际地面上。
(() => {
  buildPineTree = function () {
    const mb = new MeshBuilder({ x: 0, y: 15.7, z: 0 });
    mb.box(0, 15.7, 0, 2.7, 31.4, 2.7, rgb('#54444a'));
    const needle = ['#485450', '#596952', '#657252', '#838657', '#636f58'].map(rgb);
    const shade = rgb('#41444a');
    for (const [i, [y, r, h]] of [[6, 12, 5.5], [12, 10.1, 6], [19, 8.1, 5.4], [25.2, 6.2, 5.1], [30.4, 3.7, 5.6]].entries()) {
      const tip = { x: -0.25 * i, y: y + h, z: 0.15 * i };
      const hub = { x: tip.x, y: y + h * 0.20, z: tip.z };
      const rim = Array.from({ length: 8 }, (_, j) => {
        const a = j * TAU / 8 + i * 0.43, reach = r * (j % 2 ? 0.75 : 1);
        return { x: hub.x + Math.cos(a) * reach, y: y + (j % 2 ? 1 : -0.6), z: hub.z + Math.sin(a) * reach };
      });
      mb.center = hub;
      for (let j = 0; j < rim.length; j++) {
        const next = rim[(j + 1) % 8];
        mb.tri(rim[j], next, tip, needle[(j + i) % needle.length], -2);
        mb.tri(rim[j], hub, next, shade);
      }
    }
    return Object.assign(mb.radius(24).build(), { height: 36, crownRadius: 12, crownBase: 5.4 });
  };

  buildAutumnTree = function () {
    const mb = new MeshBuilder({ x: 0, y: 8, z: 0 }), bark = rgb('#634851');
    mb.box(0, 5, 0, 3.1, 10, 2.7, bark);
    mb.beam({ x: 0, y: 5.3, z: 0 }, { x: -4.6, y: 13.2, z: 1 }, 0.64, 0.6, bark);
    mb.beam({ x: 0, y: 6.4, z: 0 }, { x: 4.1, y: 14.3, z: -1.1 }, 0.64, 0.6, bark);
    const leaves = ['#bd915d', '#c69961', '#cba16b', '#b88e60', '#b3875e', '#c59a68'].map(rgb);
    const firstLeaf = mb.emi.length;
    // 冠团沿分叉错开，边缘留凹口；斜顶错峰，轮廓无需新增绘制批次。
    for (const [i, [x,y,z,w,h,d]] of [[-2.3,20.4,-3.0,8.5,5.5,7.4],[-7.6,14.2,2.9,6.5,6.9,5.6],
      [2.8,16.8,7.0,7.1,4.9,6.0],[7.0,16.3,-2.1,6.4,5.3,6.4],[-4.9,15.6,-8.0,6.1,4.9,5.3]].entries()) {
      const rim = [], shoulder = [];
      const point = (a,r,b) => ({ x:x+Math.cos(a)*w*r, y:y+h*b, z:z+Math.sin(a)*d*r });
      const crown = point(i * 1.7, .21, 1), base = point(i, .10, -1);
      mb.center = {x,y,z};
      for (let j=0; j<6; j++) {
        const a = j*TAU/6 + i*.59, v = (i+2*j)%5 / 4;
        rim.push(point(a, .87+.13*v, -.23+.11*v));
        shoulder.push(point(a+.18, .76+.15*(1-v), .48+.18*v));
      }
      for (let j=0; j<6; j++) {
        const k=(j+1)%6, shade=leaves[(i+j)%6];
        mb.tri(base,rim[j],rim[k],shade); mb.quad(rim[j],shoulder[j],shoulder[k],rim[k],shade);
        mb.tri(crown,shoulder[k],shoulder[j],leaves[(i+j+1)%6]);
      }
    }
    // 实例树本来就不发光；负材质码标出叶面，让同一株的树干不吃秋色。
    mb.emi.fill(-1, firstLeaf);
    return Object.assign(mb.radius(21).build(), { height: 25.9, crownRadius: 13.5, crownBase: 7.3 });
  };
  const collect = Forest.collect;
  let pineValues = new Float32Array(0), autumnValues = new Float32Array(0);

  function hash(x, z) {
    let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ 0x6d2b79f5;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  function noise(x, z, period) {
    const px = (x - Math.floor(x / WORLD_SIZE) * WORLD_SIZE) / WORLD_SIZE * period;
    const pz = (z - Math.floor(z / WORLD_SIZE) * WORLD_SIZE) / WORLD_SIZE * period;
    const ix = Math.floor(px), iz = Math.floor(pz), tx = px - ix, tz = pz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const x1 = (ix + 1) % period, z1 = (iz + 1) % period;
    const a = hash(ix, iz), b = hash(x1, iz), c = hash(ix, z1), d = hash(x1, z1);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  }

  Forest.collect = function (camera, player, meshes, view) {
    const batches = collect.call(this, camera, player, meshes, view);
    let pine, autumn;
    for (const batch of batches) {
      if (batch.mesh === meshes.pineTree) pine = batch;
      else if (batch.mesh === meshes.autumnTree) autumn = batch;
    }
    if (pine && autumn && pine.instanceCount > 0) {
      const needed = (pine.instanceCount + autumn.instanceCount) * 8;
      if (pineValues.length < needed) {
        const capacity = 2 ** Math.ceil(Math.log2(needed));
        pineValues = new Float32Array(capacity);
        autumnValues = new Float32Array(capacity);
      }
      let p = 0, a = autumn.instanceCount * 8;
      autumnValues.set(autumn.instances);
      const values = pine.instances;
      for (let i = 0; i < pine.instanceCount * 8; i += 8) {
        const x = values[i], z = values[i + 2];
        const promote = noise(x, z, 8) * 0.75 + noise(x, z, 16) * 0.25 > 0.5;
        const target = promote ? autumnValues : pineValues, at = promote ? a : p;
        // Copy scalars: no per-tree record or subarray allocation in the frame loop.
        for (let j = 0; j < 8; j++) target[at + j] = values[i + j];
        if (promote) a += 8; else p += 8;
      }
      pine.instances = pineValues.subarray(0, p); pine.instanceCount = p / 8;
      autumn.instances = autumnValues.subarray(0, a); autumn.instanceCount = a / 8;
    }
    // Empty instanced batches would fall through to a non-instanced identity draw.
    let kept = 0;
    for (const batch of batches) {
      if ((batch.mesh === meshes.pineTree || batch.mesh === meshes.autumnTree) && batch.instanceCount === 0) continue;
      batches[kept++] = batch;
    }
    batches.length = kept;
    return batches;
  };
})();

// 正式起飞和键盘输入；不写玩家姿态、位置、相机或受击状态。
const check = (ok, message) => { if (!ok) throw Error(message); };
const deadline = performance.now()+60000;
while (!window.__PI?.ready()) {
  if (__PI?.boot?.error || performance.now() > deadline) throw Error(__PI?.boot?.error || '空域未加载');
  await new Promise(r => setTimeout(r, 80));
}
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup', { code, bubbles:true }));
const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const scenarios = [];
for (const mode of ['cruise','intercept']) {
  __SKY.home(); __PI.freeze(true);
  document.getElementById(`sky-${mode}`).click(); __PI.freeze(true);
  const g = __PI.G, p = g.player;
  check(g.mode === 'play' && g.view === 1, `${mode}没有默认正后追尾起飞`);
  __PI.step(.2);
  const edges = [[30,'KeyD',1],[75,'KeyD',0],[120,'KeyA',1],[165,'KeyA',0],
    [190,'KeyW',1],[214,'KeyW',0],[250,'ShiftLeft',1],[350,'ShiftLeft',0],[370,'KeyQ',1],[371,'KeyQ',0]];
  let maxBank=0, maxYawRate=0, maxHorizonRoll=0, maxLateral=0, maxPitchAcceleration=0, maxSpin=0;
  let minFov=g.camera.fov, maxFov=minFov, angle=Math.asin(g.camera.fwd.y), velocity=0, minFuel=p.fuel, maxSpeed=p.speed;
  const samples=[];
  for (let frame=0; frame<420; frame++) {
    for (const [at,code,down] of edges) if (frame===at) key(code,down);
    __PI.step(1/60);
    const c=g.camera, nextAngle=Math.asin(c.fwd.y), nextVelocity=(nextAngle-angle)*60;
    maxBank=Math.max(maxBank,Math.abs(p.roll));
    maxYawRate=Math.max(maxYawRate,Math.abs(p.yawRate));
    maxHorizonRoll=Math.max(maxHorizonRoll,Math.abs(Math.asin(c.right.y)));
    maxLateral=Math.max(maxLateral,Math.abs((c.pos.x-p.pos.x)*Math.cos(p.yaw)+(c.pos.z-p.pos.z)*Math.sin(p.yaw)));
    maxPitchAcceleration=Math.max(maxPitchAcceleration,Math.abs(nextVelocity-velocity)*60);
    maxSpin=Math.max(maxSpin,Math.abs(p.spin));
    minFov=Math.min(minFov,c.fov); maxFov=Math.max(maxFov,c.fov);
    minFuel=Math.min(minFuel,p.fuel); maxSpeed=Math.max(maxSpeed,p.speed);
    angle=nextAngle; velocity=nextVelocity;
    check(g.mode==='play' && g.view===1, `${mode}航次意外离开追尾飞行`);
    if (frame%60===0 || edges.some(([at])=>at===frame)) samples.push({frame,pos:{...p.pos},yaw:p.yaw,pitch:p.pitch,roll:p.roll,spin:p.spin,shield:p.shield,camera:{pos:{...c.pos},fwd:{...c.fwd},right:{...c.right},fov:c.fov}});
  }
  await paint();
  const metrics={mode,maxBank,maxYawRate,maxHorizonRoll,maxLateral,maxPitchAcceleration,maxSpin,fovSpan:maxFov-minFov,minFuel,maxSpeed};
  scenarios.push({...metrics,samples});
  console.log('追尾舒适性测量 '+JSON.stringify(metrics));
  check(maxBank>.35 && maxBank<=.56 && maxSpin>6 && maxSpeed>200 && minFuel<75,'真实倾斜、桶滚或加力未按预期发生');
  check(maxYawRate>.20 && maxYawRate<=.38, `追尾普通转向超出舒适范围 ${maxYawRate.toFixed(3)} rad/s`);
  check(maxHorizonRoll<1e-5, `A/D使整个世界倾斜${(maxHorizonRoll*180/Math.PI).toFixed(2)}°`);
  check(maxLateral<1e-4, `机位仍随机翼绕动${maxLateral.toFixed(2)}米`);
  check(maxPitchAcceleration<12, `抬头/松键抽动${maxPitchAcceleration.toFixed(2)} rad/s²`);
  check(maxFov-minFov<1e-7, '加速仍使追尾视野泵动');
}
check(!__PI.errors.length&&!__PI.exceptions.length,JSON.stringify([__PI.errors,__PI.exceptions]));
return {result:'PASS',scenarios};

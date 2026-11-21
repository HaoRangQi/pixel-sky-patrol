// 正式截击中等待自然来袭命中，不摆敌机、不写护盾或震动量。
const check=(ok,message)=>{if(!ok)throw Error(message);};
const deadline=performance.now()+65000;
while(!window.__PI?.ready()){
  if(window.__PI?.boot?.error||performance.now()>deadline)throw Error(window.__PI?.boot?.error||'空域未加载');
  await new Promise(r=>setTimeout(r,80));
}
__SKY.home();__PI.freeze(true);document.getElementById('sky-intercept').click();__PI.freeze(true);
const g=__PI.G,p=g.player;
for(let frame=0;frame<2700&&p.shield===100&&g.mode==='play';frame++)__PI.step(1/60);
check(p.shield<100&&p.shield>0&&g.stats.dmg>0&&g.shake>.1,'没有发生保留震动事件的真实战斗受击');
const hit={time:g.time,shield:p.shield,damage:g.stats.dmg,shake:g.shake};
let maxHorizonRoll=0,maxLateral=0,maxPositionError=0;
for(let frame=0;frame<30;frame++){
  const c=g.camera;
  maxHorizonRoll=Math.max(maxHorizonRoll,Math.abs(c.right.y));
  maxLateral=Math.max(maxLateral,Math.abs((c.pos.x-p.pos.x)*Math.cos(p.yaw)+(c.pos.z-p.pos.z)*Math.sin(p.yaw)));
  const f={x:Math.sin(p.yaw)*Math.cos(p.pitch),y:Math.sin(p.pitch),z:-Math.cos(p.yaw)*Math.cos(p.pitch)};
  const expected={x:p.pos.x-f.x*22.5,y:p.pos.y-f.y*22.5+8,z:p.pos.z-f.z*22.5};
  expected.y=Math.max(expected.y,Math.max(0,g.map.heightAt(expected.x,expected.z))+4.5);
  maxPositionError=Math.max(maxPositionError,Math.hypot(c.pos.x-expected.x,c.pos.y-expected.y,c.pos.z-expected.z));
  check(c.fov===1.01,'受击改变了追尾视野');
  if(frame<29)__PI.step(1/60);
}
await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
check(g.mode==='play'&&g.view===1&&maxHorizonRoll<1e-6&&maxLateral<1e-5&&maxPositionError<.001,`真实受击后镜头仍偏移：${JSON.stringify({maxHorizonRoll,maxLateral,maxPositionError})}`);
check(document.getElementById('sky-system-shield-value').textContent===`${Math.ceil(p.shield)}%`,'自然受击的追尾护盾监控未更新');
check(!__PI.errors.length&&!__PI.exceptions.length,JSON.stringify([__PI.errors,__PI.exceptions]));
return {result:'PASS',hit,current:{time:g.time,shield:p.shield,display:document.getElementById('sky-system-shield-value').textContent,shake:g.shake},maxHorizonRoll,maxLateral,maxPositionError};

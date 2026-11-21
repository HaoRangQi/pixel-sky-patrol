// 正式起飞、视角与武器操作验证监控；不写入飞机、相机、盾量或弹量。
const end=performance.now()+65000;
while(!window.__PI?.ready()){
  if(window.__PI?.boot?.error||performance.now()>end)throw Error(window.__PI?.boot?.error||'游戏未就绪');
  await new Promise(resolve=>setTimeout(resolve,90));
}
const check=(ok,message)=>{if(!ok)throw Error(message);};
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const key=(code,down)=>window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}));
const element=id=>document.getElementById(id);
const button=action=>document.querySelector(`[data-sky-action="${action}"]`);
const read=id=>element(`sky-system-${id}-value`)?.textContent;
const click=target=>{
  const r=target.getBoundingClientRect();
  check(r.width>0&&r.height>0&&!target.disabled,'正式按钮不可操作');
  check(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===target,'监控遮住正式按钮');
  target.click();
};
const hold=(target,down,id)=>target.dispatchEvent(new PointerEvent(down?'pointerdown':'pointerup',{pointerId:id,button:0,pointerType:'mouse',bubbles:true}));
const canvas=element('ui'),ctx=canvas.getContext('2d'),prototype=CanvasRenderingContext2D.prototype,glyphs=new WeakMap();
const original={text:prototype.fillText,image:ctx.drawImage,clear:ctx.clearRect};
let painted=[];
function point(x,y){
  const t=ctx.getTransform(),r=canvas.getBoundingClientRect();
  return {x:(x*t.a+y*t.c+t.e)*r.width/canvas.width,y:(x*t.b+y*t.d+t.f)*r.height/canvas.height,scale:Math.hypot(t.c,t.d)*r.height/canvas.height};
}
const fontSize=context=>Number(/([\d.]+)px/.exec(context.font)?.[1]||0);
prototype.fillText=function(value,x,y,...args){
  if(this===ctx){const p=point(x,y);painted.push({value:String(value),x:p.x,y:p.y,size:fontSize(this)*p.scale});}
  else glyphs.set(this.canvas,{value:String(value),x,y,size:fontSize(this)});
  return original.text.call(this,value,x,y,...args);
};
ctx.clearRect=function(...args){painted=[];return original.clear.apply(this,args);};
ctx.drawImage=function(image,x,y,w,h,...args){
  const glyph=glyphs.get(image);
  if(glyph&&!args.length){const p=point(x+glyph.x*w/image.width,y+glyph.y*h/image.height);painted.push({value:glyph.value,x:p.x,y:p.y,size:glyph.size*h/image.height*p.scale});}
  return original.image.call(this,image,x,y,w,h,...args);
};
const has=value=>painted.some(t=>t.value===value);
try{
__SKY.home();click(element('sky-intercept'));__PI.freeze(true);__PI.step(.1);
const g=__PI.G,p=g.player;
await paint();
const monitor=element('sky-systems');
check(g.view===1&&monitor&&!monitor.hidden&&element('sky-app').dataset.hud==='flight','正式默认追尾没有完整飞行HUD及无障碍镜像');
for(const id of ['fuel','shield']){
  const meter=element(`sky-system-${id}-meter`);
  check(meter&&Math.abs(meter.value-p[id])<.11,`${id}无障碍资源条没有使用实际值`);
}
const stage=canvas.getBoundingClientRect(),unit=stage.height/340;
function checkLayout(view){
  check(!monitor.hidden&&element('sky-app').dataset.hud==='flight',`${view}缺少完整飞行HUD状态`);
  check(/^inset\(50%/.test(getComputedStyle(monitor).clipPath),`${view}旧DOM小监控重复显示`);
  const readable = tag => painted.find(t => t.value === tag && t.size >= 9.8);
  for (const tag of ['燃油', '护盾', '机炮', '导弹', '加力', '干扰']) {
    const t = readable(tag);
    check(t,`${view}没有在画布实际绘制可读的${tag}：${JSON.stringify(painted.filter(t=>t.value===tag))}`);
    check(t.x>=0&&t.x<=stage.width&&t.y>=0&&t.y+t.size*.25<=stage.height-2,`${view}${tag}溢出画布`);
  }
  check(getComputedStyle(element('sky-brand')).visibility==='hidden',`${view}品牌仍覆盖游戏`);
  check(has(`${Math.ceil(g.player.fuel)}%`),`${view}燃油实际读数缺失`);
  check(has(`${Math.ceil(g.player.shield)}%`)||has(String(Math.ceil(g.player.shield))),`${view}护盾实际读数缺失`);
  check(has(read('gun'))&&has(read('boost')),`${view}机炮或加力实际状态缺失`);
  check(has(read('missile'))||!g.player.reloads.length&&has(String(g.player.missiles)),`${view}导弹实际读数缺失`);
  check(has(read('flare'))||g.player.flareCd<=.1&&has(String(g.player.flares)),`${view}干扰实际读数缺失`);
  return {labels:6,minimumLabelCssPx:Math.min(...['燃油','护盾','机炮','导弹','加力','干扰'].map(tag=>readable(tag).size)),domMirror:'sr-only'};
}
const chaseRect=checkLayout('默认追尾');
for(const [id,value] of [['fuel',`${Math.ceil(p.fuel)}%`],['shield',`${Math.ceil(p.shield)}%`],['gun','待发'],['missile','4/4'],['boost','待命'],['flare','3']])check(read(id)===value,`初始${id}读数错误：${read(id)}`);
const beforeFuel=p.fuel, beforeShots=g.stats.shots, beforeMissiles=p.missiles;
try{
  hold(button('boost'),true,71);__PI.step(.6);await paint();
  check(p.burning&&p.fuel<beforeFuel&&read('fuel')===`${Math.ceil(p.fuel)}%`&&read('boost')==='接通','正式加力后燃油/加力读数不更新');
  check(Math.abs(element('sky-system-fuel-meter').value-p.fuel)<.11,'真实耗油后资源条比例没有更新');
  checkLayout('真实加力');
  hold(button('gun'),true,72);__PI.step(.2);await paint();
  check(g.stats.shots>beforeShots&&g.bullets.some(b=>b.owner==='player')&&read('gun')==='连射','正式机炮连射没有显示实际状态');
  click(button('missile'));await paint();
  check(p.missiles===beforeMissiles-1&&read('missile').startsWith(`${p.missiles}/4 · `),'正式导弹发射后库存/装填不更新');
  key('KeyC',true);key('KeyC',false);await paint();
  check(p.flares===2&&read('flare').startsWith('2 · '),'正式干扰操作后库存/冷却不更新');
  checkLayout('连射、导弹装填与干扰冷却');
}finally{hold(button('gun'),false,72);hold(button('boost'),false,71);}
__PI.step(.2);await paint();check(read('gun')==='待发'&&read('boost')==='待命','释放后系统状态没有复位');
const shots=g.stats.shots;
click(button('gun'));await paint();check(g.stats.shots===shots+1&&read('gun')==='循环','单击正式机炮按钮未触发循环显示');
const firstHit=p.lastHit, damage=g.stats.dmg;
for(let i=0;i<450&&p.lastHit===firstHit&&g.mode==='play';i++)__PI.step(.1);
await paint();
check(p.lastHit>firstHit&&g.stats.dmg>damage&&p.shield<100,'未遇到真实伤害，不能声称护盾动态验收');
check(read('shield')===`${Math.ceil(p.shield)}%`,'真实受击后护盾显示与实际盾量不同');
check(Math.abs(element('sky-system-shield-meter').value-p.shield)<.11,'真实受击后护盾资源条比例没有更新');
checkLayout('自然受击');
const chase={fuel:read('fuel'),shield:read('shield'),gun:read('gun'),missile:read('missile'),boost:read('boost'),flare:read('flare'),time:g.time,damage:g.stats.dmg,rect:chaseRect};
for(let i=0;i<2;i++){click(element('sky-camera'));__PI.step(1.4);}
await paint();
check(g.view===0,'未切换到实际俯视');
const top=checkLayout('近距俯视');
for(const id of ['fuel','shield'])check(Math.abs(element(`sky-system-${id}-meter`).value-p[id])<.11,`俯视${id}资源条与真实状态不同`);
// 从俯视回追尾，再进入座舱；实际绘制的数字也要随相同状态变化。
for(let i=0;i<2;i++){click(element('sky-camera'));__PI.step(1.4);}
check(g.view===2&&g.cockpitAlpha>.99,'监控改造破坏座舱切换');
async function paintedSystems(){
  await paint();
  const labels=painted.map(t=>t.value);
  for(const value of [`${Math.ceil(p.fuel)}%`,`${Math.ceil(p.shield)}%`])check(labels.includes(value),`座舱实际绘制缺少${value}`);
  for(const glyph of painted.filter(t=>t.value.endsWith('%')))check(glyph.size>=9,`座舱监控字号仅${glyph.size}CSS像素`);
  return labels;
}
let labels=await paintedSystems();
for(const tag of ['燃油','护盾','机炮','导弹','加力','干扰'])check(labels.includes(tag),`座舱没有实际绘制${tag}`);
try{
  key('ShiftLeft',true);key('KeyF',true);__PI.step(.3);
  labels=await paintedSystems();
  check(p.burning&&labels.includes('接通')&&labels.includes('连射'),'座舱真实加力/连射显示没有变化');
}finally{key('ShiftLeft',false);key('KeyF',false);}
check(monitor.hidden,'外部监控不应悬浮遮住座舱仪表');
__SKY.home();click(element('sky-cruise'));__PI.freeze(true);__PI.step(.1);await paint();
check(__PI.G.view===1&&!monitor.hidden,'自由巡航默认追尾缺少机载监控');
const cruise=checkLayout('巡航追尾');
click(button('pause'));await paint();check(!monitor.hidden,'暂停时监控不应消失');
click(element('sky-resume'));await paint();check(!monitor.hidden,'恢复后追尾监控没有恢复');
__SKY.home();await paint();check(monitor.hidden,'待命时不应遗留战斗监控');
check(!__PI.errors.length&&!__PI.exceptions.length,JSON.stringify([__PI.errors,__PI.exceptions]));
return {result:'PASS',viewport:[innerWidth,innerHeight],chase,top,cruise,cockpit:{shield:p.shield,fuel:p.fuel,view:2}};
}finally{prototype.fillText=original.text;ctx.drawImage=original.image;ctx.clearRect=original.clear;}

if (!__PI.ready()) throw new Error('游戏未加载完成');
const G=__PI.G,renderer=__PI.renderer,gl=renderer.gl;
if(G.mode!=='title')throw new Error(`测试必须从真实标题画面开始：mode=${G.mode}`);
const treeMeshes=[G.meshes.pineTree,G.meshes.autumnTree],treeSet=new Set(treeMeshes);
const treeVaos=new Set(treeMeshes.flatMap(mesh=>[mesh&&mesh.vao,mesh&&mesh.instanceVao,mesh&&mesh.instancedVAO]).filter(Boolean));
const oldRender=renderer.render,oldBind=gl.bindVertexArray,oldDraw=gl.drawArrays,oldDrawInstanced=gl.drawArraysInstanced;
let boundVao=null,frame=null,sortieStart=0,capturing=false;
const frames=[],samples=[];
let launchPosition,launchClearance;
try{
 renderer.render=function(camera,map,time,objects,fx){
  frame={batches:objects.filter(o=>treeSet.has(o.mesh)),drawCalls:0,instanceCounts:[],treeDrawCalls:0,instancedDrawCalls:0,nonInstancedTreeDrawCalls:0,treeInstanceCounts:[]};
  const started=performance.now();
  try{return oldRender.call(this,camera,map,time,objects,fx)}
  finally{frame.cpuSubmitMs=performance.now()-started;frame.at=performance.now()-sortieStart;if(capturing)frames.push(frame);frame=null}
 };
 gl.bindVertexArray=function(vao){boundVao=vao;return oldBind.call(this,vao)};
 gl.drawArrays=function(...args){if(frame){frame.drawCalls++;if(treeVaos.has(boundVao)){frame.treeDrawCalls++;frame.nonInstancedTreeDrawCalls++}}return oldDraw.apply(this,args)};
 gl.drawArraysInstanced=function(...args){if(frame){frame.drawCalls++;frame.instanceCounts.push(args[3]);if(treeVaos.has(boundVao)){frame.treeDrawCalls++;frame.instancedDrawCalls++;frame.treeInstanceCounts.push(args[3])}}return oldDrawInstanced.apply(this,args)};
 const key=(code,down)=>window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,key:code==='Enter'?'Enter':undefined,bubbles:true}));
 key('Enter',true);key('Enter',false);
 if(G.mode!=='play'||!G.player)throw new Error(`标题Enter未正常出击：mode=${G.mode}`);
 const p=G.player;
 launchPosition={...p.pos};
 launchClearance=p.pos.y-G.map.heightAt(p.pos.x,p.pos.z);
 sortieStart=performance.now();capturing=true;
 const waitFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const waitUntil=deadline=>new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-performance.now())));
 for(const seconds of [0,5,10,15]){
  await waitUntil(sortieStart+seconds*1000);await waitFrames();
  const elapsedMs=performance.now()-sortieStart;
  const recent=frames.filter(f=>f.at>=seconds*1000-500&&f.at<=elapsedMs);
  const capture=recent.at(-1);
  if(!capture)throw new Error(`未捕获${seconds}秒渲染帧`);
  const batches=capture.batches.map(draw=>({species:draw.mesh===G.meshes.pineTree?'pine':'autumn',instances:draw.instances,instanceCount:draw.instanceCount,outline:draw.outline,rim:draw.rim}));
  const trees=batches.reduce((total,batch)=>total+(batch.instances instanceof Float32Array?batch.instances.length/8:0),0);
  const camera=G.camera,tanHalf=Math.tan(camera.fov*0.5),halfWidthFactor=tanHalf*camera.aspect;
  const midrangeTrees=batches.reduce((total,batch)=>{
   if(!(batch.instances instanceof Float32Array))return total;
   for(let i=0;i<batch.instances.length;i+=8){
    const dx=batch.instances[i]-camera.pos.x,dy=batch.instances[i+1]-camera.pos.y,dz=batch.instances[i+2]-camera.pos.z;
    const depth=dx*camera.fwd.x+dy*camera.fwd.y+dz*camera.fwd.z;
    const screenX=dx*camera.right.x+dy*camera.right.y+dz*camera.right.z;
    const screenY=dx*camera.up.x+dy*camera.up.y+dz*camera.up.z;
    if(depth>=100&&depth<=2200&&Math.abs(screenX)<=depth*halfWidthFactor&&Math.abs(screenY)<=depth*tanHalf)total++;
   }
   return total;
  },0);
  const batchLayoutValid=batches.every(batch=>batch.instances instanceof Float32Array&&batch.instances.length>0&&batch.instances.length%8===0&&batch.instanceCount===batch.instances.length/8&&batch.instances.every(Number.isFinite)&&!batch.instances.some((value,index)=>index%8===3&&value<=0)&&batch.outline===false&&batch.rim===false);
  const treeInstanceCounts=capture.treeInstanceCounts;
  samples.push({
   seconds,elapsedMs,simulationSeconds:G.time,trees,midrangeTrees,treeBatches:batches.map(({species,instanceCount,outline,rim})=>({species,instanceCount,outline,rim})),
   drawCalls:capture.drawCalls,treeDrawCalls:capture.treeDrawCalls,instancedDrawCalls:capture.instancedDrawCalls,nonInstancedTreeDrawCalls:capture.nonInstancedTreeDrawCalls,
   instanceCounts:capture.instanceCounts,treeInstanceCounts,actualInstances:treeInstanceCounts.reduce((sum,count)=>sum+count,0),batchLayoutValid,
   frameStats:recent.map(f=>({atMs:+f.at.toFixed(1),drawCalls:f.drawCalls,treeDrawCalls:f.treeDrawCalls,instanceCounts:f.instanceCounts,treeInstanceCounts:f.treeInstanceCounts,cpuSubmitMs:+f.cpuSubmitMs.toFixed(3)})),
  });
 }
}finally{
 capturing=false;renderer.render=oldRender;gl.bindVertexArray=oldBind;gl.drawArrays=oldDraw;gl.drawArraysInstanced=oldDrawInstanced;
}
const failures=[];
for(const sample of samples){
 if(sample.midrangeTrees<20)failures.push(`${sample.seconds}s可见中景树不足20：${sample.midrangeTrees}`);
 if(sample.trees>9000)failures.push(`${sample.seconds}s树木超过预算：${sample.trees}`);
 if(sample.treeBatches.length>4||new Set(sample.treeBatches.map(batch=>batch.species)).size>2||sample.treeDrawCalls>4||sample.nonInstancedTreeDrawCalls||sample.instancedDrawCalls!==sample.treeBatches.length)failures.push(`${sample.seconds}s树木draw未合批：${JSON.stringify(sample)}`);
 if(sample.actualInstances!==sample.trees||sample.treeInstanceCounts.slice().sort((a,b)=>a-b).join(',')!==sample.treeBatches.map(batch=>batch.instanceCount).sort((a,b)=>a-b).join(','))failures.push(`${sample.seconds}s实际instanced调用与batch数量不匹配：${JSON.stringify(sample)}`);
 if(!sample.batchLayoutValid)failures.push(`${sample.seconds}s树木批次布局/描边/rim无效`);
}
const launchSample=samples[0];
if(launchClearance<550||launchClearance>650||launchPosition.y>=1000||!launchSample||launchSample.seconds!==0)failures.push(`标题Enter后的默认低空出击异常：${JSON.stringify({launchPosition,launchClearance})}`);
if(G.mode!=='play'&&G.mode!=='waveclear')failures.push(`正常出击未保持飞行：mode=${G.mode}`);
if(__PI.errors.length||__PI.exceptions.length)failures.push(`页面错误：${JSON.stringify({errors:__PI.errors,exceptions:__PI.exceptions})}`);
if(failures.length)throw new Error(`${failures.join('；')}；samples=${JSON.stringify(samples)}`);
return{result:'PASS',mode:G.mode,launchPosition,launchClearance,samples};

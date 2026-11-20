if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('chase'); __PI.freeze(true);
const G=__PI.G,p=G.player,renderer=__PI.renderer,gl=renderer.gl;
G.enemies=[];G.ground=[];G.banner=null;
const origin={x:p.pos.x,z:p.pos.z};let site=null,best=-Infinity;
for(let z=origin.z-1200;z<=origin.z+1200;z+=64)for(let x=origin.x-1200;x<=origin.x+1200;x+=64){
 const h=G.map.heightAt(x,z),forest=G.map.forestAt(x,z),slope=G.map.slopeAt(x,z);
 if(h<30||h>700||forest<.42||slope>.46)continue;
 const score=forest-slope*.55-Math.abs(h-300)*.0002;
 if(score>best){best=score;site={x,z,h};}
}
if(!site)throw new Error('找不到满足树木生成条件的森林地形');
p.pos={x:site.x-240,y:site.h+180,z:site.z-360};
p.yaw=Math.atan2(site.x-p.pos.x,-(site.z-p.pos.z));p.pitch=-.2;p.roll=0;
__PI.setView('chase');__PI.step(1/60);
const treeMeshes=[G.meshes.pineTree,G.meshes.autumnTree],treeSet=new Set(treeMeshes);
const treeVaos=new Set(treeMeshes.flatMap(mesh=>[mesh&&mesh.vao,mesh&&mesh.instanceVao,mesh&&mesh.instancedVAO]).filter(Boolean));
const oldRender=renderer.render,oldBind=gl.bindVertexArray,oldDraw=gl.drawArrays,oldDrawInstanced=gl.drawArraysInstanced;
let boundVao=null,frame=null;const frames=[];
try{
 renderer.render=function(camera,map,time,objects,fx){frame={batches:objects.filter(o=>treeSet.has(o.mesh)),drawCalls:0,instanceCounts:[],treeDrawCalls:0,instancedDrawCalls:0,nonInstancedTreeDrawCalls:0,treeInstanceCounts:[]};const started=performance.now();try{return oldRender.call(this,camera,map,time,objects,fx)}finally{frame.cpuSubmitMs=performance.now()-started;frames.push(frame);frame=null}};
 gl.bindVertexArray=function(vao){boundVao=vao;return oldBind.call(this,vao)};
 gl.drawArrays=function(...args){if(frame){frame.drawCalls++;if(treeVaos.has(boundVao)){frame.treeDrawCalls++;frame.nonInstancedTreeDrawCalls++}}return oldDraw.apply(this,args)};
 gl.drawArraysInstanced=function(...args){if(frame){frame.drawCalls++;frame.instanceCounts.push(args[3]);if(treeVaos.has(boundVao)){frame.treeDrawCalls++;frame.instancedDrawCalls++;frame.treeInstanceCounts.push(args[3])}}return oldDrawInstanced.apply(this,args)};
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}finally{renderer.render=oldRender;gl.bindVertexArray=oldBind;gl.drawArrays=oldDraw;gl.drawArraysInstanced=oldDrawInstanced}
if(!G.meshes.pineTree||!G.meshes.autumnTree)throw new Error('低模针叶树/秋叶树网格未创建');
if(G.meshes.pineTree.count<90||G.meshes.autumnTree.count<90)throw new Error('树木网格细节不足');
const capture=frames.at(-1);if(!capture)throw new Error('未捕获公开渲染帧');
const treeDraws=capture.batches,trees=treeDraws.reduce((total,draw)=>total+(draw.instances instanceof Float32Array?draw.instances.length/8:0),0);
const badLayout=treeDraws.some(draw=>!(draw.instances instanceof Float32Array)||draw.instances.length===0||draw.instances.length%8!==0||draw.instanceCount!==draw.instances.length/8||!draw.instances.every(Number.isFinite)||draw.instances.some((value,index)=>index%8===3&&value<=0));
const actualInstances=capture.treeInstanceCounts.reduce((total,count)=>total+count,0);
if(trees<400)throw new Error(`低空近林实例树木数量不足：${trees}；统计=${JSON.stringify({batches:treeDraws.length,treeDrawCalls:capture.treeDrawCalls,instanceCounts:capture.treeInstanceCounts,cpuSubmitMs:capture.cpuSubmitMs})}`);
if(trees>9000)throw new Error(`低空近林树木超过预算：${trees}`);
if(badLayout)throw new Error('树木批次必须是完整有限值的8-float Float32Array且instanceCount匹配');
if(treeDraws.length>4||treeDraws.some(draw=>draw.outline!==false||draw.rim!==false))throw new Error(`树木批次过多或描边/rim未关闭：${treeDraws.length}`);
if(new Set(treeDraws.map(draw=>draw.mesh)).size>2)throw new Error('树木batch超过两种网格');
if(capture.nonInstancedTreeDrawCalls||capture.instancedDrawCalls!==treeDraws.length||actualInstances!==trees||capture.treeDrawCalls>4)throw new Error(`树木未由预期instanced调用提交：${JSON.stringify({batches:treeDraws.length,treeDrawCalls:capture.treeDrawCalls,instancedDrawCalls:capture.instancedDrawCalls,nonInstancedTreeDrawCalls:capture.nonInstancedTreeDrawCalls,instanceCounts:capture.treeInstanceCounts,trees})}`);
if(__PI.errors.length||__PI.exceptions.length)throw new Error(JSON.stringify({errors:__PI.errors,exceptions:__PI.exceptions}));
return{result:'PASS',site,siteScore:best,treesInLowFlightView:trees,treeBatches:treeDraws.length,drawCalls:capture.drawCalls,treeDrawCalls:capture.treeDrawCalls,instanceCounts:capture.treeInstanceCounts,cpuSubmitMs:capture.cpuSubmitMs,playerAltitude:p.pos.y,clearance:p.pos.y-G.map.heightAt(p.pos.x,p.pos.z),pitch:p.pitch};

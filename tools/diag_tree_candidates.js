if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('chase'); __PI.freeze(true);
const G=__PI.G,p=G.player,r=__PI.renderer;
G.enemies=[];G.ground=[];G.banner=null;
p.pos.y=Math.max(0,G.map.heightAt(p.pos.x,p.pos.z))+600;
p.yaw=G.spawn.heading;p.pitch=0;p.roll=0;__PI.setView('top');__PI.step(1/60);
const counts={grid:0,radial:0,height:0,forest:0,slope:0,project:0,screen:0,crownScreen:0,top24:0,top40:0,top60:0};
const viewH=340,viewW=viewH*G.camera.aspect;
const hash=(x,z,s=0)=>{const v=Math.sin(x*127.1+z*311.7+s*74.7)*43758.5453123;return v-Math.floor(v)};
for(const [spacing,minR,maxR] of [[32,35,270],[64,270,900]]){
 const bx=Math.floor(p.pos.x/spacing),bz=Math.floor(p.pos.z/spacing),range=Math.ceil(maxR/spacing)+1;
 for(let iz=-range;iz<=range;iz++)for(let ix=-range;ix<=range;ix++){
  counts.grid++;const gx=bx+ix,gz=bz+iz;
  const x=(gx+.5)*spacing+(hash(gx,gz,1)-.5)*spacing*.58;
  const z=(gz+.5)*spacing+(hash(gx,gz,2)-.5)*spacing*.58;
  const radial=Math.hypot(x-p.pos.x,z-p.pos.z);if(radial<minR||radial>maxR)continue;counts.radial++;
  const h=G.map.heightAt(x,z);if(h<8||h>720)continue;counts.height++;
  if(G.map.forestAt(x,z)<.42)continue;counts.forest++;
  if(G.map.slopeAt(x,z)>.46)continue;counts.slope++;
  const pos={x,y:h,z},m=G.camera.vp;
  const cx=m[0]*x+m[4]*h+m[8]*z+m[12],cy=m[1]*x+m[5]*h+m[9]*z+m[13],cw=m[3]*x+m[7]*h+m[11]*z+m[15];
  if(cw<=.001)continue;counts.project++;
  const sx=(cx/cw*.5+.5)*viewW,sy=(1-(cy/cw*.5+.5))*viewH;
  if(sx>=-40&&sx<=viewW+40&&sy>=-70&&sy<=viewH+40)counts.screen++;
  const crownY=h+Math.max(12,(hash(gx,gz,3)<.22?14:15)*(.72+hash(gx,gz,5)*.58));const ccy=m[1]*x+m[5]*crownY+m[9]*z+m[13],ccw=m[3]*x+m[7]*crownY+m[11]*z+m[15],csy=(1-(ccy/ccw*.5+.5))*viewH;if(sx>=-40&&sx<=viewW+40&&csy>=-70&&csy<=viewH+40)counts.crownScreen++;
  for(const lift of [24,40,60]){const ty=h+lift,tcy=m[1]*x+m[5]*ty+m[9]*z+m[13],tcw=m[3]*x+m[7]*ty+m[11]*z+m[15],tsy=(1-(tcy/tcw*.5+.5))*viewH;if(sx>=-40&&sx<=viewW+40&&tsy>=-70&&tsy<=viewH+40)counts['top'+lift]++;}
 }
}
let treeDraws=[];const old=r.render;r.render=function(c,m,t,o,f){treeDraws=o.filter(x=>x.mesh===G.meshes.pineTree||x.mesh===G.meshes.autumnTree);return old.call(this,c,m,t,o,f)};
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));r.render=old;
return {counts,actualDraws:treeDraws.length,player:{x:p.pos.x,y:p.pos.y,z:p.pos.z,heading:p.yaw,forest:G.map.forestAt(p.pos.x,p.pos.z),slope:G.map.slopeAt(p.pos.x,p.pos.z)},camera:{pos:G.camera.pos,target:G.camera.target}};

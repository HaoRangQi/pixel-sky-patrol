// 实体舱框、仪表和平显共用当前飞行状态；切换视角时三层一起淡入。
const SKY_PHOSPHOR = '#b4ef91';
function skyMetalFace(color, points) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath(); ctx.fill();
}
function skyStamp(s, x, y, size = 5, color = '#ded7b9') {
  drawText(String(s), x, y, { size, color, align: 'center', mono: true });
}
function skyScrew(x, y) {
  rect(x - 1, y - 1, 4, 4, '#20212b'); rect(x - 1, y - 1, 3, 3, '#72747c');
  rect(x, y, 2, 1, '#242630'); rect(x - 1, y - 1, 1, 1, '#b3aaa0');
}
function skyPlate(x, y, w, h) {
  const cut = 3;
  skyMetalFace('#23232e', [x+cut,y, x+w-2,y, x+w,y+2, x+w,y+h, x+2,y+h, x,y+h-2, x,y+cut]);
  rect(x+2, y+2, w-4, h-5, '#42434e');
  line(x+3,y+1,x+w-3,y+1,'#696875'); line(x+1,y+3,x+1,y+h-3,'#555765');
  line(x+3,y+h-3,x+w-3,y+h-3,'#343541');
  for (const px of [x+5, x+w-7]) for (const py of [y+5, y+h-8]) skyScrew(px,py);
}
function skyBezel(x, y, r) {
  circleFill(x,y+1,r+2,'#252631'); circleFill(x,y,r+1,'#75747b');
  circleFill(x,y,r,'#20232d'); circleLine(x,y,r-1,'#4b4e59');
}
function skyDial(x,y,r,tag,fraction,value) {
  skyBezel(x,y,r);
  for (let i = 0; i <= 16; i++) {
    const a = (140 + 260*i/16) * DEG, dx = Math.cos(a), dy = Math.sin(a), outer = r-3, inner = outer - (i%4 ? 2 : 4);
    line(x+dx*inner,y+dy*inner,x+dx*outer,y+dy*outer, i===16 ? '#db9971' : i%4 ? '#939398' : '#dbd6c0');
  }
  const angle = (140 + 260*clamp01(fraction)) * DEG, dx = Math.cos(angle), dy = Math.sin(angle);
  line(x-dx*3,y-dy*3,x+dx*(r-4),y+dy*(r-4),'#e8d6a4',1.4);
  circleFill(x,y,1.8,'#c0a578'); circleFill(x,y,.75,'#46464b');
  skyStamp(tag,x,y+r*.51,Math.max(4, r*.24),'#d7d2be');
  if (value != null) {
    const bw = Math.min(34,r*1.85); rect(x-bw/2,y+r+3,bw,8,'#272831');
    skyStamp(value,x,y+r+9,6,'#f5daa4');
  }
}
function skyAttitudeBall(x,y,r,bank,pitch) {
  skyBezel(x,y,r);
  ctx.save(); ctx.beginPath(); ctx.arc(x,y,r-2,0,TAU); ctx.clip();
  ctx.translate(x,y); ctx.rotate(bank); ctx.translate(0,clamp(pitch*.95,-1,1)*r);
  rect(-r*2,-r*4,r*4,r*4,'#7094ac'); rect(-r*2,0,r*4,r*4,'#986f52');
  rect(-r*2,0,r*4,3,'#dfb782'); rect(-r*2,-1,r*4,1,'#e8ddbd');
  for (const i of [-2,-1,1,2]) { const half = Math.abs(i)===2 ? r*.3 : r*.19; line(-half,i*r*.21,half,i*r*.21,'#e9dcc0'); }
  ctx.restore();
  line(x-r*.58,y,x-r*.2,y,'#333540',3); line(x+r*.2,y,x+r*.58,y,'#333540',3);
  line(x-r*.58,y-1,x-r*.2,y-1,'#ffe2a1'); line(x+r*.2,y-1,x+r*.58,y-1,'#ffe2a1');
  line(x-3,y,x,y+3,'#f5d28e'); line(x,y+3,x+3,y,'#f5d28e');
  for (const d of [-60,-30,0,30,60]) {
    const a = (d-90)*DEG; line(x+(r-5)*Math.cos(a),y+(r-5)*Math.sin(a),x+(r-2)*Math.cos(a),y+(r-2)*Math.sin(a),'#d5d1c0');
  }
}
function skyThrottle(x,y,w,on) {
  const cx=x+w*.38, travel=35, lever=y+(on?2:31);
  rect(cx-3,y,7,travel+9,'#24252d'); rect(cx-2,y+1,2,travel+6,'#171a21');
  for(let i=0;i<5;i++) line(cx+6,y+3+i*9,cx+9+(i%2?0:2),y+3+i*9,'#a09b92');
  rect(cx-1,lever+3,3,7,'#8b8480'); rect(cx-7,lever,15,6,'#20232a');
  rect(cx-7,lever-1,14,4,on?'#c7a57b':'#aba59a'); line(cx-6,lever-1,cx+6,lever-1,'#f0dabe');
  if(w>=48) {
    for(const [i,l] of ['加力','巡航'].entries()) {
      const lit = i === (on ? 0 : 1), px = x+w*.74, py=y+6+i*18;
      rect(px-9,py-6,18,9,lit?'#524d3e':'#333640'); skyStamp(l,px,py+1,6,lit?'#fcda94':'#aaa8a0');
    }
  }
}
function skyMapGlass(x,y,w,h,p) {
  updateRadarMap();
  rect(x-3,y-3,w+6,h+6,'#22232b'); line(x-2,y+h+2,x+w+2,y+h+2,'#77716a');
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  // 共享的 56×56 北向实况地形图取中央一半，即从中心到上下边缘 1.5 公里。
  const zoom = h/1500/2, cx=x+w/2, cy=y+h/2;
  rect(x,y,w,h,'#4a301f');
  ctx.drawImage(RADAR.canvas,cx-h,cy-h,2*h,2*h);
  rect(x,y,w,h,'#b76f29',.30);
  circleLine(cx,cy,h*.25,'#efb561',.45); circleLine(cx,cy,h*.47,'#f6c17b',.46);
  line(x,cy,x+w,cy,'#f3b960',1,.35); line(cx,y,cx,y+h,'#f3b960',1,.35);
  for(let yy=y+2;yy<y+h;yy+=3) rect(x,yy,w,1,'#342621',.15);
  for(const e of G.enemies) if(!e.dead&&!targetConcealed(e)) {
    const dx=(e.pos.x-p.pos.x)*zoom, dz=(e.pos.z-p.pos.z)*zoom;
    if(Math.abs(dx)<w/2&&Math.abs(dz)<h/2) rect(cx+dx-1,cy+dz-1,3,2,'#ffe0a1');
  }
  const a=p.yaw, dx=Math.sin(a), dy=-Math.cos(a);
  line(cx,cy,cx+dx*h*.45,cy+dy*h*.45,'#ffc669');
  skyMetalFace('#fff0b3',[cx+dx*4,cy+dy*4, cx-dx*2-dy*2,cy-dy*2+dx*2, cx-dx*2+dy*2,cy-dy*2-dx*2]);
  ctx.restore();
}
function skySystemReadings(p) {
  const firing=G.mode==='play'&&(INPUT.left||INPUT.keys.has('KeyF')||INPUT.touchGun);
  const reload=p.reloads.length ? ` · ${Math.ceil(Math.max(0,Math.min(...p.reloads)))}s` : '';
  return [
    ['燃油',`${Math.ceil(Math.max(0,p.fuel))}%`,p.fuel<18?'warn':p.burning?'active':'normal'],
    ['护盾',`${Math.ceil(Math.max(0,p.shield))}%`,p.shield<22?'warn':'normal'],
    ['机炮',p.dead?'离线':firing?'连射':p.gunCd>0?'循环':'待发',p.dead?'warn':firing?'active':'normal'],
    ['导弹',`${p.missiles}/4${reload}`,p.missiles===0?'warn':reload?'active':'normal'],
    ['加力',p.burning?'接通':p.fuel<=.5?'低油':'待命',p.burning?'active':p.fuel<=.5?'warn':'normal'],
    ['干扰',`${p.flares}${p.flareCd>.1?` · ${Math.ceil(p.flareCd)}s`:''}`,p.flares===0?'warn':p.flareCd>.1?'active':'normal']
  ];
}
function skySystemRow(reading,x,y,w,size=6) {
  const [tag,value,state]=reading, ink=state==='warn'?'#ffab88':state==='active'?'#f7d293':'#d7e4c0';
  rect(x,y-5,2,2,state==='normal'?'#87977b':ink);
  drawText(tag,x+5,y,{size,color:'#c5c2b6'});
  drawText(value,x+w,y,{size,color:ink,align:'right',mono:true});
}
function skyCockpitPanel(p,bank,pitch) {
  const w=VW,h=VH,compact=w<415, toe=h-(compact?116:92), systems=skySystemReadings(p);
  const unit=typeof cssRect==='object'&&cssRect.height ? cssRect.height/h : 2;
  const short=!compact&&unit<1.2, sysFont=short?Math.ceil(10/unit):6, sysLift=short?50:0;
  // 中央遮光罩拱起，两侧压低；上缘、受光面、返边与仪表板是不同的实体轮廓。
  const lip=[[0,14],[.115,10],[.184,9],[.207,2],[.323,1],[.358,-7],[.63,-7],[.665,0],[.79,2],[.82,9],[.91,10],[1,15]];
  for(const [drop,color] of [[0,'#1f202a'],[3,'#79777c'],[5,'#555663'],[9,'#383b48'],[14,'#2d303c']]) {
    const path=[]; for(const [u,v] of lip)path.push(Math.round(w*u),toe+v+drop);
    skyMetalFace(color,[...path,w,h,0,h]);
  }
  const top=toe+17, height=h-top-3, at=f=>Math.round(w*f), knots=Math.round(p.speed*1.94384), feet=Math.round(p.pos.y*3.28084);
  const panel=(left,right,off=0)=>skyPlate(left+1,top+off,right-left-3,height-off);
  if(compact){
    const split=at(.60), instruments=height-29; panel(2,split); panel(split,w-1);
    const r=Math.min(20,w*.088), cx=split*.63, cy=top+instruments*.43;
    skyThrottle(4,top+12,split*.29,p.burning); skyAttitudeBall(cx,cy,r,bank,pitch);
    skyStamp('航向 '+pad(Math.round(compassDeg(p.yaw))%360,3),cx,top+instruments-7,7);
    const x=split+8,width=w-x-10,mh=Math.min(39,width*.84);
    skyStamp('地形 / MAP',x+width/2,top+8,6); skyMapGlass(x,top+13,width,mh,p);
    skyStamp('1.5 KM',x+width/2,top+instruments-6,5);
    const cell=w/3, sy=top+height-25;
    line(5,sy-3,w-5,sy-3,'#858075',1,.65);
    for(let i=0;i<systems.length;i++) {
      const col=i%3,row=Math.floor(i/3);
      skySystemRow(systems[i],col*cell+5,sy+7+row*12,cell-11,5.5);
      if(col) line(col*cell,sy,col*cell,sy+22,'#69686b',1,.55);
    }
    return;
  }
  // 仪表随可用宽度重新分组，圆表只按半径缩放，不拉伸为椭圆。
  const t=at(.13), f=at(.49), m=at(.68), s=at(.85), cy=top+height*.38;
  panel(2,t,5); panel(t,f); panel(f,m,-2); panel(m,s); panel(s,w-1,5-sysLift);
  skyStamp('油门',t*.5,top+18,7); skyThrottle(4,top+24,t-8,p.burning);
  const fw=f-t, r=Math.min(21,fw*.117), ax=t+fw*.205, bx=t+fw*.50, hx=t+fw*.804;
  const dialMax = Math.max(450, Math.round((p.burnSpeed ?? 0) * 1.94384));
  skyDial(ax,cy,r,dialMax > 450 ? `KT/${dialMax}` : 'KT',p.speed*1.94384/dialMax,pad(knots,3)); skyAttitudeBall(bx,cy,r+2,bank,pitch);
  skyDial(hx,cy,r,'FT',(feet%10000)/10000,pad(feet,5));
  skyStamp('空速',ax,top+height-5,6); skyStamp('海拔',hx,top+height-5,6);
  rect(bx-20,top+height-17,40,12,'#292b34'); skyStamp('HDG '+pad(Math.round(compassDeg(p.yaw))%360,3),bx,top+height-8,7,'#ffdfa0');
  const sw=Math.min(m-f-23,74),sh=Math.min(height-27,46),mx=(m+f)/2;
  skyStamp('地形 / MAP',mx,top+8,6); skyMapGlass(mx-sw/2,top+13,sw,sh,p); skyStamp('N ↑   1.5 KM',mx,top+height-6,5);
  const sw2=s-m, er=Math.min(14,sw2*.164);
  skyDial(m+sw2*.29,cy,er,'G',(p.gLoad-1)/8,p.gLoad.toFixed(1));
  const climb = p.speed*Math.sin(p.pitch); skyDial(m+sw2*.71,cy,er,'M/S',(climb+120)/240,Math.round(climb));
  const barX=m+9, bw=sw2-20; rect(barX,top+height-14,bw,6,'#242630');
  for(let i=0;i<14;i++)rect(barX+i*bw/14+1,top+height-13,bw/14-2,4,i<Math.ceil(p.fuel*.14)?'#babd87':'#59595c');
  const lx=s+8, rw=w-s-16;
  skyStamp('机载监控 / SYS',s+(w-s)*.5,top+12-sysLift,short?9:6);
  for(let i=0;i<systems.length;i++) skySystemRow(systems[i],lx,top+23-sysLift+i*(short?sysFont+2:9),rw,sysFont);
}
function skyCanopyPost() {
  const w=VW,h=VH,foot=Math.min(w*.12,56), edge=Math.min(w*.043,23), knee=h*.47;
  skyMetalFace('#22232f',[-9,18, 2,25, edge+3,knee, foot+8,h-74, foot-7,h-71, edge-9,knee+3,-10,51]);
  skyMetalFace('#585b68',[-5,20, 0,26, edge,knee-2,edge-6,knee+1,-6,48]);
  skyMetalFace('#474b59',[edge-6,knee+3,edge+1,knee+1,foot+5,h-74,foot-2,h-74]);
  line(edge+1,knee-2,1,27,'#8b8787'); line(edge+2,knee+4,foot+5,h-74,'#767781');
  skyMetalFace('#353844',[edge-8,knee-4,edge+2,knee-7,edge+5,knee+9,edge-4,knee+12]);
  skyScrew(edge-2,knee); skyScrew(lerp(edge,foot,.58),lerp(knee,h-74,.58));
}
function skyGlass(p,bank,pitch) {
  const cx=VW*.5, cy=VH*.5, span=Math.min(115,VW*.35), green=SKY_PHOSPHOR, rim='#4b6246';
  ctx.save(); ctx.beginPath(); ctx.rect(cx-span,34,span*2,VH-140); ctx.clip();
  ctx.translate(cx,cy); ctx.rotate(bank);
  const focal=VH/(2*G.camera.tanHalf);
  for(let deg=-80;deg<=80;deg+=5){
    const delta=pitch-deg*DEG; if(Math.abs(delta)>.65) continue;
    const y=Math.tan(delta)*focal, major=deg%10===0, len=deg===0?48:major?29:16, gap=deg===0?13:major?12:10;
    for(const side of [-1,1]){
      const a=side*gap,b=side*len;
      line(a,y,b,y,rim,2,.65); line(a,y,b,y,green,1,.90);
      if(major&&deg){ line(b,y,b,y+(deg>0?2:-2),green); if(side===1) skyStamp(Math.abs(deg),b+6,y+2,5,green); }
    }
  }
  ctx.restore();
  circleLine(cx,cy,2.5,green); line(cx-9,cy,cx-3,cy,green); line(cx+3,cy,cx+9,cy,green); line(cx,cy-5,cx,cy-3,green);
  const dist=Math.min(115,VW*.29);
  const ralt=Math.round(Math.max(0,p.pos.y-Math.max(p.groundH,0))*3.28084);
  for(const [side,num,unit] of [[-1,Math.round(p.speed*1.94384),'KT'],[1,Math.round(p.pos.y*3.28084),'FT']]){
    const x=cx+side*dist, sw=String(num).length*4.8+8;
    rect(x-sw/2,cy-23,sw,11,'#2e3e34',.28); rectLine(x-sw/2,cy-23,sw,11,green,.88);
    skyStamp(num,x,cy-15,7,green); skyStamp(unit,x,cy-6,5,green);
  }
  skyStamp('G '+p.gLoad.toFixed(1),cx-dist,cy+27,6,green); skyStamp('RA '+ralt,cx+dist,cy+27,6,green);
}
drawCockpit = function (alpha) {
  const p=G.player; if(!p || alpha<=.01) return;
  const b=p.renderBasis, bank=Math.atan2(b.right.y,b.up.y), pitch=Math.asin(clamp(b.fwd.y,-1,1));
  ctx.save(); ctx.globalAlpha*=alpha;
  skyGlass(p,bank,pitch);
  skyCanopyPost(); ctx.save(); ctx.translate(VW,0); ctx.scale(-1,1); skyCanopyPost(); ctx.restore();
  skyCockpitPanel(p,bank,pitch);
  ctx.restore();
};

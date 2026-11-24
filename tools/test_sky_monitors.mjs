// 实际座舱绘制输出必须包含实时系统读数；不引入产品测试接口。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../sky-patrol/54_cockpit.js', import.meta.url), 'utf8');
function cockpit(width,cssHeight=680) {
  const text = [], keys = new Set();
  const player = { pos:{x:0,y:620,z:0}, speed:138, yaw:0, gLoad:1, groundH:-50,
    fuel:100, shield:100, missiles:4, reloads:[], gunCd:0, flares:3, flareCd:0, burning:false };
  const context = vm.createContext({ VW:width, VH:340, cssRect:{height:cssHeight}, DEG:Math.PI/180, TAU:Math.PI*2,
    G:{player,enemies:[],mode:'play',lock:{phase:'search'}}, INPUT:{keys,left:false,touchGun:false},
    RADAR:{canvas:{}}, ctx:new Proxy({globalAlpha:1}, {get:(o,k)=>k in o?o[k]:()=>{}}),
    drawText:(s,x,y,options)=>text.push({text:String(s),x,y,size:options.size}),
    textWidth:(value,size)=>String(value).length*size*.6,
    rect(){},line(){},circleFill(){},circleLine(){},rectLine(){},updateRadarMap(){},targetConcealed:()=>false,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),clamp01:v=>Math.max(0,Math.min(1,v)),lerp:(a,b,t)=>a+(b-a)*t,
    compassDeg:yaw=>(yaw*180/Math.PI+360)%360,pad:(value,count)=>String(value).padStart(count,'0') });
  new vm.Script(source).runInContext(context);
  const draw = () => {text.length=0;vm.runInContext('skyCockpitPanel(G.player,0,0)',context);return text.map(t=>t.text);};
  return {player,keys,text,draw};
}

for (const width of [604,185,990]) test(`座舱${width}逻辑像素宽保留六类可见监控`,()=>{
  const c=cockpit(width), labels=c.draw();
  for(const tag of ['燃油','护盾','机炮','导弹','加力','干扰']) assert(labels.includes(tag),`实际绘制缺少${tag}`);
  for(const value of ['100%','待发','4/4','待命','3']) assert(labels.includes(value),`实际绘制缺少${value}`);
  for(const item of c.text) assert(item.x>=0&&item.x<=width&&item.y>=0&&item.y<=340,`读数越界：${JSON.stringify(item)}`);
});

test('手机横屏的系统数字不能缩成不足9个CSS像素的小字',()=>{
  const c=cockpit(990,276);c.draw();
  const readings=c.text.filter(item=>item.text.endsWith('%'));
  assert.equal(readings.length,2);
  for(const item of readings)assert(item.size*276/340>=9,`实际字号仅${item.size*276/340}px`);
  for(const item of c.text)assert(item.y<=340,`横屏读数越界：${JSON.stringify(item)}`);
});

test('系统显示随现有燃油、盾量、连射、装填与干扰状态变化，不虚构机炮备弹',()=>{
  const c=cockpit(604);
  Object.assign(c.player,{fuel:62.4,shield:73.2,gunCd:.03,missiles:3,reloads:[11.8],flares:2,flareCd:6.3,burning:true});
  c.keys.add('KeyF');
  let labels=c.draw();
  for(const value of ['63%','74%','连射','3/4 · 12s','接通','2 · 7s']) assert(labels.includes(value),`状态改变后未绘制${value}`);
  c.keys.clear();labels=c.draw();assert(labels.includes('循环'));
  c.player.gunCd=0;labels=c.draw();assert(labels.includes('待发'));
  assert(!labels.some(value=>/备弹|过热|无限|999/.test(value)),'不得虚构机炮弹量或热量机制');
});

test('实际有限机炮库存与补给倒计时在座舱可读',()=>{
  const c=cockpit(604);
  Object.assign(c.player,{gunCapacity:180,gunAmmo:37,gunReload:0});
  assert(c.draw().includes('37/180'));
  Object.assign(c.player,{gunAmmo:0,gunReload:9.2});
  assert(c.draw().includes('补给10s'));
});

function externalMonitor() {
  const app=readFileSync(new URL('../sky-patrol/65_app.js',import.meta.url),'utf8');
  const hud=readFileSync(new URL('../sky-patrol/55_ui.js',import.meta.url),'utf8');
  const elements=new Map(),player={pos:{y:620},speed:112,fuel:68.34,shield:72.61,missiles:3,reloads:[9.2],gunCd:0,flares:2,flareCd:6,burning:false};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:id==='sky-systems',textContent:'',attributes:new Map(),inert:false,
      getAttribute(name){return this.attributes.get(name)??null;},setAttribute(name,value){this.attributes.set(name,String(value));},
      querySelector:()=>null,focus(){},getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})});
    return elements.get(id);
  };
  const context=vm.createContext({BOOT:{ready:true,error:null},G:{mode:'play',view:1,player,wave:1,waveKills:0,waveTotal:3,score:0,stats:{kills:0,veh:0},highScore:0,sound:false},
    INPUT:{keys:new Set(),left:false,touchGun:false},skyGet:element,skyApp:element('sky-app'),skyButtons:[],skyActions:[],skyAmmo:[],
    skyActive:()=>context.G.mode==='play'||context.G.mode==='waveclear',skyScenicView:()=>false,skyLastMode:'',
    skyNotice:'',skyNoticeUntil:0,inlandFlight:false,flightMode:'intercept',SKY_OCCLUSION:[],VH:340,VW:604,SPEED_CRUISE:112,
    uiCanvas:element('ui'),document:{activeElement:null,fullscreenEnabled:false},performance:{now:()=>0},setBodyClass(){},
    clamp01:v=>Math.max(0,Math.min(1,v)),pad:(v,n)=>String(v).padStart(n,'0')});
  new vm.Script(source).runInContext(context);
  new vm.Script(hud.slice(hud.indexOf('function skyWaveTitle('),hud.indexOf('function skyActiveBanner('))).runInContext(context);
  new vm.Script(app.slice(app.indexOf('const SKY_SPEED_MIN_KT'),app.indexOf('function skySetControlSetting'))+'\n'+app.slice(app.indexOf('function skyText'),app.indexOf('function skyActive'))+'\n'+app.slice(app.indexOf('function skySync() {'),app.indexOf('function skyFlightTarget'))).runInContext(context);
  return {context,player,element,sync:()=>vm.runInContext('skySync()',context)};
}

test('正式默认追尾和俯视都显示同一套监控，座舱及待命不叠加外部面板',()=>{
  const m=externalMonitor();
  for(const [view,mode,visible] of [[1,'play',true],[0,'play',true],[1,'paused',true],[2,'play',false],[1,'title',false]]){
    m.context.G.view=view;m.context.G.mode=mode;m.sync();
    assert.equal(!m.element('sky-systems').hidden,visible,`${mode}视角${view}监控可见性错误`);
  }
});

test('外部燃油和护盾资源条跟随真实小数值，并限制在0到100',()=>{
  const m=externalMonitor();m.sync();
  assert.equal(m.element('sky-system-fuel-meter').getAttribute('value'),'68.3');
  assert.equal(m.element('sky-system-shield-meter').getAttribute('value'),'72.6');
  assert.equal(m.element('sky-system-fuel-value').textContent,'69%');
  Object.assign(m.player,{fuel:-2,shield:130});m.sync();
  assert.equal(m.element('sky-system-fuel-meter').getAttribute('value'),'0');
  assert.equal(m.element('sky-system-shield-meter').getAttribute('value'),'100');
});

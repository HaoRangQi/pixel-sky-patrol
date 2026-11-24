#!/usr/bin/env node
// Focused real-render check. Uses the existing preview; owns and closes only its Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline');
const prefix = process.argv.find(arg => arg.startsWith('--prefix='))?.slice(9)
  || (baseline ? 'sky_gun_tracer_before' : 'sky_gun_muzzle');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-gun-tracers-'));
const report = { startedAt: new Date().toISOString(), baseline, frames: [], errors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws, serial = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function key(code, down) {
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code.slice(3).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(3) });
}
async function frame(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const state = await evaluate(`(() => {
    const g=__PI.G,p=g.player,c=g.camera,ui=document.getElementById('ui');
    const along = v => (v.x-p.pos.x)*p.basis.fwd.x+(v.y-p.pos.y)*p.basis.fwd.y+(v.z-p.pos.z)*p.basis.fwd.z;
    const project = v => {
      const m=c.vp,w=m[3]*v.x+m[7]*v.y+m[11]*v.z+m[15];
      return {x:(1+(m[0]*v.x+m[4]*v.y+m[8]*v.z+m[12])/w)*ui.width/2,
        y:(1-(m[1]*v.x+m[5]*v.y+m[9]*v.z+m[13])/w)*ui.height/2};
    };
    const uiScale=340/ui.height;
    const sight={x:Math.round(ui.width*uiScale/2),y:170-(p.gunSightOffset||0)};
    const basis=p.renderBasis||p.basis;
    const muzzle={x:p.pos.x+basis.fwd.x*4.9-basis.up.x*.62,
      y:p.pos.y+basis.fwd.y*4.9-basis.up.y*.62,z:p.pos.z+basis.fwd.z*4.9-basis.up.z*.62};
    return {time:g.time,view:g.view,width:innerWidth,height:innerHeight,uiWidth:ui.width,uiHeight:ui.height,sight,
      player:project(p.pos),muzzle:project(muzzle),ammo:p.gunAmmo,staticTracers:g.tracers.length,
      rearTracers:g.tracers.filter(t=>along(t.a)<-2||along(t.b)<-2).length,
      bullets:g.bullets.filter(b=>b.owner==='player').map(b=>({pos:project(b.pos),ahead:along(b.pos),
        life:b.life,falling:b.flatTime===0,trailPoints:b.trail?.length||0,
        birthGap:b.trail.length===1?Math.hypot(b.pos.x-muzzle.x,b.pos.y-muzzle.y,b.pos.z-muzzle.z):null,age:2.2-b.life,
        aimError:Math.hypot(project(b.pos).x*uiScale-sight.x,project(b.pos).y*uiScale-sight.y)})),
      paintedHeads:window.__gunPaint,
      errors:[...__PI.errors,...__PI.exceptions]};
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = `shots/${prefix}_${name}.png`;
  fs.writeFileSync(path.join(root, file), Buffer.from(shot.data, 'base64'));
  report.frames.push({ name, screenshot: file, ...state });
  assert.deepEqual(state.errors, []);
  console.log(`${name}: bullets=${state.bullets.length}, static=${state.staticTracers}, rear=${state.rearTracers}`);
  return state;
}
async function step(seconds) { await evaluate(`__PI.step(${seconds});__SKY.sync();null`); }

async function lockState() {
  return evaluate(`(() => {
    const g=__PI.G,e=window.__lockProbe,c=g.camera,m=c.vp,ui=document.getElementById('ui');
    const v={...e.pos,y:e.pos.y+1.5},w=m[3]*v.x+m[7]*v.y+m[11]*v.z+m[15],width=ui.width*340/ui.height;
    const s={x:(1+(m[0]*v.x+m[4]*v.y+m[8]*v.z+m[12])/w)*width/2,
      y:(1-(m[1]*v.x+m[5]*v.y+m[9]*v.z+m[13])/w)*170};
    const aim={x:Math.round(width/2),y:170-g.player.gunSightOffset,radius:g.player.lockRadius};
    return {phase:g.lock.phase,selected:g.lock.target===e,radius:aim.radius,
      offset:Math.hypot(s.x-aim.x,s.y-aim.y),x:s.x-aim.x,y:s.y-aim.y,active:!!g.lock.target};
  })()`);
}

try {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
  let port;
  for (let i=0;i<100;i++) {
    try { port=+fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]; } catch {}
    if (port) break;
    assert.equal(chrome.exitCode,null,'Chrome exited during startup');
    await sleep(100);
  }
  assert(port,'Chrome did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{
    const m=JSON.parse(event.data),p=pending.get(m.id);
    if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}
    else if(m.method==='Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8765/sky-patrol/?adapt=0'});
  let ready=false;
  for(let i=0;i<150;i++){
    ready=await evaluate('!!window.__PI?.ready()');
    if(ready)break;
    await sleep(100);
  }
  assert(ready,'Game did not become ready');
  await evaluate(`(() => {
    window.__gunPaint=[];
    const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,fill=proto.fillRect;
    proto.clearRect=function(...args){if(this.canvas.id==='ui')window.__gunPaint=[];return clear.apply(this,args);};
    proto.fillRect=function(x,y,w,h){
      if(this.canvas.id==='ui'&&this.fillStyle==='#fff6cf')window.__gunPaint.push({x,y,w,h,alpha:this.globalAlpha});
      return fill.call(this,x,y,w,h);
    };
  })()`);
  await evaluate("__SKY.start('intercept');__PI.freeze(true);__PI.setView('chase');null");
  await step(1.2);
  // Real enemy flight and native yaw/fire inputs: no target placement or forced lock.
  await evaluate('window.__lockProbe=__PI.G.lock.target||__PI.G.enemies[0];null');
  const aiming=new Set();
  for(let i=0;i<240;i++){
    const state=await lockState();
    if(state.selected&&state.phase==='locked')break;
    for(const [code,on] of [['KeyA',state.x < -2],['KeyD',state.x > 2],['KeyW',state.y < -2],['KeyS',state.y > 2]]){
      if(aiming.has(code)===on)continue;
      await key(code,on);on?aiming.add(code):aiming.delete(code);
    }
    await step(1/60);
  }
  for(const code of aiming)await key(code,false);
  let locked=await lockState();
  assert.equal(locked.radius,38);
  assert(locked.selected&&locked.phase==='locked',`Natural enemy must acquire inside the new circle: ${JSON.stringify(locked)}`);
  await frame('lock_inside');
  await key('KeyD',true);
  let outside;
  for(let i=0;i<100;i++){
    await step(1/60);outside=await lockState();
    if(outside.offset>47&&!outside.active)break;
  }
  await key('KeyD',false);
  assert(outside.offset>44.84&&outside.offset<74&&!outside.active,'New circle must reject a real target still inside the old 74px capture circle');
  await key('KeyE',true);await step(1/60);await key('KeyE',false);
  assert(await evaluate('__PI.G.missiles.at(-1)?.owner==="player"&&!__PI.G.missiles.at(-1).target'),'Native E beyond the narrow circle must launch unguided');
  await frame('lock_outside');
  report.lock={inside:locked,outside};
  await evaluate("__SKY.restart();__PI.freeze(true);null");await step(1.2);
  await frame('natural_rest');
  await key('KeyF',true);
  await frame('natural_birth');
  for(const [name,seconds] of [['natural_005',.05],['natural_010',.05],['natural_025',.15],['natural_080',.55]]){
    await step(seconds);await frame(name);
  }
  await key('KeyF',false);
  await step(.12);await frame('natural_release');
  await step(2.4);await frame('natural_clear');
  // Elevated fixture keeps the full >900m ballistic flight in clear air.
  await evaluate("__SKY.restart();__PI.freeze(true);__PI.G.player.pos.y+=1400;null");
  await step(1.2);
  await key('KeyF',true);
  for(const [name,seconds] of [['high_005',.05],['high_025',.2],['high_080',.55],['high_140',.6],['high_200',.6]]){
    await step(seconds);await frame(name);
  }
  await key('KeyF',false);
  await step(.25);await frame('high_release');
  await step(2.2);
  await key('KeyF',true);await step(.8);
  await key('KeyD',true);await step(.8);
  await frame('turn_080');
  await key('KeyD',false);await key('KeyF',false);
  await step(.5);await frame('turn_falling');
  for(const [name,view,width,height] of [['cockpit','cockpit',1440,900],['portrait','chase',390,844],['landscape','chase',844,390],['top','top',1440,900]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`__SKY.restart();__PI.freeze(true);__PI.setView(${JSON.stringify(view)});null`);await step(1.2);
    await key('KeyF',true);
    if(view!=='top')await frame(name+'_birth');
    if(view!=='top')for(const [suffix,seconds] of [['005',.05],['010',.05],['025',.15]]){
      await step(seconds);await frame(name+'_'+suffix);
    }
    await step(.35);await frame(name);await key('KeyF',false);
  }
  if(!baseline){
    assert(report.frames.every(f=>f.staticTracers===0),'Gunfire must not leave stationary tracer copies');
    assert(report.frames.filter(f=>f.bullets.length).every(f=>f.bullets.every(b=>b.trailPoints>0)),'Live rounds must carry their own trail');
    assert.equal(report.frames.find(f=>f.name==='natural_clear').bullets.length,0,'Released burst must clear');
    const births=report.frames.flatMap(f=>f.bullets.filter(b=>b.birthGap!==null));
    assert(births.length>0&&births.every(b=>b.birthGap<1e-6),'Every sampled newborn must originate at the real aircraft muzzle');
    report.muzzle={sampledBirths:births.length,maxBirthGap:Math.max(...births.map(b=>b.birthGap))};
    for(const name of ['natural','cockpit','portrait','landscape']){
      const atBirth=report.frames.find(f=>f.name===name+'_birth'), scale=340/atBirth.uiHeight;
      const newborn=atBirth.bullets.find(b=>b.trailPoints===1);
      assert(newborn,`${name} must capture an unadvanced newborn round`);
      assert(Math.hypot(newborn.pos.x-atBirth.muzzle.x,newborn.pos.y-atBirth.muzzle.y)*scale<.01,`${name} birth must project at the muzzle, not in midair`);
      const near=report.frames.find(f=>f.name===name+'_005'), first=near.bullets.reduce((a,b)=>a.life<b.life?a:b);
      assert(first.aimError<newborn.aimError&&first.aimError>1,'Near-field rounds must visibly travel from the muzzle towards the sight');
      assert(near.paintedHeads.length>0,`${name} near rounds must actually be painted`);
    }
    assert(report.frames.find(f=>f.name==='high_140').paintedHeads.length>0,'Forward rounds must actually paint bright heads');
    const far=report.frames.find(f=>f.name==='high_200');
    const falling=far.bullets.filter(b=>b.falling&&b.ahead>900);
    assert(falling.length>1,'Full over-range flight must be present');
    const scale=340/far.uiHeight;
    const painted=falling.filter(b=>far.paintedHeads.some(p=>p.alpha>.5&&p.w>=1&&p.h>=1&&
      Math.hypot(p.x+p.w/2-b.pos.x*scale,p.y+p.h/2-b.pos.y*scale)<1));
    assert(painted.length>=2,'Over-range rounds must actually paint visible bright heads');
    report.overRange={fallingRounds:falling.length,paintedHeads:painted.length,
      projectedFallPixels:Math.max(...falling.map(b=>b.pos.y))-Math.min(...falling.map(b=>b.pos.y))};
    assert(report.overRange.projectedFallPixels>2,'Falling segment must visibly diverge from flat flight');
  }
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
} catch(error){report.result='FAIL';report.error=error.stack;process.exitCode=1;}
finally {
  if(ws)ws.close();
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Verification finished'));}
  pending.clear();
  if(chrome&&chrome.exitCode===null&&chrome.signalCode===null){
    chrome.kill('SIGTERM');
    for(let i=0;i<30&&chrome.exitCode===null&&chrome.signalCode===null;i++)await sleep(100);
    if(chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGKILL');await new Promise(resolve=>chrome.once('exit',resolve));}
  }
  fs.rmSync(profile,{recursive:true,force:true});
  report.cleanup={chromeStopped:!chrome||chrome.exitCode!==null||chrome.signalCode!==null,profileDeleted:!fs.existsSync(profile)};
  report.finishedAt=new Date().toISOString();
  const file=path.join(root,'shots',`${prefix}_results.json`);
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(`${report.result}: ${file}`);
  if(report.error)console.error(report.error);
}

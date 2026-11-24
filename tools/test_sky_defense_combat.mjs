import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
const core = read('10_core'), world = read('20_world');
const source = [
  core.slice(core.indexOf('const TAU ='), core.indexOf('// --------------------------------------------------------------- input')),
  world.slice(world.indexOf('const WORLD_SIZE ='), world.indexOf('const WORKER_SRC =')),
  world.slice(world.indexOf('function findFlatSpot(')), read('40_game'), read('42_combat'), read('43_defense'),
].join('\n');
const dt = 1 / 60, heading = (a, b) => Math.atan2(b.x - a.x, a.z - b.z);
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function fixture({ heightAt = () => 25, speed = 112 } = {}) {
  const f = vm.runInNewContext(`${source}
    const VW = 604, VH = 340, INPUT = { mx: 302, my: 170, keys: new Set() }, TOUCH = { active: false };
    const AudioSys = { launch() {}, explosion() {}, gunshot() {}, lockTone() {}, lockTick() {}, shieldHit() {}, updateEngine() {} };
    function reseed(seed) { rng = mulberry32(seed); }
    ({ G, basisFrom, prepareWave, makePlayer, updateCamera, updateEnemies, updateGround, updateEffects,
       spawnDrone, fireDroneGuns, firePlayerGuns, updateFlight, updateMissiles, spawnPlayerMissile, spawnGunBullet, updateGunBullets,
       DEFENSE_AIRCRAFT, run: code => eval(code), reseed });`);
  f.G.map = { heightAt, cloudDensity: () => 0, slopeAt: () => 0 };
  f.G.mode = 'play';
  f.G.view = 2;
  f.G.spawn = { x: 0, z: 0, heading: -.08 };
  f.G.player = Object.assign(f.makePlayer(f.G.map), { flightComfort: true, speed, agl: 600 });
  f.G.enemySpeedScale = .65;
  f.updateCamera(dt);
  return f;
}

function enter(f, n, air) {
  const stage = { title: `第${n}关`, brief: '拦截', air };
  f.G.wave = n;
  f.prepareWave(n, stage);
  assert.equal(f.G.defenseStage, stage);
  return f.G.enemies;
}

test('标准规则给三种敌机有限的1/2/3发反制，库存不随波次时钟回复', () => {
  const f=fixture();f.run("G.defenseRules=defenseRules('standard')");
  const enemies=enter(f,3,['drone','fighter','transport']);
  assert.deepEqual(Array.from(enemies,e=>e.flares),[1,2,3]);
  assert.deepEqual(Array.from(enemies,e=>e.flareChance),[.45,.65,.75]);
  enemies[0].flares=0;advance(f,20,{planes:true,missiles:false});
  assert.equal(enemies[0].flares,0,'反制是有限资源，不是自动回血');
});

for(const chance of [0,1]) test(`${chance*100}%干扰只作一次判定，失败也消耗库存且不逐帧重抽`,()=>{
  const f=fixture();f.run("G.defenseRules=defenseRules('standard')");
  f.G.defenseRules.flares.drone={count:1,chance};
  const[e]=enter(f,1,['drone']);e.pos=targetFromNose(f,280);
  const m=launchAt(f,e);
  f.run('var windowRolls=0;rng=()=>{windowRolls++;return .5}');
  f.updateMissiles(dt);assert.equal(e.flares,0);
  f.run('windowRolls=0');
  for(let i=0;i<8&&!m.dead;i++)f.updateMissiles(dt);
  assert.equal(e.flares,0);assert.equal(f.run('windowRolls'),0,'同一枚导弹不得在失败后继续抽签');
  assert.equal(m.target===e,chance===0);
  if(chance===1)assert(m.target.defenseDecoy&&f.G.effects.includes(m.target));
});

test('同一轮诱饵能回应齐射，库存耗尽后新导弹不再被无限保护',()=>{
  const f=fixture();f.run("G.defenseRules=defenseRules('standard');G.defenseRules.flares.fighter={count:2,chance:1}");
  const[e]=enter(f,2,['fighter']);e.pos=targetFromNose(f,300);
  const a=launchAt(f,e),b=launchAt(f,e);f.updateMissiles(dt);
  assert(a.target.defenseDecoy&&b.target.defenseDecoy);assert.equal(e.flares,1,'齐射只消耗同一轮的一发库存');
  assert.equal(a.target,b.target);
  f.G.missiles.length=0;advance(f,4,{missiles:false});e.pos=targetFromNose(f,300);
  const c=launchAt(f,e);f.updateMissiles(dt);assert(c.target.defenseDecoy);assert.equal(e.flares,0);
  f.G.missiles.length=0;advance(f,4,{missiles:false});e.pos=targetFromNose(f,300);
  const d=launchAt(f,e);f.updateMissiles(dt);assert.equal(d.target,e);
});

test('标准战斗机先保留机炮窗口，再预警脱离，最后能转向反击',t=>{
  const f=fixture();f.run("G.defenseRules=defenseRules('standard')");
  const[e]=enter(f,2,['fighter']),p=f.G.player;
  Object.assign(p,{pos:{x:0,y:600,z:0},yaw:0,pitch:0,roll:0,cruiseSpeed:112,speed:112});p.basis=f.basisFrom(0,0,0);
  Object.assign(e,{pos:{x:0,y:600,z:-550},yaw:0,pitch:0,roll:0,approach:0,state:'engage',aware:999,missileCd:0});e.basis=f.basisFrom(0,0,0);
  const phases=new Set(),samples=[];let firstWarning=null,firstBreak=null,enemyShots=0,seen=new Set();
  for(let i=0;i<55*60;i++){
    p.pos.z-=p.speed*dt;f.G.time+=dt;f.updateEnemies(dt);f.updateEffects(dt);
    phases.add(e.tacticPhase);
    if(i%180===0)samples.push({t:i*dt,phase:e.tacticPhase,state:e.state,speed:e.speed,yaw:e.yaw,d:Math.hypot(e.pos.x-p.pos.x,e.pos.z-p.pos.z),dot:f.run('vdot(vnorm(vsub(G.player.pos,G.enemies[0].pos)),G.enemies[0].basis.fwd)')});
    if(e.tacticPhase==='warning'&&firstWarning===null)firstWarning=i*dt;
    if(e.tacticPhase==='break'&&firstBreak===null)firstBreak=i*dt;
    if(i<4*60)assert(Math.abs(angle(e.yaw,0))<.03,'反应和点射期间不能突兀逃开');
    for(const m of f.G.missiles)if(m.owner==='enemy'&&!seen.has(m)){seen.add(m);enemyShots++;}
    for(const b of f.G.bullets)if(b.owner==='enemy'&&!seen.has(b)){seen.add(b);enemyShots++;}
  }
  assert(firstWarning>=5.8&&firstBreak-firstWarning>=.8);
  t.diagnostic(JSON.stringify({firstWarning,firstBreak,phases:[...phases],enemyShots,player:p.pos,enemy:e.pos,yaw:e.yaw,samples}));
  assert(phases.has('break')&&phases.has('reposition'));
  assert(enemyShots>0,'脱离后要形成反击，不是只延长追逐');
});

test('标准预设的导弹压力按兵种递增：无人机1–2发、战斗机2–3发、运输机5–6发',t=>{
  const f=fixture();
  const result=JSON.parse(JSON.stringify(f.run(`(() => {
    G.defenseRules=defenseRules('standard');
    const out={};
    for(const kind of ['drone','fighter','transport']){
      const counts=[];
      for(let seed=1;seed<=80;seed++){
        G.enemies.length=0;G.missiles.length=0;G.effects.length=0;
        G.defenseStage={air:[kind]};G.waveTotal=1;G.waveSpawned=0;
        reseed(seed*97+17);
        const e=spawnDrone(),p=G.player;
        Object.assign(p,{pos:{x:0,y:620,z:0},yaw:0,pitch:0,roll:0});p.basis=p.renderBasis=basisFrom(0,0,0);updateCamera(1/60);
        Object.assign(e,{pos:{x:0,y:620,z:-530},yaw:0,pitch:0,roll:0,state:'patrol',aware:0,approach:99,missileCd:999,gunCd:999});
        e.basis=basisFrom(e.yaw,0,0);
        let shots=0;
        while(!e.dead&&shots<8){
          e.flareCd=0; // 代表前一枚导弹四秒后再次进入，冷却在真实航次中由 updateEnemies 推进。
          G.lock={target:e,phase:'locked',progress:1};
          spawnPlayerMissile();shots++;
          for(let i=0;i<600&&!e.dead&&G.missiles.some(m=>!m.dead);i++){G.time+=1/60;updateMissiles(1/60);updateEffects(1/60);}
          G.missiles.length=0;
          // 玩家下一枚导弹至少四秒后到；也避免把快速连射误算成新一轮齐射。
          for(let i=0;i<280;i++){G.time+=1/60;updateEffects(1/60);}
        }
        counts.push(shots);
      }
      counts.sort((a,b)=>a-b);
      out[kind]={p50:counts[40],p90:counts[72],max:counts.at(-1)};
    }
    return out;
  })()`)));
  t.diagnostic(JSON.stringify(result));
  assert.deepEqual(result.drone,{p50:1,p90:2,max:2});
  assert(result.fighter.p50>=2&&result.fighter.p90<=3&&result.fighter.max===3);
  assert(result.transport.p50>=5&&result.transport.max<=6);
});

function advance(f, seconds, { planes = true, ground = true, missiles = true } = {}) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    f.G.time += dt;
    if (missiles) f.updateMissiles(dt);
    if (planes) f.updateEnemies(dt);
    if (ground) f.updateGround(dt);
    f.updateEffects(dt);
  }
}

test('序列队列只从前方和侧前方接近，补充槽位按关卡类型，原波次仍使用旧预设', () => {
  const f = fixture();
  const roster = ['transport', 'fighter', 'drone', 'fighter', 'drone', 'fighter'];
  const first = enter(f, 3, roster);
  assert.deepEqual(Array.from(first, e => e.kind), roster.slice(0, 4));
  assert.equal(f.G.waveTotal, roster.length);
  assert.equal(f.G.ground.length, 0);
  assert(!f.G.secondary || f.G.secondary.type === 'shield');
  for (const e of first) {
    assert(Math.abs(angle(heading(f.G.player.pos, e.pos), f.G.player.yaw)) < .85);
    const expected = e.kind === 'transport' ? heading(e.pos, f.G.player.pos) : f.G.player.yaw;
    assert(Math.abs(angle(e.yaw, expected)) < .2, '作战飞机以同向航线进入，运输机继续原投放航线');
    assert.equal(e.hp, e.maxHp);
  }
  assert.deepEqual([f.spawnDrone().kind, f.spawnDrone().kind, f.spawnDrone()], ['drone', 'fighter', null]);
  f.prepareWave(1);
  assert.equal(f.G.defenseStage, null);
  assert.equal(f.G.waveTotal, 4);
  assert(f.G.enemies.every(e => e.kind === 'drone'));
});

test('战斗机比无人机更快、更耐打、转向更快且火力更强', () => {
  const droneSim = fixture(), fighterSim = fixture();
  const [drone] = enter(droneSim, 1, ['drone']);
  const [fighter] = enter(fighterSim, 2, ['fighter']);
  assert(fighter.speed > drone.speed * 1.18);
  assert(fighter.maxHp > drone.maxHp);
  for (const [sim, e] of [[droneSim, drone], [fighterSim, fighter]]) {
    advance(sim, 2.4);
    e.pos = { x: 0, y: 625, z: -1000 };
    e.yaw = Math.PI / 2;
    e.basis = sim.basisFrom(e.yaw, 0, 0);
    e.state = 'engage'; e.aware = 4.2;
    sim.updateEnemies(dt);
    sim.fireDroneGuns(e, sim.G.player, 400);
  }
  assert(Math.abs(angle(fighter.yaw, Math.PI / 2)) > Math.abs(angle(drone.yaw, Math.PI / 2)) * 1.05);
  const damage = sim => sim.G.bullets.reduce((sum, b) => sum + b.damage, 0);
  assert(damage(fighterSim) > damage(droneSim) * 1.3);
});

for (const knots of [100, 500, 1500]) for (const kind of ['drone', 'fighter']) {
  test(`${kind}在${knots}节下进入566米机炮范围后保持连续射击机会`, () => {
    const f = fixture({ speed: knots / 1.94384 }), p = f.G.player;
    Object.assign(p, { pos: { x: 0, y: 600, z: 0 }, yaw: 0, pitch: 0, roll: 0,
      cruiseSpeed: knots / 1.94384, burnSpeed: knots / 1.94384, turnRateLimit: (knots === 100 ? 30 : Math.min(120, knots / 10)) * Math.PI / 180,
      speedResponse: 1.6, mouseSteering: false, invuln: 999 });
    p.basis = p.renderBasis = f.basisFrom(0, 0, 0);
    const [e] = enter(f, kind === 'fighter' ? 2 : 1, [kind]);
    Object.assign(e, { pos: { x: 0, y: 600, z: -566 }, yaw: 0, pitch: 0, roll: 0,
      approach: 0, state: 'engage', aware: 4.2, energy: 100, gunCd: 999, missileCd: 999 });
    e.basis = f.basisFrom(0, 0, 0);
    f.firePlayerGuns();
    const bulletSpeed = Math.hypot(...Object.values(f.G.bullets[0].vel));
    f.G.bullets.length = 0; p.gunCd = 0;
    let available = 0, hit = false;
    for (let i = 0; i < 4 * 60 && !e.dead; i++) {
      const bearing = angle(heading(p.pos, e.pos), p.yaw);
      const distance = Math.hypot(e.pos.x-p.pos.x, e.pos.y-p.pos.y, e.pos.z-p.pos.z);
      const travel = distance / Math.max(60, bulletSpeed-e.speed);
      const aim = { x: e.pos.x+e.basis.fwd.x*e.speed*travel, y: e.pos.y+e.basis.fwd.y*e.speed*travel+19*travel*travel,
        z: e.pos.z+e.basis.fwd.z*e.speed*travel };
      const dy = Math.atan2(aim.y-p.pos.y, Math.hypot(aim.x-p.pos.x,aim.z-p.pos.z))-p.pitch;
      if (distance > 80 && distance < 900 && Math.abs(bearing) < .12 && Math.abs(dy) < .12) available += dt;
      // 前两秒只瞄准，留出人类辨认目标并按下开火键的时间。
      f.G.testInput = { sx: i < 18 ? 0 : Math.max(-1,Math.min(1,angle(heading(p.pos,aim),p.yaw)*2)), sy: Math.max(-1,Math.min(1,dy*6)) };
      f.updateFlight(dt);
      if (i >= 120) f.firePlayerGuns();
      f.updateEnemies(dt); f.updateGunBullets(dt); f.G.time += dt;
      if (e.hp < e.maxHp) hit = true;
    }
    assert(available >= 2, `反应后应仍有机炮窗口，实际仅${available.toFixed(2)}秒`);
    assert(hit, '等待两秒后使用真实机炮与弹道应能命中同一架敌机');
  });
}

test('敌机速度与转弯半径锁定到玩家当前巡航和转向参数', () => {
  const playerSettings = [
    { cruise: 100 / 1.94384, turn: 22 },
    { cruise: 112, turn: 22 },
    { cruise: 500 / 1.94384, turn: 22 },
    { cruise: 112, turn: 60 },
  ];
  for (const { cruise, turn } of playerSettings) {
    const playerRadius = cruise / (turn * Math.PI / 180);
    for (const kind of ['drone', 'fighter']) {
      const f = fixture();
      Object.assign(f.G.player, { cruiseSpeed: cruise, speed: cruise, targetSpeed: cruise, turnRateLimit: turn * Math.PI / 180 });
      const [e] = enter(f, kind === 'fighter' ? 2 : 1, [kind]);
      assert(e.speed < cruise * .7, `${kind} 出生巡航速度须明显低于玩家 ${cruise.toFixed(0)} m/s，实际 ${e.speed.toFixed(1)}`);
    Object.assign(e, {
        approach: 0, pos: { x: 1000, y: 625, z: 0 }, yaw: 0, pitch: 0, roll: 0,
        state: 'engage', aware: 4.2, energy: 100,
      });
      e.basis = f.basisFrom(0, 0, 0);
      const before = e.yaw;
      f.updateEnemies(dt);
      const rate = Math.abs(angle(e.yaw, before)) / dt;
      assert(rate > 0, `${kind} 未实际转向`);
      assert(e.speed / rate > playerRadius * 1.35,
        `${kind} 在玩家 ${cruise.toFixed(0)} m/s、${turn}°/秒时的转弯半径 ${(e.speed / rate).toFixed(0)} 米须大于玩家 ${playerRadius.toFixed(0)} 米`);
    }
  }

  // 即使把敌机速度滑块拉到 120%，交战机也不会快过玩家巡航。
  const f = fixture();
  f.G.enemySpeedScale = 1.2;
  const [fighter] = enter(f, 2, ['fighter']);
  Object.assign(fighter, { approach: 0, state: 'engage', aware: 4.2, energy: 100 });
  for (let i = 0; i < 240; i++) f.updateEnemies(dt);
  assert(fighter.speed <= 112 * .95 + 1e-6, `120% 敌机速度下同向脱离仍需低于玩家空速，实际 ${fighter.speed.toFixed(1)}`);
  assert(Number.isFinite(fighter.turnRadius));
  assert(fighter.turnRadius > 112 / (22 * Math.PI / 180) * 1.35, '120% 敌机速度下转弯半径仍须大于玩家');
});

function targetFromNose(f, range) {
  const p = f.G.player;
  return { x: p.pos.x + p.basis.fwd.x * range, y: p.pos.y, z: p.pos.z + p.basis.fwd.z * range };
}

function launchAt(f, target) {
  f.G.lock = { target, phase: 'locked', progress: 1 };
  f.spawnPlayerMissile();
  const missile = f.G.missiles.at(-1);
  assert.equal(missile.target, target);
  return missile;
}

for (const speed of [112, 1500 / 1.94384]) {
  test(`运输机诱饵消耗两次并真正引走 ${Math.round(speed * 1.94384)} 节载机的导弹`, () => {
    const f = fixture({ speed });
    const [e] = enter(f, 3, ['transport']);
    e.pos = targetFromNose(f, 530);
    const p = f.G.player;
    assert.equal(e.flares, 2);
    const position = { ...p.pos }, facing = p.basis;
    for (let shot = 0; shot < 2; shot++) {
      Object.assign(p.pos, position); p.basis = facing; f.updateCamera(dt);
      e.pos = targetFromNose(f, 530);
      const m = launchAt(f, e);
      for (let i = 0; i < 20 && m.target === e; i++) f.updateMissiles(dt);
      assert.equal(m.target.type, 'flare');
      assert(f.G.effects.includes(m.target));
      assert.equal(e.flares, 1 - shot);
      assert(e.flareFlash > 0);
      const lure = m.target;
      for (let i = 0; i < 100 && !m.dead; i++) { f.updateMissiles(dt); f.updateEffects(dt); }
      assert(m.dead && Math.hypot(m.pos.x - lure.pos.x, m.pos.y - lure.pos.y, m.pos.z - lure.pos.z) < 26,
        '弹体确实飞向并在光点处爆炸');
      assert.equal(e.hp, 390, '诱饵爆炸与运输机的耐久隔开');
      if (shot === 0) {
        const second = launchAt(f, e);
        for (let i = 0; i < 6; i++) f.updateMissiles(dt);
        assert.equal(second.target, e, '冷却中不消费第二次诱饵');
        f.G.missiles.length = 0;
      }
      advance(f, 4, { missiles: false });
    }
    assert.equal(e.flares, 0);
    assert.equal(e.flareFlash, 0);
  });
}

test('运输机耗完干扰后实际吃三枚导弹，机炮也可绕过干扰打到机身', () => {
  const f = fixture();
  const [e] = enter(f, 3, ['transport']);
  e.pos = targetFromNose(f, 620);
  e.flares = 0;
  for (const hp of [260, 130, 0]) {
    launchAt(f, e);
    advance(f, 2, { planes: false });
    assert.equal(e.hp, hp);
  }
  assert(e.dead && f.G.waveKills === 1);

  const fresh = enter(f, 3, ['transport'])[0];
  fresh.pos = targetFromNose(f, 200);
  const p = f.G.player;
  f.spawnGunBullet({ ...p.pos, y: p.pos.y + 3 },
    { x: p.basis.fwd.x * 720, y: 0, z: p.basis.fwd.z * 720 }, 'player', 12);
  for (let i = 0; i < 30; i++) f.updateGunBullets(dt);
  assert.equal(fresh.hp, 378);
  assert.equal(fresh.flares, 2);
});

test('运输机从实际机腹空投两车，车辆落到干地后能巡逻、发炮和独立计分', () => {
  const heightAt = (x, z) => x > 112 && z > -2400 && z < 2800 ? 42 : -18;
  const f = fixture({ heightAt });
  const [e] = enter(f, 3, ['transport']);
  for (let i = 0; i < 4200 && !f.G.ground.length; i++) advance(f, dt);
  assert.equal(f.G.ground.length, 1);
  const g = f.G.ground[0];
  assert.equal(g.kind, 'vehicle');
  assert.equal(g.type, 'vehicle');
  assert(g.airdrop && Math.hypot(e.pos.x - g.pos.x, e.pos.z - g.pos.z) < 16 && e.pos.y - g.pos.y < 18,
    '首帧车从实际运输机下方出现');
  assert.equal(e.cargoRemaining, 1);
  g.fireCd = 0;
  const y = g.pos.y;
  advance(f, .5);
  assert(g.airdrop && g.pos.y < y);
  assert(!f.G.bullets.some(b => b.source === g));
  for (let i = 0; i < 2100 && (g.airdrop || e.cargoRemaining); i++) advance(f, dt);
  assert.equal(g.airdrop, null);
  assert.equal(f.G.ground.length, 2);
  assert.equal(e.cargoRemaining, 0);
  assert.equal(g.pos.y, heightAt(g.pos.x, g.pos.z));
  const old = { ...g.pos };
  f.G.player.pos = { x: g.pos.x + 140, y: g.pos.y + 125, z: g.pos.z + 250 };
  g.fireCd = 0;
  advance(f, 4);
  assert(Math.hypot(g.pos.x - old.x, g.pos.z - old.z) > 8);
  assert(f.G.bullets.some(b => b.source === g && b.owner === 'enemy'), '着陆后会瞄准和发射实体弹');
  f.spawnGunBullet({ x: g.pos.x, y: g.pos.y + 12, z: g.pos.z }, { x: 0, y: -90, z: 0 }, 'player', 120);
  for (let i = 0; i < 8; i++) f.updateGunBullets(dt);
  assert(g.dead && f.G.stats.veh === 1 && f.G.waveKills === 0);
});

test('无法找到干地时不会空投，摧毁载机会阻止未投载荷', () => {
  const water = fixture({ heightAt: () => -28 });
  const [e] = enter(water, 3, ['transport']);
  advance(water, 30);
  assert.equal(e.cargoRemaining, 2);
  assert.equal(water.G.ground.length, 0);

  const f = fixture();
  const [transport] = enter(f, 3, ['transport']);
  transport.flares = 0;
  transport.pos = targetFromNose(f, 410);
  for (let i = 0; i < 3; i++) {
    launchAt(f, transport);
    advance(f, 1.2, { planes: false });
  }
  assert(transport.dead);
  advance(f, 40);
  assert.equal(f.G.ground.length, 0);
});

test('落地装甲留出转场间隔，远距散布更大，近距平飞仍可能中弹', () => {
  const f = fixture();
  enter(f, 3, ['transport']);
  for (let i = 0; i < 2100 && !f.G.ground[0]?.airdrop; i++) advance(f, dt);
  const [g] = f.G.ground;
  for (let i = 0; i < 1050 && g.airdrop; i++) advance(f, dt);
  assert.equal(g.airdrop, null);
  f.G.ground = [g];
  const origin = { ...g.pos }, p = f.G.player;

  function reset(range, altitude) {
    Object.assign(g, { pos: { ...origin }, yaw: 0, patrolYaw: 0, fireCd: 0 });
    p.pos = { x: origin.x, y: origin.y + altitude, z: origin.z - range };
    p.basis = f.basisFrom(0, 0, 0);
    f.G.bullets.length = 0;
    f.reseed(13791);
  }

  const scatterAt = range => {
    reset(range, 100);
    f.updateGround(dt);
    const [bullet] = f.G.bullets;
    assert(bullet?.source === g);
    return Math.abs(bullet.vel.x * (range + p.speed * Math.hypot(range, 100) / 590) / bullet.vel.z);
  };
  const closeScatter = scatterAt(180), farScatter = scatterAt(690);
  assert(closeScatter > .5 && farScatter > closeScatter * 2, `炮弹横向散布应随距离增加，实测 ${closeScatter}、${farScatter} 米`);

  reset(220, 100);
  let lastRound = null;
  const firedAt = [];
  for (let i = 0; i < 480; i++) {
    f.updateGround(dt);
    const bullet = f.G.bullets.at(-1);
    if (bullet && bullet !== lastRound) { firedAt.push(i * dt); lastRound = bullet; }
  }
  assert(firedAt.length >= 3);
  for (let i = 1; i < firedAt.length; i++) {
    const interval = firedAt[i] - firedAt[i - 1];
    assert(interval >= 2.3 && interval <= 2.6, `点射间隔 ${interval.toFixed(2)} 秒`);
  }

  reset(115, 70);
  const shield = p.shield;
  for (let i = 0; i < 60; i++) {
    p.pos.z -= p.speed * dt;
    f.updateGround(dt);
    f.updateGunBullets(dt);
  }
  assert.equal(p.shield, shield - 5.5, '保持当前航向通过近处仍会被真实弹体命中');
});

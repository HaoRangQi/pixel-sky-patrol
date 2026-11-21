if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('chase');
__PI.freeze(true);
const G = __PI.G, p = G.player;
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
const copy = v => ({ x: v.x, y: v.y, z: v.z });
const speed = v => Math.hypot(v.x, v.y, v.z);
const normalize = v => { const n = speed(v); return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const failures = [], scenarios = [];
for (const maneuver of [false, true]) {
  G.enemies = []; G.ground = []; G.missiles = []; G.bullets = []; G.effects = [];
  G.spawnTimer = 999; G.mode = 'play'; G.waveTotal = 4;
  p.pos = { x: 0, y: 1800, z: 0 };
  p.yaw = 0; p.pitch = 0; p.roll = 0; p.speed = 112; p.invuln = 10;
  p.missiles = 4; p.dead = false; p.rollT = 0;
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  __PI.step(1 / 60);
  key('KeyE', true); key('KeyE', false);
  const m = G.missiles.find(missile => missile.owner === 'player');
  if (!m) throw new Error('E 未生成玩家导弹');
  if (m.target) failures.push('无锁发射意外绑定了目标');
  const origin = copy(m.pos), launchVelocity = copy(m.vel), samples = [];
  for (let frame = 1; frame <= 180; frame++) {
    if (maneuver && frame === 16) key('KeyW', true);
    if (maneuver && frame === 76) key('KeyW', false);
    __PI.step(1 / 60);
    if (frame === 15 || frame % 60 === 0) samples.push({ age: m.age, pos: copy(m.pos), vel: copy(m.vel), dead: m.dead });
  }
  key('KeyW', false);
  scenarios.push({ maneuver, origin, launchVelocity, final: samples.at(-1), samples });
  if (-launchVelocity.z / speed(launchVelocity) < 0.995) failures.push('水平发射不沿机头离架');
  const early = samples[0].pos;
  if (origin.z - early.z < 75 || Math.abs(early.y - origin.y) > 8) failures.push('发射后未向前平缓展开');
  if (m.dead || origin.z - m.pos.z < 1100 || origin.y - m.pos.y < 120 || m.vel.y >= 0) failures.push('三秒前向弧线未出现持续下坠');
}
const still = scenarios[0], maneuvered = scenarios[1];
const launcherInfluence = Math.max(...still.samples.map((s, i) => Math.hypot(
  (s.pos.x - still.origin.x) - (maneuvered.samples[i].pos.x - maneuvered.origin.x),
  (s.pos.y - still.origin.y) - (maneuvered.samples[i].pos.y - maneuvered.origin.y),
  (s.pos.z - still.origin.z) - (maneuvered.samples[i].pos.z - maneuvered.origin.z),
)));
if (launcherInfluence > 1e-3) failures.push(`无锁导弹受发射后载机操纵影响：${launcherInfluence.toFixed(4)}米`);
G.enemies = []; G.ground = []; G.missiles = []; G.effects = [];
G.spawnTimer = 999; G.mode = 'play'; G.waveTotal = 4; G.waveKills = 0;
p.pos = { x: 0, y: Math.max(600, G.map.heightAt(0, 0) + 600), z: 0 };
p.yaw = 0; p.pitch = 0; p.roll = 0; p.speed = 112; p.invuln = 10;
p.missiles = 4; p.dead = false; p.rollT = 0;
G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
__PI.step(1 / 60);
key('KeyE', true); key('KeyE', false);
const groundImpact = G.missiles.find(missile => missile.owner === 'player');
if (!groundImpact) throw new Error('无锁撞地场景中 E 未生成玩家导弹');
for (let frame = 0; frame < 840 && G.missiles.includes(groundImpact); frame++) __PI.step(1 / 60);
if (G.missiles.includes(groundImpact) || groundImpact.age >= 14) failures.push(`无锁导弹没有在寿命结束前撞地：age=${groundImpact.age}, dead=${groundImpact.dead}`);

const guided = [];
for (const targetSpeed of [0, 70, 110]) {
  G.enemies = []; G.ground = []; G.missiles = []; G.effects = [];
  G.spawnTimer = 999; G.mode = 'play'; G.waveTotal = 4;
  p.pos = { x: 0, y: 1800, z: 0 };
  p.yaw = 0; p.pitch = 0; p.roll = 0; p.invuln = 100; p.missiles = 4;
  __PI.step(1 / 60);
  const target = { pos: { x: 250, y: 1800, z: -650 }, dead: false, isGround: false };
  G.lock = { phase: 'locked', target };
  key('KeyE', true); key('KeyE', false);
  const m = G.missiles.find(missile => missile.owner === 'player');
  if (!m || m.target !== target) throw new Error('锁定发射未保留目标');
  let minDistance = Infinity, maxTurn = 0;
  for (let frame = 0; frame < 390 && !m.dead; frame++) {
    const previousDirection = normalize(m.vel);
    target.pos.x += targetSpeed / 60;
    __PI.step(1 / 60);
    minDistance = Math.min(minDistance, Math.hypot(m.pos.x - target.pos.x, m.pos.y - target.pos.y - 0.8, m.pos.z - target.pos.z));
    maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, dot(previousDirection, normalize(m.vel))))));
    if (![m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z].every(Number.isFinite)) failures.push('锁定追踪产生非有限坐标');
  }
  guided.push({ targetSpeed, minDistance, age: m.age, maxTurnDegrees: maxTurn * 180 / Math.PI, detonated: m.dead });
  if (!m.dead || minDistance >= m.hitRadius + 4) failures.push(`锁定导弹未命中可拦截目标：${JSON.stringify(guided.at(-1))}`);
  const gravityTurn = m.gravity / Math.max(speed(m.vel), 1) / 60;
  if (maxTurn > m.turnRate / 60 + gravityTurn + 1e-6) failures.push('导弹转向超过制导与重力共同产生的每帧角度上限');
}
if (__PI.errors.length || __PI.exceptions.length) failures.push(JSON.stringify({ errors: __PI.errors, exceptions: __PI.exceptions }));
if (failures.length) throw new Error(`${failures.join('；')}；samples=${JSON.stringify({ scenarios, guided })}`);
return { result: 'PASS', scenarios, guided };

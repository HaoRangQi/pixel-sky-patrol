if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('cockpit');
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
__PI.freeze(true);
await frame();
const G = __PI.G, p = G.player, e = G.enemies[0];
G.enemies = [e];
G.ground = [];
G.spawnTimer = 99;
e.leaving = true;
e.yaw = p.yaw; e.pitch = p.pitch; e.roll = p.roll; e.basis = p.basis;
const place = (dist, side = 0) => {
  const f = p.basis.fwd, r = p.basis.right;
  e.pos = {
    x: p.pos.x + f.x * dist + r.x * side,
    y: p.pos.y + f.y * dist + r.y * side - (side ? 0 : 10),
    z: p.pos.z + f.z * dist + r.z * side,
  };
};
const failures = [];
const check = (ok, why) => { if (!ok) failures.push(why); };
const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
const mouse = (type, button) => window.dispatchEvent(new MouseEvent(type, {
  button, clientX: window.innerWidth / 2, clientY: window.innerHeight * 0.52,
}));
const canvas = document.getElementById('ui');
const ctx = canvas.getContext('2d');
const fill = ctx.fillRect;
let barWidth = 0;
ctx.fillRect = function (x, y, w, h) {
  if (this.fillStyle === '#69d5a2') barWidth = Math.max(barWidth, w);
  return fill.call(this, x, y, w, h);
};
const readBar = async () => { barWidth = 0; await frame(); return barWidth; };

try {
  place(420);
  const fullWidth = await readBar();
  check(fullWidth > 0, '满血敌机没有血条');
  const hp = e.hp, ammo = p.missiles, shots = G.stats.shots, tracers = G.tracers.length;
  key('keydown', 'KeyF'); key('keyup', 'KeyF');
  check(e.hp === hp, '高速实体机炮弹应在飞行到达目标前保持目标血量');
  check(p.missiles === ammo && G.stats.shots === shots + 1, 'F 没有独立开一发机炮');
  check(G.bullets?.some(b => b.owner === 'player'), '机炮未创建实体曳光弹');
  check(G.tracers.length === tracers + 1, '机炮实体弹没有生成短暂曳光');
  __PI.step(0.75);
  check(e.hp < hp && e.hp > 0, '高速实体机炮弹飞行后没有造成伤害');
  const damagedWidth = await readBar();
  check(damagedWidth > 0 && damagedWidth < fullWidth, '命中后血条没有缩短');

  __PI.step(0.16);
  place(420, 160);
  const offAxisHp = e.hp, beforeBurst = G.stats.shots;
  key('keydown', 'KeyF');
  __PI.step(0.34);
  key('keyup', 'KeyF');
  const afterBurst = G.stats.shots;
  check(afterBurst >= beforeBurst + 3, '按住 F 没有持续扫射');
  check(e.hp === offAxisHp, '机炮命中了偏离机头的敌机');
  __PI.step(0.18);
  check(G.stats.shots === afterBurst, '松开 F 后仍在扫射');
  G.bullets.length = 0;

  mouse('mousedown', 0);
  check(G.stats.shots === afterBurst + 1 && p.rollT === 0, '左键没有开火或仍会触发桶滚');
  mouse('mousedown', 2); mouse('mouseup', 2);
  check(p.missiles === ammo - 1, '扫射时右键未能发射导弹');
  const duringMouse = G.stats.shots;
  __PI.step(0.22);
  check(G.stats.shots >= duringMouse + 2, '按住左键没有持续扫射');
  mouse('mouseup', 0);
  const mouseReleased = G.stats.shots;
  __PI.step(0.2);
  check(G.stats.shots === mouseReleased, '松开左键后仍在扫射');
  check(p.rollT === 0 && !p.burning && p.flares === 3, '鼠标开火误触发了桶滚、加力或干扰弹');

  __PI.step(0.11);
  const map = G.map, originalHeightAt = map.heightAt;
  const ridgeOrigin = { ...p.pos }, ridgeFwd = { ...p.basis.fwd }, ridgeRight = { ...p.basis.right };
  map.heightAt = (x, z) => {
    const dx = x - ridgeOrigin.x, dz = z - ridgeOrigin.z;
    const along = dx * ridgeFwd.x + dz * ridgeFwd.z;
    const side = dx * ridgeRight.x + dz * ridgeRight.z;
    return along > 100 && along < 130 && Math.abs(side) < 24
      ? ridgeOrigin.y + 20
      : originalHeightAt.call(map, x, z);
  };
  G.bullets.length = 0;
  e.pos = {
    x: ridgeOrigin.x + ridgeFwd.x * 300,
    y: ridgeOrigin.y + ridgeFwd.y * 300 - 10,
    z: ridgeOrigin.z + ridgeFwd.z * 300,
  };
  const blockedHp = e.hp;
  p.gunCd = 0;
  key('keydown', 'KeyF'); key('keyup', 'KeyF');
  G.mode = 'dying'; G.dyingTimer = 10;
  __PI.step(0.2);
  check(e.hp === blockedHp, '机炮穿过合成山脊命中敌机');
  check(G.bullets.length === 0, '山脊没有消耗被遮挡的实体曳光弹');
  G.mode = 'play';
  G.map.heightAt = originalHeightAt;
  G.bullets.length = 0;

  e.yaw = p.yaw; e.pitch = p.pitch; e.roll = p.roll; e.basis = p.basis; e.leaving = true;
  place(420);
  e.hp = 12;
  e.state = 'patrol';
  p.gunCd = 0;
  const oldScore = G.score, oldKills = G.stats.kills;
  key('keydown', 'KeyF'); key('keyup', 'KeyF');
  check(!e.dead, '实体机炮弹在飞抵目标前即时击落敌机');
  __PI.step(0.75);
  check(e.dead, '机炮曳光弹飞行命中没有击落剩余 12 点生命的敌机');
  check(G.stats.kills === oldKills + 1 && G.score > oldScore, '机炮击落没有计分');

  key('keydown', 'ShiftLeft'); __PI.step(0.1);
  check(p.burning, '按住 Shift 没有加力');
  key('keyup', 'ShiftLeft'); __PI.step(0.1);
  check(!p.burning, '松开 Shift 后仍在加力');
  check(__PI.errors.length === 0, `页面错误：${JSON.stringify(__PI.errors)}`);
  if (failures.length) throw new Error(failures.join('；'));
  return { result: 'PASS', fullWidth, damagedWidth, firstHit: hp - offAxisHp, missilesUsed: ammo - p.missiles };
} finally {
  ctx.fillRect = fill;
}

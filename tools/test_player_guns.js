if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('cockpit');
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
__PI.freeze(true);
await frame();
const G = __PI.G, p = G.player, e = G.enemies[0];
G.enemies = [e];
G.ground = [];
G.spawnTimer = 99;
const place = (dist, side = 0) => {
  const f = p.basis.fwd, r = p.basis.right;
  e.pos = {
    x: p.pos.x + f.x * dist + r.x * side,
    y: p.pos.y + f.y * dist + r.y * side,
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
  check(e.hp < hp && e.hp > 0, 'F 点按没有打掉一部分敌机血量');
  check(p.missiles === ammo && G.stats.shots === shots + 1, 'F 没有独立开一发机炮');
  check(G.tracers.length === tracers + 1, '机炮曳光弹没有汇聚为单一准星射线');
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
  const oldBasis = p.basis, oldYaw = p.yaw, oldPitch = p.pitch;
  const map = G.map;
  let blocked = null;
  for (let deg = 0; deg < 360 && !blocked; deg++) {
    const angle = deg * Math.PI / 180;
    const dx = Math.sin(angle), dz = -Math.cos(angle);
    for (let d = 300; d <= 1000; d += 20) {
      const x = p.pos.x + dx * d, z = p.pos.z + dz * d;
      const y = map.heightAt(x, z) + 50;
      if (y > p.pos.y - 20) continue;
      for (let s = 30; s < d; s += 10) {
        const rayY = p.pos.y + (y - p.pos.y) * s / d;
        if (map.heightAt(p.pos.x + dx * s, p.pos.z + dz * s) + 13 > rayY) {
          blocked = { angle, d, x, y, z };
          break;
        }
      }
      if (blocked) break;
    }
  }
  check(!!blocked, '没有找到可复现的山脊遮挡场景');
  if (blocked) {
    p.yaw = blocked.angle; p.pitch = 0; p.roll = 0;
    p.basis = {
      fwd: { x: Math.sin(blocked.angle), y: 0, z: -Math.cos(blocked.angle) },
      right: { x: Math.cos(blocked.angle), y: 0, z: Math.sin(blocked.angle) },
      up: { x: 0, y: 1, z: 0 },
    };
    p.renderBasis = p.basis;
    e.pos = { x: blocked.x, y: blocked.y, z: blocked.z };
    const blockedHp = e.hp;
    p.gunCd = 0;
    key('keydown', 'KeyF'); key('keyup', 'KeyF');
    check(e.hp === blockedHp, '机炮穿过山脊命中敌机');
  }
  p.yaw = oldYaw; p.pitch = oldPitch; p.basis = oldBasis; p.renderBasis = oldBasis;

  place(420);
  e.hp = 12;
  e.state = 'patrol';
  p.gunCd = 0;
  const oldScore = G.score, oldKills = G.stats.kills;
  key('keydown', 'KeyF'); key('keyup', 'KeyF');
  check(e.dead, '机炮命中没有击落剩余 12 点生命的敌机');
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

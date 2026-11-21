// ---------------------------------------------------------------------------
// COMBAT — drones, ground targets, missiles, lock-on, effects, scoring hooks.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------- waves -----
function chooseSecondary(n) {
  const roll = rng();
  if (n === 1) {
    if (roll < 0.55) return { type: 'vehicle', need: 2, killed: 0, text: '摧毁 2 辆装甲车' };
    return { type: 'low', need: 1, done: false, text: '在 45 米以下取得击杀' };
  }
  if (roll < 0.28) {
    const need = 1 + Math.min(2, Math.floor(n / 2));
    return { type: 'sam', need, killed: 0, text: `摧毁 ${need} 个防空阵地` };
  }
  if (roll < 0.55) {
    const need = 2 + Math.min(2, Math.floor(n / 3));
    return { type: 'vehicle', need, killed: 0, text: `摧毁 ${need} 辆装甲车` };
  }
  if (roll < 0.78) return { type: 'low', need: 1, done: false, text: '在 45 米以下取得击杀' };
  const need = Math.min(85, 60 + n);
  return { type: 'shield', need, done: false, text: `以 ${need}% 护盾完成本波` };
}

function prepareWave(n) {
  trace('prepareWave', `n=${n} total=${Math.min(9, 3 + n)}`);
  G.enemies.length = 0;
  G.ground.length = 0;
  G.missiles.length = 0;
  G.lock = { target: null, progress: 0, phase: 'search', tick: 0, lockTone: 0 };
  G.waveSpawned = 0;
  G.waveKills = 0;
  G.activeCap = Math.min(5, 3 + Math.floor((n - 1) / 2));
  G.waveTotal = Math.min(9, 3 + n);
  G.secondary = chooseSecondary(n);
  G.secondaryDone = false;
  G.spawnTimer = 1.6;

  // SAM threats. Higher waves get an extra site.
  let sams = 1 + Math.min(2, Math.floor(n / 3));
  if (G.secondary.type === 'sam') sams += G.secondary.need;
  for (let i = 0; i < sams; i++) spawnGroundTarget('sam', i < 2 ? [700, 1900] : [1000, 2600]);
  if (G.secondary.type === 'vehicle') {
    for (let i = 0; i < G.secondary.need; i++) spawnGroundTarget('vehicle', [600, 2100]);
  }
  const initial = Math.min(G.activeCap, G.waveTotal);
  for (let i = 0; i < initial; i++) spawnDrone(i);
  trace('afterInitial', `enemies=${G.enemies.length} spawned=${G.waveSpawned} initial=${initial}`);
  G.warningLamp = 0;
}

function spawnGroundTarget(type, range) {
  const p = G.player;
  let spot = null;
  for (let tries = 0; tries < 40 && !spot; tries++) {
    const cand = findFlatSpot(G.map, p.pos.x, p.pos.z, range[0], range[1], 0.22, 8, 460, 60);
    if (!cand) continue;
    let clear = true;
    for (const g of G.ground) {
      if (Math.hypot(g.pos.x - cand.x, g.pos.z - cand.z) < 260) { clear = false; break; }
    }
    if (!clear) continue;
    // keep the base footprint out of water
    let minH = 1e9;
    for (const [ox, oz] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) minH = Math.min(minH, G.map.heightAt(cand.x + ox, cand.z + oz));
    if (minH < 3) continue;
    spot = cand;
  }
  if (!spot) return null;
  const yaw = Math.atan2(p.pos.x - spot.x, -(p.pos.z - spot.z)) + rr(-0.4, 0.4);
  const g = {
    type, kind: type,
    pos: { x: spot.x, y: spot.h, z: spot.z },
    yaw, hp: type === 'sam' ? 100 : 80, dead: false,
    fireCd: rr(3.5, 6.5), maxLaunch: 3, activeMissiles: 0,
    turretScan: rr(0, TAU), isGround: true, radius: type === 'sam' ? 7 : 4,
    flashT: 0,
  };
  G.ground.push(g);
  return g;
}

function spawnDrone(index = 0) {
  if (G.waveSpawned >= G.waveTotal) return null;
  const p = G.player;
  const ang = rr(0, TAU);
  const dist = rr(1250, 2300);
  const x = p.pos.x + Math.sin(ang) * dist;
  const z = p.pos.z - Math.cos(ang) * dist;
  const h = Math.max(0, G.map.heightAt(x, z));
  const alt = Math.max(h + 200, Math.min(p.pos.y + rr(-90, 90), CLOUD_BASE - 160));
  const e = {
    kind: 'drone', isGround: false,
    pos: { x, y: alt, z },
    yaw: Math.atan2(p.pos.x - x, -(p.pos.z - z)),
    pitch: 0, roll: 0, speed: 108 * (G.enemySpeedScale ?? 1), energy: 100,
    hp: DRONE_MAX_HP, dead: false, aware: 0, state: 'patrol', fleeT: 0,
    missileCd: rr(3.0, 7.0), gunCd: rr(1, 2.5), gunBurst: 0,
    losTimer: rr(0, 0.3), los: true, age: 0,
    anchor: { x: x + rr(-500, 500), y: alt, z: z + rr(-500, 500) },
    orbit: rr(0, TAU), orbitSpeed: rr(0.12, 0.28) * (rng() < 0.5 ? 1 : -1),
    showIndex: index, evadeT: 0, leaving: false, missileCount: 0,
    engineSeed: rr(0, 10), radius: 7,
    basis: null,
  };
  e.basis = basisFrom(e.yaw, e.pitch, e.roll);
  G.enemies.push(e);
  G.waveSpawned++;
  trace('spawn', `#${G.waveSpawned}/${G.waveTotal} @${x.toFixed(0)},${alt.toFixed(0)},${z.toFixed(0)}`);
  return e;
}

// --------------------------------------------------------------- lock-on ----
function collectTargets() {
  const out = [];
  for (const e of G.enemies) if (!e.dead) out.push(e);
  for (const g of G.ground) if (!g.dead) out.push(g);
  return out;
}

function targetConcealed(t) {
  if (!t || t.isGround) return false;
  return G.map.cloudDensity(t.pos.x, t.pos.y + 1, t.pos.z) > 0.28;
}

// 近俯视中只把屏外目标的标记放在对应的画框边，不移动目标或改变世界判定。
function projectTargetMarker(pos, s) {
  s.edge = false;
  const projected = projectToScreen(pos, s);
  if (G.view !== 0 || G.viewBlend < 1) return projected;
  const cx = VW / 2, cy = VH / 2;
  if (projected && s.x >= 18 && s.x <= VW-18 && s.y >= 18 && s.y <= VH-18) return true;
  const dx = pos.x - G.player.pos.x, dz = pos.z - G.player.pos.z;
  if (Math.abs(dx) + Math.abs(dz) < .001) return false;
  const scale = 1 / Math.max(Math.abs(dx)/(cx-18), Math.abs(dz)/(cy-18));
  s.x = cx + dx*scale; s.y = cy + dz*scale; s.edge = true;
  return true;
}

function updateLockOn(dt) {
  const p = G.player;
  const L = G.lock;
  if (!p || p.dead || G.mode !== 'play') {
    L.target = null; L.progress = 0; L.phase = 'search';
    return;
  }
  const aim = G.view === 0 ? { x: INPUT.mx, y: INPUT.my } : { x: VW * 0.5, y: VH * 0.5 };
  const radius = G.view === 0 ? 92 : 74;
  let best = null, bestScore = 1e9;
  const tmp = {};
  for (const t of collectTargets()) {
    const d = vdist(p.pos, t.pos);
    if (d > 2700 || d < 25) continue;
    const dir = vnorm(vsub(t.pos, p.pos));
    if (vdot(dir, p.basis.fwd) < 0.25) continue;
    if (targetConcealed(t)) continue;
    if (!projectTargetMarker({ x: t.pos.x, y: t.pos.y + (t.isGround ? 2 : 1.5), z: t.pos.z }, tmp)) continue;
    if (tmp.x < -20 || tmp.x > VW + 20 || tmp.y < -20 || tmp.y > VH + 20) continue;
    const dx = tmp.x - aim.x, dy = tmp.y - aim.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) continue;
    // keep the current target unless it is clearly worse (hysteresis)
    let score = d2 + d * 0.01;
    if (L.target === t) score -= radius * radius * 0.6;
    if (score < bestScore) {
      if (L.target !== t) {
        // line of sight only checked for potential acquisitions
        if (!lineOfSightClear(p.pos, t.pos, 10)) continue;
      }
      best = t; bestScore = score;
    }
  }
  if (best !== L.target) {
    L.target = best;
    L.progress = best ? 0 : Math.max(0, L.progress - dt * 4);
  }
  if (L.target) {
    if (L.target.dead) { L.target = null; L.progress = 0; L.phase = 'search'; return; }
    const t = L.target;
    // break if the target slips out of the cone or is concealed
    const d = vdist(p.pos, t.pos);
    const dir = vnorm(vsub(t.pos, p.pos));
    const off = projectTargetMarker({ x: t.pos.x, y: t.pos.y + (t.isGround ? 2 : 1.5), z: t.pos.z }, tmp);
    const far = !off || Math.hypot(tmp.x - aim.x, tmp.y - aim.y) > radius * 1.34;
    if (d > 2900 || vdot(dir, p.basis.fwd) < 0.12 || far || targetConcealed(t)) {
      L.progress = Math.max(0, L.progress - dt * 3.5);
      L.phase = L.progress > 0.01 ? 'locking' : 'search';
      if (L.progress <= 0) L.target = null;
    } else {
      const prev = L.progress;
      L.progress += dt / LOCK_TIME;
      L.phase = L.progress >= 1 ? 'locked' : 'locking';
      if (L.progress >= 1 && prev < 1) {
        AudioSys.lockTone();
        G.flash = Math.max(G.flash, 0.08);
      }
      if (L.progress < 1) {
        L.tick -= dt;
        if (L.tick <= 0) {
          L.tick = 0.13 - L.progress * 0.06;
          AudioSys.lockTick(L.progress);
        }
      }
    }
  } else {
    L.phase = 'search';
    L.progress = Math.max(0, L.progress - dt * 4);
  }
  L.progress = clamp01(L.progress);
}

// --------------------------------------------------------------- 机炮 -------
function updatePlayerGuns(dt) {
  const p = G.player;
  if (!p || p.dead) return;
  p.gunCd = Math.max(0, p.gunCd - dt);
  if (INPUT.left || INPUT.keys.has('KeyF') || INPUT.touchGun) firePlayerGuns();
}

function spawnGunBullet(origin, velocity, owner, damage, color = '#f2c270') {
  const b = {
    owner, pos: vcopy(origin), vel: vcopy(velocity), damage,
    life: GUN_BULLET_LIFE, radius: 1.8, color,
  };
  G.bullets.push(b);
  if (G.bullets.length > 240) G.bullets.shift();
  const tail = vsub(origin, vmul(vnorm(velocity), 13));
  addTracer(tail, origin, color, owner === 'player' ? 1.3 : 1.1);
  return b;
}

function firePlayerGuns() {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'play' || p.gunCd > 1e-6) return;
  p.gunCd = GUN_INTERVAL;
  G.stats.shots++;
  const b = p.basis;
  const origin = vadd(p.pos, vmul(b.fwd, 6));
  const velocity = vmul(b.fwd, GUN_BULLET_SPEED);
  spawnGunBullet(origin, velocity, 'player', GUN_DAMAGE, '#f2c270');
  spawnBurst(origin, 2, '#e9ae56', 3, 0.06);
  AudioSys.gunshot(0.7);
}

function segmentHitsTerrain(from, to, clearance = 1) {
  const length = vdist(from, to);
  const steps = Math.max(1, Math.ceil(length / 10));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const point = vlerp(from, to, t);
    const ground = Math.max(G.map.heightAt(point.x, point.z), 0) + clearance;
    if (point.y <= ground) {
      const prev = vlerp(from, to, Math.max(0, (i - 1) / steps));
      const denom = point.y - prev.y;
      const hitT = Math.abs(denom) > 1e-6 ? clamp((ground - prev.y) / denom, 0, 1) : 0;
      return vlerp(prev, point, hitT);
    }
  }
  return null;
}

function updateGunBullets(dt) {
  for (const b of G.bullets) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    const from = vcopy(b.pos);
    b.vel.y -= GUN_BULLET_GRAVITY * dt;
    b.pos = vadd(b.pos, vmul(b.vel, dt));
    addTracer(vsub(b.pos, vmul(vnorm(b.vel), 13)), b.pos, b.color, b.owner === 'player' ? 1.3 : 1.1);
    const terrain = segmentHitsTerrain(from, b.pos, 1);
    if (terrain) {
      b.dead = true;
      spawnSparks(terrain, 2, '#d4a16a');
      continue;
    }
    const targets = b.owner === 'player' ? collectTargets() : (G.player && !G.player.dead ? [G.player] : []);
    let hit = null;
    for (const target of targets) {
      const point = targetAimPoint(target) || target.pos;
      if (missilePassesNear(from, b.pos, point, (target.radius || 7) + b.radius)) { hit = target; break; }
    }
    if (hit) {
      b.dead = true;
      if (b.owner === 'player') {
        if (hit.isGround) hitGround(hit, b.damage, hit.pos); else hitDrone(hit, b.damage, hit.pos);
      } else {
        damagePlayer(b.damage, 'guns');
        spawnSparks(G.player.pos, 2, '#ffbf80');
      }
    }
  }
  G.bullets = G.bullets.filter(b => !b.dead);
}

// --------------------------------------------------------------- missiles ---
function wingRailPosition(p, slot) {
  const b = p.renderBasis || p.basis, outer = Math.floor(slot / 2);
  const side = (slot % 2 ? 1 : -1) * (2.2 + outer * 1.05);
  return vmad(vmad(vmad(p.pos, b.right, side), b.up, -0.52), b.fwd, 0.8 + outer * 1.35);
}

function spawnPlayerMissile() {
  const p = G.player;
  const t = G.lock.phase === 'locked' && G.lock.target && !G.lock.target.dead ? G.lock.target : null;
  const slot = p.nextRail || 0, origin = wingRailPosition(p, slot);
  p.nextRail = (slot + 1) % 4;
  const dir = (p.renderBasis || p.basis).fwd;
  const speed = Math.max(MISSILE_PLAYER_SPEED, p.speed + 35);
  const m = {
    owner: 'player', kind: 'player',
    pos: origin, vel: vmul(dir, speed), speed,
    target: t, alive: true, dead: false,
    life: 14, age: 0, turnRate: 2.9, gravity: MISSILE_GRAVITY,
    accel: 110, maxSpeed: MISSILE_PLAYER_MAX_SPEED,
    trail: startMissileTrail(origin, dir),
    lost: false, lostTimer: 0,
    hitRadius: 20, damage: 130,
  };
  G.missiles.push(m);
  G.stats.shots++;
  spawnBurst(origin, 4, '#ffd08a', 11);
  addShake(0.18);
  G.flash = Math.max(G.flash, 0.1);
  AudioSys.launch();
}

function firePlayerMissile() {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'play') return;
  if (p.missiles <= 0) {
    AudioSys.tone(180, 0.05, 'square', 0.03);
    return;
  }
  p.missiles--;
  p.reloads.push(MISSILE_RELOAD);
  spawnPlayerMissile();
}

function spawnEnemyMissile(origin, aimedAt, source) {
  const p = G.player;
  const targetPos = aimedAt || p.pos;
  const dir = vnorm(vsub(targetPos, origin));
  const speed = MISSILE_ENEMY_SPEED;
  const m = {
    owner: 'enemy', kind: 'enemy',
    pos: vcopy(origin), vel: vmul(dir, speed), speed,
    target: p, dead: false,
    life: 9.5, age: 0, turnRate: 1.35, gravity: MISSILE_GRAVITY,
    accel: 42, maxSpeed: MISSILE_ENEMY_MAX_SPEED,
    trail: startMissileTrail(origin, dir),
    lost: false, lostTimer: 0, decoy: false,
    damage: 30 + Math.min(14, (G.wave || 1) * 1.4),
    hitRadius: 12, source,
  };
  G.missiles.push(m);
  const d = vdist(origin, G.player.pos);
  if (d < 1700) AudioSys.launch();
  return m;
}

function rotateTowards(a, b, maxAngle) {
  const d = clamp(vdot(a, b), -1, 1);
  const ang = Math.acos(d);
  if (ang <= maxAngle || ang < 1e-5) return vcopy(b);
  let axis = vcross(a, b);
  // 完全反向时叉积为零，选稳定正交轴，仍按转速上限逐步转弯。
  if (vlen(axis) < 1e-6) axis = vcross(a, Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 });
  axis = vnorm(axis);
  const c = Math.cos(maxAngle), s = Math.sin(maxAngle);
  const dotv = vdot(axis, a);
  return {
    x: a.x * c + (axis.y * a.z - axis.z * a.y) * s + axis.x * dotv * (1 - c),
    y: a.y * c + (axis.z * a.x - axis.x * a.z) * s + axis.y * dotv * (1 - c),
    z: a.z * c + (axis.x * a.y - axis.y * a.x) * s + axis.z * dotv * (1 - c),
  };
}

function targetAimPoint(t) {
  if (!t) return null;
  const y = t.isGround ? t.pos.y + 2.2 : t.pos.y + 0.8;
  return { x: t.pos.x, y, z: t.pos.z };
}

function missilePassesNear(from, to, point, radius) {
  const step = vsub(to, from), offset = vsub(point, from);
  const t = clamp(vdot(offset, step) / (vdot(step, step) || 1), 0, 1);
  return vdist(vmad(from, step, t), point) < radius;
}

function updateMissiles(dt) {
  const p = G.player;
  for (const m of G.missiles) {
    if (m.dead) continue;
    m.age += dt;
    m.life -= dt;
    if (m.life <= 0) { m.dead = true; continue; }
    let desired = null;
    if (m.owner === 'player') {
      if (m.target && !m.target.dead) {
        if (m.target.isGround && G.map.cloudDensity(m.target.pos.x, m.target.pos.y + 1, m.target.pos.z) > 0.4 && rng() < dt * 2) m.lost = true;
        if (!m.lost) desired = targetAimPoint(m.target);
      } else m.target = null;
    } else if (m.lost) {
      m.lostTimer -= dt;
      if (m.lostTimer <= 0) { m.dead = true; spawnExplosion(m.pos, 0.3, 'air', { smoke: 2 }); continue; }
    } else if (p && !p.dead) {
      if (p.invuln > 0.25 && vdist(m.pos, p.pos) < 32) { m.lost = true; m.lostTimer = 0.7; }
      const conceal = G.map.cloudDensity(p.pos.x, p.pos.y, p.pos.z);
      const concealChance = (conceal > 0.28 ? 0.55 : 0) + (p.agl < 42 ? 0.2 : 0) + (p.skimming ? 0.25 : 0);
      if (concealChance > 0 && rng() < concealChance * dt * 1.8) { m.lost = true; m.lostTimer = 1.0; }
      if (m.decoy && rng() < dt * 3) { m.lost = true; m.lostTimer = 0.5; }
      if (!m.lost) desired = vadd(p.pos, vmul(p.basis.fwd, p.speed * 0.35));
    }

    const steps = Math.max(1, Math.ceil(dt / 0.0125));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const oldVelocity = m.vel, from = m.pos;
      const age = m.age - dt + (i + 0.5) * stepDt;
      const steer = m.owner === 'player' ? smoothstep(0.12, 0.32, age) : 1;
      if (desired && steer > 0) {
        const dir = rotateTowards(vnorm(m.vel), vnorm(vsub(desired, from)), m.turnRate * steer * stepDt);
        m.vel = vmul(dir, Math.min(m.maxSpeed, m.speed + m.accel * stepDt));
      } else m.vel = vcopy(oldVelocity);
      m.vel.y -= (m.gravity || MISSILE_GRAVITY) * stepDt;
      m.speed = vlen(m.vel);
      m.pos = vmad(from, vadd(oldVelocity, m.vel), 0.5 * stepDt);

      const terrain = segmentHitsTerrain(from, m.pos, 1);
      if (m.trail) sampleMissileTrail(m.trail, vmad(terrain || m.pos, m.vel, -3 / (m.speed || 1)));
      if (terrain) {
        m.dead = true;
        const gh = G.map.heightAt(terrain.x, terrain.z), water = gh < 0;
        const point = { x: terrain.x, y: Math.max(gh, 0) + 0.5, z: terrain.z };
        if (m.owner === 'player') detonatePlayerMissile(m, point);
        else {
          spawnExplosion(point, 0.9, water ? 'water' : 'ground');
          if (p && !p.dead && vdist(point, p.pos) < 35 && !m.lost) damagePlayer(m.damage * 0.5, 'missile');
          AudioSys.explosion(0.6, false);
          addShake(0.2);
        }
        break;
      }

      if (m.owner === 'player') {
        let hit = false;
        if (m.target && !m.target.dead) {
          const aim = targetAimPoint(m.target);
          if (missilePassesNear(from, m.pos, aim, m.hitRadius + (m.target.isGround ? 8 : 4))) {
            detonatePlayerMissile(m, aim);
            hit = true;
          }
        } else {
          for (const t of collectTargets()) {
            const aim = targetAimPoint(t);
            if (missilePassesNear(from, m.pos, aim, m.hitRadius)) { m.target = t; detonatePlayerMissile(m, aim); hit = true; break; }
          }
        }
        if (hit) { m.dead = true; break; }
      } else if (p && !p.dead && missilePassesNear(from, m.pos, p.pos, m.hitRadius)) {
        m.dead = true;
        if (p.invuln <= 0.2) {
          damagePlayer(m.damage, 'missile');
          spawnExplosion(p.pos, 0.9, 'air', { player: true });
          G.flash = 0.5;
        } else spawnExplosion(m.pos, 0.45, 'air', { smoke: 4 });
        break;
      }
    }
  }
  G.missiles = G.missiles.filter(m => !m.dead);
}

function detonatePlayerMissile(m, point) {
  const water = G.map.heightAt(point.x, point.z) < 0;
  const kind = water ? 'water' : (point.y < G.map.heightAt(point.x, point.z) + 30 ? 'ground' : 'air');
  spawnExplosion(point, 1.25, kind);
  AudioSys.explosion(1, false);
  addShake(0.32);
  G.flash = Math.max(G.flash, 0.18);
  G.hitStop = Math.max(G.hitStop, 0.02);
  // splash damage
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (vdist(e.pos, point) < 34) hitDrone(e, m.damage, point);
  }
  for (const g of G.ground) {
    if (g.dead) continue;
    if (vdist(g.pos, point) < 38) hitGround(g, m.damage, point);
  }
}

function hitDrone(e, dmg, at) {
  if (!e || e.dead) return;
  G.stats.hits++;
  e.hp -= dmg;
  if (e.hp <= 0) {
    e.dead = true;
    e.state = 'dead';
    const kind = G.map.heightAt(e.pos.x, e.pos.z) < 0 ? 'water' : (e.pos.y < G.map.heightAt(e.pos.x, e.pos.z) + 40 ? 'ground' : 'air');
    spawnExplosion(e.pos, 1.15, kind === 'air' ? 'air' : kind, { drone: true });
    for (let i = 0; i < 3; i++) {
      spawnDebris(vadd(e.pos, { x: rr(-4, 4), y: rr(-3, 3), z: rr(-4, 4) }), vmul(e.basis ? e.basis.fwd : { x: 0, y: 0, z: -1 }, e.speed * 0.5));
    }
    awardKill('drone', e.pos);
    trace('killDrone', `${G.waveKills}/${G.waveTotal} @${e.pos.x.toFixed(0)},${e.pos.y.toFixed(0)},${e.pos.z.toFixed(0)}`);
    AudioSys.explosion(1, true);
    addShake(0.7);
    G.flash = Math.max(G.flash, 0.3);
    G.hitStop = Math.max(G.hitStop, 0.06);
    if (G.lock.target === e) { G.lock.target = null; G.lock.progress = 0; G.lock.phase = 'search'; }
  } else {
    spawnSparks(at || e.pos, 5, '#ffb37a');
  }
}

function hitGround(g, dmg, at) {
  if (!g || g.dead) return;
  G.stats.hits++;
  g.hp -= dmg;
  if (g.hp <= 0) {
    g.dead = true;
    const water = G.map.heightAt(g.pos.x, g.pos.z) < 0;
    spawnExplosion(g.pos, 1.35, water ? 'water' : 'ground');
    addScorch({ x: g.pos.x, y: g.pos.y, z: g.pos.z }, g.type === 'sam' ? 26 : 18);
    awardKill(g.type, g.pos);
    AudioSys.explosion(1, true);
    addShake(0.55);
    if (G.lock.target === g) { G.lock.target = null; G.lock.progress = 0; G.lock.phase = 'search'; }
  } else {
    spawnSparks(at || g.pos, 4, '#ffcf8a');
  }
}

// --------------------------------------------------------------- enemies ----
function playerExposureFactor(p) {
  let f = 1;
  if (p.agl < 55) f *= 0.34;
  else if (p.agl < 140) f *= 0.7;
  if (p.inCloud > 0.3) f *= 0.22;
  else if (p.inCloud > 0.14) f *= 0.55;
  if (p.skimming) f *= 0.65;
  return f;
}

function enemyDetectsPlayer(e, p, dt, detectRange) {
  const d = vdist(e.pos, p.pos);
  if (d > detectRange) return false;
  const dir = vnorm(vsub(p.pos, e.pos));
  const fwd = e.basis.fwd;
  if (vdot(dir, fwd) < Math.cos(1.35)) return false;
  // sun glare: player close to the sun from the drone's point of view
  const sunBlind = vdot(dir, SUN_DIR) > 0.92;
  if (sunBlind && rng() < 0.55) return false;
  e.losTimer -= dt;
  if (e.losTimer <= 0) {
    e.losTimer = 0.25;
    e.los = lineOfSightClear(e.pos, p.pos, 11);
  }
  return e.los;
}

function steerDrone(e, desired, dt) {
  const dx = desired.x - e.pos.x, dy = desired.y - e.pos.y, dz = desired.z - e.pos.z;
  const horiz = Math.hypot(dx, dz) || 1;
  const targetYaw = Math.atan2(dx, -dz);
  const targetPitch = clamp(Math.atan2(dy, horiz), -0.72, 0.72);
  let dyaw = wrapAngle(targetYaw - e.yaw);
  const maxYaw = 1.25 * dt;
  e.yaw = wrapAngle(e.yaw + clamp(dyaw, -maxYaw, maxYaw));
  const dp = targetPitch - e.pitch;
  e.pitch = clamp(e.pitch + clamp(dp, -0.9 * dt, 0.9 * dt), -0.8, 0.8);
  const targetRoll = clamp(-dyaw * 1.3, -1.0, 1.0);
  e.roll = angleLerp(e.roll, targetRoll, 1 - Math.exp(-4 * dt));
  e.basis = basisFrom(e.yaw, e.pitch, e.roll);
}

function updateEnemies(dt) {
  const p = G.player;
  const mode = G.mode;
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.age += dt;
    if (!p) continue;
    const dist = vdist(e.pos, p.pos);
    const detectRange = 1500 + G.wave * 55;
    const exposure = playerExposureFactor(p);
    if (mode === 'play' && !e.leaving) {
      if (enemyDetectsPlayer(e, p, dt, detectRange * exposure)) {
        e.aware = 4.2;
        if (e.state !== 'engage' && e.state !== 'flee') e.state = 'engage';
      } else {
        e.aware -= dt;
      }
    }
    // state / energy
    if (e.state === 'flee') {
      e.fleeT -= dt;
      e.energy = Math.min(100, e.energy + 16 * dt);
      if (e.fleeT <= 0) e.state = e.aware > 0 ? 'engage' : 'patrol';
    } else if (e.state === 'engage') {
      e.energy = Math.max(0, e.energy - 5.5 * dt);
      if (e.energy < 12) { e.state = 'flee'; e.fleeT = 4.5; }
      if (e.aware <= 0) e.state = 'patrol';
    } else {
      e.energy = Math.min(100, e.energy + 9 * dt);
      if (e.aware > 0 && mode === 'play') e.state = 'engage';
    }
    // anchor follows the player so patrols stay in the fight
    if (dist > 3000) {
      const ang = rr(0, TAU);
      e.anchor = {
        x: p.pos.x + Math.sin(ang) * rr(800, 1600),
        y: Math.max(G.map.heightAt(p.pos.x + Math.sin(ang) * 1200, p.pos.z - Math.cos(ang) * 1200) + 200, Math.min(p.pos.y, CLOUD_BASE - 160)),
        z: p.pos.z - Math.cos(ang) * rr(800, 1600)
      };
    }
    let desired = null;
    let speedTarget = 110;
    if (e.leaving) {
      desired = vadd(e.pos, vmul(e.basis.fwd, 1500));
      desired.y = Math.max(desired.y, G.map.heightAt(desired.x, desired.z) + 500);
      speedTarget = 150;
    } else if (e.state === 'engage' && mode === 'play') {
      const lead = vadd(p.pos, vmul(p.basis.fwd, clamp(dist / 260, 0.4, 2.4) * 0.55));
      if (dist < 420) {
        const away = vnorm(vsub(e.pos, p.pos));
        desired = vadd(vadd(p.pos, vmul(away, 850)), { x: 0, y: 90, z: 0 });
      } else {
        desired = { x: lead.x, y: lead.y + 35, z: lead.z };
      }
      speedTarget = e.energy > 24 ? 152 : 112;
      e.energy = Math.max(0, e.energy - 5.2 * dt);
    } else if (e.state === 'flee') {
      const away = vnorm(vsub(e.pos, p.pos));
      desired = vadd(vadd(e.pos, vmul(away, 1200)), { x: 0, y: 80, z: 0 });
      speedTarget = 168;
    } else {
      // orbit patrol
      e.orbit += e.orbitSpeed * dt;
      const r = 420;
      desired = {
        x: e.anchor.x + Math.cos(e.orbit) * r,
        y: e.anchor.y + Math.sin(e.orbit * 0.7) * 50,
        z: e.anchor.z + Math.sin(e.orbit) * r
      };
      speedTarget = 108;
    }
    const ghHere = G.map.heightAt(e.pos.x, e.pos.z);
    if (!e.leaving) desired.y = Math.min(desired.y, Math.max(p.pos.y + 180, CLOUD_BASE - 140));
    if (desired.y < ghHere + 180) desired.y = ghHere + 180;
    // look-ahead terrain avoidance
    const ahead = vadd(e.pos, vmul(e.basis.fwd, 280));
    const ghAhead = G.map.heightAt(ahead.x, ahead.z);
    if (ghAhead > e.pos.y - 55) {
      desired.y = Math.max(desired.y, ghAhead + 260);
      e.pitch = Math.max(e.pitch, 0.16);
    }
    steerDrone(e, desired, dt);
    e.speed = damp(e.speed, speedTarget * (G.enemySpeedScale ?? 1), 1.4, dt);
    const f = e.basis.fwd;
    e.pos.x += f.x * e.speed * dt;
    e.pos.y += f.y * e.speed * dt;
    e.pos.z += f.z * e.speed * dt;

    // hard terrain floor — never clip
    const gh = G.map.heightAt(e.pos.x, e.pos.z);
    const floor = Math.max(gh, 0) + 48;
    if (e.pos.y < floor) {
      e.pos.y = floor;
      e.pitch = Math.max(e.pitch, 0.18);
      e.yaw += clamp(wrapAngle(Math.atan2(e.pos.x - p.pos.x, -(e.pos.z - p.pos.z)) - e.yaw), -0.5, 0.5) * 0.3;
    }
    if (e.pos.y > 2200) e.pitch = Math.min(e.pitch, 0);

    // attacks
    if (mode === 'play' && !e.leaving && e.state === 'engage' && vdist(e.pos, p.pos) < 2600) {
      const toP = vnorm(vsub(p.pos, e.pos));
      const aimOk = vdot(toP, e.basis.fwd) > 0.55;
      e.missileCd -= dt;
      if (e.missileCd <= 0 && dist > 420 && dist < 2100 && aimOk && G.missiles.filter(m => m.owner === 'enemy' && m.source === e).length < 2 && G.missiles.filter(m => m.owner === 'enemy').length < 7) {
        e.missileCd = Math.max(3.2, 8.5 - G.wave * 0.35) + rr(0, 2.5);
        const origin = vadd(vadd(e.pos, vmul(e.basis.fwd, 2.5)), vmul(e.basis.up, -1.4));
        spawnEnemyMissile(origin, p.pos, e);
      }
      e.gunCd -= dt;
      if (dist < 520 && aimOk && e.gunCd <= 0) {
        e.gunCd = 1.05 + rr(0, 0.5);
        fireDroneGuns(e, p, dist);
      }
    }
    // separation from other drones
    for (const o of G.enemies) {
      if (o === e || o.dead) continue;
      const d = vdist(o.pos, e.pos);
      if (d < 55 && d > 0.01) {
        const push = vmul(vnorm(vsub(e.pos, o.pos)), (55 - d) * 0.6);
        e.pos = vadd(e.pos, push);
      }
    }
    // ram damage if it somehow happens
    if (dist < 20 && !p.dead && mode === 'play') damagePlayer(18, 'ram');
  }
  // remove exploded drones after their debris has flown (they stay as corpses? immediately removable)
  const removed = G.enemies.filter(e => e.dead).length;
  if (removed) trace('removeDrones', removed);
  G.enemies = G.enemies.filter(e => !e.dead);
}

function fireDroneGuns(e, p, dist) {
  const muzzle = vadd(vadd(e.pos, vmul(e.basis.fwd, 5.0)), vmul(e.basis.right, rr(-1.5, 1.5)));
  const conceal = playerExposureFactor(p);
  const spread = 8 + (1 - conceal) * 26;
  const bulletSpeed = GUN_BULLET_SPEED * 0.82;
  const leadTime = Math.min(0.9, dist / bulletSpeed);
  for (let i = 0; i < 4; i++) {
    const target = vadd(vadd(p.pos, vmul(p.basis.fwd, p.speed * leadTime)), {
      x: rr(-spread, spread), y: rr(-spread * 0.6, spread * 0.6), z: rr(-spread, spread),
    });
    spawnGunBullet(muzzle, vmul(vnorm(vsub(target, muzzle)), bulletSpeed), 'enemy', 4.2 + Math.min(2, G.wave * 0.2), '#ffca8a');
  }
  spawnBurst(muzzle, 2, '#ffd9a0', 6, 0.18);
  if (dist < 900) AudioSys.gunshot(clamp(1 - dist / 1400, 0.1, 1));
}

// ---------------------------------------------------------- ground targets ---
function updateGround(dt) {
  const p = G.player;
  for (const g of G.ground) {
    if (g.dead) continue;
    if (g.type === 'sam') {
      if (p) {
        const desiredYaw = Math.atan2(p.pos.x - g.pos.x, -(p.pos.z - g.pos.z));
        g.yaw = angleLerp(g.yaw, desiredYaw, 1 - Math.exp(-0.8 * dt));
      }
      if (G.mode !== 'play' || !p || p.dead) continue;
      const d = vdist(g.pos, p.pos);
      g.fireCd -= dt;
      const conceal = playerExposureFactor(p);
      const masked = conceal < 0.4;
      const los = lineOfSightClear(g.pos, p.pos, 12);
      if (g.fireCd <= 0 && d < 2300 && d > 160 && !masked && los) {
        const active = G.missiles.filter(m => m.owner === 'enemy' && m.source === g).length;
        if (active < 2 && G.missiles.filter(m => m.owner === 'enemy').length < 8) {
          g.fireCd = Math.max(4.2, 9.5 - G.wave * 0.4) + rr(0, 2.0);
          g.flashT = 0.3;
          const origin = { x: g.pos.x + Math.sin(g.yaw) * 1.2, y: g.pos.y + 7.5, z: g.pos.z - Math.cos(g.yaw) * 1.2 };
          spawnEnemyMissile(origin, p.pos, g);
          for (let i = 0; i < 4; i++) addSmoke(vadd(origin, { x: rr(-3, 3), y: rr(-1, 2), z: rr(-3, 3) }), rr(4, 8), 1.2, true);
          addTracer(origin, vadd(origin, { x: 0, y: 25, z: 0 }), '#ffd27a', 2);
        }
      }
      if (g.flashT > 0) g.flashT -= dt;
    }
  }
}

// ---------------------------------------------------------------- effects ---
function capEffects() {
  while (G.effects.length > 820) G.effects.shift();
}
function addSmoke(pos, size, life, dark = false, growth = null, rise = rr(1, 5)) {
  G.effects.push({
    type: 'smoke', pos: vcopy(pos), vel: { x: rr(-2, 2), y: rise, z: rr(-2, 2) },
    life, maxLife: life, size, growth: growth === null ? rr(3, 10) : growth, dark,
    drift: rr(0, TAU)
  });
  capEffects();
}
function spawnBurst(pos, n, color, speed = 25, life = 0.35) {
  for (let i = 0; i < n; i++) {
    G.effects.push({
      type: 'spark', pos: vcopy(pos),
      vel: { x: rr(-speed, speed), y: rr(-speed * 0.6, speed), z: rr(-speed, speed) },
      life: rr(life * 0.5, life), maxLife: life, size: rr(0.7, 1.8), color, gravity: 12
    });
  }
  capEffects();
}
function spawnSparks(pos, n, color) { spawnBurst(pos, n, color, 32, 0.5); }
function spawnDebris(pos, baseVel) {
  G.effects.push({
    type: 'debris', pos: vcopy(pos),
    vel: vadd(vmul(baseVel || { x: 0, y: 0, z: 0 }, 0.25), { x: rr(-28, 28), y: rr(-18, 26), z: rr(-28, 28) }),
    life: rr(1.0, 1.9), maxLife: 1.9, size: rr(1.2, 2.8), color: pick(['#6e6874', '#4b4654', '#8d3a32', '#2e2932']),
    gravity: 24, rot: rr(0, TAU), rotV: rr(-8, 8)
  });
  capEffects();
}
function addTracer(a, b, color, width = 1) {
  G.tracers.push({ a: vcopy(a), b: vcopy(b), color, width, life: 0.09, maxLife: 0.09 });
  if (G.tracers.length > 120) G.tracers.shift();
}
function startMissileTrail(origin, dir) {
  const tail = vmad(origin, dir, -3);
  const trail = { points: [{ pos: tail, life: MISSILE_TRAIL_LIFE }], tip: tail, tipLife: MISSILE_TRAIL_LIFE, carry: 0 };
  G.missileTrails.push(trail);
  if (G.missileTrails.length > 28) G.missileTrails.shift();
  return trail;
}
function sampleMissileTrail(trail, tail) {
  const from = trail.tip, length = vdist(from, tail);
  // 把上一段不足一个采样间距的余量带过来，低帧率也不断线。
  for (let d = MISSILE_TRAIL_SPACING - trail.carry; d <= length; d += MISSILE_TRAIL_SPACING) {
    trail.points.push({ pos: vlerp(from, tail, d / length), life: MISSILE_TRAIL_LIFE });
    if (trail.points.length > 112) trail.points.shift();
  }
  trail.carry = (trail.carry + length) % MISSILE_TRAIL_SPACING;
  trail.tip = tail; trail.tipLife = MISSILE_TRAIL_LIFE;
}
function addWingTrail(pos, side, strong = false) {
  G.vapor.push({ pos: vcopy(pos), side, life: strong ? 0.7 : 0.45, maxLife: strong ? 0.7 : 0.45, size: strong ? 1.8 : 1.1 });
  if (G.vapor.length > 260) G.vapor.shift();
}
function spawnSpray(pos) {
  for (let i = 0; i < 3; i++) {
    G.effects.push({
      type: 'spray', pos: vadd(pos, { x: rr(-6, 6), y: rr(0, 2), z: rr(-6, 6) }),
      vel: { x: rr(-32, 32), y: rr(16, 48), z: rr(-32, 32) },
      life: rr(0.5, 1.2), maxLife: 1.2, size: rr(1, 2.6), color: '#e9f7ef', gravity: 55
    });
  }
  if (Math.random() < 0.5) {
    G.effects.push({
      type: 'foam', pos: { x: pos.x + rr(-12, 12), y: 0.3, z: pos.z + rr(-12, 12) },
      vel: { x: 0, y: 0, z: 0 }, life: 1.1, maxLife: 1.1, size: rr(4, 10), color: '#dff3e8'
    });
  }
  capEffects();
}
function spawnFlare(pos, vel) {
  G.effects.push({
    type: 'flare', pos: vcopy(pos), vel: vadd(vel, { x: rr(-25, 25), y: rr(-8, 12), z: rr(-25, 25) }),
    life: 2.4, maxLife: 2.4, size: 1.6, color: '#fff1b8', gravity: 12, smokeT: 0
  });
  capEffects();
}
function spawnExplosion(pos, scale = 1, kind = 'air', opts = {}) {
  const delay = opts.delay || 0;
  const s = scale;
  const at = vcopy(pos);
  if (kind === 'water') {
    for (let i = 0; i < 18 * s; i++) {
      G.effects.push({
        type: 'spray', pos: { x: at.x + rr(-5, 5), y: at.y + rr(0, 2), z: at.z + rr(-5, 5) },
        vel: { x: rr(-22, 22), y: rr(40, 110) * s, z: rr(-22, 22) },
        life: rr(0.7, 1.6), maxLife: 1.6, size: rr(1.5, 4), color: '#effaf2', gravity: 70, delay
      });
    }
    G.effects.push({ type: 'ring', pos: at, vel: { x: 0, y: 0, z: 0 }, life: 0.75, maxLife: 0.75,
      size: 8 * s, growth: 55 * s, color: '#d7efe4', flat: true, delay });
    G.effects.push({ type: 'mist', pos: at, vel: { x: 0, y: 9, z: 0 }, life: 1.5, maxLife: 1.5, size: 8 * s, growth: 18, dark: false, delay });
    for (let i = 0; i < 6; i++) addSmoke({ x: at.x + rr(-8, 8), y: at.y + rr(2, 14), z: at.z + rr(-8, 8) }, rr(4, 8) * s, 1.5, false);
    G.effects.push({ type: 'foam', pos: { x: at.x, y: 0.5, z: at.z }, vel: { x: 0, y: 0, z: 0 }, life: 2.2, maxLife: 2.2, size: 8 * s, growth: 18 * s, color: '#e6f6ec', delay });
  } else if (kind === 'ground') {
    G.effects.push({ type: 'fire', pos: at, vel: { x: 0, y: 6, z: 0 }, life: 0.45, maxLife: 0.45, size: 7 * s, growth: 16 * s, color: '#ffd06a', delay });
    for (let i = 0; i < 7; i++) addSmoke({ x: at.x + rr(-6, 6), y: at.y + rr(1, 8), z: at.z + rr(-6, 6) }, rr(4, 10) * s, rr(1.4, 2.8), true);
    for (let i = 0; i < 14; i++) {
      G.effects.push({
        type: 'ember', pos: { x: at.x + rr(-5, 5), y: at.y + rr(0, 3), z: at.z + rr(-5, 5) },
        vel: { x: rr(-25, 25), y: rr(18, 55), z: rr(-25, 25) },
        life: rr(0.5, 1.4), maxLife: 1.4, size: rr(0.8, 1.8), color: pick(['#ffca6a', '#ff8a4a', '#ffe7ae']), gravity: 28, delay
      });
    }
    G.effects.push({ type: 'ring', pos: at, vel: { x: 0, y: 0, z: 0 }, life: 0.5, maxLife: 0.5,
      size: 5 * s, growth: 40 * s, color: '#e5cfa8', flat: true, delay });
    addScorch(at, 18 * s);
    // 火光只闪一下，分层升起的烟才让玩家看清远岸的落点。
    for (let i = 0; i < 5; i++) {
      const puff = { x: at.x + rr(-12, 12) * s, y: at.y + 3 + i * 2, z: at.z + rr(-9, 9) * s };
      addSmoke(puff, (8 + i) * s, 2.2 + i * 0.24, true, (5 + i) * s, (13 + i * 8) * s);
    }
  } else {
    // air burst
    G.effects.push({ type: 'fire', pos: at, vel: { x: 0, y: 3, z: 0 }, life: 0.5, maxLife: 0.5, size: 9 * s, growth: 30 * s, color: '#fff2c8', delay });
    G.effects.push({ type: 'fire', pos: vadd(at, { x: rr(-3, 3), y: rr(-3, 3), z: rr(-3, 3) }), vel: { x: 0, y: 2, z: 0 }, life: 0.72, maxLife: 0.72, size: 6 * s, growth: 34 * s, color: '#ffab4e', delay });
    G.effects.push({ type: 'ring', pos: at, vel: { x: 0, y: 0, z: 0 }, life: 0.5, maxLife: 0.5,
      size: 6 * s, growth: 85 * s, color: '#fff3d2', delay });
    for (let i = 0; i < 16 * s; i++) {
      G.effects.push({
        type: 'spark', pos: vcopy(at),
        vel: { x: rr(-80, 80) * s, y: rr(-45, 90) * s, z: rr(-80, 80) * s },
        life: rr(0.4, 1.2), maxLife: 1.2, size: rr(0.8, 2.2), color: pick(['#fff6dc', '#ffd16a', '#ff8f4a']),
        gravity: 22, delay
      });
    }
    for (let i = 0; i < 6; i++) addSmoke({ x: at.x + rr(-6, 6), y: at.y + rr(-4, 6), z: at.z + rr(-6, 6) }, rr(6, 14) * s, rr(1.2, 2.8), true);
    if (opts.smoke) {
      for (let i = 0; i < opts.smoke; i++) addSmoke({ x: at.x + rr(-8, 8), y: at.y + rr(-5, 8), z: at.z + rr(-8, 8) }, rr(5, 14), rr(1.5, 3.2), true);
    }
  }
  if (opts.delay) {
    // delayed bursts simply schedule the same effect set; delay is baked into particles above
  }
  capEffects();
}
function addScorch(pos, size) {
  G.decals.push({ pos: vcopy(pos), size, life: 26, maxLife: 26 });
  if (G.decals.length > 26) G.decals.shift();
}

function updateEffects(dt) {
  for (let i = G.missileTrails.length - 1; i >= 0; i--) {
    const trail = G.missileTrails[i];
    for (const point of trail.points) point.life -= dt;
    while (trail.points.length && trail.points[0].life <= 0) trail.points.shift();
    trail.tipLife -= dt;
    if (trail.tipLife <= 0 && !trail.points.length) G.missileTrails.splice(i, 1);
  }
  for (let i = G.effects.length - 1; i >= 0; i--) {
    const f = G.effects[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.life -= dt;
    if (f.life <= 0) { G.effects.splice(i, 1); continue; }
    if (f.vel) {
      if (f.gravity) f.vel.y -= f.gravity * dt;
      const drag = f.type === 'spark' ? 0.94 : 0.985;
      f.vel.x *= drag; f.vel.z *= drag;
      if (f.type === 'smoke' || f.type === 'mist') f.vel.y *= 0.995;
      f.pos.x += f.vel.x * dt; f.pos.y += f.vel.y * dt; f.pos.z += f.vel.z * dt;
    }
    if (f.growth) f.size += f.growth * dt;
    if (f.type === 'flare') {
      f.smokeT -= dt;
      if (f.smokeT <= 0) { f.smokeT = 0.12; addSmoke(f.pos, rr(1, 2.4), 0.8, true); }
    }
    if (f.type === 'smoke' || f.type === 'mist') {
      const gh = G.map.heightAt(f.pos.x, f.pos.z);
      if (f.pos.y < gh + 1) { f.pos.y = gh + 1; f.vel.y = Math.abs(f.vel.y) * 0.2; }
    }
    if (f.type === 'ember' && f.pos.y < G.map.heightAt(f.pos.x, f.pos.z) + 0.5) { f.life = Math.min(f.life, 0.15); }
  }
  for (let i = G.tracers.length - 1; i >= 0; i--) {
    G.tracers[i].life -= dt;
    if (G.tracers[i].life <= 0) G.tracers.splice(i, 1);
  }
  for (let i = G.decals.length - 1; i >= 0; i--) {
    G.decals[i].life -= dt;
    if (G.decals[i].life <= 0) G.decals.splice(i, 1);
  }
  for (const p of G.popups) { p.t += dt; p.pos.y += dt * 6; }
  G.popups = G.popups.filter(p => p.t < p.life);
}

function updateVapor(dt) {
  for (let i = G.vapor.length - 1; i >= 0; i--) {
    const v = G.vapor[i];
    v.life -= dt;
    if (v.life <= 0) G.vapor.splice(i, 1);
  }
}

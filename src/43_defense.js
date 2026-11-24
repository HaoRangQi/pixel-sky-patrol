// Enemy aircraft and air-dropped vehicles for the lake defense stages.

const DEFENSE_AIRCRAFT = {
  drone: { hp: 72, radius: 7, pitchRate: .26,
    gunRange: 475, gunDamage: 3.6, gunRounds: 3, gunInterval: 1.45, missileInterval: 11, missileDamage: 26 },
  fighter: { hp: 130, radius: 8, pitchRate: .34,
    gunRange: 680, gunDamage: 5.8, gunRounds: 5, gunInterval: .95, missileInterval: 7, missileDamage: 35 },
  transport: { hp: 390, radius: 13, pitchRate: .20 },
};

const DEFENSE_PRESETS = {
  easy: { label: '轻松', counts: [1, 1, 2], chances: [.25, .40, .55], windows: { drone: 12, fighter: 9 }, waves: [4, 5, 6] },
  standard: { label: '标准', counts: [1, 2, 3], chances: [.45, .65, .75], windows: { drone: 8, fighter: 6 }, waves: [6, 8, 10] },
  hard: { label: '挑战', counts: [1, 2, 3], chances: [.60, .75, .85], windows: { drone: 6, fighter: 4.8 }, waves: [8, 10, 12] },
};

function defenseRules(preset = 'standard') {
  const row = DEFENSE_PRESETS[preset];
  return { preset, label: row.label, windows: { ...row.windows }, waves: [...row.waves],
    flares: Object.fromEntries(['drone', 'fighter', 'transport'].map((kind, i) => [kind, { count: row.counts[i], chance: row.chances[i] }])) };
}

// 敌我机动参数锁定：敌机速度与转弯半径都由玩家当前参数推导，不再写死绝对值。
// speed 是玩家当前巡航速度的倍率（65% 敌机速度档位下的数值），cap 是滑块拉高后的硬上限。
const DEFENSE_BALANCE = {
  speed: {
    drone: { cruise: .52, attack: .62, flee: .68 },
    fighter: { cruise: .64, attack: .76, flee: .80 },
    transport: { cruise: .58 },
  },
  cap: { cruise: .80, attack: .90, flee: .97, pursued: .95 },
  // 敌机转弯半径 = 玩家当前速度 / 当前转向速度 × 该倍数，因此玩家永远能切内圈。
  turnRadius: { drone: 1.55, fighter: 1.45, transport: 2.2 },
};

function defenseTargetSpeed(kind, mode, player, distance = Infinity) {
  const row = DEFENSE_BALANCE.speed[kind] ?? DEFENSE_BALANCE.speed.drone;
  const ratio = row[mode] ?? row.cruise;
  const cruise = Math.max(20, mode === 'pursued' ? player?.speed ?? SPEED_CRUISE : player?.cruiseSpeed ?? player?.targetSpeed ?? SPEED_CRUISE);
  const slider = (G.enemySpeedScale ?? 1) / .65;
  const cap = DEFENSE_BALANCE.cap[mode] ?? DEFENSE_BALANCE.cap.cruise;
  // 距离足够时仍可快速追近；近距将预计交会时间拉到四秒，留出辨认、瞄准和点射时间。
  const speed = mode === 'pursued' ? Math.max(cruise * ratio * slider, cruise - Math.max(0, distance - 180) / 4) : cruise * ratio * slider;
  return Math.max(18, Math.min(speed, cruise * cap));
}

function defensePlayerTurnRadius(player) {
  const speed = Math.max(20, player?.speed ?? player?.cruiseSpeed ?? SPEED_CRUISE);
  return speed / Math.max(.12, flightTurnLimit(player));
}

function defenseTurnRadius(enemy, player) {
  const factor = enemy.turnRadiusFactor ?? DEFENSE_BALANCE.turnRadius[enemy.kind] ?? 1.5;
  return Math.max(90, defensePlayerTurnRadius(player) * factor);
}

function defenseArrivalHeading(player, index) {
  const lane = [0, -.28, .33, -.61, .63][index % 5];
  return player.yaw + lane + rr(-.065, .065);
}

function initDefenseAircraft(enemy, profile) {
  const transport = enemy.kind === 'transport';
  if (!transport) {
    enemy.yaw = G.player.yaw;
    enemy.basis = basisFrom(enemy.yaw, enemy.pitch, enemy.roll);
  }
  enemy.maxHp = profile.hp;
  const countermeasure = G.defenseRules?.flares[enemy.kind];
  enemy.flares = enemy.maxFlares = countermeasure?.count ?? (transport ? 2 : 0);
  enemy.flareChance = countermeasure?.chance ?? 1;
  enemy.flareCd = 0;
  enemy.flareFlash = 0;
  enemy.flareOutcome = null;
  enemy.activeDecoy = null;
  enemy.tacticPhase = 'track'; enemy.pursuedTime = 0; enemy.tacticTime = 0;
  enemy.tacticSide = G.waveSpawned % 2 ? -1 : 1;
  enemy.cargoRemaining = transport ? 2 : 0;
  enemy.approach = 2.3;
  enemy.turnRadiusFactor = DEFENSE_BALANCE.turnRadius[enemy.kind] ?? 1.5;
  if (transport) {
    enemy.state = 'transport';
    enemy.flareCd = 0;
    enemy.cargoCd = 3;
    enemy.routeCd = 0;
    enemy.route = null;
    enemy.anchor = vmad(enemy.pos, enemy.basis.right, 660);
  }
}

function defenseGunPass(e, p) {
  if (e.kind === 'transport') return false;
  const delta = vsub(e.pos, p.pos), distance = vlen(delta);
  // 玩家已在尾后追入机炮区时，敌机沿航线脱离，不再反向迎着玩家撞过来。
  return distance < 1800 && vdot(delta, p.basis.fwd) > distance * .35 && vdot(delta, e.basis.fwd) > distance * .35;
}

function defenseFlightPoint(e, p, desired, dt, pursued = false) {
  e.flareCd = Math.max(0, e.flareCd - dt);
  e.flareFlash = Math.max(0, e.flareFlash - dt);
  if (e.kind !== 'transport') {
    const approach = e.approach > 0;
    e.approach = Math.max(0, e.approach - dt);
    const tactic = G.defenseRules && defenseTacticPoint(e, p, dt, pursued);
    if (tactic) return tactic;
    if (!pursued && !approach) return desired;
    return { x: e.pos.x + Math.sin(e.yaw) * 600, y: pursued ? e.pos.y : p.pos.y + 24, z: e.pos.z - Math.cos(e.yaw) * 600 };
  }
  if (G.mode === 'play' && !e.leaving && e.cargoRemaining > 0) {
    e.cargoCd = Math.max(0, e.cargoCd - dt);
    e.routeCd -= dt;
    if (!e.route && e.routeCd <= 0 && (e.cargoRemaining === 2 || e.cargoCd === 0)) {
      e.route = defenseDropSite(e);
      e.routeCd = 1.5;
    }
    if (e.route) return { x: e.route.x, y: e.route.y + 410, z: e.route.z };
  }
  const bearing = Math.atan2(e.pos.z - e.anchor.z, e.pos.x - e.anchor.x) + .26;
  return { x: e.anchor.x + Math.cos(bearing) * 660, y: e.anchor.y, z: e.anchor.z + Math.sin(bearing) * 660 };
}

function defenseTacticPoint(e, p, dt, pursued) {
  const distance = vdist(e.pos, p.pos);
  if (e.tacticPhase === 'track') {
    e.pursuedTime = pursued && distance < 900 ? e.pursuedTime + dt : Math.max(0, e.pursuedTime - dt);
    if (e.pursuedTime < G.defenseRules.windows[e.kind]) return null;
    e.tacticPhase = 'warning'; e.tacticTime = .9;
    e.tacticYaw = e.yaw;
  }
  e.tacticTime -= dt;
  if (e.tacticTime <= 0) {
    if (e.tacticPhase === 'warning') { e.tacticPhase = 'break'; e.tacticTime = 4; }
    else if (e.tacticPhase === 'break') { e.tacticPhase = 'reposition'; e.tacticTime = 10; }
    else { e.tacticPhase = 'track'; e.pursuedTime = 0; return null; }
  }
  if (e.tacticPhase === 'warning') return vmad(e.pos, e.basis.fwd, 600);
  if (e.tacticPhase === 'break') {
    const heading = e.tacticYaw + e.tacticSide * 1.15;
    return { x: e.pos.x + Math.sin(heading) * 650, y: e.pos.y + 45, z: e.pos.z - Math.cos(heading) * 650 };
  }
  e.state = 'engage'; e.aware = 4.2; e.energy = Math.max(e.energy, 30);
  // 重整点放在玩家前方，给有限转弯半径留出航路；追近侧后点会原地兜圈。
  return vmad(vmad(p.pos, p.basis.fwd, Math.max(600, p.speed * 3)), p.basis.right, -e.tacticSide * 100);
}

function defenseDrySite(x, z) {
  const y = G.map.heightAt(x, z);
  if (y < 5) return null;
  for (const [dx, dz] of [[-18, 0], [18, 0], [0, -18], [0, 18]]) {
    const h = G.map.heightAt(x + dx, z + dz);
    if (h < 5 || Math.abs(h - y) > 6) return null;
  }
  return { x, y, z };
}

function defenseDropSite(e) {
  // Search the immediate route first, then sweep farther for a bank where the vehicle can land.
  const turnRadius = defenseTurnRadius(e, G.player);
  for (const radius of [240, 420, 660, 950, 1320, 1680]) for (const side of [0, .35, -.35, .7, -.7, 1.1, -1.1, 1.65, -1.65, 2.25, -2.25, Math.PI]) {
    if (radius < 2 * turnRadius * Math.sin(Math.min(Math.abs(side), Math.PI / 2)) + 25) continue;
    const a = e.yaw + side;
    const site = defenseDrySite(e.pos.x + Math.sin(a) * radius, e.pos.z - Math.cos(a) * radius);
    if (!site || site.y > 510) continue;
    if (G.ground.some(g => !g.dead && hdist(g.airdrop?.site ?? g.pos, site) < 145)) continue;
    return site;
  }
  return null;
}

function defenseMaybeDrop(e) {
  if (G.mode !== 'play' || e.leaving || e.cargoRemaining <= 0) return;
  const site = e.route;
  if (!site || e.cargoCd > 0 || hdist(e.pos, site) > 150 || e.pos.y < site.y + 115) return;
  const origin = vmad(e.pos, e.basis.up, -4);
  if (!lineOfSightClear(origin, { ...site, y: site.y + 5 }, 10)) return;
  G.ground.push({
    kind: 'vehicle', type: 'vehicle', isGround: true, dead: false, pos: origin, yaw: e.yaw,
    hp: 82, maxHp: 82, radius: 6, flashT: 0, fireCd: 1.5,
    patrolYaw: e.yaw, airdrop: { origin: vcopy(origin), site, elapsed: 0, duration: (origin.y - site.y) / 44 },
  });
  e.cargoRemaining--;
  e.cargoCd = 4.8;
  e.route = null;
  e.routeCd = 0;
}

function defenseVehicleStep(g, p, dt) {
  if (g.airdrop) {
    const a = g.airdrop;
    a.elapsed += dt;
    const fraction = clamp01(a.elapsed / a.duration);
    g.pos = vlerp(a.origin, a.site, fraction);
    if (fraction >= 1) g.airdrop = null;
    return;
  }
  if (G.mode !== 'play' || !p || p.dead) return;
  const distance = vdist(g.pos, p.pos);
  g.yaw = angleLerp(g.yaw, distance < 840 ? Math.atan2(p.pos.x - g.pos.x, g.pos.z - p.pos.z) : g.patrolYaw, 1 - Math.exp(-2 * dt));
  const x = g.pos.x + Math.sin(g.patrolYaw) * 13 * dt, z = g.pos.z - Math.cos(g.patrolYaw) * 13 * dt;
  const next = defenseDrySite(x, z);
  if (next) g.pos = next;
  else g.patrolYaw = wrapAngle(g.patrolYaw + (Math.PI / 2) * dt);
  g.fireCd -= dt;
  g.flashT = Math.max(0, g.flashT - dt);
  const origin = { x: g.pos.x + Math.sin(g.yaw) * 2, y: g.pos.y + 3.5, z: g.pos.z - Math.cos(g.yaw) * 2 };
  if (distance > 840 || g.fireCd > 0 || !lineOfSightClear(origin, p.pos, 12)) return;
  const toPlayer = vsub(p.pos, origin), horizontal = Math.hypot(toPlayer.x, toPlayer.z);
  if (horizontal < 1 || Math.abs(wrapAngle(Math.atan2(toPlayer.x, -toPlayer.z) - g.yaw)) > .45) return;
  g.fireCd = rr(2.35, 2.55);
  g.flashT = .2;
  const travel = Math.min(1.5, distance / 590);
  const lead = vmad(p.pos, p.basis.fwd, p.speed * travel);
  const spread = 2 + distance * .027;
  const side = rr(-spread, spread) / horizontal;
  lead.x -= toPlayer.z * side;
  lead.z += toPlayer.x * side;
  lead.y += GUN_BULLET_GRAVITY * travel * travel * .5 + rr(-spread, spread) * .65;
  const bullet = spawnGunBullet(origin, vmul(vnorm(vsub(lead, origin)), 590), 'enemy', 5.5, '#ffc476');
  bullet.source = g;
  spawnBurst(origin, 2, '#ffd18a', 6, .18);
  if (distance < 580) AudioSys.gunshot(clamp(1 - distance / 700, .1, .7));
}

function defenseDivertMissile(m) {
  const carrier = m.target;
  if (!DEFENSE_AIRCRAFT[carrier?.kind] || carrier.dead || m.countermeasureTarget === carrier) return;
  const configured = !!G.defenseRules;
  if (!configured && carrier.kind !== 'transport') return;
  const incoming = vsub(carrier.pos, m.pos), range = vlen(incoming);
  if (range > 410 || vdot(incoming, m.vel) <= 0) return;
  if (configured && carrier.activeDecoy?.life > 0 && G.time < carrier.decoyUntil) {
    m.countermeasureTarget = carrier;
    if (carrier.flareOutcome === 'success') m.target = carrier.activeDecoy;
    return;
  }
  if (carrier.flares <= 0 || carrier.flareCd > 0) return;
  m.countermeasureTarget = carrier;
  const side = vdot(vsub(m.pos, carrier.pos), carrier.basis.right) < 0 ? -1 : 1;
  const point = vmad(vmad(carrier.pos, carrier.basis.right, side * 32), carrier.basis.up, -14);
  const velocity = vmad(vmul(carrier.basis.fwd, carrier.speed * .35), carrier.basis.right, side * 36);
  carrier.flares--;
  carrier.flareCd = 3.1;
  carrier.flareFlash = 1.3;
  const flare = spawnFlare(point, velocity);
  flare.defenseDecoy = true;
  const success = !configured || rng() < carrier.flareChance;
  carrier.activeDecoy = flare; carrier.decoyUntil = G.time + .65;
  carrier.flareOutcome = success ? 'success' : 'failed';
  if (success) m.target = flare;
  spawnBurst(carrier.pos, 3, '#ffcf85', 24, .26);
}

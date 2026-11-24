// ---------------------------------------------------------------------------
// AI — 本地僚机与可选的大模型高层指令。
// 默认全部关闭：G.wingmanWanted === false 时没有任何僚机、请求或额外随机消耗。
// ---------------------------------------------------------------------------

const WINGMAN = {
  orbitRadius: 180,
  orbitHeight: 26,
  radius: 7,
  minPlayerGap: 40,
  minEnemyGap: 70,
  gunRange: 600,
  gunDamage: 4,
  gunInterval: 0.42,
  coverRange: 1500,
  targetRange: 1800,
  maxPlayerGap: 2200,
  maxShield: 80,
  ammo: 36,
  serviceSeconds: 18,
  bulletBudget: 220,
  commandTtl: 12,
};

const AI_INTENTS = ['attack_player_target', 'cover_player', 'regroup', 'hold_fire'];
const AI_AGGRESSION = ['low', 'normal', 'high'];
const AI_STATUS_TEXT = {
  off: '关闭', unconfigured: '待配置', idle: '待命', requesting: '请求中',
  ok: '已连接', timeout: '连接超时', http_error: '连接失败',
  invalid_response: '响应无效', aborted: '已取消', unsupported: '浏览器不支持', error: '连接失败',
};
let wingmanReserve = null;

// 僚机使用自己的随机序列，避免开启后改变敌机生成与既有回放。
function wingmanRandom(w) {
  let t = w.rngState = (w.rngState + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function wingmanSpawn() {
  if (!G.player || G.player.dead) return null;
  if (G.allies.length) return G.allies[0];
  if (G.mode !== 'play' && G.mode !== 'waveclear' && G.mode !== 'paused') return null;
  if (wingmanReserve) { G.allies.push(wingmanReserve); return wingmanReserve; }
  const p = G.player, b = basisFrom(p.yaw, 0, 0);
  if (!b) return null;
  const pos = vmad(vmad(p.pos, b.right, WINGMAN.orbitRadius), { x: 0, y: 1, z: 0 }, WINGMAN.orbitHeight);
  if (G.map) pos.y = Math.max(pos.y, G.map.heightAt(pos.x, pos.z) + 70);
  const w = {
    kind: 'wingman', team: 'ally', radius: WINGMAN.radius,
    pos, yaw: p.yaw, pitch: 0, roll: 0, speed: p.speed + Math.min(42, p.speed * .55),
    basis: null, renderBasis: null, turnRadius: 140,
    state: 'follow', target: null, targetTimer: 0, los: false, losTimer: 0, fireCd: 0,
    shield: WINGMAN.maxShield, ammo: WINGMAN.ammo, serviceT: 0, lastHit: -99, dead: false,
    attackT: 0, breakT: 0,
    command: null, rngState: (G.seed * 2654435761 + 0x9e3779b9) | 0,
  };
  w.basis = w.renderBasis = basisFrom(w.yaw, w.pitch, w.roll);
  G.allies.push(w);
  wingmanReserve = w;
  trace('wingmanSpawn', `${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}`);
  return w;
}

function wingmanClear(reason = 'cleared') {
  const had = G.allies.length;
  WingmanAdvisor.clearCommand(reason);
  G.allies.length = 0;
  if (reason !== 'disabled') wingmanReserve = null;
  if (G.bullets.some(b => b.owner === 'ally')) G.bullets = G.bullets.filter(b => b.owner !== 'ally');
  if (had) trace('wingmanClear', reason);
}

function damageWingman(amount) {
  const w = G.allies[0];
  if (!w || w.dead) return;
  w.shield = Math.max(0, w.shield - amount); w.lastHit = G.time;
  spawnSparks(w.pos, 3, '#bff3d7');
  if (w.shield === 0) {
    w.dead = true; w.state = 'dead'; w.target = null;
    WingmanAdvisor.endRun();
    spawnExplosion(w.pos, 1, 'air');
  }
}

function wingmanService(w, dt) {
  if (w.state !== 'resupply' && (w.ammo <= 0 || w.shield <= 20)) {
    w.state = 'resupply'; w.serviceT = WINGMAN.serviceSeconds;
  }
  if (w.state !== 'resupply') return false;
  w.target = null;
  w.serviceT = Math.max(0, w.serviceT - dt);
  if (w.serviceT <= 1e-6 && G.time - w.lastHit >= 6) {
    w.ammo = WINGMAN.ammo; w.shield = WINGMAN.maxShield; w.state = 'patrol'; w.serviceT = 0;
    return false;
  }
  return true;
}

function wingmanStatusText(w = G.allies[0]) {
  if (!w) return '';
  if (w.dead) return '僚机 已损毁 · 下次出航归队';
  const state = { follow: '归队', patrol: '环绕伴飞', engage: '截击', break: '脱离', resupply: '补给' }[w.state] || '待命';
  const supply = w.state === 'resupply' ? `补给 ${Math.ceil(w.serviceT)}秒` : `弹 ${w.ammo}/${WINGMAN.ammo}`;
  return `僚机 ${state} · 盾 ${Math.ceil(w.shield)}/${WINGMAN.maxShield}\n${supply}`;
}

function wingmanOnRunStart() {
  wingmanClear('restart');
  WingmanAdvisor.beginRun();
  if (G.wingmanWanted) wingmanSpawn();
}

function wingmanOnStop(reason = 'stop') {
  wingmanClear(reason);
  WingmanAdvisor.endRun();
}

function wingmanSetCommand(command, source = 'llm', ttl = WINGMAN.commandTtl) {
  const w = G.allies[0];
  if (!w || !command || !AI_INTENTS.includes(command.intent)) return false;
  const aggression = AI_AGGRESSION.includes(command.aggression) ? command.aggression : 'normal';
  w.command = {
    intent: command.intent, aggression, source,
    issuedAt: G.time, expiresAt: G.time + Math.max(1, ttl),
  };
  trace('wingmanCommand', `${command.intent}/${aggression}/${source}`);
  return true;
}

function wingmanClearCommand(source) {
  const w = G.allies[0];
  if (!w || !w.command) return;
  if (!source || w.command.source === source) w.command = null;
}

function wingmanEffectiveIntent(w = G.allies[0]) {
  if (w?.command && G.time < w.command.expiresAt) {
    return { intent: w.command.intent, aggression: w.command.aggression, source: w.command.source };
  }
  const lock = G.lock?.target;
  if (lock && !lock.dead && lock !== w && vdist(lock.pos, G.player.pos) <= WINGMAN.targetRange) return { intent: 'attack_player_target', aggression: 'normal', source: 'local' };
  const near = G.enemies.some(e => !e.dead && !e.leaving && G.player && vdist(e.pos, G.player.pos) <= WINGMAN.coverRange);
  if (near) return { intent: 'cover_player', aggression: 'normal', source: 'local' };
  return { intent: 'regroup', aggression: 'normal', source: 'local' };
}

function wingmanAimPoint(target, w) {
  const point = targetAimPoint(target) || target.pos;
  const travel = clamp(vdist(w.pos, point) / GUN_BULLET_SPEED, 0, 1.4);
  const fwd = target.basis?.fwd;
  return fwd ? vadd(point, vmul(fwd, (target.speed || 0) * travel)) : vcopy(point);
}

function wingmanPickTarget(w, intent) {
  if (intent.intent === 'regroup' || intent.intent === 'hold_fire' || vdist(w.pos, G.player.pos) > WINGMAN.maxPlayerGap) return null;
  const lock = G.lock.target;
  if (intent.intent === 'attack_player_target' && lock && !lock.dead && vdist(lock.pos, G.player.pos) <= WINGMAN.targetRange) return lock;
  let best = null, bestScore = Infinity;
  for (const e of G.enemies) {
    if (e.dead || e.leaving || e.team === 'ally') continue;
    const nearPlayer = vdist(e.pos, G.player.pos);
    if (nearPlayer > WINGMAN.coverRange) continue;
    const nearWing = vdist(e.pos, w.pos);
    const score = intent.intent === 'cover_player' ? nearPlayer + nearWing * .25 : nearWing + nearPlayer * .35;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

function wingmanAvoid(w, desired) {
  const out = { x: desired.x, y: desired.y, z: desired.z };
  if (G.map) {
    const aheadX = w.pos.x + Math.sin(w.yaw) * 260, aheadZ = w.pos.z - Math.cos(w.yaw) * 260;
    const ahead = G.map.heightAt(aheadX, aheadZ) + 90;
    if (out.y < ahead) out.y = ahead + 20;
    out.y = Math.max(out.y, G.map.heightAt(w.pos.x, w.pos.z) + 70);
  }
  const awayFromPlayer = vsub(w.pos, G.player.pos), playerGap = vlen(awayFromPlayer);
  if (playerGap > 0 && playerGap < WINGMAN.minPlayerGap) {
    const push = vmul(vnorm(awayFromPlayer), (WINGMAN.minPlayerGap - playerGap) * 1.2);
    out.x += push.x; out.y += push.y; out.z += push.z;
  }
  for (const e of G.enemies) {
    if (e.dead) continue;
    const away = vsub(w.pos, e.pos), gap = vlen(away);
    if (gap > 0 && gap < WINGMAN.minEnemyGap) {
      const push = vmul(vnorm(away), (WINGMAN.minEnemyGap - gap) * .9);
      out.x += push.x; out.y += push.y; out.z += push.z;
    }
  }
  return out;
}

function wingmanEngageSpeed(p, aggression, distance) {
  const ceiling = Math.max(p.cruiseSpeed ?? SPEED_CRUISE, p.burnSpeed ?? p.speed ?? SPEED_CRUISE);
  const base = aggression === 'low' ? p.speed * .92 : aggression === 'high' ? Math.max(p.speed, p.cruiseSpeed ?? p.speed) * 1.06 : Math.max(p.speed, (p.cruiseSpeed ?? p.speed) * 1.02);
  return clamp(base + (distance > 700 ? 18 : 0), 30, ceiling);
}

function wingmanTryFire(w, intent) {
  const target = w.target;
  if (!target || target.dead || w.dead || w.ammo <= 0 || w.state === 'resupply' || w.fireCd > 0 || G.bullets.length > WINGMAN.bulletBudget) return;
  const aim = wingmanAimPoint(target, w);
  const distance = vdist(w.pos, aim);
  if (distance > WINGMAN.gunRange) return;
  const dir = vnorm(vsub(aim, w.pos));
  if (vdot(dir, w.basis.fwd) < Math.cos(.12)) return;
  if (w.losTimer <= 0) { w.losTimer = .2; w.los = lineOfSightClear(w.pos, aim, 9); }
  if (!w.los) return;
  const cadence = intent.aggression === 'high' ? .34 : intent.aggression === 'low' ? .56 : WINGMAN.gunInterval;
  w.fireCd = cadence + wingmanRandom(w) * .03;
  w.ammo--;
  const origin = vadd(vadd(w.pos, vmul(w.basis.fwd, 5)), vmul(w.basis.up, -.5));
  const speed = GUN_BULLET_SPEED + w.speed;
  const bullet = spawnGunBullet(origin, vmul(dir, speed), 'ally', WINGMAN.gunDamage, '#a9f0d0');
  bullet.flatTime = WINGMAN.gunRange / speed;
  spawnBurst(origin, 2, '#bff3d7', 2, .05);
}

function wingmanSector(player, point) {
  const dx = point.x - player.pos.x, dz = point.z - player.pos.z;
  const angle = wrapAngle(Math.atan2(dx, -dz) - player.yaw);
  if (Math.abs(angle) < Math.PI / 6) return 'front';
  if (Math.abs(angle) > Math.PI * 5 / 6) return 'rear';
  return angle > 0 ? 'right' : 'left';
}

function wingmanRange(distance) { return distance < 400 ? 'near' : distance < 1200 ? 'mid' : 'far'; }

function wingmanOrbitVelocity(w, p, servicing) {
  const dx = w.pos.x - p.pos.x, dz = w.pos.z - p.pos.z, radius = Math.hypot(dx, dz) || 1;
  const radial = { x: dx / radius, y: 0, z: dz / radius };
  const tangent = { x: radial.z, y: 0, z: -radial.x };
  const ring = servicing ? 320 : WINGMAN.orbitRadius;
  const correction = clamp((ring - radius) * .55, -100 - p.speed * .5, 100 + p.speed * .5);
  const velocity = vadd(vmul(p.basis.fwd, p.speed), vadd(vmul(tangent, Math.min(42, p.speed * .55)), vmul(radial, correction)));
  velocity.y += clamp((p.pos.y + (servicing ? 60 : WINGMAN.orbitHeight) - w.pos.y) * .7, -60, 60);
  return velocity;
}

function wingmanAdvisorContext(w) {
  const p = G.player, lock = G.lock.target;
  return {
    wave: G.wave,
    player: { shield: p.shield > 70 ? 'high' : p.shield > 35 ? 'mid' : 'low', fuel: p.fuel > 50 ? 'normal' : 'low' },
    playerTarget: lock && !lock.dead ? {
      kind: lock.kind || lock.type || 'ground',
      sector: wingmanSector(p, lock.pos),
      range: wingmanRange(vdist(p.pos, lock.pos)),
    } : null,
    threats: {
      missiles: G.threatList.length > 0,
      enemiesNear: G.enemies.filter(e => !e.dead && !e.leaving && vdist(e.pos, p.pos) <= WINGMAN.coverRange).length,
    },
    wingman: { state: w.state, distance: wingmanRange(vdist(w.pos, p.pos)), shield: w.shield > 20 ? 'normal' : 'low', ammo: w.ammo > 8 ? 'normal' : 'low' },
    currentIntent: wingmanEffectiveIntent(w).intent,
  };
}

function updateWingman(dt) {
  const w = G.allies[0], p = G.player;
  if (!w || !p || p.dead || w.dead) return;
  w.fireCd = Math.max(0, w.fireCd - dt);
  w.breakT = Math.max(0, w.breakT - dt);
  w.targetTimer -= dt;
  w.losTimer -= dt;
  if (w.command && G.time >= w.command.expiresAt) w.command = null;
  const intent = wingmanEffectiveIntent(w);
  const servicing = wingmanService(w, dt), gap = vdist(w.pos, p.pos);
  if (w.target && (w.target.dead || w.target.leaving)) w.target = null;
  if (w.targetTimer <= 0 && !servicing && w.breakT === 0) {
    w.targetTimer = .3;
    w.target = wingmanPickTarget(w, intent);
  }
  if (servicing || gap > WINGMAN.maxPlayerGap) w.target = null;
  w.attackT = w.target && vdist(w.pos, w.target.pos) <= WINGMAN.gunRange ? w.attackT + dt : 0;
  if (w.target && (w.attackT >= 6 || vdist(w.pos, w.target.pos) < 140)) {
    w.target = null; w.attackT = 0; w.breakT = 3; w.targetTimer = 3;
  }
  const orbit = wingmanOrbitVelocity(w, p, servicing);
  let desired = vmad(w.pos, orbit, 1.5), speedTarget = Math.max(10, vlen(orbit));
  if (servicing) {
    w.state = 'resupply';
  } else if (w.breakT > 0) {
    desired = vmad(vmad(vmad(w.pos, w.basis.fwd, 650), w.basis.right, 220), w.basis.up, 40);
    w.state = 'break';
  } else if (w.target && intent.intent !== 'regroup' && intent.intent !== 'hold_fire') {
    const distance = vdist(w.pos, w.target.pos);
    desired = wingmanAimPoint(w.target, w);
    speedTarget = wingmanEngageSpeed(p, intent.aggression, distance);
    w.state = 'engage';
  } else {
    w.state = gap > WINGMAN.maxPlayerGap || intent.intent === 'regroup' && G.enemies.length ? 'follow' : 'patrol';
  }
  desired = wingmanAvoid(w, desired);
  w.turnRadius = Math.max(80, defensePlayerTurnRadius(p) * .95);
  steerDrone(w, desired, dt, true, null);
  w.speed = damp(w.speed, speedTarget, 1.4, dt);
  w.pos = vadd(w.pos, vmul(w.basis.fwd, w.speed * dt));
  if (G.map) {
    const floor = G.map.heightAt(w.pos.x, w.pos.z) + 70;
    if (w.pos.y < floor) w.pos.y = floor;
  }
  w.renderBasis = w.basis;
  if (G.mode === 'play' && w.state === 'engage' && w.target && intent.intent !== 'hold_fire') wingmanTryFire(w, intent);
  WingmanAdvisor.maybeRequest({
    active: G.mode === 'play' && !G.player.dead && !servicing,
    hasWingman: G.allies.length > 0,
    inCombat: G.enemies.some(e => !e.dead),
    context: () => wingmanAdvisorContext(w),
    onCommand: command => wingmanSetCommand(command, 'llm', WINGMAN.commandTtl),
    onFailure: () => wingmanClearCommand('llm'),
  });
}

// ---- 大模型高层指令客户端 ------------------------------------------------
// 只产出 intent/aggression 枚举；飞行、瞄准、开火始终由本地僚机完成。
const WingmanAdvisor = {
  config: { enabled: false, endpoint: '', model: '', getKey: null },
  fetchImpl: null,
  runtime: {
    epoch: 0, seq: 0, inflight: null, lastRequestAt: -Infinity, failureUntil: -Infinity,
    status: 'off', requests: 0, lastSignature: '', lastSignatureAt: -Infinity,
  },
  now() {
    return typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now();
  },
  configure(options = {}) {
    if (typeof options.enabled === 'boolean') this.config.enabled = options.enabled;
    if (typeof options.endpoint === 'string') this.config.endpoint = options.endpoint;
    if (typeof options.model === 'string') this.config.model = options.model;
    if (typeof options.getKey === 'function') this.config.getKey = options.getKey;
    if (options.fetchImpl !== undefined) this.fetchImpl = options.fetchImpl;
    if (!this.config.enabled) this.setStatus('off');
    else if (!aiNormalizeEndpoint(this.config.endpoint) || !this.config.model.trim()) this.setStatus('unconfigured');
    else if (this.runtime.status === 'off' || this.runtime.status === 'unconfigured') this.setStatus('idle');
  },
  setStatus(status) {
    this.runtime.status = status;
    const output = typeof document !== 'undefined' && document?.getElementById?.('sky-ai-status');
    if (output) {
      const testText = typeof skyAiUi !== 'undefined' ? skyAiUi.testText : '';
      const text = AI_STATUS_TEXT[status] || AI_STATUS_TEXT.error;
      const next = typeof skyAiUi !== 'undefined' && skyAiUi.testing ? '连接中…' : (testText && status !== 'requesting' ? testText : text);
      if (output.textContent !== next) output.textContent = next;
    }
  },
  cancel(reason = 'cancelled') {
    this.runtime.epoch++;
    this.runtime.seq++;
    const inflight = this.runtime.inflight;
    this.runtime.inflight = null;
    if (inflight) {
      try { inflight.controller.abort(); } catch (error) {}
    }
    if (reason !== 'silent') this.setStatus('aborted');
  },
  beginRun() {
    this.cancel('silent');
    this.runtime.seq = 0;
    this.runtime.lastRequestAt = -Infinity;
    this.runtime.failureUntil = -Infinity;
    this.runtime.lastSignature = '';
    this.runtime.lastSignatureAt = -Infinity;
    this.runtime.requests = 0;
    this.setStatus(this.config.enabled ? (aiNormalizeEndpoint(this.config.endpoint) && this.config.model.trim() ? 'idle' : 'unconfigured') : 'off');
  },
  endRun() {
    this.cancel('silent');
    wingmanClearCommand('llm');
    this.setStatus(this.config.enabled ? 'idle' : 'off');
  },
  syncMode(mode) {
    if (mode !== 'play') {
      if (this.runtime.inflight) this.cancel('mode');
      wingmanClearCommand('llm');
      if (mode === 'paused' && this.config.enabled) this.setStatus('idle');
    }
  },
  clearCommand() { wingmanClearCommand('llm'); },
  requestKey() {
    try { return (this.config.getKey?.() || '').trim(); } catch (error) { return ''; }
  },
  maybeRequest(ctx) {
    if (!this.config.enabled) return false;
    if (!ctx?.active || !ctx.hasWingman || !ctx.inCombat) return false;
    const now = this.now();
    if (this.runtime.inflight || now < this.runtime.failureUntil) return false;
    if (now - this.runtime.lastRequestAt < 6000) return false;
    const endpoint = aiNormalizeEndpoint(this.config.endpoint);
    const key = this.requestKey();
    if (!endpoint || !this.config.model.trim() || !key) {
      this.setStatus('unconfigured');
      return false;
    }
    const context = typeof ctx.context === 'function' ? ctx.context() : ctx.context;
    const signature = JSON.stringify(context);
    if (signature === this.runtime.lastSignature && now - this.runtime.lastSignatureAt < 12000) return false;
    const epoch = this.runtime.epoch, seq = ++this.runtime.seq;
    this.runtime.lastRequestAt = now;
    this.runtime.lastSignature = signature;
    this.runtime.lastSignatureAt = now;
    this.runtime.requests++;
    this.setStatus('requesting');
    const controller = aiAbortController();
    this.runtime.inflight = { controller, epoch, seq, startedAt: now };
    const messages = [
      { role: 'system', content: '你是《天际巡航》僚机的高层战术顾问。只输出一个 JSON 对象，不要 markdown、不要解释。字段 intent 只能是 attack_player_target、cover_player、regroup、hold_fire；aggression 只能是 low、normal、high。不得输出坐标、代码或额外字段。' },
      { role: 'user', content: JSON.stringify(context) },
    ];
    aiRequestOnce({ endpoint, model: this.config.model.trim(), key, messages, timeoutMs: 8000, fetchImpl: this.fetchImpl, controller }).then(result => {
      const live = this.runtime.inflight;
      if (!live || live.epoch !== epoch || live.seq !== seq) return;
      this.runtime.inflight = null;
      if (result.ok && result.command && ctx.onCommand(result.command)) {
        this.setStatus('ok');
      } else {
        if (result.ok) this.setStatus('invalid_response');
        else this.setStatus(result.status);
        this.runtime.failureUntil = this.now() + 15000;
        try { ctx.onFailure?.(); } catch (error) {}
      }
    });
    return true;
  },
  async testConnection(options = {}) {
    const endpoint = aiNormalizeEndpoint(options.endpoint ?? this.config.endpoint);
    const model = String(options.model ?? this.config.model ?? '').trim();
    const key = String(options.key ?? '').trim();
    if (!endpoint || !model || !key) return { ok: false, status: 'unconfigured' };
    const messages = [
      { role: 'system', content: '只输出 JSON：{"intent":"regroup","aggression":"normal"}' },
      { role: 'user', content: '{"probe":true}' },
    ];
    const result = await aiRequestOnce({ endpoint, model, key, messages, timeoutMs: 8000, fetchImpl: this.fetchImpl });
    return { ok: !!result.ok, status: result.ok ? 'ok' : result.status };
  },
  snapshot() {
    return {
      enabled: !!this.config.enabled,
      status: this.runtime.status,
      requests: this.runtime.requests,
      inflight: !!this.runtime.inflight,
      endpointConfigured: !!aiNormalizeEndpoint(this.config.endpoint),
      modelConfigured: !!this.config.model.trim(),
    };
  },
};

function aiAbortController() {
  return typeof AbortController !== 'undefined' ? new AbortController() : { signal: null, abort() {} };
}

function aiNormalizeEndpoint(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  let url;
  try { url = new URL(text); } catch (error) { return null; }
  if (url.username || url.password) return null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (!url.pathname.endsWith('/chat/completions')) url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
  return url.toString();
}

function aiParseContent(text) {
  const body = String(text || '').trim();
  if (!body) return null;
  const unfenced = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = unfenced.indexOf('{'), end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(unfenced.slice(start, end + 1)); } catch (error) { return null; }
  if (!parsed || !AI_INTENTS.includes(parsed.intent)) return null;
  const aggression = AI_AGGRESSION.includes(parsed.aggression) ? parsed.aggression : 'normal';
  return { intent: parsed.intent, aggression };
}

function aiReadMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  return '';
}

async function aiRequestOnce({ endpoint, model, key, messages, timeoutMs = 8000, fetchImpl = null, controller = aiAbortController() }) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, status: 'unsupported' };
  let timedOut = false;
  const timer = typeof setTimeout === 'function' ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  try {
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 120, stream: false }),
      signal: controller.signal,
      mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!response || !response.ok) return { ok: false, status: 'http_error' };
    const text = await response.text();
    if (typeof text !== 'string' || text.length > 65536) return { ok: false, status: 'invalid_response' };
    let payload;
    try { payload = JSON.parse(text); } catch (error) { return { ok: false, status: 'invalid_response' }; }
    const command = aiParseContent(aiReadMessageContent(payload));
    return command ? { ok: true, status: 'ok', command } : { ok: false, status: 'invalid_response' };
  } catch (error) {
    return { ok: false, status: timedOut ? 'timeout' : controller.signal?.aborted ? 'aborted' : 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

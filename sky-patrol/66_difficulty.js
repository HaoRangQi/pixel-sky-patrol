// 战斗难度设置：独立持有可选预设与逐兵种反制配置，出航时快照给战斗层。
const SKY_DIFFICULTY_KINDS = [
  ['drone', '无人机'], ['fighter', '战斗机'], ['transport', '运输机'],
];
const skyDifficulty = {
  preset: 'standard', custom: false,
  flares: Object.fromEntries(Object.entries(defenseRules('standard').flares).map(([kind, row]) => [kind, { ...row }])),
};
function skyDifficultyPresetRow() { return defenseRules(skyDifficulty.preset); }
function skyDifficultySelectPreset(value) {
  if (G.mode !== 'paused') return;
  if (value === 'custom') {
    skyDifficulty.custom = true;
    skySync();
    return;
  }
  if (!DEFENSE_PRESETS[value]) return;
  skyDifficulty.preset = value; skyDifficulty.custom = false;
  skyDifficulty.flares = Object.fromEntries(Object.entries(defenseRules(value).flares).map(([kind, row]) => [kind, { ...row }]));
  skySync();
}
function skyDifficultyAdjustFlare(kind, field, value) {
  if (G.mode !== 'paused' || !skyDifficulty.flares[kind] || !Number.isFinite(Number(value))) return;
  const next = clamp(Math.round(Number(value)), 0, field === 'count' ? 5 : 100);
  skyDifficulty.flares[kind][field] = field === 'chance' ? next / 100 : next;
  skyDifficulty.custom = true;
  skySync();
}
function skyDifficultySnapshot() {
  const rules = defenseRules(skyDifficulty.preset);
  for (const [kind, row] of Object.entries(skyDifficulty.flares)) rules.flares[kind] = { ...row };
  rules.label = skyDifficulty.custom ? `自定义 · ${rules.label}` : rules.label;
  rules.custom = skyDifficulty.custom;
  return rules;
}
function skyPrepareDifficultyRun() { G.defenseRules = skyDifficultySnapshot(); }
function skyDifficultyStageAir(n, count) {
  const make = (pattern, fill) => Array.from({ length: count }, (_, i) => pattern[i] ?? fill);
  if (n === 1) return make([], 'drone');
  if (n === 2) return make([], 'fighter');
  if (n === 3) return make(['transport', 'fighter', 'drone', 'fighter', 'drone', 'fighter', 'fighter', 'drone', 'fighter', 'drone', 'fighter', 'drone'], 'fighter');
  return make([], n % 2 ? 'drone' : 'fighter');
}
function skyDifficultySync() {
  const enabled = BOOT.ready && !BOOT.error && G.mode === 'paused';
  const select = skyGet('sky-difficulty');
  if (!select) return;
  select.disabled = !enabled;
  const value = skyDifficulty.custom ? 'custom' : skyDifficulty.preset;
  if (select.value !== value) select.value = value;
  for (const [kind] of SKY_DIFFICULTY_KINDS) {
    const row = skyDifficulty.flares[kind];
    const count = skyGet(`sky-flare-${kind}`), chance = skyGet(`sky-flare-chance-${kind}`);
    if (count) {
      count.disabled = !enabled; if (count.value !== String(row.count)) count.value = String(row.count);
      skyAttribute(count, 'aria-valuetext', `${row.count} 发`);
    }
    if (chance) {
      chance.disabled = !enabled; const percent = Math.round(row.chance * 100);
      if (chance.value !== String(percent)) chance.value = String(percent);
      skyAttribute(chance, 'aria-valuetext', `${percent}%`);
    }
    skyText(`sky-flare-${kind}-value`, `${row.count} 发 · ${Math.round(row.chance * 100)}%`);
  }
  const preset = DEFENSE_PRESETS[skyDifficulty.preset];
  const label = skyDifficulty.custom ? `自定义 · ${preset.label}节奏` : preset.label;
  skyText('sky-difficulty-summary', `${label} · 每关 ${preset.waves.join('/')} 架 · 改动下次出航生效`);
  skyAttribute(select, 'aria-valuetext', `${label}难度`);
}
const skyDifficultyBaseSync = skySync;
skySync = function () { skyDifficultyBaseSync(); skyDifficultySync(); };
for (const [kind] of SKY_DIFFICULTY_KINDS) {
  skyGet(`sky-flare-${kind}`)?.addEventListener('input', e => skyDifficultyAdjustFlare(kind, 'count', e.target.value));
  skyGet(`sky-flare-chance-${kind}`)?.addEventListener('input', e => skyDifficultyAdjustFlare(kind, 'chance', e.target.value));
}
skyGet('sky-difficulty')?.addEventListener('change', e => skyDifficultySelectPreset(e.target.value));
skyDifficultySync();

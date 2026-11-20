if (!__PI.ready()) return { ready: false };
const r = __PI.simulate(330);
return {
  seconds: r.seconds,
  steps: r.steps,
  errors: r.errors,
  errorsPage: r.errorsPage,
  kills: r.kills,
  shots: r.shots,
  hits: r.hits,
  maxWave: r.maxWave,
  deaths: r.deaths,
  restarts: r.restarts,
  minEnemyClearance: r.minEnemyClearance,
  maxEnemyStuck: r.maxEnemyStuck,
  minPlayerAgl: r.minPlayerAgl,
  maxEnemiesAirborne: r.maxEnemiesAirborne,
  nan: r.nan,
  endMode: r.endMode,
  waveTimes: r.waveTimes.slice(0, 8),
};

if (!__PI.ready()) return { ready: false };
const r = __PI.simulate(24);
return {
  errors: r.errors,
  errorsPage: r.errorsPage,
  kills: r.kills,
  shots: r.shots,
  hits: r.hits,
  missilesLeft: r.missiles,
  minEnemyClearance: r.minEnemyClearance,
  maxEnemyStuck: r.maxEnemyStuck,
  endMode: r.endMode,
};
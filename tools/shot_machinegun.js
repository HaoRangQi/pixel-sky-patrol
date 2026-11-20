if (!__PI.ready()) throw new Error('游戏未加载完成');
__PI.start('cockpit');
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const G = __PI.G, p = G.player, e = G.enemies[0], f = p.basis.fwd;
e.pos = { x: p.pos.x + f.x * 420, y: p.pos.y + f.y * 420, z: p.pos.z + f.z * 420 };
e.hp = 52;
__PI.freeze(true);
const fire = new MouseEvent('mousedown', {
  bubbles: true, button: 0, clientX: window.innerWidth / 2, clientY: window.innerHeight * 0.52,
});
window.dispatchEvent(fire);
if (e.hp >= 52 || G.stats.shots !== 1) throw new Error(`机炮射击失败：hp=${e.hp} shots=${G.stats.shots}`);
window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
return { enemyHp: e.hp, machineGunShots: G.stats.shots, missileAmmo: p.missiles };

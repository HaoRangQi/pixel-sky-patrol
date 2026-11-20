if (!__PI.ready()) return { ready: false };
const G = __PI.G;
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));

__PI.start('chase');
const y0 = G.player.yaw, p0 = G.player.pitch;
key('KeyD', true); __PI.step(0.5);
const yD = G.player.yaw, rollD = G.player.roll;
key('KeyD', false);
key('KeyA', true); __PI.step(0.5);
const yA = G.player.yaw;
key('KeyA', false);
key('KeyW', true); __PI.step(0.5);
const pW = G.player.pitch;
key('KeyW', false);
key('KeyS', true); __PI.step(0.5);
const pS = G.player.pitch;
key('KeyS', false);

__PI.start('top');
const yTop0 = G.player.yaw, alt0 = G.player.pos.y;
key('KeyD', true); __PI.step(0.5);
const yTopD = G.player.yaw;
key('KeyD', false);
key('KeyW', true); __PI.step(0.5);
const altW = G.player.pos.y, pitchTop = G.player.pitch;
key('KeyW', false);
key('KeyS', true); __PI.step(0.5);
const altS = G.player.pos.y;
key('KeyS', false);
return {
  mode: G.mode, view: G.view,
  chase: { y0: +y0.toFixed(3), yD: +yD.toFixed(3), yA: +yA.toFixed(3), rollD: +rollD.toFixed(3),
           p0: +p0.toFixed(3), pW: +pW.toFixed(3), pS: +pS.toFixed(3) },
  top: { yTop0: +yTop0.toFixed(3), yTopD: +yTopD.toFixed(3), alt0: +alt0.toFixed(1),
         altW: +altW.toFixed(1), altS: +altS.toFixed(1), pitchTop: +pitchTop.toFixed(3) },
  errors: __PI.errors,
};
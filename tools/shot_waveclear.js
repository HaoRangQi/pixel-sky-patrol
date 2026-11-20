if (!__PI.ready()) return { ready: false };
__PI.start('chase');
__PI.G.mode = 'waveclear';
__PI.G.respite = 6.2;
__PI.G.wave = 3;
__PI.G.secondary = { type: 'sam', need: 2, killed: 2, text: '摧毁 2 个防空阵地' };
__PI.G.secondaryDone = true;
__PI.freeze(true);
return { mode: __PI.G.mode };

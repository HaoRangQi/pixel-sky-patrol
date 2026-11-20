if (!__PI.ready()) return { ready: false };
__PI.start('chase');
__PI.togglePause();
return { mode: __PI.G.mode };

if (!__PI.ready()) return { ready: false };
__PI.screenshot('chase');
return { ready: true, shot: 'chase', ...__PI.snapshot() };

if (!__PI.ready()) return { ready: false };
__PI.screenshot('top');
return { ready: true, shot: 'top', ...__PI.snapshot() };

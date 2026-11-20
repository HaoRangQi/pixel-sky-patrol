if (!__PI.ready()) return { ready: false };
__PI.screenshot('cockpit');
return { ready: true, shot: 'cockpit', ...__PI.snapshot() };

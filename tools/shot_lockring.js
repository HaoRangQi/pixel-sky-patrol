if (!__PI.ready()) return { ready: false };
__PI.start('chase');
__PI.lock();
__PI.G.lock.progress = 0.55;
__PI.G.lock.phase = 'locking';
__PI.freeze(true);
return __PI.snapshot();
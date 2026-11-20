if (!__PI.ready()) return { ready: false };
__PI.start('chase');
__PI.lock();
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
__PI.step(0.42);
__PI.freeze(true);
return __PI.snapshot();
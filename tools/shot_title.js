if (!__PI.ready()) return { ready: false };
__PI.screenshot('title');
return { ready: true, shot: 'title', mode: __PI.G.mode };

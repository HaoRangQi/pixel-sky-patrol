// Run: node --test tools/test_sky_ai_client.mjs
// LLM 客户端只做网络与枚举校验；飞行控制不在本测试范围。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/44_ai.js', import.meta.url), 'utf8');

function fixture(fetchImpl = null) {
  const clock = { t: 0 };
  const calls = [];
  const window = {};
  const sandbox = vm.createContext({
    window, URL, AbortController, setTimeout, clearTimeout, JSON, console,
    performance: { now: () => clock.t },
    G: { allies: [], time: 0, mode: 'play', lock: {}, enemies: [] },
    fetch: fetchImpl || (async () => { throw new Error('unexpected fetch'); }),
  });
  vm.runInContext(`(() => {
    ${source}
    globalThis.__AI = { WingmanAdvisor, aiNormalizeEndpoint, aiParseContent };
  })();`, sandbox);
  const AI = sandbox.__AI;
  const key = 'sk-test-secret-value';
  AI.WingmanAdvisor.configure({
    enabled: true,
    endpoint: 'https://api.example.com/v1',
    model: 'test-model',
    getKey: () => key,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
  });
  return { AI, Advisor: AI.WingmanAdvisor, calls, clock, key, sandbox };
}

const context = () => ({ active: true, hasWingman: true, inCombat: true, context: { wave: 1 }, onCommand: () => true, onFailure: () => {} });
const okReply = content => async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('端点规范化只接受 HTTPS 或本地 HTTP，并补全 /chat/completions', () => {
  const { AI } = fixture();
  assert.equal(AI.aiNormalizeEndpoint('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.equal(AI.aiNormalizeEndpoint('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
  assert.equal(AI.aiNormalizeEndpoint('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(AI.aiNormalizeEndpoint('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(AI.aiNormalizeEndpoint('http://api.example.com/v1'), null);
  assert.equal(AI.aiNormalizeEndpoint('https://user:pass@api.example.com/v1'), null);
  assert.equal(AI.aiNormalizeEndpoint('not a url'), null);
});

test('请求使用 Bearer Header、固定 JSON 体和安全 fetch 选项，Key 不出现在 URL', async () => {
  const f = fixture(okReply('{"intent":"attack_player_target","aggression":"high"}'));
  let command = null;
  const ctx = context();
  ctx.onCommand = value => { command = value; return true; };
  assert.equal(f.Advisor.maybeRequest(ctx), true);
  await tick(); await tick();
  assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0];
  assert.equal(url, 'https://api.example.com/v1/chat/completions');
  assert.equal(options.headers.Authorization, `Bearer ${f.key}`);
  assert(!url.includes(f.key), 'Key 绝不能进入 URL');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.mode, 'cors');
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'test-model');
  assert.equal(body.stream, false);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 120);
  assert.deepEqual(JSON.parse(JSON.stringify(command)), { intent: 'attack_player_target', aggression: 'high' });
  assert.equal(f.Advisor.runtime.status, 'ok');
});

test('禁用、未配置或缺少 Key 时不发请求', async () => {
  const f = fixture(okReply('{"intent":"regroup"}'));
  f.Advisor.config.enabled = false;
  assert.equal(f.Advisor.maybeRequest(context()), false);
  f.Advisor.config.enabled = true;
  f.Advisor.config.getKey = () => '';
  assert.equal(f.Advisor.maybeRequest(context()), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.Advisor.runtime.status, 'unconfigured');
});

test('无僚机、无战斗或不在 play 时不请求', async () => {
  const f = fixture(okReply('{"intent":"regroup"}'));
  for (const patch of [{ hasWingman: false }, { inCombat: false }, { active: false }]) {
    assert.equal(f.Advisor.maybeRequest({ ...context(), ...patch }), false);
  }
  assert.equal(f.calls.length, 0);
});

test('限流与签名重复抑制生效，新战斗上下文才允许再次请求', async () => {
  const f = fixture(okReply('{"intent":"regroup"}'));
  assert.equal(f.Advisor.maybeRequest(context()), true);
  await tick(); await tick();
  f.clock.t = 7000;
  assert.equal(f.Advisor.maybeRequest(context()), false, '同签名 12 秒节流');
  const changed = context(); changed.context = { wave: 2 };
  assert.equal(f.Advisor.maybeRequest(changed), true, '上下文变化可在 6 秒后触发');
  await tick(); await tick();
  f.clock.t = 19100;
  assert.equal(f.Advisor.maybeRequest(context()), true, '同签名 12 秒心跳可再次请求');
});

test('非法 JSON、非法 intent 与超大响应一律判定无效并回退本地', async () => {
  for (const reply of [
    async () => ({ ok: true, text: async () => 'not json' }),
    async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"intent":"ram"}' } }] }) }),
    async () => ({ ok: true, text: async () => 'x'.repeat(70000) }),
    async () => ({ ok: false, text: async () => '' }),
  ]) {
    const f = fixture(reply);
    let failed = 0;
    const ctx = context(); ctx.onFailure = () => { failed++; };
    assert.equal(f.Advisor.maybeRequest(ctx), true);
    await tick(); await tick();
    assert(failed >= 1, '失败必须通知本地回退');
    assert(['invalid_response', 'http_error'].includes(f.Advisor.runtime.status));
    assert(f.Advisor.runtime.failureUntil > f.clock.t);
  }
});

for (const [name, stop] of [
  ['显式取消', advisor => advisor.cancel('test')],
  ['暂停', advisor => advisor.syncMode('paused')],
  ['结束航次', advisor => advisor.endRun()],
  ['重新出航', advisor => advisor.beginRun()],
]) {
  test(`${name}会中断实际 fetch，忽略取消的迟到响应也不能写入游戏`, async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture(async () => {
      await pending;
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"intent":"hold_fire"}' } }] }) };
    });
    const ctx = context(); ctx.onCommand = () => { throw new Error('cancelled response must not apply'); };
    assert.equal(f.Advisor.maybeRequest(ctx), true);
    try {
      stop(f.Advisor);
      assert.equal(f.calls[0].options.signal.aborted, true, '必须中断 fetch 使用的信号');
    } finally {
      release();
      await tick(); await tick();
    }
    assert.equal(f.Advisor.runtime.inflight, null);
  });
}

test('testConnection 永远 resolve，失败只返回固定状态', async () => {
  const f = fixture(async () => { throw new Error('network down'); });
  const result = await f.Advisor.testConnection({ endpoint: 'https://api.example.com/v1', model: 'm', key: 'k' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.equal(await f.Advisor.testConnection({ endpoint: '', model: '', key: '' }).then(value => value.status), 'unconfigured');
});

test('快照不包含 Key、完整端点或模型', async () => {
  const f = fixture(okReply('{"intent":"regroup","aggression":"normal"}'));
  f.Advisor.maybeRequest(context());
  await tick(); await tick();
  const text = JSON.stringify(f.Advisor.snapshot());
  assert(!text.includes(f.key));
  assert(!text.includes('api.example.com'));
  assert(!text.includes('test-model'));
  assert.equal(f.Advisor.snapshot().endpointConfigured, true);
});

test('响应可剥离 Markdown 围栏，缺省 aggression 归一为 normal', () => {
  const { AI } = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(AI.aiParseContent('```json\n{"intent":"cover_player"}\n```'))), { intent: 'cover_player', aggression: 'normal' });
  assert.equal(AI.aiParseContent('{"intent":"unknown"}'), null);
});

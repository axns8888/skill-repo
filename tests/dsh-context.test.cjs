'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const context = require('../skills/axns-devflow-ext-autopilot/scripts/lib/dsh-context.cjs');
const state = { next_action: 'independent_task', checkpoint_saved: true, unpersisted_work: false, active_writers: 0,
  inflight_tools: 0, descendants_confirmed_quiescent: true, budget_reached: false, compaction_pressure: false,
  can_delegate: true, delegation_authorized: true, write_scopes_disjoint: true, can_start_new_session: true };
const costs = { next_input_tokens: 70000, expected_output_tokens: 5000, handoff_reserve_tokens: 5000, delegation_tokens: 2000 };
test('current meter pressure replaces cumulative UI usage and keeps missing capacity unknown', () => {
  const observed = context.collect({ measure: () => ({ totalTokens: 30000, surfaceTokens: 28000, usage: { totalTokens: 9999999 } }),
    contextPressure: () => ({ pressureTokens: 25000 }) }, {});
  assert.equal(observed.current_tokens, 30000); assert.equal(observed.limit_tokens, null);
  assert.equal(context.guard(observed), false);
});
test('context decisions combine native telemetry, future cost and task state', () => {
  const observed = { current_tokens: 30000, limit_tokens: 100000, source: 'local_estimate' };
  assert.equal(context.decide(observed, { context: costs, state }, { canDelegate: true, canStartNewSession: true }).decision.action, 'delegate_fresh');
  assert.equal(context.decide(observed, { context: costs, state: { ...state, next_action: 'handoff', active_writers: 1 } },
    { canDelegate: true, canStartNewSession: true }).decision.action, 'drain_execution');
  assert.equal(context.decide(observed, { context: costs, state: { ...state, next_action: 'handoff' } },
    { canDelegate: false, canStartNewSession: false }).decision.action, 'handoff_ready');
});
test('runtime hard guard respects measured capacity and declared reserves', () => {
  assert.equal(context.guard({ current_tokens: 95000, limit_tokens: 100000 }, 5000), true);
  assert.equal(context.guard({ current_tokens: 30000, limit_tokens: 100000 }, 5000), false);
  assert.throws(() => context.guard({ current_tokens: 1, limit_tokens: 10 }, -1), /余量/);
});

test('runtime plugin uses actual DSH tool schemas, samples events and refuses another over-capacity step', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { pathToFileURL } = require('node:url');
  const dshBin = process.env.AXNS_TEST_DSH_BIN;
  if (!dshBin) { t.skip('Set AXNS_TEST_DSH_BIN to exercise installed DSH API schemas'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-context-runtime-'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  const handlers = {}, tools = []; let current = 30000;
  const ctx = { on: (name, callback) => { handlers[name] = callback; },
    tools: { register: tool => { tools.push(tool); return () => {}; } }, agents: {},
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 100000 } }) },
    tokenMeter: { contextPressure: () => ({ contextWindow: 100000, pressureTokens: 28000 }), measure: () => ({ totalTokens: current, surfaceTokens: current }) } };
  const plugin = await import(pathToFileURL(path.resolve(__dirname, '../skills/axns-devflow-ext-autopilot/scripts/dsh-context-plugin.mjs')).href);
  const rootProcessFile = path.join(dir, 'root-process.json');
  await plugin.apply(ctx, { dshBin, directory: dir, canDelegate: true, canStartNewSession: true, rootProcessFile });
  const agent = { session: { id: 'real-call-identity' } };
  const output = JSON.parse(await tools[0].execute({ plan: JSON.stringify({ context: costs, state }) }, { agent }));
  assert.equal(output.current_tokens, 30000); assert.equal(output.decision.action, 'delegate_fresh');
  current = 96000;
  await assert.rejects(handlers['agent/pre-step']({ agent, modelSelection: { provider: 'own', model: 'known' } }, async () => ({ kind: 'enter' })), { code: 'AXNS_CONTEXT_LIMIT' });
  current = 25000;
  handlers['session/event'](agent.session, { type: 'assistant/message' }); await new Promise(resolve => setImmediate(resolve));
  const latest = fs.readdirSync(dir).map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))).find(value => value.session_id === agent.session.id);
  assert.equal(latest.current_tokens, 25000); assert.equal(latest.session_id, agent.session.id);
  const plan = JSON.stringify({ context: costs, state: { ...state, next_action: 'handoff' } });
  let decision = JSON.parse(await tools[0].execute({ plan }, { agent })).decision;
  assert.equal(decision.action, 'handoff_ready');
  fs.writeFileSync(rootProcessFile, JSON.stringify({ session_id: agent.session.id, takeover_confirmed: true, work_permitted: true }));
  decision = JSON.parse(await tools[0].execute({ plan }, { agent })).decision;
  assert.equal(decision.action, 'handoff_new_session');
  decision = JSON.parse(await tools[0].execute({ plan }, { agent: { session: { id: 'child-session' } } })).decision;
  assert.equal(decision.action, 'handoff_ready');

});

test('a newly selected model capacity overrides the previous request window', () => {
  const observed = context.collect({ measure: () => ({ totalTokens: 60000, surfaceTokens: 58000 }),
    contextPressure: () => ({ contextWindow: 200000, pressureTokens: 59000 }) }, {}, 50000);
  assert.equal(observed.limit_tokens, 50000);
  assert.equal(context.guard(observed), true);
});

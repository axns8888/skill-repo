'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { assess } = require('../skills/axns-devflow-ext-autopilot/scripts/context-decision.cjs');
function snapshot() {
  return { version: 1, context: { current_tokens: 30000, limit_tokens: 100000, next_input_tokens: 10000,
    expected_output_tokens: 5000, handoff_reserve_tokens: 5000, delegation_tokens: 3000, source: 'platform_current_context' },
    state: { next_action: 'continue', checkpoint_saved: true, unpersisted_work: false, active_writers: 0, inflight_tools: 0,
      descendants_confirmed_quiescent: true, budget_reached: false, compaction_pressure: false, can_delegate: true,
      delegation_authorized: true, write_scopes_disjoint: true, can_start_new_session: true } };
}
test('assesses current total plus next input, output and handoff costs without a fixed message cap', () => {
  const s = snapshot(); assert.equal(assess(s).action, 'continue_here');
  s.context.next_input_tokens = 60000;
  assert.equal(assess(s).projected_here_tokens, 100000); assert.equal(assess(s).action, 'handoff_new_session');
});
test('a large independent task goes to a fresh child when the coordinator still fits', () => {
  const s = snapshot(); s.context.next_input_tokens = 80000; s.state.next_action = 'independent_task';
  assert.equal(assess(s).action, 'delegate_fresh');
  s.context.current_tokens = 97000; assert.equal(assess(s).action, 'handoff_new_session');
});
test('delegation requires authorization, separate scopes and a saved checkpoint', () => {
  for (const key of ['delegation_authorized', 'write_scopes_disjoint', 'checkpoint_saved']) {
    const s = snapshot(); s.state.next_action = 'independent_task'; s.state[key] = false;
    assert.notEqual(assess(s).action, 'delegate_fresh');
  }
});
test('parent pressure cannot be hidden by spawning another child', () => {
  const s = snapshot(); s.state.next_action = 'independent_task'; s.state.compaction_pressure = true;
  assert.equal(assess(s).action, 'handoff_new_session');
});
test('independent dispatch waits for unknown existing execution to be inspected', () => {
  const s = snapshot(); s.state.next_action = 'independent_task'; s.state.active_writers = null;
  assert.equal(assess(s).action, 'inspect_execution');
  s.state.active_writers = 1; assert.equal(assess(s).action, 'delegate_fresh');
  s.state.write_scopes_disjoint = false; assert.notEqual(assess(s).action, 'delegate_fresh');
});
test('active or unknown descendants and in-flight tools prevent handoff', () => {
  for (const change of [{ active_writers: 1 }, { active_writers: null }, { inflight_tools: 1 }, { inflight_tools: null }, { descendants_confirmed_quiescent: false }]) {
    const s = snapshot(); Object.assign(s.state, { next_action: 'handoff' }, change);
    assert.equal(assess(s).action, 'drain_execution');
  }
});
test('unsaved work must be checkpointed before handing off even when execution is stopped', () => {
  const s = snapshot(); Object.assign(s.state, { next_action: 'handoff', unpersisted_work: true });
  assert.equal(assess(s).action, 'save_checkpoint');
  s.state.unpersisted_work = false; s.state.can_start_new_session = false;
  assert.equal(assess(s).action, 'handoff_ready');
});
test('unknown context is not invented; independent observed budget pressure still permits safe recovery', () => {
  const s = snapshot(); s.context.current_tokens = null; s.context.source = 'unknown';
  assert.equal(assess(s).action, 'inspect_context'); s.state.budget_reached = true;
  assert.equal(assess(s).action, 'handoff_new_session');
});
test('cumulative usage, negative costs, untyped state and integer overflow are refused', () => {
  const s = snapshot(); s.context.source = 'cumulative_usage'; assert.throws(() => assess(s), /累计token/);
  const negative = snapshot(); negative.context.next_input_tokens = -1; assert.throws(() => assess(negative), /整数/);
  const huge = snapshot(); huge.context.next_input_tokens = Number.MAX_SAFE_INTEGER; assert.throws(() => assess(huge), /安全整数/);
  const state = snapshot(); state.state.descendants_confirmed_quiescent = 'true'; assert.throws(() => assess(state), /布尔/);
});

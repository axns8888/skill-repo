'use strict';
const { assess } = require('../context-decision.cjs');
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function collect(meter, session, capacity = null) {
  const pressure = meter.contextPressure(session), measured = meter.measure(session);
  const current = number(measured.totalTokens), limit = number(capacity) ?? number(pressure.contextWindow);
  return { current_tokens: current, limit_tokens: limit && limit > 0 ? limit : null,
    source: current === null ? 'unknown' : 'local_estimate',
    observation: { provider_prompt_tokens: number(pressure.pressureTokens), surface_tokens: number(measured.surfaceTokens),
      method: 'dsh_token_meter_current_measurement', precision: 'estimate_with_provider_anchor_when_compatible' } };
}
function decide(observed, plan, capabilities = {}) {
  const costs = plan.context ?? {}, state = { ...plan.state };
  // The caller reports execution state; platform capabilities can only narrow its claims.
  state.can_delegate = state.can_delegate && capabilities.canDelegate === true;
  state.delegation_authorized = state.delegation_authorized && capabilities.canDelegate === true;
  state.can_start_new_session = capabilities.canStartNewSession === true;
  const snapshot = { version: 1, context: { current_tokens: observed.current_tokens, limit_tokens: observed.limit_tokens,
    next_input_tokens: costs.next_input_tokens ?? null, expected_output_tokens: costs.expected_output_tokens ?? null,
    handoff_reserve_tokens: costs.handoff_reserve_tokens ?? null, delegation_tokens: costs.delegation_tokens ?? null,
    source: observed.source }, state };
  return { snapshot, decision: assess(snapshot) };
}
function guard(observed, reserve = 0) {
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw Error('上下文余量必须是非负整数');
  return observed.current_tokens !== null && observed.limit_tokens !== null &&
    observed.current_tokens + reserve >= observed.limit_tokens;
}
module.exports = { collect, decide, guard };

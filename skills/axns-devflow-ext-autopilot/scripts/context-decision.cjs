#!/usr/bin/env node
'use strict';
// Read-only advice from a caller-observed snapshot; never claims, stops, launches, or measures an agent.
const fs = require('node:fs');
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + ' 必须为对象');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(label + '.' + key + ' 未知字段');
}
function count(value, label, positive = false) {
  if (value !== null && (!Number.isSafeInteger(value) || value < (positive ? 1 : 0))) throw Error(label + ' 需要整数或null（未知）');
}
function assess(snapshot) {
  keys(snapshot, ['version', 'context', 'state'], 'snapshot');
  if (snapshot.version !== 1) throw Error('snapshot.version 需要1');
  const c = snapshot.context, s = snapshot.state;
  const costs = ['current_tokens', 'limit_tokens', 'next_input_tokens', 'expected_output_tokens', 'handoff_reserve_tokens', 'delegation_tokens'];
  keys(c, [...costs, 'source'], 'context');
  if (!['platform_current_context', 'request_estimate', 'local_estimate', 'unknown'].includes(c.source))
    throw Error('context.source 必须表示当前上下文或估计，不能使用累计token用量');
  for (const key of costs) count(c[key], 'context.' + key, key === 'limit_tokens');
  if (c.source === 'unknown' && c.current_tokens !== null) throw Error('来源未知时不得声明当前token数');
  const flags = ['checkpoint_saved', 'unpersisted_work', 'descendants_confirmed_quiescent', 'budget_reached', 'compaction_pressure',
    'can_delegate', 'delegation_authorized', 'write_scopes_disjoint', 'can_start_new_session'];
  keys(s, [...flags, 'active_writers', 'inflight_tools', 'next_action'], 'state');
  for (const key of flags) if (typeof s[key] !== 'boolean') throw Error('state.' + key + ' 需要布尔值');
  for (const key of ['active_writers', 'inflight_tools']) count(s[key], 'state.' + key);
  if (!['continue', 'independent_task', 'handoff'].includes(s.next_action)) throw Error('state.next_action 无效');
  const sum = values => values.some(v => v === null) ? null : values.reduce((a, b) => {
    if (!Number.isSafeInteger(a + b)) throw Error('token合计超出安全整数'); return a + b;
  }, 0);
  const here = sum([c.current_tokens, c.next_input_tokens, c.expected_output_tokens, c.handoff_reserve_tokens]);
  const coordinator = sum([c.current_tokens, c.delegation_tokens, c.handoff_reserve_tokens]);
  const fits = value => value !== null && c.limit_tokens !== null && value < c.limit_tokens;
  const exceeds = here !== null && c.limit_tokens !== null && here >= c.limit_tokens;
  const pressure = s.budget_reached || s.compaction_pressure || s.next_action === 'handoff';
  const independent = s.next_action === 'independent_task' && s.can_delegate && s.delegation_authorized && s.write_scopes_disjoint;
  const reason = s.next_action === 'handoff' ? 'requested_handoff' : s.budget_reached ? 'budget_reached' : s.compaction_pressure ? 'compaction_pressure' : 'projected_context_exceeds_limit';
  const result = { action: null, reason: null, source: c.source, projected_here_tokens: here, projected_coordinator_tokens: coordinator,
    limit_tokens: c.limit_tokens, automatic_execution: false };
  const reply = (action, why) => ({ ...result, action, reason: why });
  if (!pressure && independent && (s.active_writers === null || s.inflight_tools === null))
    return reply('inspect_execution', 'existing_execution_state_unknown');
  // Delegating a large independent task can avoid loading it into an otherwise small coordinator.
  if (!pressure && independent && fits(coordinator) && s.checkpoint_saved && !s.unpersisted_work)
    return reply('delegate_fresh', 'independent_task_with_context_and_scope');
  if (pressure || exceeds) {
    if (s.active_writers !== 0 || s.inflight_tools !== 0 || !s.descendants_confirmed_quiescent)
      return reply('drain_execution', reason);
    if (!s.checkpoint_saved || s.unpersisted_work) return reply('save_checkpoint', reason);
    return reply(s.can_start_new_session ? 'handoff_new_session' : 'handoff_ready', reason);
  }
  if (!fits(here)) return reply('inspect_context', 'current_context_or_next_action_cost_unknown');
  if (s.next_action === 'independent_task' && !s.delegation_authorized)
    return reply('continue_here', 'delegation_not_authorized');
  return reply('continue_here', 'next_action_fits_context');
}
function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--snapshot') throw Error('用法：node context-decision.cjs --snapshot <当前上下文与执行状态.json>');
  const fd = fs.openSync(argv[1], 'r');
  try {
    const buffer = Buffer.alloc(128 * 1024 + 1), bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > 128 * 1024) throw Error('状态快照超过128 KiB，请引用证据路径而非填入历史');
    console.log(JSON.stringify(assess(JSON.parse(buffer.subarray(0, bytes).toString('utf8')))));
  } finally { fs.closeSync(fd); }
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assess, main };

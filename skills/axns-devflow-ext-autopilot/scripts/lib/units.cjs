"use strict";
const { createHash } = require('node:crypto');
const core = require('./core.cjs');
function line(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\r\n\0]/.test(value)) core.fail(label + ' 必须为有界单行文本');
}
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) core.fail(label + ' 必须为不小于 ' + minimum + ' 的整数');
  return value;
}
function spec(value) {
  core.keys(value, ['id', 'goal', 'inputs', 'write_scope', 'done_when', 'stop_when', 'budget', 'launch'], 'unit');
  if (value.launch !== undefined) {
    // Validate shape here; the project's model table is checked when resolving a launch.
    const models = typeof value.launch?.tier === 'string' ? { [value.launch.tier]: true } : {};
    const scenarios = typeof value.launch?.scenario === 'string' ? { [value.launch.scenario]: {} } : {};
    require('./launch-policy.cjs').selection(value.launch, models, 'unit.launch', scenarios);
  }
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.id)) core.fail('unit.id 无效');
  line(value.goal, 'unit.goal');
  for (const key of ['inputs', 'write_scope', 'done_when', 'stop_when']) {
    if (!Array.isArray(value[key]) || value[key].length > 32 || ['done_when', 'stop_when'].includes(key) && !value[key].length) core.fail('unit.' + key + ' 必须为有界数组');
    for (const item of value[key]) {
      line(item, 'unit.' + key);
      if (['inputs', 'write_scope'].includes(key)) core.relativePath(item);
    }
  }
  core.keys(value.budget, ['max_steps', 'max_minutes', 'reserve_tokens'], 'unit.budget');
  for (const key of ['max_steps', 'max_minutes']) integer(value.budget[key], 'unit.budget.' + key, 1);
  if (value.budget.reserve_tokens !== undefined) integer(value.budget.reserve_tokens, 'unit.budget.reserve_tokens', 1);
  if (Buffer.byteLength(JSON.stringify(value)) > 16384) core.fail('短工单不得超过 16 KiB；使用路径引用输入');
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function validate(unit) {
  core.keys(unit, ['file', 'sha256', 'spec'], 'work_unit');
  core.relativePath(unit.file); spec(unit.spec);
  if (unit.sha256 !== digest(unit.spec)) core.fail('短工单快照摘要不一致');
  return unit;
}
function load(ctx, d, relative) {
  core.relativePath(relative);
  const value = ctx.read.json(core.safe(d.taskRoot, '_plan/process/' + d.task.task_id + '/' + relative));
  spec(value);
  require('./launch-policy.cjs').selection(value.launch ?? {}, ctx.cfg.models, 'unit.launch', ctx.cfg.scenarios);
  return { file: relative, sha256: digest(value), spec: value };
}
function progress(window, now, steps = window.steps ?? 0, remaining = window.remaining_tokens ?? null) {
  const budget = window.request.work_unit.spec.budget;
  const reasons = [...(window.rotation_reasons ?? [])];
  if (steps >= budget.max_steps) reasons.push('step_budget');
  if (now - Date.parse(window.opened_at) >= budget.max_minutes * 60000) reasons.push('time_budget');
  if (remaining !== null && budget.reserve_tokens !== undefined && remaining <= budget.reserve_tokens) reasons.push('context_reserve');
  return { steps, remaining_tokens: remaining, context_status: remaining === null ? 'unknown' : 'reported',
    rotation_required: reasons.length > 0, reasons: [...new Set(reasons)] };
}
module.exports = { integer, spec, validate, load, progress };

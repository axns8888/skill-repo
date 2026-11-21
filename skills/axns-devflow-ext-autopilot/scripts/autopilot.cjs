#!/usr/bin/env node
'use strict';
// Read-only entry point. Execution is separately enabled through runner.cjs.
const { context, evaluate, verify, fail } = require('./lib/core.cjs');
const path = require('node:path');
const usage = 'node autopilot.cjs <status|decide> --project <项目或任务 worktree> [--json] [--summary [--id TASK]]';
function summarize(result, ctx, taskId) {
  if (!result.enabled) return result;
  const filter = xs => taskId ? xs.filter(x => x.task_id === taskId) : xs;
  const base = { enabled: true, primary_root: ctx.root, slots: result.slots };
  const evidence = x => path.join(x.task_root, '_plan/process', x.task_id);
  if (result.tasks) return { ...base, config: result.config, execution_enabled: result.execution.enabled,
    tasks: filter(result.tasks).map(x => ({ task_id: x.task_id, status: x.status, head: x.head, held: x.held,
      stage: x.stage?.stage, stage_state: x.stage?.state, owner: x.window?.owner, dispatch_id: x.window?.dispatch_id,
      window_state: x.window?.phase, wait_exceeded: x.wait_exceeded, human_acceptance: x.human_acceptance?.status, record_dir: evidence(x) })) };
  return { ...base, action_count: result.action_count, needs_human_count: result.needs_human_count, recovery_count: result.recovery_count,
    decisions: filter(result.decisions).map(x => ({ task_id: x.task_id, action: x.action, reason: x.reason, next_stage: x.next_stage,
      needs_human: x.needs_human, recovery_required: x.recovery_required, dispatch_id: x.dispatch_id, record_dir: evidence(x) })) };
}
function main(argv) {
  const command = argv.shift(); const opts = {};
  while (argv.length) {
    const key = argv.shift();
    if (!['--project', '--json', '--summary', '--id'].includes(key) || Object.hasOwn(opts, key)) fail('无效或重复参数：' + key);
    if (['--json', '--summary'].includes(key)) opts[key] = true;
    else { if (!argv[0] || argv[0].startsWith('--')) fail(key + ' 需要值'); opts[key] = argv.shift(); }
  }
  if (!['status', 'decide'].includes(command) || !opts['--project'] || opts['--id'] && !opts['--summary']) fail(usage);
  const ctx = context(opts['--project']);
  const { code, result } = evaluate(ctx, command); verify(ctx);
  console.log(JSON.stringify(opts['--summary'] ? summarize(result, ctx, opts['--id']) : result, null, 2)); return code;
}
try {
  if (process.argv.length <= 2 || process.argv.slice(2).includes('--help')) console.log(usage);
  else process.exitCode = main(process.argv.slice(2));
} catch (e) { console.error(e.message); process.exitCode = 1; }

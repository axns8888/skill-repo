#!/usr/bin/env node
'use strict';
// A finite local control loop: no LLM coordinator, no conversation history, no implicit task recovery.
const fs = require('node:fs');
const path = require('node:path');
const core = require('./lib/core.cjs');
const runtime = require('./lib/runtime.cjs');
const dispatch = require('./lib/dispatch.cjs');
const { acquire } = require('./lib/process-lock.cjs');
function configuration(ctx) {
  runtime.writable(ctx);
  const execution = ctx.cfg.execution;
  const bridges = ['orca-bridge.cjs', 'dsh-bridge.cjs'].map(name => path.resolve(__dirname, 'adapters', name));
  if (execution.adapter !== 'command' || !execution.require_units ||
      !execution.command?.args.length || !bridges.some(bridge => fs.realpathSync(execution.command.args[0]) === fs.realpathSync(bridge)))
    throw Error('控制器需要 execution.adapter=command、require_units=true 及随附 orca-bridge.cjs 或 dsh-bridge.cjs');
}
function compact(value) {
  return { action: value.action, ...(value.reason ? { reason: value.reason } : {}),
    ...(value.adapter_reason ? { adapter_reason: value.adapter_reason } : {}),
    ...(value.request ? { dispatch_id: value.request.dispatch_id, stage: value.request.stage,
      unit: value.request.work_unit?.spec.id } : {}), ...(value.session_id ? { session_id: value.session_id } : {}) };
}
function step(project, id, allowLaunch = true) {
  core.id(id);
  const ctx = core.context(project); configuration(ctx);
  const d = runtime.task(ctx, id), assessment = core.evaluate(ctx);
  const decision = assessment.result.decisions.find(v => v.task_id === id);
  core.verify(ctx);
  if (d.window) {
    const recovered = require('./lib/dsh-bridge.cjs').recoverStopped(ctx, d);
    if (recovered) return { code: recovered.code, more: recovered.code === 0,
      result: { task_id: id, action: recovered.code === 0 ? 'dsh_recovered' : recovered.result.action, ...compact(recovered.result) } };
    const response = dispatch.recover(project, { id, owner: d.window.owner, dispatch: d.window.dispatch_id });
    if (response.result.action === 'running') return { code: 0, more: true,
      result: { action: decision.recovery_required ? 'awaiting_handoff' : 'awaiting_worker',
        task_id: id, dispatch_id: d.window.dispatch_id, session_id: response.result.session_id,
        takeover_confirmed: !!d.window.acknowledged_at, ...(decision.budget ? { budget: decision.budget } : {}) } };
    if (response.result.action === 'already_reported') return { code: 0, more: true, result: { action: 'reported', task_id: id } };
    if (response.result.adapter_reason === 'dsh_starting') return { code: 0, more: true,
      result: { action: 'awaiting_dsh_start', task_id: id, dispatch_id: d.window.dispatch_id } };
    if (response.result.adapter_reason === 'dsh_process_closed_without_business_receipt') {
      const fresh = core.context(project), latest = runtime.task(fresh, id); core.verify(fresh);
      const recovered = require('./lib/dsh-bridge.cjs').recoverStopped(fresh, latest);
      if (recovered) return { code: recovered.code, more: recovered.code === 0, result: { task_id: id, ...compact(recovered.result) } };
    }
    return { code: response.code || 2, more: false, result: { task_id: id, ...compact(response.result) } };
  }
  if (['advance', 'finish'].includes(decision.action)) {
    const draining = require('./lib/dsh-bridge.cjs').previous(ctx, d);
    if (draining) return { code: 0, more: true, result: { action: 'awaiting_dsh_exit', reason: draining, task_id: id } };
  }
  if (decision.action === 'advance') {
    if (!allowLaunch) return { code: 0, more: false, result: { action: 'launch_limit', task_id: id } };
    const bridge = require(path.resolve(ctx.cfg.execution.command.args[0]));
    const refusal = bridge.unsupported({ route: decision.model, team: decision.team }, bridge.options(ctx.cfg.execution.command.args.slice(1)));
    if (refusal) return { code: 2, more: false,
      result: { action: 'hold', reason: refusal, task_id: id } };
    const response = dispatch.tick(project, { id });
    const running = response.result.action === 'running';
    // A fast worker can report between launch and reconcile. Do not assume that means a failed launch.
    const reported = response.result.action === 'already_reported';
    if (response.result.adapter_reason === 'dsh_starting') return { code: 0, more: true, launched: true,
      result: { action: 'awaiting_dsh_start', task_id: id, dispatch_id: response.result.dispatch_id } };
    return { code: running || reported ? response.code : response.code || 2, more: running || reported, launched: running || reported,
      result: { task_id: id, ...compact(response.result) } };
  }
  if (decision.action === 'finish') {
    const response = runtime.finalize(project, { id });
    return { code: response.code, more: false, result: { task_id: id, ...compact(response.result) } };
  }
  return { code: decision.recovery_required ? 2 : 0, more: false,
    result: { action: 'hold', task_id: id, reason: decision.reason, recovery_required: !!decision.recovery_required } };
}
function options(argv) {
  const opts = { watch: false, interval: 2000, cycles: 120, launches: 4 };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--watch' && !opts.watch) { opts.watch = true; continue; }
    const key = { '--project': 'project', '--id': 'id', '--interval-ms': 'interval', '--max-cycles': 'cycles', '--max-launches': 'launches' }[flag];
    if (!key || !argv.length || argv[0].startsWith('--')) throw Error('无效参数：' + flag);
    opts[key] = ['project', 'id'].includes(key) ? argv.shift() : Number(argv.shift());
  }
  if (!opts.project || !opts.id) throw Error('必须提供 --project 和 --id');
  core.id(opts.id);
  for (const [key, min, max] of [['interval', 250, 60000], ['cycles', 1, 3600], ['launches', 1, 100]])
    if (!Number.isSafeInteger(opts[key]) || opts[key] < min || opts[key] > max) throw Error(key + ' 超出允许范围');
  return opts;
}
async function run(opts, emit = value => console.log(JSON.stringify(value))) {
  core.id(opts.id);
  const directory = core.safe(core.locate(opts.project).root, '_plan/autopilot/' + opts.id);
  fs.mkdirSync(directory, { recursive: true });
  const release = acquire(core.safe(directory, 'controller.lock'));
  const intents = () => {
    return ['orca', 'dsh'].flatMap(platform => {
      try { return fs.readdirSync(path.join(directory, platform)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => platform + '/' + name); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    });
  };
  const initialIntents = new Set();
  let launches = 0, previous = '', interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    for (const name of intents()) initialIntents.add(name);
    for (let cycle = 1; cycle <= (opts.watch ? opts.cycles : 1); cycle++) {
      if (interrupted) { emit({ action: 'controller_stopped', task_id: opts.id, worker_ownership_retained: true }); return 0; }
      let value;
      try { value = step(opts.project, opts.id, launches < opts.launches); }
      catch (error) {
        if (!opts.watch || !['AXNS_COORDINATION_BUSY', 'AXNS_OBSERVATION_CHANGED'].includes(error.code)) throw error;
        value = { code: 0, more: true, result: { action: 'awaiting_snapshot', task_id: opts.id, reason: error.code } };
      }
      // Count durable new intents even if reconcile lost a race after launch. Retrying cannot reset the cap.
      launches = intents().filter(name => !initialIntents.has(name)).length;
      const serialized = JSON.stringify(value.result);
      if (serialized !== previous) emit(value.result);
      previous = serialized;
      if (!opts.watch || !value.more) return value.code;
      if (cycle === opts.cycles) break;
      await new Promise(resolve => setTimeout(resolve, opts.interval));
    }
    emit({ action: 'cycle_limit', task_id: opts.id, launches, worker_ownership_retained: true });
    return 0;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop); release();
  }
}
if (require.main === module) {
  if (process.argv.includes('--help')) console.log('node orca-controller.cjs --project <项目> --id <task-id> [--watch --interval-ms 2000 --max-cycles 120 --max-launches 4]');
  else Promise.resolve().then(() => run(options(process.argv.slice(2))))
    .then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { step, run, options };

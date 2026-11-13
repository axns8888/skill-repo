'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const core = require('./core.cjs');
const runtime = require('./runtime.cjs');
const bridge = require('../adapters/command.cjs');
const { context, verify, fail } = core;
const { task, matching, file, receiptFile, atomic, event, locked, readyTask } = runtime;
function reconcile(project, opts, response) {
  return locked(project, ctx => {
    const d = task(ctx, opts.id);
    if (!d.window || d.window.dispatch_id !== opts.dispatch) {
      const receipt = runtime.read(receiptFile(ctx, opts.id, opts.dispatch));
      if (receipt?.owner === opts.owner) { verify(ctx); return { code: receipt.outcome === 'fail' ? 2 : 0, result: { action: 'already_reported', receipt } }; }
    }
    const w = matching(d, opts.owner, opts.dispatch);
    if (w.adapter !== 'command') fail('该窗口不属于 command 适配器');
    const receipt = runtime.read(receiptFile(ctx, opts.id, opts.dispatch));
    if (receipt) {
      verify(ctx);
      return { code: 2, result: { action: 'hold', reason: 'reported_result_needs_handoff', receipt } };
    }
    verify(ctx);
    const now = new Date().toISOString();
    if (response.state === 'running') {
      readyTask(d);
      if (d.stage?.stage === w.stage && d.stage.state === 'running' && w.phase === 'running') {
        // Adapter query confirms liveness, not worker progress; it must not refresh the worker heartbeat.
        atomic(file(ctx, opts.id, 'window.json'), { ...w, session_id: response.session_id });
      } else {
        if (JSON.stringify(d.stage) !== JSON.stringify(w.initial_stage)) fail('启动期间阶段发生变化，保留占位');
        atomic(file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: w.stage, state: 'running', owner: opts.owner,
          updated_at: now, attempts: w.initial_stage.stage === w.stage ? w.initial_stage.attempts ?? 0 : 0 });
        atomic(file(ctx, opts.id, 'window.json'), { ...w, phase: 'running', session_id: response.session_id, heartbeat_at: now });
        event(d, 'started', { owner: opts.owner, dispatch_id: opts.dispatch, session_id: response.session_id });
      }
      return { code: 0, result: { action: 'running', request: w.request, session_id: response.session_id } };
    }
    if (response.state === 'absent' && w.phase === 'reserved') {
      if (JSON.stringify(d.stage) !== JSON.stringify(w.initial_stage)) fail('阶段已变化，不能按未启动释放');
      event(d, 'start_absent', { dispatch_id: opts.dispatch, reason: response.reason });
      atomic(receiptFile(ctx, opts.id, opts.dispatch), { task_id: opts.id, owner: opts.owner, dispatch_id: opts.dispatch,
        outcome: 'not_started', reason: response.reason, at: now }, true);
      atomic(file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: w.stage, state: 'ready', owner: opts.owner,
        updated_at: now, attempts: (w.initial_stage.stage === w.stage ? w.initial_stage.attempts ?? 0 : 0) + 1 });
      fs.unlinkSync(file(ctx, opts.id, 'window.json'));
      return { code: 0, result: { action: 'start_failed', reason: response.reason } };
    }
    // A session stopping does not prove success. Preserve ownership until actual outcome evidence is supplied.
    return { code: 2, result: { action: 'hold', reason: response.state === 'stopped' ? 'worker_stopped_without_result' : 'launch_unknown',
      adapter_reason: response.reason, dispatch_id: opts.dispatch } };
  }, false);
}
function tick(project, opts) {
  const claimed = runtime.reserve(project, { ...opts, owner: opts.owner || 'command/' + randomUUID() }, 'command');
  if (!claimed.result?.request || claimed.result.action !== 'reserved') return claimed;
  const request = claimed.result.request;
  const ctx = context(project), d = task(ctx, request.task_id), w = matching(d, request.owner, request.dispatch_id);
  runtime.writable(ctx); runtime.preflight(ctx, d);
  if (JSON.stringify(ctx.cfg.execution) !== JSON.stringify(w.execution)) fail('派发后执行配置已变化，保留占位');
  verify(ctx);
  const response = bridge.invoke(w.execution, 'start', request);
  return reconcile(project, { id: request.task_id, owner: request.owner, dispatch: request.dispatch_id }, response);
}
function recover(project, opts) {
  const ctx = context(project), d = task(ctx, opts.id), w = matching(d, opts.owner, opts.dispatch);
  if (w.adapter !== 'command') fail('session 窗口须核实原会话后用 interrupt 交接；不得按心跳自动接管');
  verify(ctx);
  const response = bridge.invoke(w.execution, 'query', w.request);
  return reconcile(project, opts, response);
}
module.exports = { tick, recover };

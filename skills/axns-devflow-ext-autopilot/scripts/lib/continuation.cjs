"use strict";
const path = require('node:path');
const core = require('./core.cjs');
const r = require('./runtime.cjs');
const units = require('./units.cjs');
function finishYield(ctx, d, window, receipt) {
  r.atomic(r.file(ctx, d.task.task_id, 'stage.json'), { task_id: d.task.task_id, stage: window.stage, state: 'ready', owner: window.owner,
    updated_at: receipt.at, attempts: d.stage.attempts ?? 0, last_dispatch_id: window.dispatch_id, last_session_id: receipt.session_id,
    evidence: receipt.evidence, next_unit: receipt.next_unit, next_unit_stage: window.stage });
  require('node:fs').unlinkSync(r.file(ctx, d.task.task_id, 'window.json'));
}
function brief(project, opts) {
  core.id(opts.id);
  const ctx = core.context(project), assessment = core.evaluate(ctx), d = r.task(ctx, opts.id);
  const window = d.window;
  const receipt = window ? ctx.read.json(r.receiptFile(ctx, opts.id, window.dispatch_id)) : null;
  const unit = receipt?.outcome === 'yield' ? receipt.next_unit : window?.request.work_unit ?? d.stage?.next_unit;
  const result = { action: 'resume_brief', task_id: opts.id, cwd: d.taskRoot, head: d.head,
    runner: path.resolve(__dirname, '../runner.cjs'),
    stage: d.stage?.stage ?? null, state: d.stage?.state ?? null,
    decision: assessment.result.decisions.find(value => value.task_id === opts.id),
    work_unit: unit ? { file: unit.file, sha256: unit.sha256, id: unit.spec.id, goal: unit.spec.goal, budget: unit.spec.budget } : null,
    window: window ? { owner: window.owner, dispatch_id: window.dispatch_id, session_id: window.session_id ?? null,
      phase: window.phase, takeover_confirmed: !!window.acknowledged_at,
      result_recorded: !!receipt } : null,
    receipt: receipt ? { file: r.receiptFile(ctx, opts.id, window.dispatch_id), outcome: receipt.outcome,
      evidence: receipt.evidence ?? null, next_unit: receipt.next_unit?.file ?? null } : null,
    evidence: receipt?.evidence ?? d.stage?.evidence ?? null };
  result.prompt = [
    '接续原任务，沿用原授权、task-id、阶段和工作区；不加载旧对话全文，不重新登记。',
    '主目录：' + ctx.root, '任务目录：' + d.taskRoot, '任务记录：_plan/process/' + opts.id + '/',
    '先读取 AGENTS.md 和原唯一计划的当前状态，按需读取本摘要引用的工单及证据。',
    '活动窗口存在时保留原 owner/dispatch；先查询原执行者，不能因上下文溢出或心跳过期认定停止。',
    '若已核实原会话停止，保存非空恢复证据和下一短工单，用 runner resume-yield --confirmed-stopped 完成交接，再由全新会话领取。',
    '无活动窗口时按原判定 prepare/claim 或 tick；不能清锁、重置 attempts 或刷新成果快照来绕过门禁。',
    '本轮只推进一个短目标，源码/日志按需分块；结果落盘并只回传摘要，结束本轮。',
  ].join('\n');
  if (Buffer.byteLength(JSON.stringify(result, null, 2) + '\n') > 12288) core.fail('接续摘要超过 12 KiB；缩小工单目标或身份字段');
  core.verify(ctx);
  return { code: 0, result };
}
function prepare(project, opts) {
  core.id(opts.id); r.text(opts.owner, 'owner');
  if (!opts.unit) core.fail('prepare 必须指定 --unit');
  return r.locked(project, ctx => {
    const d = r.task(ctx, opts.id); r.readyTask(d);
    if (d.window) core.fail('活动窗口存在；先由旧执行者完成或 yield');
    const assessment = core.evaluate(ctx);
    const next = assessment.result.decisions.find(v => v.task_id === opts.id &&
      (v.action === 'advance' || v.reason === 'work_unit_required'));
    if (!next) core.fail('当前阶段不可派发；prepare 不跳过失败、证据或验收门禁');
    const unit = units.load(ctx, d, opts.unit); core.verify(ctx);
    r.atomic(r.file(ctx, opts.id, 'stage.json'), { ...d.stage, next_unit: unit, next_unit_stage: next.next_stage });
    return { code: 0, result: { action: 'unit_prepared', stage: next.next_stage, work_unit: unit } };
  });
}
function takeover(project, opts) {
  r.text(opts['session-id'], 'session-id'); r.text(opts.cwd, 'cwd');
  return r.locked(project, ctx => {
    const d = r.task(ctx, opts.id), w = r.matching(d, opts.owner, opts.dispatch);
    r.readyTask(d);
    if (path.resolve(opts.cwd) !== d.taskRoot || w.request.cwd !== d.taskRoot || w.request.head !== d.head) core.fail('接管 cwd 或 HEAD 与原工单不一致');
    if (r.read(r.receiptFile(ctx, opts.id, opts.dispatch))) core.fail('已有结果回执，不得再次接管');
    if (w.request.previous_session_id === opts['session-id']) core.fail('短工单接续必须使用新的平台会话');
    if (w.request.work_unit) {
      const receipts = r.file(ctx, opts.id, 'receipts');
      for (const name of require('node:fs').existsSync(receipts) ? require('node:fs').readdirSync(receipts) : []) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) core.fail('无效回执文件');
        const old = ctx.read.json(core.safe(receipts, name));
        if (old.session_id === opts['session-id']) core.fail('短工单不得复用本任务历史会话');
      }
    }
    if (w.request.work_unit && !w.acknowledged_at && w.request.worktree_snapshot !== d.worktreeSnapshot)
      core.fail('接管前工作区已变化；先核实旧执行者与实际改动');
    if (w.request.previous_dispatch_id) {
      const previous = r.read(r.receiptFile(ctx, opts.id, w.request.previous_dispatch_id));
      if (!previous || !['yield', 'complete'].includes(previous.outcome) || previous.owner !== w.request.previous_owner)
        core.fail('缺少匹配的旧会话交接回执，不能确认新会话接管');
    }
    if (w.session_id && w.session_id !== opts['session-id']) core.fail('session-id 与平台启动/接管回执不一致');
    if (w.acknowledged_at) {
      core.verify(ctx); return { code: 0, result: { action: 'takeover', duplicate: true, dispatch_id: opts.dispatch,
        ...(w.request.work_unit ? { budget: units.progress(w, Date.now()), work_permitted: !units.progress(w, Date.now()).rotation_required } : {}) } };
    }
    if (d.stage?.stage !== w.stage || w.phase === 'running' && d.stage.state !== 'running' ||
        w.phase === 'reserved' && JSON.stringify(d.stage) !== JSON.stringify(w.initial_stage)) core.fail('接管期间阶段发生变化');
    core.verify(ctx);
    const now = new Date().toISOString();
    const remaining = opts['remaining-tokens'] === undefined ? null : units.integer(Number(opts['remaining-tokens']), 'remaining-tokens');
    const updated = { ...w, phase: 'running', session_id: opts['session-id'], acknowledged_at: now,
      heartbeat_at: now, steps: 0, remaining_tokens: remaining };
    if (w.request.work_unit) updated.rotation_reasons = units.progress(updated, Date.now()).reasons;
    r.atomic(r.file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: w.stage, state: 'running', owner: opts.owner,
      updated_at: now, attempts: w.initial_stage.stage === w.stage ? w.initial_stage.attempts ?? 0 : 0, ...r.unitState(w.request) });
    r.atomic(r.file(ctx, opts.id, 'window.json'), updated);
    return { code: 0, result: { action: 'takeover', dispatch_id: opts.dispatch, session_id: opts['session-id'],
      ...(w.request.work_unit ? { budget: units.progress(updated, Date.now()), work_permitted: !units.progress(updated, Date.now()).rotation_required } : {}) } };
  }, false);
}
function yieldUnit(project, opts) {
  return r.locked(project, ctx => {
    const d = r.task(ctx, opts.id);
    const prior = r.read(r.receiptFile(ctx, opts.id, opts.dispatch));
    if (prior) {
      if (prior.outcome !== 'yield' || prior.owner !== opts.owner || prior.evidence !== opts.evidence || prior.next_unit.file !== opts['next-unit']) core.fail('yield 与已有回执不一致');
      if (d.window?.dispatch_id === opts.dispatch) {
        if (!opts['confirmed-stopped']) core.fail('yield 中断，核实原会话停止后使用 resume-yield；不重复派发');
        const window = r.matching(d, opts.owner, opts.dispatch); r.readyTask(d); units.validate(prior.next_unit);
        if (prior.task_id !== opts.id || prior.dispatch_id !== opts.dispatch || prior.stage !== window.stage ||
            prior.session_id !== window.session_id || prior.head !== d.head || prior.worktree_snapshot !== d.worktreeSnapshot ||
            d.stage.stage !== window.stage || !['running', 'ready'].includes(d.stage.state) || d.stage.owner !== opts.owner ||
            d.stage.state === 'ready' && (d.stage.last_dispatch_id !== opts.dispatch || JSON.stringify(d.stage.next_unit) !== JSON.stringify(prior.next_unit)))
          core.fail('中断交接回执或当前成果不匹配，保留现场');
        const evidence = core.safe(d.taskRoot, '_plan/process/' + opts.id + '/' + core.relativePath(prior.evidence));
        if (!ctx.read.text(evidence)?.trim() || units.load(ctx, d, prior.next_unit.file).sha256 !== prior.next_unit.sha256)
          core.fail('中断交接证据或下一工单已变化，保留现场');
        core.verify(ctx); finishYield(ctx, d, window, prior);
        return { code: 0, result: { action: 'yield', recovered: true, receipt: prior, handoff: true } };
      }
      if (d.stage?.last_dispatch_id === opts.dispatch && d.stage.state !== 'ready') core.fail('yield 状态不一致，保留现场待核实');
      core.verify(ctx); return { code: 0, result: { action: 'yield', duplicate: true, receipt: prior } };
    }
    const w = r.matching(d, opts.owner, opts.dispatch); r.readyTask(d);
    if (w.phase !== 'running' || d.stage?.state !== 'running' || d.stage.stage !== w.stage) core.fail('仅运行中的窗口可 yield');
    if (w.request.work_unit && !w.acknowledged_at && !opts['confirmed-stopped']) core.fail('短工单尚未 takeover 确认接管');
    if (opts['confirmed-stopped'] && !w.request.work_unit) core.fail('resume-yield 只恢复有界短工单；旧式窗口使用 interrupt/retry');
    const evidence = core.safe(d.taskRoot, '_plan/process/' + opts.id + '/' + core.relativePath(opts.evidence));
    if (!ctx.read.text(evidence)?.trim()) core.fail('yield 需要非空的完成/接续证据；--evidence 相对任务记录目录，实际读取：' + evidence);
    const next = units.load(ctx, d, opts['next-unit']); core.verify(ctx);
    r.event(d, 'yield', { owner: opts.owner, dispatch_id: opts.dispatch, stage: w.stage, evidence: opts.evidence, next_unit: next.file });
    const receipt = { task_id: opts.id, owner: opts.owner, dispatch_id: opts.dispatch, stage: w.stage, outcome: 'yield',
      evidence: opts.evidence, next_unit: next, session_id: w.session_id, head: d.head,
      ...(opts['confirmed-stopped'] ? { recovery: 'confirmed_stopped' } : {}),
      worktree_snapshot: core.projectState(d.taskRoot, ctx.root, !!ctx.common), at: new Date().toISOString() };
    r.atomic(r.receiptFile(ctx, opts.id, opts.dispatch), receipt, true);
    finishYield(ctx, d, w, receipt);
    return { code: 0, result: { action: 'yield', receipt, handoff: true } };
  }, false);
}
module.exports = { prepare, takeover, yieldUnit, brief };

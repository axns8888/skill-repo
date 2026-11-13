'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const core = require('./core.cjs');
const { fail, safe, git, context, verify, evaluate } = core;

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) fail(label + ' 必须为非空单行字符串');
  return value;
}
function atomic(file, data, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(data, null, 2) + '\n';
  if (exclusive) { fs.writeFileSync(file, bytes, { flag: 'wx' }); return; }
  const temp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, bytes, { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function writable(ctx, newWork = true) {
  if (!ctx.enabled) fail('autopilot 未启用');
  if (newWork && !ctx.cfg.execution.enabled) fail('execution.enabled 未开启；保持只读');
  if (ctx.common) {
    if (git(ctx.root, ['ls-files', '--', '_plan/autopilot/'])) fail('调度运行态不得被 Git 跟踪');
    if (git(ctx.root, ['check-ignore', '-q', '--', '_plan/autopilot/probe'], true) === null) fail('先在主检出目录忽略 /_plan/autopilot/');
  }
}
function locked(project, fn, newWork = true) {
  const before = context(project); writable(before, newWork); verify(before);
  const lock = before.common ? path.join(before.common, 'axns-devflow.lock') : safe(before.root, '_plan/autopilot/.lock');
  fs.mkdirSync(safe(before.root, '_plan/autopilot'), { recursive: true });
  try { fs.mkdirSync(lock); } catch (e) { if (e.code === 'EEXIST') fail('协调锁被占用：' + lock); throw e; }
  const owner = { token: randomUUID(), pid: process.pid, hostname: os.hostname(), command: 'autopilot-runner', started_at: new Date().toISOString() };
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
  try {
    const ctx = context(project, owner.token); writable(ctx, newWork);
    return fn(ctx);
  } finally {
    if (read(path.join(lock, 'owner.json'))?.token !== owner.token) fail('协调锁所有者变化，保留现场：' + lock);
    fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
  }
}
function task(ctx, taskId) {
  core.id(taskId);
  const d = ctx.detailed.find(v => v.task.task_id === taskId);
  if (!d) fail('任务未登记或已归档：' + taskId);
  return d;
}
function readyTask(d) {
  if (d.task.status !== 'claimed' || !d.task.holds_claims || d.deps.length || d.wait_exceeded) fail('任务未持权、被暂停、依赖未完成或等待超时');
}
function file(ctx, taskId, name) { return safe(ctx.root, '_plan/autopilot/' + taskId + '/' + name); }
function receiptFile(ctx, taskId, dispatchId) {
  if (!/^[a-f0-9]{64}$/.test(dispatchId || '')) fail('dispatch 必须为完整 dispatch_id');
  return file(ctx, taskId, 'receipts/' + dispatchId + '.json');
}
function event(d, action, detail, runtimeRoot = null) {
  const log = runtimeRoot ? safe(runtimeRoot, '_plan/autopilot/' + d.task.task_id + '/events.jsonl')
    : safe(d.taskRoot, '_plan/process/' + d.task.task_id + '/autopilot-events.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), action, ...detail }) + '\n');
}
function preflight(ctx, d) {
  readyTask(d);
  if (ctx.settings.worktree) {
    const helper = path.resolve(__dirname, '../../../axns-devflow-ext-worktree/scripts/worktree.cjs');
    if (!fs.existsSync(helper)) fail('缺少相邻 worktree 扩展，无法运行 check');
    const r = spawnSync(process.execPath, [helper, 'check', '--project', d.taskRoot, '--id', d.task.task_id],
      { cwd: d.taskRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (r.error || r.status !== 0) fail('worktree check 未通过：' + (r.error?.message || r.stderr || r.stdout));
  }
  verify(ctx);
}
function samePreflight(previous, current) {
  if (previous.head !== current.head || previous.worktreeSnapshot !== current.worktreeSnapshot ||
      JSON.stringify(previous.task) !== JSON.stringify(current.task)) fail('预检后任务发生变化，请重新执行');
}
function matching(d, owner, dispatchId) {
  text(owner, 'owner');
  if (!d.window || d.window.owner !== owner || d.window.dispatch_id !== dispatchId) fail('窗口 owner 或 dispatch 不匹配；拒绝旧回调');
  if (!d.window.request || d.window.request.dispatch_id !== dispatchId || d.window.request.owner !== owner ||
      d.window.request.task_id !== d.task.task_id || d.window.request.stage !== d.window.stage) fail('窗口缺少有效的 runner 派发请求；保留现场');
  return d.window;
}
const promptNames = { P0: 'P0-open', P1: 'P1-register', P2: 'P2-execute', P3: 'P3-review', P4: 'P4-accept' };
function order(ctx, d, decision, owner) {
  const stage = decision.next_stage;
  const host = path.resolve(__dirname, '../../../axns-devflow');
  const source = path.join(host, 'prompts/window/' + promptNames[stage] + '.md');
  if (!fs.existsSync(source)) fail('缺少宿主阶段提示词：' + source);
  const runner = path.resolve(__dirname, '../runner.cjs');
  const common = ['--project', ctx.root, '--id', d.task.task_id, '--owner', owner, '--dispatch', decision.dispatch_id];
  const callbacks = {
    heartbeat: [process.execPath, runner, 'heartbeat', ...common],
    complete: [process.execPath, runner, 'complete', ...common, '--evidence', '<任务记录目录内的真实证据相对路径>', '--handoff'],
    fail: [process.execPath, runner, 'fail', ...common, '--evidence', '<失败证据相对路径>', '--handoff'],
  };
  const prefix = [
    '使用 axns-devflow 及当前项目约定，执行本派发指定的一个阶段。',
    'task-id: ' + d.task.task_id, 'stage: ' + stage, '工作目录: ' + d.taskRoot,
    '计划与证据目录: _plan/process/' + d.task.task_id + '/',
    'DSH/Orca 原生任务清单使用本 task-id 关联项目计划，按本阶段更新进度；清单勾选不构成验收。',
    '若在 PyCharm 操作，打开本工单工作目录；跨工具继续执行前先核实原派发与执行权。',
    '任务已登记；沿用现有 task-id、计划、范围与授权。P1 仅核实和补齐现有登记，不重新创建任务。',
    '先读取项目 AGENTS.md、基线和本任务计划；沿用用户已授权的任务范围；worktree 任务自动提交、验收后本地合入、归档和删除本任务资源。外部发布及派生代理仍需各自授权。',
    '执行任何项目写入前先调用 callbacks.heartbeat，并在步骤间更新心跳；会话结束不等于阶段完成。',
    '只有成功标准和本阶段门禁均满足、真实证据已落盘时才调用 callbacks.complete；阻断或执行失败调用 callbacks.fail。',
    'callbacks 是可执行文件与字面参数数组，请按当前 shell 正确转义，不拼接 eval。',
    '回调中替换证据路径；P0 完成须依据适用的已有执行授权或本次确认传 --user-confirmed，并在证据中引用依据，无需重复询问。用户要求本次回报后等待时须等该确认。P4 须真实验证并提交 acceptance.md，complete 额外传 --accepted-head <最终HEAD> 声明技术验收；不能伪造人工确认。P4 窗口只回调交接，下一轮 claim/tick 自动从主目录 finish，避免删掉当前工作目录。',
    '--handoff 表示交接本阶段执行权：该命令是本轮最后一次项目写入，之后结束本轮，不自行领取其他任务。',
    'callbacks: ' + JSON.stringify(callbacks), '',
  ].join('\n');
  return { version: 1, task_id: d.task.task_id, stage, owner, dispatch_id: decision.dispatch_id,
    project: ctx.root, cwd: d.taskRoot, head: d.head, worktree_snapshot: d.worktreeSnapshot,
    route: decision.model, prompt: prefix + fs.readFileSync(source, 'utf8').replaceAll('{{task-id}}', d.task.task_id)
    .replaceAll('{{任务描述}}', '沿用 _plan/process/' + d.task.task_id + '/ 中现行计划的目标与范围'), callbacks };
}
function choose(ctx, taskId) {
  const assessed = evaluate(ctx);
  if (assessed.code) return assessed;
  const decision = assessed.result.decisions.find(v => v.action === 'advance' && (!taskId || v.task_id === taskId));
  if (!decision) return { code: 0, result: { action: 'hold', reason: 'no_dispatch', assessment: assessed.result } };
  return { code: 0, decision };
}
function routeMatches(route, actual) {
  return !route || actual && route.provider === actual.provider && route.model === actual.model &&
    (!route.reasoning || route.reasoning === actual.reasoning);
}
function finalize(project, opts = {}) {
  return locked(project, ctx => {
    const assessment = evaluate(ctx);
    if (assessment.code) return assessment;
    const decision = assessment.result.decisions.find(v => v.action === 'finish' && (!opts.id || v.task_id === opts.id));
    if (!decision) return { code: 0, result: { action: 'hold', reason: 'no_finish', assessment: assessment.result } };
    verify(ctx);
    const helper = require('../../../axns-devflow-ext-worktree/scripts/worktree.cjs');
    const args = { project: ctx.root, command: 'finish', id: decision.task_id, 'accepted-head': decision.accepted_head,
      ...(decision.human_accepted_by ? { 'human-accepted-by': decision.human_accepted_by } : {}) };
    // Already under the shared worktree/runner lock; helper performs all Git and archive checks again.
    const result = helper.finish(helper.context(args), args);
    return { code: 0, result: { action: 'finished', task: result } };
  });
}
function reserve(project, opts, adapter) {
  const initial = context(project); writable(initial);
  if (initial.cfg.execution.adapter !== adapter) fail('配置的 execution.adapter 与命令不匹配');
  if (evaluate(initial).result.decisions?.some(v => v.action === 'finish' && (!opts.id || opts.id === v.task_id))) return finalize(project, opts);
  const existing = initial.detailed.find(d => d.window?.owner === opts.owner);
  if (existing) {
    if (opts.id && opts.id !== existing.task.task_id) fail('同一 owner 不能绑定其他任务');
    // A repeat claim may inspect its own live request, but never silently revive a stalled worker.
    if (adapter !== 'session') fail('该 owner 已有派发；使用 recover 查询');
    matching(existing, opts.owner, existing.window.dispatch_id);
    if (!routeMatches(existing.window.request.route, opts.route)) fail('当前会话模型与派发路由不一致');
    preflight(initial, existing);
    return locked(project, ctx => {
      const assessment = evaluate(ctx);
      if (assessment.code) { verify(ctx); return assessment; }
      const current = task(ctx, existing.task.task_id);
      matching(current, opts.owner, existing.window.dispatch_id); samePreflight(existing, current);
      if (current.stage?.state !== 'running' || current.window.phase !== 'running') fail('该派发需要恢复，不可重复领取');
      verify(ctx);
      return { code: 0, result: { action: 'claimed', resumed: true, request: current.window.request } };
    });
  }
  const picked = choose(initial, opts.id); if (!picked.decision) { verify(initial); return picked; }
  if (adapter === 'session' && !routeMatches(picked.decision.model, opts.route)) {
    verify(initial); return { code: 2, result: { action: 'hold', reason: 'session_model_mismatch', required_route: picked.decision.model } };
  }
  const beforeTask = task(initial, picked.decision.task_id); preflight(initial, beforeTask);
  return locked(project, ctx => {
    const selected = choose(ctx, opts.id);
    if (!selected.decision) { verify(ctx); return selected; }
    if (selected.decision.dispatch_id !== picked.decision.dispatch_id) fail('派发身份已变化，请重新判定');
    if (ctx.detailed.some(d => d.window?.owner === opts.owner)) fail('owner 已占用窗口');
    const d = task(ctx, selected.decision.task_id); samePreflight(beforeTask, d);
    // Retained receipts also bind owners after a task is archived.
    const runtimeRoot = safe(ctx.root, '_plan/autopilot');
    for (const otherId of fs.readdirSync(runtimeRoot)) {
      if (otherId.startsWith('.') || otherId === d.task.task_id) continue;
      core.id(otherId);
      const otherWindow = read(file(ctx, otherId, 'window.json'));
      if (otherWindow?.owner === opts.owner) fail('该 owner 已用于其他任务，请使用独立会话');
      const receipts = file(ctx, otherId, 'receipts');
      if (fs.existsSync(receipts) && fs.readdirSync(receipts).some(name => {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) fail('无效回执文件');
        return read(safe(ctx.root, '_plan/autopilot/' + otherId + '/receipts/' + name))?.owner === opts.owner;
      })) fail('该 owner 已用于其他任务，请使用独立会话');
    }
    const request = order(ctx, d, selected.decision, opts.owner);
    verify(ctx);
    const now = new Date().toISOString();
    const window = { task_id: d.task.task_id, stage: request.stage, dispatch_id: request.dispatch_id,
      owner: opts.owner, opened_at: now, heartbeat_at: now, phase: adapter === 'session' ? 'running' : 'reserved',
      adapter, execution: ctx.cfg.execution, initial_stage: d.stage, request };
    // Exclusive reservation is the durable request; a crash after this point must be recovered, never re-started blindly.
    atomic(file(ctx, d.task.task_id, 'window.json'), window, true);
    event(d, 'reserved', { owner: opts.owner, dispatch_id: request.dispatch_id, stage: request.stage, adapter });
    if (adapter === 'session') atomic(file(ctx, d.task.task_id, 'stage.json'), {
      task_id: d.task.task_id, stage: request.stage, state: 'running', owner: opts.owner, updated_at: now,
      attempts: d.stage.stage === request.stage ? d.stage.attempts ?? 0 : 0 });
    return { code: 0, result: { action: adapter === 'session' ? 'claimed' : 'reserved', request } };
  });
}
function initialize(project, opts) {
  core.id(opts.id); text(opts.owner, 'owner');
  if (!core.STAGES.slice(0, 5).includes(opts.stage)) fail('init stage 允许 P0–P4');
  return locked(project, ctx => {
    const d = task(ctx, opts.id); readyTask(d);
    if (d.stage || d.window) fail('运行态已存在；init 不覆盖完成、失败或活动阶段');
    verify(ctx);
    atomic(file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: opts.stage, state: 'ready', owner: opts.owner,
      updated_at: new Date().toISOString(), attempts: 0 }, true);
    return { code: 0, result: { action: 'initialized', task_id: opts.id, stage: opts.stage } };
  });
}
function retry(project, opts) {
  text(opts.owner, 'owner');
  const initial = context(project); writable(initial);
  const before = task(initial, opts.id); preflight(initial, before);
  return locked(project, ctx => {
    const d = task(ctx, opts.id); readyTask(d); samePreflight(before, d);
    if (d.window) fail('仍有活动或待核实窗口；先完成 handoff 或核实停止后 interrupt');
    if (d.stage?.state !== 'failed') fail('retry 只恢复 failed 阶段');
    if (Math.max(1, d.stage.attempts ?? 0) >= ctx.cfg.max_attempts) fail('已达 max_attempts；处理根因并显式调整项目重试预算后再评估');
    const previous = read(receiptFile(ctx, opts.id, opts.dispatch));
    if (!previous || !['fail', 'interrupt'].includes(previous.outcome) || previous.stage !== d.stage.stage ||
        previous.task_id !== opts.id || previous.dispatch_id !== opts.dispatch || previous.owner !== d.stage.owner ||
        previous.at !== d.stage.updated_at || previous.evidence !== d.stage.evidence ||
        (d.stage.last_dispatch_id && d.stage.last_dispatch_id !== opts.dispatch)) fail('重试必须引用当前失败阶段的原始回执');
    const evidence = safe(d.taskRoot, '_plan/process/' + opts.id + '/' + core.relativePath(opts.evidence));
    if (!ctx.read.text(evidence)?.trim()) fail('重试需要非空的原因处理与授权依据');
    verify(ctx);
    event(d, 'retry', { controller: opts.owner, previous_dispatch_id: opts.dispatch, stage: d.stage.stage, evidence: opts.evidence });
    atomic(file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: d.stage.stage, state: 'ready', owner: opts.owner,
      updated_at: new Date().toISOString(), attempts: Math.max(1, d.stage.attempts ?? 0), retry_of: opts.dispatch, retry_evidence: opts.evidence });
    return { code: 0, result: { action: 'retry_ready', task_id: opts.id, stage: d.stage.stage, previous_dispatch_id: opts.dispatch } };
  });
}
function callback(project, command, opts) {
  const initial = context(project); writable(initial, false);
  const d0 = task(initial, opts.id);
  const prior = read(receiptFile(initial, opts.id, opts.dispatch));
  if (prior && (!d0.window || d0.window.dispatch_id !== opts.dispatch)) {
    if (prior.owner !== opts.owner || prior.outcome !== command || prior.evidence !== opts.evidence) fail('回调与已完成回执不匹配');
    verify(initial); return { code: prior.outcome === 'fail' ? 2 : 0, result: { action: prior.outcome, duplicate: true, receipt: prior } };
  }
  matching(d0, opts.owner, opts.dispatch);
  if (command === 'complete') preflight(initial, d0); else verify(initial);
  return locked(project, ctx => {
    const d = task(ctx, opts.id), w = matching(d, opts.owner, opts.dispatch);
    samePreflight(d0, d);
    if (command === 'heartbeat') {
      const now = new Date().toISOString();
      if (w.phase === 'reserved' && w.adapter === 'command') {
        readyTask(d);
        if (JSON.stringify(d.stage) !== JSON.stringify(w.initial_stage)) fail('启动期间阶段发生变化');
        verify(ctx);
        atomic(file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: w.stage, state: 'running', owner: opts.owner,
          updated_at: now, attempts: w.initial_stage.stage === w.stage ? w.initial_stage.attempts ?? 0 : 0 });
      } else {
        if (d.stage?.state !== 'running' || d.stage.stage !== w.stage || w.phase !== 'running') fail('窗口不在 running');
        verify(ctx);
      }
      atomic(file(ctx, opts.id, 'window.json'), { ...w, phase: 'running', heartbeat_at: now });
      return { code: 0, result: { action: 'heartbeat', dispatch_id: opts.dispatch } };
    }
    let acceptance;
    if (command === 'complete' && w.stage === 'P4' && ctx.settings.worktree) {
      if (opts['accepted-head'] !== d.head) fail('P4 complete 需要 --accepted-head 指向已验证的当前 HEAD');
      const evidenceText = ctx.read.text(safe(d.taskRoot, '_plan/process/' + opts.id + '/acceptance.md'));
      if (!evidenceText?.trim() || git(d.taskRoot, ['show', d.head + ':_plan/process/' + opts.id + '/acceptance.md'], true) !== evidenceText.trimEnd()) fail('P4 acceptance.md 必须真实、非空且已提交');
      if (git(d.taskRoot, ['status', '--porcelain', '--untracked-files=all', '--ignored', '--ignore-submodules=none'])) fail('P4 工作区尚未清理');
      acceptance = { result: 'passed', accepted_head: d.head };
    }
    const existingReceipt = read(receiptFile(ctx, opts.id, opts.dispatch));
    if (d.stage?.stage !== w.stage || !['running', 'completed', 'failed'].includes(d.stage.state) || w.phase !== 'running' ||
        d.stage.state !== 'running' && !existingReceipt) fail('阶段与派发不一致；先恢复运行态');
    const evidence = safe(d.taskRoot, '_plan/process/' + opts.id + '/' + core.relativePath(opts.evidence));
    if (!ctx.read.text(evidence)?.trim()) fail('证据文件不能为空');
    if (command === 'complete' && w.stage === 'P0' && !opts.user_confirmed) fail('P0 完成需核实适用的执行授权并传 --user-confirmed；已有授权有效，明确要求本次确认时须等待');
    verify(ctx);
    const old = existingReceipt;
    let receipt;
    if (old) {
      if (old.owner !== opts.owner || old.outcome !== command || old.evidence !== opts.evidence ||
          old.head !== d.head || old.worktree_snapshot !== d.worktreeSnapshot) fail('已有回执与当前成果不一致，保留现场');
      receipt = old;
      if (d.stage.state === (command === 'complete' ? 'completed' : 'failed')) {
        // Preserve acceptance metadata written after the original callback.
        if (opts.handoff) fs.unlinkSync(file(ctx, opts.id, 'window.json'));
        return { code: command === 'fail' ? 2 : 0, result: { action: command, duplicate: true, handoff: !!opts.handoff, receipt } };
      }
    } else {
      event(d, command, { owner: opts.owner, dispatch_id: opts.dispatch, stage: w.stage, evidence: opts.evidence }, acceptance ? ctx.root : null);
      receipt = { task_id: opts.id, owner: opts.owner, dispatch_id: opts.dispatch, stage: w.stage, outcome: command,
        evidence: opts.evidence, head: d.head, worktree_snapshot: core.projectState(d.taskRoot, ctx.root, !!ctx.common),
        at: new Date().toISOString() };
      atomic(receiptFile(ctx, opts.id, opts.dispatch), receipt, true);
    }
    const stage = { task_id: opts.id, stage: w.stage, state: command === 'complete' ? 'completed' : 'failed',
      owner: opts.owner, updated_at: receipt.at, attempts: (d.stage.attempts ?? 0) + (command === 'fail' ? 1 : 0),
      last_dispatch_id: opts.dispatch, evidence: opts.evidence };
    if (command === 'complete') Object.assign(stage, { completed_head: receipt.head, completed_worktree: receipt.worktree_snapshot,
      ...(w.stage === 'P0' ? { user_confirmed: true } : {}), ...(acceptance ? { acceptance } : {}),
      ...(acceptance && opts['human-accepted-by']?.trim() ? { human_acceptance: { result: 'passed', accepted_by: opts['human-accepted-by'], accepted_head: d.head } } : {}) });
    atomic(file(ctx, opts.id, 'stage.json'), stage);
    if (opts.handoff) fs.unlinkSync(file(ctx, opts.id, 'window.json'));
    return { code: command === 'fail' ? 2 : 0, result: { action: command, handoff: !!opts.handoff, receipt } };
  }, false);
}
function handoff(project, opts) {
  return locked(project, ctx => {
    const d = task(ctx, opts.id), w = matching(d, opts.owner, opts.dispatch);
    const receipt = read(receiptFile(ctx, opts.id, opts.dispatch));
    if (!receipt || !['completed', 'failed'].includes(d.stage?.state) || d.stage.stage !== w.stage ||
        receipt.head !== d.head || receipt.worktree_snapshot !== d.worktreeSnapshot ||
        receipt.owner !== opts.owner || receipt.dispatch_id !== opts.dispatch) fail('缺少与当前成果匹配的完成/失败回执');
    verify(ctx); fs.unlinkSync(file(ctx, opts.id, 'window.json'));
    return { code: 0, result: { action: 'handoff', dispatch_id: opts.dispatch } };
  }, false);
}
function interrupt(project, opts) {
  return locked(project, ctx => {
    const d = task(ctx, opts.id), w = matching(d, opts.owner, opts.dispatch);
    if (read(receiptFile(ctx, opts.id, opts.dispatch))) fail('已有结果回执，核实成果后使用 handoff，不覆盖为中断');
    const evidence = safe(d.taskRoot, '_plan/process/' + opts.id + '/' + core.relativePath(opts.evidence));
    if (!ctx.read.text(evidence)?.trim()) fail('中断恢复需要非空的会话停止核实证据');
    verify(ctx);
    event(d, 'interrupted', { owner: opts.owner, dispatch_id: opts.dispatch, evidence: opts.evidence });
    const receipt = { task_id: opts.id, owner: opts.owner, dispatch_id: opts.dispatch, stage: w.stage, outcome: 'interrupt',
      evidence: opts.evidence, head: d.head, worktree_snapshot: core.projectState(d.taskRoot, ctx.root, !!ctx.common),
      at: new Date().toISOString() };
    atomic(receiptFile(ctx, opts.id, opts.dispatch), receipt, true);
    atomic(file(ctx, opts.id, 'stage.json'), { task_id: opts.id, stage: w.stage, state: 'failed', owner: opts.owner,
      updated_at: receipt.at, attempts: (d.stage?.stage === w.stage ? d.stage.attempts ?? 0 : 0) + 1, last_dispatch_id: opts.dispatch, evidence: opts.evidence });
    fs.unlinkSync(file(ctx, opts.id, 'window.json'));
    return { code: 2, result: { action: 'interrupted', receipt, reason: 'stage_requires_review' } };
  }, false);
}
module.exports = { text, atomic, read, writable, locked, task, readyTask, file, receiptFile, event, preflight,
  samePreflight, matching, finalize, reserve, initialize, callback, handoff, interrupt, retry };

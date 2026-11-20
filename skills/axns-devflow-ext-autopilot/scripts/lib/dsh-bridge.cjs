'use strict';
// One-shot DSH sessions hosted directly or by Orca command terminals. A journaled start is never repeated.
const fs = require('node:fs'), path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const core = require('./core.cjs'), runtime = require('./runtime.cjs');
const dsh = require('../dsh-session.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function journalFile(ctx, id, dispatch) {
  const files = ['dsh', 'orca'].map(platform => core.safe(ctx.root, '_plan/autopilot/' + id + '/' + platform + '/' + dispatch + '.json'));
  const found = files.filter(file => fs.existsSync(file));
  if (found.length > 1) throw Error('同一派发存在多个执行平台记录，保留持权并停止自动推进');
  return found[0] ?? files[0];
}
function paths(ctx, request, platform = 'orca') {
  if (!['dsh', 'orca'].includes(platform)) throw Error('无效DSH承载平台');
  const base = core.safe(ctx.root, '_plan/autopilot/' + request.task_id + '/' + platform);
  const directory = core.safe(base, request.dispatch_id + '.dsh');
  return { directory, manifest: core.safe(directory, 'manifest.json'), process: core.safe(directory, 'process.json') };
}
function prepare(ctx, request, opts, requestFile, journal) {
  if (!opts.dshBin) throw Error('需要 --dsh-bin 指定本机DSH入口');
  const files = paths(ctx, request, opts.platform ?? 'orca'); fs.mkdirSync(files.directory, { recursive: true });
  const launch = { project: request.cwd, 'dsh-bin': fs.realpathSync(opts.dshBin), profile: opts.dshProfile ?? 'headless' };
  const rows = dsh.dump(launch), telemetry = { dshBin: launch['dsh-bin'], directory: path.join(files.directory, 'context'),
    canDelegate: !!request.team?.enabled, canStartNewSession: true, rootProcessFile: files.process };
  const scenePlan = require('./dsh-scenes.cjs').build(request.dsh_children);
  const patches = dsh.overlay(rows, request.route, request.team, { children: request.dsh_children, telemetry });
  const patchFile = path.join(files.directory, 'launch.patch.json'), promptFile = path.join(files.directory, 'prompt.txt');
  runtime.atomic(patchFile, patches, true);
  dsh.verify(dsh.dump(launch, patchFile), request.route, request.team, { children: request.dsh_children, telemetry });
  const prompt = [
    'AXNS_DISPATCH=' + request.dispatch_id,
    '执行已授权任务的一份短工单。当前是全新DSH会话，不读取旧对话、不自行创建窗口或接下一工单。',
    '监督进程从本进程JSON事件取得真实session身份并执行takeover；首先读取：' + files.process,
    '只有takeover_confirmed=true且work_permitted=true才能业务写入。未就绪时再次读取；错误或拒绝时停止。不要另行执行takeover。',
    '读取适用AGENTS.md和以下派发JSON，按work_unit、prompt和callbacks执行：' + requestFile,
    '工单输入和写入范围相对cwd；--evidence/--next-unit相对JSON.record_dir，例如evidence.md/unit2.json。',
    'heartbeat必须带累计steps，在步骤/时间预算边界落盘证据并yield。只有整个阶段门禁满足才complete --handoff。',
    'yield或complete --handoff是本会话最后一次项目写入；回调成功后结束，不轮询、不续领。控制器将在进程退出后启动下一新会话。',
    '使用devflow_context获取当前上下文和建议；在大批读取、独立派发和阶段边界提供下一动作成本、检查点与执行状态。它不能替代真实停稳/接管。',
    ...(scenePlan.scenes.length ? ['本次已配置的场景工具（渠道仍须实际核实）：' + JSON.stringify(scenePlan.scenes)] : []),
    '大日志落文件，只读必要片段。团队协作按任务已有授权及本次配置执行，成员只承担分配范围，runner回调由唯一主执行者负责。',
    ...(request.team?.enabled && request.team.mode === 'subagent' ? [dsh.nativeInstructions()] : []),
  ].join('\n');
  fs.writeFileSync(promptFile, prompt, { flag: 'wx' });
  const manifest = { version: 1, request_file: requestFile, request_sha256: hash(JSON.stringify(request)), journal,
    project: request.project, cwd: request.cwd, process_file: files.process, profile: launch.profile,
    dsh_bin: launch['dsh-bin'], dsh_home: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
    patch_file: patchFile, patch_sha256: hash(fs.readFileSync(patchFile)),
    prompt_file: promptFile, prompt_sha256: hash(prompt), route: request.route, team: request.team,
    context_directory: telemetry.directory, scenes: scenePlan.scenes,
    ...(request.launch_context ? { launch_context: request.launch_context } : {}), verification: 'composed_config_only' };
  runtime.atomic(files.manifest, manifest, true); core.verify(ctx);
  return { ...files, sha256: hash(JSON.stringify(manifest, null, 2) + '\n') };
}
function command(manifest) {
  const worker = path.resolve(__dirname, '../dsh-worker.cjs');
  const args = [process.execPath, worker, '--manifest', manifest];
  const quote = process.platform === 'win32' ? value => "'" + value.replaceAll("'", "''") + "'" : value => "'" + value.replaceAll("'", "'\\''") + "'";
  return (process.platform === 'win32' ? '& ' : 'exec ') + args.map(quote).join(' ');
}
function status(request, record) {
  const files = { process: record.dsh_process };
  if (!files.process) return { state: 'unknown', reason: 'dsh_start_record_incomplete' };
  const value = runtime.read(files.process);
  if (!value) return { state: 'unknown', reason: 'dsh_starting' };
  if (value.dispatch_id !== request.dispatch_id || value.request_sha256 !== record.request_sha256)
    return { state: 'unknown', reason: 'dsh_process_identity_mismatch' };
  if (value.state === 'stopped') return { state: 'stopped', reason: 'dsh_process_closed_without_business_receipt',
    ...(value.session_id ? { session_id: value.session_id } : {}) };
  if (value.state !== 'running' || !value.session_id || !value.takeover_confirmed)
    return { state: 'unknown', reason: 'dsh_starting' };
  try { process.kill(value.pid, 0); process.kill(value.child_pid, 0); }
  catch { return { state: 'unknown', reason: 'dsh_process_liveness_unconfirmed' }; }
  return { state: 'running', session_id: value.session_id,
    ...(record.launch_route ? { effective_route: record.launch_route } : {}),
    ...(record.launch_team ? { effective_team: record.launch_team } : {}) };
}
function previous(ctx, d) {
  const dispatch = d.stage?.last_dispatch_id;
  if (!dispatch || !/^[a-f0-9]{64}$/.test(dispatch)) return null;
  const record = runtime.read(journalFile(ctx, d.task.task_id, dispatch));
  if (record?.launch_executor !== 'dsh') return null;
  const value = record.dsh_process ? runtime.read(record.dsh_process) : null;
  return value?.state === 'stopped' && value.final_quiescent && value.session_id === d.stage.last_session_id &&
    value.dispatch_id === dispatch && value.request_sha256 === record.request_sha256
    ? null : 'dsh_previous_worker_draining';
}
function recoverStopped(ctx, d) {
  const w = d.window;
  if (w?.request.route?.executor !== 'dsh') return null;
  const record = runtime.read(journalFile(ctx, d.task.task_id, w.dispatch_id));
  const value = record?.dsh_process ? runtime.read(record.dsh_process) : null;
  if (value?.state !== 'stopped' || value.dispatch_id !== w.dispatch_id || value.request_sha256 !== record.request_sha256 ||
      value.session_id !== w.session_id || !value.takeover_confirmed) return null;
  try { process.kill(value.child_pid, 0); return null; } catch (error) { if (error.code !== 'ESRCH') return null; }
  const opts = { id: d.task.task_id, owner: w.owner, dispatch: w.dispatch_id, 'confirmed-stopped': true };
  const receipt = runtime.read(runtime.receiptFile(ctx, opts.id, opts.dispatch));
  if (receipt?.outcome === 'yield') return require('./continuation.cjs').yieldUnit(ctx.root,
    { ...opts, evidence: receipt.evidence, 'next-unit': receipt.next_unit.file });
  if (receipt && ['complete', 'fail'].includes(receipt.outcome)) return runtime.handoff(ctx.root, opts);
  if (receipt || !value.final_quiescent || value.final_reason?.kind !== 'error' ||
      !/AXNS_CONTEXT_LIMIT|context.{0,30}(length|limit|window|exceed)|input.{0,20}token.{0,20}(limit|exceed)|上下文.{0,12}(超|限)/i.test(JSON.stringify(value.final_reason))) return null;
  // A final event is emitted by this version of the one-shot runner only after agent/subagent quiescence.
  // A missing final event or a merely stale heartbeat never authorizes recovery.
  const directory = core.safe(ctx.root, '_plan/autopilot/' + opts.id + '/dsh-recovery');
  fs.mkdirSync(directory, { recursive: true });
  const previousRecoveries = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
    .map(name => runtime.read(core.safe(directory, name))).filter(item => item.stage === w.stage && item.dispatch_id !== w.dispatch_id);
  if (previousRecoveries.length >= ctx.cfg.max_attempts) return { code: 2, result: { action: 'hold', reason: 'dsh_recovery_limit' } };
  const reportFile = core.safe(directory, w.dispatch_id + '.json');
  const name = 'dsh-recovery-' + w.dispatch_id.slice(0, 12);
  const recordDir = core.safe(d.taskRoot, '_plan/process/' + opts.id);
  const unitFile = name + '.json', evidenceFile = name + '.md';
  const unit = { ...w.request.work_unit.spec, id: name,
    goal: ('核对上一会话已有成果后继续：' + w.request.work_unit.spec.goal).slice(0, 2000),
    budget: { ...w.request.work_unit.spec.budget, max_steps: Math.min(12, w.request.work_unit.spec.budget.max_steps),
      max_minutes: Math.min(20, w.request.work_unit.spec.budget.max_minutes) } };
  const writeOrMatch = (file, text) => {
    if (fs.existsSync(file)) { if (fs.readFileSync(file, 'utf8') !== text) throw Error('已有DSH恢复证据变化，保留现场'); }
    else fs.writeFileSync(file, text, { flag: 'wx' });
  };
  core.verify(ctx);
  writeOrMatch(core.safe(recordDir, unitFile), JSON.stringify(unit, null, 2) + '\n');
  writeOrMatch(core.safe(recordDir, evidenceFile), ['DSH context-limit recovery', 'dispatch: ' + w.dispatch_id,
    'session: ' + value.session_id, 'process_closed: ' + value.closed_at,
    'final_error_code: ' + (value.final_reason.error?.code ?? 'unknown'),
    '原进程已退出且一次性runner已报告静止终态；未声称原工单完成。新工单先核对既有成果，不读取旧会话全文。', ''].join('\n'));
  writeOrMatch(reportFile, JSON.stringify({ dispatch_id: w.dispatch_id, stage: w.stage, session_id: value.session_id, evidence: evidenceFile, next_unit: unitFile }, null, 2) + '\n');
  return require('./continuation.cjs').yieldUnit(ctx.root, { ...opts, evidence: evidenceFile, 'next-unit': unitFile });
}
module.exports = { journalFile, paths, prepare, command, status, previous, recoverStopped, hash };

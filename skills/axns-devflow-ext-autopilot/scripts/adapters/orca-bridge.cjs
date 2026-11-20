#!/usr/bin/env node
'use strict';
// Local Orca bridge. Dispatch intent is durable before any launch; an uncertain launch is query-only.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const core = require('../lib/core.cjs');
const runtime = require('../lib/runtime.cjs');
const units = require('../lib/units.cjs');
const { acquire } = require('../lib/process-lock.cjs');
function options(argv) {
  const result = { cli: process.env.ORCA_CLI_COMMAND || (process.platform === 'linux' ? 'orca-ide' : 'orca'), prefix: [], bindings: {} };
  while (argv.length) {
    const flag = argv.shift(), value = argv.shift();
    if (!value || !['--orca-file', '--orca-arg', '--provider', '--binding', '--dsh-bin', '--dsh-profile'].includes(flag)) throw Error('使用 --orca-file <可执行文件> [--binding <codex|claude>=<渠道>] [--dsh-bin <DSH入口>] [--dsh-profile headless]');
    if (flag === '--orca-file') result.cli = value;
    else if (flag === '--provider') {
      if (result.bindings.codex || !value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) throw Error('无效或重复 --provider');
      result.provider = value;
      result.bindings.codex = value;
    } else if (flag === '--binding') {
      const match = /^(codex|claude)=(.+)$/.exec(value);
      if (!match || !match[2].trim() || match[2].length > 256 || /[\r\n\0]/.test(value) || result.bindings[match[1]])
        throw Error('无效或重复 --binding；需要 codex|claude=当前供应商');
      result.bindings[match[1]] = match[2];
    } else if (flag === '--dsh-bin') {
      if (result.dshBin) throw Error('重复 --dsh-bin'); result.dshBin = fs.realpathSync(value);
    } else if (flag === '--dsh-profile') {
      if (result.dshProfile || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw Error('无效或重复 --dsh-profile'); result.dshProfile = value;
    } else result.prefix.push(value);
  }
  return result;
}
function cli(opts, args, cwd) {
  const value = spawnSync(opts.cli, [...opts.prefix, ...args, '--environment', 'local', '--json'], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 512 * 1024,
  });
  if (value.error) throw Error(value.error.message);
  let decoded;
  try { decoded = JSON.parse(value.stdout); } catch { throw Error('Orca 未返回有效 JSON，exit=' + value.status); }
  if (value.status !== 0 || decoded.ok === false) throw Error(decoded.error?.message || 'Orca exit=' + value.status);
  return decoded.result ?? decoded;
}
function samePath(a, b) { return fs.realpathSync(a) === fs.realpathSync(b); }
function unsupported(request, opts) {
  const agent = request.route?.executor ?? 'codex';
  if (agent === 'dsh') return opts.dshBin ? null : 'dsh_entry_required';
  if (!['codex', 'claude'].includes(agent)) return 'native_executor_unsupported';
  if (request.team) return 'native_team_unsupported';
  const binding = opts.bindings?.[agent] ?? (agent === 'codex' ? opts.provider : undefined);
  if (request.route && request.route.provider !== binding) return 'native_provider_binding_required';
  return null;
}
function sessionFromAgent(agent) {
  const handle = agent.paneKey?.split(':')[0];
  if (!handle?.startsWith('structured-agent-session-')) return null;
  return { handle, session_id: handle.slice('structured-agent-session-'.length) };
}
function query(opts, request, record) {
  if (record.launch_executor === 'dsh') return require('../lib/dsh-bridge.cjs').status(request, record);
  const result = cli(opts, ['worktree', 'ps', '--limit', '200'], request.cwd);
  const matches = (result.worktrees ?? []).filter(w => w.hostId === 'local' && samePath(w.path, request.cwd))
    .flatMap(w => w.agents ?? []).filter(agent => record.handle
      ? agent.paneKey?.split(':')[0] === record.handle
      : agent.prompt?.includes('AXNS_DISPATCH=' + request.dispatch_id));
  if (matches.length !== 1) return { state: 'unknown', reason: '平台会话身份未唯一确认；保留原启动意图，禁止再次 start' };
  const identity = sessionFromAgent(matches[0]);
  if (!identity || record.session_id && record.session_id !== identity.session_id)
    return { state: 'unknown', reason: '平台会话身份格式或原回执不匹配' };
  const agent = request.route?.executor ?? 'codex';
  if ((record.launch_executor ?? 'codex') !== agent ||
      (request.route?.executor || matches[0].agentType) && matches[0].agentType !== agent)
    return { state: 'unknown', reason: '平台执行端与原启动记录不匹配；保留原会话，不重新启动' };
  // A completed chat turn is not proof that the session can never write again.
  if (matches[0].state === 'done' || matches[0].interrupted || matches[0].mainAgent?.outcome === 'error')
    return { ...identity, state: 'unknown', reason: '平台回合已结束或中断；不能据此交权或判定阶段完成' };
  if (request.route && JSON.stringify(record.launch_route) !== JSON.stringify(request.route))
    return { state: 'unknown', reason: '缺少原启动模型参数记录；不能确认路由' };
  return { ...identity, state: 'running', ...(record.launch_route ? { effective_route: record.launch_route } : {}) };
}
function handle(payload, opts) {
  const request = payload.request;
  if (payload.version !== 1 || !['start', 'query'].includes(payload.operation) || !request) throw Error('无效桥请求');
  core.id(request.task_id);
  if (!/^[a-f0-9]{64}$/.test(request.dispatch_id)) throw Error('无效 dispatch_id');
  const response = value => ({ version: 1, dispatch_id: request.dispatch_id, state: value.state,
    ...(value.session_id ? { session_id: value.session_id } : {}), ...(value.reason ? { reason: value.reason } : {}),
    ...(value.effective_route ? { effective_route: value.effective_route } : {}),
    ...(value.effective_team ? { effective_team: value.effective_team } : {}) });
  const ctx = core.context(request.project), d = runtime.task(ctx, request.task_id);
  runtime.writable(ctx, payload.operation === 'start');
  const window = runtime.matching(d, request.owner, request.dispatch_id);
  if (window.adapter !== 'command' || JSON.stringify(window.request) !== JSON.stringify(request) || !samePath(request.cwd, d.taskRoot))
    throw Error('请求与 runner 原派发不一致');
  const directory = core.safe(ctx.root, '_plan/autopilot/' + request.task_id + '/orca');
  fs.mkdirSync(directory, { recursive: true });
  const journal = core.safe(directory, request.dispatch_id + '.json');
  const requestFile = core.safe(directory, request.dispatch_id + '.request.json');
  const lock = core.safe(ctx.root, '_plan/autopilot/' + request.task_id + '/' + request.dispatch_id + '.launch.lock');
  let release;
  try { release = acquire(lock); }
  catch (error) { return response({ state: 'unknown', reason: error.message }); }
  try {
    const other = core.safe(ctx.root, '_plan/autopilot/' + request.task_id + '/dsh/' + request.dispatch_id + '.json');
    if (fs.existsSync(other)) throw Error('派发已有直接DSH启动记录；禁止跨平台重复启动');
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    let record = runtime.read(journal);
    if (record && record.request_sha256 !== digest) throw Error('平台回执与不可变派发请求不匹配');
    if (record) {
      const value = query(opts, request, record);
      runtime.atomic(journal, { ...record, ...value, checked_at: new Date().toISOString() });
      return response(value);
    }
    if (payload.operation === 'query') return response({ state: 'unknown', reason: '缺少平台启动意图；无法权威确认未启动' });
    const refusal = unsupported(request, opts);
    if (refusal) return response({ state: 'absent', reason: refusal });
    if (!request.work_unit) return response({ state: 'absent', reason: 'Orca 连续执行桥要求短工单' });
    units.validate(request.work_unit);
    if (Buffer.byteLength(JSON.stringify(request)) > 65536)
      return response({ state: 'absent', reason: '派发请求超过 64 KiB；先缩小工单和提示' });
    const shown = cli(opts, ['worktree', 'show', '--worktree', 'path:' + request.cwd], request.cwd).worktree;
    if (!shown || shown.hostId !== 'local' || !samePath(shown.path, request.cwd))
      return response({ state: 'absent', reason: '需要已登记且目录完全匹配的本机 Orca 工作区' });
    let prepared = null;
    if (request.route?.executor === 'dsh') prepared = require('../lib/dsh-bridge.cjs').prepare(ctx, request, opts, requestFile, journal);
    core.verify(ctx);
    runtime.atomic(requestFile, request, true);
    record = { version: 1, dispatch_id: request.dispatch_id, request_sha256: digest,
      state: 'starting', created_at: new Date().toISOString(), request_file: requestFile,
      launch_executor: request.route?.executor ?? 'codex',
      launch_route: request.route ?? null, route_evidence: prepared ? 'dsh_composed_config_and_session_event' : request.route ? 'orca_launch_options_with_configured_provider_binding' : 'inherited',
      ...(prepared ? { launch_team: request.team, dsh_process: prepared.process, dsh_manifest: prepared.manifest, dsh_manifest_sha256: prepared.sha256 } : {}) };
    runtime.atomic(journal, record, true);
    if (prepared) {
      const dshBridge = require('../lib/dsh-bridge.cjs');
      const terminal = cli(opts, ['terminal', 'create', '--worktree', 'path:' + request.cwd,
        '--title', 'DSH ' + request.work_unit.spec.id, ...(process.platform === 'win32' ? ['--shell', 'powershell.exe'] : []),
        '--command', dshBridge.command(prepared.manifest)], request.cwd);
      record = { ...record, terminal_receipt: terminal };
      runtime.atomic(journal, record);
      return response(dshBridge.status(request, record));
    }
    const prompt = [
      'AXNS_DISPATCH=' + request.dispatch_id,
      '执行已授权任务的一个短工单，然后结束本会话；不得自行派生窗口或领取下一工单。',
      'cwd: ' + request.cwd,
      '先按需读取适用 AGENTS.md，再读取以下本地派发 JSON（最多 64 KiB，不加载旧会话历史）：', requestFile,
      '按 JSON 中的 prompt、work_unit 与 callbacks 执行；沿用原 task-id、阶段、范围和授权。',
      '回调 --evidence/--next-unit 相对 JSON.record_dir，只填例如 first.md/unit2.json，不带 _plan/process/task-id/ 前缀；--steps 替换为累计完成步数。',
      '真实平台启动回执：' + journal,
      '从回执读取 session_id，原样传给 callbacks.takeover；无 session_id 时停止并报告，禁止猜测身份或业务写入。',
      'takeover 成功且 work_permitted 不为 false 后才能业务写入。按短工单步骤/时间预算在检查点 heartbeat。',
      'yield 或 complete --handoff 是最后一次项目写入；成功后直接向用户报告摘要并结束本回合。',
      '下一工单由本地控制器启动全新会话，本会话不等待、轮询或自动续领。',
    ].join('\n');
    const routeArgs = request.route ? ['--model', request.route.model,
      ...(request.route.reasoning ? ['--effort', request.route.reasoning] : [])] : [];
    const launched = cli(opts, ['agent', 'launch', '--agent', record.launch_executor, '--worktree', 'path:' + request.cwd, ...routeArgs, '--prompt', prompt], request.cwd);
    const launch = launched.launch ?? launched;
    const identity = { session_id: launch.outcome?.sessionId, handle: launch.outcome?.handle };
    record = { ...record, ...identity, operation_id: launch.operationId, launch_receipt: launch.receipt,
      prompt_outcome: launch.prompt?.outcome, state: 'unknown' };
    if (launch.outcome?.kind === 'structured' && identity.session_id && identity.handle &&
        ['journaled', 'handed-to-terminal'].includes(launch.prompt?.outcome)) record.state = 'running';
    else record.reason = '启动回执未确认受支持的新 structured 会话和提示投递；保留现场，不重复启动';
    runtime.atomic(journal, record);
    return response(record.state === 'running' ? { state: 'running', ...identity,
      ...(record.launch_route ? { effective_route: record.launch_route } : {}) } : { state: 'unknown', reason: record.reason });
  } catch (error) {
    // A terminal transport error cannot cancel an already journaled DSH launch. Poll that intent.
    try { const pending = runtime.read(journal);
      if (pending?.launch_executor === 'dsh') return response(require('../lib/dsh-bridge.cjs').status(request, pending));
    } catch { /* Corrupt/unverifiable evidence remains unknown below. */ }
    return response({ state: 'unknown', reason: error.message.slice(0, 1800) });
  }
  finally { release(); }
}
if (require.main === module) {
  Promise.resolve().then(async () => {
    const bytes = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(bytes) > 131072) throw Error('桥输入超过 128 KiB');
    const payload = JSON.parse(bytes), opts = options(process.argv.slice(2));
    for (let attempt = 0; ; attempt++) {
      try { console.log(JSON.stringify(handle(payload, opts))); return; }
      catch (error) {
        if (attempt >= 19 || !['AXNS_COORDINATION_BUSY', 'AXNS_OBSERVATION_CHANGED'].includes(error.code)) throw error;
        // Retrying this identical bridge entry is query-only once its durable intent exists.
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { handle, options, cli, unsupported };

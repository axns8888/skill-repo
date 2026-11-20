#!/usr/bin/env node
'use strict';
// Fresh headless DSH process, with a last-layer overlay. No edits to the user's profile/settings.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const core = require('./lib/core.cjs');
const units = require('./lib/units.cjs');
const policy = require('./lib/launch-policy.cjs');
const runtime = require('./lib/runtime.cjs');
const { acquire } = require('./lib/process-lock.cjs');
const DELEGATION = ['tool-subagent-control', 'tool-subagent', 'tool-subagent-fork', 'tool-workflow'];
const TEAM_ROWS = [
  { id: 'agent-team', name: '@deepseek-ai/dsh-experimental-agent-team' },
  { id: 'tool-agent-team', name: '@deepseek-ai/dsh-experimental-tool-agent-team' },
];
function options(argv) {
  const opts = { profile: 'headless', run: false };
  const names = ['project', 'id', 'stage', 'unit', 'dsh-bin', 'profile', 'prompt-file'];
  const seen = new Set();
  while (argv.length) {
    const flag = argv.shift();
    if (seen.has(flag)) throw Error('重复参数：' + flag); seen.add(flag);
    if (flag === '--run') { opts.run = true; continue; }
    const name = flag.slice(2);
    if (!flag.startsWith('--') || !names.includes(name) || !argv[0] || argv[0].startsWith('--')) throw Error('无效参数：' + flag);
    opts[name] = argv.shift();
  }
  for (const name of ['project', 'id', 'stage', 'dsh-bin', 'prompt-file']) if (!opts[name]) throw Error('必须指定 --' + name);
  core.id(opts.id);
  if (!core.STAGES.slice(0, 5).includes(opts.stage)) throw Error('--stage 需要 P0–P4');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(opts.profile)) throw Error('无效 profile 名称');
  opts['dsh-bin'] = fs.realpathSync(opts['dsh-bin']);
  return opts;
}
function overlay(rows, route, team, extra = {}) {
  if (route?.executor && route.executor !== 'dsh') throw Error('DSH 入口不能执行 executor=' + route.executor);
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const id of ['headless-startup', 'headless-runner', 'agent-default-model'])
    if (!byId.has(id) || byId.get(id).disabled) throw Error('需要有效的一次性 headless profile，缺少 ' + id);
  const session = byId.get('headless-runner').config?.sessionId;
  if (session !== undefined && session !== 'ctx.headlessStartup.sessionId' || byId.get('headless-startup').config?.sessionId !== undefined)
    throw Error('新短工单禁止 profile 预设 sessionId；必须创建全新上下文');
  const patches = [];
  if (route) patches.push({ id: 'agent-default-model', config: { provider: route.provider, model: route.model,
    ...(route.reasoning ? { reasoningEffort: route.reasoning } : {}) } });
  if (team) {
    const native = team.enabled && team.mode === 'subagent';
    if (!team.enabled) for (const row of rows) if (row.name === '@deepseek-ai/dsh-tool-subagent' && !DELEGATION.includes(row.id)) patches.push({ id: row.id, disabled: true });
    for (const id of native ? ['ui-agent-team'] : [...DELEGATION, 'ui-agent-team'])
      if (byId.has(id)) patches.push({ id, disabled: true });
    if (native) {
      for (const id of ['subagent', 'subagent-spawn-in-process'])
        if (!byId.has(id) || byId.get(id).disabled) throw Error('原生subagent需要已启用的DSH服务：' + id);
      const insert = [];
      for (const row of [
        { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent' } },
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      ]) {
        if (byId.has(row.id)) patches.push({ id: row.id, disabled: false, ...(row.config ? { config: row.config } : {}) });
        else insert.push(row);
      }
      if (insert.length) patches.push({ insert });
      for (const row of TEAM_ROWS) if (byId.has(row.id)) patches.push({ id: row.id, disabled: true });
    } else if (team.enabled) {
      for (const id of ['subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process'])
        if (!byId.has(id) || byId.get(id).disabled) throw Error('团队需要已启用的 DSH 服务：' + id);
      const insert = [];
      for (const row of TEAM_ROWS) {
        const config = row.id === 'agent-team'
          ? { maxMembers: team.max_members ?? 8, maxTasks: 256, maxMessageBytes: 65536, disposalTimeoutMs: 5000 }
          : { freshProvider: 'spawn', forkProvider: 'fork' };
        if (byId.has(row.id)) patches.push({ id: row.id, disabled: false, config });
        else insert.push({ ...row, config });
      }
      if (insert.length) patches.push({ insert });
    } else for (const row of TEAM_ROWS) if (byId.has(row.id)) patches.push({ id: row.id, disabled: true });
  }
  if (extra.children) {
    if (!team?.enabled || team.mode !== 'subagent') throw Error('场景子级路由要求team.mode=subagent');
    const compiled = require('./lib/dsh-scenes.cjs').build(extra.children);
    if (compiled.patches.some(row => byId.has(row.id))) throw Error('DSH已有同名场景插件；拒绝覆盖用户配置');
    if (compiled.patches.length) patches.push({ insert: compiled.patches });
  }
  if (extra.telemetry) {
    const id = 'devflow-context';
    if (byId.has(id)) throw Error('DSH已有devflow-context插件');
    patches.push({ insert: [{ id, name: path.resolve(__dirname, 'dsh-context-plugin.mjs'), config: extra.telemetry }] });
  }
  return patches;
}
function verify(rows, route, team, extra = {}) {
  if (route?.executor && route.executor !== 'dsh') throw Error('DSH 入口不能执行 executor=' + route.executor);
  const byId = new Map(rows.map(row => [row.id, row]));
  const session = byId.get('headless-runner')?.config?.sessionId;
  if (session !== undefined && session !== 'ctx.headlessStartup.sessionId' || byId.get('headless-startup')?.config?.sessionId !== undefined)
    throw Error('合成配置禁止预设 sessionId；必须创建全新上下文');
  const model = byId.get('agent-default-model');
  if (route && (!model || model.disabled || model.config?.provider !== route.provider || model.config?.model !== route.model ||
      route.reasoning && model.config?.reasoningEffort !== route.reasoning)) throw Error('DSH 合成模型与请求不符');
  const expected = extra.children ? require('./lib/dsh-scenes.cjs').build(extra.children).patches : [];
  for (const row of expected) {
    const actual = byId.get(row.id);
    if (!actual || actual.disabled || actual.name !== row.name || Object.entries(row.config).some(([key, value]) => JSON.stringify(actual.config?.[key]) !== JSON.stringify(value)))
      throw Error('DSH场景工具未按不可变路由生效：' + row.id);
  }
  if (extra.telemetry) {
    const actual = byId.get('devflow-context');
    if (!actual || actual.disabled || ![path.resolve(__dirname, 'dsh-context-plugin.mjs'), pathToFileURL(path.resolve(__dirname, 'dsh-context-plugin.mjs')).href].includes(actual.name) ||
        Object.entries(extra.telemetry).some(([key, value]) => actual.config?.[key] !== value)) throw Error('DSH上下文观测插件未生效');
  }
  if (team) {
    if (team.enabled && team.mode === 'subagent') {
      for (const id of ['subagent', 'subagent-spawn-in-process', 'tool-subagent', 'tool-subagent-control'])
        if (!byId.has(id) || byId.get(id).disabled) throw Error('原生subagent服务/工具未启用：' + id);
      const config = byId.get('tool-subagent').config;
      if (config?.provider !== 'spawn' || config.toolName !== 'subagent') throw Error('原生subagent未选择独立上下文spawn');
      for (const row of TEAM_ROWS) if (byId.has(row.id) && !byId.get(row.id).disabled) throw Error('原生subagent与实验性Team冲突');
      return;
    }
    for (const id of DELEGATION) if (byId.has(id) && !byId.get(id).disabled) throw Error('DSH 委派工具未禁用：' + id);
    for (const row of TEAM_ROWS) {
      const actual = byId.get(row.id);
      if (team.enabled ? !actual || actual.disabled : actual && !actual.disabled) throw Error('DSH 团队开关未生效：' + row.id);
    }
    if (team.enabled && byId.get('agent-team').config?.maxMembers !== (team.max_members ?? 8)) throw Error('DSH 团队人数上限未生效');
  }
}
function dump(opts, patchFile) {
  const r = spawnSync(process.execPath, [opts['dsh-bin'], '--profile', opts.profile,
    ...(patchFile ? ['--patch', patchFile] : []), '--dump-config'], {
    cwd: opts.project, env: opts.env ?? process.env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
  });
  // Config dumps can contain credentials. Never persist or return their raw text/errors.
  if (r.error || r.status !== 0) throw Error('DSH 配置合成失败，exit=' + r.status);
  const yaml = createRequire(opts['dsh-bin'])('yaml');
  let rows;
  try { rows = yaml.parse(r.stdout, { logLevel: 'silent' }); } catch { throw Error('DSH 配置不是可识别的 YAML'); }
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string')) throw Error('DSH 配置树格式不支持');
  return rows;
}
function nativeInstructions() {
  return [
    '使用DSH原生subagent及控制工具调配已授权的独立短任务，无需额外Orca步骤。',
    '先读取原生上下文调度协议：' + path.resolve(__dirname, '../references/dsh-native.md'),
    '自动上下文观测由devflow_context工具提供；在计划大动作前提供下一输入/输出成本和实际执行状态。工具建议不代替停稳与接管证据。',
    '在新目标、大量读取、压缩提示和阶段边界，根据各会话当前上下文总量、下一动作成本及执行状态判断继续、fresh子会话或主会话交接；累计tok不代表当前上下文。未知数标未知。',
    '可使用只读判断脚本：' + path.resolve(__dirname, 'context-decision.cjs') + ' --snapshot <最新实际状态.json>；其建议不代表已创建会话或已转移执行权。',
    '成员独立写范围并回传证据；主会话交接前核实子树和后台执行全部静止，中断接受回执不等于停稳。不增加单消息限制，不无限续接旧成员来代替新上下文。',
  ].join('\n');
}
function prepare(opts) {
  const ctx = core.context(opts.project);
  if (!ctx.enabled) throw Error('项目需要声明 autopilot 及配置入口，启动选择不要求 execution.enabled');
  const d = ctx.detailed.find(d => d.task.task_id === opts.id);
  if (d?.window) throw Error('该任务仍有持权窗口；先完成交接');
  const taskRoot = d?.taskRoot ?? ctx.root;
  const recordDir = core.safe(taskRoot, '_plan/process/' + opts.id);
  const promptFile = core.safe(recordDir, opts['prompt-file']);
  const prompt = ctx.read.text(promptFile);
  if (!prompt?.trim() || Buffer.byteLength(prompt) > 65536) throw Error('提示文件需要 1–65536 字节的非空文本');
  const unit = opts.unit ? ctx.read.json(core.safe(recordDir, opts.unit)) : null;
  if (unit) units.spec(unit);
  const selected = policy.resolve(ctx.cfg, opts.id, opts.stage, unit);
  if (selected.model?.executor && selected.model.executor !== 'dsh') throw Error('DSH 入口不能执行 executor=' + selected.model.executor);
  const launchOpts = { ...opts, project: taskRoot };
  core.verify(ctx);
  const dir = core.safe(ctx.root, '_plan/autopilot/' + opts.id + '/dsh/' + randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const extra = { children: selected.team?.enabled && selected.team.mode === 'subagent' ? ctx.cfg.dsh_children : undefined,
    telemetry: { dshBin: opts['dsh-bin'], directory: path.join(dir, 'context'), canDelegate: !!selected.team?.enabled, canStartNewSession: false } };
  const patches = overlay(dump(launchOpts), selected.model, selected.team, extra);
  const patchFile = path.join(dir, 'launch.patch.json'), promptCopy = path.join(dir, 'prompt.txt');
  runtime.atomic(patchFile, patches, true);
  fs.writeFileSync(promptCopy, prompt + (selected.team?.enabled && selected.team.mode === 'subagent' ? '\n\n' + nativeInstructions() : ''), { flag: 'wx' });
  verify(dump(launchOpts, patchFile), selected.model, selected.team, extra);
  core.verify(ctx);
  const manifest = { version: 1, cwd: taskRoot, task_id: opts.id, stage: opts.stage,
    executor: 'dsh', route: selected.model, route_source: selected.route_source, team: selected.team,
    ...(selected.preset ? { preset: selected.preset, scenario: selected.scenario } : {}),
    verification: 'composed_config_only', fresh_session: true,
    command: [process.execPath, opts['dsh-bin'], '--profile', opts.profile, '--patch', patchFile, '--json', '-'],
    stdin_file: promptCopy, patch_file: patchFile, context_directory: extra.telemetry.directory,
    scenes: require('./lib/dsh-scenes.cjs').build(extra.children).scenes };
  runtime.atomic(path.join(dir, 'manifest.json'), manifest, true);
  return { manifest, directory: dir };
}
function main(argv) {
  const opts = options(argv), prepared = prepare(opts);
  console.log(JSON.stringify(prepared.manifest));
  if (!opts.run) return 0;
  // This launcher does not reserve runner ownership or treat process exit as phase completion.
  const release = acquire(core.safe(core.locate(opts.project).root, '_plan/autopilot/' + opts.id + '/dsh-session.lock'));
  let stdout, stderr;
  try {
    const [file, ...args] = prepared.manifest.command;
    const outputFile = path.join(prepared.directory, 'events.jsonl'), errorFile = path.join(prepared.directory, 'stderr.log');
    stdout = fs.openSync(outputFile, 'wx'); stderr = fs.openSync(errorFile, 'wx');
    const r = spawnSync(file, args, { cwd: prepared.manifest.cwd, windowsHide: true, shell: false,
      input: fs.readFileSync(prepared.manifest.stdin_file), stdio: ['pipe', stdout, stderr] });
    const first = Buffer.alloc(8192), size = fs.statSync(outputFile).size;
    const reader = fs.openSync(outputFile, 'r');
    try { fs.readSync(reader, first, 0, Math.min(first.length, size), 0); } finally { fs.closeSync(reader); }
    let sessionId = null;
    try { const event = JSON.parse(first.toString('utf8', 0, Math.min(first.length, size)).split('\n')[0]);
      if (event.type === 'session' && typeof event.sessionId === 'string') sessionId = event.sessionId;
    } catch { /* Failure before session creation remains explicit, without dumping logs. */ }
    const code = r.error || r.signal || r.status === null ? 1 : r.status;
    const receipt = { exit_code: code, session_id: sessionId, events_file: outputFile, stderr_file: errorFile,
      business_completion: 'unverified', ...(r.error ? { process_error: r.error.code ?? 'spawn_failed' } : {}) };
    runtime.atomic(path.join(prepared.directory, 'process-receipt.json'), receipt, true);
    console.log(JSON.stringify(receipt)); return code;
  } finally { if (stdout !== undefined) fs.closeSync(stdout); if (stderr !== undefined) fs.closeSync(stderr); release(); }
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { options, overlay, verify, dump, prepare, main, nativeInstructions };

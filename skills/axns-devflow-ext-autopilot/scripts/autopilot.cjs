#!/usr/bin/env node
'use strict';
// Read-only advice. A platform adapter must reserve windows and perform authorized actions.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const STAGES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
const STATES = ['ready', 'running', 'completed', 'failed'];
function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须为对象`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} 未知字段`);
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} 必须为正整数`);
  return value;
}
function boolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(`${label} 必须为布尔值`);
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^\d{8}-[a-z0-9][a-z0-9-]{0,55}$/.test(value)) fail(`无效 task-id：${value}`);
  return value;
}
function relativePath(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') ||
      relative.split('/').some(x => !x || x === '.' || x === '..') || relative.includes(':')) fail(`无效相对路径：${relative}`);
  return relative;
}
function safe(root, relative) {
  relativePath(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`路径含链接：${current}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
function git(root, args, optional = false, raw = false) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) { if (optional && r.error.code === 'ENOENT') return null; throw r.error; }
  if (r.status !== 0) { if (optional) return null; fail(`git ${args[0]}: ${r.stderr.trim()}`); }
  return raw ? r.stdout : r.stdout.trimEnd();
}
// Re-read the observed files/directories before emitting any advice. This detects changes
// during a read, but cannot replace an adapter's atomic reservation immediately before action.
function observer() {
  const observed = new Map();
  function text(file) {
    let value;
    try { value = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; value = null; }
    observed.set(file, { directory: false, value }); return value;
  }
  function names(dir) {
    let value;
    try { value = fs.readdirSync(dir).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; value = null; }
    observed.set(dir, { directory: true, value: JSON.stringify(value) }); return value || [];
  }
  function json(file) {
    const value = text(file); if (value === null) return null;
    try { return object(JSON.parse(value.replace(/^\uFEFF/, '')), file); }
    catch (e) { fail(`JSON 无效 ${file}：${e.message}`); }
  }
  function verify() {
    for (const [file, entry] of observed) {
      let value;
      try { value = entry.directory ? JSON.stringify(fs.readdirSync(file).sort()) : fs.readFileSync(file, 'utf8'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; value = entry.directory ? 'null' : null; }
      if (value !== entry.value) fail(`读取期间状态改变，请重新判定：${file}`);
    }
  }
  return { text, names, json, verify };
}
function agents(text) {
  text = (text || '').replace(/^\uFEFF/, '');
  for (const key of ['extensions', 'autopilot_config', 'lock_timeout_minutes']) {
    if ((text.match(new RegExp(`^${key}:`, 'gm')) || []).length > 1) fail(`AGENTS.md 重复字段：${key}`);
  }
  const inline = text.match(/^extensions:\s*\[([^\]\r\n]*)\]\s*$/m);
  const block = text.match(/^extensions:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)+)/m);
  const unquote = s => s.trim().replace(/^(['"])(.*)\1$/, '$2');
  const list = inline ? inline[1].split(',').map(unquote) : block ? block[1].trim().split(/\r?\n/).map(s => unquote(s.replace(/^\s*-\s*/, ''))) : [];
  return { enabled: list.includes('autopilot'), worktree: list.includes('worktree'),
    config: unquote(text.match(/^autopilot_config:[ \t]*(.+?)\s*$/m)?.[1] || ''),
    timeout: positive(Number(text.match(/^lock_timeout_minutes:[ \t]*(\d+)[ \t]*$/m)?.[1] || 120), 'lock_timeout_minutes') };
}
function config(raw) {
  keys(raw, ['version', 'slots', 'capabilities', 'tiers', 'models', 'stage_markers', 'stage_cap_minutes', 'max_attempts'], 'config');
  if (raw.version !== 1) fail('config.version 必须为 1');
  const capabilities = raw.capabilities ?? {};
  keys(capabilities, ['advance', 'switch_model', 'open_window', 'finish_task'], 'capabilities');
  const caps = {};
  for (const name of ['advance', 'switch_model', 'open_window', 'finish_task']) {
    const item = capabilities[name] ?? {};
    keys(item, ['enabled', ...(name === 'advance' ? ['max_stage'] : name === 'open_window' ? ['only_registered'] : [])], `capabilities.${name}`);
    caps[name] = { enabled: boolean(item.enabled, name !== 'finish_task', `${name}.enabled`) };
    if (name === 'advance') {
      caps[name].max_stage = item.max_stage ?? 'P3';
      if (!STAGES.slice(0, 5).includes(caps[name].max_stage)) fail('advance.max_stage 必须为 P0–P4');
    }
    if (name === 'open_window') {
      if (!boolean(item.only_registered, true, 'open_window.only_registered')) fail('open_window.only_registered 必须为 true；不得绕过登记');
      caps[name].only_registered = true;
    }
  }
  const models = object(raw.models ?? {}, 'models');
  for (const [tier, route] of Object.entries(models)) {
    keys(route, ['provider', 'model', 'reasoning'], `models.${tier}`);
    for (const key of ['provider', 'model']) if (typeof route[key] !== 'string' || !route[key].trim() || /[<>]/.test(route[key])) fail(`models.${tier}.${key} 必须为实际路由`);
    if (route.reasoning !== undefined && (typeof route.reasoning !== 'string' || !route.reasoning.trim())) fail(`models.${tier}.reasoning 无效`);
  }
  const tiers = object(raw.tiers ?? {}, 'tiers');
  for (const [stage, tier] of Object.entries(tiers)) {
    if (![...STAGES, 'conductor'].includes(stage) || typeof tier !== 'string' || !tier.trim()) fail(`tiers.${stage} 无效`);
    if (Object.keys(models).length && !Object.hasOwn(models, tier)) fail(`tiers.${stage} 指向不存在的档位：${tier}`);
  }
  const markers = object(raw.stage_markers ?? { P1: ['plan.md'], P4: ['acceptance.md'] }, 'stage_markers');
  for (const [stage, paths] of Object.entries(markers)) {
    if (!STAGES.includes(stage) || !Array.isArray(paths) || paths.some(p => typeof p !== 'string')) fail(`stage_markers.${stage} 无效`);
    paths.forEach(relativePath);
  }
  return { slots: positive(raw.slots ?? 2, 'slots'), caps, models, tiers, markers,
    stage_cap_minutes: positive(raw.stage_cap_minutes ?? 30, 'stage_cap_minutes'), max_attempts: positive(raw.max_attempts ?? 3, 'max_attempts') };
}
function timestamp(value, label, now) {
  const ms = typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || ms > now) fail(`${label} 必须为不晚于当前时间的 ISO 时间（含时区）`);
  return ms;
}
// Bind completion to staged, unstaged and untracked contents without requiring a commit.
// Runtime files are outside task worktrees, and explicitly excluded in single-task mode.
function worktreeState(root, primary) {
  const hash = createHash('sha256');
  for (const args of [
    ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--cached', 'HEAD', '--'],
    ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--'],
  ]) hash.update(git(root, args, false, true)).update('\0');
  const names = git(root, ['ls-files', '--others', '--exclude-standard', '-z'], false, true).split('\0').filter(Boolean).sort();
  for (const name of names) {
    if (root === primary && name.startsWith('_plan/autopilot/')) continue;
    const file = path.resolve(root, name);
    if (path.relative(root, file).startsWith('..')) fail(`Git 路径越界：${name}`);
    // Source symlinks are fingerprinted by link target, never followed.
    hash.update(name).update('\0');
    const stat = fs.lstatSync(file);
    hash.update(String(stat.mode)).update('\0');
    hash.update(stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}
function context(project) {
  const requested = fs.realpathSync(project);
  const top = git(requested, ['rev-parse', '--show-toplevel'], true);
  let root = requested, common = null;
  if (top) {
    const listing = git(requested, ['worktree', 'list', '--porcelain', '-z']);
    const first = listing.split('\0').find(s => s.startsWith('worktree '));
    if (!first || listing.split('\0').includes('bare')) fail('需要非 bare 仓库');
    root = fs.realpathSync(first.slice(9));
    common = fs.realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  }
  const read = observer(); const settings = agents(read.text(safe(root, 'AGENTS.md')));
  if (!settings.enabled) return { root, enabled: false, read };
  if (!settings.config) fail('AGENTS.md 必须显式指定 autopilot_config');
  const cfgPath = safe(root, settings.config); const cfg = config(read.json(cfgPath));
  const runtime = safe(root, '_plan/autopilot');
  const lock = common && path.join(common, 'axns-devflow.lock');
  function unlocked() { if (lock && fs.existsSync(lock)) fail(`协调锁被占用：${lock}；保留现场，稍后重新判定`); }
  unlocked();
  if (settings.worktree && !common) fail('worktree 模式需要 Git 仓库');
  if (settings.worktree && read.text(safe(root, '_plan/.active_plan'))?.trim()) fail('存在非空单任务指针，请先完成或迁移');
  const recordList = archived => {
    const rel = `_plan/${archived ? 'archive' : 'active'}`;
    return read.names(safe(root, rel)).filter(n => n.endsWith('.pointer')).map(n => {
      const taskId = id(n.slice(0, -8)); const data = read.json(safe(root, `${rel}/${n}`));
      if (!data || data.task_id !== taskId) fail(`指针身份不符：${n}`);
      if (!['claimed', 'blocked', 'escalated', 'completed'].includes(data.status) ||
          typeof data.holds_claims !== 'boolean' || !Array.isArray(data.depends_on)) fail(`指针字段无效：${n}`);
      data.depends_on.forEach(id); return data;
    });
  };
  const archived = settings.worktree ? recordList(true) : [];
  let tasks;
  if (settings.worktree) tasks = recordList(false);
  else {
    const active = read.text(safe(root, '_plan/.active_plan'))?.trim();
    tasks = active ? [{ task_id: id(active), status: 'claimed', holds_claims: true, depends_on: [], worktree: root }] : [];
  }
  const now = Date.now();
  const detailed = tasks.map(task => {
    const taskId = task.task_id;
    let taskRoot = root;
    if (settings.worktree) {
      const expected = safe(root, `.worktrees/${taskId}`);
      if (task.worktree !== expected || task.branch !== `task/${taskId}`) fail(`任务路径或分支身份不符：${taskId}`);
      taskRoot = fs.realpathSync(expected);
      const metadata = read.json(safe(taskRoot, `_plan/process/${taskId}/parallel.json`));
      if (JSON.stringify(metadata) !== JSON.stringify(task)) fail(`指针与 parallel.json 不一致：${taskId}`);
      if (git(taskRoot, ['branch', '--show-current']) !== task.branch) fail(`当前分支不符：${taskId}`);
    }
    const head = common ? git(taskRoot, ['rev-parse', 'HEAD']) : null;
    const worktreeSnapshot = common ? worktreeState(taskRoot, root) : null;
    const stage = read.json(safe(root, `_plan/autopilot/${taskId}/stage.json`));
    if (stage) {
      if (stage.task_id !== taskId || !STAGES.includes(stage.stage) || !STATES.includes(stage.state) ||
          typeof stage.owner !== 'string' || !stage.owner.trim()) fail(`stage.json 身份、阶段、state 或 owner 无效：${taskId}`);
      timestamp(stage.updated_at, `${taskId}.updated_at`, now);
      if (stage.attempts !== undefined && (!Number.isSafeInteger(stage.attempts) || stage.attempts < 0)) fail(`stage.attempts 无效：${taskId}`);
    }
    const window = read.json(safe(root, `_plan/autopilot/${taskId}/window.json`));
    if (window) {
      if (window.task_id !== taskId || typeof window.owner !== 'string' || !window.owner.trim() ||
          typeof window.dispatch_id !== 'string' || !window.dispatch_id.trim() || !STAGES.includes(window.stage)) fail(`window.json 无效：${taskId}`);
      timestamp(window.opened_at, `${taskId}.opened_at`, now);
      timestamp(window.heartbeat_at, `${taskId}.heartbeat_at`, now);
    }
    const markerHits = [];
    for (const [name, files] of Object.entries(cfg.markers)) {
      if (files.some(file => { const target = safe(taskRoot, `_plan/process/${taskId}/${file}`); return fs.existsSync(target); })) markerHits.push(name);
    }
    const deps = task.depends_on.filter(dep => !archived.some(x => x.task_id === dep && x.status === 'completed'));
    const waiting = task.waiting_since ? timestamp(task.waiting_since, `${taskId}.waiting_since`, now) : null;
    return { task, taskRoot, head, worktreeSnapshot, stage, window, marker_hits: markerHits, deps,
      wait_exceeded: waiting !== null && now - waiting > settings.timeout * 60000 };
  });
  return { root, common, enabled: true, settings, cfg, cfgPath, runtime, detailed, now, read, unlocked };
}
function decide(d, ctx, busy) {
  const { task, stage, window } = d; const { cfg } = ctx;
  const base = { task_id: task.task_id, task_root: d.taskRoot, stage: stage?.stage ?? null, stage_state: stage?.state ?? null,
    stage_source: stage ? 'declared' : 'missing' };
  const hold = (reason, human = false, extra = {}) => ({ ...base, action: 'hold', reason, needs_human: human, ...extra });
  if (task.status === 'escalated') return hold('needs_human_decision', true);
  if (d.wait_exceeded) return hold('wait_timeout', true);
  if (task.status === 'blocked') return hold('blocked_by_claim');
  if (task.status === 'completed') return hold('already_completed');
  if (task.status !== 'claimed' || !task.holds_claims) return hold('claims_missing', true);
  if (d.deps.length) return hold('dependency_pending', false, { depends_on: d.deps });
  if (window) {
    const age = (ctx.now - Date.parse(window.heartbeat_at)) / 60000;
    return hold(age >= cfg.stage_cap_minutes ? 'window_stalled' : 'window_active', age >= cfg.stage_cap_minutes);
  }
  if (!stage) return hold('stage_missing', true, { marker_hits: d.marker_hits });
  if (stage.stage === 'P5') return hold('needs_human_decision', true);
  if ((stage.attempts ?? 0) >= cfg.max_attempts) return hold('attempt_limit', true);
  if (stage.state === 'failed') return hold('stage_failed', true);
  if (stage.state === 'running') return hold('window_state_missing', true);
  if (stage.state === 'completed') {
    if (stage.stage !== 'P0' && (!stage.evidence || typeof stage.evidence !== 'string' ||
        !ctx.read.text(safe(d.taskRoot, `_plan/process/${task.task_id}/${stage.evidence}`))?.trim())) return hold('stage_evidence_missing', true);
    if (d.head && stage.completed_head !== d.head) return hold('stage_head_changed', true);
    if (d.head && stage.completed_worktree !== d.worktreeSnapshot) return hold('stage_worktree_changed', true);
  }
  if (stage.stage === 'P4' && stage.state === 'completed') {
    if (!cfg.caps.finish_task.enabled) return hold('finish_disabled');
    if (!ctx.settings.worktree) return hold('finish_requires_worktree');
    const acceptance = stage.acceptance;
    if (!acceptance || acceptance.result !== 'passed' || typeof acceptance.accepted_by !== 'string' || !acceptance.accepted_by.trim() ||
        acceptance.accepted_head !== d.head || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(acceptance.accepted_head)) return hold('awaiting_human_acceptance', true);
    const file = `_plan/process/${task.task_id}/acceptance.md`;
    const text = ctx.read.text(safe(d.taskRoot, file));
    const committed = git(d.taskRoot, ['show', `${d.head}:${file}`], true);
    if (!text?.trim() || committed === null || committed !== text.trimEnd()) return hold('acceptance_not_committed', true);
    if (git(d.taskRoot, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching'])) return hold('worktree_dirty', true);
    if (!task.integration_branch || git(ctx.root, ['merge-base', '--is-ancestor', d.head, `refs/heads/${task.integration_branch}`], true) === null) return hold('integration_pending');
    return { ...base, action: 'finish', reason: 'acceptance_recorded', needs_human: false, accepted_head: d.head };
  }
  const next = stage.state === 'ready' ? stage.stage : STAGES[STAGES.indexOf(stage.stage) + 1];
  if (stage.stage === 'P0' && stage.state === 'completed' && stage.user_confirmed !== true) return hold('p0_confirmation_pending', true);
  if (!next || next === 'P5') return hold('no_next_stage');
  if (STAGES.indexOf(next) > STAGES.indexOf(cfg.caps.advance.max_stage)) return hold('stage_cap');
  if (!cfg.caps.advance.enabled) return hold('advance_disabled');
  if (!cfg.caps.open_window.enabled) return hold('open_window_disabled');
  if (busy >= (ctx.settings.worktree ? cfg.slots : 1)) return hold('slots_full');
  const tier = cfg.caps.switch_model.enabled ? cfg.tiers[next] ?? null : null;
  const model = tier ? cfg.models[tier] ?? null : null;
  return { ...base, action: 'advance', reason: stage.state === 'ready' ? 'stage_ready' : 'next_stage', needs_human: false,
    next_stage: next, tier, model, model_available: !!model, route_source: model ? 'configured' : 'inherited' };
}
function main(argv) {
  const command = argv.shift(); const opts = {};
  while (argv.length) {
    const key = argv.shift();
    if (!['--project', '--json'].includes(key) || Object.hasOwn(opts, key)) fail(`无效或重复参数：${key}`);
    if (key === '--json') opts[key] = true;
    else { if (!argv[0] || argv[0].startsWith('--')) fail(`${key} 需要值`); opts[key] = argv.shift(); }
  }
  if (!['status', 'decide'].includes(command) || !opts['--project']) fail('用法：autopilot.cjs <status|decide> --project <项目> [--json]');
  const ctx = context(opts['--project']);
  if (!ctx.enabled) { ctx.read.verify(); console.log(JSON.stringify({ enabled: false, primary_root: ctx.root, decisions: [], reason: 'autopilot_disabled' }, null, 2)); return 0; }
  let result, code = 0;
  if (command === 'status') {
    result = { enabled: true, primary_root: ctx.root, config: ctx.cfgPath, runtime_root: ctx.runtime,
      worktree_ext: ctx.settings.worktree, slots: ctx.settings.worktree ? ctx.cfg.slots : 1, capabilities: ctx.cfg.caps,
      tasks: ctx.detailed.map(d => ({ task_id: d.task.task_id, task_root: d.taskRoot, status: d.task.status, held: d.task.holds_claims,
        head: d.head, worktree_snapshot: d.worktreeSnapshot, stage: d.stage, window: d.window, marker_hits: d.marker_hits, depends_on: d.deps, wait_exceeded: d.wait_exceeded })) };
  } else {
    let busy = ctx.detailed.filter(d => d.window).length;
    let decisions = [...ctx.detailed].sort((a, b) => a.task.task_id < b.task.task_id ? -1 : 1).map(d => {
      const value = decide(d, ctx, busy); if (value.action === 'advance') busy++;
      if (value.action !== 'hold') value.dispatch_id = createHash('sha256').update(JSON.stringify({ task: d.task, head: d.head, worktree_snapshot: d.worktreeSnapshot,
        stage: d.stage, action: value.action, next_stage: value.next_stage, cfg: ctx.cfg })).digest('hex');
      return value;
    });
    const human = decisions.filter(v => v.needs_human).length;
    if (human) decisions = decisions.map(v => v.action === 'hold' ? v : { ...v, proposed_action: v.action, action: 'hold', reason: 'batch_needs_human' });
    result = { enabled: true, slots: ctx.settings.worktree ? ctx.cfg.slots : 1, action_count: decisions.filter(v => v.action !== 'hold').length,
      needs_human_count: human, decisions };
    code = human ? 2 : 0;
  }
  ctx.read.verify(); ctx.unlocked();
  for (const d of ctx.detailed) if (d.head && (git(d.taskRoot, ['rev-parse', 'HEAD']) !== d.head ||
      worktreeState(d.taskRoot, ctx.root) !== d.worktreeSnapshot)) fail('读取期间 HEAD 或工作区内容改变，请重新判定');
  console.log(JSON.stringify(result, null, 2)); return code;
}
try {
  if (process.argv.length <= 2 || process.argv.slice(2).includes('--help')) console.log('node autopilot.cjs <status|decide> --project <项目或任务 worktree> [--json]');
  else process.exitCode = main(process.argv.slice(2));
} catch (e) { console.error(e.message); process.exitCode = 1; }

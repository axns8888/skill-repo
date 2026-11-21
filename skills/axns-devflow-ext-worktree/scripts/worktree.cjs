#!/usr/bin/env node
'use strict';
// Local, cooperative coordination for windows sharing one Git repository.
const fs = require('node:fs');
const humanAcceptance = require('./lib/acceptance.cjs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

class Rejected extends Error {}
function reject(message) { throw new Rejected(message); }
function git(cwd, args, optional = false) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !optional) throw new Error(`git ${args[0]}: ${r.stderr.trim() || r.stdout.trim()}`);
  return optional ? r : r.stdout.trimEnd();
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, file);
}
function safe(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) reject(`路径越界：${target}`);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) reject(`路径含链接：${current}`);
  }
  return target;
}
function mkdir(root, relative) {
  const target = safe(root, path.join(root, relative));
  fs.mkdirSync(target, { recursive: true });
  return target;
}
function validId(id) {
  if (!/^(?:\d{8}-[a-z0-9][a-z0-9-]{0,55}|\d{6}-[A-Z]\d{2,4}-[a-z0-9]+(?:-[a-z0-9]+){0,15})$/.test(id || '') || id.length > 80) {
    reject('task-id 必须是 YYMMDD-类型序号-任务标题；旧 YYYYMMDD-短标识仅用于兼容');
  }
  return id;
}
function options(argv) {
  const opts = { command: argv.shift() };
  const names = new Set(['--project', '--id', '--type', '--title', '--manifest', '--reason', '--accepted-head', '--human-accepted-by', '--message', '--out', '--expected-head', '--expected-config']);
  while (argv.length) {
    const key = argv.shift();
    if (['--summary', '--confirmed-stopped'].includes(key) && !opts[key.slice(2)]) { opts[key.slice(2)] = true; continue; }
    if (!names.has(key) || !argv[0] || argv[0].startsWith('--') || opts[key.slice(2)] !== undefined) reject(`无效参数：${key}`);
    opts[key.slice(2)] = argv.shift();
  }
  if (!['status', 'doctor', 'register', 'claim', 'check', 'escalate', 'commit', 'finish', 'snapshot', 'maintain-models'].includes(opts.command)) reject('未知命令；运行 --help');
  if (!opts.project) reject('必须显式指定 --project <项目或任务 worktree>');
  if (opts.command === 'register' && !opts.id) {
    if (!/^[A-Z]$/.test(opts.type || '') || !/^[a-z0-9]+(?:-[a-z0-9]+){0,15}$/.test(opts.title || '') || opts.title.length > 60) reject('自动编号需要 --type A --title 小写短标题');
  } else if (!['status', 'doctor', 'maintain-models'].includes(opts.command)) validId(opts.id);
  if (opts.summary && opts.command !== 'status') reject('--summary 仅用于 status');
  if (opts.summary && opts.id) validId(opts.id);
  if ((opts.out || opts['confirmed-stopped']) && opts.command !== 'snapshot') reject('--out/--confirmed-stopped 仅用于 snapshot');
  if ((opts['expected-head'] || opts['expected-config']) && opts.command !== 'maintain-models') reject('--expected-head/--expected-config 仅用于 maintain-models');
  if (opts.command === 'snapshot' && (!opts.out || !opts['confirmed-stopped'])) reject('snapshot 需要 --out <仓库外新目录> --confirmed-stopped');
  if (opts.command === 'maintain-models' && (opts.id || !opts.manifest || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(opts['expected-head'] ?? '') || !/^(?:missing|[a-f0-9]{64})$/.test(opts['expected-config'] ?? ''))) reject('maintain-models 需要 --manifest <候选模型表> --expected-head <完整HEAD> --expected-config <SHA256|missing>，不接受 --id');
  if ((opts.type || opts.title) && (opts.command !== 'register' || opts.id)) reject('--type/--title 仅用于 register 自动编号，不能与 --id 混用');
  if (opts.command === 'register' && !opts.manifest) reject('register 需要 --manifest <JSON>');
  if (opts.command === 'escalate' && !opts.reason?.trim()) reject('escalate 需要 --reason <事实及证据位置>');
  return opts;
}
function context(opts) {
  const cwd = fs.realpathSync(opts.project);
  const listing = worktrees(cwd);
  if (!listing.length || listing[0].bare) reject('需要有主检出目录的非 bare 仓库');
  const root = fs.realpathSync(listing[0].path);
  const common = fs.realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const agentsPath = safe(root, path.join(root, 'AGENTS.md'));
  const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  const inline = agents.match(/^extensions:\s*\[([^\]\r\n]*)\]\s*$/m);
  const block = agents.match(/^extensions:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)+)/m);
  const enabled = inline ? inline[1].split(',').some(x => x.trim().replace(/['"]/g, '') === 'worktree')
    : !!block?.[1].match(/^[ \t]+-\s*worktree\s*$/m);
  const branch = agents.match(/^integration_branch:\s*([\w./-]+)\s*$/m)?.[1];
  const timeout = Number(agents.match(/^lock_timeout_minutes:\s*(\d+)\s*$/m)?.[1] || 120);
  const ctx = { cwd, root, common, enabled, branch, timeout, command: opts.command, task_id: opts.id || null, lock: path.join(common, 'axns-devflow.lock') };
  if (!['status', 'doctor'].includes(opts.command)) {
    if (!enabled) reject('AGENTS.md 未声明 extensions 包含 worktree，保持单任务模式');
    if (!branch || git(root, ['check-ref-format', '--branch', branch], true).status !== 0 ||
        git(root, ['show-ref', '--verify', `refs/heads/${branch}`], true).status !== 0) reject('AGENTS.md 需要有效的本地 integration_branch');
    if (!Number.isSafeInteger(timeout) || timeout < 1) reject('lock_timeout_minutes 必须为正整数');
    for (const rel of ['_plan/active', '_plan/archive', '_plan/registry.jsonl', '.worktrees']) safe(root, path.join(root, rel));
    if (fs.existsSync(path.join(root, '_plan/.active_plan')) && fs.readFileSync(path.join(root, '_plan/.active_plan'), 'utf8').trim()) {
      reject('存在非空单任务指针，先完成或显式迁移原任务，再启用扩展');
    }
  }
  return ctx;
}
// NUL-delimited fields preserve spaces/newlines in paths and Git lock reasons.
function worktrees(cwd) {
  return git(cwd, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean).map(block => {
    const fields = block.split('\0').filter(Boolean);
    const value = key => fields.find(f => f.startsWith(`${key} `))?.slice(key.length + 1);
    const has = key => fields.some(f => f === key || f.startsWith(`${key} `));
    return { path: path.resolve(value('worktree')), head: value('HEAD') || null,
      branch: value('branch') || null, bare: has('bare'), detached: has('detached'),
      locked: has('locked'), lock_reason: value('locked') || null,
      prunable: has('prunable'), prunable_reason: value('prunable') || null };
  });
}
function samePath(a, b) { return path.relative(a, b) === ''; }
function worktreeState(ctx, data, listing) {
  const entry = listing.find(x => samePath(x.path, data.worktree));
  const exists = fs.existsSync(data.worktree);
  const issues = [];
  if (!entry) issues.push('registration_missing');
  if (!exists) issues.push('directory_missing');
  if (entry?.prunable) issues.push('prunable');
  if (entry?.detached) issues.push('detached_head');
  if (entry && entry.branch !== `refs/heads/${data.branch}`) issues.push('branch_mismatch');
  return { exists, git: entry || null, issues };
}
function requireWorktree(ctx, data, removing = false) {
  const state = worktreeState(ctx, data, worktrees(ctx.root));
  if (state.issues.length) reject(`隔离检查失败：${state.issues.join(', ')}；先运行 doctor 核对登记与工作区`);
  if (removing && state.git.locked) reject(`Git worktree 已锁定：${state.git.lock_reason || '无原因'}；保留现场，由协调者核实后处理`);
}
function doctor(ctx) {
  const listing = worktrees(ctx.root);
  const lock = { path: ctx.lock, present: fs.existsSync(ctx.lock), owner: null };
  if (lock.present) {
    try { lock.owner = read(path.join(ctx.lock, 'owner.json')); }
    catch (e) { lock.owner_error = e.message; }
  }
  const dir = safe(ctx.root, path.join(ctx.root, '_plan/active'));
  const tasks = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(x => x.endsWith('.pointer')).sort().map(name => {
    const id = name.slice(0, -8);
    try {
      const data = task(ctx, id);
      const state = worktreeState(ctx, data, listing);
      const result = { task_id: id, status: data.status, holds_claims: data.holds_claims, worktree: data.worktree, ...state };
      try {
        if (JSON.stringify(read(metadata(ctx, data))) !== JSON.stringify(data)) result.issues.push('metadata_mismatch');
      } catch (e) { result.issues.push('metadata_unreadable'); result.metadata_error = e.message; }
      return result;
    } catch (e) { return { task_id: id, issues: ['pointer_invalid'], error: e.message }; }
  });
  const managed = path.join(ctx.root, '.worktrees');
  const unregistered = listing.filter(x => {
    const rel = path.relative(managed, x.path);
    return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) &&
      !tasks.some(t => t.worktree && samePath(t.worktree, x.path));
  });
  return { enabled: ctx.enabled, primary_root: ctx.root, consistent_snapshot: false,
    coordination_lock: lock, tasks, worktrees: listing, unregistered_worktrees: unregistered };
}
function pointer(ctx, id, archived = false) {
  return safe(ctx.root, path.join(ctx.root, '_plan', archived ? 'archive' : 'active', `${validId(id)}.pointer`));
}
function records(ctx, archived = false) {
  const dir = safe(ctx.root, path.join(ctx.root, '_plan', archived ? 'archive' : 'active'));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => x.endsWith('.pointer')).sort().map(x => {
    const item = read(pointer(ctx, x.slice(0, -8), archived));
    if (item.task_id !== x.slice(0, -8)) reject(`指针身份不符：${x}`);
    return item;
  });
}
function status(ctx, opts) {
  const common = { enabled: ctx.enabled, primary_root: ctx.root, integration_branch: ctx.branch, lock_timeout_minutes: ctx.timeout };
  const overdue = x => !!x.waiting_since && Date.now() - Date.parse(x.waiting_since) > ctx.timeout * 60000;
  if (!opts.summary) return { ...common, tasks: records(ctx).map(x => ({ ...x, wait_exceeded: overdue(x) })), archived: records(ctx, true) };
  const narrow = x => ({ task_id: x.task_id, status: x.status, worktree: x.worktree, holds_claims: x.holds_claims,
    owner: x.owner, blocked_by: [...new Set((x.blocked_by ?? []).map(b => b.task_id))], wait_exceeded: overdue(x),
    record_dir: path.join(x.worktree, '_plan/process', x.task_id) });
  if (opts.id) {
    for (const archived of [false, true]) {
      const file = pointer(ctx, opts.id, archived);
      if (!fs.existsSync(file)) continue;
      const x = read(file);
      if (x.task_id !== opts.id) reject('指针身份不符');
      return { ...common, task: narrow(x), archived };
    }
    return { ...common, task: null, reason: 'task_not_found' };
  }
  const archivedDir = safe(ctx.root, path.join(ctx.root, '_plan/archive'));
  return { ...common, tasks: records(ctx).map(narrow), archived_count: fs.existsSync(archivedDir)
    ? fs.readdirSync(archivedDir).filter(x => x.endsWith('.pointer')).length : 0 };
}
function task(ctx, id) {
  const file = pointer(ctx, id);
  if (!fs.existsSync(file)) reject(`没有活动任务：${id}`);
  const data = read(file);
  safe(ctx.root, path.join(ctx.root, '.worktrees', id));
  if (data.task_id !== id || data.worktree !== path.join(ctx.root, '.worktrees', id) || data.branch !== `task/${id}`) reject('指针身份或路径不符，停止并检查共享记录');
  return data;
}
function manifest(file, id) {
  const m = read(file);
  if (Object.keys(m).some(k => !['scope', 'shared_claims', 'depends_on', 'owner'].includes(k))) reject('manifest 只接受 scope/shared_claims/depends_on/owner');
  for (const key of ['scope', 'shared_claims', 'depends_on']) {
    m[key] ??= [];
    if (!Array.isArray(m[key]) || m[key].some(x => typeof x !== 'string') || new Set(m[key]).size !== m[key].length) reject(`${key} 必须是不重复的字符串数组`);
  }
  if (typeof m.owner !== 'string' || !m.owner.trim() || /[\r\n]/.test(m.owner)) reject('owner 需要非空的单行窗口/成员标识');
  for (const name of [...m.scope, ...m.shared_claims]) {
    if (!name || /[\\:*?\[\]{}\0-\x1f]/.test(name) || name.startsWith('/') ||
        name.replace(/\/$/, '').split('/').some(p => !p || p === '.' || p === '..') ||
        ['.git/', '.worktrees/', '_plan/active/', '_plan/archive/', '_plan/registry.jsonl',
          '_plan/.active_plan', '_plan/process/'].some(reserved => overlaps(name, reserved))) reject(`范围路径无效或属于控制/记录目录：${name}`);
  }
  if (m.shared_claims.some(x => x.endsWith('/'))) reject('shared_claims 必须是精确文件路径');
  if (m.shared_claims.some(x => m.scope.some(s => covers(s, x)))) reject('共享文件仅放 shared_claims，不能同时被 scope 覆盖');
  m.depends_on.forEach(validId);
  if (m.depends_on.includes(id)) reject('不能依赖自身');
  return m;
}
// Case folding is intentionally conservative across Windows/macOS/Linux clones.
function covers(scope, file) {
  scope = scope.toLowerCase(); file = file.toLowerCase();
  return scope.endsWith('/') ? file === scope.slice(0, -1) || file.startsWith(scope) : scope === file;
}
function overlaps(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  return covers(a, b) || covers(b, a) || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
function conflicts(ctx, data) {
  const active = records(ctx).filter(x => x.task_id !== data.task_id);
  const known = [...active, ...records(ctx, true)];
  for (const dep of data.depends_on) if (!known.some(x => x.task_id === dep)) reject(`未知依赖：${dep}`);
  // Existing dependency graph plus proposed replacement must remain acyclic.
  const graph = new Map([...known, data].map(x => [x.task_id, x.depends_on]));
  function visit(id, stack = new Set()) {
    if (stack.has(id)) reject(`依赖环：${[...stack, id].join(' -> ')}`);
    for (const dep of graph.get(id) || []) visit(dep, new Set([...stack, id]));
  }
  visit(data.task_id);
  const shared = [];
  for (const other of active.filter(x => x.holds_claims)) {
    if (data.scope.some(a => [...other.scope, ...other.shared_claims].some(b => overlaps(a, b))) ||
        data.shared_claims.some(a => other.scope.some(b => overlaps(a, b)))) reject(`scope 冲突：${other.task_id}`);
    const files = data.shared_claims.filter(a => other.shared_claims.some(b => overlaps(a, b)));
    if (files.length) shared.push({ task_id: other.task_id, owner: other.owner, files });
  }
  return shared;
}
function event(ctx, type, data, extra = {}) {
  fs.appendFileSync(safe(ctx.root, path.join(ctx.root, '_plan/registry.jsonl')),
    `${JSON.stringify({ at: new Date().toISOString(), event: type, task_id: data.task_id,
      owner: data.owner, scope: data.scope, shared_claims: data.shared_claims, depends_on: data.depends_on,
      base_commit: data.base_commit, status: data.status, holds_claims: data.holds_claims, ...extra })}\n`);
}
function metadata(ctx, data) {
  return safe(data.worktree, path.join(data.worktree, '_plan/process', data.task_id, 'parallel.json'));
}
function save(ctx, data, type, extra) {
  mkdir(data.worktree, `_plan/process/${data.task_id}`);
  write(metadata(ctx, data), data);
  event(ctx, type, data, extra);
  write(pointer(ctx, data.task_id), data);
}
function locked(ctx, action) {
  try { fs.mkdirSync(ctx.lock); }
  catch (e) { if (e.code === 'EEXIST') reject(`协调锁被占用：${ctx.lock}；运行 doctor 查看锁信息，先核实进程与事件`); throw e; }
  const owner = { token: randomUUID(), pid: process.pid, hostname: os.hostname(),
    command: ctx.command, task_id: ctx.task_id, started_at: new Date().toISOString() };
  function release() {
    if (read(path.join(ctx.lock, 'owner.json')).token !== owner.token) throw new Error('协调锁所有者变化，保留现场');
    fs.unlinkSync(path.join(ctx.lock, 'owner.json'));
    fs.rmdirSync(ctx.lock);
  }
  try {
    fs.writeFileSync(path.join(ctx.lock, 'owner.json'), `${JSON.stringify(owner)}\n`, { flag: 'wx' });
    const result = action();
    release();
    return result;
  } catch (e) {
    if (e instanceof Rejected) release();
    else e.message += `；保留协调锁 ${ctx.lock}，检查部分完成的动作后按协议恢复`;
    throw e;
  }
}
function registrationId(ctx, opts) {
  // Reserve identities under the same repository lock as registration. Archives
  // and orphan Git resources also consume a sequence: never rename to take over.
  const ids = new Set([...records(ctx), ...records(ctx, true)].map(x => x.task_id));
  for (const branch of git(ctx.root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/task/']).split('\n')) {
    if (branch.startsWith('task/')) ids.add(branch.slice(5));
  }
  for (const entry of worktrees(ctx.root)) ids.add(path.basename(entry.path));
  const managed = safe(ctx.root, path.join(ctx.root, '.worktrees'));
  if (fs.existsSync(managed)) for (const name of fs.readdirSync(managed)) ids.add(name);
  if (opts.id && /^\d{8}-/.test(opts.id)) return opts.id; // Preserve existing clients and recovery.
  const registry = safe(ctx.root, path.join(ctx.root, '_plan/prompts/task-types.json'));
  let config;
  try { config = read(fs.existsSync(registry) ? registry : path.join(__dirname, '../assets/task-types.json')); }
  catch (e) { if (e instanceof SyntaxError) reject('task-types.json 不是有效 JSON'); throw e; }
  if (!config || config.version !== 1 || !config.types || Array.isArray(config.types) || typeof config.types !== 'object' ||
      !Object.keys(config.types).length || Object.entries(config.types).some(([code, label]) => !/^[A-Z]$/.test(code) || typeof label !== 'string' || !label.trim()) ||
      new Set(Object.values(config.types).map(x => x.trim())).size !== Object.keys(config.types).length) reject('task-types.json 需要 version:1 和唯一的单字母类型/非空名称');
  const now = new Date();
  const date = opts.id ? opts.id.slice(0, 6) : `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const code = opts.id ? opts.id[7] : opts.type;
  if (!Object.hasOwn(config.types, code)) reject(`未声明的任务类型 ${code}；先复用已有类型，确需新增时经用户评审更新 task-types.json`);
  const parsed = new Date(Date.UTC(2000 + Number(date.slice(0, 2)), Number(date.slice(2, 4)) - 1, Number(date.slice(4, 6))));
  if (`${String(parsed.getUTCFullYear()).slice(-2)}${String(parsed.getUTCMonth() + 1).padStart(2, '0')}${String(parsed.getUTCDate()).padStart(2, '0')}` !== date) reject('任务编号日期无效');
  const prefix = `${date}-${code}`;
  const sequences = [...ids].filter(x => x.startsWith(prefix)).map(x => Number(x.slice(prefix.length).match(/^\d{2,4}(?=-)/)?.[0] || 0));
  const sequence = opts.id ? Number(opts.id.slice(prefix.length).split('-')[0]) : Math.max(0, ...sequences) + 1;
  if (sequence < 1 || sequence > 9999 || sequences.includes(sequence)) reject('日期、类型和序号已使用或无效；新任务必须使用新序号');
  const id = validId(opts.id || `${prefix}${String(sequence).padStart(2, '0')}-${opts.title}`);
  ctx.task_id = id;
  const ownerPath = path.join(ctx.lock, 'owner.json');
  write(ownerPath, { ...read(ownerPath), task_id: id });
  return id;
}
function register(ctx, opts) {
  const id = registrationId(ctx, opts);
  const m = manifest(path.resolve(opts.manifest), id);
  if (fs.existsSync(pointer(ctx, id)) || fs.existsSync(pointer(ctx, id, true))) reject('task-id 已使用；新独立任务分配新编号，原任务恢复沿用已登记编号与工作区');
  const worktree = safe(ctx.root, path.join(ctx.root, '.worktrees', id));
  if (fs.existsSync(worktree) || git(ctx.root, ['show-ref', '--verify', `refs/heads/task/${id}`], true).status === 0) reject('任务目录或分支已存在，禁止接管');
  if (worktrees(ctx.root).some(x => samePath(x.path, worktree))) reject('Git 仍登记同名 worktree，先运行 doctor；禁止自动 prune 或接管');
  for (const rel of ['.worktrees/', '_plan/active/', '_plan/archive/', '_plan/registry.jsonl']) {
    if (git(ctx.root, ['check-ignore', '-q', '--', `${rel}${rel.endsWith('/') ? 'probe' : ''}`], true).status !== 0) reject(`先在项目 .gitignore 中声明：${rel}`);
    if (git(ctx.root, ['ls-files', '--', rel])) reject(`共享运行文件不得被 Git 跟踪：${rel}`);
  }
  mkdir(ctx.root, '.worktrees'); mkdir(ctx.root, '_plan/active'); mkdir(ctx.root, '_plan/archive');
  const base = git(ctx.root, ['rev-parse', `refs/heads/${ctx.branch}`]);
  git(ctx.root, ['worktree', 'add', '-b', `task/${id}`, worktree, base]);
  const data = { task_id: id, ...m, base_commit: base, integration_branch: ctx.branch,
    worktree, branch: `task/${id}`, created_at: new Date().toISOString(), holds_claims: false };
  let shared;
  try { shared = conflicts(ctx, data); }
  catch (e) {
    // Only roll back the clean resources this command just created.
    git(ctx.root, ['worktree', 'remove', '--', worktree]);
    git(ctx.root, ['update-ref', '-d', `refs/heads/${data.branch}`, base]);
    throw e;
  }
  data.status = shared.length ? 'blocked' : 'claimed';
  data.holds_claims = !shared.length;
  data.blocked_by = shared;
  if (shared.length) data.waiting_since = data.created_at;
  mkdir(worktree, `_plan/process/${id}`);
  fs.writeFileSync(path.join(worktree, `_plan/process/${id}/plan.md`),
    `# ${id}\n\n状态：已登记，待补足原目标与成功标准，不代表实施完成。\n\n## 目标与边界\n\n本批目标、交付物、停止条件、scope、依赖及整合责任：待填写。\n未来独立需求进入台账，不无限追加到本工作区。\n\n## 实施计划\n\n上下文预算依据（不可观测则未知）、执行单元及验证方法：待填写。\n\n## 证据与复核\n\n## 当前结论与下一步\n\n跨窗口接续在此保留阶段、已有授权、cwd/分支/被检提交、未提交差异归属、执行者与持权、有效证据、未关闭项及下一动作。\n`, { flag: 'wx' });
  save(ctx, data, shared.length ? 'task.blocked' : 'task.claimed', { blocked_by: shared });
  return data;
}
function claim(ctx, opts) {
  const data = task(ctx, opts.id);
  requireWorktree(ctx, data);
  if (data.integration_branch !== ctx.branch) reject('集成分支配置变化，需协调迁移');
  if (data.status === 'escalated' && !opts.reason?.trim()) reject('升级后恢复需要 --reason 记录根因处理或用户裁决依据');
  const proposal = { ...data, ...(opts.manifest ? manifest(path.resolve(opts.manifest), opts.id) : {}) };
  if (opts.manifest && !opts.reason?.trim()) reject('范围变更需要 --reason 记录已有授权与决定');
  const shared = conflicts(ctx, proposal);
  if (shared.length && data.holds_claims) reject(`变更冲突，保留原有修改权：${JSON.stringify(shared)}`);
  proposal.status = shared.length ? 'blocked' : 'claimed';
  proposal.holds_claims = !shared.length;
  proposal.blocked_by = shared;
  proposal.waiting_since = shared.length ? (data.waiting_since || new Date().toISOString()) : null;
  save(ctx, proposal, shared.length ? 'task.blocked' : 'task.claimed', { reason: opts.reason || '重新仲裁', blocked_by: shared });
  return proposal;
}
function check(ctx, opts) {
  const data = task(ctx, opts.id);
  if (data.status !== 'claimed' || !data.holds_claims) reject(`任务 ${data.status}，不得执行或提交`);
  if (data.integration_branch !== ctx.branch) reject('集成分支配置变化');
  requireWorktree(ctx, data);
  const actual = fs.realpathSync(git(ctx.cwd, ['rev-parse', '--show-toplevel']));
  if (actual !== fs.realpathSync(data.worktree) || git(ctx.cwd, ['symbolic-ref', '--short', 'HEAD']) !== data.branch) reject('隔离检查失败：必须在本任务 worktree 与分支执行');
  ctx = { ...ctx, cwd: data.worktree };
  if (JSON.stringify(read(metadata(ctx, data))) !== JSON.stringify(data)) reject('parallel.json 与共享指针不同，禁止自行改元数据');
  if (conflicts(ctx, data).length) reject('共享修改权冲突');
  for (const dep of data.depends_on) if (!records(ctx, true).some(x => x.task_id === dep && x.status === 'completed')) reject(`依赖未完成：${dep}`);
  const integrationHead = git(ctx.cwd, ['rev-parse', `refs/heads/${ctx.branch}`]);
  if (git(ctx.cwd, ['merge-base', '--is-ancestor', data.base_commit, 'HEAD'], true).status !== 0) reject('任务 HEAD 已脱离登记基线');
  const mergeBase = git(ctx.cwd, ['merge-base', 'HEAD', integrationHead]);
  const merging = git(ctx.cwd, ['rev-parse', '--verify', 'MERGE_HEAD'], true);
  let indexBase = 'HEAD';
  if (merging.status === 0) {
    if (merging.stdout.trim() !== integrationHead) reject('正在合并的不是当前集成分支 HEAD，先核实组合基线');
    if (git(ctx.cwd, ['ls-files', '-u'])) reject('仍有未解决的合并冲突');
    indexBase = integrationHead;
  }
  const files = new Set([
    ...git(ctx.cwd, ['diff', '--no-renames', '--name-only', '-z', `${mergeBase}..HEAD`]).split('\0'),
    ...git(ctx.cwd, ['diff', '--cached', '--no-renames', '--name-only', '-z', indexBase]).split('\0'),
    ...git(ctx.cwd, ['diff', '--no-renames', '--name-only', '-z']).split('\0'),
    ...git(ctx.cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean));
  const ownRecords = `_plan/process/${data.task_id}/`;
  const outside = [...files].filter(f => !covers(ownRecords, f) && ![...data.scope, ...data.shared_claims].some(s => covers(s, f)));
  if (outside.length) reject(`越界文件：${outside.join(', ')}`);
  const subjects = git(ctx.cwd, ['log', '--format=%s', `${integrationHead}..HEAD`]).split('\n').filter(Boolean);
  if (subjects.some(s => !s.startsWith(`${data.task_id}:`))) reject('存在未使用 task-id: 前缀的任务提交');
  return { task_id: data.task_id, result: 'passed', integration_head: integrationHead, files: [...files], head: git(ctx.cwd, ['rev-parse', 'HEAD']) };
}
function escalate(ctx, opts) {
  const data = task(ctx, opts.id);
  data.status = 'escalated'; data.escalation_reason = opts.reason;
  save(ctx, data, 'task.escalated', { reason: opts.reason });
  return data;
}
// Normal Git failures are recoverable; do not strand the cooperative lock.
function attempt(cwd, args) {
  const r = git(cwd, args, true);
  if (r.status !== 0) reject(`git ${args[0]}: ${r.stderr.trim() || r.stdout.trim()}; 修复后重试`);
  return r.stdout.trimEnd();
}
function commit(ctx, opts) {
  check(ctx, opts);
  const data = task(ctx, opts.id);
  const message = opts.message?.trim() || '完成任务变更与验证记录';
  if (/[\r\n]/.test(message)) reject('--message 必须是单行摘要');
  attempt(data.worktree, ['add', '--all', '--', '.']);
  check(ctx, opts);
  const pendingMerge = git(data.worktree, ['rev-parse', '--verify', 'MERGE_HEAD'], true).status === 0;
  if (pendingMerge || git(data.worktree, ['diff', '--cached', '--name-only', '-z']))
    attempt(data.worktree, ['commit', '-m', `${data.task_id}: ${message}`]);
  const result = check(ctx, opts);
  event(ctx, 'task.committed', data, { head: result.head });
  return result;
}
function cleanTask(ctx, data) {
  requireWorktree(ctx, data, true);
  const processDir = fs.realpathSync(process.cwd());
  const removing = fs.realpathSync(data.worktree);
  if (processDir === removing || processDir.startsWith(`${removing}${path.sep}`)) reject('运行进程位于待删除 worktree，先切换到主检出目录');
  if (git(data.worktree, ['status', '--porcelain', '--untracked-files=all', '--ignored', '--ignore-submodules=none'])) reject('worktree 含未提交、未跟踪或忽略文件；保留现场，先处理后重试');
  const admin = git(data.worktree, ['rev-parse', '--absolute-git-dir']);
  const initializedSubmodule = git(data.worktree, ['ls-files', '--stage', '-z']).split('\0').some(entry =>
    entry.startsWith('160000 ') && fs.existsSync(path.join(data.worktree, entry.slice(entry.indexOf('\t') + 1), '.git')));
  if (initializedSubmodule || fs.existsSync(path.join(admin, 'modules'))) reject('worktree 含已初始化的 submodule 仓库；保留现场，先按项目约定处理子模块及其提交');
}
function finish(ctx, opts) {
  if (ctx.cwd !== ctx.root) reject('finish 必须从主检出目录调用，避免清理当前工作目录');
  const archived = pointer(ctx, opts.id, true);
  const active = pointer(ctx, opts.id);
  const prior = fs.existsSync(archived) ? read(archived) : null;
  if (!fs.existsSync(active)) {
    if (prior?.status === 'completed' && prior.accepted_head === opts['accepted-head']) return { ...prior, duplicate: true };
    reject('没有活动任务或匹配的完成归档');
  }
  const data = task(ctx, opts.id);
  if (data.status !== 'claimed' || !data.holds_claims) reject('仅持权且未暂停的任务可结案');
  if (data.integration_branch !== ctx.branch || data.branch === ctx.branch) reject('集成分支配置变化或与任务分支相同');
  const head = opts['accepted-head'];
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head || '')) reject('--accepted-head 必须是经技术验收的完整任务 HEAD');
  const resuming = prior && ['finishing', 'completed'].includes(prior.status) && prior.accepted_head === head &&
    prior.worktree === data.worktree && prior.branch === data.branch && prior.created_at === data.created_at;
  if (prior && !resuming) reject('归档指针已存在且身份不匹配，先检查恢复状态');
  const ref = `refs/heads/${data.branch}`;
  if (git(ctx.root, ['symbolic-ref', '-q', ref], true).status === 0) reject('任务分支不能是符号引用');
  const branchResult = git(ctx.root, ['rev-parse', '--verify', ref], true);
  const branchHead = branchResult.status === 0 ? branchResult.stdout.trim() : null;
  if (branchHead !== head && !(resuming && branchHead === null)) reject('--accepted-head 必须是经技术验收的完整任务 HEAD，分支不得前移');
  const listing = worktrees(ctx.root);
  if (listing.some(w => w.branch === ref && !samePath(w.path, data.worktree))) reject('任务分支被其他 worktree 使用');
  if (fs.existsSync(data.worktree) || listing.some(w => samePath(w.path, data.worktree))) {
    cleanTask(ctx, data);
    if (git(data.worktree, ['rev-parse', 'HEAD']) !== head) reject('--accepted-head 与任务 HEAD 不符');
    check({ ...ctx, cwd: data.worktree }, opts);
  } else if (!resuming) reject('隔离检查失败：任务 worktree 丢失');
  for (const dep of data.depends_on) if (!records(ctx, true).some(x => x.task_id === dep && x.status === 'completed')) reject(`依赖未结案：${dep}`);
  const policyFile = safe(ctx.root, path.join(ctx.root, humanAcceptance.CONFIG));
  const policyText = fs.existsSync(policyFile) ? fs.readFileSync(policyFile, 'utf8') : null;
  let policy;
  try { policy = humanAcceptance.parse(policyText); } catch (e) { reject(`人工验收配置无效：${e.message}`); }
  const receipt = opts['human-accepted-by']?.trim() ? { result: 'passed', accepted_by: opts['human-accepted-by'], accepted_head: head } : (resuming ? prior.human_acceptance : null);
  const humanStatus = humanAcceptance.status(policy, receipt, head);
  if (policy.blocking && humanStatus !== 'passed') reject('等待人工验收：需要 --human-accepted-by <可追溯确认记录>，对应 --accepted-head');
  const acceptance = `_plan/process/${data.task_id}/acceptance.md`;
  if (!git(ctx.root, ['show', `${head}:${acceptance}`], true).stdout?.trim()) reject('已验收提交中缺少非空 acceptance.md');
  if ((fs.existsSync(policyFile) ? fs.readFileSync(policyFile, 'utf8') : null) !== policyText) reject('人工验收配置改变，请重新判定');
  const integrated = () => git(ctx.root, ['merge-base', '--is-ancestor', head, `refs/heads/${ctx.branch}`], true).status === 0;
  if (!integrated()) {
    if (resuming) reject('已记录的集成结果发生变化，保留归档与现场');
    if (git(ctx.root, ['symbolic-ref', '--short', 'HEAD'], true).stdout.trim() !== ctx.branch) reject('主检出目录未位于集成分支，先核实工作区');
    if (git(ctx.root, ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'])) reject('集成工作区不干净，保留现有工作后重试');
    if (git(ctx.root, ['merge-base', '--is-ancestor', `refs/heads/${ctx.branch}`, head], true).status !== 0) reject('集成分支已前移，回任务分支组合、解决冲突并重新验证');
    attempt(ctx.root, ['merge', '--ff-only', head]);
    if (!integrated()) reject('快进合入未完成，保留现场');
  }
  // Durable intent precedes deletion. Keep active claims until every cleanup step succeeds.
  const done = { ...data, status: 'finishing', accepted_head: head, acceptance,
    human_acceptance: { ...policy, status: humanStatus, ...(humanStatus === 'passed' ? receipt : {}) },
    cleanup: { worktree_removed: false, branch_deleted: false }, integrated_at: prior?.integrated_at || new Date().toISOString() };
  write(archived, done);
  if (fs.existsSync(data.worktree)) {
    cleanTask(ctx, data);
    attempt(ctx.root, ['worktree', 'remove', '--', data.worktree]);
  }
  done.cleanup.worktree_removed = true; write(archived, done);
  if (!integrated()) reject('集成分支改变，保留任务分支与归档');
  if (worktrees(ctx.root).some(w => w.branch === ref)) reject('任务分支被其他 worktree 使用，保留分支');
  if (git(ctx.root, ['show-ref', '--verify', ref], true).status === 0)
    attempt(ctx.root, ['update-ref', '--no-deref', '-d', ref, head]);
  done.cleanup.branch_deleted = true;
  done.status = 'completed'; done.holds_claims = false; done.completed_at = prior?.completed_at || new Date().toISOString();
  write(archived, done);
  const registry = safe(ctx.root, path.join(ctx.root, '_plan/registry.jsonl'));
  const completedEvent = fs.existsSync(registry) && fs.readFileSync(registry, 'utf8').split('\n').filter(Boolean).some(line => {
    try { const e = JSON.parse(line); return e.event === 'task.completed' && e.task_id === data.task_id && e.accepted_head === head; } catch { return false; }
  });
  if (!completedEvent) event(ctx, 'task.completed', done, { accepted_head: head, human_acceptance: done.human_acceptance, released: data.shared_claims });
  fs.unlinkSync(active);
  return done;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function readOnlyFailure(action) {
  try { return action(); }
  catch (error) { if (error instanceof Rejected) throw error; reject(error.message); }
}
function maintainModels(ctx, opts) {
  if (!samePath(ctx.root, fs.realpathSync(git(ctx.cwd, ['rev-parse', '--show-toplevel'])))) reject('从项目主检出目录维护；不要经业务 worktree 写入');
  const [models, catalog, { acquire }] = readOnlyFailure(() => [require('../../axns-devflow/scripts/lib/model-project.cjs'),
    require('../../axns-devflow-ext-autopilot/scripts/lib/model-config.cjs'), require('../../axns-devflow-ext-autopilot/scripts/lib/process-lock.cjs')]);
  const checkBaseline = () => {
    if (git(ctx.root, ['rev-parse', 'HEAD']) !== opts['expected-head']) reject('主检出 HEAD 已变化；重新核实');
    if (git(ctx.root, ['symbolic-ref', '--quiet', 'HEAD'], true).status !== 0 ||
        git(ctx.root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])) reject('主检出必须在分支上且干净；保留已有改动');
  };
  const prepared = readOnlyFailure(() => {
    checkBaseline();
    const found = models.discover(ctx.root);
    if (found.shared) reject('生效表由外部所有者管理；此命令不写入共享表');
    const target = safe(ctx.root, found.file);
    const relative = path.relative(ctx.root, target).split(path.sep).join('/');
    if (found.registered) safe(ctx.root, found.registered);
    if (['.git', '.worktrees', '_plan/active', '_plan/archive', '_plan/process', '_plan/autopilot', '_plan/registry.jsonl', '_plan/.active_plan', 'AGENTS.md']
      .some(name => overlaps(name, relative)) || [found.registered, path.resolve(opts.manifest)].some(file => file && samePath(target, file))) reject('候选或生效路径与控制文件重叠');
    if (git(ctx.root, ['check-ignore', '-q', '--', relative], true).status !== 1) reject('模型表必须是可独立版本控制的项目文件');
    if (/^[Sa-z] /m.test(git(ctx.root, ['--literal-pathspecs', 'ls-files', '-v', '--', relative]))) reject('模型表存在隐藏索引标志；先核实版本控制状态');
    const holders = records(ctx).filter(x => x.holds_claims && [...x.scope, ...x.shared_claims].some(p => overlaps(p, relative)));
    if (holders.length) reject(`模型表与活动持权冲突：${holders.map(x => x.task_id).join(', ')}`);
    const stat = fs.statSync(opts.manifest);
    if (!stat.isFile() || stat.size > catalog.MAX_BYTES) reject('候选模型表须为普通文件且不超过 128 KiB');
    const content = fs.readFileSync(opts.manifest);
    const candidate = catalog.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
    if (models.REQUIRED.some(id => !Object.hasOwn(candidate.scenarios, id))) reject('候选缺少必备模型场景');
    catalog.compile(candidate);
    const expected = opts['expected-config'];
    const current = () => fs.existsSync(target) ? digest(fs.readFileSync(target)) : 'missing';
    if (current() !== expected) reject('生效表内容版本已变化；重新核实');
    return { found, target, relative, content, current, active: candidate.active_preset };
  });
  const { found, target, relative, content, current } = prepared;
  if (current() === digest(content)) return { status: 'unchanged', file: target, head: opts['expected-head'], sha256: digest(content) };
  const release = readOnlyFailure(() => {
    mkdir(ctx.root, path.dirname(relative));
    return acquire(safe(ctx.root, target + '.lock'));
  });
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    // The model writer creates its own lock entry; ignore exactly that entry, not other root changes.
    const lockName = `${relative}.lock/owner.json`;
    const changes = git(ctx.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).split('\0').filter(Boolean);
    if (changes.some(entry => entry !== `?? ${lockName}`) || git(ctx.root, ['rev-parse', 'HEAD']) !== opts['expected-head'] ||
        !samePath(models.discover(ctx.root).file, target) || current() !== opts['expected-config']) reject('配置路径、版本或主检出发生变化；未覆盖');
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    if (current() !== opts['expected-config']) reject('配置在维护时变化；未覆盖');
    if (opts['expected-config'] === 'missing') fs.linkSync(temporary, target);
    else fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    release();
  }
  return { status: 'updated', file: target, source: found.source, head: opts['expected-head'], sha256: digest(content),
    active_preset: prepared.active, applies_to: 'new_sessions_only', next: 'review_and_commit_separately' };
}
function bytesFromGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) reject(`git ${args[0]}: ${result.stderr.toString('utf8').trim()}`);
  return result.stdout;
}
function fileDigest(file) {
  const hasher = createHash('sha256'), block = Buffer.allocUnsafe(1024 * 1024), fd = fs.openSync(file, 'r');
  try { for (let n; (n = fs.readSync(fd, block, 0, block.length, null)) > 0;) hasher.update(block.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hasher.digest('hex');
}
function snapshot(ctx, opts) {
  return readOnlyFailure(() => {
    const data = task(ctx, opts.id);
    requireWorktree(ctx, data);
    const cwd = data.worktree;
    if (fs.existsSync(safe(ctx.root, path.join(ctx.root, '_plan/autopilot', opts.id, 'window.json')))) reject('仍有登记的派发窗口；先按原协议交权/恢复');
    if (git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') reject('浅克隆无法保证独立恢复完整候选历史，需要单独保全');
    if (git(cwd, ['ls-files', '--unmerged']) || ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']
      .some(name => fs.existsSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', name])))) reject('有未完成的 Git 操作；此快照不能保存其内部状态');
    if (/^[Sa-z] /m.test(git(cwd, ['ls-files', '-v']))) reject('工作区包含 skip-worktree 或 assume-unchanged 条目，需要单独保全');
    const output = path.resolve(opts.out), dest = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
    if ([ctx.common, ...worktrees(ctx.root).map(w => fs.existsSync(w.path) ? fs.realpathSync(w.path) : w.path)].some(root => {
      const rel = path.relative(root, dest); return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
    })) reject('快照目录必须在 Git 管理目录和全部项目 worktree 之外');
    const manifest = opts.manifest ? read(opts.manifest) : { include: [] };
    const files = manifest?.include;
    if (!Array.isArray(files) || Object.keys(manifest).some(key => key !== 'include') || files.some(file => typeof file !== 'string' ||
      file.split('/').some(segment => !segment || /[. ]$/.test(segment) || segment.toLowerCase() === '.git') || /[:\\\0-\x1f]/.test(file)) ||
      new Set(files.map(file => file.toLowerCase())).size !== files.length) reject('快照清单格式：{"include":["相对路径/普通文件"]}');
    const ref = `refs/heads/${data.branch}`;
    const head = git(cwd, ['rev-parse', 'HEAD']);
    const stage = () => bytesFromGit(cwd, ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', 'HEAD', '--']);
    const unstaged = () => bytesFromGit(cwd, ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--']);
    const gitlinks = () => [git(cwd, ['ls-files', '--stage']), git(cwd, ['ls-tree', '-r', 'HEAD'])].some(text => /^160000 /m.test(text));
    if (gitlinks()) reject('包含子模块的工作区需要单独保全子模块，不能使用此快照');
    const untracked = () => bytesFromGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
    const index = stage(), work = unstaged(), localFiles = untracked();
    for (const file of files) {
      const original = safe(cwd, path.join(cwd, file));
      if (!fs.lstatSync(original).isFile() || git(cwd, ['--literal-pathspecs', 'ls-files', '--', file])) reject(`本地文件清单只接受未跟踪普通文件：${file}`);
    }
    fs.mkdirSync(dest, { mode: 0o700 });
    const bundle = path.join(dest, 'candidate.bundle');
    git(cwd, ['bundle', 'create', bundle, ref]);
    const listed = git(cwd, ['bundle', 'list-heads', bundle]);
    if (listed !== `${head} ${ref}`) reject('快照分支在保存期间变化；无需使用未完成的输出');
    git(cwd, ['bundle', 'verify', bundle]);
    fs.writeFileSync(path.join(dest, 'index.patch'), index, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(dest, 'worktree.patch'), work, { flag: 'wx', mode: 0o600 });
    const local = files.map(file => {
      const original = safe(cwd, path.join(cwd, file));
      const target = path.join(dest, 'local', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
      const sha256 = fileDigest(target);
      if (sha256 !== fileDigest(original)) reject(`本地文件保存期间变化：${file}`);
      return { file, sha256 };
    });
    if (git(cwd, ['rev-parse', 'HEAD']) !== head || git(cwd, ['rev-parse', ref]) !== head ||
        !index.equals(stage()) || !work.equals(unstaged()) || JSON.stringify(localFiles) !== JSON.stringify(untracked()) ||
        local.some(({ file, sha256 }) => fileDigest(safe(cwd, path.join(cwd, file))) !== sha256)) reject('现场在保存期间变化；没有生成完成清单');
    const report = { version: 1, status: 'preserved', task_id: data.task_id, original_status: data.status, ref, head,
      integration_branch: data.integration_branch, record_dir: `_plan/process/${data.task_id}`,
      artifacts: { 'candidate.bundle': fileDigest(bundle), 'index.patch': digest(index), 'worktree.patch': digest(work) },
      local, omitted_untracked: localFiles.filter(file => !files.includes(file)), ignored_files: 'only_explicit_includes',
      integrated_by_this_action: false, accepted_by_this_action: false, closed_by_this_action: false };
    const evidence = path.join(dest, 'snapshot.json');
    write(evidence, report);
    return { status: report.status, task_id: report.task_id, head, evidence,
      omitted_untracked_count: report.omitted_untracked.length, next: 'verify_restore_before_retiring_original' };
  });
}
module.exports = { context, finish };
if (require.main === module) {
  try {
    if (process.argv.includes('--help')) {
      console.log('node worktree.cjs <status|doctor|register|claim|check|escalate|commit|finish|snapshot|maintain-models> --project <目录> …\nstatus [--summary [--id TASK]]\nsnapshot --id TASK --out DIR --confirmed-stopped [--manifest JSON]\nmaintain-models --manifest JSON --expected-head HASH --expected-config SHA256|missing');
    } else {
      const opts = options(process.argv.slice(2)); const ctx = context(opts);
      let result;
      if (opts.command === 'doctor') result = doctor(ctx);
      else result = locked(ctx, () => ({ status, register, claim, check, escalate, commit, finish, snapshot, 'maintain-models': maintainModels })[opts.command](ctx, opts));
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked') process.exitCode = 2;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

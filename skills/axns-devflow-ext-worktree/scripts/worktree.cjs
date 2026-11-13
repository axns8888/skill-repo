#!/usr/bin/env node
'use strict';
// Local, cooperative coordination for windows sharing one Git repository.
const fs = require('node:fs');
const humanAcceptance = require('./lib/acceptance.cjs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
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
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) reject(`路径含链接：${current}`);
  }
  return target;
}
function mkdir(root, relative) {
  const target = safe(root, path.join(root, relative));
  fs.mkdirSync(target, { recursive: true });
  return target;
}
function validId(id) {
  if (!/^\d{8}-[a-z0-9][a-z0-9-]{0,55}$/.test(id || '')) reject('task-id 必须是 YYYYMMDD-短标识（小写字母、数字、连字符）');
  return id;
}
function options(argv) {
  const opts = { command: argv.shift() };
  const names = new Set(['--project', '--id', '--manifest', '--reason', '--accepted-head', '--human-accepted-by', '--message']);
  while (argv.length) {
    const key = argv.shift();
    if (!names.has(key) || !argv[0] || argv[0].startsWith('--') || opts[key.slice(2)] !== undefined) reject(`无效参数：${key}`);
    opts[key.slice(2)] = argv.shift();
  }
  if (!['status', 'doctor', 'register', 'claim', 'check', 'escalate', 'commit', 'finish'].includes(opts.command)) reject('命令：status | doctor | register | claim | check | escalate | commit | finish');
  if (!opts.project) reject('必须显式指定 --project <项目或任务 worktree>');
  if (!['status', 'doctor'].includes(opts.command)) validId(opts.id);
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
function register(ctx, opts) {
  const id = opts.id;
  const m = manifest(path.resolve(opts.manifest), id);
  if (fs.existsSync(pointer(ctx, id)) || fs.existsSync(pointer(ctx, id, true))) reject('task-id 已使用，请为新窗口分配新编号');
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
    `# ${id}\n\n状态：待填写任务目标与成功标准。\n\n## 目标与边界\n\n## 实施计划\n\n## 证据与复核\n\n## 当前结论与下一步\n`, { flag: 'wx' });
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
module.exports = { context, finish };
if (require.main === module) {
  try {
    if (process.argv.includes('--help')) {
      console.log('node worktree.cjs <status|doctor|register|claim|check|escalate|commit|finish> --project <目录> [--id YYYYMMDD-task] [--manifest JSON] [--message 提交摘要] [--reason 事实/裁决依据] [--accepted-head HASH] [--human-accepted-by 确认记录]');
    } else {
      const opts = options(process.argv.slice(2)); const ctx = context(opts);
      let result;
      if (opts.command === 'doctor') result = doctor(ctx);
      else if (opts.command === 'status') {
        result = locked(ctx, () => ({ enabled: ctx.enabled, primary_root: ctx.root, integration_branch: ctx.branch,
          lock_timeout_minutes: ctx.timeout, tasks: records(ctx).map(x => ({ ...x,
            wait_exceeded: !!x.waiting_since && Date.now() - Date.parse(x.waiting_since) > ctx.timeout * 60000 })), archived: records(ctx, true) }));
      } else result = locked(ctx, () => ({ register, claim, check, escalate, commit, finish })[opts.command](ctx, opts));
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked') process.exitCode = 2;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

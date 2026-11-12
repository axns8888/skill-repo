#!/usr/bin/env node
'use strict';
// Local, cooperative coordination for windows sharing one Git repository.
const fs = require('node:fs');
const path = require('node:path');
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
  const names = new Set(['--project', '--id', '--manifest', '--reason', '--accepted-head']);
  while (argv.length) {
    const key = argv.shift();
    if (!names.has(key) || !argv[0] || argv[0].startsWith('--') || opts[key.slice(2)] !== undefined) reject(`无效参数：${key}`);
    opts[key.slice(2)] = argv.shift();
  }
  if (!['status', 'register', 'claim', 'check', 'escalate', 'finish'].includes(opts.command)) reject('命令：status | register | claim | check | escalate | finish');
  if (!opts.project) reject('必须显式指定 --project <项目或任务 worktree>');
  if (opts.command !== 'status') validId(opts.id);
  if (opts.command === 'register' && !opts.manifest) reject('register 需要 --manifest <JSON>');
  if (opts.command === 'escalate' && !opts.reason?.trim()) reject('escalate 需要 --reason <事实及证据位置>');
  return opts;
}
function context(opts) {
  const cwd = fs.realpathSync(opts.project);
  const listing = git(cwd, ['worktree', 'list', '--porcelain', '-z']);
  const first = listing.split('\0').find(line => line.startsWith('worktree '));
  if (!first || listing.split('\0').includes('bare')) reject('需要有主检出目录的非 bare 仓库');
  const root = fs.realpathSync(first.slice(9));
  const common = fs.realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const agentsPath = safe(root, path.join(root, 'AGENTS.md'));
  const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  const inline = agents.match(/^extensions:\s*\[([^\]\r\n]*)\]\s*$/m);
  const block = agents.match(/^extensions:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)+)/m);
  const enabled = inline ? inline[1].split(',').some(x => x.trim().replace(/['"]/g, '') === 'worktree')
    : !!block?.[1].match(/^[ \t]+-\s*worktree\s*$/m);
  const branch = agents.match(/^integration_branch:\s*([\w./-]+)\s*$/m)?.[1];
  const timeout = Number(agents.match(/^lock_timeout_minutes:\s*(\d+)\s*$/m)?.[1] || 120);
  const ctx = { cwd, root, common, enabled, branch, timeout, lock: path.join(common, 'axns-devflow.lock') };
  if (opts.command !== 'status') {
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
  catch (e) { if (e.code === 'EEXIST') reject(`协调锁被占用：${ctx.lock}；稍后重试；若遗留锁先核实进程与事件`); throw e; }
  try {
    const result = action();
    fs.rmdirSync(ctx.lock);
    return result;
  } catch (e) {
    if (e instanceof Rejected) fs.rmdirSync(ctx.lock);
    else e.message += `；保留协调锁 ${ctx.lock}，检查部分完成的动作后人工恢复`;
    throw e;
  }
}
function register(ctx, opts) {
  const id = opts.id;
  const m = manifest(path.resolve(opts.manifest), id);
  if (fs.existsSync(pointer(ctx, id)) || fs.existsSync(pointer(ctx, id, true))) reject('task-id 已使用，请为新窗口分配新编号');
  const worktree = safe(ctx.root, path.join(ctx.root, '.worktrees', id));
  if (fs.existsSync(worktree) || git(ctx.root, ['show-ref', '--verify', `refs/heads/task/${id}`], true).status === 0) reject('任务目录或分支已存在，禁止接管');
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
  if (data.integration_branch !== ctx.branch) reject('集成分支配置变化，需协调迁移');
  if (data.status === 'escalated' && !opts.reason?.trim()) reject('升级后恢复需要 --reason 记录用户裁决依据');
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
  const actual = fs.realpathSync(git(ctx.cwd, ['rev-parse', '--show-toplevel']));
  if (actual !== fs.realpathSync(data.worktree) || git(ctx.cwd, ['symbolic-ref', '--short', 'HEAD']) !== data.branch) reject('隔离检查失败：必须在本任务 worktree 与分支执行');
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
function finish(ctx, opts) {
  const data = task(ctx, opts.id);
  if (ctx.cwd !== ctx.root) reject('finish 必须从主检出目录调用，避免清理当前工作目录');
  const processDir = fs.realpathSync(process.cwd());
  const removing = fs.realpathSync(data.worktree);
  if (processDir === removing || processDir.startsWith(`${removing}${path.sep}`)) reject('运行进程位于待删除 worktree，先切换到主检出目录');
  if (data.status !== 'claimed' || !data.holds_claims) reject('仅持权且未暂停的任务可结案');
  if (data.integration_branch !== ctx.branch) reject('集成分支配置变化');
  const head = git(data.worktree, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40,64}$/.test(opts['accepted-head'] || '') || opts['accepted-head'] !== head) reject('--accepted-head 必须是经真实验收的完整任务 HEAD');
  const branchHead = git(ctx.root, ['rev-parse', `refs/heads/${data.branch}`]);
  if (branchHead !== head || git(data.worktree, ['symbolic-ref', '--short', 'HEAD']) !== data.branch) reject('任务分支或 HEAD 不一致');
  if (git(data.worktree, ['status', '--porcelain', '--untracked-files=all', '--ignored'])) reject('worktree 含未提交、未跟踪或忽略文件；保留现场，先处理后重试');
  if (JSON.stringify(read(metadata(ctx, data))) !== JSON.stringify(data)) reject('元数据与共享指针不一致');
  for (const dep of data.depends_on) if (!records(ctx, true).some(x => x.task_id === dep && x.status === 'completed')) reject(`依赖未结案：${dep}`);
  if (git(ctx.root, ['merge-base', '--is-ancestor', head, `refs/heads/${data.integration_branch}`], true).status !== 0) reject('任务 HEAD 尚未合入集成分支');
  const acceptance = `_plan/process/${data.task_id}/acceptance.md`;
  if (!git(ctx.root, ['show', `${head}:${acceptance}`], true).stdout?.trim()) reject('已验收提交中缺少非空 acceptance.md');
  if (fs.existsSync(pointer(ctx, data.task_id, true))) reject('归档指针已存在，先检查恢复状态');
  git(ctx.root, ['worktree', 'remove', '--', data.worktree]);
  data.status = 'completed'; data.holds_claims = false;
  data.accepted_head = head; data.completed_at = new Date().toISOString();
  data.acceptance = acceptance;
  write(pointer(ctx, data.task_id, true), data);
  event(ctx, 'task.completed', data, { accepted_head: head, released: data.shared_claims });
  fs.unlinkSync(pointer(ctx, data.task_id));
  return data;
}
try {
  if (process.argv.includes('--help')) {
    console.log('node worktree.cjs <status|register|claim|check|escalate|finish> --project <目录> [--id YYYYMMDD-task] [--manifest JSON] [--reason 事实/裁决依据] [--accepted-head HASH]');
  } else {
    const opts = options(process.argv.slice(2)); const ctx = context(opts);
    let result;
    if (opts.command === 'status') {
      result = locked(ctx, () => ({ enabled: ctx.enabled, primary_root: ctx.root, integration_branch: ctx.branch,
        lock_timeout_minutes: ctx.timeout, tasks: records(ctx).map(x => ({ ...x,
          wait_exceeded: !!x.waiting_since && Date.now() - Date.parse(x.waiting_since) > ctx.timeout * 60000 })), archived: records(ctx, true) }));
    } else result = locked(ctx, () => ({ register, claim, check, escalate, finish })[opts.command](ctx, opts));
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 2;
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }

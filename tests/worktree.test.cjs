'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'skills/axns-devflow-ext-worktree/scripts/worktree.cjs');
const a = '20261112-alpha'; const b = '20261112-beta'; const c = '20261112-gamma';
function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}`);
  return r.stdout.trim();
}
function put(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function fixture(t, enabled = true) {
  const cache = path.join(repo, '.cache'); fs.mkdirSync(cache, { recursive: true });
  const temp = fs.mkdtempSync(path.join(cache, 'worktree-tests-'));
  const root = path.join(temp, '项目 with spaces'); fs.mkdirSync(root);
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'commit.gpgsign', 'false');
  put(root, 'AGENTS.md', enabled ? 'extensions: [worktree]\nintegration_branch: main\nlock_timeout_minutes: 120\n' : '# Disabled\n');
  put(root, '.gitignore', '/.worktrees/\n/_plan/active/\n/_plan/archive/\n/_plan/registry.jsonl\n*.cache\n');
  put(root, 'src/a.txt', 'alpha\n'); put(root, 'src/b.txt', 'beta\n'); put(root, 'shared.lock', 'baseline\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'initial');
  t.after(() => {
    if (path.dirname(path.resolve(temp)) !== cache) throw new Error('Unexpected cleanup path');
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return { root, temp };
}
function run(root, command, id, ...extra) {
  return spawnSync(process.execPath, [script, command, '--project', root, ...(id ? ['--id', id] : []), ...extra], { encoding: 'utf8' });
}
function ok(r) { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); }
function fail(r, pattern) { assert.equal(r.status, 1, r.stdout || r.stderr); if (pattern) assert.match(r.stderr, pattern); }
function manifest(f, id, scope, shared = [], deps = []) {
  const target = path.join(f.temp, `${id}.json`);
  fs.writeFileSync(target, JSON.stringify({ scope, shared_claims: shared, depends_on: deps, owner: `window/${id}` }));
  return target;
}
function register(f, id, scope, shared = [], deps = []) {
  return run(f.root, 'register', id, '--manifest', manifest(f, id, scope, shared, deps));
}
function wt(f, id) { return path.join(f.root, '.worktrees', id); }
function commit(root, id, message = 'implementation') { git(root, 'add', '.'); git(root, 'commit', '-m', `${id}: ${message}`); return git(root, 'rev-parse', 'HEAD'); }
function events(f) { return fs.readFileSync(path.join(f.root, '_plan/registry.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); }
function pointers(f) { return ok(run(f.root, 'status')).tasks; }

test('disabled extension is read-only and refuses registration', t => {
  const f = fixture(t, false); const before = git(f.root, 'status', '--porcelain');
  assert.equal(ok(run(f.root, 'status')).enabled, false);
  fail(register(f, a, ['src/a.txt']), /未声明/);
  assert.equal(git(f.root, 'status', '--porcelain'), before);
  assert.ok(!fs.existsSync(path.join(f.root, '.worktrees')));
  assert.ok(!fs.existsSync(path.join(f.root, '.git/axns-devflow.lock')));
});

test('registration isolates branches and shares canonical pointers across windows', t => {
  const f = fixture(t); put(f.root, 'src/a.txt', 'user dirty work\n');
  const first = ok(register(f, a, ['src/a.txt'])); const second = ok(register(f, b, ['src/b.txt']));
  assert.notEqual(first.worktree, second.worktree);
  assert.equal(git(first.worktree, 'branch', '--show-current'), `task/${a}`);
  assert.equal(fs.readFileSync(path.join(first.worktree, 'src/a.txt'), 'utf8'), 'alpha\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'src/a.txt'), 'utf8'), 'user dirty work\n');
  assert.equal(first.base_commit, git(f.root, 'rev-parse', 'main'));
  assert.deepEqual(ok(run(second.worktree, 'status')).tasks, pointers(f));
  assert.ok(fs.existsSync(path.join(first.worktree, `_plan/process/${a}/plan.md`)));
  assert.equal(ok(run(first.worktree, 'check', a)).result, 'passed');
  fail(run(f.root, 'check', a), /隔离检查失败/);
  assert.equal(events(f).filter(e => e.event === 'task.claimed').length, 2);
});

test('scope conflicts refuse registration and roll back newly created worktrees and branches', t => {
  const f = fixture(t); ok(register(f, a, ['src/']));
  fail(register(f, b, ['SRC/a.txt']), /scope 冲突/);
  assert.ok(!fs.existsSync(wt(f, b)));
  assert.equal(git(f.root, 'branch', '--list', `task/${b}`), '');
  assert.equal(pointers(f).length, 1);
  ok(register(f, c, ['src-other/']));
});

test('shared claims block contenders without reserving scope; cross-kind overlaps are refused', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'], ['shared.lock']));
  const blocked = register(f, b, ['src/b.txt'], ['shared.lock']);
  assert.equal(blocked.status, 2, blocked.stderr);
  const data = JSON.parse(blocked.stdout); assert.equal(data.holds_claims, false);
  assert.equal(data.blocked_by[0].task_id, a);
  fail(run(wt(f, b), 'check', b), /blocked/);
  assert.equal(run(f.root, 'claim', b).status, 2);
  fail(register(f, c, ['shared.lock']), /scope 冲突/);
  ok(register(f, c, ['src/b.txt']));
  assert.equal(pointers(f).filter(x => x.holds_claims).length, 2);
});

test('invalid paths, dependency cycles, and reused identities are rejected', t => {
  const f = fixture(t);
  for (const scope of [['../outside'], ['D:/secret'], ['src/*.js'], ['src\\a.txt'], ['_plan/'], ['.git/config']]) {
    fail(register(f, a, scope), /范围路径/);
    assert.ok(!fs.existsSync(wt(f, a)));
  }
  fail(register(f, a, ['src/a.txt'], [], [b]), /未知依赖/);
  assert.equal(git(f.root, 'branch', '--list', `task/${a}`), '');
  ok(register(f, a, ['src/a.txt'])); ok(register(f, b, ['src/b.txt'], [], [a]));
  fail(run(wt(f, b), 'check', b), /依赖未完成/);
  fail(run(f.root, 'claim', a, '--manifest', manifest(f, a, ['src/a.txt'], [], [b]), '--reason', '用户确认调整'), /依赖环/);
  fail(register(f, a, ['src/a.txt']), /已使用/);
});

test('check catches untracked, staged, committed, renamed paths and commit prefix violations', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'])); const root = wt(f, a);
  put(root, 'src/b.txt', 'outside\n'); fail(run(root, 'check', a), /越界文件/);
  git(root, 'restore', 'src/b.txt'); put(root, 'new.txt', 'untracked'); fail(run(root, 'check', a), /new.txt/);
  fs.unlinkSync(path.join(root, 'new.txt'));
  put(root, 'src/b.txt', 'staged'); git(root, 'add', 'src/b.txt'); fail(run(root, 'check', a), /src\/b.txt/);
  put(root, 'src/b.txt', 'beta\n'); // staged outside change survives even when the worktree matches HEAD
  fail(run(root, 'check', a), /src\/b.txt/);
  git(root, 'restore', '--staged', 'src/b.txt'); git(root, 'restore', 'src/b.txt');
  git(root, 'mv', 'src/a.txt', 'src/b-new.txt'); fail(run(root, 'check', a), /src\/b-new.txt/);
  git(root, 'reset', '--hard', 'HEAD');
  put(root, 'src/a.txt', 'inside'); commit(root, a); ok(run(root, 'check', a));
  put(root, 'src/b.txt', 'committed outside'); commit(root, a); fail(run(root, 'check', a), /越界文件/);
  git(root, 'reset', '--hard', 'HEAD~1');
  put(root, 'src/a.txt', 'more'); git(root, 'add', '.'); git(root, 'commit', '-m', 'missing prefix');
  fail(run(root, 'check', a), /前缀/);
});

test('claim validates proposed changes, preserves old claims on conflict, and rejects metadata edits', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'])); ok(register(f, b, ['src/b.txt']));
  const proposal = manifest(f, a, ['src/']);
  fail(run(f.root, 'claim', a, '--manifest', proposal), /范围变更需要/);
  fail(run(f.root, 'claim', a, '--manifest', proposal, '--reason', '用户确认调整'), /scope 冲突/);
  assert.deepEqual(pointers(f).find(x => x.task_id === a).scope, ['src/a.txt']);
  const meta = path.join(wt(f, a), `_plan/process/${a}/parallel.json`);
  const data = JSON.parse(fs.readFileSync(meta)); data.scope.push('src/b.txt'); fs.writeFileSync(meta, JSON.stringify(data));
  fail(run(wt(f, a), 'check', a), /parallel.json/);
});

test('escalation pauses tasks, retains claims and requires a decision to resume', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'], ['shared.lock']));
  const paused = ok(run(f.root, 'escalate', a, '--reason', '两次相同冲突，见 evidence.md'));
  assert.equal(paused.status, 'escalated'); assert.equal(paused.holds_claims, true);
  fail(run(wt(f, a), 'check', a), /escalated/);
  fail(run(f.root, 'claim', a), /裁决依据/);
  ok(run(f.root, 'claim', a, '--reason', '用户决定保持现有方案'));
  ok(run(wt(f, a), 'check', a));
  assert.ok(events(f).some(e => e.event === 'task.escalated'));
});

test('status reports shared ownership timeout from primary records even in another worktree', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'], ['shared.lock']));
  assert.equal(register(f, b, ['src/b.txt'], ['shared.lock']).status, 2);
  const file = path.join(f.root, `_plan/active/${b}.pointer`); const data = JSON.parse(fs.readFileSync(file));
  data.waiting_since = new Date(Date.now() - 121 * 60000).toISOString(); fs.writeFileSync(file, JSON.stringify(data));
  assert.equal(ok(run(wt(f, a), 'status')).tasks.find(x => x.task_id === b).wait_exceeded, true);
});

test('finish preserves dirty or unmerged work; completed tasks archive evidence and release claims', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'], ['shared.lock']));
  assert.equal(register(f, b, ['src/b.txt'], ['shared.lock']).status, 2);
  const root = wt(f, a); const accepted = `_plan/process/${a}/acceptance.md`;
  put(root, 'src/a.txt', 'implemented'); let head = commit(root, a);
  fail(run(f.root, 'finish', a, '--accepted-head', head), /尚未合入/);
  git(f.root, 'merge', '--ff-only', `task/${a}`);
  fail(run(f.root, 'finish', a, '--accepted-head', head), /acceptance.md/);
  put(root, accepted, '实际命令、复核关闭与用户验收依据已记录。\n'); head = commit(root, a, 'acceptance');
  git(f.root, 'merge', '--ff-only', `task/${a}`);
  fail(run(f.root, 'finish', a, '--accepted-head', '0'.repeat(40)), /accepted-head/);
  fail(run(root, 'finish', a, '--accepted-head', head), /主检出目录/);
  put(root, 'generated.cache', 'do not lose ignored data');
  fail(run(f.root, 'finish', a, '--accepted-head', head), /忽略文件/);
  assert.ok(fs.existsSync(root)); assert.equal(pointers(f).find(x => x.task_id === a).holds_claims, true);
  fs.unlinkSync(path.join(root, 'generated.cache'));
  const done = ok(run(f.root, 'finish', a, '--accepted-head', head));
  assert.equal(done.status, 'completed'); assert.equal(done.holds_claims, false);
  assert.ok(!fs.existsSync(root)); assert.ok(fs.existsSync(path.join(f.root, accepted)));
  assert.ok(fs.existsSync(path.join(f.root, `_plan/archive/${a}.pointer`)));
  assert.equal(git(f.root, 'branch', '--list', `task/${a}`), `task/${a}`);
  assert.equal(events(f).at(-1).event, 'task.completed');
  assert.deepEqual(events(f).at(-1).released, ['shared.lock']);
  assert.equal(ok(run(f.root, 'claim', b)).status, 'claimed');
  fail(register(f, a, ['other/']), /已使用/);
});

test('coordinating lock prevents concurrent claims; retry observes the winner', async t => {
  const f = fixture(t); const ma = manifest(f, a, ['src/a.txt'], ['shared.lock']);
  const mb = manifest(f, b, ['src/b.txt'], ['shared.lock']);
  function start(id, m) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, 'register', '--project', f.root, '--id', id, '--manifest', m]);
      let stdout = ''; let stderr = ''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
      child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr, id, m }));
    });
  }
  const results = await Promise.all([start(a, ma), start(b, mb)]);
  for (const r of results) {
    if (r.status === 1) { assert.match(r.stderr, /协调锁被占用/); assert.equal(run(f.root, 'register', r.id, '--manifest', r.m).status, 2); }
    else assert.ok([0, 2].includes(r.status), r.stderr);
  }
  assert.equal(pointers(f).filter(x => x.holds_claims).length, 1);
  assert.equal(pointers(f).filter(x => x.status === 'blocked').length, 1);
  assert.ok(!fs.existsSync(path.join(f.root, '.git/axns-devflow.lock')));
});

test('legacy pointer, missing ignore rules, stale lock, and bad CLI cannot start a task', t => {
  const f = fixture(t); put(f.root, '_plan/.active_plan', '_plan/process/legacy');
  fail(register(f, a, ['src/a.txt']), /单任务指针/); fs.unlinkSync(path.join(f.root, '_plan/.active_plan'));
  put(f.root, '.gitignore', '/.worktrees/\n'); fail(register(f, a, ['src/a.txt']), /gitignore/);
  fs.mkdirSync(path.join(f.root, '.git/axns-devflow.lock')); fail(run(f.root, 'status'), /协调锁被占用/);
  fs.rmdirSync(path.join(f.root, '.git/axns-devflow.lock'));
  for (const args of [[], ['register'], ['status', '--project', f.root, '--unknown', 'x']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); assert.equal(result.status, 1);
  }
});

test('combination merge keeps integration changes out of scope checks while preserving pre-commit checks', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt'])); ok(register(f, b, ['src/b.txt']));
  put(wt(f, a), 'src/a.txt', 'task alpha');
  put(wt(f, a), `_plan/process/${a}/acceptance.md`, 'Alpha acceptance evidence');
  const ahead = commit(wt(f, a), a);
  put(wt(f, b), 'src/b.txt', 'task beta'); commit(wt(f, b), b);
  git(f.root, 'merge', '--ff-only', `task/${a}`);
  ok(run(f.root, 'finish', a, '--accepted-head', ahead));
  // The task is now behind integration and contains independent commits.
  const mainHead = git(f.root, 'rev-parse', 'main');
  git(wt(f, b), 'merge', '--no-ff', '--no-commit', 'main');
  assert.equal(git(wt(f, b), 'rev-parse', 'MERGE_HEAD'), mainHead);
  ok(run(wt(f, b), 'check', b));
  git(wt(f, b), 'commit', '-m', `${b}: validate integration combination`);
  ok(run(wt(f, b), 'check', b));
  assert.equal(git(f.root, 'rev-parse', 'main'), mainHead);
  put(wt(f, b), `_plan/process/${b}/acceptance.md`, 'Beta combination checks and user acceptance');
  const bhead = commit(wt(f, b), b, 'acceptance');
  git(f.root, 'merge', '--ff-only', `task/${b}`);
  ok(run(f.root, 'finish', b, '--accepted-head', bhead));
  assert.equal(pointers(f).length, 0);
});

test('text conflicts remain in task worktree and block checks without changing integration', t => {
  const f = fixture(t); ok(register(f, a, ['src/a.txt']));
  put(wt(f, a), 'src/a.txt', 'task implementation\n'); commit(wt(f, a), a);
  put(f.root, 'src/a.txt', 'new integration implementation\n');
  git(f.root, 'add', 'src/a.txt'); git(f.root, 'commit', '-m', 'integration advanced');
  const head = git(f.root, 'rev-parse', 'main');
  const merge = spawnSync('git', ['merge', '--no-ff', '--no-commit', 'main'], { cwd: wt(f, a), encoding: 'utf8' });
  assert.equal(merge.status, 1);
  fail(run(wt(f, a), 'check', a), /未解决的合并冲突/);
  assert.equal(git(f.root, 'rev-parse', 'main'), head);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  put(wt(f, a), 'src/a.txt', 'resolved in task worktree\n'); git(wt(f, a), 'add', 'src/a.txt');
  ok(run(wt(f, a), 'check', a));
});

test('no-ff no-commit stops a possible fast-forward for validation, and copied helper runs standalone', t => {
  const f = fixture(t); const copy = path.join(f.temp, '单独安装的扩展');
  fs.cpSync(path.dirname(path.dirname(script)), copy, { recursive: true });
  const copied = path.join(copy, 'scripts/worktree.cjs');
  const result = spawnSync(process.execPath, [copied, 'register', '--project', f.root, '--id', a,
    '--manifest', manifest(f, a, ['src/a.txt'])], { encoding: 'utf8' });
  ok(result); commit(wt(f, a), a, 'task records');
  // Advance integration along the task's history to create a possible fast-forward.
  git(f.root, 'merge', '--ff-only', `task/${a}`);
  put(f.root, 'src/b.txt', 'integration-only change'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'integration advanced');
  const before = git(wt(f, a), 'rev-parse', 'HEAD'); const integration = git(f.root, 'rev-parse', 'main');
  git(wt(f, a), 'merge', '--no-ff', '--no-commit', 'main');
  assert.equal(git(wt(f, a), 'rev-parse', 'HEAD'), before);
  assert.equal(git(wt(f, a), 'rev-parse', 'MERGE_HEAD'), integration);
  ok(run(wt(f, a), 'check', a));
});

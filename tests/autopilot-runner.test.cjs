'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const runner = path.join(repo, 'skills/axns-devflow-ext-autopilot/scripts/runner.cjs');
const advice = path.join(repo, 'skills/axns-devflow-ext-autopilot/scripts/autopilot.cjs');
const worktree = path.join(repo, 'skills/axns-devflow-ext-worktree/scripts/worktree.cjs');
const taskId = '20261112-runner';
const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.join(repo, '.cache') };
function put(root, file, value) {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function fixture(t, useGit = false) {
  const cache = path.join(repo, '.cache'); fs.mkdirSync(cache, { recursive: true });
  const temp = fs.mkdtempSync(path.join(cache, 'runner-tests-'));
  const root = path.join(temp, '项目 with spaces'); fs.mkdirSync(root);
  const f = { root, temp, taskRoot: root, useGit };
  put(root, 'AGENTS.md', 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
  put(root, '_plan/.active_plan', taskId);
  config(f, { version: 1, execution: { enabled: true } });
  if (useGit) {
    git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'config', 'core.autocrlf', 'false');
    put(root, '.gitignore', '/_plan/autopilot/\n/.worktrees/\n/_plan/active/\n/_plan/archive/\n/_plan/registry.jsonl\n');
    put(root, 'src/a.txt', 'initial\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'initial');
  }
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(cache));
    assert.ok(fs.realpathSync(temp).startsWith(fs.realpathSync(cache) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return f;
}
function config(f, value) { put(f.root, '_plan/prompts/autopilot.json', value); }
function run(f, command, ...args) { return spawnSync(process.execPath, [runner, command, '--project', f.root, ...args], { env, encoding: 'utf8', windowsHide: true }); }
function json(r, code = 0) { assert.equal(r.status, code, r.stderr || r.stdout); return JSON.parse(r.stdout); }
function adviceResult(f, code = 0) { return json(spawnSync(process.execPath, [advice, 'decide', '--project', f.root], { env, encoding: 'utf8' }), code); }
function init(f, stage = 'P2') { return json(run(f, 'init', '--id', taskId, '--stage', stage, '--owner', 'controller/test')); }
function claim(f, owner = 'orca/test') { return json(run(f, 'claim', '--owner', owner)); }
function state(f, name) { return JSON.parse(fs.readFileSync(path.join(f.root, '_plan/autopilot', taskId, name), 'utf8')); }
function args(request) { return ['--id', request.task_id, '--owner', request.owner, '--dispatch', request.dispatch_id]; }
function evidence(f, name = 'evidence.md', value = 'Actual execution evidence and observable results\n') {
  put(f.taskRoot, '_plan/process/' + taskId + '/' + name, value); return name;
}
function bridge(f, start = 'running', query = 'running', more = {}) {
  const control = path.join(f.temp, 'control.json'), log = path.join(f.temp, 'bridge-log.jsonl');
  const script = path.join(f.temp, 'platform bridge.cjs');
  put(f.temp, 'control.json', { start, query, ...more });
  put(f.temp, 'platform bridge.cjs', `const fs=require('node:fs'),path=require('node:path');
const v=JSON.parse(fs.readFileSync(0,'utf8')),c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
fs.appendFileSync(process.argv[3],JSON.stringify(v)+'\\n');
if(fs.existsSync(path.join(v.request.project,'.git/axns-devflow.lock'))||fs.existsSync(path.join(v.request.project,'_plan/autopilot/.lock'))) throw Error('bridge invoked under lock');
if(c[v.operation]==='crash') process.exit(9);
if(c[v.operation]==='malformed') { console.log('bad JSON'); process.exit(0); }
console.log(JSON.stringify({version:1,dispatch_id:v.request.dispatch_id,state:c[v.operation],session_id:'platform/session-1',reason:'authoritative platform lookup',effective_route:c.route||v.request.route}));`);
  config(f, { version: 1, execution: { enabled: true, adapter: 'command', timeout_seconds: 2,
    command: { file: process.execPath, args: [script, control, log] } } });
  return { control, log };
}
function callback(f, name, request, file = 'evidence.md', extra = ['--handoff'], code = 0) {
  return json(run(f, name, ...args(request), '--evidence', file, ...extra), code);
}

test('execution requires explicit opt-in; read-only advice remains usable', t => {
  const f = fixture(t); config(f, { version: 1 });
  const before = fs.readdirSync(f.root);
  assert.equal(run(f, 'init', '--id', taskId, '--stage', 'P2', '--owner', 'controller/test').status, 1);
  assert.deepEqual(fs.readdirSync(f.root), before);
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot')), false);
  assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_missing');
  config(f, { version: 1, execution: { enabled: 'true' } });
  assert.equal(run(f, 'claim').status, 1);
});

test('native session executes P2 then P3, records real callbacks and stops at stage cap', t => {
  const f = fixture(t); config(f, { version: 1, execution: { enabled: true }, capabilities: { advance: { max_stage: 'P3' } } }); init(f);
  assert.equal(json(run(f, 'precheck')).actionable, true);
  const first = claim(f).request;
  assert.equal(first.stage, 'P2'); assert.equal(first.cwd, f.root);
  assert.match(first.prompt, /P2 阶段/); assert.match(first.prompt, new RegExp(taskId));
  assert.equal(state(f, 'stage.json').state, 'running');
  assert.equal(json(run(f, 'claim', '--owner', first.owner)).resumed, true);
  json(run(f, 'heartbeat', ...args(first)));
  evidence(f); callback(f, 'complete', first);
  assert.equal(callback(f, 'complete', first).duplicate, true);
  assert.equal(adviceResult(f).decisions[0].next_stage, 'P3');
  const second = claim(f, 'orca/next-run').request;
  assert.equal(second.stage, 'P3'); assert.notEqual(second.dispatch_id, first.dispatch_id);
  evidence(f, 'review.md'); callback(f, 'complete', second, 'review.md');
  assert.equal(claim(f, 'orca/third-run').action, 'hold');
  assert.equal(adviceResult(f).decisions[0].reason, 'stage_cap');
  json(run(f, 'precheck'), 3);
  assert.equal(run(f, 'init', '--id', taskId, '--stage', 'P2', '--owner', 'controller/test').status, 1);
});

test('cross-process claims reserve at most one worker', async t => {
  const f = fixture(t); init(f);
  const invoke = owner => new Promise(resolve => {
    const child = spawn(process.execPath, [runner, 'claim', '--project', f.root, '--owner', owner], { env, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([invoke('orca/a'), invoke('orca/b')]);
  const claimed = results.filter(r => r.status === 0 && JSON.parse(r.stdout).action === 'claimed');
  assert.equal(claimed.length, 1, JSON.stringify(results));
  assert.equal(state(f, 'window.json').owner, claimed[0] && JSON.parse(claimed[0].stdout).request.owner);
});

test('wrong owner, stale dispatch, missing evidence and failed phases cannot advance', t => {
  const f = fixture(t); init(f); const request = claim(f).request;
  assert.equal(run(f, 'heartbeat', ...args({ ...request, owner: 'other' })).status, 1);
  assert.equal(run(f, 'heartbeat', ...args({ ...request, dispatch_id: 'f'.repeat(64) })).status, 1);
  assert.equal(run(f, 'complete', ...args(request), '--evidence', 'missing.md', '--handoff').status, 1);
  assert.equal(state(f, 'stage.json').state, 'running');
  evidence(f, 'failure.md'); callback(f, 'fail', request, 'failure.md', ['--handoff'], 2);
  assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_failed');
  assert.equal(run(f, 'init', '--id', taskId, '--stage', 'P2', '--owner', 'controller/test').status, 1);
});

test('completion receipt can be replayed before handoff and stale callbacks do not affect the next worker', t => {
  const f = fixture(t); init(f); const first = claim(f).request; evidence(f);
  callback(f, 'complete', first, 'evidence.md', []);
  assert.equal(adviceResult(f).decisions[0].reason, 'window_active');
  callback(f, 'complete', first);
  const next = claim(f, 'orca/new-session').request;
  assert.equal(callback(f, 'complete', first).duplicate, true);
  assert.equal(run(f, 'heartbeat', ...args(first)).status, 1);
  assert.equal(state(f, 'window.json').dispatch_id, next.dispatch_id);
});

test('configured session route must match the actual supplied model', t => {
  const f = fixture(t); config(f, { version: 1, execution: { enabled: true }, tiers: { P2: 'build' },
    models: { build: { provider: 'codex', model: 'actual-model', reasoning: 'high' } } }); init(f);
  assert.equal(json(run(f, 'claim'), 2).reason, 'session_model_mismatch');
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot', taskId, 'window.json')), false);
  const r = json(run(f, 'claim', '--provider', 'codex', '--model', 'actual-model', '--reasoning', 'high'));
  assert.equal(r.request.route.model, 'actual-model');
});

test('unknown platform launch is reserved, query resumes it without starting a second session', t => {
  const f = fixture(t), b = bridge(f, 'crash', 'running'); init(f);
  assert.equal(json(run(f, 'tick'), 2).reason, 'launch_unknown');
  const w = state(f, 'window.json'); assert.equal(w.phase, 'reserved');
  assert.equal(json(run(f, 'tick')).action, 'hold');
  assert.equal(json(run(f, 'recover', ...args(w.request))).action, 'running');
  assert.equal(state(f, 'stage.json').state, 'running');
  const calls = fs.readFileSync(b.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(v => v.operation), ['start', 'query']);
  assert.equal(calls[0].request.dispatch_id, calls[1].request.dispatch_id);
  evidence(f); callback(f, 'complete', w.request);
});

test('confirmed absent starts increment attempts and stop automatically at the limit', t => {
  const f = fixture(t), b = bridge(f, 'absent', 'absent'); init(f);
  for (let i = 1; i <= 3; i++) {
    assert.equal(json(run(f, 'tick')).action, 'start_failed');
    assert.equal(state(f, 'stage.json').attempts, i);
    assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot', taskId, 'window.json')), false);
  }
  const stopped = json(run(f, 'tick'), 2);
  assert.equal(stopped.decisions[0].reason, 'attempt_limit');
  assert.equal(fs.readFileSync(b.log, 'utf8').trim().split('\n').length, 3);
});

test('platform stop without worker evidence and malformed responses preserve the reservation', t => {
  const f = fixture(t); bridge(f, 'malformed', 'stopped'); init(f);
  json(run(f, 'tick'), 2); const request = state(f, 'window.json').request;
  assert.equal(json(run(f, 'recover', ...args(request)), 2).reason, 'worker_stopped_without_result');
  assert.equal(state(f, 'window.json').dispatch_id, request.dispatch_id);
  evidence(f, 'recovery.md', 'Platform confirms original session stopped; no success evidence.\n');
  assert.equal(run(f, 'interrupt', ...args(request), '--evidence', 'recovery.md').status, 1);
  json(run(f, 'interrupt', ...args(request), '--evidence', 'recovery.md', '--confirmed-stopped'), 2);
  assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_failed');
});

test('disabling new execution still allows an existing worker to report and hand off', t => {
  const f = fixture(t); init(f); const request = claim(f).request;
  config(f, { version: 1, execution: { enabled: false } }); evidence(f);
  callback(f, 'complete', request);
  assert.equal(run(f, 'claim').status, 1);
});

test('Orca adapter renders an explicit disabled schedule and never invokes a platform', t => {
  const f = fixture(t);
  const result = json(run(f, 'automation', '--adapter', 'orca', '--workspace', 'workspace id', '--provider', 'codex',
    '--trigger', '0 * * * *', '--name', 'Autopilot'));
  assert.equal(result.installs, false); assert.ok(result.argv.includes('--disabled'));
  assert.equal(result.argv[result.argv.indexOf('--workspace') + 1], 'workspace id');
  assert.match(result.prompt, /request.cwd/); assert.match(result.prompt, /claim/);
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot')), false);
});

test('Git completion includes task evidence and invalidates when code changes', t => {
  const f = fixture(t, true); init(f); const request = claim(f).request;
  evidence(f); callback(f, 'complete', request);
  assert.equal(adviceResult(f).decisions[0].next_stage, 'P3');
  put(f.root, 'src/a.txt', 'changed after completion\n');
  assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_worktree_changed');
});

test('worktree execution runs host check before claim and completion, preserving scope enforcement', t => {
  const f = fixture(t, true);
  fs.unlinkSync(path.join(f.root, '_plan/.active_plan'));
  put(f.root, 'AGENTS.md', 'extensions: [worktree, autopilot]\nintegration_branch: main\nautopilot_config: _plan/prompts/autopilot.json\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'enable worktree');
  const manifest = path.join(f.temp, 'manifest.json'); put(f.temp, 'manifest.json', { scope: ['src/a.txt'], shared_claims: [], depends_on: [], owner: 'controller/test' });
  const registered = json(spawnSync(process.execPath, [worktree, 'register', '--project', f.root, '--id', taskId, '--manifest', manifest], { env, encoding: 'utf8' }));
  f.taskRoot = registered.worktree; init(f);
  const request = claim(f).request; assert.equal(request.cwd, f.taskRoot);
  evidence(f); put(f.taskRoot, 'src/outside.txt', 'outside scope\n');
  const rejected = run(f, 'complete', ...args(request), '--evidence', 'evidence.md', '--handoff');
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /worktree check/);
  assert.equal(state(f, 'stage.json').state, 'running');
  fs.unlinkSync(path.join(f.taskRoot, 'src/outside.txt'));
  callback(f, 'complete', request);
  assert.equal(adviceResult(f).decisions[0].next_stage, 'P3');
});


test('replayed completion preserves controller acceptance metadata until handoff', t => {
  const f = fixture(t); init(f); const request = claim(f).request; evidence(f);
  callback(f, 'complete', request, 'evidence.md', []);
  const before = state(f, 'stage.json');
  before.acceptance = { result: 'passed', accepted_head: 'a'.repeat(40) };
  before.human_acceptance = { result: 'pending' };
  put(f.root, '_plan/autopilot/' + taskId + '/stage.json', before);
  assert.equal(callback(f, 'complete', request).duplicate, true);
  assert.deepEqual(state(f, 'stage.json'), before);
});

test('owner cannot be rebound when a previous task has retained receipts outside active tasks', t => {
  const f = fixture(t); init(f);
  put(f.root, '_plan/autopilot/20261111-archived/receipts/' + 'a'.repeat(64) + '.json', { owner: 'orca/old-session' });
  const rejected = run(f, 'claim', '--owner', 'orca/old-session');
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /owner/);
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot', taskId, 'window.json')), false);
  assert.equal(claim(f, 'orca/fresh-session').request.stage, 'P2');
});


test('late platform start response preserves a newer window after the worker already handed off', t => {
  const f = fixture(t);
  const script = path.join(f.temp, 'early-worker.cjs');
  put(f.temp, 'early-worker.cjs', String.raw`const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const v=JSON.parse(fs.readFileSync(0,'utf8')),q=v.request;
function call(argv){const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout);}
if(q.stage==='P2'){
 call(q.callbacks.heartbeat);
 const output=path.join(q.cwd,'_plan/process',q.task_id,'early.md');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,'Actual early worker completion evidence\n');
 call(q.callbacks.complete.map(x=>x.startsWith('<')?'early.md':x));
 call([process.execPath,process.argv[2],'tick','--project',q.project,'--owner','command/next-session']);
}
console.log(JSON.stringify({version:1,dispatch_id:q.dispatch_id,state:'running',session_id:'platform/'+q.stage}));`);
  config(f, { version: 1, execution: { enabled: true, adapter: 'command', timeout_seconds: 30,
    command: { file: process.execPath, args: [script, runner] } } });
  init(f);
  assert.equal(json(run(f, 'tick')).action, 'already_reported');
  const current = state(f, 'window.json');
  assert.equal(current.stage, 'P3'); assert.equal(current.owner, 'command/next-session');
  assert.equal(current.session_id, 'platform/P3');
  assert.equal(state(f, 'stage.json').state, 'running');
});

test('retry preserves failure history and rejects active windows, wrong receipts and missing evidence', t => {
  const f = fixture(t); init(f); const first = claim(f).request;
  evidence(f); evidence(f, 'retry.md', 'Cause addressed; controller authorizes the same stage within the original scope\n');
  callback(f, 'fail', first, 'evidence.md', [], 2);
  const retryArgs = ['--id', taskId, '--owner', 'controller/recovery', '--dispatch', first.dispatch_id, '--evidence', 'retry.md'];
  let r = run(f, 'retry', ...retryArgs); assert.equal(r.status, 1); assert.match(r.stderr, /窗口/);
  json(run(f, 'handoff', ...args(first)));
  r = run(f, 'retry', ...retryArgs.slice(0, -1), 'missing.md'); assert.equal(r.status, 1); assert.match(r.stderr, /非空/);
  r = run(f, 'retry', ...retryArgs.map(v => v === first.dispatch_id ? 'f'.repeat(64) : v));
  assert.equal(r.status, 1); assert.match(r.stderr, /回执/);
  config(f, { version: 1, execution: { enabled: false } });
  r = run(f, 'retry', ...retryArgs); assert.equal(r.status, 1); assert.match(r.stderr, /execution.enabled/);
  config(f, { version: 1, execution: { enabled: true } });
  assert.equal(json(run(f, 'retry', ...retryArgs)).action, 'retry_ready');
  const ready = state(f, 'stage.json'); assert.equal(ready.attempts, 1); assert.equal(ready.retry_of, first.dispatch_id);
  assert.equal(state(f, 'receipts/' + first.dispatch_id + '.json').outcome, 'fail');
  assert.equal(callback(f, 'fail', first, 'evidence.md', ['--handoff'], 2).duplicate, true);
  assert.deepEqual(state(f, 'stage.json'), ready);
  const next = claim(f, 'dsh/retry').request; assert.notEqual(next.dispatch_id, first.dispatch_id); assert.equal(next.stage, 'P2');
  assert.match(next.prompt, /DSH\/Orca 原生任务清单/); assert.match(next.prompt, /PyCharm/);
  const current = state(f, 'window.json');
  callback(f, 'fail', first, 'evidence.md', ['--handoff'], 2);
  assert.deepEqual(state(f, 'window.json'), current); assert.equal(state(f, 'stage.json').state, 'running');
  const events = fs.readFileSync(path.join(f.root, '_plan/process', taskId, 'autopilot-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(e => e.action === 'retry').length, 1);
});

test('execution failures consume a finite retry budget without resetting attempts', t => {
  const f = fixture(t); init(f); evidence(f);
  for (let i = 1; i <= 3; i++) {
    const request = claim(f, 'dsh/attempt-' + i).request;
    callback(f, 'fail', request, 'evidence.md', ['--handoff'], 2);
    assert.equal(state(f, 'stage.json').attempts, i);
    evidence(f, 'retry.md', 'Root cause assessment and authorized retry ' + i);
    const r = run(f, 'retry', '--id', taskId, '--owner', 'controller/recovery', '--dispatch', request.dispatch_id, '--evidence', 'retry.md');
    if (i < 3) { json(r); assert.equal(state(f, 'stage.json').attempts, i); }
    else { assert.equal(r.status, 1); assert.match(r.stderr, /max_attempts/); }
  }
  assert.equal(adviceResult(f, 2).decisions[0].reason, 'attempt_limit');
});

test('a confirmed interruption can be retried only with its own receipt', t => {
  const f = fixture(t); init(f); const request = claim(f).request;
  evidence(f, 'stopped.md', 'Verified original platform session is stopped');
  json(run(f, 'interrupt', ...args(request), '--evidence', 'stopped.md', '--confirmed-stopped'), 2);
  assert.equal(state(f, 'stage.json').attempts, 1);
  evidence(f, 'retry.md', 'Failure reviewed and authorized to retry original scope');
  json(run(f, 'retry', '--id', taskId, '--owner', 'controller/recovery', '--dispatch', request.dispatch_id, '--evidence', 'retry.md'));
  assert.equal(claim(f, 'dsh/recovered').request.stage, 'P2');
});

test('non-Git completion fingerprints source and evidence while excluding runtime metadata', t => {
  const f = fixture(t); put(f.root, 'src/binary.dat', Buffer.from([0, 1, 255]).toString('latin1'));
  init(f); const request = claim(f).request; evidence(f); callback(f, 'complete', request);
  assert.match(state(f, 'stage.json').completed_worktree, /^[a-f0-9]{64}$/);
  put(f.root, '_plan/autopilot/' + taskId + '/platform-note.json', { platform_task: 'dsh/task-1' });
  assert.equal(adviceResult(f).decisions[0].next_stage, 'P3');
  const source = path.join(f.root, 'src/binary.dat'), original = fs.readFileSync(source);
  for (const mutate of [() => fs.writeFileSync(source, Buffer.from([0, 2, 255])), () => fs.unlinkSync(source)]) {
    mutate(); assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_worktree_changed'); fs.writeFileSync(source, original);
  }
  put(f.root, 'src/new.txt', 'added'); assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_worktree_changed');
  fs.unlinkSync(path.join(f.root, 'src/new.txt'));
  assert.equal(adviceResult(f).decisions[0].next_stage, 'P3');
  evidence(f, 'evidence.md', 'Rewritten evidence');
  assert.equal(adviceResult(f, 2).decisions[0].reason, 'stage_worktree_changed');
});

test('non-Git verification detects changes observed during an assessment', t => {
  const f = fixture(t); init(f); put(f.root, 'src/a.txt', 'before');
  const previous = process.env.GIT_CEILING_DIRECTORIES; process.env.GIT_CEILING_DIRECTORIES = env.GIT_CEILING_DIRECTORIES;
  try {
    const core = require('../skills/axns-devflow-ext-autopilot/scripts/lib/core.cjs');
    const ctx = core.context(f.root); put(f.root, 'src/a.txt', 'after');
    assert.throws(() => core.verify(ctx), /内容改变/);
  } finally { if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previous; }
});

test('P0 accepts documented existing authorization and hands off a usable P1 order', t => {
  const f = fixture(t); init(f, 'P0');
  const first = claim(f, 'dsh/conversation-1/task-a').request;
  assert.equal(first.stage, 'P0');
  assert.doesNotMatch(first.prompt, /\{\{[^}]+\}\}/);
  evidence(f, 'opening.md', 'Existing user instruction: implement task A and run its checks.\nProject and active task inspected; authorization still applies.\n');
  assert.equal(run(f, 'complete', ...args(first), '--evidence', 'opening.md', '--handoff').status, 1);
  assert.equal(state(f, 'stage.json').state, 'running');
  callback(f, 'complete', first, 'opening.md', ['--user-confirmed', '--handoff']);
  assert.equal(state(f, 'stage.json').user_confirmed, true);
  assert.equal(state(f, 'stage.json').human_acceptance, undefined);
  assert.equal(adviceResult(f).decisions[0].next_stage, 'P1');
  const next = claim(f, first.owner).request;
  assert.equal(next.task_id, taskId); assert.equal(next.stage, 'P1');
  assert.notEqual(next.dispatch_id, first.dispatch_id);
  assert.doesNotMatch(next.prompt, /\{\{[^}]+\}\}/);
  assert.equal(state(f, 'window.json').dispatch_id, next.dispatch_id);
});

test('one platform conversation can take a new task after handoff with a fresh owner and dispatch', t => {
  const f = fixture(t); init(f);
  const first = claim(f, 'dsh/conversation-1/task-a').request;
  evidence(f); callback(f, 'complete', first);
  const nextId = '20261113-next-task';
  put(f.root, '_plan/.active_plan', nextId);
  json(run(f, 'init', '--id', nextId, '--stage', 'P2', '--owner', 'controller/test'));
  assert.equal(run(f, 'claim', '--owner', first.owner).status, 1);
  const next = claim(f, 'dsh/conversation-1/task-b').request;
  assert.equal(next.task_id, nextId); assert.equal(next.cwd, f.root);
  assert.notEqual(next.dispatch_id, first.dispatch_id);
  assert.equal(run(f, 'heartbeat', ...args({ ...first, task_id: nextId })).status, 1);
  json(run(f, 'heartbeat', ...args(next)));
  put(f.root, '_plan/process/' + nextId + '/evidence.md', 'Task B implementation checked independently.\n');
  callback(f, 'complete', next);
  const nextState = JSON.parse(fs.readFileSync(path.join(f.root, '_plan/autopilot', nextId, 'stage.json'), 'utf8'));
  assert.equal(nextState.state, 'completed'); assert.equal(nextState.owner, next.owner);
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot', nextId, 'window.json')), false);
});

function setupClosingWorktree(t) {
  const f = fixture(t, true);
  fs.unlinkSync(path.join(f.root, '_plan/.active_plan'));
  put(f.root, 'AGENTS.md', 'extensions: [worktree, autopilot]\nintegration_branch: main\nautopilot_config: _plan/prompts/autopilot.json\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'enable worktree');
  put(f.temp, 'manifest.json', { scope: ['src/a.txt'], shared_claims: [], depends_on: [], owner: 'controller/test' });
  f.taskRoot = json(spawnSync(process.execPath, [worktree, 'register', '--project', f.root, '--id', taskId, '--manifest', path.join(f.temp, 'manifest.json')], { env, encoding: 'utf8' })).worktree;
  init(f, 'P4');
  const request = claim(f).request;
  put(f.taskRoot, 'src/a.txt', 'verified result\n');
  put(f.taskRoot, `_plan/process/${taskId}/acceptance.md`, 'Actual verification and review passed; human acceptance disabled.\n');
  const committed = json(spawnSync(process.execPath, [worktree, 'commit', '--project', f.taskRoot, '--id', taskId], { env, encoding: 'utf8' }));
  return { f, request, head: committed.head };
}

test('default P4 completion requires candidate attestation, then claim merges, archives and deletes', t => {
  const { f, request, head } = setupClosingWorktree(t);
  const missing = run(f, 'complete', ...args(request), '--evidence', 'acceptance.md', '--handoff');
  assert.equal(missing.status, 1); assert.match(missing.stderr, /accepted-head/);
  assert.equal(state(f, 'stage.json').state, 'running');
  callback(f, 'complete', request, 'acceptance.md', ['--accepted-head', head, '--handoff']);
  assert.equal(state(f, 'stage.json').acceptance.accepted_head, head);
  assert.equal(json(run(f, 'precheck')).actionable, true);
  assert.equal(adviceResult(f).decisions[0].action, 'finish');
  const finished = claim(f, 'orca/closer');
  assert.equal(finished.action, 'finished'); assert.equal(finished.task.status, 'completed');
  assert.equal(git(f.root, 'rev-parse', 'main'), head);
  assert.equal(git(f.root, 'branch', '--list', `task/${taskId}`), '');
  assert.ok(!fs.existsSync(f.taskRoot));
  assert.equal(claim(f, 'orca/again').action, 'hold');
});

test('runner resumes partial cleanup without the deleted task directory and retains claims until success', t => {
  const { f, request, head } = setupClosingWorktree(t);
  callback(f, 'complete', request, 'acceptance.md', ['--accepted-head', head, '--handoff']);
  const lock = path.join(f.root, `.git/refs/heads/task/${taskId}.lock`); fs.writeFileSync(lock, 'busy');
  assert.equal(run(f, 'finish', '--id', taskId).status, 1);
  assert.ok(!fs.existsSync(f.taskRoot));
  assert.equal(adviceResult(f).decisions[0].reason, 'cleanup_resume');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, `_plan/active/${taskId}.pointer`))).holds_claims, true);
  fs.unlinkSync(lock);
  assert.equal(claim(f, 'orca/recover').action, 'finished');
  assert.ok(!fs.existsSync(path.join(f.root, `_plan/active/${taskId}.pointer`)));
});

test('explicit finish disable and blocking human acceptance keep the task intact', t => {
  const { f, request, head } = setupClosingWorktree(t);
  callback(f, 'complete', request, 'acceptance.md', ['--accepted-head', head, '--handoff']);
  config(f, { version: 1, execution: { enabled: true }, capabilities: { finish_task: { enabled: false } } });
  assert.equal(adviceResult(f).decisions[0].reason, 'finish_disabled');
  assert.equal(claim(f, 'orca/closer').action, 'hold');
  config(f, { version: 1, execution: { enabled: true } });
  put(f.root, '_plan/prompts/acceptance.json', { version: 1, human_acceptance: { enabled: true, blocking: true } });
  assert.equal(adviceResult(f).decisions[0].reason, 'awaiting_human_acceptance');
  assert.equal(json(run(f, 'finish', '--id', taskId)).action, 'hold');
  assert.ok(fs.existsSync(f.taskRoot)); assert.notEqual(git(f.root, 'rev-parse', 'main'), head);
});

test('integration moving after P4 hands off schedules a fresh P4 instead of asking the user', t => {
  const { f, request, head } = setupClosingWorktree(t);
  callback(f, 'complete', request, 'acceptance.md', ['--accepted-head', head, '--handoff']);
  put(f.root, 'independent.txt', 'other task result\n'); git(f.root, 'add', 'independent.txt'); git(f.root, 'commit', '-m', 'other task');
  const decision = adviceResult(f).decisions[0];
  assert.equal(decision.action, 'advance'); assert.equal(decision.reason, 'integration_advanced');
  assert.equal(decision.next_stage, 'P4'); assert.equal(decision.needs_human, false);
  assert.equal(claim(f, 'orca/recombine').request.stage, 'P4');
  assert.ok(fs.existsSync(f.taskRoot));
});

test('ordinary stage failure wakes recovery without presenting it as a human decision', t => {
  const f = fixture(t); init(f); const request = claim(f).request; evidence(f);
  callback(f, 'fail', request, 'evidence.md', ['--handoff'], 2);
  const decision = adviceResult(f, 2).decisions[0];
  assert.equal(decision.recovery_required, true); assert.equal(decision.needs_human, false);
  assert.equal(json(run(f, 'precheck')).actionable, true);
});

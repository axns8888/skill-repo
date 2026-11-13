const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'skills/axns-devflow-ext-autopilot/scripts/autopilot.cjs');
const worktree = path.join(repo, 'skills/axns-devflow-ext-worktree/scripts/worktree.cjs');
const a = '20261112-alpha', b = '20261112-beta';
function put(root, file, data) {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}
function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trimEnd();
}
function fixture(t, wt = false) {
  const cache = path.join(repo, '.cache'); fs.mkdirSync(cache, { recursive: true });
  const temp = fs.mkdtempSync(path.join(cache, 'autopilot-tests-'));
  const root = path.join(temp, '项目 with spaces'); fs.mkdirSync(root);
  put(root, 'AGENTS.md', `extensions: [${wt ? 'worktree, ' : ''}autopilot]\nintegration_branch: main\nautopilot_config: "_plan/prompts/auto pilot.json"\n`);
  put(root, '_plan/prompts/auto pilot.json', { version: 1, slots: 2 });
  if (wt) {
    git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'config', 'core.autocrlf', 'false');
    put(root, '.gitignore', '/.worktrees/\n/_plan/active/\n/_plan/archive/\n/_plan/registry.jsonl\n/_plan/autopilot/\n');
    put(root, 'src/a.txt', 'alpha\n'); put(root, 'src/b.txt', 'beta\n');
    git(root, 'add', '.'); git(root, 'commit', '-m', 'initial');
  } else put(root, '_plan/.active_plan', a);
  t.after(() => {
    if (path.dirname(path.resolve(temp)) !== cache) throw new Error('Unexpected cleanup path');
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return { root, temp };
}
function config(f, value) { put(f.root, '_plan/prompts/auto pilot.json', value); }
function run(root, command = 'decide', ...extra) {
  return spawnSync(process.execPath, [script, command, '--project', root, ...extra], { encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.join(repo, '.cache') } });
}
function output(result, code = 0) { assert.equal(result.status, code, result.stderr || result.stdout); return JSON.parse(result.stdout); }
function decision(f, code = 0) { return output(run(f.root), code).decisions[0]; }
function bad(f, pattern) { const r = run(f.root); assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, pattern); assert.equal(r.stdout, ''); }
function stage(f, taskId = a, extra = {}) {
  if (extra.state === 'completed' && !Object.hasOwn(extra, 'completed_worktree'))
    extra = { completed_worktree: output(run(f.root, 'status')).tasks.find(t => t.task_id === taskId).worktree_snapshot, ...extra };
  put(f.root, `_plan/autopilot/${taskId}/stage.json`, { task_id: taskId, stage: 'P1', state: 'ready',
    owner: `window/${taskId}`, updated_at: new Date(Date.now() - 60000).toISOString(), ...extra });
}
function window(f, taskId = a, age = 0) {
  put(f.root, `_plan/autopilot/${taskId}/window.json`, { task_id: taskId, stage: 'P1', owner: `window/${taskId}`,
    dispatch_id: 'reserved-dispatch', opened_at: new Date(Date.now() - 3600000).toISOString(),
    heartbeat_at: new Date(Date.now() - age * 60000).toISOString() });
}
function wtRun(f, command, taskId, ...extra) {
  return spawnSync(process.execPath, [worktree, command, '--project', f.root, '--id', taskId, ...extra], { encoding: 'utf8' });
}
function register(f, taskId = a, deps = [], shared = [], code = 0) {
  const manifest = path.join(f.temp, `${taskId}.json`);
  put(f.temp, `${taskId}.json`, { scope: [`src/${taskId === a ? 'a' : 'b'}.txt`], shared_claims: shared, depends_on: deps, owner: `window/${taskId}` });
  return output(wtRun(f, 'register', taskId, '--manifest', manifest), code);
}
function commit(root, taskId) { git(root, 'add', '.'); git(root, 'commit', '-m', `${taskId}: evidence`); return git(root, 'rev-parse', 'HEAD'); }
function completed(f, task, extra = {}) {
  put(task.worktree, `_plan/process/${task.task_id}/evidence.md`, 'Actual test evidence\n');
  stage(f, task.task_id, { stage: 'P2', state: 'completed', evidence: 'evidence.md', completed_head: git(task.worktree, 'rev-parse', 'HEAD'),
    completed_worktree: output(run(f.root, 'status')).tasks.find(t => t.task_id === task.task_id).worktree_snapshot, ...extra });
}
function accepted(f, task) {
  put(task.worktree, `_plan/process/${task.task_id}/acceptance.md`, 'Technical checks passed; human acceptance tracked independently\n');
  const head = commit(task.worktree, task.task_id);
  stage(f, task.task_id, { stage: 'P4', state: 'completed', evidence: 'acceptance.md', completed_head: head,
    completed_worktree: output(run(f.root, 'status')).tasks.find(t => t.task_id === task.task_id).worktree_snapshot,
    acceptance: { result: 'passed', accepted_head: head } });
  config(f, { version: 1, capabilities: { finish_task: { enabled: true } } });
  return head;
}

test('disabled projects do not need config or read task files', t => {
  const f = fixture(t); put(f.root, 'AGENTS.md', '# manual\n');
  put(f.root, '_plan/prompts/auto pilot.json', '{broken');
  assert.equal(output(run(f.root)).enabled, false);
});

test('config defaults work; schema rejects unsafe opt-outs, typos and string booleans', t => {
  const f = fixture(t); stage(f);
  assert.equal(decision(f).next_stage, 'P1');
  for (const [value, pattern] of [
    [{ slots: 1 }, /version/], [{ version: 1, slots: 0 }, /slots/],
    [{ version: 1, capabilities: { advance: { enabled: 'false' } } }, /布尔/],
    [{ version: 1, capabilities: { open_window: { only_registered: false } } }, /only_registered/],
    [{ version: 1, capabilities: { advance: { max_stage: 'P5' } } }, /max_stage/],
    [{ version: 1, capabilites: {} }, /未知字段/],
    [{ version: 1, stage_markers: { P2: ['../escape'] } }, /路径/],
    [{ version: 1, tiers: { P2: 'high' }, models: { low: { provider: 'p', model: 'm' } } }, /不存在/],
  ]) { config(f, value); bad(f, pattern); }
});

test('corrupt state and unsafe pointers/config paths fail without emitting advice', t => {
  const f = fixture(t); put(f.root, '_plan/.active_plan', '../escape'); bad(f, /task-id/);
  put(f.root, '_plan/.active_plan', a); stage(f); put(f.root, `_plan/autopilot/${a}/window.json`, '{broken'); bad(f, /JSON/);
  put(f.root, 'AGENTS.md', 'extensions: [autopilot]\nautopilot_config: ../outside.json\n'); bad(f, /路径/);
});

test('markers are observations; ready runs current stage and running cannot skip work', t => {
  const f = fixture(t); put(f.root, `_plan/process/${a}/acceptance.md`, 'template only');
  assert.equal(decision(f, 2).reason, 'stage_missing');
  stage(f); const first = decision(f); assert.equal(first.next_stage, 'P1');
  assert.equal(decision(f).dispatch_id, first.dispatch_id);
  stage(f, a, { stage: 'P2', state: 'running' }); assert.equal(decision(f, 2).reason, 'window_state_missing');
  stage(f, a, { stage: 'P2', state: 'completed', evidence: 'missing.md' }); assert.equal(decision(f, 2).reason, 'stage_evidence_missing');
  put(f.root, `_plan/process/${a}/evidence.md`, 'Executed checks\n');
  stage(f, a, { stage: 'P2', state: 'completed', evidence: 'evidence.md' });
  assert.equal(decision(f).next_stage, 'P3');
});

test('P0 confirmation, stage ceiling and capability switches are independent', t => {
  const f = fixture(t); stage(f, a, { stage: 'P0', state: 'completed' });
  assert.equal(decision(f, 2).reason, 'p0_confirmation_pending');
  stage(f, a, { stage: 'P0', state: 'completed', user_confirmed: true }); assert.equal(decision(f).next_stage, 'P1');
  config(f, { version: 1, capabilities: { advance: { max_stage: 'P3' } } });
  stage(f, a, { stage: 'P4' }); assert.equal(decision(f).reason, 'stage_cap');
  stage(f);
  for (const cap of ['advance', 'open_window']) {
    config(f, { version: 1, capabilities: { [cap]: { enabled: false } } });
    assert.equal(decision(f).reason, `${cap}_disabled`);
  }
  config(f, { version: 1, capabilities: { switch_model: { enabled: false } }, tiers: { P1: 'high' }, models: { high: { provider: 'p', model: 'm' } } });
  assert.equal(decision(f).model, null);
  config(f, { version: 1, tiers: { P1: 'high' }, models: { high: { provider: 'p', model: 'm' } } });
  assert.deepEqual(decision(f).model, { provider: 'p', model: 'm' });
});

test('active and stale windows both prevent duplicate dispatch; failed attempts stop', t => {
  const f = fixture(t); stage(f); window(f);
  assert.equal(decision(f).reason, 'window_active');
  window(f, a, 45); assert.equal(decision(f, 2).reason, 'window_stalled');
  fs.unlinkSync(path.join(f.root, `_plan/autopilot/${a}/window.json`));
  stage(f, a, { attempts: 3 }); assert.equal(decision(f, 2).reason, 'attempt_limit');
  stage(f, a, { state: 'failed' }); assert.equal(decision(f, 2).reason, 'stage_failed');
});

test('worktree invocations read canonical config and runtime, and task-local evidence', t => {
  const f = fixture(t, true); put(f.root, 'AGENTS.md', 'extensions: [worktree]\nintegration_branch: main\n');
  git(f.root, 'add', 'AGENTS.md'); git(f.root, 'commit', '-m', 'project before autopilot');
  const task = register(f);
  put(f.root, 'AGENTS.md', 'extensions: [worktree, autopilot]\nintegration_branch: main\nautopilot_config: "_plan/prompts/auto pilot.json"\n');
  completed(f, task);
  const value = output(run(task.worktree)).decisions[0];
  assert.equal(value.next_stage, 'P3'); assert.equal(value.task_root, task.worktree);
  assert.equal(output(run(task.worktree, 'status')).primary_root, f.root);
  const before = git(task.worktree, 'status', '--porcelain');
  const runtime = fs.readFileSync(path.join(f.root, `_plan/autopilot/${a}/stage.json`), 'utf8');
  output(run(task.worktree)); assert.equal(git(task.worktree, 'status', '--porcelain'), before);
  assert.equal(fs.readFileSync(path.join(f.root, `_plan/autopilot/${a}/stage.json`), 'utf8'), runtime);
});

test('pending dependencies block; completed archive releases the dependent task', t => {
  const f = fixture(t, true); const first = register(f); register(f, b, [a]); stage(f); stage(f, b);
  let values = output(run(f.root)).decisions; assert.equal(values.find(v => v.task_id === b).reason, 'dependency_pending');
  const head = accepted(f, first); git(f.root, 'merge', '--ff-only', first.branch);
  output(wtRun(f, 'finish', a, '--accepted-head', head));
  values = output(run(f.root)).decisions; assert.equal(values[0].task_id, b); assert.equal(values[0].action, 'advance');
});

test('slot budget counts stalled windows while independent tasks continue', t => {
  const f = fixture(t, true); register(f); register(f, b); stage(f); stage(f, b);
  config(f, { version: 1, slots: 1 });
  let values = output(run(f.root)).decisions;
  assert.equal(values[0].action, 'advance'); assert.equal(values[1].reason, 'slots_full');
  window(f); values = output(run(f.root)).decisions;
  assert.equal(values[0].reason, 'window_active'); assert.equal(values[1].reason, 'slots_full');
  config(f, { version: 1, slots: 2 }); window(f, a, 40);
  const result = output(run(f.root)); assert.equal(result.action_count, 1);
  assert.equal(result.needs_human_count + result.recovery_count, 1); assert.equal(result.blocking_human_count, 0);
  assert.equal(result.decisions.find(v => v.task_id === b).action, 'advance');
});

test('changed task HEAD invalidates previously completed evidence', t => {
  const f = fixture(t, true); const task = register(f); completed(f, task);
  commit(task.worktree, a); assert.equal(decision(f, 2).reason, 'stage_head_changed');
});

test('finish requires current technical attestation, committed evidence, clean tree and integration', t => {
  const f = fixture(t, true); const task = register(f); const head = accepted(f, task);
  assert.equal(decision(f).action, 'finish');
  git(f.root, 'merge', '--ff-only', task.branch);
  const final = decision(f); assert.equal(final.action, 'finish'); assert.equal(final.accepted_head, head);
  const stageFile = path.join(f.root, `_plan/autopilot/${a}/stage.json`);
  const current = JSON.parse(fs.readFileSync(stageFile));
  stage(f, a, { ...current, acceptance: { ...current.acceptance, accepted_head: 'f'.repeat(40) } });
  assert.equal(decision(f, 2).reason, 'technical_acceptance_invalid');
  put(f.root, `_plan/autopilot/${a}/stage.json`, current);
  put(task.worktree, 'temporary.txt', 'leftover'); assert.equal(decision(f, 2).reason, 'stage_worktree_changed');
  fs.unlinkSync(path.join(task.worktree, 'temporary.txt'));
  put(task.worktree, `_plan/process/${a}/acceptance.md`, 'uncommitted acceptance'); assert.equal(decision(f, 2).reason, 'stage_worktree_changed');
  git(task.worktree, 'restore', `_plan/process/${a}/acceptance.md`);
  output(wtRun(f, 'finish', a, '--accepted-head', final.accepted_head));
  assert.equal(fs.existsSync(task.worktree), false); assert.equal(output(run(f.root)).action_count, 0);
});

test('single-task finish is explicitly unsupported and coordination locks block advice', t => {
  const f = fixture(t); put(f.root, `_plan/process/${a}/evidence.md`, 'Recorded\n');
  config(f, { version: 1, capabilities: { finish_task: { enabled: true } } });
  stage(f, a, { stage: 'P4', state: 'completed', evidence: 'evidence.md' });
  assert.equal(decision(f).reason, 'finish_requires_worktree');
  const g = fixture(t, true); register(g); stage(g);
  fs.mkdirSync(path.join(g.root, '.git/axns-devflow.lock')); bad(g, /协调锁/);
});


test('uncommitted edits invalidate completed evidence without forcing a commit', t => {
  const f = fixture(t, true); const task = register(f); completed(f, task);
  assert.equal(decision(f).next_stage, 'P3');
  put(task.worktree, 'src/a.txt', 'changed after review\n');
  assert.equal(decision(f, 2).reason, 'stage_worktree_changed');
  git(task.worktree, 'restore', 'src/a.txt'); assert.equal(decision(f).next_stage, 'P3');
  git(task.worktree, 'add', `_plan/process/${a}/evidence.md`);
  assert.equal(decision(f, 2).reason, 'stage_worktree_changed');
});

test('blocked tasks wait, timeout is calculated, and missing claims cannot dispatch', t => {
  const f = fixture(t, true); register(f, a, [], ['shared.lock']); const blocked = register(f, b, [], ['shared.lock'], 2);
  stage(f); stage(f, b); assert.equal(output(run(f.root)).decisions.find(v => v.task_id === b).reason, 'blocked_by_claim');
  const mutate = value => {
    put(f.root, `_plan/active/${b}.pointer`, value);
    put(blocked.worktree, `_plan/process/${b}/parallel.json`, value);
  };
  mutate({ ...blocked, waiting_since: new Date(Date.now() - 121 * 60000).toISOString() });
  assert.equal(output(run(f.root)).decisions.find(v => v.task_id === b).reason, 'wait_timeout');
  mutate({ ...blocked, status: 'claimed', waiting_since: null, holds_claims: false });
  assert.equal(output(run(f.root)).decisions.find(v => v.task_id === b).reason, 'claims_missing');
});


test('Git single-task mode limits slots to one and excludes runtime from completion snapshots', t => {
  const f = fixture(t, true);
  put(f.root, 'AGENTS.md', 'extensions:\n  - autopilot\nautopilot_config: "_plan/prompts/auto pilot.json"\n');
  put(f.root, '_plan/.active_plan', a);
  put(f.root, `_plan/process/${a}/evidence.md`, 'Uncommitted evidence\n');
  const status = output(run(f.root, 'status')); assert.equal(status.slots, 1);
  stage(f, a, { stage: 'P2', state: 'completed', evidence: 'evidence.md',
    completed_head: status.tasks[0].head, completed_worktree: status.tasks[0].worktree_snapshot });
  assert.equal(decision(f).next_stage, 'P3'); assert.equal(decision(f).next_stage, 'P3');
});

test('runtime symlinks cannot redirect state outside the project', t => {
  const f = fixture(t); const external = path.join(f.temp, 'external-runtime'); fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(f.root, '_plan/autopilot'), 'junction');
  bad(f, /链接/);
});

function humanPolicy(f, enabled, blocking) {
  put(f.root, '_plan/prompts/acceptance.json', { version: 1, human_acceptance: { enabled, blocking } });
}

test('human policy defaults off, validates strictly and changes dispatch identity independently', t => {
  const f = fixture(t); stage(f);
  const first = decision(f); assert.equal(first.human_acceptance, 'disabled');
  assert.deepEqual(output(run(f.root, 'status')).human_acceptance, { enabled: false, blocking: false });
  humanPolicy(f, true, false);
  const next = decision(f); assert.equal(next.action, 'advance'); assert.equal(next.human_acceptance, 'pending');
  assert.notEqual(next.dispatch_id, first.dispatch_id);
  for (const value of [
    '{broken', { version: 2, human_acceptance: { enabled: false, blocking: false } },
    { version: 1, human_acceptance: { enabled: 'false', blocking: false } },
    { version: 1, human_acceptance: { enabled: false, blocking: true } },
    { version: 1, human_acceptance: { enabled: true } },
    { version: 1, human_acceptance: { enabled: true, blocking: false, typo: true } },
    { version: 1, human_acceptance: { enabled: true, blocking: false }, typo: true }
  ]) { put(f.root, '_plan/prompts/acceptance.json', value); bad(f, /JSON|acceptance|human_acceptance/); }
});

test('nonblocking human acceptance permits finish and archives pending without fabricated approval', t => {
  const f = fixture(t, true); const task = register(f); const head = accepted(f, task);
  git(f.root, 'merge', '--ff-only', task.branch); humanPolicy(f, true, false);
  const value = decision(f); assert.equal(value.action, 'finish'); assert.equal(value.human_acceptance, 'pending');
  assert.equal(value.human_accepted_by, undefined);
  const done = output(wtRun(f, 'finish', a, '--accepted-head', head));
  assert.deepEqual(done.human_acceptance, { enabled: true, blocking: false, status: 'pending' });
  assert.equal(fs.existsSync(task.worktree), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, `_plan/archive/${a}.pointer`))).human_acceptance, done.human_acceptance);
});

test('blocking human gate uses primary policy, current separate receipt and holds only its task', t => {
  const f = fixture(t, true); const task = register(f);
  put(task.worktree, '_plan/prompts/acceptance.json', { version: 1, human_acceptance: { enabled: false, blocking: false } });
  const head = accepted(f, task); git(f.root, 'merge', '--ff-only', task.branch);
  register(f, b); stage(f, b); humanPolicy(f, true, true);
  const file = `_plan/autopilot/${a}/stage.json`; const saved = JSON.parse(fs.readFileSync(path.join(f.root, file)));
  // A legacy mixed receipt cannot silently satisfy the new independent human gate.
  put(f.root, file, { ...saved, acceptance: { ...saved.acceptance, accepted_by: 'legacy/human' } });
  let result = output(run(task.worktree));
  let value = result.decisions.find(d => d.task_id === a);
  assert.equal(value.reason, 'awaiting_human_acceptance'); assert.equal(value.blocks_batch, false);
  assert.equal(result.needs_human_count, 1); assert.equal(result.blocking_human_count, 0);
  assert.equal(result.decisions.find(d => d.task_id === b).action, 'advance');
  put(f.root, file, { ...saved, human_acceptance: { result: 'passed', accepted_by: 'human/current', accepted_head: 'f'.repeat(40) } });
  assert.equal(output(run(f.root)).decisions[0].reason, 'awaiting_human_acceptance');
  put(f.root, file, { ...saved, human_acceptance: { result: 'passed', accepted_by: 'human/current', accepted_head: head } });
  value = output(run(f.root)).decisions[0];
  assert.equal(value.action, 'finish'); assert.equal(value.human_acceptance, 'passed');
  assert.equal(value.human_accepted_by, 'human/current');
  const done = output(wtRun(f, 'finish', a, '--accepted-head', head, '--human-accepted-by', value.human_accepted_by));
  assert.equal(done.human_acceptance.status, 'passed'); assert.equal(done.human_acceptance.accepted_head, head);
});

test('failed tasks hold only themselves; dependencies and shared-state corruption still prevent unsafe work', t => {
  const f = fixture(t, true); register(f); register(f, b); stage(f, a, { state: 'failed', attempts: 1 }); stage(f, b);
  let result = output(run(f.root));
  assert.equal(result.decisions.find(v => v.task_id === a).reason, 'stage_failed');
  assert.equal(result.decisions.find(v => v.task_id === b).action, 'advance');
  assert.equal(result.needs_human_count, 0); assert.equal(result.recovery_count, 1); assert.equal(result.blocking_human_count, 0);
  const pointer = JSON.parse(fs.readFileSync(path.join(f.root, `_plan/active/${b}.pointer`)));
  pointer.depends_on = [a]; put(f.root, `_plan/active/${b}.pointer`, pointer);
  put(pointer.worktree, `_plan/process/${b}/parallel.json`, pointer);
  result = output(run(f.root), 2); assert.equal(result.action_count, 0);
  assert.equal(result.decisions.find(v => v.task_id === b).reason, 'dependency_pending');
  put(f.root, `_plan/active/${a}.pointer`, '{broken'); bad(f, /JSON/);
});

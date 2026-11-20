'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const controller = require('../skills/axns-devflow-ext-autopilot/scripts/orca-controller.cjs');
const native = require('../skills/axns-devflow-ext-autopilot/scripts/adapters/orca-bridge.cjs');
const dispatch = require('../skills/axns-devflow-ext-autopilot/scripts/lib/dispatch.cjs');
const { acquire } = require('../skills/axns-devflow-ext-autopilot/scripts/lib/process-lock.cjs');
const scripts = path.resolve(__dirname, '../skills/axns-devflow-ext-autopilot/scripts');
const id = '20261120-native-chain';
function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
function get(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function fixture(t, mode = 'ok') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orca-'));
  const root = path.join(temp, '项目 with spaces'); fs.mkdirSync(root);
  const state = path.join(temp, 'platform.json'), mock = path.join(temp, 'orca.cjs');
  put(state, { cwd: root, mode, sessions: [], launches: 0, calls: [] });
  put(mock, `const fs=require('node:fs'),file=process.argv[2],args=process.argv.slice(3),c=JSON.parse(fs.readFileSync(file));
c.calls.push(args.slice(0,2).join(' '));
const save=()=>fs.writeFileSync(file,JSON.stringify(c));
const out=value=>{save();console.log(JSON.stringify({ok:true,result:value}));};
if(args[0]==='worktree'&&args[1]==='show') out({worktree:{path:c.cwd,hostId:'local'}});
else if(args[0]==='worktree'&&args[1]==='ps') out({worktrees:[{path:c.cwd,hostId:'local',agents:c.sessions}],truncated:false});
else if(args[0]==='agent'&&args[1]==='launch') {
 c.lastLaunchArgs=args;
 const agentType=args[args.indexOf('--agent')+1];
 c.launches++;const sessionId=agentType+'_native_'+c.launches,handle='structured-agent-session-'+sessionId;
 const prompt=args[args.indexOf('--prompt')+1];
 c.sessions.push({paneKey:handle+':leaf',agentType,state:'working',prompt,mainAgent:{state:'working'}});
 if(c.mode==='lost'){save();console.log(JSON.stringify({ok:false,error:{message:'reply lost'}}));process.exitCode=1;}
 else out({outcome:{kind:c.mode==='terminal'?'terminal':'structured',sessionId,handle},prompt:{outcome:'journaled'},operationId:'op-'+c.launches});
} else {save();process.exitCode=7;}`);
  const configFile = path.join(root, '_plan/prompts/autopilot.json');
  put(path.join(root, 'AGENTS.md'), 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
  put(path.join(root, '_plan/.active_plan'), id);
  const config = { version: 1, execution: { enabled: true, adapter: 'command', require_units: true, timeout_seconds: 30,
    command: { file: process.execPath, args: [path.join(scripts, 'adapters/orca-bridge.cjs'),
      '--orca-file', process.execPath, '--orca-arg', mock, '--orca-arg', state] } }, capabilities: { advance: { max_stage: 'P2' } } };
  put(configFile, config);
  const processDir = path.join(root, '_plan/process', id);
  put(path.join(processDir, 'plan.md'), 'Bounded native chain test. Stage P2 has two work units.\n');
  for (const n of [1, 2]) put(path.join(processDir, 'unit' + n + '.json'), { id: 'native-' + n, goal: 'One bounded test task ' + n,
    inputs: ['plan.md'], write_scope: ['_plan/process/' + id], done_when: ['Evidence is written'], stop_when: ['After callback'],
    budget: { max_steps: 3, max_minutes: 3 } });
  function run(command, ...args) {
    const result = spawnSync(process.execPath, [path.join(scripts, 'runner.cjs'), command, '--project', root, '--id', id, ...args],
      { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout);
  }
  run('init', '--stage', 'P2', '--owner', 'controller/test', '--unit', 'unit1.json');
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(temp)), fs.realpathSync(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true }); });
  const windowFile = path.join(root, '_plan/autopilot', id, 'window.json');
  const f = { root, temp, state, config, configFile, processDir, run, windowFile,
    opts: { cli: process.execPath, prefix: [mock, state] }, stageFile: path.join(root, '_plan/autopilot', id, 'stage.json') };
  return f;
}
function callback(f, name, request, evidence, extra = []) {
  return f.run(name, '--owner', request.owner, '--dispatch', request.dispatch_id, '--evidence', evidence, ...extra);
}
function takeover(f) {
  const w = get(f.windowFile);
  return f.run('takeover', '--owner', w.owner, '--dispatch', w.dispatch_id, '--session-id', w.session_id, '--cwd', f.root);
}
test('native controller runs two fresh sessions in the same stage and stops at stage cap', t => {
  const f = fixture(t);
  const first = controller.step(f.root, id); assert.equal(first.result.action, 'running');
  const w1 = get(f.windowFile); assert.equal(w1.session_id, 'codex_native_1');
  assert.equal(w1.request.record_dir, f.processDir);
  assert.match(w1.request.prompt, /不要包含 _plan\/process\/task-id\//);
  assert.equal(takeover(f).work_permitted, true);
  const heartbeat = w1.request.callbacks.heartbeat.map(arg => arg === '<累计完成步数>' ? '0' : arg);
  const checked = spawnSync(heartbeat[0], heartbeat.slice(1), { encoding: 'utf8', windowsHide: true });
  assert.equal(checked.status, 0, checked.stderr); assert.equal(JSON.parse(checked.stdout).work_permitted, true);
  assert.equal(controller.step(f.root, id).result.action, 'awaiting_worker');
  assert.equal(get(f.state).launches, 1);
  put(path.join(f.processDir, 'first.md'), 'Unit one completed with actual fixture evidence.\n');
  callback(f, 'yield', w1.request, 'first.md', ['--next-unit', 'unit2.json']);
  const second = controller.step(f.root, id); assert.equal(second.result.action, 'running');
  const w2 = get(f.windowFile);
  assert.equal(w2.stage, 'P2'); assert.notEqual(w2.session_id, w1.session_id); assert.notEqual(w2.owner, w1.owner);
  assert.equal(w2.request.previous_dispatch_id, w1.dispatch_id); takeover(f);
  put(path.join(f.processDir, 'second.md'), 'Both units completed with real callbacks in fixture.\n');
  callback(f, 'complete', w2.request, 'second.md', ['--handoff']);
  assert.equal(controller.step(f.root, id).result.reason, 'stage_cap');
  assert.equal(get(f.state).launches, 2); assert.equal(get(f.stageFile).state, 'completed');
  assert.equal(get(f.stageFile).attempts, 0);
});
test('a lost launch reply is recovered by exact dispatch lookup without another launch', t => {
  const f = fixture(t, 'lost');
  assert.equal(controller.step(f.root, id).result.reason, 'launch_unknown');
  const w = get(f.windowFile); assert.equal(w.phase, 'reserved');
  const replay = native.handle({ version: 1, operation: 'start', request: w.request }, f.opts);
  assert.equal(replay.state, 'running'); assert.equal(replay.session_id, 'codex_native_1');
  const recovered = controller.step(f.root, id); assert.equal(recovered.result.action, 'awaiting_worker');
  assert.equal(get(f.state).launches, 1); assert.equal(get(f.windowFile).phase, 'running');
});
test('done native turn without callback retains ownership and never creates a replacement', t => {
  const f = fixture(t); controller.step(f.root, id);
  const original = get(f.windowFile), state = get(f.state);
  state.sessions[0].state = 'done'; state.sessions[0].mainAgent = { state: 'done', outcome: 'success' }; put(f.state, state);
  const response = controller.step(f.root, id);
  assert.equal(response.code, 2); assert.equal(response.more, false); assert.equal(response.result.reason, 'launch_unknown');
  assert.equal(get(f.windowFile).dispatch_id, original.dispatch_id); assert.equal(get(f.state).launches, 1);
});
test('unknown lookup and terminal fallback never lead to another start', t => {
  const f = fixture(t, 'terminal'); assert.equal(controller.step(f.root, id).code, 2);
  const state = get(f.state); state.sessions = []; put(f.state, state);
  for (let n = 0; n < 2; n++) assert.equal(controller.step(f.root, id).code, 2);
  assert.equal(get(f.state).launches, 1); assert.equal(get(f.windowFile).phase, 'reserved');
});
test('configured provider requires an explicit native binding before reservation', t => {
  const f = fixture(t); f.config.tiers = { P2: 'build' }; f.config.models = { build: { provider: 'codex', model: 'specified-model' } };
  put(f.configFile, f.config);
  assert.equal(controller.step(f.root, id).result.reason, 'native_provider_binding_required');
  assert.equal(fs.existsSync(f.windowFile), false); assert.equal(get(f.state).launches, 0);
});
test('known model and effort reach native launch and survive exact recovery', t => {
  const f = fixture(t, 'lost');
  const route = { provider: 'configured-provider', model: 'my-known-model', reasoning: 'high' };
  f.config.models = { build: route }; f.config.tiers = { P2: 'build' };
  f.config.execution.command.args.push('--provider', route.provider); put(f.configFile, f.config);
  assert.equal(controller.step(f.root, id).result.reason, 'launch_unknown');
  const w = get(f.windowFile), args = get(f.state).lastLaunchArgs;
  assert.equal(args[args.indexOf('--model') + 1], route.model);
  assert.equal(args[args.indexOf('--effort') + 1], route.reasoning);
  assert.equal(controller.step(f.root, id).result.action, 'awaiting_worker');
  assert.equal(get(f.state).launches, 1);
  const recovered = native.handle({ version: 1, operation: 'query', request: w.request }, f.opts);
  assert.deepEqual(recovered.effective_route, route);
});
test('task and unit choices override the stage, remain snapshotted, and change next session', t => {
  const f = fixture(t);
  f.config.models = Object.fromEntries(['stage', 'task', 'unit'].map(model => [model, { provider: 'known', model }]));
  f.config.tiers = { P2: 'stage' }; f.config.launch = { tasks: { [id]: { tier: 'task' } } };
  f.config.execution.command.args.push('--provider', 'known'); put(f.configFile, f.config);
  assert.equal(controller.step(f.root, id).result.action, 'running');
  const first = get(f.windowFile); assert.equal(first.request.route.model, 'task'); takeover(f);
  const unit = get(path.join(f.processDir, 'unit2.json')); unit.launch = { tier: 'unit' };
  put(path.join(f.processDir, 'unit2.json'), unit); put(path.join(f.processDir, 'first.md'), 'First bounded task completed.');
  callback(f, 'yield', first.request, 'first.md', ['--next-unit', 'unit2.json']);
  assert.equal(controller.step(f.root, id).result.action, 'running');
  assert.equal(get(f.windowFile).request.route.model, 'unit');
  assert.equal(first.request.route.model, 'task'); assert.equal(get(f.state).launches, 2);
});
test('explicit DSH team policy cannot silently pass through the native Codex bridge', t => {
  for (const enabled of [false, true]) {
    const f = fixture(t); f.config.launch = { default: { team: { enabled } } }; put(f.configFile, f.config);
    assert.equal(controller.step(f.root, id).result.reason, 'native_team_unsupported');
    assert.equal(fs.existsSync(f.windowFile), false); assert.equal(get(f.state).launches, 0);
  }
});
test('workspace mismatch is a known refusal, not a successful launch or automatic retry', t => {
  const f = fixture(t), platform = get(f.state); platform.cwd = f.temp; put(f.state, platform);
  const response = controller.step(f.root, id);
  assert.equal(response.code, 2); assert.equal(response.result.action, 'start_failed');
  assert.equal(get(f.state).launches, 0); assert.equal(fs.existsSync(f.windowFile), false);
  assert.equal(get(f.stageFile).attempts, 1);
});
test('launch budget leaves the next ready unit for a later controller invocation', t => {
  const f = fixture(t); controller.step(f.root, id); const original = get(f.windowFile); takeover(f);
  put(path.join(f.processDir, 'first.md'), 'First task evidence before automatic handoff.');
  callback(f, 'yield', original.request, 'first.md', ['--next-unit', 'unit2.json']);
  assert.equal(controller.step(f.root, id, false).result.action, 'launch_limit');
  assert.equal(get(f.state).launches, 1); assert.equal(get(f.stageFile).next_unit.spec.id, 'native-2');
  assert.equal(controller.step(f.root, id).result.session_id, 'codex_native_2');
});
test('finite controller loop stops at a cycle limit and keeps live task ownership', async t => {
  const f = fixture(t), events = [];
  assert.equal(await controller.run({ project: f.root, id, watch: true, interval: 1, cycles: 2, launches: 1 }, v => events.push(v)), 0);
  assert.equal(events.at(-1).action, 'cycle_limit'); assert.equal(get(f.state).launches, 1);
  assert.equal(fs.existsSync(f.windowFile), true);
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot', id, 'controller.lock')), false);
});
test('helper locks preserve live or unidentifiable owners and reclaim only an OS-confirmed dead local helper', t => {
  const f = fixture(t), lock = path.join(f.temp, 'lock');
  const release = acquire(lock); assert.throws(() => acquire(lock), /进程仍存在/); release();
  fs.mkdirSync(lock); put(path.join(lock, 'owner.json'), {});
  assert.throws(() => acquire(lock), /身份不明/); fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
  const ended = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  fs.mkdirSync(lock); put(path.join(lock, 'owner.json'), { pid: Number(ended.stdout.trim()), hostname: os.hostname(), token: 'old' });
  acquire(lock)(); assert.equal(fs.existsSync(lock), false);
});
test('controller rejects missing strict units and parses finite limits', t => {
  const f = fixture(t); f.config.execution.require_units = false; put(f.configFile, f.config);
  assert.throws(() => controller.step(f.root, id), /require_units=true/);
  assert.throws(() => controller.options(['--project', f.root, '--id', id, '--max-cycles', '0']), /范围/);
  assert.equal(controller.options(['--project', f.root, '--id', id, '--watch']).watch, true);
});

test('controller waits through a real callback lock within its finite cycle budget', async t => {
  const f = fixture(t), lock = path.join(f.root, '_plan/autopilot/.lock');
  fs.mkdirSync(lock);
  const events = [], result = await controller.run({ project: f.root, id, watch: true, interval: 250, cycles: 2, launches: 1 }, value => {
    events.push(value);
    if (value.action === 'awaiting_snapshot') fs.rmdirSync(lock);
  });
  assert.equal(result, 0); assert.equal(events[0].reason, 'AXNS_COORDINATION_BUSY');
  assert.equal(get(f.state).launches, 1); assert.equal(events.at(-1).action, 'cycle_limit');
  assert.equal(get(f.windowFile).session_id, 'codex_native_1');
});

test('executor bindings are independent, explicit, and cannot silently replace one another', () => {
  const opts = native.options(['--binding', 'codex=own-openai', '--binding', 'claude=own-anthropic']);
  for (const executor of ['codex', 'claude']) {
    const provider = opts.bindings[executor];
    assert.equal(native.unsupported({ route: { executor, provider } }, opts), null);
    assert.equal(native.unsupported({ route: { executor, provider: 'other' } }, opts), 'native_provider_binding_required');
  }
  assert.equal(native.unsupported({ route: { executor: 'claude', provider: 'own-openai' } }, opts), 'native_provider_binding_required');
  assert.equal(native.unsupported({ route: { executor: 'dsh', provider: 'deepseek-official' } }, opts), 'dsh_entry_required');
  for (const args of [['--binding', 'dsh=own'], ['--binding', 'claude='], ['--binding', 'claude=a', '--binding', 'claude=b'],
    ['--provider', 'a', '--binding', 'codex=b'], ['--binding', 'codex=a', '--provider', 'b']]) assert.throws(() => native.options(args));
  assert.equal(native.options(['--provider', 'legacy']).bindings.codex, 'legacy');
});

test('a fresh unit can switch Codex to Claude and retain the original task and stage', t => {
  const f = fixture(t);
  f.config.models = {
    build: { executor: 'codex', provider: 'own-openai', model: 'known-build', reasoning: 'high' },
    review: { executor: 'claude', provider: 'own-anthropic', model: 'known-review', reasoning: 'medium' },
  };
  f.config.tiers = { P2: 'build' };
  f.config.execution.command.args.push('--binding', 'codex=own-openai', '--binding', 'claude=own-anthropic');
  put(f.configFile, f.config);
  assert.equal(controller.step(f.root, id).result.action, 'running');
  const first = get(f.windowFile); takeover(f);
  const next = get(path.join(f.processDir, 'unit2.json')); next.launch = { tier: 'review' };
  put(path.join(f.processDir, 'unit2.json'), next); put(path.join(f.processDir, 'first.md'), 'Build unit complete.');
  callback(f, 'yield', first.request, 'first.md', ['--next-unit', 'unit2.json']);
  assert.equal(controller.step(f.root, id).result.action, 'running');
  const second = get(f.windowFile), platform = get(f.state), args = platform.lastLaunchArgs;
  assert.equal(args[args.indexOf('--agent') + 1], 'claude');
  assert.equal(args[args.indexOf('--model') + 1], 'known-review');
  assert.equal(args[args.indexOf('--effort') + 1], 'medium');
  assert.equal(second.request.route.executor, 'claude');
  assert.equal(second.request.task_id, first.request.task_id); assert.equal(second.stage, first.stage);
  assert.notEqual(second.session_id, first.session_id);
  assert.equal(controller.step(f.root, id).result.action, 'awaiting_worker');
  assert.equal(get(f.state).launches, 2);
});

test('lost Claude launch recovers only its recorded executor and never starts again', t => {
  const f = fixture(t, 'lost');
  const route = { executor: 'claude', provider: 'own-anthropic', model: 'known-review', reasoning: 'high' };
  f.config.models = { review: route }; f.config.tiers = { P2: 'review' };
  f.config.execution.command.args.push('--binding', 'claude=own-anthropic'); put(f.configFile, f.config);
  assert.equal(controller.step(f.root, id).result.reason, 'launch_unknown');
  const w = get(f.windowFile);
  assert.equal(controller.step(f.root, id).result.action, 'awaiting_worker');
  assert.equal(get(f.state).launches, 1);
  let result = native.handle({ version: 1, operation: 'query', request: w.request }, f.opts);
  assert.deepEqual(result.effective_route, route);
  const journal = path.join(f.root, '_plan/autopilot', id, 'orca', w.dispatch_id + '.json');
  const receipt = get(journal); assert.equal(receipt.launch_executor, 'claude');
  put(journal, { ...receipt, launch_executor: 'codex' });
  result = native.handle({ version: 1, operation: 'query', request: w.request }, f.opts);
  assert.equal(result.state, 'unknown'); assert.match(result.reason, /执行端/);
  put(journal, receipt);
  const platform = get(f.state); platform.sessions[0].agentType = 'codex'; put(f.state, platform);
  result = native.handle({ version: 1, operation: 'query', request: w.request }, f.opts);
  assert.equal(result.state, 'unknown'); assert.match(result.reason, /执行端/);
  assert.equal(get(f.state).launches, 1);
});

test('DSH requires an explicit entry and invalid executors cannot reserve a worker', t => {
  const f = fixture(t);
  f.config.models = { build: { executor: 'dsh', provider: 'deepseek-official', model: 'known' } };
  f.config.tiers = { P2: 'build' }; put(f.configFile, f.config);
  assert.equal(controller.step(f.root, id).result.reason, 'dsh_entry_required');
  assert.equal(fs.existsSync(f.windowFile), false); assert.equal(get(f.state).launches, 0);
  f.config.models.build.executor = 'typo'; put(f.configFile, f.config);
  assert.throws(() => controller.step(f.root, id), /executor/);
  assert.equal(get(f.state).launches, 0);
});

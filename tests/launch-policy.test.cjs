'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../skills/axns-devflow-ext-autopilot/scripts/lib/launch-policy.cjs');
const dsh = require('../skills/axns-devflow-ext-autopilot/scripts/dsh-session.cjs');
const core = require('../skills/axns-devflow-ext-autopilot/scripts/lib/core.cjs');
const id = '20261120-launch-policy';
function cfg() {
  const models = Object.fromEntries(['default', 'stage', 'task', 'unit'].map(model => [model, { provider: 'own', model }]));
  return { models, tiers: { P2: 'stage' }, caps: { switch_model: { enabled: true } },
    launch: policy.config({ default: { tier: 'default', team: { enabled: false } },
      tasks: { [id]: { tier: 'task', team: { enabled: true, max_members: 3 } } } }, models, core.id) };
}
function rows() {
  return ['headless-startup', 'headless-runner', 'agent-default-model', 'subagent',
    'subagent-spawn-in-process', 'subagent-fork-in-process', 'tool-subagent', 'tool-subagent-fork',
    'tool-subagent-control', 'tool-workflow'].map(id => ({ id }));
}
function composed(rows, patches) {
  rows = structuredClone(rows);
  for (const patch of patches) {
    if (patch.insert) rows.push(...structuredClone(patch.insert));
    else Object.assign(rows.find(row => row.id === patch.id), patch);
  }
  return rows;
}
test('selection precedence and disabled model switching preserve independent team controls', () => {
  const config = cfg();
  assert.equal(policy.resolve(config, id, 'P2', { launch: { tier: 'unit' } }).route_source, 'unit');
  assert.equal(policy.resolve(config, id, 'P2').model.model, 'task');
  assert.equal(policy.resolve(config, '20261120-other', 'P2').model.model, 'stage');
  assert.equal(policy.resolve(config, '20261120-other', 'P1').model.model, 'default');
  assert.deepEqual(policy.resolve(config, id, 'P2', { launch: { team: { enabled: false } } }).team, { enabled: false });
  config.caps.switch_model.enabled = false;
  assert.equal(policy.resolve(config, id, 'P2').model, null);
  assert.equal(policy.resolve(config, id, 'P2').team.max_members, 3);
});
test('invalid overrides cannot silently inherit or enable uncontrolled delegation', () => {
  for (const launch of [{ tier: 'missing' }, { team: { enabled: 'false' } }, { team: { enabled: false, max_members: 2 } },
    { team: { enabled: true, max_members: 0 } }, { team: { enabled: true, max_members: 33 } }, { team: { enabled: true, typo: 1 } }])
    assert.throws(() => policy.selection(launch, cfg().models));
  assert.throws(() => policy.config({ tasks: { 'bad-id': {} } }, {}, core.id));
  assert.throws(() => policy.config({ typo: {} }, {}, core.id));
  assert.throws(() => policy.resolve(cfg(), id, 'P2', { launch: { tier: 'missing' } }));
});
test('DSH disabled team blocks all built-in delegation surfaces even with an existing team', () => {
  const source = rows().concat([{ id: 'agent-team' }, { id: 'tool-agent-team' }, { id: 'ui-agent-team' }]);
  const actual = composed(source, dsh.overlay(source, null, { enabled: false }));
  dsh.verify(actual, null, { enabled: false });
  for (const row of actual.filter(row => /tool-subagent|tool-workflow|agent-team/.test(row.id))) assert.equal(row.disabled, true);
});
test('DSH team enables the native team services with bounded members and a known opaque model', () => {
  const route = { provider: 'my-provider', model: 'my-deployment-2026', reasoning: 'custom-effort' }, team = { enabled: true, max_members: 3 };
  const source = rows(), actual = composed(source, dsh.overlay(source, route, team));
  dsh.verify(actual, route, team);
  assert.equal(actual.find(row => row.id === 'agent-default-model').config.reasoningEffort, route.reasoning);
  assert.equal(actual.filter(row => row.id === 'agent-team').length, 1);
  const reapplied = composed(actual, dsh.overlay(actual, route, team));
  assert.equal(reapplied.filter(row => row.id === 'agent-team').length, 1);
  dsh.verify(reapplied, route, team);
  actual.find(row => row.id === 'tool-workflow').disabled = false;
  assert.throws(() => dsh.verify(actual, route, team), /委派工具/);
});
test('DSH native subagents enable spawn/control without adding Team caps or disabling fork/workflow', () => {
  const team = { enabled: true, mode: 'subagent' }, source = rows().concat([{ id: 'agent-team' }, { id: 'tool-agent-team' }]);
  policy.selection({ team }, {});
  const patches = dsh.overlay(source, null, team), actual = composed(source, patches);
  dsh.verify(actual, null, team);
  assert.equal(actual.find(row => row.id === 'tool-subagent').disabled, false);
  assert.equal(actual.find(row => row.id === 'tool-subagent-control').disabled, false);
  assert.equal(actual.find(row => row.id === 'tool-subagent').config.provider, 'spawn');
  assert.equal(actual.find(row => row.id === 'agent-team').disabled, true);
  for (const id of ['tool-subagent-fork', 'subagent-fork-in-process', 'tool-workflow'])
    assert.deepEqual(actual.find(row => row.id === id), source.find(row => row.id === id));
  assert.equal(patches.some(row => row.config?.maxMessageBytes !== undefined), false);
  const missing = rows().filter(row => !['tool-subagent', 'tool-subagent-control'].includes(row.id));
  dsh.verify(composed(missing, dsh.overlay(missing, null, team)), null, team);
  actual.find(row => row.id === 'tool-subagent').config.provider = 'fork';
  assert.throws(() => dsh.verify(actual, null, team), /spawn/);
});
test('native mode rejects false capability claims and conflicting or missing composed services', () => {
  for (const team of [{ enabled: true, mode: 'other' }, { enabled: false, mode: 'subagent' }, { enabled: true, mode: 'subagent', max_members: 3 }])
    assert.throws(() => policy.selection({ team }, {}), /mode|max_members/);
  const team = { enabled: true, mode: 'subagent' };
  assert.throws(() => dsh.overlay(rows().filter(row => row.id !== 'subagent-spawn-in-process'), null, team), /服务/);
  const actual = composed(rows(), dsh.overlay(rows(), null, team));
  actual.push({ id: 'tool-agent-team' }); assert.throws(() => dsh.verify(actual, null, team), /冲突/);
  actual.pop(); actual.find(row => row.id === 'tool-subagent-control').disabled = true;
  assert.throws(() => dsh.verify(actual, null, team), /未启用/);
});
test('DSH refuses incomplete profiles and mismatched composed model/team settings', () => {
  assert.throws(() => dsh.overlay([], null, null), /headless/);
  const adopted = rows(); adopted.find(row => row.id === 'headless-runner').config = { sessionId: 'old-session' };
  assert.throws(() => dsh.overlay(adopted, null, null), /sessionId/);
  assert.throws(() => dsh.verify(adopted, null, null), /sessionId/);
  const symbolic = rows(); symbolic.find(row => row.id === 'headless-runner').config = { sessionId: 'ctx.headlessStartup.sessionId' };
  assert.doesNotThrow(() => dsh.overlay(symbolic, null, null)); assert.doesNotThrow(() => dsh.verify(symbolic, null, null));
  symbolic.find(row => row.id === 'headless-startup').config = { sessionId: 'old-session' };
  assert.throws(() => dsh.overlay(symbolic, null, null), /sessionId/);
  const source = rows(); source.find(row => row.id === 'subagent').disabled = true;
  assert.throws(() => dsh.overlay(source, null, { enabled: true }), /subagent/);
  const route = { provider: 'own', model: 'known', reasoning: 'high' }, team = { enabled: true, max_members: 2 };
  const actual = composed(rows(), dsh.overlay(rows(), route, team));
  assert.throws(() => dsh.verify(actual, { ...route, reasoning: 'low' }, team), /模型/);
  actual.find(row => row.id === 'agent-team').config.maxMembers = 8;
  assert.throws(() => dsh.verify(actual, route, team), /人数/);
});


test('fresh DSH launcher verifies an overlay, logs large output, and reports a real session event', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-test-'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const put = (relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  put('AGENTS.md', 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
  put('_plan/prompts/autopilot.json', { version: 1, models: { known: { executor: 'dsh', provider: 'configured', model: 'known', reasoning: 'high' } },
    launch: { default: { tier: 'known', team: { enabled: false } } } });
  put('_plan/process/' + id + '/prompt.md', 'One bounded task.\n');
  put('node_modules/yaml/index.js', 'exports.parse=JSON.parse;');
  put('dsh.cjs', `const fs=require('fs'),args=process.argv.slice(2),base=${JSON.stringify(rows())};
if(args.includes('--dump-config')) {
 if(args.includes('--patch')) for(const p of JSON.parse(fs.readFileSync(args[args.indexOf('--patch')+1]))) {
  if(p.insert)base.push(...p.insert);else Object.assign(base.find(r=>r.id===p.id),p);
 }
 console.log(JSON.stringify(base));
} else {
 if(args.includes('--session-id'))throw Error('Must create a fresh session');
 fs.writeFileSync(require('path').join(__dirname,'received.txt'),fs.readFileSync(0));
 console.log(JSON.stringify({type:'session',sessionId:'dsh_real_event_id'}));
 console.log(JSON.stringify({type:'text',text:'x'.repeat(200000)}));
 console.log(JSON.stringify({type:'final',sessionId:'dsh_real_event_id',reason:'completed'}));
}`);
  const script = path.resolve(__dirname, '../skills/axns-devflow-ext-autopilot/scripts/dsh-session.cjs');
  const r = spawnSync(process.execPath, [script, '--project', root, '--id', id, '--stage', 'P2', '--dsh-bin', path.join(root, 'dsh.cjs'),
    '--prompt-file', 'prompt.md', '--run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); assert.ok(Buffer.byteLength(r.stdout) < 8192);
  const [manifest, receipt] = r.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(manifest.verification, 'composed_config_only'); assert.equal(manifest.fresh_session, true);
  assert.equal(manifest.executor, 'dsh'); assert.equal(manifest.route.executor, 'dsh');
  assert.equal(receipt.session_id, 'dsh_real_event_id'); assert.equal(receipt.business_completion, 'unverified');
  assert.ok(fs.statSync(receipt.events_file).size > 200000);
  assert.equal(fs.readFileSync(path.join(root, 'received.txt'), 'utf8'), 'One bounded task.\n');
  assert.equal(fs.existsSync(path.join(root, '_plan/autopilot', id, 'dsh-session.lock')), false);
  const configPath = path.join(root, '_plan/prompts/autopilot.json'), config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.models.known.executor = 'claude'; fs.writeFileSync(configPath, JSON.stringify(config));
  const refused = spawnSync(process.execPath, [script, '--project', root, '--id', id, '--stage', 'P2', '--dsh-bin', path.join(root, 'dsh.cjs'),
    '--prompt-file', 'prompt.md', '--run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(refused.status, 1); assert.match(refused.stderr, /executor=claude/);
  assert.equal(fs.readdirSync(path.join(root, '_plan/autopilot', id, 'dsh')).length, 1);
});

test('command bridges must acknowledge the requested team configuration before reporting running', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const command = require('../skills/axns-devflow-ext-autopilot/scripts/adapters/command.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'team-bridge-test-'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const script = path.join(root, 'bridge.cjs');
  fs.writeFileSync(script, `const fs=require('fs'),p=JSON.parse(fs.readFileSync(0,'utf8'));const team=JSON.parse(process.argv[2]);console.log(JSON.stringify({version:1,dispatch_id:p.request.dispatch_id,state:'running',session_id:'native-session',...(team===null?{}:{effective_team:team})}));`);
  const team = { enabled: true, mode: 'subagent' }, request = { cwd: root, dispatch_id: 'dispatch', team };
  for (const actual of [null, { enabled: false }, { enabled: true }, { enabled: true, mode: 'team' }]) {
    const value = command.invoke({ command: { file: process.execPath, args: [script, JSON.stringify(actual)] }, timeout_seconds: 2 }, 'start', request);
    assert.equal(value.state, 'unknown'); assert.match(value.reason, /团队/);
  }
  const result = command.invoke({ command: { file: process.execPath, args: [script, JSON.stringify(team)] }, timeout_seconds: 2 }, 'start', request);
  assert.equal(result.state, 'running'); assert.deepEqual(result.effective_team, team);
});

test('DSH accepts explicit DSH routes and refuses other executors before composing an overlay', () => {
  const route = { executor: 'dsh', provider: 'deepseek-official', model: 'known', reasoning: 'high' };
  const actual = composed(rows(), dsh.overlay(rows(), route, { enabled: false }));
  dsh.verify(actual, route, { enabled: false });
  for (const executor of ['codex', 'claude']) {
    assert.throws(() => dsh.overlay(rows(), { ...route, executor }, null), /executor=/);
    assert.throws(() => dsh.verify(actual, { ...route, executor }, null), /executor=/);
  }
});

test('command bridge acknowledgement must match an explicit executor even with identical provider and model', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const command = require('../skills/axns-devflow-ext-autopilot/scripts/adapters/command.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-bridge-test-'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const script = path.join(root, 'bridge.cjs');
  fs.writeFileSync(script, `const p=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify({version:1,dispatch_id:p.request.dispatch_id,state:'running',session_id:'native-session',effective_route:JSON.parse(process.argv[2])}));`);
  const route = { executor: 'claude', provider: 'own', model: 'known', reasoning: 'high' };
  const request = { cwd: root, dispatch_id: 'dispatch', route };
  for (const executor of [undefined, 'codex', 'claude']) {
    const result = command.invoke({ command: { file: process.execPath, args: [script, JSON.stringify({ ...route, executor })] },
      timeout_seconds: 2 }, 'start', request);
    assert.equal(result.state, executor === 'claude' ? 'running' : 'unknown');
  }
});
test('DSH worktree toggles the native create tool independently of delegation and verifies composed state',()=>{
  for(const enabled of [false,true]){
    const team={enabled, ...(enabled?{mode:'subagent'}:{}),worktree:true};
    const actual=composed(rows(),dsh.overlay(rows(),null,team));dsh.verify(actual,null,team);
    assert.equal(actual.find(row=>row.id==='tool-worktree').disabled,undefined);
    const off={...team,worktree:false},disabled=composed(actual,dsh.overlay(actual,null,off));dsh.verify(disabled,null,off);
    assert.equal(disabled.find(row=>row.id==='tool-worktree').disabled,true);
    assert.notEqual(disabled.find(row=>row.id==='worktree').disabled,true);
    disabled.find(row=>row.id==='tool-worktree').disabled=false;assert.throws(()=>dsh.verify(disabled,null,off),/worktree/);
  }
  assert.throws(()=>policy.selection({team:{enabled:false,worktree:'true'}},{}),/worktree/);
  assert.equal(policy.teamMatches({enabled:false,worktree:false},{enabled:false,worktree:true}),false);
});
test('DSH current native Team uses its real switch and keeps subagent tools available without removed config keys',()=>{
  const source=rows().concat([{id:'agent-team',name:'@deepseek-ai/dsh-agent-team',config:{maxTasks:256}},
    {id:'tool-agent-team',name:'@deepseek-ai/dsh-tool-agent-team'}]);
  const team={enabled:true,mode:'team',worktree:true},actual=composed(source,dsh.overlay(source,null,team));
  dsh.verify(actual,null,team);assert.equal(actual.find(row=>row.id==='agent-team').config.defaultEnabled,true);
  assert.equal(Object.hasOwn(actual.find(row=>row.id==='agent-team').config,'maxMembers'),false);
  assert.notEqual(actual.find(row=>row.id==='tool-subagent').disabled,true);
  assert.throws(()=>dsh.overlay(source,null,{...team,max_members:3}),/不支持 max_members/);
  actual.find(row=>row.id==='agent-team').config.defaultEnabled=false;assert.throws(()=>dsh.verify(actual,null,team),/默认开关/);
});

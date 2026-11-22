'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const scripts = path.resolve(__dirname, '../skills/axns-devflow-ext-autopilot/scripts');
const controller = require(path.join(scripts, 'orca-controller.cjs'));
const native = require(path.join(scripts, 'adapters/orca-bridge.cjs'));
const bridge = require(path.join(scripts, 'lib/dsh-bridge.cjs'));
const get = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const id = '20261120-dsh-chain';
function fixture(t, mode = 'normal', team = { enabled: false }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-chain-quote' space-")), root = path.join(temp, 'project');
  const state = path.join(temp, 'platform.json'), mock = path.join(temp, 'orca.cjs'), fake = path.join(temp, 'dsh.cjs');
  put(state, { cwd: root, launches: 0, mode });
  put(path.join(temp, 'node_modules/yaml/index.js'), 'exports.parse=JSON.parse;');
  put(mock, `const fs=require('fs'),cp=require('child_process'),args=process.argv.slice(3),file=process.argv[2],s=JSON.parse(fs.readFileSync(file,'utf8'));
const out=x=>console.log(JSON.stringify({ok:true,result:x}));
if(args[0]==='worktree')out({worktree:{path:s.cwd,hostId:'local'}});
else if(args[0]==='terminal'&&args[1]==='create'){
 s.launches++;s.command=args[args.indexOf('--command')+1];fs.writeFileSync(file,JSON.stringify(s));
 if(s.mode==='lost'){console.log(JSON.stringify({ok:false,error:{message:'reply lost'}}));process.exitCode=1;}
 else out({terminal:{handle:'managed-'+s.launches}});
}else process.exitCode=2;`);
  put(fake, `const fs=require('fs'),path=require('path'),cp=require('child_process');const args=process.argv.slice(2),state=${JSON.stringify(state)};
if(args.includes('--dump-config')){
 let rows=[{id:'headless-startup'},{id:'headless-runner'},{id:'agent-default-model',config:{}},
 {id:'subagent'},{id:'subagent-spawn-in-process'}];
 if(args.includes('--patch'))for(const patch of JSON.parse(fs.readFileSync(args[args.indexOf('--patch')+1],'utf8'))){
 if(patch.insert)rows.push(...patch.insert);else{const r=rows.find(r=>r.id===patch.id);if(r){Object.assign(r,{...patch,config:{...r.config,...patch.config}});}}}
 console.log(JSON.stringify(rows));process.exit(0);
}
(async()=>{let prompt='';for await(const c of process.stdin)prompt+=c;
 const dir=path.dirname(args[args.indexOf('--patch')+1]),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')),
 r=JSON.parse(fs.readFileSync(m.request_file,'utf8')),s=JSON.parse(fs.readFileSync(state,'utf8')),sid='session-'+r.dispatch_id.slice(0,20);
 console.log(JSON.stringify({type:'session',sessionId:sid,cwd:s.mode==='wrong-cwd'?path.dirname(process.cwd()):process.cwd()}));
 for(let i=0;i<300;i++){if(fs.existsSync(m.process_file)&&JSON.parse(fs.readFileSync(m.process_file,'utf8')).takeover_confirmed)break;await new Promise(r=>setTimeout(r,20));}
 if(s.mode==='wrong-cwd')return;
 const check=JSON.parse(fs.readFileSync(m.process_file,'utf8'));if(!check.takeover_confirmed)throw Error('no takeover');
 if(s.mode==='large')console.log(JSON.stringify({type:'text',text:'z'.repeat(140000)}));
 if(s.mode==='overflow-always'||s.mode==='overflow'&&r.work_unit.spec.id==='unit1'){
 console.log(JSON.stringify({type:'final',sessionId:sid,reason:{kind:'error',error:{code:'context_length_exceeded',message:'context limit exceeded'}}}));process.exitCode=1;return;}
 if(s.mode==='no-final'){process.exitCode=1;return;}
 const first=r.work_unit.spec.id==='unit1',e=first?'first.md':'second.md';fs.writeFileSync(path.join(r.record_dir,e),'Actual fixture output '+sid+'\\n');
 const base=r.callbacks[first?'yield':'complete'];const argv=base.map(a=>a==='<相对record_dir的证据文件名>'?e:a==='<相对record_dir的下一工单文件名>'?'unit2.json':a);
 const result=cp.spawnSync(argv[0],argv.slice(1),{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr||result.stdout);
 if(s.mode==='drain')await new Promise(r=>setTimeout(r,2000));
 console.log(JSON.stringify({type:'final',sessionId:sid,reason:{kind:'completed'}}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});`);
  const config = { version: 1, models: { dsh: { executor: 'dsh', provider: 'own-dsh', model: 'known', reasoning: 'high' } }, tiers: { P2: 'dsh' },
    launch: { default: { team } }, capabilities: { advance: { max_stage: 'P2' } },
    execution: { enabled: true, adapter: 'command', require_units: true, timeout_seconds: 30,
      command: { file: process.execPath, args: [path.join(scripts, 'adapters/orca-bridge.cjs'), '--orca-file', process.execPath,
        '--orca-arg', mock, '--orca-arg', state, '--dsh-bin', fake] } } };
  put(path.join(root, 'AGENTS.md'), 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
  put(path.join(root, '_plan/.active_plan'), id); put(path.join(root, '_plan/prompts/autopilot.json'), config);
  const recordDir = path.join(root, '_plan/process', id), runtimeDir = path.join(root, '_plan/autopilot', id);
  put(path.join(recordDir, 'plan.md'), 'Two bounded units in one P2 stage.');
  for (const n of [1, 2]) put(path.join(recordDir, 'unit' + n + '.json'), { id: 'unit' + n, goal: 'One short goal', inputs: [],
    write_scope: ['_plan/process/' + id], done_when: ['Evidence written'], stop_when: ['After callback'], budget: { max_steps: 6, max_minutes: 3 } });
  const init = spawnSync(process.execPath, [path.join(scripts, 'runner.cjs'), 'init', '--project', root, '--id', id, '--stage', 'P2', '--owner', 'controller/test', '--unit', 'unit1.json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const f = { root, state, config, recordDir, runtimeDir, windowFile: path.join(runtimeDir, 'window.json'), workers: new Map() };
  t.after(async () => { await Promise.all([...f.workers.values()]); assert.equal(path.dirname(fs.realpathSync(temp)), fs.realpathSync(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true }); });
  return f;
}
// Deliver accepted mock terminal commands from the long-lived platform harness. A short-lived
// spawnSync mock CLI cannot own Windows terminal processes after it exits.
function launchPending(f) {
  const dir = path.join(f.runtimeDir, 'orca');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
    const journal = get(path.join(dir, name)); if (!journal.dsh_manifest || f.workers.has(name)) continue;
    const fd = fs.openSync(path.join(path.dirname(journal.dsh_manifest), 'worker.log'), 'w');
    const child = spawn(process.execPath, [path.join(scripts, 'dsh-worker.cjs'), '--manifest', journal.dsh_manifest],
      { stdio: ['ignore', fd, fd], windowsHide: true }); fs.closeSync(fd);
    f.workers.set(name, new Promise(resolve => { child.once('error', resolve); child.once('close', resolve); }));
  }
}
async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error('Timed out waiting for fixture');
}
async function stopped(f, dispatch) {
  return until(() => { const file = path.join(f.runtimeDir, 'orca', dispatch + '.dsh/process.json');
    return fs.existsSync(file) && get(file).state === 'stopped' ? get(file) : null; });
}
async function runChain(f) {
  const events = []; const code = await controller.run({ project: f.root, id, watch: true, interval: 250, cycles: 40, launches: 4 }, event => { events.push(event); launchPending(f); });
  const debug = () => fs.readdirSync(path.join(f.runtimeDir, 'orca')).filter(n => n.endsWith('.dsh')).map(n => {
    const dir = path.join(f.runtimeDir, 'orca', n), read = name => fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8').slice(-1800) : null;
    return { process: read('process.json'), stderr: read('stderr.log'), worker: read('worker.log') };
  });
  assert.equal(code, 0, JSON.stringify({ events, diagnostics: code ? debug() : null })); assert.equal(events.at(-1).reason, 'stage_cap');
  return events;
}
test('DSH starts two fresh sessions and automatically hands off the same P2 task', async t => {
  const f = fixture(t); await runChain(f);
  assert.equal(get(f.state).launches, 2); assert.equal(fs.existsSync(f.windowFile), false);
  const receipts = fs.readdirSync(path.join(f.runtimeDir, 'receipts')).map(n => get(path.join(f.runtimeDir, 'receipts', n)));
  assert.deepEqual(receipts.map(r => r.outcome).sort(), ['complete', 'yield']);
  assert.notEqual(receipts[0].session_id, receipts[1].session_id); assert.equal(get(path.join(f.runtimeDir, 'stage.json')).attempts, 0);
  for (const r of receipts) assert.equal((await stopped(f, r.dispatch_id)).takeover_confirmed, true);
});
test('existing automatic handoff preserves native subagent mode in each new DSH launch', async t => {
  const team = { enabled: true, mode: 'subagent' }, f = fixture(t, 'normal', team); await runChain(f);
  assert.equal(get(f.state).launches, 2);
  const dir = path.join(f.runtimeDir, 'orca');
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.dsh'))) {
    const manifest = get(path.join(dir, name, 'manifest.json')); assert.deepEqual(manifest.team, team);
    const patches = get(manifest.patch_file), rows = patches.flatMap(row => row.insert ?? [row]);
    assert.equal(rows.find(row => row.id === 'tool-subagent').config.provider, 'spawn');
    assert.equal(rows.some(row => row.id === 'agent-team' && !row.disabled), false);
    assert.match(fs.readFileSync(manifest.prompt_file, 'utf8'), /context-decision\.cjs/);
  }
});
test('a lost Orca terminal receipt is recovered by dispatch without another DSH start', async t => {
  const f = fixture(t, 'lost'); controller.step(f.root, id); launchPending(f);
  const journal = fs.readdirSync(path.join(f.runtimeDir, 'orca')).find(n => /^[a-f0-9]{64}\.json$/.test(n));
  const dispatch = journal.slice(0, -5); await stopped(f, dispatch);
  const state = get(f.state); state.mode = 'normal'; put(f.state, state);
  await runChain(f); assert.equal(get(f.state).launches, 2);
});
test('the next DSH unit waits until the previous process has actually exited', async t => {
  const f = fixture(t, 'drain'); controller.step(f.root, id); launchPending(f);
  await until(() => fs.existsSync(path.join(f.recordDir, 'first.md')) && !fs.existsSync(f.windowFile));
  const held = controller.step(f.root, id); assert.equal(held.result.action, 'awaiting_dsh_exit'); assert.equal(get(f.state).launches, 1);
  await runChain(f); assert.equal(get(f.state).launches, 2);
  const stage = get(path.join(f.runtimeDir, 'stage.json')); await stopped(f, stage.last_dispatch_id);
});
test('a quiescent context overflow automatically resumes through a fresh bounded unit', async t => {
  const f = fixture(t, 'overflow'); await runChain(f);
  assert.equal(get(f.state).launches, 2); assert.equal(get(path.join(f.runtimeDir, 'stage.json')).attempts, 0);
  const recovered = fs.readdirSync(path.join(f.runtimeDir, 'dsh-recovery')); assert.equal(recovered.length, 1);
  const recovery = get(path.join(f.runtimeDir, 'dsh-recovery', recovered[0]));
  assert.match(fs.readFileSync(path.join(f.recordDir, recovery.evidence), 'utf8'), /未声称原工单完成/);
});
test('a stopped DSH process without a quiescent final does not release ownership', async t => {
  const f = fixture(t, 'no-final'); controller.step(f.root, id); launchPending(f);
  const w = get(f.windowFile); await stopped(f, w.dispatch_id);
  const value = controller.step(f.root, id); assert.equal(value.result.reason, 'worker_stopped_without_result');
  assert.equal(get(f.windowFile).owner, w.owner); assert.equal(get(f.state).launches, 1);
});
test('large DSH event lines stay on disk and cannot inflate controller replies', async t => {
  const f = fixture(t, 'large'); const events = await runChain(f); assert.ok(JSON.stringify(events).length < 10000);
  const dirs = fs.readdirSync(path.join(f.runtimeDir, 'orca')).filter(n => n.endsWith('.dsh'));
  for (const dir of dirs) assert.ok(fs.statSync(path.join(f.runtimeDir, 'orca', dir, 'events.jsonl')).size > 140000);
});
test('DSH routes use explicit entry options and command quoting preserves spaces and apostrophes', () => {
  assert.equal(native.unsupported({ route: { executor: 'dsh' }, team: { enabled: true } }, { dshBin: __filename }), null);
  assert.equal(native.unsupported({ route: { executor: 'dsh' } }, {}), 'dsh_entry_required');
  assert.throws(() => native.options(['--dsh-profile', '../bad']), /profile/);
  if (process.platform === 'win32') assert.ok(bridge.command("C:/space's path/file.json").includes("'C:/space''s path/file.json'"));
});
test('repeated context overflow stops at the configured recovery limit and keeps ownership', async t => {
  const f = fixture(t, 'overflow-always'); f.config.max_attempts = 1; put(path.join(f.root, '_plan/prompts/autopilot.json'), f.config);
  const code = await controller.run({ project: f.root, id, watch: true, interval: 250, cycles: 40, launches: 4 }, () => launchPending(f));
  assert.equal(code, 2); assert.equal(get(f.state).launches, 2); assert.equal(fs.existsSync(f.windowFile), true);
  assert.equal(controller.step(f.root, id).result.reason, 'dsh_recovery_limit');
  assert.equal(get(path.join(f.runtimeDir, 'stage.json')).attempts, 0);
});
test('changed DSH launch files cannot start a child and the intent cannot be repeated', async t => {
  const f = fixture(t); controller.step(f.root, id); const w = get(f.windowFile);
  const journalFile = path.join(f.runtimeDir, 'orca', w.dispatch_id + '.json'), journal = get(journalFile), manifest = get(journal.dsh_manifest);
  fs.appendFileSync(manifest.patch_file, ' '); launchPending(f); await Promise.all([...f.workers.values()]);
  assert.equal(get(journal.dsh_process).state, 'stopped');
  assert.match(get(journal.dsh_process).startup_error, /启动文件已变化/);
  const response = native.handle({ version: 1, operation: 'start', request: w.request }, native.options(f.config.execution.command.args.slice(1)));
  assert.equal(response.state, 'stopped'); assert.equal(get(f.state).launches, 1);
  assert.match(fs.readFileSync(path.join(path.dirname(journal.dsh_manifest), 'worker.log'), 'utf8'), /启动文件已变化/);
});
test('a DSH session event for another cwd never takes task ownership', async t => {
  const f = fixture(t, 'wrong-cwd'); controller.step(f.root, id); launchPending(f);
  const w = get(f.windowFile), state = await stopped(f, w.dispatch_id);
  assert.equal(state.invalid_identity, true); assert.equal(state.takeover_confirmed, false);
  assert.equal(get(f.windowFile).acknowledged_at, undefined); assert.equal(fs.existsSync(path.join(f.recordDir, 'first.md')), false);
});
test('Windows status publication retries transient rename refusal without losing either file', t => {
  if (process.platform !== 'win32') return;
  const runtime = require(path.join(scripts, 'lib/runtime.cjs'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-atomic-'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(temp)), fs.realpathSync(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true }); });
  const file = path.join(temp, 'process.json'); runtime.atomic(file, { state: 'starting' });
  const rename = fs.renameSync; let attempts = 0;
  fs.renameSync = (...args) => { if (args[1] === file && attempts++ === 0) { const error = Error('sharing refusal'); error.code = 'EPERM'; throw error; } return rename(...args); };
  try { runtime.atomic(file, { state: 'running' }); } finally { fs.renameSync = rename; }
  assert.equal(attempts, 2); assert.equal(get(file).state, 'running'); assert.deepEqual(fs.readdirSync(temp), ['process.json']);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const scripts = path.resolve(__dirname, '../skills/axns-devflow-ext-autopilot/scripts');
const controller = require(path.join(scripts, 'dsh-controller.cjs'));
const native = require(path.join(scripts, 'adapters/dsh-bridge.cjs'));
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
 s.launches++;fs.writeFileSync(state,JSON.stringify(s));
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
      command: { file: process.execPath, args: [path.join(scripts, 'adapters/dsh-bridge.cjs'), '--dsh-bin', fake] } } };
  put(path.join(root, 'AGENTS.md'), 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
  put(path.join(root, '_plan/.active_plan'), id); put(path.join(root, '_plan/prompts/autopilot.json'), config);
  const recordDir = path.join(root, '_plan/process', id), runtimeDir = path.join(root, '_plan/autopilot', id);
  put(path.join(recordDir, 'plan.md'), 'Two bounded units in one P2 stage.');
  for (const n of [1, 2]) put(path.join(recordDir, 'unit' + n + '.json'), { id: 'unit' + n, goal: 'One short goal', inputs: [],
    write_scope: ['_plan/process/' + id], done_when: ['Evidence written'], stop_when: ['After callback'], budget: { max_steps: 6, max_minutes: 3 } });
  const init = spawnSync(process.execPath, [path.join(scripts, 'runner.cjs'), 'init', '--project', root, '--id', id, '--stage', 'P2', '--owner', 'controller/test', '--unit', 'unit1.json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const f = { root, state, config, recordDir, runtimeDir, windowFile: path.join(runtimeDir, 'window.json'), workers: new Map() };
  t.after(async () => {
    const dir = path.join(f.runtimeDir, 'dsh');
    if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.dsh'))) {
      const file = path.join(dir, name, 'process.json');
      if (!fs.existsSync(file)) continue;
      try { await until(() => get(file).state === 'stopped', 45000);
        await until(() => { try { process.kill(get(file).pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }, 8000); }
      catch { for (const pid of [get(file).child_pid, get(file).pid]) { if (Number.isInteger(pid) && pid !== process.pid) try { process.kill(pid); } catch {} } }
    }
    await Promise.all([...f.workers.values()]); assert.equal(path.dirname(fs.realpathSync(temp)), fs.realpathSync(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  return f;
}
// Deliver accepted mock terminal commands from the long-lived platform harness. A short-lived
// spawnSync mock CLI cannot own Windows terminal processes after it exits.
function launchPending() {}
async function until(check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error('Timed out waiting for fixture');
}
async function stopped(f, dispatch) {
  return until(() => { const file = path.join(f.runtimeDir, 'dsh', dispatch + '.dsh/process.json');
    return fs.existsSync(file) && get(file).state === 'stopped' ? get(file) : null; });
}
async function runChain(f) {
  const events = []; const code = await controller.run({ project: f.root, id, watch: true, interval: 250, cycles: 160, launches: 4 }, event => { events.push(event); launchPending(f); });
  const debug = () => fs.readdirSync(path.join(f.runtimeDir, 'dsh')).filter(n => n.endsWith('.dsh')).map(n => {
    const dir = path.join(f.runtimeDir, 'dsh', n), read = name => fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8').slice(-1800) : null;
    return { process: read('process.json'), stderr: read('stderr.log'), worker: read('worker.log') };
  });
  assert.equal(code, 0, JSON.stringify({ events, diagnostics: code ? debug() : null })); assert.equal(events.at(-1).reason, 'stage_cap');
  return events;
}

test('direct DSH starts two isolated root processes and hands off without any Orca calls', async t => {
  const f = fixture(t); const events = await runChain(f);
  assert.equal(get(f.state).launches, 2);
  assert.equal(fs.existsSync(path.join(f.runtimeDir, 'orca')), false);
  const receipts = fs.readdirSync(path.join(f.runtimeDir, 'receipts')).map(n => get(path.join(f.runtimeDir, 'receipts', n)));
  assert.deepEqual(receipts.map(r => r.outcome).sort(), ['complete', 'yield']);
  assert.notEqual(receipts[0].session_id, receipts[1].session_id);
  assert.equal(fs.existsSync(f.windowFile), false);
  assert.ok(events.some(e => e.action === 'awaiting_dsh_start'));
  for (const receipt of receipts) assert.equal((await stopped(f, receipt.dispatch_id)).final_quiescent, true);
});
test('direct DSH repeats query without restarting an accepted dispatch', async t => {
  const f = fixture(t, 'drain'); controller.step(f.root, id);
  const w = get(f.windowFile); await until(() => get(f.state).launches === 1);
  const payload = { version: 1, operation: 'start', request: w.request }, opts = native.options(f.config.execution.command.args.slice(1));
  for (let i = 0; i < 3; i++) native.handle(payload, opts);
  await stopped(f, w.dispatch_id); assert.equal(get(f.state).launches, 1);

});
test('direct DSH context overflow recovers to a new root and retains the task stage', async t => {
  const f = fixture(t, 'overflow'); await runChain(f);
  assert.equal(get(f.state).launches, 2);
  assert.equal(get(path.join(f.runtimeDir, 'stage.json')).attempts, 0);
  assert.equal(fs.readdirSync(path.join(f.runtimeDir, 'dsh-recovery')).length, 1);
});
test('direct DSH cannot release ownership after a process exits without a quiescent final', async t => {
  const f = fixture(t, 'no-final'); controller.step(f.root, id);
  const w = get(f.windowFile); await stopped(f, w.dispatch_id);
  assert.equal(controller.step(f.root, id).result.reason, 'worker_stopped_without_result');
  const orca = require(path.join(scripts, 'adapters/orca-bridge.cjs'));
  const opts = native.options(f.config.execution.command.args.slice(1));
  let refusal;
  try { refusal = orca.handle({ version: 1, operation: 'start', request: w.request }, { dshBin: opts.dshBin }); }
  catch (error) { refusal = { state: 'unknown', reason: error.message }; }
  assert.equal(refusal.state, 'unknown');
  assert.match(refusal.reason, /禁止跨平台|控制锁|本地控制进程/);
  assert.equal(fs.existsSync(path.join(f.runtimeDir, 'orca', w.dispatch_id + '.json')), false);
  assert.equal(get(f.windowFile).dispatch_id, w.dispatch_id);
  assert.equal(get(f.state).launches, 1);
});
test('direct DSH refuses a non-DSH root route and validates explicit entry arguments', () => {
  assert.equal(native.unsupported({ route: { executor: 'codex' } }, { dshBin: __filename }), 'direct_dsh_requires_dsh_root_route');
  assert.throws(() => native.options(['--dsh-bin', __filename, '--dsh-profile', '../bad']), /profile/);
});

test('the pure DSH controller refuses a project still configured to invoke Orca', t => {
  const f = fixture(t); f.config.execution.command.args[0] = path.join(scripts, 'adapters/orca-bridge.cjs');
  put(path.join(f.root, '_plan/prompts/autopilot.json'), f.config);
  assert.throws(() => controller.assertDirect(f.root), /避免误用 Orca/);
  assert.equal(get(f.state).launches, 0);
});

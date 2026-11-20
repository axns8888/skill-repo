'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const folder=__dirname;
const fixture=JSON.parse(fs.readFileSync(path.join(folder,'orca-live-fixture-03.json'),'utf8'));
const root=fixture.root,id=fixture.id,base=path.join(root,'_plan/autopilot',id),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const stage=read(path.join(base,'stage.json'));
const receipts=fs.readdirSync(path.join(base,'receipts')).map(n=>read(path.join(base,'receipts',n))).sort((a,b)=>a.at.localeCompare(b.at));
const windows=fs.readdirSync(path.join(base,'orca')).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>read(path.join(base,'orca',n))).sort((a,b)=>a.created_at.localeCompare(b.created_at));
assert.equal(stage.state,'completed');assert.equal(stage.stage,'P2');assert.equal(stage.attempts,0);assert.equal(fs.existsSync(path.join(base,'window.json')),false);
assert.equal(windows.length,2);assert.equal(receipts.length,2);assert.deepEqual(receipts.map(r=>r.outcome),['yield','complete']);
assert.equal(new Set(windows.map(w=>w.session_id)).size,2);assert.equal(new Set(receipts.map(r=>r.owner)).size,2);
const requests=windows.map(w=>read(w.request_file));
for(let i=0;i<2;i++){assert.equal(requests[i].task_id,id);assert.equal(requests[i].cwd,root);assert.equal(requests[i].stage,'P2');assert.equal(windows[i].prompt_outcome,'journaled');assert.equal(windows[i].session_id,receipts[i].session_id);assert.equal(windows[i].dispatch_id,receipts[i].dispatch_id);}
assert.equal(requests[1].previous_dispatch_id,requests[0].dispatch_id);
const outputs=['first','second'].map(name=>{const file=path.join(root,'out',name+'.txt'),bytes=fs.readFileSync(file);assert.equal(bytes.toString('utf8'),name+' short unit\n');return{file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
const core=require(path.join(fixture.scripts,'lib/core.cjs'));
assert.equal(stage.completed_worktree,core.projectState(root,root,false));
const assessed=core.evaluate(core.context(root));assert.equal(assessed.result.decisions[0].reason,'stage_cap');
const proof={verified_at:new Date().toISOString(),scope:'isolated_real_orca_two_unit_chain',project:root,task_id:id,stage:'P2',state:stage.state,
  automatic_continuation:true,same_workspace:true,distinct_sessions:true,previous_dispatch_link_verified:true,active_window:false,attempts:stage.attempts,
  windows:windows.map(w=>({dispatch_id:w.dispatch_id,session_id:w.session_id,operation_id:w.operation_id,prompt_outcome:w.prompt_outcome,created_at:w.created_at,request_bytes:fs.statSync(w.request_file).size})),
  receipts:receipts.map(r=>({dispatch_id:r.dispatch_id,owner:r.owner,session_id:r.session_id,outcome:r.outcome,evidence:r.evidence,at:r.at})),outputs,
  final_decision:assessed.result.decisions[0].reason,token_usage:'unobserved',business_task_recovered:false,
  earlier_probes:[{metadata:'orca-live-fixture.json',result:'held_after_missing_steps',ownership_retained:true},{metadata:'orca-live-fixture-02.json',result:'held_after_record_relative_path_error',ownership_retained:true}]};
fs.writeFileSync(path.join(folder,'orca-live-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));

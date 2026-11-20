'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'orca-route-fixture.json'),'utf8')),base=path.join(f.root,'_plan/autopilot',f.id);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const stage=read(path.join(base,'stage.json')),journals=fs.readdirSync(path.join(base,'orca')).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
assert.equal(journals.length,1);const journal=read(path.join(base,'orca',journals[0])),request=read(journal.request_file),receipt=read(path.join(base,'receipts',journal.dispatch_id+'.json'));
const expected={provider:'custom',model:'gpt-6.1-terra',reasoning:'high'};
assert.deepEqual(journal.launch_route,expected);assert.deepEqual(request.route,expected);
assert.equal(stage.state,'completed');assert.equal(stage.attempts,0);assert.equal(receipt.outcome,'complete');assert.equal(receipt.session_id,journal.session_id);
assert.equal(fs.existsSync(path.join(base,'window.json')),false);
const output=fs.readFileSync(path.join(f.root,'out/route.txt'));assert.equal(output.toString(),'routed short unit\n');
const rollout='C:/Users/nikos/.codex/sessions/2026/11/20/rollout-2026-11-20T10-23-03-01a1f6c3-b4b4-7d81-b0f2-bfda392f7317.jsonl';
// Read only the exact rollout just created for this isolated test, and retain settings metadata only.
const events=fs.readFileSync(rollout,'utf8').split('\n').filter(Boolean).map(JSON.parse),meta=events.find(e=>e.type==='session_meta').payload,turn=events.find(e=>e.type==='turn_context').payload;
assert.equal(meta.cwd,f.root);assert.equal(meta.model_provider,expected.provider);assert.equal(turn.model,expected.model);assert.equal(turn.effort,expected.reasoning);
const core=require(path.join(f.scripts,'lib/core.cjs'));
assert.equal(stage.completed_worktree,core.projectState(f.root,f.root,false));
const assessment=core.evaluate(core.context(f.root));assert.equal(assessment.result.decisions[0].reason,'stage_cap');
const proof={verified_at:new Date().toISOString(),project:f.root,task_id:f.id,session_id:journal.session_id,dispatch_id:journal.dispatch_id,
 requested:expected,observed_in_local_engine:{provider:meta.model_provider,model:turn.model,reasoning:turn.effort},observation_source:'exact isolated native rollout session_meta/turn_context',billing_model:'unobserved',
 stage:stage.state,outcome:receipt.outcome,attempts:stage.attempts,active_window:false,output:{bytes:output.length,sha256:crypto.createHash('sha256').update(output).digest('hex')},
 final_decision:assessment.result.decisions[0].reason,controller_observation:'initial watch exited on callback lock contention; worker completed safely; explicit continuation reached stage_cap; transient lock wait fixed and tested separately'};
fs.writeFileSync(path.join(__dirname,'orca-route-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));

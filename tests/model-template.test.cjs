'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const templates=require('../skills/axns-devflow/scripts/lib/model-template.cjs');
const projects=require('../skills/axns-devflow/scripts/lib/model-project.cjs');
const page=require('../skills/axns-devflow-ext-autopilot/scripts/model-page.cjs');
const catalog=require('../skills/axns-devflow-ext-autopilot/scripts/lib/model-config.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'devflow-template-update-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return root;}
function put(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}
async function editor(t,root){const running=await page.start({projectRoot:root,port:0});t.after(async()=>{running.server.closeAllConnections();await new Promise(resolve=>running.server.close(resolve));});const call=async(endpoint='/api/config',method='GET',body,token=running.token)=>{const r=await fetch(running.origin+endpoint,{method,headers:{'x-devflow-token':token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};return {...running,call};}
function ticket(preview,keys=[]){return {source:preview.template.source,revision:preview.template.revision,state_revision:preview.state_revision,keys};}
function settings(loaded){const a=loaded.autopilot;return {agentsRevision:a.agentsRevision,configRevision:a.configRevision,projectSettingsRevision:loaded.projectSettingsRevision,worktreeEnabled:a.worktreeEnabled,autopilotEnabled:a.declared,executionEnabled:a.executionEnabled,adapter:a.adapter||'session',integrationBranch:a.integrationBranch,modelAssociation:null};}
test('three-way differences distinguish template updates, user changes, deletions and conflicts',()=>{
 const base={version:1,active_preset:'old',models:{main:{label:'Original',model:'old-id',reasoning:'high',strengths:['coding'],description:'base'}}};
 const current=structuredClone(base);current.active_preset='local';current.models.main.model='local-id';current.models.main.description='local description';delete current.models.main.strengths;
 const next=structuredClone(base);next.active_preset='new';next.models.main.label='Updated';next.models.main.model='next-id';next.models.main.reasoning='medium';next.models.extra={label:'New',model:'new'};delete next.models.main.description;
 const rows=templates.differences(current,next,base),find=p=>rows.find(e=>e.path.join('.')===p);
 assert.equal(find('models.main.label').kind,'updated');assert.equal(find('models.main.model').kind,'conflict');assert.equal(find('models.main.reasoning').kind,'updated');
 assert.equal(find('models.main.strengths').kind,'customized','deliberately deleted fields must not be restored by fill-missing');assert.equal(find('models.extra').kind,'added');assert.equal(find('models.main.description').kind,'removed');assert.equal(find('models.main.description').selectable,false);assert.equal(find('active_preset').selectable,false);
});
test('first adoption fills only genuinely absent entries, never mutates source or overwrites custom model IDs',t=>{
 const root=fixture(t),result=projects.initialize(root),doc=projects.read(result.file);doc.models.codex_main.model='my-private-id';const before=JSON.stringify(doc),templateBefore=fs.readFileSync(projects.PERSONAL_TEMPLATE);
 const preview=templates.preview(root,result.file,doc),added=preview.entries.filter(e=>e.kind==='added'&&e.selectable).map(e=>e.key);
 assert.equal(preview.state_revision,'missing');assert.ok(preview.entries.some(e=>e.kind==='conflict'&&e.path.join('.')==='models.codex_main.model'));assert.ok(added.length);
 const merged=templates.apply(root,result.file,doc,ticket(preview,added));catalog.validate(merged.doc);catalog.compile(merged.doc);
 assert.equal(merged.doc.models.codex_main.model,'my-private-id');assert.equal(merged.doc.active_preset,doc.active_preset);assert.ok(merged.doc.models.plan_astra);assert.equal(JSON.stringify(doc),before);assert.deepEqual(fs.readFileSync(projects.PERSONAL_TEMPLATE),templateBefore);assert.equal(fs.existsSync(templates.state(root,result.file).file),false);
 assert.throws(()=>templates.apply(root,result.file,doc,{...ticket(preview),revision:'stale'}),/已变化/);
 assert.throws(()=>templates.apply(root,result.file,doc,{...ticket(preview),keys:['["active_preset"]']}),/已失效/);
 assert.throws(()=>templates.apply(root,result.file,doc,{...ticket(preview),keys:[added[0],added[0]]}),/选择无效/);
});
test('template endpoints preview without writes, apply to a draft, and save baseline atomically with the project',async t=>{
 const root=fixture(t),running=await editor(t,root),loaded=(await running.call()).body;const initial=fs.existsSync(running.file);
 assert.match(loaded.upgradePrompt,/增量升级/);assert.match(loaded.upgradePrompt,/保留/);assert.equal(loaded.templateSync.adopted_revision,null);
 assert.equal((await running.call('/api/template-update','POST',{action:'preview',doc:loaded.doc,source:'personal'},'wrong')).status,403);
 const checked=await running.call('/api/template-update','POST',{action:'preview',doc:loaded.doc,source:'personal'});assert.equal(checked.status,200);assert.equal(fs.existsSync(running.file),initial);
 const keys=checked.body.entries.filter(e=>e.kind==='added'&&e.selectable).map(e=>e.key);
 const applied=await running.call('/api/template-update','POST',{action:'apply',doc:loaded.doc,...ticket(checked.body,keys),associated:false});assert.equal(applied.status,200);assert.equal(fs.existsSync(running.file),initial);assert.equal(fs.existsSync(templates.state(root,running.file).file),false);
 const saved=await running.call('/api/config','PUT',{doc:applied.body.doc,revision:loaded.revision,settings:settings(loaded),templateUpdate:applied.body.templateUpdate});assert.equal(saved.status,200);
 const after=(await running.call()).body;assert.equal(after.templateSync.update_available,false);assert.equal(after.templateSync.adopted_revision,checked.body.template.revision);assert.ok(after.templateSync.updated_at);assert.equal(after.autopilot.executionEnabled,false);assert.equal(after.projectSettings.model_association,null);
 const checkedAgain=(await running.call('/api/template-update','POST',{action:'preview',doc:after.doc,source:'personal'})).body;
 assert.equal(checkedAgain.counts.conflict??0,0);assert.ok(checkedAgain.counts.customized>0);
 const modelBefore=fs.readFileSync(running.file),stateBefore=fs.readFileSync(templates.state(root,running.file).file);after.doc.models.codex_main.label='stale attempt';
 const stale=await running.call('/api/config','PUT',{doc:after.doc,revision:after.revision,settings:settings(after),templateUpdate:applied.body.templateUpdate});assert.equal(stale.status,409);assert.deepEqual(fs.readFileSync(running.file),modelBefore);assert.deepEqual(fs.readFileSync(templates.state(root,running.file).file),stateBefore);
});
test('selected conflicts update only chosen fields and baseline metadata is scoped to the model file and template source',t=>{
 const root=fixture(t),result=projects.initialize(root),doc=projects.read(result.file);doc.models.codex_main.label='local label';doc.models.codex_main.model='local-id';
 const p=templates.preview(root,result.file,doc,'personal'),selected=p.entries.find(e=>e.path.join('.')==='models.codex_main.label');
 const merged=templates.apply(root,result.file,doc,ticket(p,[selected.key]));assert.equal(merged.doc.models.codex_main.label,templates.template().doc.models.codex_main.label);assert.equal(merged.doc.models.codex_main.model,'local-id');
 const [file,content]=templates.savePlan(root,result.file,merged.templateUpdate);put(file,content);
 assert.ok(templates.state(root,result.file).data);assert.equal(templates.state(root,path.join(root,'other.json')).data,null);
 const generic=templates.preview(root,result.file,doc,'generic');assert.ok(generic.entries.some(e=>e.path.join('.')==='models.codex_main.model'&&e.kind==='conflict'));
 assert.throws(()=>templates.template('../../arbitrary'),/请选择/);
});
test('a baseline write failure restores model and project files and never records a successful adoption',t=>{
 const root=fixture(t),result=projects.initialize(root),loaded=page.load(result.file),a=page.autopilotStatus(root);const checked=templates.preview(root,result.file,loaded.doc),applied=templates.apply(root,result.file,loaded.doc,ticket(checked));
 const baseline=templates.state(root,result.file).file,before=fs.readFileSync(result.file),rename=fs.renameSync;let failed=false;
 fs.renameSync=(from,to)=>{if(to===baseline&&!failed){failed=true;throw Error('baseline write failed');}return rename(from,to);};
 const projectSettings={agentsRevision:a.agentsRevision,configRevision:a.configRevision,projectSettingsRevision:'missing',worktreeEnabled:false,autopilotEnabled:true,executionEnabled:false,adapter:'session',integrationBranch:'',modelAssociation:null};
 try{assert.throws(()=>page.saveWorkspace(root,result.file,{doc:applied.doc,revision:loaded.revision,settings:projectSettings,templateUpdate:applied.templateUpdate}),/baseline write failed/);}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(result.file),before);for(const name of ['AGENTS.md','_plan/autopilot.json','.devflow/settings.json','.devflow/model-template.json'])assert.equal(fs.existsSync(path.join(root,name)),false,name);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const project = require('../skills/axns-devflow/scripts/lib/model-project.cjs');
const page = require('../skills/axns-devflow-ext-autopilot/scripts/model-page.cjs');
const catalog = require('../skills/axns-devflow-ext-autopilot/scripts/lib/model-config.cjs');
const core = require('../skills/axns-devflow-ext-autopilot/scripts/lib/core.cjs');
const policy = require('../skills/axns-devflow-ext-autopilot/scripts/lib/launch-policy.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-model-page-'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function put(root, file, doc) { const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof doc==='string'?doc:JSON.stringify(doc));return target; }
function enable(root, config={version:1}) { put(root,'AGENTS.md','extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');put(root,'_plan/prompts/autopilot.json',config); }
async function editor(t, root) {
  const running=await page.start({'project-root':root,port:0});
  t.after(async()=>{running.server.closeAllConnections();await new Promise(resolve=>running.server.close(resolve));});
  const call=async(method='GET',body,extra={})=>{const response=await fetch(running.origin+'/api/config',{method,headers:{'x-devflow-token':running.token,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};};
  return {...running,call};
}
test('new project has three mandatory scenes, user model spellings and independent mutable defaults',t=>{
  const root=fixture(t),result=project.initialize(root);assert.equal(result.created,true);assert.equal(result.execution_enabled_by_this_action,false);
  const doc=project.read(result.file);for(const id of project.REQUIRED)assert.ok(doc.scenarios[id]);
  assert.equal(catalog.preview(doc,doc.active_preset,'planning').route.model,'GPT-6.2-Astra');
  assert.equal(catalog.preview(doc,doc.active_preset,'implementation').route.model,'GPT-6.2-sol');
  const simple=catalog.preview(doc,doc.active_preset,'simple_execution');assert.equal(simple.route.model,'DeepSeek-V4.1-flash');assert.equal(simple.route.executor,'dsh');assert.equal(simple.route.reasoning,undefined);
  doc.models.execute_sol.reasoning='medium';fs.writeFileSync(result.file,JSON.stringify(doc));assert.equal(project.read(project.TEMPLATE).models.execute_sol.reasoning,'high');
});
test('new and old projects reuse the one existing table byte for byte and do not replace a preset',t=>{
  const root=fixture(t),file=put(root,'model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));
  const doc=project.read(file);doc.active_preset='codex_only';fs.writeFileSync(file,JSON.stringify(doc));const before=fs.readFileSync(file);
  const found=project.initialize(root);assert.equal(found.created,false);assert.equal(found.file,file);assert.deepEqual(fs.readFileSync(file),before);
  assert.equal(project.read(file).active_preset,'codex_only');
});
test('shared explicit reference wins and conflicting unregistered tables require a choice',t=>{
  const root=fixture(t),shared=put(root,'shared.json',fs.readFileSync(project.TEMPLATE,'utf8')),child=path.join(root,'child');fs.mkdirSync(child);
  enable(child,{version:1,model_config_file:shared});put(child,'model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));assert.equal(project.discover(child).file,shared);assert.equal(project.discover(child).shared,true);
  const other=path.join(root,'other');put(other,'model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));put(other,'_plan/model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));assert.throws(()=>project.initialize(other),/两份/);
});
test('broken explicit references and inline legacy routing are never silently replaced',t=>{
  const root=fixture(t);enable(root,{version:1,model_config_file:'missing.json'});assert.throws(()=>project.initialize(root));assert.equal(fs.existsSync(path.join(root,'_plan/model-routing.json')),false);
  enable(root,{version:1,models:{legacy:{}}});assert.throws(()=>project.initialize(root),/内联/);
});
test('personal defaults copy custom scenes and missing baseline without mutating source',t=>{
  const root=fixture(t),doc=project.read(project.TEMPLATE);delete doc.scenarios.simple_execution;for (const preset of Object.values(doc.presets)) delete preset.scenarios?.simple_execution;
  doc.scenarios.project_api={label:'API',description:'Project integration'};doc.presets.project_balanced.scenarios.project_api={tier:'plan_astra'};
  const source=put(root,'personal.json',doc),before=fs.readFileSync(source),target=path.join(root,'project');
  assert.equal(project.initialize(target,source,true).created,true);assert.equal(fs.existsSync(target),false);
  const result=project.initialize(target,source),copy=project.read(result.file);assert.ok(copy.scenarios.simple_execution);assert.equal(copy.presets.project_balanced.scenarios.project_api.tier,'plan_astra');assert.deepEqual(fs.readFileSync(source),before);
});
test('autopilot consumes the project table for a future stage and unit scene override, execution stays disabled',t=>{
  const root=fixture(t);project.initialize(root);enable(root);
  let ctx=core.context(root);assert.equal(ctx.cfg.execution.enabled,false);assert.equal(ctx.cfg.model_catalog.preset,'project_balanced');
  const plan=policy.resolve(ctx.cfg,'261120-model-page','P1');assert.equal(plan.model.model,'GPT-6.2-Astra');
  assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2').model.model,'GPT-6.2-sol');
  assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2',{launch:{scenario:'simple_execution'}}).model.model,'DeepSeek-V4.1-flash');
  const file=path.join(root,'_plan/model-routing.json'),current=page.load(file);current.doc.models.execute_sol.reasoning='medium';page.save(file,current.doc,current.revision);
  assert.equal(plan.model.reasoning,'high');ctx=core.context(root);assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2').model.reasoning,'medium');
});
test('inline routes retain priority and explicit file bypasses ambiguous project defaults',t=>{
  const root=fixture(t);project.initialize(root);put(root,'model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));enable(root);assert.throws(()=>core.context(root),/两份/);
  enable(root,{version:1,model_config_file:'model-routing.json'});assert.equal(core.context(root).cfg.model_catalog.preset,'project_balanced');
  enable(root,{version:1,models:{mine:{executor:'codex',provider:'Codex',model:'mine'}},tiers:{P2:'mine'}});assert.equal(core.context(root).cfg.models.mine.model,'mine');
});
test('page saves model, reasoning and custom scene, reports new-session scope and supports reload',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=await running.call();assert.equal(loaded.status,200);
  const {doc,revision}=loaded.body;doc.models.execute_sol.reasoning='medium';doc.scenarios.custom_scene={label:'定制',description:'scope'};doc.presets[doc.active_preset].scenarios.custom_scene={tier:'plan_astra'};
  const saved=await running.call('PUT',{doc,revision});assert.equal(saved.status,200);assert.equal(saved.body.applies_to,'new_sessions_only');
  const again=await running.call();assert.equal(again.body.doc.models.execute_sol.reasoning,'medium');assert.equal(catalog.preview(again.body.doc,doc.active_preset,'custom_scene').route.model,'GPT-6.2-Astra');
});
test('two editors cannot overwrite each other and invalid changes preserve exact file bytes',async t=>{
  const root=fixture(t),running=await editor(t,root),a=(await running.call()).body,b=(await running.call()).body;
  a.doc.models.execute_sol.reasoning='low';assert.equal((await running.call('PUT',a)).status,200);const before=fs.readFileSync(running.file);
  b.doc.models.execute_sol.reasoning='medium';assert.equal((await running.call('PUT',b)).status,409);assert.deepEqual(fs.readFileSync(running.file),before);
  const c=(await running.call()).body;delete c.doc.scenarios.planning;assert.equal((await running.call('PUT',c)).status,400);assert.deepEqual(fs.readFileSync(running.file),before);
});
test('unready active presets and unsupported team routes cannot be saved; inactive drafts remain editable',async t=>{
  const root=fixture(t),running=await editor(t,root),a=(await running.call()).body,before=fs.readFileSync(running.file);
  a.doc.active_preset='claude_only';assert.equal((await running.call('PUT',a)).status,400);assert.deepEqual(fs.readFileSync(running.file),before);
  a.doc.active_preset='project_balanced';a.doc.presets.project_balanced.scenarios.planning.team={enabled:true,mode:'subagent'};assert.equal((await running.call('PUT',a)).status,400);
  delete a.doc.presets.project_balanced.scenarios.planning.team;a.doc.models.new_claude={label:'Later',enabled:false,executor:'claude',provider:'Claude Code',model:''};assert.equal((await running.call('PUT',a)).status,200);
});
test('loopback page rejects unauthenticated and cross-origin requests and never leaks token through config JSON',async t=>{
  const root=fixture(t),running=await editor(t,root);
  assert.equal((await fetch(running.origin+'/api/config')).status,403);
  assert.equal((await running.call('GET',null,{Origin:'https://other.invalid'})).status,403);
  const hostileHost=await new Promise((resolve,reject)=>{require('node:http').get(running.origin+'/api/config',{headers:{host:'other.invalid','x-devflow-token':running.token}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
  assert.equal(hostileHost,403);
  const loaded=await running.call();assert.equal(JSON.stringify(loaded.body).includes(running.token),false);
  const response=await fetch(running.origin);assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  const html=await response.text();assert.ok(html.includes(running.token));assert.equal(html.includes('<script src='),false);
});
test('legacy table missing simple scene is repaired in page draft only until explicit save',async t=>{
  const root=fixture(t),doc=project.read(project.TEMPLATE);delete doc.scenarios.simple_execution;for (const preset of Object.values(doc.presets)) delete preset.scenarios?.simple_execution;const file=put(root,'model-routing.json',doc),before=fs.readFileSync(file);
  const running=await editor(t,root),draft=(await running.call()).body;assert.deepEqual(draft.added,['simple_execution']);assert.deepEqual(fs.readFileSync(file),before);assert.equal((await running.call('PUT',draft)).status,200);assert.ok(project.read(file).scenarios.simple_execution);
});
test('server selects no arbitrary file from a request and page data is inserted as text',async t=>{
  const root=fixture(t),running=await editor(t,root),a=(await running.call()).body;
  a.doc.models.execute_sol.label='<img src=x onerror=alert(1)>';assert.equal((await running.call('PUT',a)).status,200);
  const html=await (await fetch(running.origin)).text();assert.equal(html.includes(a.doc.models.execute_sol.label),false);assert.equal(html.includes('.innerHTML'),false);
  assert.equal((await fetch(running.origin+'/api/config?file=other',{headers:{'x-devflow-token':running.token}})).status,404);
});

test('a Codex scenario in a DSH preset drops inherited DSH team without changing the default',()=>{
  const doc=project.read(project.TEMPLATE);doc.active_preset='dsh_team';doc.presets.dsh_team.scenarios.planning={tier:'plan_astra'};
  assert.equal(catalog.preview(doc,'dsh_team','planning').team,null);
  assert.equal(catalog.preview(doc,'dsh_team','implementation').team.enabled,true);
  doc.presets.dsh_team.scenarios.planning.team={enabled:true};assert.throws(()=>catalog.compile(doc),/DSH/);
});

test('oversized editor payload is refused before touching a configuration',async t=>{
  const root=fixture(t),running=await editor(t,root),before=fs.readFileSync(running.file);
  const response=await running.call('PUT',{oversized:'x'.repeat(150*1024)});assert.equal(response.status,413);assert.deepEqual(fs.readFileSync(running.file),before);
});

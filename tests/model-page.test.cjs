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
  const running=await page.start({projectRoot:root,port:0});
  t.after(async()=>{running.server.closeAllConnections();await new Promise(resolve=>running.server.close(resolve));});
  const call=async(method='GET',body,extra={})=>{const response=await fetch(running.origin+'/api/config',{method,headers:{'x-devflow-token':running.token,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};};
  return {...running,call};
}
test('command options bind the project root to the current directory and reject injected roots',()=>{
  const opts=page.options([]);
  assert.equal(opts.projectRoot,process.cwd());
  assert.throws(()=>page.options(['--project-root','/tmp/other-project']),/用法/);
  assert.equal(page.options(['--port','0']).port,0);
});
test('page startup discovers the project from the current working directory',async t=>{
  const running=await page.start({port:0});
  t.after(async()=>{running.server.closeAllConnections();await new Promise(resolve=>running.server.close(resolve));});
  const response=await fetch(running.origin+'/api/config',{headers:{'x-devflow-token':running.token}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).project,process.cwd());
});
test('new project has three mandatory scenes, user model spellings and independent mutable defaults',t=>{
  const root=fixture(t),result=project.initialize(root);assert.equal(result.created,true);assert.equal(result.execution_enabled_by_this_action,false);
  const doc=project.read(result.file);assert.deepEqual(Object.keys(doc.models),['codex_main','claude_main','deepseek_main']);for(const id of project.REQUIRED)assert.ok(doc.scenarios[id]);
  assert.equal(catalog.preview(doc,doc.active_preset,'planning').route.model,'gpt-6.2-sol');
  assert.equal(catalog.preview(doc,doc.active_preset,'implementation').route.model,'gpt-6.2-sol');
  const simple=catalog.preview(doc,doc.active_preset,'simple_execution');assert.equal(simple.route.model,'deepseek-v4.1-flash');assert.equal(simple.route.executor,'dsh');assert.equal(simple.route.reasoning,undefined);
  doc.models.codex_main.reasoning='medium';fs.writeFileSync(result.file,JSON.stringify(doc));assert.equal(project.read(project.TEMPLATE).models.codex_main.reasoning,'high');
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
  doc.scenarios.project_api={label:'API',description:'Project integration'};doc.presets.project_balanced.scenarios.project_api={tier:'codex_main'};
  const source=put(root,'personal.json',doc),before=fs.readFileSync(source),target=path.join(root,'project');
  assert.equal(project.initialize(target,source,true).created,true);assert.equal(fs.existsSync(target),false);
  const result=project.initialize(target,source),copy=project.read(result.file);assert.ok(copy.scenarios.simple_execution);assert.equal(copy.presets.project_balanced.scenarios.project_api.tier,'codex_main');assert.deepEqual(fs.readFileSync(source),before);
});
test('autopilot consumes the project table for a future stage and unit scene override, execution stays disabled',t=>{
  const root=fixture(t);project.initialize(root);enable(root);
  let ctx=core.context(root);assert.equal(ctx.cfg.execution.enabled,false);assert.equal(ctx.cfg.model_catalog.preset,'project_balanced');
  const plan=policy.resolve(ctx.cfg,'261120-model-page','P1');assert.equal(plan.model.model,'gpt-6.2-sol');
  assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2').model.model,'gpt-6.2-sol');
  assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2',{launch:{scenario:'simple_execution'}}).model.model,'deepseek-v4.1-flash');
  const file=path.join(root,'_plan/model-routing.json'),current=page.load(file);current.doc.models.codex_main.reasoning='medium';page.save(file,current.doc,current.revision);
  assert.equal(plan.model.reasoning,'high');ctx=core.context(root);assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2').model.reasoning,'medium');
});
test('inline routes retain priority and explicit file bypasses ambiguous project defaults',t=>{
  const root=fixture(t);project.initialize(root);put(root,'model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));enable(root);assert.throws(()=>core.context(root),/两份/);
  enable(root,{version:1,model_config_file:'model-routing.json'});assert.equal(core.context(root).cfg.model_catalog.preset,'project_balanced');
  enable(root,{version:1,models:{mine:{executor:'codex',provider:'Codex',model:'mine'}},tiers:{P2:'mine'}});assert.equal(core.context(root).cfg.models.mine.model,'mine');
});
test('page saves model, reasoning and custom scene, reports new-session scope and supports reload',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=await running.call();assert.equal(loaded.status,200);
  const {doc,revision}=loaded.body;doc.models.codex_main.reasoning='medium';doc.scenarios.custom_scene={label:'定制',description:'scope'};doc.presets[doc.active_preset].scenarios.custom_scene={tier:'codex_main'};
  const saved=await running.call('PUT',{doc,revision});assert.equal(saved.status,200);assert.equal(saved.body.applies_to,'new_sessions_only');
  const again=await running.call();assert.equal(again.body.doc.models.codex_main.reasoning,'medium');assert.equal(catalog.preview(again.body.doc,doc.active_preset,'custom_scene').route.model,'gpt-6.2-sol');
});
test('two editors cannot overwrite each other and invalid changes preserve exact file bytes',async t=>{
  const root=fixture(t),running=await editor(t,root),a=(await running.call()).body,b=(await running.call()).body;
  a.doc.models.codex_main.reasoning='low';assert.equal((await running.call('PUT',a)).status,200);const before=fs.readFileSync(running.file);
  b.doc.models.codex_main.reasoning='medium';assert.equal((await running.call('PUT',b)).status,409);assert.deepEqual(fs.readFileSync(running.file),before);
  const c=(await running.call()).body;delete c.doc.scenarios.planning;assert.equal((await running.call('PUT',c)).status,400);assert.deepEqual(fs.readFileSync(running.file),before);
});
test('unready active presets and unsupported team routes cannot be saved; inactive drafts remain editable',async t=>{
  const root=fixture(t),running=await editor(t,root),a=(await running.call()).body;
  assert.equal(fs.existsSync(running.file),false,'opening the page must not create the model file');
  a.doc.active_preset='claude_only';assert.equal((await running.call('PUT',a)).status,400);assert.equal(fs.existsSync(running.file),false);
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

test('project configuration page distinguishes installation, declaration, valid config and execution',async t=>{
  const root=fixture(t),running=await editor(t,root);
  let status=(await running.call()).body.autopilot;
  assert.equal(fs.existsSync(path.join(root,'AGENTS.md')),false);
  assert.equal(fs.existsSync(path.join(root,'_plan/model-routing.json')),false);
  assert.equal(fs.existsSync(path.join(root,'_plan/autopilot.json')),false);
  assert.equal(status.declared,false);assert.equal(status.configValid,false);assert.equal(status.executionEnabled,false);
  assert.equal(status.worktreeAvailable,true);
  enable(root,{version:1,execution:{enabled:false,adapter:'session'}});
  status=(await running.call()).body.autopilot;
  assert.equal(status.declared,true);assert.equal(status.configValid,true);assert.equal(status.executionEnabled,false);
  assert.equal(status.adapter,'session');assert.equal(status.platformVerified,false);
  enable(root,{version:1,execution:{enabled:true,adapter:'command'}});
  status=(await running.call()).body.autopilot;
  assert.equal(status.declared,true);assert.equal(status.configValid,false);assert.equal(status.executionEnabled,false);
  assert.match(status.error,/command/);
});

test('project settings explicitly enable extensions, keep execution off, separate model association and reject stale saves',async t=>{
  const root=fixture(t),modelFile=put(root,'_plan/model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8'));
  const running=await editor(t,root),loaded=await running.call(),modelBefore=fs.readFileSync(modelFile);
  const implicitExecution=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify({
    agentsRevision:loaded.body.autopilot.agentsRevision,configRevision:loaded.body.autopilot.configRevision,
    projectSettingsRevision:loaded.body.projectSettingsRevision,worktreeEnabled:false,autopilotEnabled:false,
    executionEnabled:true,adapter:'session',modelAssociation:null
  })});assert.equal(implicitExecution.status,400);assert.equal(fs.existsSync(path.join(root,'AGENTS.md')),false);
  const response=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify({
    agentsRevision:loaded.body.autopilot.agentsRevision,configRevision:loaded.body.autopilot.configRevision,
    projectSettingsRevision:loaded.body.projectSettingsRevision,worktreeEnabled:false,autopilotEnabled:true,
    executionEnabled:false,adapter:'session',integrationBranch:'',commandFile:'',commandArgs:[],
    modelAssociation:{workspace_mode:'single',preset:loaded.body.doc.active_preset},modelAssociationFile:loaded.body.file
  })});
  assert.equal(response.status,200);
  const refreshed=await running.call();assert.equal(refreshed.body.autopilot.declared,true);
  assert.equal(refreshed.body.autopilot.configValid,true);assert.equal(refreshed.body.autopilot.executionEnabled,false);
  assert.equal(refreshed.body.autopilot.worktreeEnabled,false);
  assert.deepEqual(fs.readFileSync(modelFile),modelBefore,'development settings do not mutate model routing');
  assert.deepEqual(refreshed.body.projectSettings.model_association,{workspace_mode:'single',preset:loaded.body.doc.active_preset});
  assert.match(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),/extensions: \[autopilot\]/);
  const stale=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify({
    agentsRevision:loaded.body.autopilot.agentsRevision,configRevision:loaded.body.autopilot.configRevision,
    projectSettingsRevision:loaded.body.projectSettingsRevision,worktreeEnabled:false,autopilotEnabled:false,
    executionEnabled:false,adapter:'session',modelAssociation:null
  })});assert.equal(stale.status,409);
});
test('worktree mode requires an existing configured integration branch and stays independent from model routing',async t=>{
  const root=fixture(t),{spawnSync}=require('node:child_process');
  assert.equal(spawnSync('git',['init','-b','release/2026-q4',root],{encoding:'utf8'}).status,0);
  spawnSync('git',['-C',root,'config','user.name','Test']);spawnSync('git',['-C',root,'config','user.email','test@example.invalid']);
  fs.writeFileSync(path.join(root,'README.md'),'fixture\n');spawnSync('git',['-C',root,'add','README.md']);
  assert.equal(spawnSync('git',['-C',root,'commit','-m','fixture'],{encoding:'utf8'}).status,0);
  for (const [args, message] of [
    [['branch','main'], 'create a second local branch'],
    [['branch','功能'], 'create a name outside the worktree config grammar'],
    [['update-ref','refs/remotes/origin/remote-only','HEAD'], 'register a remote-only ref'],
  ]) assert.equal(spawnSync('git',['-C',root,...args],{encoding:'utf8'}).status,0,message);
  const modelFile=put(root,'_plan/model-routing.json',fs.readFileSync(project.TEMPLATE,'utf8')),modelBefore=fs.readFileSync(modelFile);
  const running=await editor(t,root),loaded=(await running.call()).body;
  assert.equal(loaded.autopilot.branchListAvailable,true);
  assert.deepEqual(loaded.autopilot.branches,[
    {name:'main',current:false,selectable:true},
    {name:'release/2026-q4',current:true,selectable:true},
    {name:'功能',current:false,selectable:false},
  ]);
  const body={agentsRevision:loaded.autopilot.agentsRevision,configRevision:loaded.autopilot.configRevision,
    projectSettingsRevision:loaded.projectSettingsRevision,worktreeEnabled:true,autopilotEnabled:false,
    executionEnabled:false,adapter:'session',integrationBranch:'missing-branch',modelAssociation:null};
  let response=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,400);assert.equal(fs.existsSync(path.join(root,'AGENTS.md')),false);
  assert.equal(spawnSync('git',['-C',root,'branch','-d','main'],{encoding:'utf8'}).status,0);
  body.integrationBranch='main';
  response=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,400,'a branch deleted after page load is rejected');
  body.integrationBranch='release/2026-q4';
  response=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200);const agents=fs.readFileSync(path.join(root,'AGENTS.md'),'utf8');
  assert.match(agents,/extensions: \[worktree\]/);assert.match(agents,/integration_branch: release\/2026-q4/);
  assert.deepEqual(fs.readFileSync(modelFile),modelBefore);
});
test('project settings preserve a missing branch and can save a new integration branch before enabling worktree',async t=>{
  const root=fixture(t),{execFileSync}=require('node:child_process');
  put(root,'AGENTS.md','integration_branch: former\n');
  const running=await editor(t,root);
  const initial=(await running.call()).body;
  assert.equal(initial.autopilot.branchListAvailable,false);
  assert.equal(initial.autopilot.integrationBranch,'former');
  assert.equal(initial.autopilot.branchExists,false);
  const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
  git('init','-b','main');
  const empty=(await running.call()).body;
  assert.equal(empty.autopilot.branchListAvailable,true);
  assert.deepEqual(empty.autopilot.branches,[]);
  git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial');
  const response=await fetch(running.origin+'/api/project-settings',{method:'PUT',headers:{'x-devflow-token':running.token,'Content-Type':'application/json'},body:JSON.stringify({
    agentsRevision:empty.autopilot.agentsRevision,configRevision:empty.autopilot.configRevision,projectSettingsRevision:empty.projectSettingsRevision,
    worktreeEnabled:false,autopilotEnabled:false,executionEnabled:false,adapter:'session',integrationBranch:'main',modelAssociation:null,
  })});
  assert.equal(response.status,200);
  const saved=(await running.call()).body;
  assert.equal(saved.autopilot.integrationBranch,'main');
  assert.equal(saved.autopilot.branchExists,true);
  assert.equal(saved.autopilot.worktreeEnabled,false);
});
test('preset usage text survives editor save and leaves routing unchanged',async t=>{
  const running=await editor(t,fixture(t)),draft=(await running.call()).body;
  const compiled=catalog.compile(draft.doc);
  draft.doc.presets[draft.doc.active_preset].use_case='跨模块的方案与实现';
  draft.doc.presets[draft.doc.active_preset].description='计划与实现分别使用指定模型。';
  assert.equal((await running.call('PUT',draft)).status,200);
  const saved=(await running.call()).body;
  assert.equal(saved.doc.presets[saved.doc.active_preset].use_case,'跨模块的方案与实现');
  assert.equal(saved.doc.presets[saved.doc.active_preset].description,'计划与实现分别使用指定模型。');
  assert.deepEqual(catalog.compile(saved.doc),compiled);
  saved.doc.presets[saved.doc.active_preset].use_case={ invalid:true };
  assert.equal((await running.call('PUT',saved)).status,400);
});
test('legacy table missing simple scene is repaired in page draft only until explicit save',async t=>{
  const root=fixture(t),doc=project.read(project.TEMPLATE);delete doc.scenarios.simple_execution;for (const preset of Object.values(doc.presets)) delete preset.scenarios?.simple_execution;const file=put(root,'model-routing.json',doc),before=fs.readFileSync(file);
  const running=await editor(t,root),draft=(await running.call()).body;assert.deepEqual(draft.added,['simple_execution']);assert.deepEqual(fs.readFileSync(file),before);assert.equal((await running.call('PUT',draft)).status,200);assert.ok(project.read(file).scenarios.simple_execution);
});
test('server selects no arbitrary file from a request and page data is inserted as text',async t=>{
  const root=fixture(t),running=await editor(t,root),a=(await running.call()).body;
  a.doc.models.codex_main.label='<img src=x onerror=alert(1)>';assert.equal((await running.call('PUT',a)).status,200);
  const html=await (await fetch(running.origin)).text();assert.equal(html.includes(a.doc.models.codex_main.label),false);assert.equal(html.includes('.innerHTML'),false);
  assert.equal((await fetch(running.origin+'/api/config?file=other',{headers:{'x-devflow-token':running.token}})).status,404);
});

test('a Codex scenario in a DSH preset drops inherited DSH team without changing the default',()=>{
  const doc=project.read(project.TEMPLATE);doc.active_preset='dsh_team';doc.presets.dsh_team.scenarios.planning={tier:'codex_main'};
  assert.equal(catalog.preview(doc,'dsh_team','planning').team,null);
  assert.equal(catalog.preview(doc,'dsh_team','implementation').team.enabled,true);
  doc.presets.dsh_team.scenarios.planning.team={enabled:true};assert.throws(()=>catalog.compile(doc),/DSH/);
});

test('oversized editor payload is refused before touching a configuration',async t=>{
  const root=fixture(t),running=await editor(t,root);
  const response=await running.call('PUT',{oversized:'x'.repeat(150*1024)});assert.equal(response.status,413);assert.equal(fs.existsSync(running.file),false);
});
const vm = require('node:vm');
function pageDraft(doc) {
  const html=fs.readFileSync(path.join(__dirname,'../skills/axns-devflow-ext-autopilot/references/model-page.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('__EDITOR_TOKEN__','null');
  const context=vm.createContext({structuredClone,document:{getElementById:()=>({})}});
  // Pure draft operations use the actual page implementation without initiating HTTP requests.
  vm.runInContext(script.slice(0,script.indexOf("$('preset').addEventListener")),context);
  context.seed=structuredClone(doc);vm.runInContext('doc=seed;render=()=>{};changed=()=>{};',context);
  return {run:source=>vm.runInContext(source,context),doc:()=>vm.runInContext('doc',context)};
}
test('visual capability survives editor save and remains outside executable route payloads',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=(await running.call()).body;
  loaded.doc.models.codex_main.supports_vision=true;loaded.doc.models.claude_main.supports_vision=false;
  assert.equal((await running.call('PUT',loaded)).status,200);
  const after=(await running.call()).body;
  assert.equal(after.doc.models.codex_main.supports_vision,true);assert.equal(after.doc.models.claude_main.supports_vision,false);
  assert.equal(Object.hasOwn(catalog.compile(after.doc).models.codex_main,'supports_vision'),false);
  after.doc.models.codex_main.supports_vision='true';assert.equal((await running.call('PUT',after)).status,400);
  assert.equal((await running.call()).body.doc.models.codex_main.supports_vision,true);
});
test('editing model and custom scenario IDs updates every catalog reference and rejects collisions atomically',()=>{
  const doc=project.read(project.TEMPLATE);doc.models.custom_model=structuredClone(doc.models.codex_main);doc.scenarios.custom={label:'Custom',description:'Custom scope'};
  doc.presets.project_balanced.scenarios.custom={tier:'custom_model'};doc.stage_scenarios.P3='custom';
  doc.dsh.scenarios.push('custom');doc.dsh.native_reasoning_models=['custom_model'];
  const draft=pageDraft(doc);draft.run("renameId('models','custom_model','project_planner')");
  const renamed=draft.doc();assert.equal(renamed.presets.project_balanced.scenarios.custom.tier,'project_planner');
  assert.equal(renamed.dsh.native_reasoning_models[0],'project_planner');
  draft.run("renameId('scenarios','custom','project_review')");
  assert.equal(renamed.stage_scenarios.P3,'project_review');assert.equal(renamed.dsh.scenarios.includes('project_review'),true);
  assert.equal(renamed.presets.project_balanced.scenarios.project_review.tier,'project_planner');catalog.validate(renamed);
  const before=JSON.stringify(renamed);
  assert.throws(()=>draft.run("renameId('models','project_planner','codex_main')"),/ID 已存在/);
  assert.throws(()=>draft.run("renameId('models','project_planner','Bad ID')"),/ID 需/);assert.equal(JSON.stringify(renamed),before);
});
test('DSH worktree choices survive save, inherit independently from collaboration and clear for non-DSH routes',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=(await running.call()).body;
  loaded.doc.active_preset='dsh_native';const preset=loaded.doc.presets.dsh_native;
  preset.default.team={enabled:true,mode:'subagent',worktree:true};preset.scenarios.planning={team:{enabled:false}};
  preset.scenarios.implementation={team:{enabled:true,mode:'team',worktree:false}};
  assert.equal((await running.call('PUT',loaded)).status,200);
  const saved=(await running.call()).body.doc;
  assert.deepEqual(catalog.preview(saved,'dsh_native','planning').team,{enabled:false,worktree:true});
  assert.equal(catalog.preview(saved,'dsh_native','implementation').team.worktree,false);
  saved.presets.dsh_native.scenarios.planning={tier:'codex_main'};assert.equal(catalog.preview(saved,'dsh_native','planning').team,null);
  saved.presets.dsh_native.default.team.worktree='on';assert.throws(()=>catalog.validate(saved),/worktree/);
});
test('switching DSH modes preserves worktree while removing obsolete Team member limits',()=>{
  const draft=pageDraft(project.read(project.TEMPLATE));
  draft.run("doc.presets.project_balanced.default.team={enabled:true,mode:'team',max_members:3,worktree:true};setTeam(doc.presets.project_balanced.default,'team');");
  assert.deepEqual(JSON.parse(JSON.stringify(draft.doc().presets.project_balanced.default.team)),{enabled:true,mode:'team',worktree:true});
  draft.run("setTeam(doc.presets.project_balanced.default,'off');");assert.equal(draft.doc().presets.project_balanced.default.team.worktree,true);
});


test('application modes filter model choices and retain visible incompatible assignments',()=>{
  const doc=project.read(project.TEMPLATE), draft=pageDraft(doc);
  draft.run("doc.active_preset='codex_only'");
  const options=JSON.parse(JSON.stringify(draft.run("modelOptions()")));
  assert.ok(options.some(([id])=>id==='codex_main'));
  assert.ok(options.every(([id])=>doc.models[id].executor==='codex'));
  assert.match(options.find(([id])=>id==='codex_main')[1], / · /);
  assert.match(draft.run("modelOptions('deepseek_main').find(([id])=>id==='deepseek_main')[1]"), /不匹配/);
  draft.run("doc.active_preset='mixed'");
  assert.equal(draft.run('modelOptions().length'),Object.keys(doc.models).length);
  assert.match(draft.run("sceneOptions().find(([id])=>id==='planning')[1]"), / · /);
});

test('single-tool application modes reject incompatible routes when compiled',()=>{
  const doc=project.read(project.TEMPLATE);
  doc.models.deepseek_main.enabled=true;
  doc.presets.codex_only.scenarios.planning={tier:'deepseek_main'};
  assert.throws(()=>catalog.compile(doc,'codex_only'),/不匹配/);
  doc.presets.mixed.scenarios.planning={tier:'deepseek_main'};
  assert.doesNotThrow(()=>catalog.compile(doc,'mixed'));
});


test('model deletion protects defaults and referenced configurations',()=>{
  const doc=project.read(project.TEMPLATE);doc.models.custom=structuredClone(doc.models.codex_main);
  const draft=pageDraft(doc);
  assert.throws(()=>draft.run("deleteModel('codex_main')"),/默认模型/);
  assert.throws(()=>draft.run("renameId('models','codex_main','other')"),/不可修改/);
  draft.run("doc.presets.mixed.scenarios.planning={tier:'custom'}");
  assert.throws(()=>draft.run("deleteModel('custom')"),/仍被引用/);
  draft.run("delete doc.presets.mixed.scenarios.planning;deleteModel('custom')");
  assert.equal(draft.doc().models.custom,undefined);catalog.validate(draft.doc());
});


test('P5 escalation has a selectable scenario and resolves its configured model',()=>{
  const doc=project.read(project.TEMPLATE);
  assert.equal(doc.stage_scenarios.P5,'escalation');
  assert.match(doc.scenarios.escalation.description,/人工裁决/);
  assert.equal(catalog.compile(doc).tiers.P5,doc.presets[doc.active_preset].default.tier);
  const draft=pageDraft(doc);
  assert.match(draft.run("sceneOptions().find(([id])=>id==='escalation')[1]"),/升级处理与人工裁决 · /);
});


test('capability requirements and strengths survive save and produce transparent match guidance',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=(await running.call()).body;
  loaded.doc.models.codex_main.strengths=['coding','search'];
  loaded.doc.models.codex_main.strengths_description='代码实现与资料调查';
  loaded.doc.models.codex_main.supports_vision=true;
  loaded.doc.scenarios.planning.required_capabilities=['coding','vision','search'];
  assert.equal((await running.call('PUT',loaded)).status,200);
  const doc=(await running.call()).body.doc,draft=pageDraft(doc);
  assert.equal(doc.models.codex_main.strengths_description,'代码实现与资料调查');
  assert.equal(draft.run("matchText(doc.models.codex_main,doc.scenarios.planning)"),'已声明符合要求');
  assert.match(draft.run("matchText(doc.models.deepseek_main,doc.scenarios.planning)"),/待确认/);
  assert.equal(Object.hasOwn(catalog.compile(doc).models.codex_main,'strengths'),false);
  doc.scenarios.planning.required_capabilities=['vision','vision'];assert.throws(()=>catalog.validate(doc),/能力列表/);
});

test('personal model template is copied to a new project and never replaces an existing configuration',t=>{
  const root=fixture(t),personal=project.read(project.PERSONAL_TEMPLATE);
  catalog.validate(personal);catalog.compile(personal);
  const result=project.initialize(root,project.PERSONAL_TEMPLATE),copied=project.read(result.file);
  assert.deepEqual(copied.models,personal.models);assert.deepEqual(copied.presets,personal.presets);assert.deepEqual(copied.scenarios,personal.scenarios);
  const before=fs.readFileSync(result.file);assert.equal(project.initialize(root,project.PERSONAL_TEMPLATE).created,false);assert.deepEqual(fs.readFileSync(result.file),before);
  assert.equal(page.options(['--personal']).from,project.PERSONAL_TEMPLATE);
  assert.throws(()=>page.options(['--personal','--from','other']),/不可同时|不能与/);
});


function workspaceSettings(loaded,association){
  return {agentsRevision:loaded.autopilot.agentsRevision,configRevision:loaded.autopilot.configRevision,projectSettingsRevision:loaded.projectSettingsRevision,
    worktreeEnabled:false,autopilotEnabled:true,executionEnabled:false,adapter:'session',integrationBranch:'',commandFile:'',commandArgs:[],modelAssociation:association};
}
test('one workspace save synchronizes the selected preset and rejects stale associated settings without partial writes',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=(await running.call()).body;
  loaded.doc.active_preset='codex_only';
  const settings=workspaceSettings(loaded,{workspace_mode:'single',preset:'project_balanced'});
  assert.equal((await running.call('PUT',{doc:loaded.doc,revision:loaded.revision,settings})).status,200);
  const after=(await running.call()).body;
  assert.equal(after.doc.active_preset,'codex_only');assert.equal(after.projectSettings.model_association.preset,'codex_only');
  assert.equal(core.context(root).cfg.model_catalog.preset,'codex_only');
  const before=fs.readFileSync(running.file);
  after.doc.active_preset='mixed';
  assert.equal((await running.call('PUT',{doc:after.doc,revision:after.revision,settings})).status,409);
  assert.deepEqual(fs.readFileSync(running.file),before);
});

test('disconnecting the model association preserves scene drafts and execution settings while inheriting the session model',async t=>{
  const root=fixture(t),running=await editor(t,root),loaded=(await running.call()).body;
  const settings=workspaceSettings(loaded,null);
  loaded.doc.active_preset='claude_only'; // Unready routing can be retained while routing is disconnected.
  assert.equal((await running.call('PUT',{doc:loaded.doc,revision:loaded.revision,settings})).status,200);
  const after=(await running.call()).body;assert.equal(after.projectSettings.model_association,null);
  assert.deepEqual(after.doc.scenarios,loaded.doc.scenarios);
  const ctx=core.context(root);assert.equal(ctx.cfg.model_catalog,undefined);assert.equal(ctx.cfg.execution.enabled,false);
  assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2').model,null);
  assert.equal(policy.resolve(ctx.cfg,'261120-model-page','P2').route_source,'inherited');
});

test('a failed combined save restores both models and project files',t=>{
  const root=fixture(t),result=project.initialize(root),loaded=page.load(result.file),autopilot=page.autopilotStatus(root);
  const settings={agentsRevision:autopilot.agentsRevision,configRevision:autopilot.configRevision,projectSettingsRevision:'missing',worktreeEnabled:false,autopilotEnabled:true,executionEnabled:false,adapter:'session',integrationBranch:'',modelAssociation:{workspace_mode:'single',preset:'codex_only'}};
  const before=fs.readFileSync(result.file),rename=fs.renameSync;let failed=false;
  fs.renameSync=(source,destination)=>{if(destination===path.join(root,'.devflow','settings.json')&&!failed){failed=true;throw Error('simulated settings write failure');}return rename(source,destination);};
  try{loaded.doc.active_preset='codex_only';assert.throws(()=>page.saveWorkspace(root,result.file,{doc:loaded.doc,revision:loaded.revision,settings}),/simulated settings/);}finally{fs.renameSync=rename;}
  assert.deepEqual(fs.readFileSync(result.file),before);assert.equal(fs.existsSync(path.join(root,'AGENTS.md')),false);assert.equal(fs.existsSync(path.join(root,'_plan','autopilot.json')),false);
});

test('common templates describe every model and scene with validated capability metadata',()=>{
  for(const file of [project.TEMPLATE,project.PERSONAL_TEMPLATE]){const doc=project.read(file);catalog.validate(doc);
    for(const m of Object.values(doc.models)){assert.ok(m.strengths_description?.trim());assert.ok(m.strengths?.length);}assert.ok(new Set(Object.values(doc.models).map(m=>JSON.stringify(m.strengths))).size>1,'template model strengths should reflect different roles');
    for(const scene of Object.values(doc.scenarios))assert.ok(scene.required_capabilities?.length);
  }
});

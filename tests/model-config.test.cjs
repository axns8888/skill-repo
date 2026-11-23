'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const scripts = path.resolve(__dirname, '../skills/axns-devflow-ext-autopilot/scripts');
const catalog = require(path.join(scripts, 'lib/model-config.cjs'));
const policy = require(path.join(scripts, 'lib/launch-policy.cjs'));
const core = require(path.join(scripts, 'lib/core.cjs'));
const runtime = require(path.join(scripts, 'lib/runtime.cjs'));
const units = require(path.join(scripts, 'lib/units.cjs'));
const cli = require(path.join(scripts, 'model-config.cjs'));
// Test fixtures must not constrain the user's selected preset, model names, or scenario inventory.
const scenarioIds = ['intake', 'planning', 'implementation', 'quick_fix', 'debugging', 'refactoring', 'ui', 'testing', 'review', 'acceptance', 'documentation', 'research', 'handoff', 'coordination'];
const template = JSON.stringify({ version: 1, active_preset: 'codex_only',
  models: {
    codex_main: { label: 'Test Codex', enabled: true, executor: 'codex', provider: 'own-code', model: 'known-code', reasoning: 'high' },
    claude_main: { label: 'Test Claude', enabled: false, executor: 'claude', provider: '', model: '' },
    deepseek_main: { label: 'Test DSH', enabled: true, executor: 'dsh', provider: 'own-dsh', model: 'known-dsh', reasoning: 'high' },
  },
  scenarios: Object.fromEntries(scenarioIds.map(id => [id, { label: id, description: 'Test scenario ' + id }])),
  stage_scenarios: { P0: 'intake', P1: 'planning', P2: 'implementation', P3: 'review', P4: 'acceptance', conductor: 'coordination' },
  presets: {
    codex_only: { label: 'Codex', description: 'Test preset', default: { tier: 'codex_main' } },
    claude_only: { label: 'Claude', description: 'Test preset', default: { tier: 'claude_main' } },
    deepseek_only: { label: 'DSH', description: 'Test preset', default: { tier: 'deepseek_main', team: { enabled: false } } },
    mixed: { label: 'Mixed', description: 'Test preset', default: { tier: 'codex_main' }, scenarios: {
      planning: { tier: 'claude_main' }, review: { tier: 'claude_main' }, documentation: { tier: 'deepseek_main', team: { enabled: false } },
    } },
    dsh_team: { label: 'Team', description: 'Test preset', default: { tier: 'deepseek_main', team: { enabled: true, max_members: 3 } } },
  },
});
const id = '20261120-model-scenarios';
function doc() { return catalog.parse(template); }

test('model summary returns selected configured route and content version, not the full catalog', t => {
  const f = fixture(t);
  const full = cli.execute(cli.options(['show', '--file', f.file]));
  const narrow = cli.execute(cli.options(['show', '--file', f.file, '--summary', '--scenario', 'planning']));
  assert.equal(narrow.active_preset, full.active_preset);
  assert.match(narrow.sha256, /^[a-f0-9]{64}$/);
  assert.equal(narrow.scenarios.length, 1);
  assert.equal(narrow.scenarios[0].model, full.scenarios.find(x => x.id === 'planning').selection.route.model);
  assert.equal(narrow.models, undefined);
  assert.equal(narrow.availability, 'configured_only_not_probed');
});
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-'));
  const root = path.join(temp, 'project with spaces'); fs.mkdirSync(root);
  const file = path.join(temp, 'personal models.json'); fs.writeFileSync(file, template);
  const configFile = path.join(root, '_plan/prompts/autopilot.json');
  const put = (name, value) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); };
  put('AGENTS.md', 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
  put('_plan/prompts/autopilot.json', { version: 1, model_config_file: file, execution: { enabled: true, require_units: true } });
  put('_plan/.active_plan', id); put('_plan/process/' + id + '/plan.md', 'One bounded task.');
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(temp)), fs.realpathSync(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true }); });
  return { root, temp, file, configFile, put };
}
function cfg(value = doc()) {
  const compiled = catalog.compile(value);
  return { ...compiled, model_catalog: { preset: compiled.preset }, launch: policy.config({}, compiled.models, core.id, compiled.scenarios),
    caps: { switch_model: { enabled: true } } };
}
test('the standalone file lists described scenarios and shows unconfigured presets without enabling them', () => {
  catalog.parse(fs.readFileSync(path.resolve(__dirname, '../model-routing.json'), 'utf8'));
  const info = catalog.inspect(doc());
  assert.equal(info.active_preset, 'codex_only'); assert.equal(info.scenarios.length, 14);
  assert.deepEqual(info.presets.filter(p => p.ready).map(p => p.id), ['codex_only', 'deepseek_only', 'dsh_team']);
  assert.equal(info.models.find(m => m.id === 'claude_main').enabled, false);
  for (const scenario of info.scenarios) assert.ok(scenario.description && scenario.label);
  const result = catalog.preview(doc(), 'dsh_team', 'implementation');
  assert.equal(result.team.max_members, 3); assert.equal(result.paths.dsh_automatic_handoff, true); assert.equal(result.paths.dsh_entry_required, true);
});
test('the file rejects typos, invalid stages, secret fields, missing routes and oversized input', () => {
  const changes = [d => d.key = 'bad', d => d.models.codex_main.api_key = 'never-accepted',
    d => d.stage_scenarios.P2 = 'missing', d => d.stage_scenarios.P9 = 'implementation',
    d => d.models.codex_main.provider = '', d => d.models.codex_main.executor = 'guess',
    d => d.presets.codex_only.scenarios = { unknown: { tier: 'codex_main' } },
    d => d.presets.codex_only.default.tier = 'unknown', d => d.active_preset = 'unknown'];
  for (const change of changes) { const value = doc(); change(value); assert.throws(() => catalog.validate(value)); }
  assert.throws(() => catalog.parse('x'.repeat(catalog.MAX_BYTES + 1)), /128 KiB/);
  assert.throws(() => catalog.parse('{broken'), /JSON/);
});
test('presets provide stage defaults while unit and task scenarios can override them', () => {
  const value = doc();
  value.models.claude_main = { ...value.models.claude_main, enabled: true, provider: 'known-channel', model: 'known-model' };
  value.active_preset = 'mixed'; const config = cfg(value);
  assert.equal(policy.resolve(config, id, 'P1').model.executor, 'claude');
  assert.equal(policy.resolve(config, id, 'P2').scenario, 'implementation');
  config.launch = policy.config({ tasks: { [id]: { scenario: 'documentation' } } }, config.models, core.id, config.scenarios);
  let selected = policy.resolve(config, id, 'P2');
  assert.equal(selected.model.executor, 'dsh'); assert.deepEqual(selected.team, { enabled: false });
  selected = policy.resolve(config, id, 'P2', { launch: { scenario: 'review' } });
  assert.equal(selected.model.executor, 'claude'); assert.equal(selected.route_source, 'unit'); assert.equal(selected.preset, 'mixed');
  assert.equal(selected.team, null, 'team from a superseded scenario must not cross executors');
  config.launch.tasks[id].team = { enabled: false };
  assert.deepEqual(policy.resolve(config, id, 'P2', { launch: { scenario: 'review' } }).team, { enabled: false }, 'explicit task policy remains in force');
  config.caps.switch_model.enabled = false;
  selected = policy.resolve(config, id, 'P2'); assert.equal(selected.model, null); assert.equal(selected.team.enabled, false);
  assert.throws(() => policy.resolve(config, id, 'P2', { launch: { tier: 'codex_main', scenario: 'review' } }), /只能选择一个/);
  assert.throws(() => policy.resolve(config, id, 'P2', { launch: { scenario: 'missing' } }), /scenario/);
  const explicitDefault = cfg(value);
  explicitDefault.scenarios.implementation = { tier: 'deepseek_main', team: { enabled: true, max_members: 3 } };
  explicitDefault.tiers.P2 = 'deepseek_main';
  explicitDefault.launch = policy.config({ default: { team: { enabled: false } } }, explicitDefault.models, core.id, explicitDefault.scenarios);
  assert.deepEqual(policy.resolve(explicitDefault, id, 'P2').team, { enabled: false }, 'explicit project team policy overrides the stage scenario default');
});
test('CLI refuses unavailable presets without changing the file or retaining a helper lock', t => {
  const f = fixture(t), before = fs.readFileSync(f.file, 'utf8');
  const result = spawnSync(process.execPath, [path.join(scripts, 'model-config.cjs'), 'use', '--file', f.file, '--preset', 'claude_only'],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1); assert.match(result.stderr, /尚未启用/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before); assert.equal(fs.existsSync(f.file + '.lock'), false);
  assert.deepEqual(fs.readdirSync(f.temp).sort(), ['personal models.json', 'project with spaces']);
});
test('CLI switches presets and assigns scenarios with explicitly controlled DSH teams', t => {
  const f = fixture(t);
  const used = cli.execute(cli.options(['use', '--file', f.file, '--preset', 'deepseek_only']));
  assert.equal(used.active_preset, 'deepseek_only'); assert.equal(used.applies_to, 'new_sessions_only');
  cli.execute(cli.options(['use', '--file', f.file, '--preset', 'deepseek_only']));
  const result = cli.execute(cli.options(['assign', '--file', f.file, '--scenario', 'testing', '--model', 'deepseek_main', '--team', 'on', '--max-members', '2']));
  assert.equal(result.selection.route.executor, 'dsh'); assert.equal(result.selection.team.max_members, 2);
  const before = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => cli.execute(cli.options(['assign', '--file', f.file, '--scenario', 'testing', '--model', 'codex_main'])), /团队策略/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  cli.execute(cli.options(['assign', '--file', f.file, '--scenario', 'testing', '--model', 'codex_main', '--team', 'inherit']));
  assert.equal(cli.execute(cli.options(['preview', '--file', f.file, '--scenario', 'testing'])).team, null);
});
test('CLI validates duplicate flags and requires an explicit team before a member limit', () => {
  for (const args of [['use'], ['preview'], ['assign', '--scenario', 'review'], ['show', '--file', 'a', '--file', 'b'],
    ['assign', '--scenario', 'review', '--model', 'x', '--max-members', '3']]) assert.throws(() => cli.options(args));
});
test('file and CLI select native DSH mode and preserve original bytes on an unsupported member cap', t => {
  const f = fixture(t), args = ['assign', '--file', f.file, '--preset', 'dsh_team', '--scenario', 'implementation',
    '--model', 'deepseek_main', '--team', 'on', '--team-mode', 'subagent'];
  cli.execute(cli.options(args.slice()));
  const result = cli.execute(cli.options(['preview', '--file', f.file, '--preset', 'dsh_team', '--scenario', 'implementation']));
  assert.deepEqual(result.team, { enabled: true, mode: 'subagent' });
  const source = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => cli.execute(cli.options([...args, '--max-members', '3'])), /max_members/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), source); assert.equal(fs.existsSync(f.file + '.lock'), false);
  assert.throws(() => cli.options(['assign', '--scenario', 'implementation', '--model', 'deepseek_main', '--team-mode', 'subagent']), /--team on/);
});
test('a pure DSH session claims native mode without an Orca bridge and refuses an unconfirmed mode', t => {
  const f = fixture(t), personal = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  personal.active_preset = 'dsh_team'; personal.presets.dsh_team.default.team = { enabled: true, mode: 'subagent' };
  fs.writeFileSync(f.file, JSON.stringify(personal));
  f.put('_plan/process/' + id + '/unit.json', { id: 'native', goal: 'One native task', inputs: [], write_scope: [],
    done_when: ['Evidence exists'], stop_when: ['After one task'], budget: { max_steps: 3, max_minutes: 5 } });
  runtime.initialize(f.root, { id, stage: 'P2', owner: 'controller/test', unit: 'unit.json' });
  const base = [path.join(scripts, 'runner.cjs'), 'claim', '--project', f.root, '--id', id, '--owner', 'dsh/native-test',
    '--executor', 'dsh', '--provider', 'own-dsh', '--model', 'known-dsh', '--reasoning', 'high', '--team-enabled', 'true'];
  const wrong = spawnSync(process.execPath, base, { encoding: 'utf8', windowsHide: true });
  assert.equal(wrong.status, 2, wrong.stderr); assert.equal(JSON.parse(wrong.stdout).reason, 'session_team_mismatch');
  const right = spawnSync(process.execPath, [...base, '--team-mode', 'subagent'], { encoding: 'utf8', windowsHide: true });
  assert.equal(right.status, 0, right.stderr);
  const value = JSON.parse(right.stdout); assert.equal(value.action, 'claimed');
  assert.deepEqual(value.request.team, { enabled: true, mode: 'subagent' });
  assert.equal(core.context(f.root).cfg.execution.adapter, 'session');
  assert.equal(fs.existsSync(path.join(f.root, '_plan/autopilot', id, 'orca')), false);
});
test('the project reads a shared external file and detects edits made after observation', t => {
  const f = fixture(t), ctx = core.context(f.root);
  assert.equal(ctx.cfg.model_catalog.file, f.file); assert.equal(ctx.cfg.models.codex_main.executor, 'codex');
  assert.equal(ctx.cfg.models.claude_main, undefined);
  cli.execute(cli.options(['use', '--file', f.file, '--preset', 'deepseek_only']));
  assert.throws(() => core.verify(ctx), /读取期间状态改变/);
  const next = core.context(f.root); assert.equal(next.cfg.model_catalog.preset, 'deepseek_only');
  assert.equal(policy.resolve(next.cfg, id, 'P2').model.executor, 'dsh');
});
test('relative files work, missing files fail, and inline routes cannot compete with a separate file', t => {
  const f = fixture(t), raw = JSON.parse(fs.readFileSync(f.configFile, 'utf8'));
  fs.writeFileSync(path.join(f.root, 'model-routing.json'), template);
  raw.model_config_file = 'model-routing.json'; fs.writeFileSync(f.configFile, JSON.stringify(raw));
  assert.equal(core.context(f.root).cfg.model_catalog.preset, 'codex_only');
  raw.models = {}; fs.writeFileSync(f.configFile, JSON.stringify(raw));
  assert.throws(() => core.context(f.root), /不可同时配置/);
  delete raw.models; raw.model_config_file = 'missing.json'; fs.writeFileSync(f.configFile, JSON.stringify(raw));
  assert.throws(() => core.context(f.root), /缺失/);
});
test('a scene-based unit is validated and the actual session request snapshots its route and preset', t => {
  const f = fixture(t), relative = 'unit.json';
  const unit = { id: 'one', goal: 'One scenario task', inputs: ['_plan/process/' + id + '/plan.md'],
    write_scope: ['_plan/process/' + id], done_when: ['Evidence exists'], stop_when: ['After callback'],
    budget: { max_steps: 2, max_minutes: 2 }, launch: { scenario: 'quick_fix' } };
  units.spec(unit); f.put('_plan/process/' + id + '/' + relative, unit);
  runtime.initialize(f.root, { id, stage: 'P2', owner: 'controller/test', unit: relative });
  const route = catalog.preview(doc(), 'codex_only', 'quick_fix').route;
  const claimed = runtime.reserve(f.root, { id, owner: 'worker/model-test', route }, 'session');
  assert.equal(claimed.result.action, 'claimed');
  const request = claimed.result.request;
  assert.equal(request.work_unit.spec.launch.scenario, 'quick_fix'); assert.deepEqual(request.route, route);
  assert.deepEqual(request.launch_context, { preset: 'codex_only', scenario: 'quick_fix' });
  cli.execute(cli.options(['use', '--file', f.file, '--preset', 'deepseek_only']));
  const held = JSON.parse(fs.readFileSync(path.join(f.root, '_plan/autopilot', id, 'window.json'), 'utf8'));
  assert.deepEqual(held.request.route, route); assert.equal(held.request.launch_context.preset, 'codex_only');
});

test('DSH member scene routes are immutable in a claimed root request', t => {
  const f = fixture(t), value = doc();
  value.presets.dsh_native = { label: 'Native', description: 'Fixture native team', default: { tier: 'deepseek_main', team: { enabled: true, mode: 'subagent' } } };
  value.active_preset = 'dsh_native';
  value.dsh = { child_preset: 'dsh_native', scenarios: ['review'], native_reasoning_models: [] };
  fs.writeFileSync(f.file, JSON.stringify(value));
  const unit = { id: 'member-scenes', goal: 'One scene routing check', inputs: [], write_scope: [],
    done_when: ['Snapshot exists'], stop_when: ['After claim'], budget: { max_steps: 2, max_minutes: 2 } };
  f.put('_plan/process/' + id + '/unit.json', unit);
  runtime.initialize(f.root, { id, stage: 'P2', owner: 'controller/scenes', unit: 'unit.json' });
  const route = catalog.preview(value, 'dsh_native', 'implementation').route;
  const claimed = runtime.reserve(f.root, { id, owner: 'worker/scenes', route, team: { enabled: true, mode: 'subagent' } }, 'session');
  assert.equal(claimed.result.action, 'claimed');
  assert.equal(claimed.result.request.dsh_children.scenes[0].scenario, 'review');
  assert.equal(claimed.result.request.dsh_children.scenes[0].route.model, 'known-dsh');
  value.models.deepseek_main.model = 'edited-after-claim'; fs.writeFileSync(f.file, JSON.stringify(value));
  const held = JSON.parse(fs.readFileSync(path.join(f.root, '_plan/autopilot', id, 'window.json'), 'utf8'));
  assert.equal(held.request.dsh_children.scenes[0].route.model, 'known-dsh');
});

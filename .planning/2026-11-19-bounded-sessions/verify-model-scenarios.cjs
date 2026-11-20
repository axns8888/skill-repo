'use strict';
// Compose local DSH configuration only. Do not start inference or retain profile dumps.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const scripts = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../../skills/axns-devflow-ext-autopilot/scripts');
const dsh = require(path.join(scripts, 'dsh-session.cjs'));
const catalog = require(path.join(scripts, 'lib/model-config.cjs'));
const cli = require(path.join(scripts, 'model-config.cjs'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'axns-model-scenarios-'));
const root = path.join(temp, 'project'), personal = path.join(temp, 'models.json');
const id = '20261120-model-scenarios';
function put(name, value) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
const source = fs.readFileSync(path.resolve(__dirname, '../../model-routing.json'), 'utf8');
const doc = catalog.parse(source), cases = [];
put('AGENTS.md', 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
put('_plan/prompts/autopilot.json', { version: 1, model_config_file: personal });
put('_plan/process/' + id + '/prompt.md', 'Prepare one bounded task. Do not run inference.\n');
for (const [preset, scenario] of [['deepseek_only', 'documentation'], ['dsh_team', 'implementation'], ['dsh_native', 'implementation']]) {
  fs.writeFileSync(personal, JSON.stringify({ ...doc, active_preset: preset }));
  put('_plan/process/' + id + '/unit.json', { id: 'inspect-config', goal: 'Inspect one configuration',
    inputs: [], write_scope: [], done_when: ['Configuration verified'], stop_when: ['After inspection'],
    budget: { max_steps: 4, max_minutes: 5 }, launch: { scenario } });
  const preview = cli.execute(cli.options(['preview', '--file', personal, '--scenario', scenario]));
  const result = dsh.prepare({ project: root, id, stage: 'P2', profile: 'headless',
    'dsh-bin': 'D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js', 'prompt-file': 'prompt.md', unit: 'unit.json' });
  assert.equal(result.manifest.preset, preset); assert.equal(result.manifest.scenario, scenario);
  assert.deepEqual(result.manifest.route, preview.route); assert.deepEqual(result.manifest.team, preview.team);
  cases.push({ preset, scenario, route: result.manifest.route, team: result.manifest.team,
    verification: result.manifest.verification, directory: result.directory, inference_started: false });
}
assert.equal(fs.readFileSync(path.resolve(__dirname, '../../model-routing.json'), 'utf8'), source);
const proof = { checked_at: new Date().toISOString(), scripts, project: root, cases,
  personal_source_unchanged: true, dsh_automatic_handoff_supported: true, real_dsh_handoff_verified: false };
const installed = !!process.argv[2];
fs.writeFileSync(path.join(__dirname, installed ? 'model-scenarios-installed-proof.json' : 'model-scenarios-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ cases: cases.length, installed, verification: 'composed_config_only', inference_started: false }));

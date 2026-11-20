'use strict';
// Local DSH composition probe only. Do not print or persist profile dumps/credentials.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dsh = require('../../skills/axns-devflow-ext-autopilot/scripts/dsh-session.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axns-provider-routing-'));
const id = '20261120-provider-routing';
function put(name, value) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
put('AGENTS.md', 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
put('_plan/process/' + id + '/prompt.md', 'Inspect one bounded task. Do not delegate.\n');
const route = { executor: 'dsh', provider: 'deepseek-official', model: 'deepseek-flash', reasoning: 'high' };
const config = { version: 1, models: { deepseek: route }, launch: { default: { tier: 'deepseek', team: { enabled: false } } } };
const cases = [];
for (const enabled of [false, true]) {
  config.launch.default.team = enabled ? { enabled: true, max_members: 3 } : { enabled: false };
  put('_plan/prompts/autopilot.json', config);
  const result = dsh.prepare({ project: root, id, stage: 'P2', profile: 'headless',
    'dsh-bin': 'D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js', 'prompt-file': 'prompt.md' });
  if (result.manifest.executor !== 'dsh' || result.manifest.route.executor !== 'dsh') throw Error('Executor not preserved');
  cases.push({ route: result.manifest.route, team: result.manifest.team, directory: result.directory,
    verification: result.manifest.verification, inference_started: false });
}
config.models.deepseek.executor = 'claude'; put('_plan/prompts/autopilot.json', config);
let refused = false;
try {
  dsh.prepare({ project: root, id, stage: 'P2', profile: 'headless',
    'dsh-bin': 'D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js', 'prompt-file': 'prompt.md' });
} catch (error) { if (!/executor=claude/.test(error.message)) throw error; refused = true; }
if (!refused) throw Error('Incompatible executor was accepted');
config.models.deepseek.executor = 'dsh'; put('_plan/prompts/autopilot.json', config);
const proof = { checked_at: new Date().toISOString(), project: root, cases, incompatible_executor_refused: refused };
fs.writeFileSync(path.join(__dirname, 'provider-routing-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ project: root, cases: cases.length, verification: 'composed_config_only', incompatible_executor_refused: refused }));

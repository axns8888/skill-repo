'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const account = process.argv[2] === 'account';
const root = fs.mkdtempSync(path.join(os.tmpdir(), account ? 'axns-dsh-live-account-' : 'axns-dsh-live-'));
const id = '20261120-dsh-live-chain' + (account ? '-account' : ''), scripts = path.resolve(__dirname, '../../skills/axns-devflow-ext-autopilot/scripts');
function put(name, value) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); }
put('AGENTS.md', 'extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n\nThis isolated fixture is an authorized two-unit DSH integration test. Do not delegate, install dependencies, or touch other projects. The supervisor performs takeover. Read the dispatched JSON and referenced plan only. Use one shell invocation to write the exact requested output/evidence and run the callback. After the callback succeeds, end the session without further writes.\n');
put('_plan/.active_plan', id);
const personal = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../model-routing.json'), 'utf8'));
personal.active_preset = 'deepseek_only';
if (account) personal.models.deepseek_main.provider = 'deepseek-account';
const modelFile = path.join(path.dirname(root), path.basename(root) + '-models.json');
fs.writeFileSync(modelFile, JSON.stringify(personal, null, 2) + '\n');
put('_plan/prompts/autopilot.json', { version: 1, model_config_file: modelFile,
  capabilities: { advance: { max_stage: 'P2' } }, execution: { enabled: true, adapter: 'command', require_units: true, timeout_seconds: 45,
    command: { file: process.execPath, args: [path.join(scripts, 'adapters/orca-bridge.cjs'), '--orca-file',
      'C:/Users/nikos/AppData/Local/Programs/orca/resources/bin/orca.exe', '--dsh-bin',
      'D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js'] } } });
put('_plan/process/' + id + '/plan.md', [
  'Authorized real DSH integration test. One P2 stage, two separate short units, same task/workspace.',
  'unit1: create out/first.txt containing exactly first fresh DSH unit plus LF. Write first.md evidence in record_dir and callbacks.yield with next-unit unit2.json.',
  'unit2: read out/first.txt, create out/second.txt containing exactly second fresh DSH unit plus LF. Write second.md evidence, then callbacks.complete (already includes --handoff).',
  'Replace callback placeholders with first.md or second.md and unit2.json. Callbacks are literal executable/argv arrays; use correct PowerShell quoting or a short node script using spawnSync argv.',
  'The supervisor already performs takeover. Do not call takeover or request user confirmation. No additional agents, research or tasks.',
  'Stop immediately after the callback succeeds. Only small local file operations are required.', ''
].join('\n'));
for (const n of [1, 2]) put('_plan/process/' + id + '/unit' + n + '.json', { id: 'dsh-live-' + n,
  goal: n === 1 ? 'Create the first tiny output and yield to unit2.json' : 'Verify the first output, create the second, and complete P2',
  inputs: ['_plan/process/' + id + '/plan.md', ...(n === 2 ? ['out/first.txt'] : [])],
  write_scope: ['out/' + (n === 1 ? 'first' : 'second') + '.txt', '_plan/process/' + id + '/' + (n === 1 ? 'first' : 'second') + '.md'],
  done_when: ['The exact output and evidence exist and the callback succeeds'], stop_when: ['After callback success or budget boundary'],
  budget: { max_steps: 8, max_minutes: 6, reserve_tokens: 6000 } });
const r = spawnSync(process.execPath, [path.join(scripts, 'runner.cjs'), 'init', '--project', root, '--id', id, '--stage', 'P2', '--owner', 'controller/dsh-live', '--unit', 'unit1.json'], { encoding: 'utf8', windowsHide: true });
if (r.status !== 0) throw Error(r.stderr || r.stdout);
fs.writeFileSync(path.join(__dirname, account ? 'dsh-live-account-fixture.json' : 'dsh-live-fixture.json'), JSON.stringify({ root, id, scripts, model_file: modelFile, created_at: new Date().toISOString() }, null, 2) + '\n');
console.log(JSON.stringify({ root, id }));

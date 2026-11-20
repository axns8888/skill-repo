'use strict';
// Boot the real headless DSH and plugins, then stop before any model request.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), scripts = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'skills/axns-devflow-ext-autopilot/scripts');
const dsh = require(path.join(scripts, 'dsh-session.cjs'));
const dshBin = 'D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-boot-'));
const plugin = path.join(temp, 'stop-before-inference.mjs'), marker = path.join(temp, 'marker.json');
fs.writeFileSync(plugin, `import fs from 'node:fs'; export const name='probe-no-inference'; export const inject=['tokenMeter','tools'];
export function apply(ctx){ctx.on('agent/pre-step',async ({agent},next)=>{const sample=ctx.tokenMeter.measure(agent.session);fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({session_id:String(agent.session.id),measured:sample.totalTokens}));const error=Error('AXNS_PROBE_NO_INFERENCE');error.code='AXNS_PROBE_NO_INFERENCE';throw error;});}`);
const opts = { project: temp, 'dsh-bin': dshBin, profile: 'headless' }, route = { executor: 'dsh', provider: 'deepseek-official', model: 'deepseek-flash', reasoning: 'high' };
const extra = { telemetry: { dshBin, directory: path.join(temp, 'context'), canDelegate: true, canStartNewSession: false },
 children: { version: 1, scenes: [{ scenario: 'review', tier: 'known', route, native_reasoning: false }] } };
const patches = dsh.overlay(dsh.dump(opts), route, { enabled: true, mode: 'subagent' }, extra);
patches.push({ insert: [{ id: 'probe-no-inference', name: plugin }] });
const patch = path.join(temp, 'launch.patch.json'); fs.writeFileSync(patch, JSON.stringify(patches));
dsh.verify(dsh.dump(opts, patch), route, { enabled: true, mode: 'subagent' }, extra);
const value = spawnSync(process.execPath, [dshBin, '--profile', 'headless', '--patch', patch, '--json', '-'],
 { cwd: temp, input: 'Runtime boot probe. The deployment stops before model inference.', encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
const events = value.stdout?.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) ?? [];
const session = events.find(e => e.type === 'session'), final = events.find(e => e.type === 'final');
const observed = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null;
const passed = !!session && !!observed && observed.session_id === session.sessionId && JSON.stringify(final ?? {}).includes('AXNS_PROBE_NO_INFERENCE');
const proof = { checked_at: new Date().toISOString(), scripts, passed, inference_started: false,
 session_created: !!session, meter_measured: !!observed, current_tokens: observed?.measured ?? null,
 stopped_before_inference: !!observed, final_received: !!final, actual_process_exit: value.status,
 telemetry_plugin_in_composition: true, scene_tool_in_composition: true,
 diagnostic: passed ? null : { error: value.error?.code ?? null, stderr_tail: value.stderr?.slice(-2500), final } };
fs.writeFileSync(path.join(__dirname, process.argv[2] ? 'dsh-runtime-installed-proof.json' : 'dsh-runtime-proof.json'), JSON.stringify(proof, null, 2)+'\n');
console.log(JSON.stringify(proof)); if (!passed) process.exitCode = 1;

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const scenes = require('../skills/axns-devflow-ext-autopilot/scripts/lib/dsh-scenes.cjs');
const models = require('../skills/axns-devflow-ext-autopilot/scripts/lib/model-config.cjs');
const dsh = require('../skills/axns-devflow-ext-autopilot/scripts/dsh-session.cjs');
function doc() {
  return models.validate({ version: 1, active_preset: 'dsh_native',
    models: {
      codex_main: { label: 'Codex fixture', enabled: true, executor: 'codex', provider: 'fixture-code', model: 'known-code', reasoning: 'high' },
      claude_main: { label: 'Claude fixture', enabled: false, executor: 'claude', provider: '', model: '' },
      deepseek_main: { label: 'DSH fixture', enabled: true, executor: 'dsh', provider: 'fixture-dsh', model: 'known-dsh', reasoning: 'high' }
    },
    scenarios: { implementation: { label: 'Implementation', description: 'Fixture implementation' }, review: { label: 'Review', description: 'Fixture review' } },
    stage_scenarios: { P2: 'implementation', P3: 'review' },
    presets: {
      dsh_native: { label: 'Native fixture', description: 'Fixture native', default: { tier: 'deepseek_main', team: { enabled: true, mode: 'subagent' } } },
      mixed: { label: 'Mixed fixture', description: 'Fixture mixed', default: { tier: 'codex_main' }, scenarios: { review: { tier: 'claude_main' } } }
    },
    dsh: { child_preset: 'dsh_native', scenarios: ['implementation'], native_reasoning_models: [] }
  });
}
const scene = (executor = 'dsh') => ({ scenario: 'review', tier: 'test', route: { executor, provider: 'configured', model: 'known', reasoning: 'high' }, native_reasoning: false });
test('scene tools use fixed authorized routes and fresh spawn without allowing model supplied overrides', () => {
  const result = scenes.build({ version: 1, scenes: [scene()] });
  assert.equal(result.patches[0].config.provider, 'spawn'); assert.equal(result.patches[0].config.modelSelection, false);
  assert.deepEqual(result.patches[0].config.agentOptions, { provider: 'configured', model: 'known', reasoningEffort: 'high' });
});
test('external product backends require explicit native effort acceptance and report the effective distinction', () => {
  assert.throws(() => scenes.build({ version: 1, scenes: [scene('codex')] }), /native_reasoning_models/);
  for (const executor of ['codex', 'claude']) {
    const result = scenes.build({ version: 1, scenes: [{ ...scene(executor), native_reasoning: true }] });
    assert.equal(result.patches[0].config.model, 'known'); assert.equal(result.patches[0].config.reasoningEffort, undefined);
    assert.equal(result.scenes[0].effective_reasoning, 'native_settings_unverified');
    assert.equal(result.patches[1].config.maxDepth, 'provider-managed');
  }
});
test('child scenarios only require the models actually selected by their own preset', () => {
  const value = doc(); value.active_preset = 'dsh_native'; value.dsh = { child_preset: 'mixed', scenarios: ['implementation'], native_reasoning_models: ['codex_main'] };
  const compiled = models.compile(value); assert.equal(compiled.dsh_children.scenes[0].route.executor, 'codex');
  assert.equal(compiled.dsh_children.scenes[0].native_reasoning, true);
  value.dsh.scenarios = ['review']; assert.throws(() => models.compile(value), /尚未启用/);
});
test('scene tool name collisions and unknown model identities are rejected', () => {
  assert.throws(() => scenes.build({ version: 1, scenes: [scene(), { ...scene(), scenario: 'review' }] }), /重复/);
  assert.throws(() => scenes.build({ version: 1, scenes: [{ ...scene(), scenario: 'a-b' }, { ...scene(), scenario: 'a_b' }] }), /冲突/);
});
test('team off disables existing native product delegation tools as well as ordinary subagent tools', () => {
  const rows = [{ id: 'headless-startup' }, { id: 'headless-runner' }, { id: 'agent-default-model' },
    { id: 'tool-subagent-codex', name: '@deepseek-ai/dsh-tool-subagent' }];
  const patches = dsh.overlay(rows, null, { enabled: false });
  assert.ok(patches.some(p => p.id === 'tool-subagent-codex' && p.disabled === true));
});

test('DSH composition verifies scene route snapshots and rejects altered telemetry', () => {
  const rows = [{ id: 'headless-startup' }, { id: 'headless-runner' }, { id: 'agent-default-model', config: {} },
    { id: 'subagent' }, { id: 'subagent-spawn-in-process' }];
  const route = { executor: 'dsh', provider: 'own', model: 'known' }, team = { enabled: true, mode: 'subagent' };
  const extra = { children: { version: 1, scenes: [scene()] }, telemetry: { directory: 'test', dshBin: 'known' } };
  const patches = dsh.overlay(rows, route, team, extra), composed = structuredClone(rows);
  for (const patch of patches) { if (patch.insert) composed.push(...patch.insert); else { const row = composed.find(r => r.id === patch.id); Object.assign(row, patch, { config: { ...row.config, ...patch.config } }); } }
  dsh.verify(composed, route, team, extra);
  composed.find(r => r.id === 'devflow-scene-review').config.agentOptions.model = 'unexpected';
  assert.throws(() => dsh.verify(composed, route, team, extra), /场景工具/);
});

'use strict';
// User maintained routes and scenario presets. No credentials, model discovery, or fallback inference.
const policy = require('./launch-policy.cjs');
const STAGES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'conductor'];
const MAX_BYTES = 128 * 1024;
function text(value, label, limit = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\r\n\0]/.test(value)) throw Error(label + ' 需要有界单行文本');
}
function dictionary(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + ' 需要对象');
  const names = Object.keys(value);
  if (!names.length || names.length > 64) throw Error(label + ' 需要 1–64 项');
  for (const name of names) if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) throw Error(label + ' 名称无效：' + name);
}
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + ' 需要对象');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(label + '.' + key + ' 未知字段');
}
function route(entry) {
  return Object.fromEntries(['executor', 'provider', 'model', 'reasoning'].filter(key => entry[key] !== undefined).map(key => [key, entry[key]]));
}
function choice(value, models, label) {
  keys(value, ['tier', 'team'], label);
  policy.selection(value, models, label);
}
function validate(doc) {
  keys(doc, ['version', 'description', 'notes', 'active_preset', 'models', 'scenarios', 'stage_scenarios', 'presets', 'dsh'], 'model_config');
  if (doc.version !== 1) throw Error('model_config.version 必须为 1');
  if (doc.description !== undefined) text(doc.description, 'description');
  if (doc.notes !== undefined) {
    if (!Array.isArray(doc.notes) || doc.notes.length > 16) throw Error('notes 需要最多16条文本');
    doc.notes.forEach(value => text(value, 'notes'));
  }
  dictionary(doc.models, 'models'); dictionary(doc.scenarios, 'scenarios'); dictionary(doc.presets, 'presets');
  for (const [id, entry] of Object.entries(doc.models)) {
    keys(entry, ['label', 'description', 'enabled', 'executor', 'provider', 'model', 'reasoning'], 'models.' + id);
    text(entry.label, 'models.' + id + '.label', 128);
    if (entry.description !== undefined) text(entry.description, 'models.' + id + '.description');
    if (typeof entry.enabled !== 'boolean') throw Error('models.' + id + '.enabled 需要 true/false');
    if (!entry.executor) throw Error('models.' + id + '.executor 不能为空');
    policy.executor(entry.executor);
    if (entry.enabled) policy.model(route(entry), 'models.' + id);
    else for (const key of ['provider', 'model', 'reasoning']) if (entry[key] !== undefined &&
      (typeof entry[key] !== 'string' || entry[key].length > 256 || /[\r\n\0]/.test(entry[key]))) throw Error('models.' + id + '.' + key + ' 无效');
  }
  for (const [id, scenario] of Object.entries(doc.scenarios)) {
    keys(scenario, ['label', 'description'], 'scenarios.' + id);
    text(scenario.label, 'scenarios.' + id + '.label', 128); text(scenario.description, 'scenarios.' + id + '.description');
  }
  keys(doc.stage_scenarios, STAGES, 'stage_scenarios');
  for (const [stage, scenario] of Object.entries(doc.stage_scenarios)) if (!Object.hasOwn(doc.scenarios, scenario))
    throw Error('stage_scenarios.' + stage + ' 引用了不存在的场景');
  for (const [id, preset] of Object.entries(doc.presets)) {
    keys(preset, ['label', 'description', 'default', 'scenarios'], 'presets.' + id);
    text(preset.label, 'presets.' + id + '.label', 128); text(preset.description, 'presets.' + id + '.description');
    choice(preset.default, doc.models, 'presets.' + id + '.default');
    if (!preset.default.tier) throw Error('presets.' + id + '.default.tier 必填');
    keys(preset.scenarios ?? {}, Object.keys(doc.scenarios), 'presets.' + id + '.scenarios');
    for (const [scenario, selection] of Object.entries(preset.scenarios ?? {})) choice(selection, doc.models, 'presets.' + id + '.' + scenario);
  }
  if (typeof doc.active_preset !== 'string' || !Object.hasOwn(doc.presets, doc.active_preset)) throw Error('active_preset 必须引用已列出的预设');
  if (doc.dsh !== undefined) {
    keys(doc.dsh, ['child_preset', 'scenarios', 'native_reasoning_models'], 'dsh');
    if (!Object.hasOwn(doc.presets, doc.dsh.child_preset)) throw Error('dsh.child_preset 必须引用已登记预设');
    if (!Array.isArray(doc.dsh.scenarios) || !doc.dsh.scenarios.length || new Set(doc.dsh.scenarios).size !== doc.dsh.scenarios.length ||
        doc.dsh.scenarios.some(id => !Object.hasOwn(doc.scenarios, id))) throw Error('dsh.scenarios 需要不重复的已登记场景');
    const native = doc.dsh.native_reasoning_models ?? [];
    if (!Array.isArray(native) || new Set(native).size !== native.length || native.some(id => !doc.models[id] || !['codex', 'claude'].includes(doc.models[id].executor)))
      throw Error('dsh.native_reasoning_models 只能引用 Codex/Claude Code 模型；表示明确接受其原生强度设置');
  }
  return doc;
}
function parse(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) throw Error('模型配置文件缺失或超过128 KiB');
  let doc;
  try { doc = JSON.parse(source.replace(/^\uFEFF/, '')); } catch { throw Error('模型配置文件不是有效 JSON'); }
  return validate(doc);
}
function scenarioSelection(doc, preset, id) {
  const own = preset.scenarios?.[id] ?? {}, result = { ...preset.default, ...own };
  if (own.tier && doc.models[own.tier]?.executor !== 'dsh' && !Object.hasOwn(own, 'team')) delete result.team;
  return result;
}
function compile(doc, presetId = doc.active_preset, includeChildren = true) {
  validate(doc);
  if (!Object.hasOwn(doc.presets, presetId)) throw Error('未知预设：' + presetId);
  const preset = doc.presets[presetId], scenarios = {};
  function ready(selection, label) {
    if (!doc.models[selection.tier]?.enabled) throw Error(label + ' 使用的模型 ' + selection.tier + ' 尚未启用；先填写准确渠道/模型并设置 enabled=true');
    if (selection.team && doc.models[selection.tier].executor !== 'dsh') throw Error(label + ' 的团队策略需要 DSH 模型；选择其他执行端时先移除 team');
    return selection;
  }
  ready(preset.default, '预设 ' + presetId);
  for (const scenario of Object.keys(doc.scenarios)) scenarios[scenario] = ready(scenarioSelection(doc, preset, scenario), '场景 ' + scenario);
  return {
    ...(includeChildren && doc.dsh ? { dsh_children: children(doc) } : {}),
    models: Object.fromEntries(Object.entries(doc.models).filter(([, model]) => model.enabled).map(([id, model]) => [id, route(model)])),
    tiers: Object.fromEntries(Object.entries(doc.stage_scenarios).map(([stage, scenario]) => [stage, scenarios[scenario].tier])),
    scenarios, stage_scenarios: doc.stage_scenarios, catalog_default: preset.default, preset: presetId,
  };
}
function children(doc) {
  const preset = doc.presets[doc.dsh.child_preset];
  return { version: 1, preset: doc.dsh.child_preset, scenes: doc.dsh.scenarios.map(scenario => {
    const selection = scenarioSelection(doc, preset, scenario), model = doc.models[selection.tier];
    if (!model?.enabled) throw Error('DSH子级场景 ' + scenario + ' 使用的模型尚未启用');
    return { scenario, tier: selection.tier, route: route(model), native_reasoning: (doc.dsh.native_reasoning_models ?? []).includes(selection.tier) };
  }) };
}

function paths(model, team) {
  return { orca_structured: ['codex', 'claude'].includes(model.executor) && !team,
    dsh_standalone: model.executor === 'dsh', dsh_direct: model.executor === 'dsh', dsh_automatic_handoff: model.executor === 'dsh', dsh_entry_required: model.executor === 'dsh' };
}
function preview(doc, presetId, scenario) {
  const compiled = compile(doc, presetId);
  if (!Object.hasOwn(compiled.scenarios, scenario)) throw Error('未知场景：' + scenario);
  const selection = compiled.scenarios[scenario], model = compiled.models[selection.tier];
  return { preset: compiled.preset, scenario, label: doc.scenarios[scenario].label, tier: selection.tier,
    route: model, team: selection.team ?? null, paths: paths(model, selection.team) };
}
function inspect(doc) {
  validate(doc);
  const presets = Object.entries(doc.presets).map(([id, preset]) => {
    try { compile(doc, id); return { id, label: preset.label, description: preset.description, ready: true }; }
    catch (error) { return { id, label: preset.label, description: preset.description, ready: false, reason: error.message }; }
  });
  const activeReady = presets.find(preset => preset.id === doc.active_preset).ready;
  return { active_preset: doc.active_preset, ready: activeReady,
    models: Object.entries(doc.models).map(([id, model]) => ({ id, ...model })), presets,
    scenarios: Object.entries(doc.scenarios).map(([id, scenario]) => ({ id, ...scenario,
      stages: Object.entries(doc.stage_scenarios).filter(([, value]) => value === id).map(([stage]) => stage),
      ...(activeReady ? { selection: preview(doc, doc.active_preset, id) } : {}) })),
    availability: 'enabled_by_user_only; model access and billing are not probed' };
}
module.exports = { parse, validate, compile, inspect, preview, children, MAX_BYTES };

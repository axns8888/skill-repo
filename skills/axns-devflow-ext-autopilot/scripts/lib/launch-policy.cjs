'use strict';
// Known user routes only. No model catalog, network discovery, or fallback substitution.
function executor(value) {
  if (value !== undefined && !['codex', 'claude', 'dsh'].includes(value)) throw Error('executor 需要 codex、claude 或 dsh');
  return value;
}
function routeMatches(route, actual) {
  return !route || !!actual && route.provider === actual.provider && route.model === actual.model &&
    (!route.reasoning || route.reasoning === actual.reasoning) &&
    (!route.executor || route.executor === actual.executor);
}
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + ' 必须为对象');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(label + '.' + key + ' 未知字段');
}
function model(value, label = 'model') {
  keys(value, ['executor', 'provider', 'model', 'reasoning'], label);
  executor(value.executor);
  for (const key of ['provider', 'model']) if (typeof value[key] !== 'string' || !value[key].trim() || /[<>]/.test(value[key]))
    throw Error(label + '.' + key + ' 必须为实际路由');
  for (const key of ['provider', 'model', 'reasoning']) if (value[key] !== undefined &&
      (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 256 || /[\r\n\0]/.test(value[key])))
    throw Error(label + '.' + key + ' 无效');
  return value;
}
function selection(value, models, label = 'launch', scenarios = {}) {
  keys(value, ['tier', 'scenario', 'team'], label);
  if (value.tier !== undefined && value.scenario !== undefined) throw Error(label + ' 的 tier/scenario 只能选择一个');
  if (value.scenario !== undefined && (typeof value.scenario !== 'string' || !Object.hasOwn(scenarios, value.scenario)))
    throw Error(label + '.scenario 必须引用独立模型文件中的场景');
  if (value.tier !== undefined && (typeof value.tier !== 'string' || !Object.hasOwn(models, value.tier)))
    throw Error(label + '.tier 必须引用已配置模型档位');
  if (value.team !== undefined) {
    keys(value.team, ['enabled', 'max_members', 'mode', 'worktree'], label + '.team');
    if (value.team.worktree !== undefined && typeof value.team.worktree !== 'boolean') throw Error(label + '.team.worktree 必须为布尔值');
    if (typeof value.team.enabled !== 'boolean') throw Error(label + '.team.enabled 必须为布尔值');
    if (value.team.mode !== undefined && (!value.team.enabled || !['subagent', 'team'].includes(value.team.mode)))
      throw Error(label + '.team.mode 仅在启用时允许 subagent/team');
    if (value.team.mode === 'subagent' && value.team.max_members !== undefined)
      throw Error(label + '.team.max_members 仅实验性Team支持，普通subagent不伪造人数门禁');
    if (value.team.max_members !== undefined && (!Number.isSafeInteger(value.team.max_members) ||
        value.team.max_members < 1 || value.team.max_members > 32 || !value.team.enabled))
      throw Error(label + '.team.max_members 仅在启用时允许 1–32 的整数（含 leader）');
  }
  return value;
}
function config(value, models, validateId, scenarios = {}) {
  keys(value, ['default', 'tasks'], 'launch');
  const defaults = selection(value.default ?? {}, models, 'launch.default', scenarios), tasks = value.tasks ?? {};
  keys(tasks, Object.keys(tasks), 'launch.tasks');
  for (const [id, item] of Object.entries(tasks)) { validateId(id); selection(item, models, 'launch.tasks.' + id, scenarios); }
  return { default: defaults, tasks };
}
function resolve(cfg, id, stage, unit) {
  const scenarios = cfg.scenarios ?? {};
  const expand = value => ({ ...(value.scenario ? scenarios[value.scenario] : {}), ...value });
  const defaultsRaw = cfg.launch.default, taskRaw = cfg.launch.tasks[id] ?? {};
  const ownRaw = selection(unit?.launch ?? {}, cfg.models, 'unit.launch', scenarios);
  const defaults = expand(defaultsRaw), task = expand(taskRaw), own = expand(ownRaw);
  const stageScenario = cfg.stage_scenarios?.[stage];
  const stageSelection = { ...(stageScenario ? scenarios[stageScenario] : {}), ...(cfg.tiers[stage] ? { tier: cfg.tiers[stage] } : {}) };
  const fallback = cfg.catalog_default ?? {};
  const chosen = own.tier ? own : task.tier ? task : stageSelection.tier ? { ...stageSelection, scenario: stageScenario } : defaults.tier ? defaults : fallback;
  const tier = cfg.caps.switch_model.enabled ? chosen.tier ?? null : null;
  const model = tier ? cfg.models[tier] ?? null : null;
  const origin = own.tier ? 'unit' : task.tier ? 'task' : stageSelection.tier ? 'stage' : 'default';
  const source = !model ? 'inherited' : origin;
  return { tier, model, model_available: !!model, route_source: source,
    team: ownRaw.team ?? (origin === 'unit' ? own.team : undefined) ??
      taskRaw.team ?? (origin === 'task' ? task.team : undefined) ??
      defaultsRaw.team ?? (origin === 'stage' ? stageSelection.team : undefined) ??
      (origin === 'default' ? defaults.team : undefined) ?? fallback.team ?? null,
    ...(cfg.model_catalog ? { preset: cfg.model_catalog.preset, scenario: chosen.scenario ?? null } : {}) };
}
function teamMatches(team, actual) {
  return !team || !!actual && team.enabled === actual.enabled &&
    (team.max_members === undefined || team.max_members === actual.max_members) &&
    (team.mode === undefined || team.mode === actual.mode) &&
    (team.worktree === undefined || team.worktree === actual.worktree);
}
module.exports = { selection, config, resolve, executor, routeMatches, teamMatches, model };

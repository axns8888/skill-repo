'use strict';
// Compile explicit file-owned routes into DSH tool instances. No invented fallback or effort support.
const policy = require('./launch-policy.cjs');
function build(snapshot) {
  if (!snapshot) return { patches: [], scenes: [] };
  if (snapshot.version !== 1 || !Array.isArray(snapshot.scenes)) throw Error('无效DSH场景快照');
  const patches = [], scenes = [], names = new Set();
  for (const scene of snapshot.scenes) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(scene.scenario) || names.has(scene.scenario)) throw Error('DSH场景名重复或无效');
    names.add(scene.scenario); policy.model(scene.route);
    const route = scene.route, tool = 'devflow_' + scene.scenario.replaceAll('-', '_'), id = 'devflow-scene-' + scene.scenario;
    if (route.executor === 'dsh') {
      patches.push({ id, name: '@deepseek-ai/dsh-tool-subagent', config: {
        provider: 'spawn', toolName: tool, modelSelection: false,
        agentOptions: { provider: route.provider, model: route.model, ...(route.reasoning ? { reasoningEffort: route.reasoning } : {}) }
      } });
      scenes.push({ ...scene, tool, effective_reasoning: route.reasoning ?? 'adapter_default', evidence: 'configured_route_requires_live_preflight' });
    } else {
      if (!['codex', 'claude'].includes(route.executor)) throw Error('DSH场景执行端不支持');
      if (route.reasoning && !scene.native_reasoning) throw Error('场景 ' + scene.scenario + ' 的 ' + route.executor + ' 后端不能逐任务设置推理强度；明确选择 native_reasoning_models 或改用支持该参数的路径');
      const provider = 'devflow-' + scene.scenario;
      patches.push({ id: id + '-backend', name: '@deepseek-ai/dsh-subagent-' + (route.executor === 'codex' ? 'codex' : 'claude-code'),
        config: { providerName: provider, model: route.model } });
      patches.push({ id, name: '@deepseek-ai/dsh-tool-subagent', config: { provider, toolName: tool, maxDepth: 'provider-managed' } });
      scenes.push({ ...scene, tool, effective_reasoning: 'native_settings_unverified',
        provider_binding: route.provider, evidence: 'native_auth_and_channel_require_verification' });
    }
  }
  if (new Set(scenes.map(s => s.tool)).size !== scenes.length) throw Error('场景工具名冲突，请调整连字符或下划线');
  return { patches, scenes };
}
module.exports = { build };

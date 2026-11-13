'use strict';
const { spawnSync } = require('node:child_process');
const { object, keys } = require('../lib/core.cjs');
// Executable + literal argv only. The bridge owns platform API/model verification and durable lookup by dispatch_id.
function invoke(execution, operation, request) {
  const { file, args } = execution.command;
  const r = spawnSync(file, args, { cwd: request.cwd, encoding: 'utf8', windowsHide: true, shell: false,
    input: JSON.stringify({ version: 1, operation, request }) + '\n',
    timeout: execution.timeout_seconds * 1000, maxBuffer: 1024 * 1024 });
  if (r.error || r.status !== 0) return { state: 'unknown', reason: r.error?.message || 'bridge_exit_' + r.status };
  try {
    const v = object(JSON.parse(r.stdout), 'adapter response');
    keys(v, ['version', 'dispatch_id', 'state', 'session_id', 'reason', 'effective_route'], 'adapter response');
    if (v.version !== 1 || v.dispatch_id !== request.dispatch_id || !['running', 'absent', 'stopped', 'unknown'].includes(v.state)) throw new Error('无效的适配器身份或状态');
    if (v.state === 'running' && (typeof v.session_id !== 'string' || !v.session_id.trim())) throw new Error('running 缺少 session_id');
    if (v.state !== 'running' && (typeof v.reason !== 'string' || !v.reason.trim())) throw new Error('缺少状态依据 reason');
    if (v.state === 'running' && request.route) {
      const route = v.effective_route;
      if (!route || route.provider !== request.route.provider || route.model !== request.route.model ||
          request.route.reasoning && route.reasoning !== request.route.reasoning) throw new Error('平台未确认所请求模型');
    }
    return v;
  } catch (e) { return { state: 'unknown', reason: e.message }; }
}
module.exports = { invoke };

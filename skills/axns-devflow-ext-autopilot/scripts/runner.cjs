#!/usr/bin/env node
'use strict';
const { randomUUID } = require('node:crypto');
const core = require('./lib/core.cjs');
const runtime = require('./lib/runtime.cjs');
const dispatch = require('./lib/dispatch.cjs');
const commands = {
  init: ['id', 'stage', 'owner'], claim: ['id', 'owner', 'provider', 'model', 'reasoning'], tick: ['id', 'owner'],
  heartbeat: ['id', 'owner', 'dispatch'], complete: ['id', 'owner', 'dispatch', 'evidence', 'handoff', 'user-confirmed', 'accepted-head', 'human-accepted-by'],
  fail: ['id', 'owner', 'dispatch', 'evidence', 'handoff'], handoff: ['id', 'owner', 'dispatch'],
  retry: ['id', 'owner', 'dispatch', 'evidence'],
  recover: ['id', 'owner', 'dispatch'], interrupt: ['id', 'owner', 'dispatch', 'evidence', 'confirmed-stopped'],
  finish: ['id'], precheck: [], automation: ['adapter', 'workspace', 'provider', 'trigger', 'name'],
};
const flags = new Set(['handoff', 'user-confirmed', 'confirmed-stopped']);
function main(argv) {
  const command = argv.shift();
  if (!Object.hasOwn(commands, command)) core.fail('未知命令：' + command);
  const opts = {};
  while (argv.length) {
    const arg = argv.shift(); const key = arg.slice(2);
    if (!arg.startsWith('--') || !['project', ...commands[command]].includes(key) || Object.hasOwn(opts, key)) core.fail('无效或重复参数：' + arg);
    if (flags.has(key)) opts[key] = true;
    else {
      if (!argv[0] || argv[0].startsWith('--')) core.fail(arg + ' 需要值');
      opts[key] = argv.shift();
    }
  }
  if (!opts.project) core.fail('必须指定 --project');
  const project = opts.project;
  if (opts.owner !== undefined) runtime.text(opts.owner, 'owner');
  if (opts.id !== undefined) core.id(opts.id);
  opts.user_confirmed = opts['user-confirmed'];
  let value;
  if (command === 'automation') {
    if (opts.adapter !== 'orca') core.fail('目前 automation 安装计划只支持 orca；DSH 使用通用 session 接入');
    value = { code: 0, result: require('./adapters/orca.cjs').plan(core.locate(project).root, opts) };
  } else if (command === 'precheck') {
    const ctx = core.context(project), assessment = core.evaluate(ctx); core.verify(ctx);
    const actionable = ctx.enabled && ctx.cfg.execution.enabled && assessment.result.decisions.some(v => ['advance', 'finish'].includes(v.action) || v.recovery_required);
    value = { code: actionable ? 0 : assessment.code || 3, result: { actionable: !!actionable, assessment: assessment.result } };
  } else if (command === 'finish') value = runtime.finalize(project, opts);
  else if (command === 'init') value = runtime.initialize(project, opts);
  else if (command === 'claim') {
    if (!!opts.provider !== !!opts.model || opts.reasoning && !opts.model) core.fail('provider/model 必须同时提供，reasoning 需要 model');
    opts.owner ||= 'session/' + randomUUID();
    opts.route = opts.model ? { provider: opts.provider, model: opts.model, ...(opts.reasoning ? { reasoning: opts.reasoning } : {}) } : null;
    value = runtime.reserve(project, opts, 'session');
  } else if (command === 'tick') value = dispatch.tick(project, opts);
  else {
    for (const key of ['id', 'owner', 'dispatch']) if (!opts[key]) core.fail('必须指定 --' + key);
    if (['complete', 'fail', 'interrupt', 'retry'].includes(command) && !opts.evidence) core.fail('必须指定 --evidence');
    if (command === 'retry') value = runtime.retry(project, opts);
    else if (command === 'recover') value = dispatch.recover(project, opts);
    else if (command === 'handoff') value = runtime.handoff(project, opts);
    else if (command === 'interrupt') {
      if (!opts['confirmed-stopped']) core.fail('先核实原会话已停止，再传 --confirmed-stopped；心跳过期不构成依据');
      value = runtime.interrupt(project, opts);
    } else value = runtime.callback(project, command, opts);
  }
  console.log(JSON.stringify(value.result, null, 2)); return value.code;
}
try {
  if (process.argv.length <= 2 || process.argv.slice(2).includes('--help')) console.log('node runner.cjs <' + Object.keys(commands).join('|') + '> --project <项目> [参数]');
  else process.exitCode = main(process.argv.slice(2));
} catch (e) { console.error(e.message); process.exitCode = 1; }

#!/usr/bin/env node
'use strict';
const { randomUUID } = require('node:crypto');
const core = require('./lib/core.cjs');
const runtime = require('./lib/runtime.cjs');
const dispatch = require('./lib/dispatch.cjs');
const continuation = require('./lib/continuation.cjs');
const commands = {
  init: ['id', 'stage', 'owner', 'unit'], prepare: ['id', 'owner', 'unit'], claim: ['id', 'owner', 'executor', 'provider', 'model', 'reasoning', 'team-enabled', 'team-max-members', 'team-mode'], tick: ['id', 'owner'],
  takeover: ['id', 'owner', 'dispatch', 'session-id', 'cwd', 'remaining-tokens'],
  yield: ['id', 'owner', 'dispatch', 'evidence', 'next-unit'],
  'resume-yield': ['id', 'owner', 'dispatch', 'evidence', 'next-unit', 'confirmed-stopped'], brief: ['id'],
  heartbeat: ['id', 'owner', 'dispatch', 'steps', 'remaining-tokens'], complete: ['id', 'owner', 'dispatch', 'evidence', 'handoff', 'user-confirmed', 'accepted-head', 'human-accepted-by'],
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
  else if (command === 'prepare') value = continuation.prepare(project, opts);
  else if (command === 'brief') value = continuation.brief(project, opts);
  else if (command === 'claim') {
    if (!!opts.provider !== !!opts.model || (opts.reasoning || opts.executor) && !opts.model) core.fail('provider/model 必须同时提供，reasoning/executor 需要 model');
    require('./lib/launch-policy.cjs').executor(opts.executor);
    opts.owner ||= 'session/' + randomUUID();
    opts.route = opts.model ? { provider: opts.provider, model: opts.model, ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
      ...(opts.executor ? { executor: opts.executor } : {}) } : null;
    if (opts['team-enabled'] !== undefined) {
      if (!['true', 'false'].includes(opts['team-enabled'])) core.fail('--team-enabled 需要 true 或 false');
      opts.team = { enabled: opts['team-enabled'] === 'true', ...(opts['team-max-members'] !== undefined ? { max_members: Number(opts['team-max-members']) } : {}) };
      if (opts['team-mode'] !== undefined) opts.team.mode = opts['team-mode'];
      require('./lib/launch-policy.cjs').selection({ team: opts.team }, {});
    } else if (opts['team-max-members'] !== undefined || opts['team-mode'] !== undefined) core.fail('团队参数需要 --team-enabled true');
    value = runtime.reserve(project, opts, 'session');
  } else if (command === 'tick') value = dispatch.tick(project, opts);
  else {
    for (const key of ['id', 'owner', 'dispatch']) if (!opts[key]) core.fail('必须指定 --' + key);
    if (['complete', 'fail', 'interrupt', 'retry', 'yield', 'resume-yield'].includes(command) && !opts.evidence) core.fail('必须指定 --evidence');
    if (command === 'takeover') value = continuation.takeover(project, opts);
    else if (['yield', 'resume-yield'].includes(command)) {
      if (command === 'resume-yield' && !opts['confirmed-stopped']) core.fail('先核实原会话停止，再传 --confirmed-stopped；上下文溢出不构成停止证明');
      if (!opts['next-unit']) core.fail('yield 必须指定 --next-unit');
      value = continuation.yieldUnit(project, opts);
    } else if (command === 'retry') value = runtime.retry(project, opts);
    else if (command === 'recover') value = dispatch.recover(project, opts);
    else if (command === 'handoff') value = runtime.handoff(project, opts);
    else if (command === 'interrupt') {
      if (!opts['confirmed-stopped']) core.fail('先核实原会话已停止，再传 --confirmed-stopped；心跳过期不构成依据');
      value = runtime.interrupt(project, opts);
    } else value = runtime.callback(project, command, opts);
  }
  console.log(JSON.stringify(value.result, null, 2)); return value.code;
}
async function entry(argv) {
  if (!argv.length || argv.includes('--help')) { console.log('node runner.cjs <' + Object.keys(commands).join('|') + '> --project <项目> [参数]'); return 0; }
  const callback = ['takeover', 'yield', 'resume-yield', 'heartbeat', 'complete', 'fail', 'handoff'].includes(argv[0]);
  for (let attempt = 0; ; attempt++) {
    try { return main([...argv]); }
    catch (error) {
      if (!callback || attempt >= 19 || !['AXNS_COORDINATION_BUSY', 'AXNS_OBSERVATION_CHANGED'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
entry(process.argv.slice(2)).then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });

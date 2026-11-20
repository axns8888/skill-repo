#!/usr/bin/env node
'use strict';
// Direct-only entry over the shared finite controller. Never silently choose Orca.
const fs = require('node:fs'), path = require('node:path');
const core = require('./lib/core.cjs'), controller = require('./orca-controller.cjs');
function assertDirect(project) {
  const ctx = core.context(project), first = ctx.cfg.execution.command?.args?.[0];
  if (!first || fs.realpathSync(first) !== fs.realpathSync(path.resolve(__dirname, 'adapters/dsh-bridge.cjs')))
    throw Error('dsh-controller 只接受直接DSH适配器；请先配置 adapters/dsh-bridge.cjs，避免误用 Orca');
}
function step(project, id, allowLaunch = true) { assertDirect(project); return controller.step(project, id, allowLaunch); }
function run(opts, emit) { assertDirect(opts.project); return controller.run(opts, emit); }
if (require.main === module) {
  if (process.argv.includes('--help')) console.log('node dsh-controller.cjs --project <项目> --id <task-id> [--watch --interval-ms 2000 --max-cycles 120 --max-launches 4]；项目command须选择adapters/dsh-bridge.cjs');
  else Promise.resolve().then(() => run(controller.options(process.argv.slice(2))))
    .then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { step, run, options: controller.options, assertDirect };

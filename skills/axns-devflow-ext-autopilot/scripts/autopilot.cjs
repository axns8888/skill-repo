#!/usr/bin/env node
'use strict';
// Read-only entry point. Execution is separately enabled through runner.cjs.
const { context, evaluate, verify, fail } = require('./lib/core.cjs');
function main(argv) {
  const command = argv.shift(); const opts = {};
  while (argv.length) {
    const key = argv.shift();
    if (!['--project', '--json'].includes(key) || Object.hasOwn(opts, key)) fail('无效或重复参数：' + key);
    if (key === '--json') opts[key] = true;
    else { if (!argv[0] || argv[0].startsWith('--')) fail(key + ' 需要值'); opts[key] = argv.shift(); }
  }
  if (!['status', 'decide'].includes(command) || !opts['--project']) fail('用法：autopilot.cjs <status|decide> --project <项目> [--json]');
  const ctx = context(opts['--project']);
  const { code, result } = evaluate(ctx, command); verify(ctx);
  console.log(JSON.stringify(result, null, 2)); return code;
}
try {
  if (process.argv.length <= 2 || process.argv.slice(2).includes('--help')) console.log('node autopilot.cjs <status|decide> --project <项目或任务 worktree> [--json]');
  else process.exitCode = main(process.argv.slice(2));
} catch (e) { console.error(e.message); process.exitCode = 1; }

#!/usr/bin/env node
'use strict';
const models = require('./lib/model-project.cjs');
function options(argv) {
  const command = argv.shift();
  if (!['show', 'init'].includes(command)) throw Error('用法：project-models.cjs show|init --project-root <项目> [--from <已有默认表>] [--dry-run]');
  const result = { command };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--dry-run') result.dryRun = true;
    else if (['--project-root', '--from'].includes(flag)) {
      const value = argv.shift(); if (!value || value.startsWith('--')) throw Error(flag + '需要值');
      const key = flag === '--from' ? 'from' : 'root'; if (result[key]) throw Error('重复参数：' + flag); result[key] = value;
    } else throw Error('未知参数：' + flag);
  }
  if (!result.root) throw Error('需要--project-root');
  if (command === 'show' && (result.from || result.dryRun)) throw Error('show不支持--from/--dry-run');
  return result;
}
if (require.main === module) {
  try { const opts = options(process.argv.slice(2)); console.log(JSON.stringify(opts.command === 'init' ? models.initialize(opts.root, opts.from, opts.dryRun) : models.discover(opts.root), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { options };

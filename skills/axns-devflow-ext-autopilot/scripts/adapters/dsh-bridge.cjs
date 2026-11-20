#!/usr/bin/env node
'use strict';
// Direct, supervised DSH. Persist intent before spawn; missing acknowledgement is query-only.
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const core = require('../lib/core.cjs'), runtime = require('../lib/runtime.cjs');
const dsh = require('../lib/dsh-bridge.cjs'), units = require('../lib/units.cjs');
const { acquire } = require('../lib/process-lock.cjs');
function options(argv) {
  const result = { platform: 'dsh', dshProfile: 'headless' }, seen = new Set();
  while (argv.length) {
    const flag = argv.shift(), value = argv.shift();
    if (!value || seen.has(flag) || !['--dsh-bin', '--dsh-profile'].includes(flag)) throw Error('需要 --dsh-bin <本机DSH入口> [--dsh-profile headless]');
    seen.add(flag);
    if (flag === '--dsh-bin') result.dshBin = fs.realpathSync(value);
    else { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw Error('无效DSH profile'); result.dshProfile = value; }
  }
  if (!result.dshBin) throw Error('必须指定 --dsh-bin');
  return result;
}
function unsupported(request, opts) {
  if (request.route?.executor !== 'dsh') return 'direct_dsh_requires_dsh_root_route';
  return opts.dshBin ? null : 'dsh_entry_required';
}
function handle(payload, opts) {
  const request = payload.request;
  if (payload.version !== 1 || !['start', 'query'].includes(payload.operation) || !request) throw Error('无效DSH桥请求');
  core.id(request.task_id);
  if (!/^[a-f0-9]{64}$/.test(request.dispatch_id)) throw Error('无效dispatch_id');
  const response = value => ({ version: 1, dispatch_id: request.dispatch_id, ...value });
  const ctx = core.context(request.project), task = runtime.task(ctx, request.task_id);
  runtime.writable(ctx, payload.operation === 'start');
  const window = runtime.matching(task, request.owner, request.dispatch_id);
  if (window.adapter !== 'command' || JSON.stringify(window.request) !== JSON.stringify(request) ||
      fs.realpathSync(request.cwd) !== fs.realpathSync(task.taskRoot)) throw Error('DSH请求与原派发不一致');
  const directory = core.safe(ctx.root, '_plan/autopilot/' + request.task_id + '/dsh');
  fs.mkdirSync(directory, { recursive: true });
  const journal = core.safe(directory, request.dispatch_id + '.json');
  let release;
  try { release = acquire(core.safe(ctx.root, '_plan/autopilot/' + request.task_id + '/' + request.dispatch_id + '.launch.lock')); }
  catch (error) { return response({ state: 'unknown', reason: error.message }); }
  try {
    if (dsh.journalFile(ctx, request.task_id, request.dispatch_id) !== journal) throw Error('派发已有其他平台启动记录；禁止跨平台重复启动');
    const digest = dsh.hash(JSON.stringify(request));
    let record = runtime.read(journal);
    if (record) {
      if (record.request_sha256 !== digest) throw Error('不可变DSH派发发生变化');
      // Do not merge a status query into the durable record: queries have no launch side effects.
      return response(dsh.status(request, record));
    }
    if (payload.operation === 'query') return response({ state: 'unknown', reason: 'dsh_launch_intent_missing' });
    const refusal = unsupported(request, opts);
    if (refusal) return response({ state: 'absent', reason: refusal });
    if (!request.work_unit) return response({ state: 'absent', reason: 'direct_dsh_requires_work_unit' });
    units.validate(request.work_unit);
    const requestFile = core.safe(directory, request.dispatch_id + '.request.json');
    const prepared = dsh.prepare(ctx, request, opts, requestFile, journal);
    core.verify(ctx); runtime.atomic(requestFile, request, true);
    record = { version: 1, dispatch_id: request.dispatch_id, request_sha256: digest, state: 'starting',
      created_at: new Date().toISOString(), request_file: requestFile, launch_executor: 'dsh', platform: 'dsh',
      launch_route: request.route, launch_team: request.team, route_evidence: 'dsh_composed_config_and_session_event',
      dsh_manifest: prepared.manifest, dsh_manifest_sha256: prepared.sha256, dsh_process: prepared.process };
    runtime.atomic(journal, record, true);
    const log = fs.openSync(path.join(prepared.directory, 'worker.log'), 'wx');
    try {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../dsh-worker.cjs'), '--manifest', prepared.manifest],
        { cwd: request.cwd, detached: true, stdio: ['ignore', log, log], windowsHide: true, shell: false });
      child.once('error', () => {}); child.unref();
    } finally { fs.closeSync(log); }
    return response(dsh.status(request, record));
  } finally { release(); }
}
if (require.main === module) {
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => { try { console.log(JSON.stringify(handle(JSON.parse(input), options(process.argv.slice(2))))); }
    catch (error) { console.error(error.message); process.exitCode = 1; } });
}
module.exports = { options, unsupported, handle };

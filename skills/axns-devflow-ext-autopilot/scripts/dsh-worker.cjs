#!/usr/bin/env node
'use strict';
// Exactly one child per durable intent. Raw DSH events go to disk, never the controller conversation.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const core = require('./lib/core.cjs'), runtime = require('./lib/runtime.cjs');
const continuation = require('./lib/continuation.cjs'), bridge = require('./lib/dsh-bridge.cjs');
const { acquire } = require('./lib/process-lock.cjs');
async function readyTask(manifest, request) {
  for (let attempt = 0; ; attempt++) {
    try {
      const ctx = core.context(manifest.project), d = runtime.task(ctx, request.task_id);
      runtime.writable(ctx); const w = runtime.matching(d, request.owner, request.dispatch_id);
      if (JSON.stringify(w.request) !== JSON.stringify(request) || fs.realpathSync(manifest.cwd) !== fs.realpathSync(d.taskRoot))
        throw Error('DSH请求与原持权窗口不符');
      core.verify(ctx);
      return { ctx, d };
    } catch (error) {
      if (attempt >= 199 || !['AXNS_COORDINATION_BUSY', 'AXNS_OBSERVATION_CHANGED'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
async function run(file) {
  const raw = fs.readFileSync(file), manifest = JSON.parse(raw);
  const request = runtime.read(manifest.request_file), journal = runtime.read(manifest.journal);
  if (!request || bridge.hash(JSON.stringify(request)) !== manifest.request_sha256 ||
      journal?.request_sha256 !== manifest.request_sha256 || journal?.dsh_manifest_sha256 !== bridge.hash(raw)) throw Error('DSH启动清单或不可变派发已变化');
  const env = { ...process.env, DSH_HOME: manifest.dsh_home };
  const dsh = require('./dsh-session.cjs');
  let release, child, output, errors, childClosed = false, state = null, processPublished = false;
  const save = changes => { state = { ...state, ...changes }; runtime.atomic(manifest.process_file, state); };
  try {
    release = acquire(path.join(path.dirname(file), 'worker.lock'));
    if (fs.existsSync(manifest.process_file)) throw Error('此派发已有进程启动意图，禁止再次启动');
    state = { version: 1, dispatch_id: request.dispatch_id, request_sha256: manifest.request_sha256,
      pid: process.pid, hostname: os.hostname(), state: 'starting', created_at: new Date().toISOString(), takeover_confirmed: false };
    runtime.atomic(manifest.process_file, state, true);
    processPublished = true;
    for (const name of ['patch', 'prompt']) if (bridge.hash(fs.readFileSync(manifest[name + '_file'])) !== manifest[name + '_sha256']) throw Error('DSH启动文件已变化');
    dsh.verify(dsh.dump({ project: manifest.cwd, 'dsh-bin': manifest.dsh_bin, profile: manifest.profile, env }, manifest.patch_file), manifest.route, manifest.team, { children: request.dsh_children,
      telemetry: { dshBin: manifest.dsh_bin, directory: manifest.context_directory, canDelegate: !!request.team?.enabled, canStartNewSession: true, rootProcessFile: manifest.process_file } });
    await readyTask(manifest, request);
    output = fs.openSync(path.join(path.dirname(file), 'events.jsonl'), 'wx');
    errors = fs.openSync(path.join(path.dirname(file), 'stderr.log'), 'wx');
    child = spawn(process.execPath, [manifest.dsh_bin, '--profile', manifest.profile, '--patch', manifest.patch_file, '--json', '-'],
      { cwd: manifest.cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', errors] });
    child.once('close', () => { childClosed = true; });
    save({ child_pid: child.pid ?? null });
    let pending = '', pendingBytes = 0, invalid = false, takeoverError = null, finalReason = null;
    let acknowledgement = Promise.resolve(); const decoder = new StringDecoder('utf8');
    const receive = line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'session') {
        if (state.session_id || typeof event.sessionId !== 'string' || !event.sessionId.trim() || event.sessionId.length > 256 ||
            typeof event.cwd !== 'string' || path.resolve(event.cwd) !== path.resolve(request.cwd)) { invalid = true; return; }
        save({ session_id: event.sessionId });
        acknowledgement = (async () => {
          for (let attempt = 0; attempt < 40; attempt++) {
            try {
              const claimed = continuation.takeover(request.project, { id: request.task_id, owner: request.owner,
                dispatch: request.dispatch_id, 'session-id': event.sessionId, cwd: request.cwd });
              save({ state: 'running', takeover_confirmed: true, work_permitted: claimed.result.work_permitted !== false });
              console.log(JSON.stringify({ action: 'dsh_takeover', dispatch_id: request.dispatch_id, session_id: event.sessionId })); return;
            } catch (error) {
              if (['AXNS_COORDINATION_BUSY', 'AXNS_OBSERVATION_CHANGED'].includes(error.code) && attempt < 39) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
              takeoverError = error.message.slice(0, 1000); save({ takeover_error: takeoverError, work_permitted: false }); return;
            }
          }
        })();
      }
      if (event.type === 'final' && event.sessionId === state.session_id) finalReason = event.reason;
    };
    child.stdout.on('data', chunk => {
      fs.writeSync(output, chunk);
      // Parse only bounded lines; the full stream stays on disk, even if one event is huge.
      for (const part of decoder.write(chunk).split(/(?<=\n)/)) {
        pendingBytes += Buffer.byteLength(part);
        if (pendingBytes <= 65536) pending += part;
        if (part.endsWith('\n')) { if (pendingBytes <= 65536) receive(pending.trim()); pending = ''; pendingBytes = 0; }
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(fs.readFileSync(manifest.prompt_file));
    const outcome = await new Promise(resolve => {
      child.once('error', error => resolve({ exit_code: null, process_error: error.code ?? 'spawn_failed' }));
      child.once('close', (code, signal) => resolve({ exit_code: code, signal }));
    });
    pending += decoder.end();
    if (pending && pendingBytes <= 65536) receive(pending.trim());
    await acknowledgement;
    save({ state: 'stopped', closed_at: new Date().toISOString(), ...outcome, invalid_identity: invalid,
      final_reason: finalReason, final_quiescent: !!finalReason && !invalid && !takeoverError,
      business_completion: 'unverified' });
    console.log(JSON.stringify({ action: 'dsh_process_closed', session_id: state.session_id ?? null, exit_code: outcome.exit_code }));
    return outcome.exit_code ?? 1;
  } catch (error) {
    // A helper failure must not leave an unobserved child waiting for input or running a task.
    // Missing final/close evidence still retains runner ownership and never authorizes relaunch.
    if (child && !childClosed) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.stdin?.destroy(); child.kill();
      await Promise.race([closed, new Promise(resolve => { const timer = setTimeout(resolve, 3000); timer.unref(); })]);
    }
    if (processPublished) save({ state: 'stopped', closed_at: new Date().toISOString(), exit_code: null,
      final_quiescent: false, startup_error: error.message.slice(0, 1000), business_completion: 'unverified' });
    throw error;
  } finally {
    if (child && !childClosed) child.stdout?.destroy();
    if (output !== undefined) fs.closeSync(output);
    if (errors !== undefined) fs.closeSync(errors);
    release?.();
  }
}
if (require.main === module) {
  if (process.argv.length !== 4 || process.argv[2] !== '--manifest') { console.error('需要 --manifest <持久启动清单>'); process.exitCode = 1; }
  else run(path.resolve(process.argv[3])).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { run };

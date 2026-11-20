'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../skills/axns-devflow/scripts/resume-brief.cjs');
const taskId = '20261120-context-recovery';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-brief-'));
  const records = path.join(root, '_plan/process', taskId); fs.mkdirSync(records, { recursive: true });
  t.after(() => { assert.ok(path.basename(root).startsWith('resume-brief-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, records };
}
function run(root, id = taskId, entry = script) {
  return spawnSync(process.execPath, [entry, '--project', root, '--id', id], { encoding: 'utf8', windowsHide: true });
}
test('standalone recovery reads bounded excerpts without autopilot or whole plan and logs', t => {
  const { root, records } = fixture(t);
  fs.writeFileSync(path.join(records, 'current-status.md'), 'old-data\n'.repeat(100000) + 'NEXT: focused work\n');
  fs.writeFileSync(path.join(records, 'window-handoff.md'), 'Worker ownership must be verified.\n');
  fs.writeFileSync(path.join(records, 'plan.md'), 'plan-private-content\n'.repeat(10000));
  fs.writeFileSync(path.join(root, 'large.log'), 'log-private-content');
  const before = fs.readdirSync(root);
  const output = run(root); assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.equal(result.ownership, 'unverified'); assert.equal(result.task_id, taskId);
  assert.equal(result.records[0].truncated, true); assert.match(result.records[0].excerpt, /NEXT: focused work/);
  assert.ok(Buffer.byteLength(output.stdout) <= 12288);
  assert.ok(!output.stdout.includes('plan-private-content')); assert.ok(!output.stdout.includes('log-private-content'));
  assert.deepEqual(fs.readdirSync(root), before);
});
test('standalone recovery rejects traversal, missing records and linked task directories', t => {
  const { root, records } = fixture(t);
  assert.equal(run(root, '../outside').status, 1); assert.equal(run(root).status, 1);
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'current-status.md'), 'outside-secret');
  fs.rmdirSync(records);
  fs.symlinkSync(outside, records, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(run(root).status, 1); assert.ok(!run(root).stdout.includes('outside-secret'));
});
test('copied standalone recovery script has no extension dependency', t => {
  const { root, records } = fixture(t);
  fs.writeFileSync(path.join(records, 'plan.md'), 'One remaining short goal\n');
  const copied = path.join(root, 'resume-brief.cjs'); fs.copyFileSync(script, copied);
  const output = run(root, taskId, copied); assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).records[0].file, '_plan/process/' + taskId + '/plan.md');
});

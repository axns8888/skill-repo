const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('skills/axns-config-dsh-multica-runtime');
const script = fs.readFileSync(path.join(root, 'scripts/runtime.ps1'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('runtime source is pinned by commit and Git tree object ID', () => {
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  assert.match(manifest.sourceTreeOid, /^[0-9a-f]{40}$/);
  assert.equal(manifest.node, '24.21.0');
  assert.equal(manifest.pnpm, '12.5.1');
  assert.equal(manifest.dshTest, '0.2.2-rc.5');
});

test('mutating actions are explicit and use upstream transactional helpers', () => {
  assert.match(script, /\[string\]\$Action = 'Check'/);
  assert.match(script, /install-runtime\.ps1/);
  assert.match(script, /-Rollback \$BackupId/);
  assert.match(script, /Assert-PinnedSource/);
  assert.match(script, /SHA256/);
  assert.match(script, /daemonChanged=\$false/);
});

test('script does not fetch latest or select a CLI from PATH', () => {
  assert.doesNotMatch(script, /release\/download|--latest|Invoke-WebRequest|iex\s*\(/i);
  assert.match(script, /IsPathFullyQualified/);
  assert.match(script, /Workspace -match/);
});

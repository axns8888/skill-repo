'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot, verify, install, check, inventory } = require('../scripts/skills-local.cjs');
const cache = path.resolve(__dirname, '../.cache');
const names = ['axns-devflow', 'axns-devflow-ext-worktree', 'axns-devflow-ext-autopilot'];
function fixture(t) {
  fs.mkdirSync(cache, { recursive: true });
  const base = fs.mkdtempSync(path.join(cache, 'skills-local-test-'));
  const root = path.join(base, 'source'), home = path.join(base, 'home');
  for (const name of names) {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), '---\nname: ' + name + '\n---\nContent\n');
  }
  fs.writeFileSync(path.join(root, '.nvmrc'), process.version + '\n');
  fs.mkdirSync(home, { recursive: true });
  const lock = snapshot(root);
  fs.writeFileSync(path.join(root, 'skills.lock.json'), JSON.stringify(lock));
  const opts = { home, targets: 'codex,dsh' };
  t.after(() => {
    if (path.dirname(path.resolve(base)) !== cache) throw new Error('Unsafe cleanup');
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { root, home, lock, opts, canonical: path.join(home, '.agents/skills') };
}
test('local migration backs up old contents, removes obsolete files and shares exact skills across loaders', t => {
  const f = fixture(t), old = path.join(f.canonical, names[0]);
  fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(path.join(old, 'old.md'), 'keep this');
  const result = install(f.root, f.opts, f.lock);
  assert.equal(result.changed.length, 3); assert.equal(result.linked.length, 6);
  assert.equal(fs.readFileSync(path.join(result.backups[0].to, 'old.md'), 'utf8'), 'keep this');
  assert.equal(fs.existsSync(path.join(old, 'old.md')), false);
  assert.equal(check(f.root, f.opts, f.lock).ok, true);
  assert.equal(fs.realpathSync(path.join(f.home, '.dsh/skills', names[0])), fs.realpathSync(old));
});
test('repeated sync preserves links and creates no replacement backups', t => {
  const f = fixture(t); install(f.root, f.opts, f.lock);
  const result = install(f.root, f.opts, f.lock);
  assert.deepEqual(result.changed, []); assert.deepEqual(result.linked, []); assert.deepEqual(result.backups, []);
  assert.equal(check(f.root, f.opts, f.lock).ok, true);
});
test('installed edits are detected and protected; explicit replacement retains them in backup', t => {
  const f = fixture(t); install(f.root, f.opts, f.lock);
  const local = path.join(f.canonical, names[0], 'SKILL.md'); fs.appendFileSync(local, 'local edit');
  assert.equal(check(f.root, f.opts, f.lock).ok, false);
  assert.throws(() => install(f.root, f.opts, f.lock), /本地修改/);
  assert.match(fs.readFileSync(local, 'utf8'), /local edit/);
  const result = install(f.root, { ...f.opts, 'replace-modified': true }, f.lock);
  assert.match(fs.readFileSync(path.join(result.backups[0].to, 'SKILL.md'), 'utf8'), /local edit/);
  assert.equal(check(f.root, f.opts, f.lock).ok, true);
});
test('foreign skill links reject the whole update before changing central skills', t => {
  const f = fixture(t); install(f.root, f.opts, f.lock);
  const entry = path.join(f.home, '.dsh/skills', names[2]); fs.unlinkSync(entry);
  const foreign = path.join(f.home, 'unrelated'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'sentinel'), 'keep');
  fs.symlinkSync(foreign, entry, process.platform === 'win32' ? 'junction' : 'dir');
  const before = inventory(f.canonical).sha256;
  assert.throws(() => install(f.root, f.opts, f.lock), /其他位置/);
  assert.equal(inventory(f.canonical).sha256, before);
  assert.equal(fs.readFileSync(path.join(foreign, 'sentinel'), 'utf8'), 'keep');
});
test('link creation failure rolls back replaced skill and restores previous standalone loader directory', t => {
  const f = fixture(t);
  const original = path.join(f.canonical, names[0]); fs.mkdirSync(original, { recursive: true }); fs.writeFileSync(path.join(original, 'old'), 'central');
  const entry = path.join(f.home, '.codex/skills', names[0]); fs.mkdirSync(entry, { recursive: true }); fs.writeFileSync(path.join(entry, 'old'), 'loader');
  const symlink = fs.symlinkSync;
  fs.symlinkSync = () => { throw new Error('simulated link failure'); };
  try { assert.throws(() => install(f.root, f.opts, f.lock), /simulated link failure/); }
  finally { fs.symlinkSync = symlink; }
  assert.equal(fs.readFileSync(path.join(original, 'old'), 'utf8'), 'central');
  assert.equal(fs.readFileSync(path.join(entry, 'old'), 'utf8'), 'loader');
  assert.equal(fs.existsSync(path.join(f.home, '.agents/skill-repo/install.json')), false);
});
test('source snapshot detects changes while normalizing Windows text line endings', t => {
  const f = fixture(t), file = path.join(f.root, 'skills', names[0], 'SKILL.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.deepEqual(verify(f.root), f.lock);
  fs.appendFileSync(file, 'change'); assert.throws(() => verify(f.root), /不一致/);
});
test('active synchronization lock is never stolen', t => {
  const f = fixture(t), mutex = path.join(f.home, '.agents/skill-repo/sync.lock');
  fs.mkdirSync(mutex, { recursive: true }); fs.writeFileSync(path.join(mutex, 'owner.json'), '{"pid":1}');
  assert.throws(() => install(f.root, f.opts, f.lock), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(mutex, 'owner.json'), 'utf8'), '{"pid":1}');
});
test('source checkout cannot be used as an installation destination', t => {
  const f = fixture(t);
  assert.throws(() => install(f.root, { ...f.opts, entry: path.join(f.root, 'skills') }, f.lock), /源码仓库/);
});
test('missing loader links and runtime version drift fail the consistency check', t => {
  const f = fixture(t); install(f.root, f.opts, f.lock);
  fs.unlinkSync(path.join(f.home, '.dsh/skills', names[0]));
  assert.equal(check(f.root, f.opts, f.lock).ok, false);
  const result = check(f.root, { ...f.opts, targets: 'agents' }, { ...f.lock, node: 'v0.0.0' });
  assert.equal(result.node_matches, false); assert.equal(result.ok, false);
});

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const DEVFLOW = ['axns-devflow', 'axns-devflow-ext-worktree', 'axns-devflow-ext-autopilot'];
const HASH = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function json(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
function write(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const temp = p + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, p);
}
function command(bin, args, root) {
  const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}
// Text is fingerprinted/copied with LF so Git's Windows checkout conversion is harmless.
function bytes(file) {
  const raw = fs.readFileSync(file);
  const text = raw.toString('utf8');
  return !raw.includes(0) && Buffer.from(text).equals(raw) ? Buffer.from(text.replace(/\r\n/g, '\n')) : raw;
}
function inventory(dir) {
  const files = {};
  function visit(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const relative = prefix + entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('技能内容不允许符号链接：' + absolute);
      if (entry.isDirectory()) visit(absolute, relative + '/');
      else if (entry.isFile()) files[relative] = HASH(bytes(absolute));
      else throw new Error('技能包含非普通文件：' + absolute);
    }
  }
  visit(dir);
  return { sha256: HASH(JSON.stringify(files)), files };
}
function snapshot(root) {
  const names = fs.readdirSync(path.join(root, 'skills')).filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md'))).sort();
  return { version: 1, node: fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(),
    skills: Object.fromEntries(names.map(name => [name, inventory(path.join(root, 'skills', name))])) };
}
function verify(root) {
  const expected = json(path.join(root, 'skills.lock.json'));
  const actual = snapshot(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('源码与 skills.lock.json 不一致；开发后先运行 npm run skills:lock，再验证和同步。');
  return actual;
}
function options(argv) {
  const opts = { action: argv.shift() || 'check' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (['--release', '--replace-modified'].includes(key)) opts[key.slice(2)] = true;
    else if (['--home', '--profile', '--targets', '--entry'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) opts[key.slice(2)] = argv[++i];
    else throw new Error('未知或缺少参数：' + key);
  }
  return opts;
}
function layout(root, opts, lock) {
  const home = path.resolve(opts.home || os.homedir());
  const canonical = path.join(home, '.agents', 'skills');
  const names = opts.profile === 'all' ? Object.keys(lock.skills) : DEVFLOW;
  if (opts.profile && !['all', 'devflow'].includes(opts.profile)) throw new Error('profile 仅支持 devflow/all');
  const targets = opts.targets ? opts.targets.split(',') : ['codex', 'dsh'].filter(name => fs.existsSync(path.join(home, '.' + name)));
  if (targets.some(name => !['agents', 'codex', 'dsh'].includes(name))) throw new Error('targets 仅支持 agents,codex,dsh；其他加载目录用 --entry');
  const entries = targets.filter(name => name !== 'agents').map(name => path.join(home, '.' + name, 'skills'));
  if (opts.entry) entries.push(path.resolve(opts.entry));
  for (const base of [canonical, ...entries]) {
    const relative = path.relative(root, base);
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('安装目标不能位于源码仓库内');
    // Do not silently follow a redirected installation root.
    let ancestor = base;
    while (!exists(ancestor)) ancestor = path.dirname(ancestor);
    if (!samePath(fs.realpathSync(ancestor), path.resolve(ancestor))) throw new Error('安装目录的父路径存在重定向，请使用真实路径：' + base);
  }
  return { home, canonical, names, entries: [...new Set(entries)].filter(p => p !== canonical), state: path.join(home, '.agents', 'skill-repo') };
}
function linkMatches(entry, target) {
  return exists(entry) && fs.lstatSync(entry).isSymbolicLink() && samePath(path.resolve(path.dirname(entry), fs.readlinkSync(entry)), target);
}
function install(root, opts, lock) {
  const l = layout(root, opts, lock);
  fs.mkdirSync(l.state, { recursive: true });
  const mutex = path.join(l.state, 'sync.lock');
  fs.mkdirSync(mutex); // Existing lock is never stolen; crash recovery is explicit.
  const changed = [], backups = [], linked = [], undo = [];
  const run = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
  const runDir = path.join(l.state, 'backups', run);
  const receiptPath = path.join(l.state, 'install.json');
  try {
    write(path.join(mutex, 'owner.json'), { pid: process.pid, at: new Date().toISOString(), root });
    const prior = fs.existsSync(receiptPath) ? json(receiptPath) : { skills: {} };
    // Validate all destinations before changing any loaded skill.
    for (const name of l.names) {
      const dst = path.join(l.canonical, name);
      if (exists(dst)) {
        if (fs.lstatSync(dst).isSymbolicLink() || !fs.lstatSync(dst).isDirectory()) throw new Error('中央技能目录必须是普通目录：' + dst);
        const actual = inventory(dst).sha256;
        if (prior.skills[name] && actual !== prior.skills[name].sha256 && actual !== lock.skills[name].sha256 && !opts['replace-modified']) throw new Error('已安装副本存在本地修改：' + name + '；先合回源码，或使用 --replace-modified 备份后替换。');
      }
      for (const base of l.entries) {
        const entry = path.join(base, name);
        if (exists(entry) && fs.lstatSync(entry).isSymbolicLink() && !linkMatches(entry, dst)) throw new Error('技能入口指向其他位置，保留原状：' + entry);
        if (exists(entry) && !fs.lstatSync(entry).isSymbolicLink() && !fs.lstatSync(entry).isDirectory()) throw new Error('技能入口不是目录：' + entry);
      }
    }
    function replaceDir(dst, staged, label) {
      const backup = path.join(runDir, label);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (exists(dst)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(dst, backup); backups.push({ from: dst, to: backup });
        undo.push(() => fs.renameSync(backup, dst));
      }
      fs.renameSync(staged, dst);
      undo.push(() => { fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.renameSync(dst, staged); });
    }
    for (const name of l.names) {
      const dst = path.join(l.canonical, name);
      if (!exists(dst) || inventory(dst).sha256 !== lock.skills[name].sha256) {
        const staged = path.join(runDir, 'staged', name);
        for (const relative of Object.keys(lock.skills[name].files)) {
          const out = path.join(staged, relative);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, bytes(path.join(root, 'skills', name, relative)));
        }
        if (inventory(staged).sha256 !== lock.skills[name].sha256) throw new Error('暂存时源码发生变化：' + name);
        replaceDir(dst, staged, 'previous/' + name); changed.push(name);
      }
      for (const base of l.entries) {
        const entry = path.join(base, name);
        if (linkMatches(entry, dst)) continue;
        fs.mkdirSync(base, { recursive: true });
        if (exists(entry)) {
          // Keep backup on the same volume as the entry for reliable rename/restore.
          const backup = path.join(path.dirname(base), 'skill-repo-backups', run, name);
          fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.renameSync(entry, backup);
          backups.push({ from: entry, to: backup }); undo.push(() => fs.renameSync(backup, entry));
        }
        fs.symlinkSync(dst, entry, process.platform === 'win32' ? 'junction' : 'dir');
        undo.push(() => fs.unlinkSync(entry)); linked.push(entry);
      }
    }
    verify(root);
    for (const name of l.names) if (inventory(path.join(l.canonical, name)).sha256 !== lock.skills[name].sha256) throw new Error('安装校验失败：' + name);
    const head = command('git', ['rev-parse', 'HEAD'], root);
    const dirty = command('git', ['status', '--porcelain', '--untracked-files=all'], root);
    const skills = { ...prior.skills };
    for (const name of l.names) skills[name] = { sha256: lock.skills[name].sha256, source_head: head, source_dirty: dirty === null ? null : !!dirty };
    const receipt = { version: 1, installed_at: new Date().toISOString(), source_root: root, source_head: head,
      source_dirty: dirty === null ? null : !!dirty, lock_sha256: HASH(JSON.stringify(lock)),
      environment: { node: process.version, git: command('git', ['--version'], root) },
      entries: [...new Set([...(prior.entries || []), ...l.entries])], skills,
      last_backups: backups, previous_backup_run: prior.last_backup_run || null, last_backup_run: backups.length ? runDir : prior.last_backup_run || null };
    write(path.join(runDir, 'result.json'), { changed, linked, backups, source_head: head });
    write(receiptPath, receipt);
    return { ok: true, changed, linked, backups, receipt: receiptPath, node_matches: process.version === lock.node, source_head: head, source_dirty: receipt.source_dirty };
  } catch (e) {
    const errors = [];
    for (const restore of undo.reverse()) { try { restore(); } catch (error) { errors.push(error.message); } }
    if (errors.length) throw new Error(e.message + '; 部分回滚失败，请检查备份 ' + runDir + ': ' + errors.join('; '));
    throw e;
  } finally {
    const owner = path.join(mutex, 'owner.json');
    if (exists(owner)) fs.unlinkSync(owner);
    fs.rmdirSync(mutex);
  }
}
function check(root, opts, lock) {
  const l = layout(root, opts, lock);
  const skills = l.names.map(name => {
    const target = path.join(l.canonical, name);
    const actual = exists(target) ? inventory(target).sha256 : null;
    return { name, matches: actual === lock.skills[name].sha256, entries: l.entries.map(base => ({ path: path.join(base, name), matches: linkMatches(path.join(base, name), target) })) };
  });
  const nodeMatches = process.version === lock.node;
  return { ok: nodeMatches && skills.every(s => s.matches && s.entries.every(e => e.matches)), node: process.version, expected_node: lock.node, node_matches: nodeMatches, skills };
}
function main(argv) {
  const opts = options(argv);
  if (!['lock', 'verify', 'sync', 'check'].includes(opts.action)) throw new Error('用法：node scripts/skills-local.cjs <lock|verify|sync|check> [--profile devflow|all] [--targets agents,codex,dsh] [--entry <其他平台技能目录>]');
  if (opts.action === 'lock') { const lock = snapshot(ROOT); write(path.join(ROOT, 'skills.lock.json'), lock); return { ok: true, skills: Object.keys(lock.skills), validation: '快照已更新；尚需运行 npm run validate' }; }
  const lock = verify(ROOT);
  if (opts.action === 'verify') {
    if (opts.release && process.version !== lock.node) throw new Error('发布验证需要 Node ' + lock.node);
    if (opts.release && command('git', ['status', '--porcelain', '--untracked-files=all'], ROOT) !== '') throw new Error('发布验证要求干净且已提交的 Git 检出');
    return { ok: true, skills: Object.keys(lock.skills), node: lock.node };
  }
  return opts.action === 'sync' ? install(ROOT, opts, lock) : check(ROOT, opts, lock);
}
module.exports = { snapshot, verify, install, check, inventory };
if (require.main === module) {
  try { const result = main(process.argv.slice(2)); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}

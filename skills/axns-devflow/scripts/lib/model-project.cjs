'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MAX_BYTES = 128 * 1024;
const REQUIRED = ['planning', 'implementation', 'simple_execution'];
const TEMPLATE = path.resolve(__dirname, '../../assets/model-routing.json');
function read(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw Error('模型配置超过128 KiB');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (doc.version !== 1 || !doc.models || !doc.scenarios || !doc.presets || !doc.presets[doc.active_preset]) throw Error('模型配置结构不完整：' + file);
  return doc;
}
function inside(root, name) {
  const result = path.resolve(root, name), relative = path.relative(root, result);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('项目配置路径越出项目：' + name);
  return result;
}
function discover(project) {
  const root = path.resolve(project), agents = path.join(root, 'AGENTS.md');
  let registered;
  if (fs.existsSync(agents)) {
    const text = fs.readFileSync(agents, 'utf8'), matches = [...text.matchAll(/^autopilot_config:[ \t]*(.+?)[ \t]*\r?$/gm)];
    if (matches.length > 1) throw Error('AGENTS.md重复autopilot_config');
    if (matches.length) {
      const name = matches[0][1].trim().replace(/^(['"])(.*)\1$/, '$2');
      registered = inside(root, name);
      const raw = JSON.parse(fs.readFileSync(registered, 'utf8').replace(/^\uFEFF/, ''));
      if (raw.model_config_file !== undefined) {
        if (typeof raw.model_config_file !== 'string' || !raw.model_config_file.trim()) throw Error('model_config_file需要明确路径');
        const file = path.isAbsolute(raw.model_config_file) ? path.normalize(raw.model_config_file) : inside(root, raw.model_config_file);
        read(file);
        return { root, file, source: 'autopilot_config.model_config_file', registered, shared: path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file)) };
      }
      if (raw.models || raw.tiers) throw Error('项目已有内联models/tiers；请先显式迁移到model_config_file，保留原有路由');
    }
  }
  const candidates = ['_plan/model-routing.json', 'model-routing.json'].map(name => path.join(root, name)).filter(file => fs.existsSync(file));
  if (candidates.length > 1) throw Error('发现两份模型表；请在autopilot_config.model_config_file中明确指定或通过--file选择');
  if (candidates.length) { read(candidates[0]); return { root, file: candidates[0], source: 'project', registered, shared: false }; }
  return { root, file: path.join(root, '_plan/model-routing.json'), source: 'new', registered, shared: false };
}
function baseline(doc) {
  const template = read(TEMPLATE), added = [];
  for (const id of REQUIRED) if (!Object.hasOwn(doc.scenarios, id)) {
    doc.scenarios[id] = template.scenarios[id]; added.push(id);
  }
  return added;
}
function prepare(root, from) {
  const found = discover(root);
  if (found.source !== 'new') return { ...found, created: false, missing: REQUIRED.filter(id => !Object.hasOwn(read(found.file).scenarios, id)) };
  const doc = read(from ? path.resolve(from) : TEMPLATE); baseline(doc);
  return { ...found, created: true, content: JSON.stringify(doc, null, 2) + '\n' };
}
function safeParents(file) {
  for (let at = path.dirname(file); ; at = path.dirname(at)) {
    if (fs.existsSync(at)) { const stat = fs.lstatSync(at); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('目录位置存在链接或文件：' + at); }
    if (at === path.dirname(at)) break;
  }
}
function initialize(root, from, dryRun = false) {
  const result = prepare(root, from);
  if (result.created && !dryRun) {
    safeParents(result.file); fs.mkdirSync(path.dirname(result.file), { recursive: true });
    fs.writeFileSync(result.file, result.content, { flag: 'wx' });
  }
  const { content, ...info } = result;
  return { ...info, dry_run: dryRun, execution_enabled_by_this_action: false };
}
module.exports = { discover, prepare, initialize, baseline, REQUIRED, TEMPLATE, read, safeParents };

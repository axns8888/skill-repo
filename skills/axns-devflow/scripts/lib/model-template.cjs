'use strict';
// Compare installed templates with a project without replacing local configuration.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const projects = require('./model-project.cjs');
const MAX_BYTES = 128 * 1024;
const ABSENT = Symbol('absent');
const hash = data => createHash('sha256').update(data).digest('hex');
const same = (a, b) => a === b || (a !== ABSENT && b !== ABSENT && JSON.stringify(a) === JSON.stringify(b));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key) ? value[key] : ABSENT;
const conflict = text => Object.assign(Error(text), { status: 409 });
function read(file) {
  projects.safeParents(file);
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('模板更新文件是符号链接，拒绝读取：' + file);
  if (fs.statSync(file).size > MAX_BYTES) throw Error('模板更新文件超过128 KiB');
  return fs.readFileSync(file, 'utf8');
}
function installedVersion() {
  const text = fs.readFileSync(path.resolve(__dirname, '../../SKILL.md'), 'utf8');
  return text.match(/^\s+version:\s*["']?([^"'\s]+)/m)?.[1] ?? '未标记';
}
function template(source = 'personal') {
  const file = source === 'personal' ? projects.PERSONAL_TEMPLATE : source === 'generic' ? projects.TEMPLATE : null;
  if (!file) throw Error('请选择常用模板或通用模板');
  const text = read(file);
  if (text === null) throw Error('当前安装未包含所选模板，请更新 axns-devflow');
  const doc = projects.read(file);
  return { source, label: source === 'personal' ? '常用模板' : '通用模板', version: installedVersion(), revision: hash(JSON.stringify(doc)), doc };
}
function state(project, modelFile) {
  const file = path.join(project, '.devflow/model-template.json'), text = read(file);
  let data = text === null ? null : JSON.parse(text);
  if (data && (data.version !== 1 || !object(data.baseline) || !['personal','generic'].includes(data.source) || typeof data.model_file !== 'string' || typeof data.template_revision !== 'string')) throw Error('模板同步记录无效');
  if (data && path.resolve(data.model_file) !== path.resolve(modelFile)) data = null;
  return { file, revision: text === null ? 'missing' : hash(text), data };
}
function summary(project, modelFile) {
  const previous = state(project, modelFile), source = previous.data?.source ?? 'personal';
  const current = template(source);
  return { source, label: current.label, version: current.version, revision: current.revision,
    state_revision: previous.revision, adopted_revision: previous.data?.template_revision ?? null,
    updated_at: previous.data?.updated_at ?? null, update_available: previous.data ? previous.data.template_revision !== current.revision : null };
}
function differences(doc, next, base = ABSENT) {
  const entries = [];
  function walk(current, incoming, previous, keys) {
    if (same(current, incoming)) return;
    if (incoming === ABSENT) {
      if (current !== ABSENT && previous !== ABSENT) entries.push({ path: keys, kind: 'removed', selectable: false, current, note: '模板已移除此项，保留项目配置' });
      return;
    }
    if (object(current) && object(incoming)) {
      const names = new Set([...Object.keys(incoming), ...(object(previous) ? Object.keys(previous) : [])]);
      for (const key of names) walk(own(current,key),own(incoming,key),own(previous,key),[...keys,key]);
      return;
    }
    const protectedKey = keys.length === 1 && ['version','active_preset'].includes(keys[0]);
    const kind = protectedKey ? 'customized' : current === ABSENT && previous === ABSENT ? 'added' : previous === ABSENT ? 'conflict' : same(previous,incoming) ? 'customized' : same(current,previous) ? 'updated' : 'conflict';
    entries.push({ path: keys, kind, selectable: !protectedKey,
      ...(current === ABSENT ? {} : { current }), incoming,
      ...(previous === ABSENT ? {} : { previous }),
      ...(protectedKey ? { note: '保留项目当前版本及活动预设' } : {}) });
  }
  walk(doc,next,base,[]);
  return entries;
}
function preview(project, modelFile, doc, source = 'personal') {
  const current = template(source), previous = state(project,modelFile);
  const base = previous.data?.source === source ? previous.data.baseline : ABSENT;
  const entries = differences(doc,current.doc,base).map(entry => ({ ...entry, key: JSON.stringify(entry.path) }));
  const counts = {};
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return { template: { source, label: current.label, version: current.version, revision: current.revision },
    state_revision: previous.revision, last_sync: previous.data ? { source: previous.data.source, revision: previous.data.template_revision, updated_at: previous.data.updated_at } : null,
    entries, counts };
}
function apply(project, modelFile, doc, request) {
  const result = preview(project,modelFile,doc,request.source);
  if (request.revision !== result.template.revision || request.state_revision !== result.state_revision) throw conflict('模板或同步记录已变化，请重新检查模板更新');
  if (!Array.isArray(request.keys) || new Set(request.keys).size !== request.keys.length) throw Error('模板更新选择无效');
  const entries = new Map(result.entries.filter(e=>e.selectable).map(e=>[e.key,e]));
  const merged = structuredClone(doc);
  for (const key of request.keys) {
    const entry = entries.get(key);
    if (!entry) throw Error('所选模板差异已失效，请重新检查');
    let target = merged;
    for (const part of entry.path.slice(0,-1)) {
      if (!Object.hasOwn(target,part) || !object(target[part])) throw Error('模板目标结构已变化');
      target = target[part];
    }
    Object.defineProperty(target,entry.path.at(-1),{ value: structuredClone(entry.incoming), enumerable: true, writable: true, configurable: true });
  }
  return { doc: merged, templateUpdate: { source: result.template.source, revision: result.template.revision, state_revision: result.state_revision } };
}
function savePlan(project, modelFile, request) {
  if (!object(request)) throw Error('模板同步参数无效');
  const current = template(request.source), previous = state(project,modelFile);
  if (current.revision !== request.revision || previous.revision !== request.state_revision) throw conflict('模板或同步记录已变化，请重新检查后保存');
  const data = { version: 1, model_file: path.resolve(modelFile), source: current.source,
    template_version: current.version, template_revision: current.revision,
    updated_at: new Date().toISOString(), baseline: current.doc };
  const content = JSON.stringify(data,null,2)+'\n';
  if (Buffer.byteLength(content) > MAX_BYTES) throw Error('模板同步记录超过128 KiB');
  return [previous.file,content];
}
module.exports = { template, state, summary, differences, preview, apply, savePlan };

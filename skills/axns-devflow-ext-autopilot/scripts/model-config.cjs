#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const catalog = require('./lib/model-config.cjs');
const { acquire } = require('./lib/process-lock.cjs');
const FLAGS = {
  show: ['file'], preview: ['file', 'preset', 'scenario'], use: ['file', 'preset'],
  assign: ['file', 'preset', 'scenario', 'model', 'team', 'max-members', 'team-mode'],
};
function options(argv) {
  const command = argv.shift();
  if (!Object.hasOwn(FLAGS, command)) throw Error('命令：show | preview --scenario <场景> | use --preset <预设> | assign --scenario <场景> --model <模型>；可指定 --file <独立文件>');
  const result = { command, file: path.resolve('model-routing.json') }, seen = new Set();
  while (argv.length) {
    const flag = argv.shift(), name = flag.slice(2), value = argv.shift();
    if (!flag.startsWith('--') || !FLAGS[command].includes(name) || !value || value.startsWith('--') || seen.has(name)) throw Error('无效或重复参数：' + flag);
    seen.add(name); result[name] = value;
  }
  if (['preview', 'assign'].includes(command) && !result.scenario) throw Error('需要 --scenario');
  if (command === 'use' && !result.preset) throw Error('需要 --preset');
  if (command === 'assign' && !result.model) throw Error('需要 --model');
  if (result.team && !['inherit', 'off', 'on'].includes(result.team)) throw Error('--team 需要 inherit/off/on');
  if (result['max-members'] && result.team !== 'on') throw Error('--max-members 需要 --team on');
  if (result['team-mode'] !== undefined && result.team !== 'on') throw Error('--team-mode 需要 --team on');
  result.file = path.resolve(result.file);
  return result;
}
function read(file) {
  if (fs.statSync(file).size > catalog.MAX_BYTES) throw Error('模型文件超过128 KiB');
  const source = fs.readFileSync(file, 'utf8');
  return { source, doc: catalog.parse(source) };
}
function execute(opts) {
  if (opts.command === 'show') return catalog.inspect(read(opts.file).doc);
  if (opts.command === 'preview') {
    const { doc } = read(opts.file);
    return catalog.preview(doc, opts.preset ?? doc.active_preset, opts.scenario);
  }
  if (fs.lstatSync(opts.file).isSymbolicLink()) throw Error('编辑入口不覆盖符号链接文件；请指定实际配置文件');
  const release = acquire(opts.file + '.lock');
  let temporary;
  try {
    const { source, doc } = read(opts.file), preset = opts.preset ?? doc.active_preset;
    if (!Object.hasOwn(doc.presets, preset)) throw Error('未知预设：' + preset);
    if (opts.command === 'use') doc.active_preset = preset;
    else {
      if (!Object.hasOwn(doc.scenarios, opts.scenario)) throw Error('未知场景：' + opts.scenario);
      if (!Object.hasOwn(doc.models, opts.model)) throw Error('未知模型：' + opts.model);
      const overrides = doc.presets[preset].scenarios ??= {};
      const selection = { ...overrides[opts.scenario], tier: opts.model };
      if (opts.team === 'inherit') delete selection.team;
      if (opts.team === 'off') selection.team = { enabled: false };
      if (opts.team === 'on') selection.team = { enabled: true, ...(opts['max-members'] ? { max_members: Number(opts['max-members']) } : {}),
        ...(opts['team-mode'] ? { mode: opts['team-mode'] } : {}) };
      overrides[opts.scenario] = selection;
    }
    catalog.validate(doc); catalog.compile(doc, preset); catalog.compile(doc);
    const next = JSON.stringify(doc, null, 2) + '\n';
    if (Buffer.byteLength(next) > catalog.MAX_BYTES) throw Error('更新后模型文件超过128 KiB');
    if (fs.readFileSync(opts.file, 'utf8') !== source) throw Error('配置在编辑期间变化；保留文件，请重新读取');
    temporary = opts.file + '.tmp-' + randomUUID();
    fs.writeFileSync(temporary, next, { flag: 'wx' });
    if (fs.readFileSync(opts.file, 'utf8') !== source) throw Error('配置在编辑期间变化；保留文件，请重新读取');
    fs.renameSync(temporary, opts.file); temporary = null;
    return { file: opts.file, active_preset: doc.active_preset, updated_preset: preset,
      ...(opts.scenario ? { selection: catalog.preview(doc, preset, opts.scenario) } : {}), applies_to: 'new_sessions_only' };
  } finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    release();
  }
}
if (require.main === module) {
  try { console.log(JSON.stringify(execute(options(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { options, execute };

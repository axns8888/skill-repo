#!/usr/bin/env node
'use strict';
// Offline comparison from explicit model configuration and optional verification evidence. Never launches agents.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createRequire } = require('node:module');
const catalog = require('./lib/model-config.cjs'), scenes = require('./lib/dsh-scenes.cjs');
function recommend(needs) {
  if (needs.platform) return { mode: 'orca', reason: '需要 Orca 工作区、终端或平台管理能力。' };
  if (needs.channels && needs.effort) return { mode: 'orca', reason: '当前 DSH 产品子级后端没有统一的逐任务推理强度参数；精确控制时优先现有 Orca 路径，并核实执行端实际支持值。' };
  if (needs.channels) return { mode: 'dsh', reason: '可以采用 DSH 官方 Codex / Claude Code 后端；需要安装、验证渠道，并明确接受原生推理强度设置。' };
  return { mode: 'dsh', reason: 'DSH 原生模型路由和短任务协作已覆盖这些需求；自动根会话接续使用直接进程监督器。' };
}
function packageInfo(dshBin, name) {
  if (!dshBin) return { installed: null, reason: '未提供DSH入口，未检查' };
  const homes = [dshBin, ...['headless', 'desktop', 'web'].map(profile => path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'profiles', profile, 'package.json'))];
  for (const anchor of homes) {
    try { const entry = createRequire(path.resolve(anchor)).resolve(name); return { installed: true, resolved_entry: entry }; } catch { /* Optional bundle may not be installed. */ }
  }
  return { installed: false, reason: '当前检查的DSH入口及本机profiles中未解析到；尚未验证可调用' };
}
function report(opts) {
  const file = path.resolve(opts.models), doc = catalog.parse(fs.readFileSync(file, 'utf8')), compiled = catalog.compile(doc);
  let child = { scenes: [], status: '未配置DSH子级场景' };
  if (doc.dsh) {
    try { child = { ...scenes.build(compiled.dsh_children), status: '配置可生成；渠道仍需运行验证' }; }
    catch (error) { child = { scenes: compiled.dsh_children.scenes, status: error.message }; }
  }
  const evidence = opts.evidence ? JSON.parse(fs.readFileSync(path.resolve(opts.evidence), 'utf8')) : null;
  return { version: 1, generated_at: new Date().toISOString(), snapshot_only: true, model_file: file,
    active_preset: doc.active_preset, models: Object.entries(doc.models).map(([id, value]) => ({ id, ...value })),
    root_route: compiled.models[compiled.catalog_default.tier], children: child,
    optional_backends: { codex: packageInfo(opts.dshBin, '@deepseek-ai/dsh-subagent-codex'),
      claude: packageInfo(opts.dshBin, '@deepseek-ai/dsh-subagent-claude-code') }, evidence,
    project_examples: Object.fromEntries(['dsh', 'orca'].map(mode => [mode, { version: 1, model_config_file: file,
      execution: { enabled: true, adapter: 'command', require_units: true, command: { file: process.execPath,
        args: [path.resolve(__dirname, 'adapters/' + (mode === 'dsh' ? 'dsh' : 'orca') + '-bridge.cjs'),
          ...(mode === 'orca' ? ['--binding', 'codex=Codex', '--binding', 'claude=Claude Code'] : []),
          '--dsh-bin', opts.dshBin ?? '<本机DSH的lib/bin.js>'] } } }])) };
}
function render(data) {
  const template = fs.readFileSync(path.resolve(__dirname, '../references/execution-guide.html'), 'utf8');
  const assessment = fs.readFileSync(path.resolve(__dirname, 'context-decision.cjs'), 'utf8');
  const logic = assessment.slice(assessment.indexOf('function keys('), assessment.indexOf('function main('));
  return template.replace('/*DEVFLOW_DECISION*/', logic).replace('/*DEVFLOW_RECOMMEND*/', recommend.toString())
    .replace('/*DEVFLOW_REPORT*/', () => JSON.stringify(data).replace(/[<>&]/g, ch => String.fromCharCode(92) + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0')));
}
function main(argv) {
  const opts = {};
  while (argv.length) {
    const flag = argv.shift(), key = { '--models': 'models', '--out': 'out', '--dsh-bin': 'dshBin', '--evidence': 'evidence' }[flag];
    if (!key || opts[key] || !argv.length) throw Error('用法：execution-guide.cjs --models <模型文件> --out <报告.html> [--dsh-bin <入口> --evidence <证据JSON>]');
    opts[key] = argv.shift();
  }
  if (!opts.models || !opts.out) throw Error('必须指定 --models 和 --out');
  const data = report(opts), out = path.resolve(opts.out);
  if (out === path.resolve(opts.models) || out === (opts.evidence && path.resolve(opts.evidence))) throw Error('报告不能覆盖输入配置或证据');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, render(data));
  fs.writeFileSync(out.replace(/\.html?$/i, '') + '.snapshot.json', JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({ html: out, mode: 'offline_snapshot', active_preset: data.active_preset }));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { recommend, packageInfo, report, render, main };

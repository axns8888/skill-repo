#!/usr/bin/env node
'use strict';
// A loopback editor bound to the current project directory. No model calls or task starts.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const catalog = require('./lib/model-config.cjs');
const { acquire } = require('./lib/process-lock.cjs');
const projects = require('../../axns-devflow/scripts/lib/model-project.cjs');
const core = require('./lib/core.cjs');
function options(argv) {
  const opts = { projectRoot: process.cwd(), port: 19321 }, seen = new Set();
  while (argv.length) {
    const key = argv.shift(), value = argv.shift();
    if (!['--file', '--from', '--port'].includes(key) || seen.has(key) || !value || value.startsWith('--')) throw Error('用法：先进入项目目录，再运行 model-page.cjs [--file <模型表>] [--from <默认表>] [--port 19321]');
    seen.add(key); opts[key.slice(2)] = value;
  }
  if (opts.file && opts.from) throw Error('--file与--from不可同时使用');
  opts.port = Number(opts.port);
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw Error('--port需要0–65535');
  return opts;
}
const hash = source => createHash('sha256').update(source).digest('hex');
function load(file) {
  if (!fs.existsSync(file)) return { source: null, doc: null, revision: 'missing' };
  if (fs.statSync(file).size > catalog.MAX_BYTES) throw Error('模型文件超过128 KiB');
  const source = fs.readFileSync(file, 'utf8'), doc = catalog.parse(source);
  return { source, doc, revision: hash(source) };
}
function save(file, doc, revision) {
  projects.safeParents(file);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('请指定实际配置文件，不覆盖符号链接');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const release = acquire(file + '.lock'); let temporary;
  try {
    const current = load(file);
    if (revision !== current.revision) throw Object.assign(Error('文件已被其他窗口或命令修改；请导出当前草稿后重新加载'), { status: 409 });
    catalog.validate(doc);
    for (const id of projects.REQUIRED) if (!Object.hasOwn(doc.scenarios, id)) throw Error('必备场景不可缺少：' + id);
    catalog.compile(doc);
    const source = JSON.stringify(doc, null, 2) + '\n';
    if (Buffer.byteLength(source) > catalog.MAX_BYTES) throw Error('模型文件超过128 KiB');
    temporary = file + '.tmp-' + randomUUID(); fs.writeFileSync(temporary, source, { flag: 'wx' });
    if (load(file).revision !== revision) throw Object.assign(Error('保存期间文件变化；原文件保留'), { status: 409 });
    if (revision === 'missing') { fs.linkSync(temporary, file); fs.unlinkSync(temporary); }
    else fs.renameSync(temporary, file);
    temporary = null;
    return { revision: hash(source), applies_to: 'new_sessions_only' };
  } finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); release(); }
}
function autopilotStatus(project) {
  const agentsFile = path.join(project, 'AGENTS.md');
  projects.safeParents(agentsFile);
  if (fs.existsSync(agentsFile) && fs.lstatSync(agentsFile).isSymbolicLink()) throw Error('AGENTS.md 是符号链接；配置页拒绝跟随');
  const agentsText = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : '';
  const settings = core.agents(agentsText);
  const configFile = settings.config ? path.resolve(project, settings.config) : path.join(project, '_plan/autopilot.json');
  let configValid = false, executionEnabled = false, error = '', parsedConfig = null;
  if (settings.config && (configFile === project || configFile.startsWith(project + path.sep)) && fs.existsSync(configFile)) {
    try {
      projects.safeParents(configFile);
      if (fs.lstatSync(configFile).isSymbolicLink()) throw Error('autopilot 配置是符号链接');
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const parsed = core.config(raw);
      parsedConfig = parsed;
      configValid = true;
      executionEnabled = parsed.execution.enabled;
    } catch (cause) { error = cause.message; }
  }
  const worktreeEnabled = core.agents(agentsText).worktree;
  const worktreeAvailable = fs.existsSync(path.resolve(__dirname, '../../axns-devflow-ext-worktree/SKILL.md'));
  const branch = agentsText.match(/^integration_branch:[ \t]*([\w./-]+)[ \t]*$/m)?.[1] || '';
  const branchExists = branch ? spawnSync('git', ['-C', project, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { encoding: 'utf8' }).status === 0 : false;
  return { declared: settings.enabled, configPath: settings.config || null, configValid, executionEnabled,
    adapter: parsedConfig?.execution.adapter ?? null,
    commandFile: parsedConfig?.execution.command?.file ?? '', commandArgs: parsedConfig?.execution.command?.args ?? [],
    platformVerified: false, error, worktreeEnabled, worktreeAvailable, integrationBranch: branch, branchExists,
    agentsFile, agentsRevision: hash(agentsText), configFile, configRevision: fs.existsSync(configFile) ? hash(fs.readFileSync(configFile)) : 'missing' };
}
function replaceTopLevel(text, key, line) {
  const lines = text.split(/\r?\n/), index = lines.findIndex(value => new RegExp(`^${key}:`).test(value));
  if (index < 0) { lines.push(line); return lines.filter((value, i, all) => i < all.length - 1 || value !== '').join('\n') + '\n'; }
  if (key === 'extensions' && /^extensions:\s*$/.test(lines[index])) {
    let end = index + 1;
    while (end < lines.length && /^[ \t]+-/.test(lines[end])) end++;
    lines.splice(index, end - index, line);
  } else lines[index] = line;
  return lines.join('\n');
}
function saveProjectSettings(project, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('配置字段无效');
  const current = autopilotStatus(project);
  if (body.agentsRevision !== current.agentsRevision || body.configRevision !== current.configRevision)
    throw Object.assign(Error('项目配置已被其他窗口修改，请重新加载后再保存'), { status: 409 });
  if (!body || typeof body.worktreeEnabled !== 'boolean' || typeof body.autopilotEnabled !== 'boolean' ||
      typeof body.executionEnabled !== 'boolean' || !['session', 'command'].includes(body.adapter)) throw Error('配置字段无效');
  if (body.executionEnabled && !body.autopilotEnabled) throw Error('自动执行要求同时显式声明 autopilot 扩展');
  if (body.worktreeEnabled && !current.worktreeAvailable) throw Error('当前未安装 axns-devflow-ext-worktree，不能声明 worktree');
  const agentsFile = current.agentsFile;
  let agentsText = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : '';
  const originalAgentsText = agentsText;
  let names = [];
  const inline = agentsText.match(/^extensions:\s*\[([^\]\r\n]*)\]\s*$/m);
  const block = agentsText.match(/^extensions:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)+)/m);
  const unquote = value => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (inline) names = inline[1].split(',').map(unquote).filter(Boolean);
  else if (block) names = block[1].trim().split(/\r?\n/).map(value => unquote(value.replace(/^\s*-\s*/, ''))).filter(Boolean);
  names = [...new Set(names.filter(name => !['autopilot', 'worktree'].includes(name)))];
  if (body.autopilotEnabled) names.push('autopilot');
  if (body.worktreeEnabled) names.push('worktree');
  if (names.length || /^extensions:/m.test(agentsText)) agentsText = replaceTopLevel(agentsText, 'extensions', `extensions: [${names.join(', ')}]`);
  if (body.worktreeEnabled) {
    const branch = String(body.integrationBranch || '').trim();
    if (!/^[\w./-]+$/.test(branch) || spawnSync('git', ['-C', project, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0)
      throw Error('worktree 模式需要选择项目中已存在的本地集成分支');
    agentsText = replaceTopLevel(agentsText, 'integration_branch', `integration_branch: ${branch}`);
  }
  let configFile = current.configFile;
  let config = {};
  if (current.configValid) config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  else if (current.configPath && fs.existsSync(configFile)) throw Error('现有 autopilot 配置无效；请先修复，页面不会覆盖它');
  else if (!current.configPath && fs.existsSync(configFile)) throw Error('发现未登记的 _plan/autopilot.json；请先在 AGENTS.md 登记其路径，页面不会覆盖它');
  else {
    const relative = current.configPath || '_plan/autopilot.json';
    configFile = path.resolve(project, relative);
    if (configFile !== project && !configFile.startsWith(project + path.sep)) throw Error('autopilot_config 必须位于项目目录内');
    config = { version: 1, execution: { enabled: false, adapter: 'session', timeout_seconds: 30, require_units: false } };
  }
  config.execution = { ...(config.execution || {}), enabled: body.executionEnabled, adapter: body.adapter };
  if (body.adapter === 'command') {
    const file = String(body.commandFile || '').trim();
    if (!file) throw Error('command 适配器需要填写桥接程序路径');
    config.execution.command = { file, args: Array.isArray(body.commandArgs) ? body.commandArgs : [] };
  } else delete config.execution.command;
  core.config(config);
  if (body.autopilotEnabled) agentsText = replaceTopLevel(agentsText, 'autopilot_config', `autopilot_config: ${path.relative(project, configFile).split(path.sep).join('/')}`);
  const configSource = JSON.stringify(config, null, 2) + '\n';
  const projectSettingsFile = path.join(project, '.devflow', 'settings.json');
  const projectSettingsRevision = fs.existsSync(projectSettingsFile) ? hash(fs.readFileSync(projectSettingsFile)) : 'missing';
  if (body.projectSettingsRevision !== projectSettingsRevision) throw Object.assign(Error('项目模式关联已被其他窗口修改，请重新加载'), { status: 409 });
  let projectSettings = { version: 1, model_association: null };
  if (fs.existsSync(projectSettingsFile)) {
    projectSettings = JSON.parse(fs.readFileSync(projectSettingsFile, 'utf8'));
    if (projectSettings.version !== 1) throw Error('不支持的 .devflow/settings.json 版本');
  }
  if (body.modelAssociation !== undefined) {
    if (body.modelAssociation !== null) {
      const association = body.modelAssociation;
      if (!association || !['single', 'worktree'].includes(association.workspace_mode) || typeof association.preset !== 'string' ||
          !Object.hasOwn(load(path.resolve(project, body.modelAssociationFile || '_plan/model-routing.json')).doc.presets, association.preset))
        throw Error('模型关联必须选择工作区模式及有效预设，或选择“无关联”');
      projectSettings.model_association = association;
    } else projectSettings.model_association = null;
  }
  const projectSettingsSource = JSON.stringify(projectSettings, null, 2) + '\n';
  const writeProjectSettings = body.modelAssociation !== undefined && (body.modelAssociation !== null || fs.existsSync(projectSettingsFile));
  if (Buffer.byteLength(configSource) > 128 * 1024) throw Error('autopilot 配置超过128 KiB');
  projects.safeParents(configFile); projects.safeParents(agentsFile); projects.safeParents(projectSettingsFile);
  for (const target of [configFile, agentsFile, projectSettingsFile])
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('项目配置文件是符号链接，拒绝写入：' + target);
  const write = (file, content) => {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('拒绝覆盖符号链接：' + file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp-' + randomUUID();
    try { fs.writeFileSync(temp, content, { flag: 'wx' }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  };
  const latest = autopilotStatus(project);
  if (latest.agentsRevision !== body.agentsRevision || latest.configRevision !== body.configRevision ||
      (fs.existsSync(projectSettingsFile) ? hash(fs.readFileSync(projectSettingsFile)) : 'missing') !== body.projectSettingsRevision)
    throw Object.assign(Error('保存前检测到项目配置变化；未写入，请重新加载'), { status: 409 });
  if (body.autopilotEnabled || current.configValid) write(configFile, configSource);
  if (agentsText !== originalAgentsText) write(agentsFile, agentsText);
  if (writeProjectSettings) write(projectSettingsFile, projectSettingsSource);
  return autopilotStatus(project);
}
async function start(opts) {
  const project = path.resolve(opts.projectRoot ?? process.cwd());
  const relative = opts.file ? path.relative(project, path.resolve(opts.file)) : '';
  const found = opts.file ? { root: project, file: path.resolve(opts.file), source: 'explicit', shared: relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) } : projects.prepare(project, opts.from);
  const file = found.file;
  const modelDraft = found.created ? catalog.parse(found.content) : null;
  const initial = load(file);
  if (!initial.doc && !modelDraft) throw Error('模型表不存在；请重新打开配置页');
  const token = randomBytes(32).toString('hex');
  const template = fs.readFileSync(path.resolve(__dirname, '../references/model-page.html'), 'utf8');
  const html = template.replace('__EDITOR_TOKEN__', () => JSON.stringify(token));
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    function json(status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return json(403, { error: '只接受本地页面同源访问' });
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
      if (req.headers['x-devflow-token'] !== token) return json(403, { error: '页面令牌无效，请重新打开配置页面' });
      if (req.method === 'GET' && req.url === '/api/config') {
        const current = load(file), doc = current.doc || modelDraft, added = projects.baseline(doc);
        const prefsFile = path.join(project, '.devflow', 'settings.json');
        let projectSettings = { version: 1, model_association: null };
        projects.safeParents(prefsFile);
        if (fs.existsSync(prefsFile)) {
          if (fs.lstatSync(prefsFile).isSymbolicLink()) throw Error('.devflow/settings.json 是符号链接');
          projectSettings = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
        }
        return json(200, { file, project, source: found.source, shared: found.shared, doc, revision: current.revision, added, required: projects.REQUIRED, inspection: catalog.inspect(doc), autopilot: autopilotStatus(project), projectSettings, projectSettingsRevision: fs.existsSync(prefsFile) ? hash(fs.readFileSync(prefsFile)) : 'missing' });
      }
      if (req.method === 'PUT' && req.url === '/api/project-settings') {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 16384) return json(413, { error: '请求超过配置大小上限' }); chunks.push(chunk); }
        const release = acquire(path.join(project, '.devflow-config-editor-lock'));
        try { return json(200, { autopilot: saveProjectSettings(project, JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); }
        finally { release(); }
      }
      if (req.method === 'PUT' && req.url === '/api/config') {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > catalog.MAX_BYTES + 8192) return json(413, { error: '请求超过配置大小上限' }); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return json(200, save(file, body.doc, body.revision));
      }
      return json(404, { error: '没有此操作' });
    } catch (error) { json(error.status ?? 400, { error: error.message }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 19321, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, origin, token, file };
}
if (require.main === module) start(options(process.argv.slice(2))).then(({ origin, file }) => console.log(JSON.stringify({ page: origin, file, execution: 'Orca由项目单独配置；编辑器不启动任务', stop: 'Ctrl+C' }, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { options, start, save, load, autopilotStatus, saveProjectSettings };

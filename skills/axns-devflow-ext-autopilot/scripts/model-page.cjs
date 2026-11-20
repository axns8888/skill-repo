#!/usr/bin/env node
'use strict';
// A loopback editor bound to one explicit project/configuration. No model calls or task starts.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const catalog = require('./lib/model-config.cjs');
const { acquire } = require('./lib/process-lock.cjs');
const projects = require('../../axns-devflow/scripts/lib/model-project.cjs');
function options(argv) {
  const opts = { port: 19321 }, seen = new Set();
  while (argv.length) {
    const key = argv.shift(), value = argv.shift();
    if (!['--project-root', '--file', '--from', '--port'].includes(key) || seen.has(key) || !value || value.startsWith('--')) throw Error('用法：model-page.cjs --project-root <项目> [--file <模型表>] [--from <默认表>] [--port 19321]');
    seen.add(key); opts[key.slice(2)] = value;
  }
  if (!opts['project-root']) throw Error('需要--project-root');
  if (opts.file && opts.from) throw Error('--file与--from不可同时使用');
  opts.port = Number(opts.port);
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw Error('--port需要0–65535');
  return opts;
}
const hash = source => createHash('sha256').update(source).digest('hex');
function load(file) {
  if (fs.statSync(file).size > catalog.MAX_BYTES) throw Error('模型文件超过128 KiB');
  const source = fs.readFileSync(file, 'utf8'), doc = catalog.parse(source);
  return { source, doc, revision: hash(source) };
}
function save(file, doc, revision) {
  projects.safeParents(file);
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('请指定实际配置文件，不覆盖符号链接');
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
    fs.renameSync(temporary, file); temporary = null;
    return { revision: hash(source), applies_to: 'new_sessions_only' };
  } finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); release(); }
}
async function start(opts) {
  const project = path.resolve(opts['project-root']);
  const relative = opts.file ? path.relative(project, path.resolve(opts.file)) : '';
  const found = opts.file ? { root: project, file: path.resolve(opts.file), source: 'explicit', shared: relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) } : projects.initialize(project, opts.from);
  const file = found.file; load(file);
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
        const current = load(file), added = projects.baseline(current.doc);
        return json(200, { file, project, source: found.source, shared: found.shared, doc: current.doc, revision: current.revision, added, required: projects.REQUIRED, inspection: catalog.inspect(current.doc) });
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
module.exports = { options, start, save, load };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const helper = require('../skills/axns-ops-bt/scripts/bt-api.cjs');
const script = path.resolve(__dirname, '../skills/axns-ops-bt/scripts/bt-api.cjs');
const key = 'synthetic-api-key';
const summary = { memTotal: 4096, cpuNum: 4, cpuRealUsed: 12, version: 'test', system: 'test-os' };

async function server(t, handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise(resolve => { instance.close(resolve); instance.closeAllConnections(); }));
  return 'http://127.0.0.1:' + instance.address().port;
}
function execute(url, extra = {}) {
  return helper.runOperation({ operation: 'system-summary', execute: true, allowLocalHttp: true,
    env: { BT_PANEL_URL: url, BT_API_KEY: key }, ...extra });
}
function cli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, BT_PANEL_URL: '', BT_API_KEY: '', ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
function configFile(t, edit) {
  const cache = path.resolve(__dirname, '../.cache');
  fs.mkdirSync(cache, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cache, 'ops-bt-test-'));
  t.after(() => {
    if (path.dirname(path.resolve(dir)) !== cache) throw new Error('Unexpected cleanup target');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const config = helper.loadConfig();
  edit(config);
  const file = path.join(dir, 'operations.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

test('signature matches an independently computed fixed fixture', () => {
  assert.equal(helper.createSignature(key, 1700000000), 'ec10397c6e1eb180ce430625c1ea5f35');
  assert.throws(() => helper.createSignature('', 1700000000), { code: 'MISSING_CREDENTIALS' });
  assert.throws(() => helper.createSignature(key, '1700000000x'), { code: 'INVALID_TIME' });
});

test('configuration cannot relabel a mutating or unknown operation as read-only', t => {
  for (const edit of [
    c => { c.operations['system-summary'].action = 'RebootSystem'; },
    c => { c.operations['system-summary'].path = '/files'; },
    c => { c.operations['system-summary'].risk = 'write'; },
    c => { c.operations['system-summary'].parameters = { command: 'arbitrary' }; },
    c => { c.operations['delete-site'] = { method: 'POST', path: '/site', action: 'DeleteSite', risk: 'read-only' }; }
  ]) assert.throws(() => helper.loadConfig(configFile(t, edit)), { code: 'UNSAFE_CONFIG' });
});

test('remote HTTP, credential URLs, security entrances and unsafe URL parts are rejected', () => {
  for (const url of ['http://panel.example', 'https://user:secret@panel.example', 'https://panel.example/login', 'https://panel.example/?key=secret', 'https://panel.example/#secret', 'file:///etc/passwd']) {
    assert.throws(() => helper.validateBaseUrl(url));
  }
  assert.throws(() => helper.validateBaseUrl('http://127.0.0.1:8080'), { code: 'INSECURE_TRANSPORT' });
  assert.throws(() => helper.validateBaseUrl('http://panel.example', true), { code: 'INSECURE_TRANSPORT' });
  assert.equal(helper.validateBaseUrl('http://127.0.0.1:8080', true).origin, 'http://127.0.0.1:8080');
  assert.equal(helper.validateBaseUrl('https://panel.example').protocol, 'https:');
});

test('preview needs no credentials and sends no request', async t => {
  let requests = 0;
  const url = await server(t, (req, res) => { requests++; res.end('{}'); });
  const result = await helper.runOperation({ operation: 'system-summary', env: { BT_PANEL_URL: url } });
  assert.equal(result.mode, 'preview');
  assert.equal(result.networkRequestSent, false);
  assert.equal(requests, 0);
});

test('real HTTP request uses signed POST form and exposes only projected diagnostic fields', async t => {
  let requests = 0;
  const url = await server(t, (req, res) => {
    requests++;
    let body = '';
    req.on('data', data => { body += data; });
    req.on('end', () => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/system');
      assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
      const fields = new URLSearchParams(body);
      assert.equal(fields.get('action'), 'GetSystemTotal');
      assert.equal(fields.get('request_token'), helper.createSignature(key, fields.get('request_time')));
      assert.equal(fields.has('api_key'), false);
      assert.ok(Math.abs(Number(fields.get('request_time')) - Date.now()/1000) < 5);
      res.end(JSON.stringify({ ...summary, password: key, nested: { secret: key }, system: key + ' / ' + fields.get('request_token') }));
    });
  });
  const result = await execute(url);
  assert.equal(requests, 1);
  assert.equal(result.data.memTotal, 4096);
  assert.equal(result.data.password, undefined);
  assert.equal(result.data.nested, undefined);
  assert.equal(result.data.system, '[REDACTED] / [REDACTED]');
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('load and disk operations send the documented action and validate response shapes', async t => {
  for (const [operation, action, value, expected] of [
    ['system-load', 'GetLoadAverage', { one: 1, five: 2, fifteen: 3, safe: 4, password: key }, { one: 1, five: 2, fifteen: 3, safe: 4 }],
    ['disk-info', 'GetDiskInfo', [{ path: '/', size: ['10G', '2G'], password: key }], [{ path: '/', size: ['10G', '2G'] }]]
  ]) {
    const url = await server(t, (req, res) => {
      let body = '';
      req.on('data', data => { body += data; });
      req.on('end', () => {
        assert.equal(new URLSearchParams(body).get('action'), action);
        res.end(JSON.stringify(value));
      });
    });
    assert.deepEqual((await execute(url, { operation })).data, expected);
  }
  assert.throws(() => helper.projectResult('system-load', { one: '1', five: 2, fifteen: 3 }), { code: 'CONTRACT_MISMATCH' });
  assert.throws(() => helper.projectResult('disk-info', [{ path: '/' }]), { code: 'CONTRACT_MISMATCH' });
});

test('HTTP failures retain error categories while suppressing raw secret-bearing bodies', async t => {
  for (const [status, code] of [[404, 'INTERFACE_NOT_FOUND'], [422, 'PARAMETER_ERROR'], [403, 'ACCESS_DENIED'], [500, 'HTTP_ERROR']]) {
    const url = await server(t, (req, res) => { res.writeHead(status); res.end(key); });
    await assert.rejects(execute(url), error => error.code === code && error.httpStatus === status && !error.message.includes(key));
  }
});

test('redirects are not followed and signed credentials never reach the target', async t => {
  let targetRequests = 0;
  const target = await server(t, (req, res) => { targetRequests++; res.end(JSON.stringify(summary)); });
  const url = await server(t, (req, res) => { res.writeHead(302, { Location: target + '/leak' }); res.end(key); });
  await assert.rejects(execute(url), { code: 'REDIRECT_REFUSED' });
  assert.equal(targetRequests, 0);
});

test('HTTP 200 business rejection returns nonzero CLI status and no raw response', async t => {
  const url = await server(t, (req, res) => res.end(JSON.stringify({ status: false, msg: 'password=' + key })));
  const result = await cli(['--operation', 'system-summary', '--execute', '--allow-local-http'], { BT_PANEL_URL: url, BT_API_KEY: key });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).code, 'PANEL_REJECTED');
  assert.equal((result.stdout + result.stderr).includes(key), false);
});

test('HTML/login pages and incomplete JSON are not reported as success', async t => {
  const html = await server(t, (req, res) => res.end('<html>login ' + key + '</html>'));
  await assert.rejects(execute(html), { code: 'NON_JSON_RESPONSE' });
  const empty = await server(t, (req, res) => res.end('{}'));
  await assert.rejects(execute(empty), { code: 'CONTRACT_MISMATCH' });
});

test('timeout sends exactly one request without a retry', async t => {
  let requests = 0;
  const url = await server(t, () => { requests++; });
  await assert.rejects(execute(url, { timeoutMs: 80 }), { code: 'REQUEST_TIMEOUT' });
  assert.equal(requests, 1);
});

test('response size limits stop excessive output', async t => {
  const url = await server(t, (req, res) => res.end(JSON.stringify({ ...summary, padding: 'x'.repeat(4096) })));
  await assert.rejects(execute(url, { maxBytes: 128 }), { code: 'RESPONSE_TOO_LARGE' });
});

test('TLS verification cannot be disabled through the inherited environment', async t => {
  let requests = 0;
  const url = await server(t, (req, res) => { requests++; res.end('{}'); });
  await assert.rejects(execute(url, { env: { BT_PANEL_URL: url, BT_API_KEY: key, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }), { code: 'TLS_DISABLED' });
  assert.equal(requests, 0);
});

test('CLI discovery/preview work offline and erroneous arguments do not echo secrets', async () => {
  for (const args of [['--list'], ['--validate-config'], ['--operation', 'system-summary'], ['--help']]) {
    const result = await cli(args);
    assert.equal(result.status, 0, result.stderr);
  }
  const result = await cli(['--api-key', key]);
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(key), false);
  assert.equal(JSON.parse(result.stderr).code, 'INVALID_ARGUMENT');
  assert.equal((await cli(['--list', '--execute'])).status, 1);
});

test('interrupted response is a failure and never causes a second request', async t => {
  let requests = 0;
  const url = await server(t, (req, res) => {
    requests++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"memTotal":');
    setImmediate(() => res.destroy());
  });
  await assert.rejects(execute(url), { code: 'NETWORK_ERROR' });
  assert.equal(requests, 1);
});

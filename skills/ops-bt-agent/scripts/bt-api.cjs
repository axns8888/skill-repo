#!/usr/bin/env node
'use strict';
// Intentionally read-only. Changes to these mappings require code review and tests.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { createHash } = require('node:crypto');
const DEFAULT_CONFIG = path.join(__dirname, '..', 'config', 'operations.json');
const ACTIONS = Object.freeze({
  'system-summary': 'GetSystemTotal',
  'system-load': 'GetLoadAverage',
  'disk-info': 'GetDiskInfo'
});

class BtError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    if (httpStatus != null) this.httpStatus = httpStatus;
  }
}
const fail = (code, message, status) => { throw new BtError(code, message, status); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key);

function loadConfig(file = DEFAULT_CONFIG) {
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fail('INVALID_CONFIG', 'Cannot read or parse the operations config.'); }
  if (!isObject(config) || config.schemaVersion !== 1 || !isObject(config.operations) ||
      config.source !== 'https://docs.bt.cn/api/system/actions/' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(config.verifiedAt || '')) {
    fail('INVALID_CONFIG', 'Config metadata is missing or unsupported.');
  }
  const entries = Object.entries(config.operations);
  if (!entries.length) fail('INVALID_CONFIG', 'No read-only operations configured.');
  for (const [name, operation] of entries) {
    if (!own(ACTIONS, name) || !isObject(operation) || operation.method !== 'POST' ||
        operation.path !== '/system' || operation.action !== ACTIONS[name] ||
        operation.risk !== 'read-only' ||
        Object.keys(operation).sort().join(',') !== 'action,method,path,risk') {
      fail('UNSAFE_CONFIG', 'Operation is outside the code-owned read-only allowlist.');
    }
  }
  return config;
}

function createSignature(apiKey, requestTime) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n\0]/.test(apiKey)) {
    fail('MISSING_CREDENTIALS', 'Inject BT_API_KEY through a protected environment.');
  }
  if (!/^\d+$/.test(String(requestTime))) fail('INVALID_TIME', 'Use epoch seconds for request_time.');
  const md5 = value => createHash('md5').update(value, 'utf8').digest('hex');
  return md5(String(requestTime) + md5(apiKey));
}

function validateBaseUrl(raw, allowLocalHttp = false) {
  let url;
  try { url = new URL(raw); }
  catch { fail('INVALID_URL', 'BT_PANEL_URL must be a valid panel origin.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    fail('INVALID_URL', 'Use a panel origin without credentials, query, fragment or login path.');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:')) {
    fail('INSECURE_TRANSPORT', 'HTTPS is required; HTTP is allowed only for explicit loopback tests/tunnels.');
  }
  return url;
}

function redact(value, secrets) {
  let text = String(value);
  // Longest first also handles a key appearing as a substring of another secret.
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) text = text.split(form).join('[REDACTED]');
  }
  return text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512);
}

function projectResult(operation, value, secrets = []) {
  if (isObject(value) && (value.status === false || value.status === 0 || value.status === 'false' || value.success === false)) {
    fail('PANEL_REJECTED', 'Panel rejected the request; inspect credentials, permissions and state through a protected channel.');
  }
  const numeric = number => typeof number === 'number' && Number.isFinite(number);
  const mismatch = () => fail('CONTRACT_MISMATCH', 'Response does not match the expected diagnostic contract.');
  if (operation === 'system-summary') {
    if (!isObject(value) || !numeric(value.memTotal) || !numeric(value.cpuNum)) mismatch();
    const output = {};
    for (const field of ['memTotal', 'memFree', 'memBuffers', 'memCached', 'memAvailable', 'memRealUsed', 'cpuNum', 'cpuRealUsed', 'isuser']) {
      if (numeric(value[field])) output[field] = value[field];
    }
    for (const field of ['time', 'system', 'version']) {
      if (typeof value[field] === 'string') output[field] = redact(value[field], secrets);
    }
    if (typeof value.isport === 'boolean') output.isport = value.isport;
    return output;
  }
  if (operation === 'system-load') {
    if (!isObject(value) || !['one', 'five', 'fifteen'].every(field => numeric(value[field]))) mismatch();
    return Object.fromEntries(['one', 'five', 'fifteen', 'max', 'limit', 'safe']
      .filter(field => numeric(value[field])).map(field => [field, value[field]]));
  }
  if (operation === 'disk-info') {
    if (!Array.isArray(value) || value.length > 128) mismatch();
    return value.map(disk => {
      if (!isObject(disk) || typeof disk.path !== 'string' || !Array.isArray(disk.size)) mismatch();
      const output = { path: redact(disk.path, secrets) };
      for (const field of ['filesystem', 'type']) {
        if (typeof disk[field] === 'string') output[field] = redact(disk[field], secrets);
      }
      for (const field of ['size', 'inodes', 'byte_size']) {
        if (Array.isArray(disk[field])) output[field] = disk[field].slice(0, 12)
          .filter(item => numeric(item) || typeof item === 'string')
          .map(item => typeof item === 'string' ? redact(item, secrets) : item);
      }
      return output;
    });
  }
  fail('UNKNOWN_OPERATION', 'Select an operation from --list.');
}

function postOnce(url, body, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        // Reject explicitly; do not inject a second error into the socket.
        request.destroy();
      } else resolve(value);
    };
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json'
      }
    }, response => {
      response.on('error', () => finish(new BtError('NETWORK_ERROR', 'Response stream failed; raw network details were suppressed.')));
      const status = response.statusCode;
      if (status < 200 || status >= 300) {
        const code = status >= 300 && status < 400 ? 'REDIRECT_REFUSED' :
          status === 404 ? 'INTERFACE_NOT_FOUND' :
          [400, 422].includes(status) ? 'PARAMETER_ERROR' :
          [401, 403].includes(status) ? 'ACCESS_DENIED' : 'HTTP_ERROR';
        finish(new BtError(code, 'Panel returned an HTTP failure; raw response and redirect target were suppressed.', status));
        response.destroy();
        return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          finish(new BtError('RESPONSE_TOO_LARGE', 'Diagnostic response exceeded the size limit.'));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new BtError('NON_JSON_RESPONSE', 'Expected JSON; raw body was suppressed.')); }
      });
    });
    timer = setTimeout(() => finish(new BtError('REQUEST_TIMEOUT', 'The read-only request timed out; no retry was sent.')), timeoutMs);
    request.on('error', error => finish(new BtError(
      /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '') ? 'TLS_ERROR' : 'NETWORK_ERROR',
      'Connection failed; raw network details were suppressed.')));
    request.end(body);
  });
}

async function runOperation(options = {}) {
  const config = loadConfig(options.configFile);
  const operation = options.operation;
  if (!own(config.operations, operation)) fail('UNKNOWN_OPERATION', 'Select an operation from --list.');
  const mapping = config.operations[operation];
  const plan = { operation, method: mapping.method, path: mapping.path, action: mapping.action, risk: mapping.risk };
  if (!options.execute) return { ok: true, mode: 'preview', ...plan, networkRequestSent: false };
  const env = options.env || process.env;
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS_DISABLED', 'Restore TLS verification before sending panel credentials.');
  const base = validateBaseUrl(env.BT_PANEL_URL, options.allowLocalHttp);
  const requestTime = String(Math.floor(Date.now() / 1000));
  const token = createSignature(env.BT_API_KEY, requestTime);
  const body = new URLSearchParams({ action: mapping.action, request_time: requestTime, request_token: token }).toString();
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    fail('INVALID_LIMIT', 'Use a timeout up to 60000 ms and a response limit up to 1 MiB.');
  }
  const data = await postOnce(new URL(mapping.path, base), body, timeoutMs, maxBytes);
  return { ok: true, mode: 'execute', operation, data: projectResult(operation, data, [env.BT_API_KEY, token]) };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['--help', '-h'].includes(argument)) options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--allow-local-http') options.allowLocalHttp = true;
    else if (argument === '--list') options.list = true;
    else if (argument === '--validate-config') options.validateConfig = true;
    else if (argument === '--operation' || argument === '--config') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) fail('INVALID_ARGUMENT', 'An option value is missing.');
      options[argument === '--operation' ? 'operation' : 'configFile'] = args[++index];
    } else fail('INVALID_ARGUMENT', 'Unknown option; use --help. Credentials are accepted only through the environment.');
  }
  const modes = [options.list, options.validateConfig, Boolean(options.operation)].filter(Boolean).length;
  if (!options.help && (modes !== 1 || (options.execute && !options.operation))) {
    fail('INVALID_ARGUMENT', 'Select exactly one of --list, --validate-config or --operation.');
  }
  return options;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Usage: node bt-api.cjs --list | --validate-config | --operation <id> [--execute] [--allow-local-http] [--config <file>]\nDefault: preview without network. Execution reads BT_PANEL_URL and BT_API_KEY from the environment.');
    return;
  }
  const config = loadConfig(options.configFile);
  const result = options.list ? { ok: true, operations: Object.keys(config.operations) } :
    options.validateConfig ? { ok: true, configValid: true, verifiedAt: config.verifiedAt } : await runOperation(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  const safe = error instanceof BtError ? error : new BtError('INTERNAL_ERROR', 'Unexpected failure; raw details were suppressed.');
  console.error(JSON.stringify({ ok: false, code: safe.code, message: safe.message, ...(safe.httpStatus != null ? { httpStatus: safe.httpStatus } : {}) }));
  process.exitCode = 1;
});
module.exports = { BtError, loadConfig, createSignature, validateBaseUrl, projectResult, runOperation, main };

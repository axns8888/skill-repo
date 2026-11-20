'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const guide = require('../skills/axns-devflow-ext-autopilot/scripts/execution-guide.cjs');
test('architecture advice explains native effort and platform tradeoffs', () => {
  assert.equal(guide.recommend({ platform: false, channels: false, effort: true }).mode, 'dsh');
  assert.equal(guide.recommend({ platform: false, channels: true, effort: false }).mode, 'dsh');
  assert.equal(guide.recommend({ platform: false, channels: true, effort: true }).mode, 'orca');
  assert.equal(guide.recommend({ platform: true }).mode, 'orca');
});
test('offline report safely embeds configuration and uses the production decision function', () => {
  const data = { dangerous: '</script><script>injected()</script>', generated_at: new Date().toISOString() };
  const html = guide.render(data);
  assert.ok(!html.includes(data.dangerous)); assert.ok(html.includes('\\u003c') || html.includes('\u003c'));
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  // Parse the extracted real script without requiring a browser environment.
  assert.ok(script); new vm.Script(script);
  assert.ok(script.includes('function assess(snapshot)'));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const skills = ['axns-devflow'];
const directories = [
  '_doc', '_doc/demos', '_doc/scripts', '_doc/使用说明文档', '_doc/第三方插件文档',
  '_plan', '_plan/future', '_plan/guides', '_plan/ledger', '_plan/process', '_plan/prompts',
];

function fixture(t) {
  const cache = path.join(repo, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cache, 'workflow-tests-'));
  t.after(() => {
    if (path.dirname(path.resolve(dir)) !== cache) throw new Error('Unexpected cleanup path');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function run(skill, ...args) {
  return spawnSync(process.execPath, [path.join(skill, 'scripts/init-workflow.cjs'), ...args], { encoding: 'utf8' });
}
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
function snapshot(root) {
  return new Map(filesUnder(root).map(file => [path.relative(root, file), fs.readFileSync(file)]));
}
function assertLocalLinks(root) {
  for (const file of filesUnder(root).filter(file => file.endsWith('.md'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1].split('#')[0];
      if (!href || /^[a-z]+:/i.test(href)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), href)), `${path.relative(root, file)} -> ${href}`);
    }
  }
}

for (const name of skills) {
  const skill = path.join(repo, 'skills', name);
  test(`${name}: new project has the complete structure, usable resources and valid links`, t => {
    const root = path.join(fixture(t), '中文 项目');
    const projectName = '项目 $& 示例';
    const result = run(skill, '--project-root', root, '--project-name', projectName);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(root).sort(), ['_doc', '_plan']);
    for (const dir of directories) {
      assert.ok(fs.statSync(path.join(root, dir)).isDirectory(), dir);
      assert.ok(fs.statSync(path.join(root, dir, 'README.md')).size > 0, dir);
    }
    for (const file of ['_plan/flow.md', '_plan/prompts/project.md', '_plan/prompts/stages.md',
      '_plan/guides/workflow.md', '_plan/guides/quality-gates.md', '_plan/guides/task-records.md',
      '_plan/prompts/acceptance.json', '_plan/guides/acceptance.md', '_plan/guides/tool-integration.md',
      '_plan/prompts/architecture.md', '_plan/prompts/coding.md', '_plan/prompts/ui.md',
      '_plan/guides/engineering-standards.md']) {
      assert.ok(fs.statSync(path.join(root, file)).size > 0, file);
    }
    assert.ok(fs.readFileSync(path.join(root, '_plan/prompts/project.md'), 'utf8').includes(projectName));
    assert.ok(fs.readFileSync(path.join(root, '_plan/prompts/stages.md'), 'utf8').includes(`$${name}`));
    assert.ok(fs.readFileSync(path.join(root, '_plan/flow.md'), 'utf8').includes(`$${name}`));
    for (const file of filesUnder(root)) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\{\{(?:project_name|skill_name)\}\}/);
    }
    const windows = ['P0-open.md', 'P1-register.md', 'P2-execute.md', 'P3-review.md', 'P4-accept.md', 'P5-escalate.md'];
    assert.deepEqual(fs.readdirSync(path.join(root, '_plan/prompts/window')).sort(), windows);
    for (const runtime of ['.worktrees', '_plan/active', '_plan/archive', '_plan/registry.jsonl', '_plan/.active_plan']) {
      assert.ok(!fs.existsSync(path.join(root, runtime)), runtime);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '_plan/prompts/acceptance.json'), 'utf8')),
      { version: 1, human_acceptance: { enabled: false, blocking: false } });
    assert.match(fs.readFileSync(path.join(root, '_plan/guides/tool-integration.md'), 'utf8'), /原生任务清单|编程器原生 Todo/);
    assertLocalLinks(root);
  });

  test(`${name}: reruns preserve user changes and unrelated work, and restore missing files`, t => {
    const root = path.join(fixture(t), 'existing');
    fs.mkdirSync(root);
    const original = Buffer.from([0xef, 0xbb, 0xbf, 0x31, 0x0d, 0x0a]);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), original);
    fs.mkdirSync(path.join(root, '_plan'));
    fs.writeFileSync(path.join(root, '_plan/README.md'), original);
    fs.writeFileSync(path.join(root, 'business.txt'), 'unchanged');
    assert.equal(run(skill, '--project-root', root).status, 0);
    assert.deepEqual(fs.readFileSync(path.join(root, '_plan/README.md')), original);
    fs.appendFileSync(path.join(root, '_plan/prompts/project.md'), '\n用户已填写的项目约定\n');
    fs.writeFileSync(path.join(root, '_plan/prompts/acceptance.json'),
      JSON.stringify({ version: 1, human_acceptance: { enabled: true, blocking: true } }));
    const before = snapshot(root);
    assert.equal(run(skill, '--project-root', root, '--project-name', 'another name').status, 0);
    assert.deepEqual(snapshot(root), before);
    fs.unlinkSync(path.join(root, '_plan/flow.md'));
    assert.equal(run(skill, '--project-root', root).status, 0);
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(fs.readFileSync(path.join(root, 'AGENTS.md')), original);
  });

  test(`${name}: upgrading an older workflow adds engineering resources without replacing current rules`, t => {
    const root = path.join(fixture(t), 'older-project');
    assert.equal(run(skill, '--project-root', root).status, 0);
    const additions = ['_plan/prompts/architecture.md', '_plan/prompts/coding.md',
      '_plan/guides/engineering-standards.md'];
    for (const file of additions) fs.unlinkSync(path.join(root, file));
    fs.writeFileSync(path.join(root, '_plan/prompts/project.md'), '现行基线见 project_v02.md\r\n');
    fs.writeFileSync(path.join(root, '_plan/prompts/project_v02.md'), '项目已有命名、注释和模块规范\r\n');
    fs.writeFileSync(path.join(root, '_plan/prompts/ui.md'), '已有 UI 规范及用户决定\r\n');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '本项目读取 project_v02.md\r\n');
    const before = snapshot(root);
    const result = run(skill, '--project-root', root);
    assert.equal(result.status, 0, result.stderr);
    for (const [file, content] of before) {
      assert.deepEqual(fs.readFileSync(path.join(root, file)), content, file);
    }
    for (const file of additions) assert.ok(fs.statSync(path.join(root, file)).size > 0, file);
    assert.equal(snapshot(root).size, before.size + additions.length);
    assertLocalLinks(root);
  });

  test(`${name}: dry-run never creates a new root or changes an existing project`, t => {
    const root = path.join(fixture(t), 'preview');
    assert.equal(run(skill, '--project-root', root, '--dry-run').status, 0);
    assert.ok(!fs.existsSync(root));
    assert.equal(run(skill, '--project-root', root).status, 0);
    const before = snapshot(root);
    assert.equal(run(skill, '--project-root', root, '--dry-run').status, 0);
    assert.deepEqual(snapshot(root), before);
  });

  test(`${name}: path conflicts fail before creating any workflow files`, t => {
    const root = path.join(fixture(t), 'conflict');
    fs.mkdirSync(path.join(root, '_plan/prompts'), { recursive: true });
    fs.writeFileSync(path.join(root, '_plan/prompts/project.md'), 'existing project');
    fs.writeFileSync(path.join(root, '_plan/guides'), 'a file blocks the directory');
    const before = snapshot(root);
    assert.notEqual(run(skill, '--project-root', root).status, 0);
    assert.deepEqual(snapshot(root), before);
    assert.ok(!fs.existsSync(path.join(root, '_doc')));
  });

  test(`${name}: copied skill can initialize independently of the repository`, t => {
    const temp = fixture(t);
    const copied = path.join(temp, '可分享 技能');
    fs.cpSync(skill, copied, { recursive: true });
    const root = path.join(temp, '独立项目');
    const result = run(copied, '--project-root', root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '_plan/prompts/acceptance.json'), 'utf8')),
      { version: 1, human_acceptance: { enabled: false, blocking: false } });
    assertLocalLinks(root);
  });

  test(`${name}: missing and invalid arguments fail without side effects`, t => {
    const root = path.join(fixture(t), 'untouched');
    for (const args of [[], ['--project-root'], ['--unknown'],
      ['--project-root', root, '--project-name', ''], ['--project-root', root, '--project-name', 'two\nlines']]) {
      assert.notEqual(run(skill, ...args).status, 0, JSON.stringify(args));
      assert.ok(!fs.existsSync(root));
    }
    assert.equal(run(skill, '--help').status, 0);
  });
}

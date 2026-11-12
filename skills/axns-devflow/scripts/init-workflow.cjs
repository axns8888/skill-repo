#!/usr/bin/env node
'use strict';

// Initialize a project workflow using only resources shipped with this skill.
const fs = require('node:fs');
const path = require('node:path');

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--project-root' || arg === '--project-name') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要一个值`);
      result[arg === '--project-root' ? 'root' : 'name'] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!result.help && (!result.root || !result.root.trim())) {
    throw new Error('请通过 --project-root 明确指定目标项目目录');
  }
  if (result.name !== undefined && (!result.name.trim() || /[\r\n]/.test(result.name))) {
    throw new Error('--project-name 需要非空的单行项目名称');
  }
  return result;
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function initialize(opts) {
  const skill = path.resolve(__dirname, '..');
  const root = path.resolve(opts.root);
  const name = opts.name || path.basename(root);
  const skillName = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8').match(/^name:\s*(\S+)\s*$/m)[1];
  const templates = path.join(skill, 'assets', 'workflow');
  const sources = filesUnder(templates).map(source => [source, path.relative(templates, source)]);
  sources.push(
    [path.join(skill, 'assets', 'project-baseline.md'), '_plan/prompts/project.md'],
    [path.join(skill, 'assets', 'task-records.md'), '_plan/guides/task-records.md'],
    [path.join(skill, 'references', 'prompt-kit.md'), '_plan/prompts/stages.md'],
    [path.join(skill, 'references', 'workflow.md'), '_plan/guides/workflow.md'],
    [path.join(skill, 'references', 'project-layout.md'), '_plan/guides/project-layout.md'],
    [path.join(skill, 'references', 'quality-gates.md'), '_plan/guides/quality-gates.md'],
  );
  const destinations = new Map(sources.map(([source, target]) => [source, path.join(root, target)]));
  const plan = sources.map(([source, relative]) => {
    const target = path.join(root, relative);
    let content = fs.readFileSync(source, 'utf8')
      .replace(/\{\{project_name\}\}|〈项目名称〉/g, () => name)
      .replace(/\{\{skill_name\}\}/g, () => skillName);
    // Resource links must remain valid after the files move from a skill into a project.
    content = content.replace(/\]\(([^)]+)\)/g, (match, href) => {
      const [link, anchor] = href.split('#', 2);
      const mapped = destinations.get(path.resolve(path.dirname(source), link));
      if (!mapped) return match;
      const rewritten = path.relative(path.dirname(target), mapped).split(path.sep).join('/');
      return `](${rewritten}${anchor ? `#${anchor}` : ''})`;
    });
    return { target, relative, content };
  });

  // Preflight all paths before writing: an existing file is preserved, a type conflict is reported.
  const directories = new Set([root]);
  for (const { target } of plan) {
    for (let parent = path.dirname(target); parent !== path.dirname(root); parent = path.dirname(parent)) {
      directories.add(parent);
      if (parent === root) break;
    }
  }
  for (const directory of directories) {
    const info = stat(directory);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`目录位置存在文件或链接，请先核实：${directory}`);
    }
  }
  for (const { target } of plan) {
    const info = stat(target);
    if (info && !info.isFile()) throw new Error(`文件位置存在目录或链接，请先核实：${target}`);
  }

  let created = 0;
  let skipped = 0;
  for (const { target, relative, content } of plan) {
    if (stat(target)) {
      skipped += 1;
      console.log(`保留 ${relative}`);
      continue;
    }
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        skipped += 1;
        console.log(`保留 ${relative}`);
        continue;
      }
    }
    created += 1;
    console.log(`${opts.dryRun ? '将创建' : '创建'} ${relative}`);
  }
  console.log(`${opts.dryRun ? '预览' : '完成'}：${created} 个新文件，保留 ${skipped} 个已有文件。项目：${root}`);
  console.log('下一步：核实 _plan/prompts/project.md，选择 _plan/prompts/stages.md 中的阶段指令。');
}

try {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    console.log('用法：node init-workflow.cjs --project-root <项目路径> [--project-name <名称>] [--dry-run]');
    console.log('仅补齐 _doc 与 _plan 开发流程；已有文件始终保留。无需安装第三方依赖。');
  } else initialize(opts);
} catch (error) {
  console.error(`初始化失败：${error.message}`);
  process.exitCode = 1;
}

#!/usr/bin/env node
/** Initialize per-project configs and coordinate the axns-copyright skills. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SKILL_DIR = path.resolve(__dirname, "..");
const KINDS = ["doc", "code", "intro"];
const DEFAULT_EXT = [".vue", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".sql", ".scss", ".css", ".html", ".json"];
const PRESETS = {
  web: { paths: "apps/server:40,apps/web/src:60", shotDir: "Screenshot-web" },
  h5: { paths: "apps/server:40,apps/h5/src:60", shotDir: "Screenshot-h5" },
  custom: { shotDir: "Screenshot" }
};

function help() {
  console.log(`Usage: node <SKILL_DIR>/scripts/cli.js <init|generator> [options]

Common:
  --root <dir>             Target repository (default: cwd)
  --out-dir <dir>          Config/output directory (default: _doc/软著申请)
  --project-name <name>    Required for init; inferred only for a single project
  --help                  Show help

init:
  --preset web|h5|custom   Default: custom; custom requires --paths
  --paths "src:60,api:40"  Source directories, optionally weighted
  --shot-dir <dir>        Screenshot directory name
  --version <version>     Default: V1.0
  --ext ".js,.ts,.py"      Source extensions
  --no-intro              Omit intro config
  --force                 Overwrite existing configs

generator:
  --only all|doc|code|intro Default: all
  --skip-code-run          Validate configs and print tasks without code export
  --skills-dir <dir>       Parent of the installed sibling skill directories

The generator exports code DOCX; an agent must write intro/manual content,
prepare authenticated screenshots, and run the manual export afterward.`);
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const command = argv.shift();
  if (!["init", "generator"].includes(command)) throw new Error("请指定 init 或 generator；使用 --help 查看用法。");
  const opts = { command, root: process.cwd(), outDir: "_doc/软著申请", preset: "custom", version: "V1.0", only: "all", skillsDir: path.dirname(SKILL_DIR) };
  const values = { "--root": "root", "--out-dir": "outDir", "--project-name": "projectName", "--preset": "preset", "--paths": "paths", "--shot-dir": "shotDir", "--version": "version", "--ext": "ext", "--only": "only", "--skills-dir": "skillsDir" };
  const flags = { "--force": "force", "--no-intro": "noIntro", "--skip-code-run": "skipCodeRun" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) opts[flags[arg]] = true;
    else if (values[arg]) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`参数 ${arg} 缺少值。`);
      opts[values[arg]] = argv[++i];
    } else throw new Error(`未知参数：${arg}`);
  }
  opts.root = path.resolve(opts.root);
  opts.outDir = path.resolve(opts.root, opts.outDir);
  opts.skillsDir = path.resolve(opts.skillsDir);
  if (!fs.statSync(opts.root).isDirectory()) throw new Error("--root 必须是现有目录。");
  if (opts.projectName) validateName(opts.projectName);
  return opts;
}

function validateName(name) {
  if (!name.trim() || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name === "." || name === "..") {
    throw new Error("项目名称不能为空，且不能包含路径分隔符、Windows 文件名非法字符或结尾的点/空格。");
  }
}

function sourcePaths(raw) {
  const entries = raw.split(",").map(s => s.trim()).filter(Boolean).map(s => {
    const weighted = s.match(/^(.*):(\d+(?:\.\d+)?)$/);
    if (!weighted) return { path: s };
    if (!weighted[1] || Number(weighted[2]) <= 0) throw new Error(`无效路径权重：${s}`);
    return { path: weighted[1], weight: Number(weighted[2]) };
  });
  if (!entries.length) throw new Error("--paths 至少需要一个源码目录。");
  const weights = entries.filter(e => e.weight != null).map(e => e.weight);
  if (weights.length && weights.length !== entries.length) throw new Error("路径权重应全部指定或全部省略。");
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total > (weights.every(w => w <= 1) ? 1 : 100) + 1e-8) throw new Error("路径权重之和不能超过 100%（或小数 1）。");
  return entries;
}

function section(title, value) {
  return `## 配置：${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function configPath(opts, kind) {
  return path.join(opts.outDir, `${opts.projectName}-ruanzhu-${kind}-config.md`);
}

function init(opts) {
  if (!opts.projectName) throw new Error("init 必须指定 --project-name。");
  const preset = PRESETS[opts.preset];
  if (!preset) throw new Error("--preset 仅支持 web、h5 或 custom。");
  if (!opts.paths && !preset.paths) throw new Error("custom preset 必须指定 --paths。");
  const paths = sourcePaths(opts.paths || preset.paths);
  const extensions = opts.ext ? opts.ext.split(",").map(e => e.trim().toLowerCase()).filter(Boolean).map(e => e.startsWith(".") ? e : `.${e}`) : DEFAULT_EXT;
  if (!extensions.length) throw new Error("--ext 至少需要一个后缀。");
  const vars = { projectName: opts.projectName, version: opts.version, shotDir: opts.shotDir || preset.shotDir };
  const template = fs.readFileSync(path.join(SKILL_DIR, "templates", "doc-config.template.md"), "utf8");
  const doc = template.replace(/\{\{(projectName|version|shotDir)\}\}/g, (_, key) => JSON.stringify(vars[key]).slice(1, -1));
  const relativeOut = path.relative(opts.root, opts.outDir).replace(/\\/g, "/");
  const style = { version: opts.version, header: { template: "{projectName}  {version}" }, footer: { template: "{page}" }, code: { body: { font: "Times New Roman", sizePt: 12 } } };
  const code = {
    projectName: opts.projectName, version: opts.version, paths, extensions,
    excludeDirs: ["node_modules", "dist", ".git", "__pycache__", ".venv", "coverage"],
    excludeFiles: ["__init__.py"], pages: 60, linesPerPage: 50, mode: "head-tail",
    stripBlank: false, stripComments: true, shuffle: false,
    out: path.posix.join(relativeOut, `${opts.projectName}-源码文档-v1.docx`)
  };
  const intro = { projectName: opts.projectName, version: opts.version, preset: opts.preset, paths: paths.map(e => e.path), extensions, out: path.posix.join(relativeOut, `${opts.projectName}-软著登记信息.md`) };
  const files = [
    { kind: "doc", content: doc },
    { kind: "code", content: `# ruanzhu-code-config — ${opts.projectName}\n\n${section("code", code)}\n${section("docx-style", style)}` },
    ...(!opts.noIntro ? [{ kind: "intro", content: `# ruanzhu-intro-config — ${opts.projectName}\n\n${section("intro", intro)}` }] : [])
  ];
  fs.mkdirSync(opts.outDir, { recursive: true });
  for (const file of files) {
    const target = configPath(opts, file.kind);
    if (!opts.force && fs.existsSync(target)) { console.log(`保留已有配置：${target}`); continue; }
    fs.writeFileSync(target, file.content, { encoding: "utf8", flag: opts.force ? "w" : "wx" });
    console.log(`已创建配置：${target}`);
  }
  for (const entry of paths) {
    if (!fs.existsSync(path.resolve(opts.root, entry.path))) console.warn(`警告：源码路径不存在，请编辑配置：${entry.path}`);
  }
}

function readConfig(file, kind) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const block = text.split(/^#{1,6}\s+/m).find(s => s.split("\n")[0].trim() === `配置：${kind}`);
  const json = block && block.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!json) throw new Error(`配置缺少「配置：${kind}」JSON：${file}`);
  const config = JSON.parse(json[1]);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`配置必须是 JSON 对象：${file}`);
  return config;
}

function generator(opts) {
  if (opts.only !== "all" && !KINDS.includes(opts.only)) throw new Error("--only 仅支持 all、doc、code 或 intro。");
  const selected = opts.only === "all" ? KINDS : [opts.only];
  if (!opts.projectName) {
    const projects = new Set();
    for (const file of fs.readdirSync(opts.outDir)) {
      for (const kind of selected) {
        const suffix = `-ruanzhu-${kind}-config.md`;
        if (file.endsWith(suffix)) projects.add(file.slice(0, -suffix.length));
      }
    }
    if (projects.size !== 1) throw new Error("无法唯一确定项目，请显式指定 --project-name。");
    opts.projectName = [...projects][0];
    validateName(opts.projectName);
  }
  const tasks = selected.map(kind => {
    const file = configPath(opts, kind);
    const config = readConfig(file, kind);
    if (config.projectName !== opts.projectName) throw new Error(`项目名称与配置不一致：${file}`);
    const skill = path.join(opts.skillsDir, `axns-copyright-gen-${kind}`);
    if (!fs.existsSync(path.join(skill, "SKILL.md"))) throw new Error(`缺少子技能 axns-copyright-gen-${kind}。请一起安装所需子技能，或用 --skills-dir 指定其父目录。`);
    return { kind, file, config, skill };
  });
  // Validate every selected config/dependency before executing any subprocess.
  const codeTask = tasks.find(task => task.kind === "code");
  if (codeTask && !opts.skipCodeRun) {
    const script = path.join(codeTask.skill, "scripts", "generate-code-doc.js");
    if (!fs.existsSync(script)) throw new Error(`缺少源码导出脚本：${script}`);
    if (!Array.isArray(codeTask.config.paths) || !codeTask.config.paths.length) throw new Error("code 配置缺少 paths。");
    for (const entry of codeTask.config.paths) {
      const source = path.resolve(opts.root, typeof entry === "string" ? entry : entry.path);
      if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`源码目录不存在：${source}`);
    }
    const result = spawnSync(process.execPath, [script, "--root", opts.root, "--config", codeTask.file], { cwd: opts.root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`源码文档生成失败，退出码：${result.status}`);
  }
  for (const task of tasks) {
    console.log(`\n[${task.kind}] 配置：${task.file}\n技能说明：${path.join(task.skill, "SKILL.md")}`);
    if (task.kind === "code") console.log(opts.skipCodeRun ? "待办：运行 generate-code-doc.js 导出源码 Word。" : "源码 Word 已生成；请根据运行摘要核对页数与范围。");
    if (task.kind === "intro") console.log("Agent 待办：读取 intro 配置并盘点实际功能，用 count-source-lines.js 统计源程序量，再撰写并检查登记信息字段。尚未生成登记信息正文。");
    if (task.kind === "doc") console.log("Agent 待办：盘点功能、撰写 Markdown 手册、准备截图环境、复制模板并安装 docx/playwright，完成截图与 Word 嵌图导出。尚未生成操作手册。");
  }
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) help();
  else if (opts.command === "init") init(opts);
  else generator(opts);
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
}

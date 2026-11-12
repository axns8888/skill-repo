#!/usr/bin/env node
/**
 * 软著登记「源程序量」统计：按路径与后缀汇总行数。
 *
 * Usage:
 *   node count-source-lines.js --root <repo> --paths "a,b" [--ext ".vue,.ts,.py"]
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_EXT = [
  ".vue",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sql",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".json",
];

const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".pytest_cache",
  "unpackage",
  ".turbo",
  ".next",
  "target",
  "vendor",
]);

function parseArgs(argv) {
  const out = {
    root: process.cwd(),
    paths: [],
    ext: DEFAULT_EXT,
    excludeDirs: [...DEFAULT_EXCLUDE_DIRS],
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--root") out.root = path.resolve(next());
    else if (a === "--paths")
      out.paths = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === "--ext")
      out.ext = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`));
    else if (a === "--exclude-dirs")
      out.excludeDirs = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node count-source-lines.js --root <repo> --paths "dir1,dir2" [options]

Options:
  --ext ".vue,.ts,.py"     File extensions (default: common web/backend)
  --exclude-dirs "a,b"     Extra/override exclude directory names
  --json                   Print JSON only
  --help                   Show help
`);
}

function walk(dir, extSet, exclude, acc) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (exclude.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, extSet, exclude, acc);
    else {
      const ext = path.extname(e.name).toLowerCase();
      if (!extSet.has(ext)) continue;
      let text;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        continue;
      }
      // A terminal newline ends the last physical line; it does not add a line.
      const lines = text.length === 0 ? 0
        : text.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(text) ? 1 : 0);
      acc.total += lines;
      acc.files += 1;
      acc.byExt[ext] = (acc.byExt[ext] || 0) + lines;
    }
  }
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.paths.length) {
    console.error("Error: --paths is required (comma-separated relative to --root)");
    printHelp();
    process.exit(1);
  }
  const extSet = new Set(opts.ext);
  const exclude = new Set(opts.excludeDirs);
  const acc = { total: 0, files: 0, byExt: {} };
  const resolved = [];
  for (const rel of opts.paths) {
    const abs = path.resolve(opts.root, rel);
    if (!fs.existsSync(abs)) {
      console.error(`Warn: path not found: ${abs}`);
      continue;
    }
    resolved.push(path.relative(opts.root, abs) || ".");
    walk(abs, extSet, exclude, acc);
  }
  const result = {
    root: opts.root,
    paths: resolved,
    extensions: [...extSet],
    total: acc.total,
    files: acc.files,
    byExt: acc.byExt,
  };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`源程序量: ${result.total}`);
    console.log(`文件数: ${result.files}`);
    console.log(`路径: ${result.paths.join(", ") || "(none)"}`);
    console.log("按后缀:");
    for (const [k, v] of Object.entries(result.byExt).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
  }
}

main();

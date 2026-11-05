#!/usr/bin/env node
/**
 * 软著程序鉴别材料（源码 Word）生成器
 * 版权局惯例：
 * - 每页不少于 50 行有效代码
 * - 一般提交前、后各连续 30 页，合计 60 页（约 3000 有效行）
 * - 全文不足 60 页则提交全部
 * - 有效行数 > 50 时保留空行（不删空行）；分页按有效行计
 */
const fs = require("fs");
const path = require("path");
const {
  loadDocxStyle,
  loadCodeDocConfig,
  writeRunSummaryToMd,
  textRunOpts,
  alignOf,
  buildTemplateRuns
} = require("./docx-style");

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    softName: "未命名项目",
    projectName: null,
    version: "V1.0",
    paths: [],
    ext: [],
    pages: 60,
    linesPerPage: 50,
    shuffle: false,
    seed: null,
    mode: "head-tail",
    stripBlank: false,
    stripComments: true,
    writeTxt: false,
    out: null,
    config: null,
    style: null
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--root") args.root = path.resolve(next());
    else if (a === "--soft-name" || a === "--project-name") args.softName = next();
    else if (a === "--version") args.version = next();
    else if (a === "--paths") args.paths = next().split(/[,;]/).map(s => s.trim()).filter(Boolean);
    else if (a === "--ext" || a === "--suffix") {
      args.ext = next()
        .split(/[,;]/)
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
        .map(s => (s.startsWith(".") ? s : `.${s}`));
    } else if (a === "--pages") args.pages = Math.max(1, parseInt(next(), 10) || 60);
    else if (a === "--lines-per-page") args.linesPerPage = Math.max(50, parseInt(next(), 10) || 50);
    else if (a === "--strip-blank") {
      const v = (next() || "true").toLowerCase();
      args.stripBlank = !(v === "false" || v === "0" || v === "no" || v === "否");
    } else if (a === "--strip-comments") {
      const v = (next() || "true").toLowerCase();
      args.stripComments = !(v === "false" || v === "0" || v === "no" || v === "否");
    }
    else if (a === "--shuffle") {
      const v = (next() || "true").toLowerCase();
      args.shuffle = v === "true" || v === "1" || v === "yes" || v === "是";
    } else if (a === "--seed") args.seed = next();
    else if (a === "--mode") args.mode = next();
    else if (a === "--out") args.out = next();
    else if (a === "--config") args.config = next();
    else if (a === "--style") args.style = next();
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function applyConfigObject(args, raw) {
  if (!raw) return args;
  if (raw.projectName || raw.softName) args.softName = raw.projectName || raw.softName;
  if (raw.version) args.version = raw.version;
  if (raw.paths) args.paths = raw.paths;
  if (raw.extensions) {
    args.ext = raw.extensions.map(s => {
      s = String(s).trim().toLowerCase();
      return s.startsWith(".") ? s : `.${s}`;
    });
  }
  if (raw.pages != null) args.pages = raw.pages;
  if (raw.linesPerPage != null) args.linesPerPage = Math.max(50, Number(raw.linesPerPage) || 50);
  if (raw.shuffle != null) args.shuffle = !!raw.shuffle;
  if (raw.seed != null) args.seed = String(raw.seed);
  if (raw.mode) args.mode = raw.mode;
  if (raw.stripBlank != null) args.stripBlank = !!raw.stripBlank;
  if (raw.stripComments != null) args.stripComments = !!raw.stripComments;
  if (raw.writeTxt != null) args.writeTxt = !!raw.writeTxt;
  if (raw.out) args.out = raw.out;
  if (raw.styleFile || raw.stylePath) args.style = raw.styleFile || raw.stylePath;
  if (raw.style && typeof raw.style === "object") args.inlineStyle = raw.style;
  // 忽略：目录名 / 文件名（basename 或简单 glob）
  if (raw.excludeDirs || raw.ignoreDirs) {
    args.excludeDirs = [...(raw.excludeDirs || raw.ignoreDirs)];
  }
  if (raw.excludeFiles || raw.ignoreFiles) {
    args.excludeFiles = [...(raw.excludeFiles || raw.ignoreFiles)];
  }
  if (Array.isArray(raw.ignore)) {
    // 混合列表：带 / 或像目录的进 dirs，其余当文件名
    args.excludeDirs = args.excludeDirs || [];
    args.excludeFiles = args.excludeFiles || [];
    for (const item of raw.ignore) {
      const s = String(item).trim();
      if (!s) continue;
      if (s.includes("/") || s.includes("\\") || (!s.includes(".") && !s.includes("*"))) {
        args.excludeDirs.push(s.replace(/\\/g, "/").split("/").filter(Boolean).pop());
      } else {
        args.excludeFiles.push(s);
      }
    }
  }
  return args;
}

function loadConfig(args) {
  // --config 须指向本次任务的 *-ruanzhu-code-config.md（多项目时一对一）
  // CLI 显式传入的项优先生效（便于临时改输出路径等）
  const cliOut = args.out;
  const raw = loadCodeDocConfig(args.root, { configFile: args.config || undefined });
  if (raw) {
    args._configFrom = raw._loadedFrom;
    args._configFile = raw._configFile;
    applyConfigObject(args, raw);
  }
  if (cliOut) args.out = cliOut;
  return args;
}

const DEFAULT_EXT = [
  ".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".go", ".cs", ".rs", ".php", ".kt",
  ".sql", ".scss", ".sass", ".less", ".css", ".html", ".json"
];

const DEFAULT_EXCLUDE_DIR = [
  "node_modules", ".git", "dist", "build", ".venv", "venv", "coverage",
  ".next", "target", "vendor", ".docx-tools", "Screenshot-web", "Screenshot-h5",
  "__pycache__", ".idea", ".vscode", "pods", "deriveddata", "out", ".turbo",
  ".nuxt", ".output", "storybook-static", "playwright-report", "test-results"
];

/** 默认忽略的无意义文件（basename；可被配置追加） */
const DEFAULT_EXCLUDE_FILES = ["__init__.py"];

function compileNameMatcher(patterns) {
  const list = (patterns || []).map(s => String(s).trim()).filter(Boolean);
  return name => {
    const base = path.basename(name);
    for (const pat of list) {
      if (pat === base || pat === name) return true;
      // 简单 glob：* ?
      if (/[*?]/.test(pat)) {
        const re = new RegExp(
          "^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          "i"
        );
        if (re.test(base)) return true;
      }
    }
    return false;
  };
}

/**
 * 规范化 paths：
 * - ["a","b"] → 均分权重
 * - [{path, weight:40},…] → 百分数（>1 视为百分数）；之和不得超过 100
 * - weight 也可用 0.4 小数，之和不得超过 1
 */
function normalizePathEntries(paths) {
  const raw = (paths || []).map(p => {
    if (typeof p === "string") return { path: p, weight: null };
    if (p && typeof p === "object") {
      const w = p.weight != null ? p.weight : p.ratio != null ? p.ratio : p.percent;
      return { path: p.path || p.dir || p.root, weight: w == null ? null : Number(w) };
    }
    return null;
  }).filter(e => e && e.path);

  if (!raw.length) return [];

  const specified = raw.filter(e => e.weight != null && !Number.isNaN(e.weight));
  if (!specified.length) {
    const even = 1 / raw.length;
    return raw.map(e => ({ path: e.path, weight: even, weightLabel: "equal" }));
  }
  if (specified.length !== raw.length) {
    throw new Error("paths 若使用 weight，则每一项都必须配置 weight（或全部省略以均分）");
  }

  const vals = raw.map(e => e.weight);
  const asPercent = vals.some(w => w > 1);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (asPercent) {
    if (sum > 100 + 1e-6) {
      throw new Error(`paths 权重之和为 ${sum}%，不得超过 100%`);
    }
    if (sum <= 0) throw new Error("paths 权重之和必须 > 0");
    // 按绝对占比占 need；若不足 100%，剩余在回填阶段仍按相对权重从各目录取
    return raw.map(e => ({
      path: e.path,
      weight: e.weight / 100,
      weightLabel: `${e.weight}%`
    }));
  }
  if (sum > 1 + 1e-6) {
    throw new Error(`paths 小数权重之和为 ${sum}，不得超过 1`);
  }
  if (sum <= 0) throw new Error("paths 权重之和必须 > 0");
  return raw.map(e => ({
    path: e.path,
    weight: e.weight,
    weightLabel: String(e.weight)
  }));
}

/** 把 remaining 行按 idxs 的相对权重分到各目录（受 left 容量限制），返回本轮实际分配总和 */
function distributeRound(quotas, left, weights, idxs, remaining) {
  if (!idxs.length || remaining <= 0) return 0;
  const wsum = idxs.reduce((s, i) => s + weights[i], 0);
  if (wsum <= 0) return 0;

  const shares = idxs.map(i => {
    const ideal = (remaining * weights[i]) / wsum;
    return { i, n: Math.floor(ideal), frac: ideal - Math.floor(ideal) };
  });
  let used = shares.reduce((s, x) => s + x.n, 0);
  let rem = remaining - used;
  shares.sort((a, b) => b.frac - a.frac);
  for (const s of shares) {
    if (rem <= 0) break;
    s.n += 1;
    rem -= 1;
  }

  let assigned = 0;
  for (const s of shares) {
    const take = Math.min(s.n, left[s.i]);
    quotas[s.i] += take;
    left[s.i] -= take;
    assigned += take;
  }
  return assigned;
}

/**
 * 按权重分配行数：
 * 1) 先按绝对占比（weight 已是相对 need 的小数）尝试配额；
 * 2) 某目录不足则取其全部，缺口 + 未用满的 need 按「仍有余量的目录」之权重回填。
 */
function allocateQuotas(capacities, weights, need) {
  const n = capacities.length;
  const quotas = Array(n).fill(0);
  const left = capacities.map(c => Math.max(0, c));
  let remaining = need;

  // 第一轮：绝对占比（之和可 < 1；未声明的余量留到回填）
  const all = [];
  for (let i = 0; i < n; i++) if (weights[i] > 0) all.push(i);
  // 按 need*weight 分配（不是 renormalize）
  if (all.length) {
    const shares = all.map(i => {
      const ideal = need * weights[i];
      return { i, n: Math.floor(ideal), frac: ideal - Math.floor(ideal) };
    });
    let used = shares.reduce((s, x) => s + x.n, 0);
    const absBudget = Math.min(
      need,
      Math.round(need * Math.min(1, weights.reduce((a, b) => a + b, 0)))
    );
    let rem = Math.max(0, absBudget - used);
    shares.sort((a, b) => b.frac - a.frac);
    for (const s of shares) {
      if (rem <= 0) break;
      s.n += 1;
      rem -= 1;
    }
    for (const s of shares) {
      const take = Math.min(s.n, left[s.i]);
      quotas[s.i] += take;
      left[s.i] -= take;
      remaining -= take;
    }
  }

  // 回填：目录不足留下的缺口，按仍有容量的目录权重继续分
  for (let round = 0; round < n + 3 && remaining > 0; round++) {
    const idxs = [];
    for (let i = 0; i < n; i++) if (left[i] > 0 && weights[i] > 0) idxs.push(i);
    if (!idxs.length) break;
    const got = distributeRound(quotas, left, weights, idxs, remaining);
    remaining -= got;
    if (got === 0) break;
  }
  return quotas;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function walkFiles(dir, exts, out, opts = {}) {
  const excludeDir = opts.excludeDir || (() => false);
  const excludeFile = opts.excludeFile || (() => false);
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const name = ent.name;
    const full = path.join(dir, name);
    if (ent.isDirectory()) {
      if (excludeDir(name) || excludeDir(name.toLowerCase())) continue;
      walkFiles(full, exts, out, opts);
    } else if (ent.isFile()) {
      if (excludeFile(name)) continue;
      const ext = path.extname(name).toLowerCase();
      if (!exts.includes(ext)) continue;
      // skip lock / min / map
      if (/\.min\.(js|css)$/i.test(name)) continue;
      if (/\.map$/i.test(name)) continue;
      if (/package-lock|pnpm-lock|yarn\.lock|uv\.lock/i.test(name)) continue;
      out.push(full);
    }
  }
}

function shuffleArray(arr, seedStr) {
  const rnd = mulberry32(hashSeed(String(seedStr)));
  const ordered = [...arr];
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return ordered;
}

/** 去掉块注释与 HTML/Vue 注释（跨行） */
function stripBlockComments(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function isBlankLine(line) {
  return !String(line ?? "").trim();
}

/** 纯注释行（不含空行、不含 FILE 分隔标记） */
function isCommentOnlyLine(line) {
  const trim = String(line ?? "").trim();
  if (!trim) return false;
  if (/^\/\/\s*===== FILE:/.test(trim)) return false;
  if (/^\/\//.test(trim)) return true;
  if (/^#(?!!)/.test(trim)) return true;
  if (/^--\s/.test(trim) || trim === "--") return true;
  if (/^;/.test(trim)) return true;
  if (/^\*+\/?/.test(trim)) return true;
  if (/^<!--/.test(trim)) return true;
  return false;
}

/** 有效代码行：非空且非纯注释 */
function isEffectiveLine(line) {
  // Generated file separators identify sources; they are not source code.
  if (/^\/\/\s*===== FILE:/.test(String(line ?? "").trim())) return false;
  if (isBlankLine(line)) return false;
  if (isCommentOnlyLine(line)) return false;
  return true;
}

function countEffective(lines) {
  let n = 0;
  for (const line of lines) if (isEffectiveLine(line)) n++;
  return n;
}

function dropBlankLines(lines) {
  return lines.filter(l => !isBlankLine(l));
}

/** 连续空行压缩为最多 maxRun 行，避免版面大片空白 */
function collapseConsecutiveBlanks(lines, maxRun = 1) {
  const out = [];
  let run = 0;
  for (const line of lines) {
    if (isBlankLine(line)) {
      run++;
      if (run <= maxRun) out.push("");
      continue;
    }
    run = 0;
    out.push(line);
  }
  return out;
}

/**
 * 读入文档行。注释可去；空行：由调用方按「有效行数 > 50 则保留」决定。
 */
function toDocLines(bodyLines, rel, opts = {}) {
  const stripComments = opts.stripComments !== false;
  const stripBlank = !!opts.stripBlank;
  const lines = [];
  if (rel) lines.push(`// ===== FILE: ${rel} =====`);
  for (const line of bodyLines) {
    const clipped = line.length > 120 ? line.slice(0, 117) + "..." : line;
    if (isBlankLine(clipped)) {
      if (!stripBlank) lines.push("");
      continue;
    }
    if (stripComments && isCommentOnlyLine(clipped)) continue;
    lines.push(clipped);
  }
  return lines;
}

function readFileLines(file, root, opts = {}) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (opts.stripComments !== false) text = stripBlockComments(text);
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const body = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (body.length && body[body.length - 1] === "") body.pop();
  return toDocLines(body, rel, opts);
}

/** 从开头取至满 n 行有效代码（含其间空行） */
function takeHeadByEffective(lines, n) {
  if (n <= 0) return [];
  let eff = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isEffectiveLine(lines[i])) eff++;
    if (eff >= n) return lines.slice(0, i + 1);
  }
  return lines.slice();
}

/** 从末尾取至满 n 行有效代码（含其间空行） */
function takeTailByEffective(lines, n) {
  if (n <= 0) return [];
  let eff = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isEffectiveLine(lines[i])) eff++;
    if (eff >= n) return lines.slice(i);
  }
  return lines.slice();
}

/**
 * 按有效行配额截取。head-tail：前/后各连续半额有效行（保留空行）。
 * 有效行不足 need：整份提交。
 */
function selectLines(allLines, need, mode) {
  const totalEff = countEffective(allLines);
  if (totalEff <= need) {
    return {
      lines: allLines,
      truncated: false,
      shortfall: need - totalEff,
      submitAll: true,
      headLines: totalEff,
      tailLines: 0,
      effectiveLines: totalEff
    };
  }
  if (mode === "head-tail") {
    const headN = Math.floor(need / 2);
    const tailN = need - headN;
    const head = takeHeadByEffective(allLines, headN);
    const tail = takeTailByEffective(allLines, tailN);
    // 重叠则退回全文
    if (head.length + tail.length >= allLines.length) {
      return {
        lines: allLines,
        truncated: false,
        shortfall: 0,
        submitAll: true,
        headLines: totalEff,
        tailLines: 0,
        effectiveLines: totalEff
      };
    }
    const headEnd = head.length;
    const tailStart = allLines.length - tail.length;
    if (tailStart < headEnd) {
      return {
        lines: allLines,
        truncated: false,
        shortfall: 0,
        submitAll: true,
        headLines: totalEff,
        tailLines: 0,
        effectiveLines: totalEff
      };
    }
    const lines = [...head, ...tail];
    return {
      lines,
      truncated: true,
      shortfall: 0,
      submitAll: false,
      headLines: headN,
      tailLines: tailN,
      effectiveLines: countEffective(lines)
    };
  }
  const lines = takeHeadByEffective(allLines, need);
  return {
    lines,
    truncated: true,
    shortfall: 0,
    submitAll: false,
    headLines: need,
    tailLines: 0,
    effectiveLines: countEffective(lines)
  };
}

/**
 * 每页凑满 linesPerPage 行有效代码。
 * 可保留少量空行，但视觉行数不超过 maxVisual（默认 linesPerPage+2），
 * 超出则跳过空行，避免单页过高导致 Word 溢流、出现大片空白页。
 */
function chunkPagesByEffective(lines, linesPerPage, maxPages, opts = {}) {
  const maxVisual = opts.maxVisual != null ? opts.maxVisual : linesPerPage + 2;
  const pages = [];
  let cur = [];
  let eff = 0;
  let i = 0;
  while (i < lines.length) {
    if (maxPages && pages.length >= maxPages) break;
    const line = lines[i];
    i++;
    if (isBlankLine(line)) {
      const room = maxVisual - cur.length;
      const needEff = linesPerPage - eff;
      // 空行只在「留下足够槽位给剩余有效行」时保留
      if (room > needEff && cur.length + 1 + needEff <= maxVisual) {
        cur.push("");
      }
      continue;
    }
    if (!isEffectiveLine(line)) continue;
    cur.push(line);
    eff++;
    if (eff >= linesPerPage) {
      pages.push(cur);
      cur = [];
      eff = 0;
    }
  }
  if (cur.length && (!maxPages || pages.length < maxPages)) pages.push(cur);
  return pages;
}

function resolveDocx(root) {
  const candidates = [
    path.join(__dirname, "..", "node_modules", "docx"),
    path.join(process.cwd(), "node_modules", "docx"),
    path.join(process.cwd(), "_doc", "软著申请", ".docx-tools", "node_modules", "docx"),
    root ? path.join(root, "_doc", "软著申请", ".docx-tools", "node_modules", "docx") : null,
    root ? path.join(root, "node_modules", "docx") : null
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch (_) {}
  }
  try {
    return require("docx");
  } catch (_) {
    throw new Error(
      "找不到 docx 包。请在 _doc/软著申请/.docx-tools 执行 npm i docx，或设置 NODE_PATH。"
    );
  }
}

async function buildDocx(opts, pageChunks, style) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Header,
    Footer,
    PageNumber,
    AlignmentType,
    PageBreak
  } = resolveDocx(opts.root);

  const bodyOpts = textRunOpts(style.code?.body || {});
  const lineTwip = style.code?.lineTwip ?? 276;
  const headerOpts = textRunOpts(style.header || {});
  const footerOpts = textRunOpts(style.footer || {});
  const ctx = {
    projectName: opts.softName,
    softName: opts.softName,
    version: style.version || opts.version
  };

  const children = [];
  for (let pi = 0; pi < pageChunks.length; pi++) {
    const chunk = pageChunks[pi];
    for (const line of chunk) {
      children.push(
        new Paragraph({
          spacing: { after: 0, before: 0, line: lineTwip, lineRule: "exact" },
          children: [
            new TextRun({
              text: line.length ? line : " ",
              ...bodyOpts
            })
          ]
        })
      );
    }
    // 固定分页：保证「每页 50 行」与 Word 物理页一致；不补空行凑满末页
    if (pi < pageChunks.length - 1 && PageBreak) {
      children.push(
        new Paragraph({
          children: [new PageBreak()]
        })
      );
    }
  }

  const headerRuns = buildTemplateRuns(
    style.header?.template,
    ctx,
    headerOpts,
    PageNumber
  ).map(r => new TextRun(r));
  const footerRuns = buildTemplateRuns(
    style.footer?.template ?? "{page}",
    ctx,
    footerOpts,
    PageNumber
  ).map(r => new TextRun(r));

  const doc = new Document({
    styles: {
      default: {
        document: {
          styles: []
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 } // 0.5"
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: alignOf(style.header?.align, AlignmentType),
                children: headerRuns
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: alignOf(style.footer?.align, AlignmentType),
                children: footerRuns
              })
            ]
          })
        },
        children
      }
    ]
  });

  return Packer.toBuffer(doc);
}

function printHelp() {
  console.log(`Usage: node generate-code-doc.js [options]

  --root <dir>              仓库根目录
  --project-name <name>     项目名称（页眉；亦兼容 --soft-name）
  --version <ver>           版本，默认 V1.0
  --paths <a,b,c>           扫描路径（相对 root；占比请在 code-config 用对象配置）
  --ext / --suffix <.ts,.vue>  文件后缀
  --pages <n>               页数，默认 60（前30+后30）
  --lines-per-page <n>      每页行数，默认且建议 ≥50（有效代码）
  --mode head-tail|consecutive  默认 head-tail（版权局前/后各半）
  --strip-blank true|false  去掉空行（默认 false；有效行>50 时强制保留空行）
  --strip-comments true|false 去掉纯注释/块注释（默认 true）
  --shuffle true|false      是否打乱各目录内文件顺序
  --seed <s>                打乱种子
  --out <file.docx>         输出路径
  --config <*-ruanzhu-code-config.md>  本次任务唯一配置（多项目时必填）
`);
}

async function main() {
  let args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  args = loadConfig(args);

  // 版式与 code 配置同源（一对一）
  const styleFile = args.style || args._configFile || undefined;
  const style = loadDocxStyle(args.root, {
    styleFile,
    kind: "code",
    inlineStyle: args.inlineStyle,
    version: args.version
  });
  if (style.version) args.version = style.version;

  if (!args.paths.length) {
    for (const d of ["apps", "src", "server", "backend", "frontend"]) {
      if (fs.existsSync(path.join(args.root, d))) args.paths.push(d);
    }
  }
  if (!args.paths.length) args.paths = ["."];

  const pathEntries = normalizePathEntries(args.paths);
  const exts = args.ext.length ? args.ext : DEFAULT_EXT;
  // 版权局：默认 60 页×50 行；不足则整份提交
  if (args.linesPerPage < 50) {
    console.warn(`linesPerPage=${args.linesPerPage} < 50，已抬升为 50（版权局每页不少于 50 行）`);
    args.linesPerPage = 50;
  }
  const need = args.pages * args.linesPerPage;
  // 先保留空行读入；有效行 > 50 时不删空行（版权局有效行已够密度）
  const lineOptsKeepBlank = {
    stripBlank: false,
    stripComments: args.stripComments !== false
  };

  const dirSet = new Set([
    ...DEFAULT_EXCLUDE_DIR,
    ...(args.excludeDirs || []).map(s => String(s).trim()).filter(Boolean)
  ]);
  if (dirSet.has("_pycache_")) dirSet.add("__pycache__");
  const filePatterns = [
    ...new Set([...DEFAULT_EXCLUDE_FILES, ...(args.excludeFiles || [])].map(s => String(s).trim()).filter(Boolean))
  ];
  const excludeDir = name => dirSet.has(name) || dirSet.has(String(name).toLowerCase());
  const excludeFile = compileNameMatcher(filePatterns);
  const walkOpts = { excludeDir, excludeFile };

  let seedUsed = null;
  if (args.shuffle) {
    seedUsed = args.seed || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }

  const pools = [];
  for (const ent of pathEntries) {
    const abs = path.isAbsolute(ent.path) ? ent.path : path.join(args.root, ent.path);
    let files = [];
    walkFiles(abs, exts, files, walkOpts);
    files = [...new Set(files.map(f => path.resolve(f)))];
    files.sort((a, b) => a.localeCompare(b, "en"));
    if (args.shuffle) files = shuffleArray(files, `${seedUsed}:${ent.path}`);
    const lines = [];
    for (const f of files) lines.push(...readFileLines(f, args.root, lineOptsKeepBlank));
    pools.push({
      path: ent.path,
      weight: ent.weight,
      weightLabel: ent.weightLabel,
      files,
      lines,
      effective: countEffective(lines)
    });
  }

  const totalEffectiveAvail = pools.reduce((s, p) => s + p.effective, 0);
  // 规则：有效行数 > 50 → 不删除空行；仅当有效行极少（≤50）且显式 stripBlank 时才去空行
  const stripBlankApplied =
    totalEffectiveAvail <= 50 && args.stripBlank === true;
  if (totalEffectiveAvail > 50 && args.stripBlank) {
    console.warn(
      `有效行 ${totalEffectiveAvail} > 50，已忽略 stripBlank=true，保留空行`
    );
  }
  if (stripBlankApplied) {
    for (const p of pools) {
      p.lines = dropBlankLines(p.lines);
      p.effective = countEffective(p.lines);
    }
  } else {
    // 保留空行但压缩连续空行，减轻版面空白
    for (const p of pools) {
      p.lines = collapseConsecutiveBlanks(p.lines, 1);
      p.effective = countEffective(p.lines);
    }
  }

  const capacities = pools.map(p => p.effective);
  const weights = pools.map(p => p.weight);
  const totalAvail = capacities.reduce((a, b) => a + b, 0);

  /**
   * head-tail（推荐）：先按路径顺序拼成连续程序（可用 weight 控制各目录纳入量），
   * 再按有效行取前/后各一半页；不足 need 则整份提交。
   */
  const pathStats = [];
  let merged = [];
  let selectMeta = { submitAll: false, headLines: 0, tailLines: 0, truncated: false };

  if (args.mode === "head-tail") {
    const corpusTarget = totalAvail;
    const quotas = allocateQuotas(capacities, weights, corpusTarget);
    for (let i = 0; i < pools.length; i++) {
      const picked = takeHeadByEffective(pools[i].lines, quotas[i]);
      merged.push(...picked);
      pathStats.push({
        path: pools[i].path,
        weight: pools[i].weightLabel,
        weightFraction: Number(pools[i].weight.toFixed(4)),
        files: pools[i].files.length,
        availableLines: pools[i].lines.length,
        availableEffective: pools[i].effective,
        corpusLines: picked.length,
        corpusEffective: countEffective(picked),
        short: pools[i].effective < quotas[i]
      });
    }
    selectMeta = selectLines(merged, need, "head-tail");
    merged = selectMeta.lines;
  } else {
    const quotas = allocateQuotas(capacities, weights, need);
    for (let i = 0; i < pools.length; i++) {
      const picked = selectLines(pools[i].lines, quotas[i], "consecutive");
      merged.push(...picked.lines);
      pathStats.push({
        path: pools[i].path,
        weight: pools[i].weightLabel,
        weightFraction: Number(pools[i].weight.toFixed(4)),
        files: pools[i].files.length,
        availableLines: pools[i].lines.length,
        availableEffective: pools[i].effective,
        quotaLines: quotas[i],
        usedLines: picked.lines.length,
        usedEffective: picked.effectiveLines,
        short: pools[i].effective < quotas[i],
        truncated: picked.truncated
      });
    }
    const mergedEff = countEffective(merged);
    selectMeta = {
      submitAll: mergedEff <= need,
      truncated: totalAvail > need,
      headLines: Math.min(mergedEff, need),
      tailLines: 0,
      shortfall: Math.max(0, need - mergedEff),
      effectiveLines: Math.min(mergedEff, need)
    };
    if (mergedEff > need) merged = takeHeadByEffective(merged, need);
  }

  const finalLines = merged;
  const finalEffective = countEffective(finalLines);
  // 不足 60 页：整份提交，页数按有效行计算
  const actualPages = Math.max(1, Math.ceil(finalEffective / args.linesPerPage));
  const outPages = selectMeta.submitAll ? actualPages : args.pages;
  if (selectMeta.submitAll && finalEffective < need) {
    console.warn(
      `有效代码 ${finalEffective} 行 < ${need}（${args.pages}页×${args.linesPerPage}行），按版权局要求提交全部，共 ${outPages} 页`
    );
  }

  let pageChunks = chunkPagesByEffective(
    finalLines,
    args.linesPerPage,
    selectMeta.submitAll ? null : outPages,
    { maxVisual: args.linesPerPage + 2 }
  );
  if (!selectMeta.submitAll && pageChunks.length > outPages) {
    pageChunks = pageChunks.slice(0, outPages);
  }
  if (!selectMeta.submitAll && pageChunks.length !== outPages) {
    console.warn(
      `分页结果 ${pageChunks.length} 页，期望 ${outPages} 页（有效行 ${finalEffective}）`
    );
  }

  const out =
    args.out ||
    path.join(args.root, "_doc", "软著申请", `${args.softName}-源码文档-v1.docx`);
  const outAbs = path.isAbsolute(out) ? out : path.join(args.root, out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  let txtPath = null;
  if (args.writeTxt) {
    txtPath = outAbs.replace(/\.docx$/i, ".txt");
    fs.writeFileSync(txtPath, finalLines.join("\n"), "utf8");
  }

  // 行距按「约 50～52 行铺满 A4」：过小会底部大片空白，过大则溢流分页
  const styleForDoc = { ...style, code: { ...(style.code || {}) } };
  const maxLinesOnPage = Math.max(
    args.linesPerPage,
    ...pageChunks.map(c => c.length),
    args.linesPerPage
  );
  const fitTwip = Math.max(220, Math.min(276, Math.floor(13800 / maxLinesOnPage)));
  if (styleForDoc.code.lineTwip == null || styleForDoc.code.lineTwip > fitTwip) {
    styleForDoc.code.lineTwip = fitTwip;
  }
  const docArgs = { ...args, pages: outPages, linesPerPage: args.linesPerPage };
  const buf = await buildDocx(docArgs, pageChunks, styleForDoc);
  fs.writeFileSync(outAbs, buf);

  const filesUsedOrder = [];
  for (const p of pools) {
    for (const f of p.files.slice(0, 15)) {
      filesUsedOrder.push(path.relative(args.root, f).replace(/\\/g, "/"));
    }
  }

  const summary = {
    projectName: args.softName,
    softName: args.softName,
    version: args.version,
    compliance: {
      rule: "版权局：每页≥50有效行；一般前30+后30=60页；不足则全文；有效行>50保留空行",
      linesPerPage: args.linesPerPage,
      targetPages: args.pages,
      outputPages: outPages,
      targetLines: need,
      effectiveLines: finalEffective,
      visualLines: finalLines.length,
      submitAll: !!selectMeta.submitAll,
      headLines: selectMeta.headLines || 0,
      tailLines: selectMeta.tailLines || 0,
      stripBlank: stripBlankApplied,
      stripBlankRequested: !!args.stripBlank,
      keepBlankBecauseEffectiveGt50: totalEffectiveAvail > 50,
      stripComments: lineOptsKeepBlank.stripComments
    },
    pages: outPages,
    linesPerPage: args.linesPerPage,
    targetLines: need,
    actualLines: finalLines.length,
    actualEffective: finalEffective,
    filesScanned: pools.reduce((s, p) => s + p.files.length, 0),
    filesUsedOrder: filesUsedOrder.slice(0, 40),
    paths: pathStats,
    excludeDirs: [...dirSet].sort(),
    excludeFiles: filePatterns,
    extensions: exts,
    shuffle: args.shuffle,
    seed: seedUsed,
    mode: args.mode,
    truncated: !!selectMeta.truncated && !selectMeta.submitAll,
    shortfall: selectMeta.submitAll ? Math.max(0, need - finalLines.length) : 0,
    out: outAbs,
    txt: txtPath,
    configFrom: args._configFrom || null,
    styleFrom: style._loadedFrom || null,
    generatedAt: new Date().toISOString()
  };

  // 摘要写回【本次】code-config
  try {
    const mdUpdated = writeRunSummaryToMd(args.root, summary, args._configFile);
    if (mdUpdated) summary.summaryWrittenTo = mdUpdated;
  } catch (e) {
    console.warn("未能写回 code-config 运行摘要:", e.message);
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log("\nOK →", outAbs);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { countEffective, selectLines, chunkPagesByEffective };

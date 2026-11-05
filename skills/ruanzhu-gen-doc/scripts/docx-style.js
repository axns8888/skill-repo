/**
 * 软著 Word 版式 / 配置加载。
 * doc / code 分文件：〈项目名称〉-ruanzhu-doc-config.md 、 〈项目名称〉-ruanzhu-code-config.md
 * 单次任务 config 与产出一对一。
 */
const fs = require("fs");
const path = require("path");

/** 规范化标题：去掉「配置：」前缀，避免 doc 误匹配 docx-style */
function normalizeSectionTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/^配置[:：]\s*/, "")
    .replace(/\s+/g, "");
}

function titleMatchesHint(title, hint) {
  const t = normalizeSectionTitle(title);
  const h = normalizeSectionTitle(hint);
  if (!h) return false;
  if (t === h) return true;
  // 长 hint 允许包含匹配（如「运行摘要」⊂「最近一次运行摘要」）
  if (h.length >= 4 && t.includes(h)) return true;
  return false;
}

/** 从 Markdown 中按章节标题提取紧随其后的首个 ```json 代码块 */
function extractJsonBlockFromMd(mdText, sectionHint) {
  const lines = String(mdText || "").replace(/\r\n/g, "\n").split("\n");
  let inTarget = false;
  let inFence = false;
  const buf = [];
  for (const line of lines) {
    if (!inFence && /^#{1,6}\s+/.test(line)) {
      const title = line.replace(/^#{1,6}\s+/, "");
      inTarget = titleMatchesHint(title, sectionHint);
      continue;
    }
    if (!inTarget) continue;
    if (!inFence && /^```json\s*$/i.test(line.trim())) {
      inFence = true;
      buf.length = 0;
      continue;
    }
    if (inFence && /^```\s*$/.test(line.trim())) {
      const raw = buf.join("\n").trim();
      if (!raw) return null;
      return JSON.parse(raw);
    }
    if (inFence) buf.push(line);
  }
  return null;
}

/**
 * 替换 Markdown 中某章节下首个 ```json 代码块内容。
 * sectionHint：doc / code / docx-style / 运行摘要
 */
function replaceJsonBlockInMd(mdText, sectionHint, obj) {
  const lines = String(mdText || "").replace(/\r\n/g, "\n").split("\n");
  let inTarget = false;
  let fenceStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fenceStart < 0 && /^#{1,6}\s+/.test(line)) {
      const title = line.replace(/^#{1,6}\s+/, "");
      inTarget = titleMatchesHint(title, sectionHint);
      continue;
    }
    if (inTarget && fenceStart < 0 && /^```json\s*$/i.test(line.trim())) {
      fenceStart = i;
      continue;
    }
    if (fenceStart >= 0 && /^```\s*$/.test(line.trim())) {
      const pretty = JSON.stringify(obj, null, 2);
      const next = [...lines.slice(0, fenceStart + 1), ...pretty.split("\n"), ...lines.slice(i)];
      return next.join("\n");
    }
  }
  throw new Error(`配置 md 中未找到章节「${sectionHint}」下的 json 代码块`);
}
function softZhuDir(root) {
  return path.join(root || process.cwd(), "_doc", "软著申请");
}

/** kind: 'doc' | 'code' → 匹配 *-ruanzhu-{kind}-config.md 或 ruanzhu-{kind}-config.md */
function listRuanzhuConfigs(root, kind) {
  const dir = softZhuDir(root);
  if (!fs.existsSync(dir)) return [];
  const exact = `ruanzhu-${kind}-config.md`.toLowerCase();
  const suffix = `-ruanzhu-${kind}-config.md`.toLowerCase();
  return fs
    .readdirSync(dir)
    .filter(n => {
      const low = n.toLowerCase();
      return low === exact || low.endsWith(suffix);
    })
    .map(n => path.join(dir, n))
    .sort((a, b) => a.localeCompare(b, "zh"));
}

/**
 * 解析本次任务唯一 config。
 * - 显式 --config / styleFile 优先
 * - 目录内仅 1 个匹配则自动选用
 * - 多个则必须显式指定（保证一对一）
 */
function resolveRuanzhuConfig(root, kind, explicit) {
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.join(root || process.cwd(), explicit);
    if (!fs.existsSync(p)) throw new Error(`配置文件不存在: ${p}`);
    return p;
  }
  const found = listRuanzhuConfigs(root, kind);
  // 兼容旧 ruanzhu-gen.md（仅当没有新配置时）
  const legacy = path.join(softZhuDir(root), "ruanzhu-gen.md");
  if (!found.length && fs.existsSync(legacy)) return legacy;
  if (found.length === 1) return found[0];
  if (found.length === 0) return null;
  throw new Error(
    `找到多个 ruanzhu-${kind}-config（须一对一指定 --config）:\n` +
      found.map(f => `  - ${path.basename(f)}`).join("\n")
  );
}

/** @deprecated 用 resolveRuanzhuConfig(root,'code'| 'doc') */
function resolveRuanzhuGenMd(root, explicit) {
  try {
    return resolveRuanzhuConfig(root, "code", explicit) || resolveRuanzhuConfig(root, "doc", explicit);
  } catch {
    return explicit
      ? path.isAbsolute(explicit)
        ? explicit
        : path.join(root || process.cwd(), explicit)
      : null;
  }
}

const DEFAULT_STYLE = {
  version: "V1.0",
  header: {
    align: "center",
    font: "宋体",
    sizePt: 12,
    color: "000000",
    bold: false,
    italics: false,
    highlight: false,
    template: "{projectName}  {version}"
  },
  footer: {
    align: "center",
    font: "宋体",
    sizePt: 12,
    color: "000000",
    bold: false,
    italics: false,
    highlight: false,
    template: "{page}"
  },
  code: {
    body: {
      font: "Times New Roman",
      sizePt: 12,
      color: "000000",
      bold: false,
      italics: false,
      highlight: false
    },
    lineTwip: 276
  },
  manual: {
    body: {
      font: "宋体",
      sizePt: 12,
      color: "000000",
      bold: false,
      italics: false,
      highlight: false
    },
    heading: {
      font: "宋体",
      color: "000000",
      italics: false,
      highlight: false,
      mdLevelOffset: 1,
      h1: { sizePt: 15, bold: true },
      h2: { sizePt: 14, bold: true },
      h3: { sizePt: 13, bold: true },
      h4: { sizePt: 12, bold: true }
    },
    cover: {
      font: "宋体",
      titleSizePt: 22,
      subtitleSizePt: 18,
      metaSizePt: 12,
      bold: true
    }
  }
};

function deepMerge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (k.startsWith("$")) continue;
    const bv = base?.[k];
    const ov = over[k];
    if (bv && typeof bv === "object" && !Array.isArray(bv) && ov && typeof ov === "object" && !Array.isArray(ov)) {
      out[k] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[k] = ov;
    }
  }
  return out;
}

function ptToHalf(sizePt) {
  return Math.round(Number(sizePt || 12) * 2);
}

function normColor(c) {
  if (!c) return "000000";
  return String(c).replace(/^#/, "").toUpperCase();
}

/** TextRun 公共选项；highlight=false 时不设背景色 */
function textRunOpts(partial = {}) {
  const opts = {
    font: partial.font || "宋体",
    size: ptToHalf(partial.sizePt ?? 12),
    color: normColor(partial.color),
    bold: !!partial.bold,
    italics: !!partial.italics
  };
  if (partial.highlight && partial.highlight !== false) {
    // docx highlight 为预设名或用 shading；此处仅当显式给色值时用
    if (typeof partial.highlight === "string" && partial.highlight !== "true") {
      opts.highlight = partial.highlight;
    }
  }
  return opts;
}

function alignOf(name, AlignmentType) {
  const a = String(name || "center").toLowerCase();
  if (a === "left") return AlignmentType.LEFT;
  if (a === "right") return AlignmentType.RIGHT;
  return AlignmentType.CENTER;
}

/**
 * 解析页眉/页脚模板。
 * 占位：{projectName}（兼容旧 {softName}）{version} {page} {pages}
 */
function buildTemplateRuns(template, ctx, runBase, PageNumber) {
  const tpl = template == null ? "{projectName}  {version}" : String(template);
  const projectName = ctx.projectName || ctx.softName || "";
  const version = ctx.version || "";
  const parts = tpl
    .split(/(\{projectName\}|\{softName\}|\{version\}|\{page\}|\{pages\})/g)
    .filter(s => s !== "");
  const runs = [];
  for (const p of parts) {
    if (p === "{projectName}" || p === "{softName}") runs.push({ ...runBase, text: projectName });
    else if (p === "{version}") runs.push({ ...runBase, text: version });
    else if (p === "{page}") runs.push({ ...runBase, children: [PageNumber.CURRENT] });
    else if (p === "{pages}") runs.push({ ...runBase, children: [PageNumber.TOTAL_PAGES] });
    else runs.push({ ...runBase, text: p });
  }
  if (!runs.length) runs.push({ ...runBase, text: `${projectName}  ${version}` });
  return runs;
}

function resolveStylePath(root, explicit, kind = "code") {
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.join(root || process.cwd(), explicit);
    if (fs.existsSync(p)) return p;
  }
  try {
    const cfg = resolveRuanzhuConfig(root, kind, null);
    if (cfg) return cfg;
  } catch (_) {
    /* 多配置时由调用方显式传入 */
  }
  const legacyJson = path.join(softZhuDir(root), "docx-style.json");
  if (fs.existsSync(legacyJson)) return legacyJson;
  return null;
}

function loadJsonConfig(file, sectionHint) {
  if (!file) return null;
  const text = fs.readFileSync(file, "utf8");
  if (/\.md$/i.test(file)) {
    return extractJsonBlockFromMd(text, sectionHint);
  }
  return JSON.parse(text);
}

function loadDocxStyle(root, options = {}) {
  let style = JSON.parse(JSON.stringify(DEFAULT_STYLE));
  const kind = options.kind || "code";
  const file = resolveStylePath(root, options.styleFile || options.stylePath || options.configFile, kind);
  if (file) {
    const raw = loadJsonConfig(file, "docx-style");
    if (raw) {
      style = deepMerge(style, raw);
      style._loadedFrom = file + (/\.md$/i.test(file) ? "#docx-style" : "");
      style._configFile = file;
    }
  }
  if (options.inlineStyle && typeof options.inlineStyle === "object") {
    style = deepMerge(style, options.inlineStyle);
  }
  if (options.version) style.version = options.version;
  return style;
}

/**
 * 读取源码任务配置（章节「配置：code」；兼容旧「code-doc-config」）。
 * 必须来自本次 --config 指向的 *-ruanzhu-code-config.md。
 */
function loadCodeDocConfig(root, options = {}) {
  const explicit = options.configFile || options.config;
  let file;
  try {
    file = resolveRuanzhuConfig(root, "code", explicit || null);
  } catch (e) {
    if (!explicit) throw e;
    file = path.isAbsolute(explicit) ? explicit : path.join(root || process.cwd(), explicit);
  }
  if (!file || !fs.existsSync(file)) return null;
  const raw =
    loadJsonConfig(file, "code") ||
    loadJsonConfig(file, "code-doc-config");
  if (raw && typeof raw === "object") {
    raw._loadedFrom = file + "#code";
    raw._configFile = file;
    return raw;
  }
  return null;
}

/** 读取操作手册任务配置（章节「配置：doc」） */
function loadDocManualConfig(root, options = {}) {
  const explicit = options.configFile || options.config;
  let file;
  try {
    file = resolveRuanzhuConfig(root, "doc", explicit || null);
  } catch (e) {
    if (!explicit) throw e;
    file = path.isAbsolute(explicit) ? explicit : path.join(root || process.cwd(), explicit);
  }
  if (!file || !fs.existsSync(file)) return null;
  const raw = loadJsonConfig(file, "doc");
  if (raw && typeof raw === "object") {
    raw._loadedFrom = file + "#doc";
    raw._configFile = file;
    return raw;
  }
  return null;
}

/** 把运行摘要写回【本次】code-config 的「运行摘要」节 */
function writeRunSummaryToMd(root, summary, configFile) {
  const mdPath =
    configFile ||
    summary?.configFile ||
    (() => {
      try {
        return resolveRuanzhuConfig(root, "code", null);
      } catch {
        return null;
      }
    })();
  if (!mdPath || !fs.existsSync(mdPath)) return null;
  const md = fs.readFileSync(mdPath, "utf8");
  const next = replaceJsonBlockInMd(md, "运行摘要", summary);
  fs.writeFileSync(mdPath, next, "utf8");
  return mdPath;
}

function headingRunOpts(manualStyle, level) {
  const h = manualStyle?.heading || DEFAULT_STYLE.manual.heading;
  const key = `h${Math.min(Math.max(level, 1), 4)}`;
  const lv = h[key] || h.h4 || { sizePt: 12, bold: true };
  return textRunOpts({
    font: lv.font || h.font || "宋体",
    sizePt: lv.sizePt ?? 12,
    color: lv.color || h.color || "000000",
    bold: lv.bold !== undefined ? lv.bold : true,
    italics: lv.italics !== undefined ? lv.italics : !!h.italics,
    highlight: lv.highlight !== undefined ? lv.highlight : h.highlight
  });
}

module.exports = {
  DEFAULT_STYLE,
  deepMerge,
  ptToHalf,
  textRunOpts,
  alignOf,
  buildTemplateRuns,
  resolveStylePath,
  resolveRuanzhuGenMd,
  resolveRuanzhuConfig,
  listRuanzhuConfigs,
  softZhuDir,
  extractJsonBlockFromMd,
  replaceJsonBlockInMd,
  loadJsonConfig,
  loadDocxStyle,
  loadCodeDocConfig,
  loadDocManualConfig,
  writeRunSummaryToMd,
  headingRunOpts
};

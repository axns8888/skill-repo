/**
 * Soft著操作说明书导出：对齐 demo「用户操作手册」版式
 * - 封面（项目名称 + 用户操作手册 + 版本/日期）
 * - 目录区
 * - 正文标题层级、操作步骤、图位框（占位截图区域以增加篇幅）
 */
const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  PageNumber,
  Header,
  Footer,
  PageBreak
} = require("docx");
const {
  loadDocxStyle,
  loadDocManualConfig,
  listRuanzhuConfigs,
  resolveRuanzhuConfig,
  textRunOpts,
  alignOf,
  buildTemplateRuns,
  headingRunOpts
} = require("./docx-style");

const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");
const PAGE_W = 11906; // A4 width DXA approx content with margins
const CONTENT_W = 9026;
// 截图显示宽度（约版心 15cm）
const IMG_DISPLAY_W = 520;
const IMG_DISPLAY_H_WEB = 325;
const IMG_DISPLAY_H_H5 = 560;

/** 当前任务版式（每次 convert 前从对应 *-ruanzhu-doc-config.md 加载，一对一） */
let STYLE = { version: "V2.0", header: {}, footer: {}, manual: {} };

function resolveShot(shotDir, n) {
  if (!shotDir || !fs.existsSync(shotDir)) return null;
  const pad = String(n).padStart(2, "0");
  const files = fs.readdirSync(shotDir).filter(f => /\.png$/i.test(f));
  const hit =
    files.find(f => f.startsWith(`图${pad}-`) || f.startsWith(`图${n}-`)) ||
    files.find(f => f.includes(`图${pad}`));
  return hit ? path.join(shotDir, hit) : null;
}

function stripMd(s) {
  return String(s || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\_/g, "_")
    .trim();
}

function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  let inToc = false;

  while (i < lines.length) {
    let line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      i++;
      continue;
    }

    // Cover-ish first lines before first ## 1. or # 1.
    if (trimmed === "目录" || trimmed === "## 目录") {
      inToc = true;
      blocks.push({ type: "toc-title" });
      i++;
      continue;
    }
    if (inToc) {
      if (/^#{1,3}\s+1[\.\s]/.test(trimmed) || trimmed === "1. 引言" || /^##\s+1\./.test(trimmed)) {
        inToc = false;
        // fall through to parse heading
      } else {
        blocks.push({ type: "toc-line", text: stripMd(trimmed.replace(/^#+\s*/, "")) });
        i++;
        continue;
      }
    }

    // Figure placeholder
    const fig = trimmed.match(/^(\*\*)?【图\s*(\d+)\s*(?:　|\s)+(.+?)】(\*\*)?$/);
    if (fig) {
      blocks.push({ type: "figure", n: fig[2], title: stripMd(fig[3]) });
      i++;
      continue;
    }

    // Markdown table
    if (trimmed.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const raw = lines[i].trim();
        const cells = raw
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map(c => stripMd(c));
        if (!cells.every(c => /^[-:]+$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }

    // Headings
    if (/^#{1,4}\s+/.test(trimmed)) {
      const m = trimmed.match(/^(#{1,4})\s+(.*)$/);
      blocks.push({ type: "h", level: m[1].length, text: stripMd(m[2]) });
      i++;
      continue;
    }

    // Bare numbered chapter headings (H5 style without #)
    if (/^\d+\.\d+(\.\d+)?\s+\S/.test(trimmed) || /^附录/.test(trimmed) || /^A\.\s+/.test(trimmed)) {
      const isChap = /^\d+\.\s+\S/.test(trimmed) && !/^\d+\.\d+/.test(trimmed);
      const isSec = /^\d+\.\d+\s+/.test(trimmed) && !/^\d+\.\d+\.\d+/.test(trimmed);
      const isSub = /^\d+\.\d+\.\d+\s+/.test(trimmed);
      if (isChap) blocks.push({ type: "h", level: 2, text: stripMd(trimmed) });
      else if (isSec) blocks.push({ type: "h", level: 3, text: stripMd(trimmed) });
      else if (isSub) blocks.push({ type: "h", level: 4, text: stripMd(trimmed) });
      else if (/^附录/.test(trimmed)) blocks.push({ type: "h", level: 2, text: stripMd(trimmed) });
      else if (/^A\.\s+/.test(trimmed)) blocks.push({ type: "h", level: 3, text: stripMd(trimmed) });
      i++;
      continue;
    }
    if (/^\d+\.\s+引言|^\d+\.\s+运行环境|^\d+\.\s+系统登录|^\d+\.\s+功能概述|^\d+\.\s+详细操作|^\d+\.\s+常见问题/.test(trimmed)) {
      blocks.push({ type: "h", level: 2, text: stripMd(trimmed) });
      i++;
      continue;
    }

    // Label lines
    if (/^(操作步骤|注意事项|登录成功|登录失败处理|新增用户|修改用户|重置密码|删除用户)[:：]?\s*$/.test(trimmed)) {
      blocks.push({ type: "label", text: stripMd(trimmed.replace(/[:：]\s*$/, "")) + "：" });
      i++;
      continue;
    }

    // List / numbered
    if (/^[-*]\s+/.test(trimmed) || /^\d+[\.、]\s+/.test(trimmed) || /^[（(]\d+[）)]\s+/.test(trimmed)) {
      let text = trimmed
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[\.、]\s+/, "")
        .replace(/^[（(]\d+[）)]\s+/, "");
      blocks.push({ type: "li", text: stripMd(text) });
      i++;
      continue;
    }

    // Cover title lines at very top (no #)
    if (
      (trimmed === "用户操作手册" ||
        trimmed === "利甲人力资源管理系统" ||
        trimmed === "利甲人力资源移动端" ||
        trimmed.startsWith("文档版本") ||
        trimmed.startsWith("编制日期")) &&
      blocks.filter(b => b.type === "h" || b.type === "p" || b.type === "li").length < 3
    ) {
      blocks.push({ type: "cover-meta", text: stripMd(trimmed) });
      i++;
      continue;
    }

    // Paragraph — merge continued lines lightly
    let para = stripMd(trimmed);
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("|") &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^【图/.test(lines[i].trim()) &&
      !/^\*\*【图/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+[\.、]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\d+/.test(lines[i].trim())
    ) {
      para += stripMd(lines[i].trim());
      i++;
    }
    if (para) blocks.push({ type: "p", text: para });
  }
  return blocks;
}

function figureBox(n, title, shotPath, isH5) {
  if (shotPath && fs.existsSync(shotPath)) {
    const buf = fs.readFileSync(shotPath);
    const w = isH5 ? 280 : IMG_DISPLAY_W;
    const h = isH5 ? IMG_DISPLAY_H_H5 : IMG_DISPLAY_H_WEB;
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 80 },
      children: [
        new ImageRun({
          type: "png",
          data: buf,
          transformation: { width: w, height: h },
          altText: { title: `图${n}`, description: title, name: `fig${n}` }
        })
      ]
    });
  }
  const hint = `（此处插入界面截图：${title}）`;
  const spacers = [];
  for (let k = 0; k < 6; k++) {
    spacers.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text: "　", font: "宋体", size: 24 })]
      })
    );
  }
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F5F7FA" },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: "D0D7DE" },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: "D0D7DE" },
              left: { style: BorderStyle.SINGLE, size: 8, color: "D0D7DE" },
              right: { style: BorderStyle.SINGLE, size: 8, color: "D0D7DE" }
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 200, after: 80 },
                children: [new TextRun({ text: hint, font: "宋体", size: 22, color: "8B95A5", italics: true })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 80, after: 80 },
                children: [new TextRun({ text: "■ ■ ■　截图占位区域　■ ■ ■", font: "宋体", size: 20, color: "C0C6D0" })]
              }),
              ...spacers
            ]
          })
        ]
      })
    ]
  });
}

function bodyRun(extra = {}) {
  return textRunOpts({ ...(STYLE.manual?.body || {}), ...extra });
}

function figCaption(n, title) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 240 },
    children: [new TextRun({ text: `图 ${n}　${title}`, ...bodyRun() })]
  });
}

function mdTable(rows) {
  if (!rows.length) return [];
  const cols = Math.max(...rows.map(r => r.length));
  const colW = Math.floor(CONTENT_W / cols);
  const out = [
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: Array(cols).fill(colW),
      rows: rows.map((r, ri) =>
        new TableRow({
          children: Array.from({ length: cols }).map((_, ci) => {
            const text = r[ci] || "";
            return new TableCell({
              width: { size: colW, type: WidthType.DXA },
              // 无背景色：表头也不铺底色（可由 style.manual.tableHeaderFill 显式开启）
              shading: ri === 0 && STYLE.manual?.tableHeaderFill
                ? { type: ShadingType.CLEAR, fill: STYLE.manual.tableHeaderFill }
                : undefined,
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: "CFD8E3" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: "CFD8E3" },
                left: { style: BorderStyle.SINGLE, size: 4, color: "CFD8E3" },
                right: { style: BorderStyle.SINGLE, size: 4, color: "CFD8E3" }
              },
              children: [
                new Paragraph({
                  spacing: { before: 60, after: 60 },
                  children: [
                    new TextRun({
                      text,
                      ...bodyRun({ bold: ri === 0 })
                    })
                  ]
                })
              ]
            });
          })
        })
      )
    }),
    new Paragraph({ spacing: { after: 160 }, children: [] })
  ];
  return out;
}

function headingPara(level, text) {
  // mdLevelOffset：手册常用 ## 作章标题；默认 offset=1 → ## 按一级(15pt)排
  const offset = STYLE.manual?.heading?.mdLevelOffset ?? 1;
  const mapLevel = Math.min(4, Math.max(1, level - offset));
  const hl =
    mapLevel <= 1
      ? HeadingLevel.HEADING_1
      : mapLevel === 2
        ? HeadingLevel.HEADING_2
        : mapLevel === 3
          ? HeadingLevel.HEADING_3
          : HeadingLevel.HEADING_4;
  return new Paragraph({
    heading: hl,
    spacing: { before: mapLevel <= 2 ? 320 : 240, after: 120 },
    children: [new TextRun({ text, ...headingRunOpts(STYLE.manual, mapLevel) })]
  });
}

function buildChildren(blocks, softName, shotDir) {
  const isH5 = softName.includes("移动端");
  const children = [];
  const cover = STYLE.manual?.cover || {};
  const coverFont = cover.font || STYLE.manual?.body?.font || "宋体";
  const ver = STYLE.version || "V1.0";

  // Cover
  children.push(
    new Paragraph({ spacing: { before: 1200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: softName,
          ...textRunOpts({
            font: coverFont,
            sizePt: cover.titleSizePt ?? 22,
            color: STYLE.manual?.body?.color || "000000",
            bold: cover.bold !== false,
            italics: false,
            highlight: false
          })
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        new TextRun({
          text: "用户操作手册",
          ...textRunOpts({
            font: coverFont,
            sizePt: cover.subtitleSizePt ?? 18,
            color: STYLE.manual?.body?.color || "000000",
            bold: cover.bold !== false,
            italics: false,
            highlight: false
          })
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `文档版本：${ver}`,
          ...textRunOpts({
            font: coverFont,
            sizePt: cover.metaSizePt ?? 12,
            color: STYLE.manual?.body?.color || "000000",
            bold: false,
            italics: false,
            highlight: false
          })
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "编制日期：2026 年 10 月 26 日",
          ...textRunOpts({
            font: coverFont,
            sizePt: cover.metaSizePt ?? 12,
            color: STYLE.manual?.body?.color || "000000",
            bold: false,
            italics: false,
            highlight: false
          })
        })
      ]
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  let skipCoverDup = true;
  let liIndex = 0;

  for (const b of blocks) {
    if (skipCoverDup) {
      if (
        b.type === "cover-meta" ||
        (b.type === "h" &&
          (b.text === softName ||
            b.text === "用户操作手册" ||
            b.text.startsWith("文档版本") ||
            b.text.startsWith("编制日期")))
      ) {
        continue;
      }
      if (b.type === "toc-title" || b.type === "h" || b.type === "p") skipCoverDup = false;
    }

    if (b.type === "toc-title") {
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: "目录", ...headingRunOpts(STYLE.manual, 1) })]
        })
      );
      continue;
    }
    if (b.type === "toc-line") {
      if (b.text === softName || b.text === "用户操作手册") continue;
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: b.text, ...bodyRun() })]
        })
      );
      continue;
    }
    if (b.type === "h") {
      if (b.text === softName || b.text === "用户操作手册") continue;
      // page break before major chapters 5/6 optional — before 详细操作步骤
      if (/^5[\.\s]/.test(b.text) && /详细操作/.test(b.text)) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      children.push(headingPara(b.level, b.text));
      liIndex = 0;
      continue;
    }
    if (b.type === "figure") {
      const shot = resolveShot(shotDir, b.n);
      children.push(new Paragraph({ spacing: { before: 160 }, children: [] }));
      children.push(figureBox(b.n, b.title, shot, isH5));
      children.push(figCaption(b.n, b.title));
      continue;
    }
    if (b.type === "table") {
      children.push(...mdTable(b.rows));
      continue;
    }
    if (b.type === "label") {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 80 },
          children: [new TextRun({ text: b.text, ...bodyRun({ bold: true }) })]
        })
      );
      liIndex = 0;
      continue;
    }
    if (b.type === "li") {
      liIndex += 1;
      children.push(
        new Paragraph({
          spacing: { after: 80, line: 360 },
          indent: { left: 240 },
          children: [new TextRun({ text: `${liIndex}. ${b.text}`, ...bodyRun() })]
        })
      );
      continue;
    }
    if (b.type === "p" || b.type === "cover-meta") {
      if (b.type === "cover-meta") continue;
      children.push(
        new Paragraph({
          spacing: { after: 120, line: 360 },
          indent: { firstLine: 480 },
          children: [new TextRun({ text: b.text, ...bodyRun() })]
        })
      );
    }
  }
  return children;
}

async function convert(mdName, docxName, softName, shotDirName, styleFile) {
  if (styleFile) {
    STYLE = loadDocxStyle(REPO_ROOT, { styleFile, kind: "doc" });
  }
  const mdPath = path.join(ROOT, mdName);
  const md = fs.readFileSync(mdPath, "utf8");
  const blocks = parseBlocks(md);
  const shotDir = path.join(ROOT, shotDirName);
  const children = buildChildren(blocks, softName, shotDir);

  const ctx = {
    projectName: softName,
    softName,
    version: STYLE.version || "V1.0"
  };
  const headerRuns = buildTemplateRuns(
    STYLE.header?.template,
    ctx,
    textRunOpts(STYLE.header || {}),
    PageNumber
  ).map(r => new TextRun(r));
  const footerRuns = buildTemplateRuns(
    STYLE.footer?.template ?? "{page}",
    ctx,
    textRunOpts(STYLE.footer || {}),
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
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: alignOf(STYLE.header?.align, AlignmentType),
                children: headerRuns
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: alignOf(STYLE.footer?.align, AlignmentType),
                children: footerRuns
              })
            ]
          })
        },
        children
      }
    ]
  });

  const buf = await Packer.toBuffer(doc);
  const out = path.join(ROOT, docxName);
  fs.writeFileSync(out, buf);
  const han = (md.match(/[\u4e00-\u9fff]/g) || []).length;
  const figs = blocks.filter(b => b.type === "figure").length;
  let embedded = 0;
  for (const b of blocks) {
    if (b.type === "figure" && resolveShot(shotDir, b.n)) embedded++;
  }
  console.log(
    "wrote",
    out,
    "han≈",
    han,
    "figs",
    figs,
    "embedded",
    embedded,
    "config",
    STYLE._configFile || STYLE._loadedFrom || "(default)"
  );
}

function parseCliConfig() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config" || argv[i] === "--doc-config") return argv[++i];
    if (argv[i] === "--all") return "__ALL__";
  }
  return null;
}

(async () => {
  const cli = parseCliConfig();
  let configFiles = [];
  if (cli === "__ALL__") {
    configFiles = listRuanzhuConfigs(REPO_ROOT, "doc");
  } else if (cli) {
    configFiles = [resolveRuanzhuConfig(REPO_ROOT, "doc", path.isAbsolute(cli) ? cli : path.join(ROOT, cli))];
  } else {
    // 未指定：若仅 1 个 doc-config 则用之；多个则必须 --config 或 --all
    const all = listRuanzhuConfigs(REPO_ROOT, "doc");
    if (all.length === 1) configFiles = all;
    else if (all.length === 0) {
      throw new Error("未找到 *-ruanzhu-doc-config.md，请先创建配置（与产出一对一）");
    } else {
      throw new Error(
        `存在多个 doc-config，请指定其一或使用 --all:\n` +
          all.map(f => `  node md-to-docx.js --config "${path.basename(f)}"`).join("\n") +
          `\n  node md-to-docx.js --all`
      );
    }
  }

  for (const cfgPath of configFiles) {
    const doc = loadDocManualConfig(REPO_ROOT, { configFile: cfgPath });
    if (!doc) throw new Error(`无法读取配置：doc 节 → ${cfgPath}`);
    const md = doc.md;
    const docx = doc.out || doc.docx;
    const name = doc.projectName || doc.softName;
    const shot = doc.shotDir || doc.screenshotDir;
    if (!md || !docx || !name) {
      throw new Error(`doc 配置缺 md/out/projectName: ${cfgPath}`);
    }
    try {
      await convert(md, docx, name, shot || "Screenshot-web", cfgPath);
    } catch (e) {
      if (e && e.code === "EBUSY") {
        const alt = String(docx).replace(/\.docx$/i, `-export.docx`);
        console.warn("busy, retry as", alt);
        await convert(md, alt, name, shot || "Screenshot-web", cfgPath);
      } else throw e;
    }
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});

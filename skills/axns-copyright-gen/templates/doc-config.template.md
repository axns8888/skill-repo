# ruanzhu-doc-config — {{projectName}}

**一对一：** 本配置仅对应本项目操作手册产出，勿与其他子项目混用。

| 项 | 值 |
| --- | --- |
| 技能 | `axns-copyright-gen-doc` |
| 项目名称 | {{projectName}} |
| Markdown | `{{projectName}}-操作手册-v1.md` |
| Word | `{{projectName}}-操作手册-v1.docx` |
| 截图 | `{{shotDir}}/` |

```bash
node .docx-tools/md-to-docx.js --config "{{projectName}}-ruanzhu-doc-config.md"
```

---

## 配置：doc

```json
{
  "projectName": "{{projectName}}",
  "version": "{{version}}",
  "md": "{{projectName}}-操作手册-v1.md",
  "out": "{{projectName}}-操作手册-v1.docx",
  "shotDir": "{{shotDir}}"
}
```

## 配置：docx-style

页眉/页脚/正文字体。`sizePt` 为磅；模板占位 `{projectName}` `{version}` `{page}` `{pages}`。

```json
{
  "version": "{{version}}",
  "header": {
    "align": "center",
    "font": "宋体",
    "sizePt": 12,
    "color": "000000",
    "bold": false,
    "italics": false,
    "highlight": false,
    "template": "{projectName}  {version}"
  },
  "footer": {
    "align": "center",
    "font": "宋体",
    "sizePt": 12,
    "color": "000000",
    "bold": false,
    "italics": false,
    "highlight": false,
    "template": "{page}"
  },
  "manual": {
    "body": {
      "font": "宋体",
      "sizePt": 10.5,
      "color": "000000",
      "bold": false,
      "italics": false,
      "highlight": false
    },
    "heading": {
      "font": "宋体",
      "color": "000000",
      "italics": false,
      "highlight": false,
      "mdLevelOffset": 1,
      "h1": { "sizePt": 15, "bold": true },
      "h2": { "sizePt": 14, "bold": true },
      "h3": { "sizePt": 13, "bold": true },
      "h4": { "sizePt": 12, "bold": true }
    },
    "cover": {
      "font": "宋体",
      "titleSizePt": 22,
      "subtitleSizePt": 18,
      "metaSizePt": 12,
      "bold": true
    }
  }
}
```

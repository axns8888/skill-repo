# 配置文件约定（一对一）

doc / code **分文件**，禁止再混在 `ruanzhu-gen.md`。

| 类型 | 文件名 | 技能 | 产出 |
| --- | --- | --- | --- |
| 操作说明书 | `〈项目名称〉-ruanzhu-doc-config.md` | axns-copyright-gen-doc | `〈项目名称〉-操作手册-v*.docx` |
| 源码文档 | `〈项目名称〉-ruanzhu-code-config.md` | axns-copyright-gen-code | `〈项目名称〉-源码文档-v*.docx` |

也可使用无前缀的 `ruanzhu-doc-config.md` / `ruanzhu-code-config.md`（仅当该类型只有一份时）。

**单次任务：一份 config ↔ 一份产出。** 目录里有多份子项目配置时，必须 `--config` 指定其一。

## code-config 内章节

1. **配置：code** — 扫描参数（`projectName`、`paths[].weight`、`exclude*`、`out`…）  
2. **配置：docx-style** — 页眉/页脚/源码正文字体  
3. **最近一次运行摘要** — 脚本写回  

## doc-config 内章节

1. **配置：doc** — `projectName`、`md`、`out`、`shotDir`、`version`  
2. **配置：docx-style** — 页眉/页脚/正文与标题字号  

## 命令示例

```bash
# 源码（多项目时必带 --config）
node generate-code-doc.js --root <仓库根> \
  --config "_doc/软著申请/〈项目名称〉-ruanzhu-code-config.md"

# 操作手册
node md-to-docx.js --config "〈项目名称〉-ruanzhu-doc-config.md"
node md-to-docx.js --all   # 依次处理全部 doc-config
```

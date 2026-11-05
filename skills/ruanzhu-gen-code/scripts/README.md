# generate-code-doc.js

## 依赖

```bash
# 推荐与操作说明书共用
cd <repo>/_doc/软著申请/.docx-tools
npm i docx
```

脚本会依次尝试：技能目录 / 当前目录 / `_doc/软著申请/.docx-tools` 下的 `node_modules/docx`。

## 版权局默认

- `pages: 60`，`mode: head-tail` → 前 30 页 + 后 30 页  
- `linesPerPage: 50` → 每页不少于 50 行有效代码  
- `stripBlank` / `stripComments: true` → 压缩空行与纯注释  
- 有效行不足 3000 → 提交全部，不空行凑页  

## 示例

```bash
node generate-code-doc.js \
  --root "D:/Coding/MyApp" \
  --project-name "示例管理系统" \
  --paths "apps/web/src,apps/server" \
  --ext ".vue,.ts,.py" \
  --pages 60 \
  --lines-per-page 50 \
  --shuffle false \
  --mode head-tail \
  --out "_doc/软著申请/示例管理系统-源码文档-v1.docx"
```

打乱：

```bash
node generate-code-doc.js --root ... --project-name "..." --paths "src" --ext ".ts,.vue" --shuffle true --seed 20261026
```

配置与版式（一对一）：

```bash
node generate-code-doc.js --root ... \
  --config "_doc/软著申请/〈项目名称〉-ruanzhu-code-config.md"
```

多子项目时必须指定 `--config`。说明见 `references/docx-style.md`。

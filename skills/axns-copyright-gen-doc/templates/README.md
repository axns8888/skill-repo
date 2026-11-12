# 脚本模板用法

## 1. 拷贝到目标项目

从本 skill 的 templates 目录复制 config.example.json → config.json、capture-screenshots.example.js → capture-screenshots.js、md-to-docx.example.js → md-to-docx.js；另从 scripts 目录复制 docx-style.js。全部放入下方 .docx-tools 目录。

```text
_doc/软著申请/
  〈项目名称〉-ruanzhu-doc-config.md   ← 操作手册配置（一对一）
  〈项目名称〉-ruanzhu-code-config.md  ← 源码文档配置（一对一）
  .docx-tools/
    config.json               ← 截图账号与 shots
    capture-screenshots.js
    md-to-docx.js             ← --config 指向 doc-config
    docx-style.js
    package.json
```

```bash
cd _doc/软著申请/.docx-tools
npm i docx playwright
npx playwright install chromium
# 编辑 config.json 中的 URL、账号、shots 列表
# 在 doc-config 的「配置：doc」中填写项目名称、md/out/shotDir
```

## 2. 跑通顺序

1. 启动业务前后端  
2. `node capture-screenshots.js all`  
3. 抽检 `Screenshot-web` / `Screenshot-h5`  
4. 保证 Markdown 中有 `【图1　登录界面】` 这类标记且图号对齐  
5. `node md-to-docx.js --config "〈项目名称〉-ruanzhu-doc-config.md"` → 得到配置中 out 指定的 Word 文件

## 3. Agent 职责

- 根据路由盘点**自动生成** `config.json` 的 `shots` 列表与手册中的 `【图n】`  
- 登录按钮被拦截时用 `force: true` 点外层 button（uni-app / 部分组件库常见）  
- history / hash 路由必须与项目一致  


截图配置中的 web.shotDir / h5.shotDir 应与对应 doc-config 的 shotDir 一致；可自定义目录名，未设置时默认 Screenshot-web / Screenshot-h5。

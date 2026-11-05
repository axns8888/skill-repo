---
name: ruanzhu-gen-doc
description: >-
  从仓库已实现功能生成软著用户操作说明书，支持 Markdown/Word、页面截图与 Word 嵌图。
  Use when the user asks for 软著操作手册、用户操作说明书、截图嵌入 Word，
  或明确提及 ruanzhu-gen-doc。单独生成源码材料、登记信息或编排整套材料时使用对应技能。
---

# 软著操作说明书生成（ruanzhu-gen-doc）

把「代码事实 → 软著材料包 → 长文操作说明书 → 自动截图 → Word 嵌图」固化为可复用流程。  
**以当前仓库已实现功能为准，禁止虚构未上线能力。**

程序鉴别材料（默认前 30 + 后 30，共 60 页源码 Word）请用姊妹技能 **`ruanzhu-gen-code`**（可指定路径、后缀、是否打乱）。

## 何时启用

- 用户要求软著操作说明书、用户操作手册、按 demo 写说明书或截图嵌入 Word
- 或点名：`ruanzhu-gen-doc`  
- 或要求：从本项目生成可递交的用户操作手册（Markdown + Word）

## 快速开始（对用户说清）

1. 在目标仓库根目录准备（或让 Agent 创建）`_doc/软著申请/`  
2. 准备一份**格式样板** Word（可选）：放在 `_doc/软著申请/demo/`（推荐对标「封面+目录+分章字段级步骤+大量截图」类 demo）  
3. 对 Agent 说：

```text
按 ruanzhu-gen-doc 技能，为本仓库生成软著操作说明书。
项目名称：〈全称〉
端别：〈管理端 Web / 移动端 H5 / 两者各出一套〉
演示地址与账号：〈URL + 账号密码〉
有 demo 样板则按 demo 格式扩写并自动截图嵌入 Word。
```

更完整的一键提示词见 [references/quick-prompt.md](references/quick-prompt.md)。

---

## 工作流（必须按阶段）

### Phase 0 — 立项输入（缺则先问）

向用户确认或从仓库推断：

| 项 | 说明 |
| --- | --- |
| 项目名称 | 全文唯一；多端则**多套独立软著、多份手册**，名称勿混用 |
| 端别 | Web 管理端 / 员工 H5 / 桌面端等，一手册一端 |
| 样板 | `_doc/软著申请/demo/*.docx` 若存在则拆结构对标 |
| 演示环境 | baseURL、账号密码、路由模式（history/hash） |
| 字数目标 | 默认正文 ≥8000 汉字/端；有 demo 则对标其章节密度与插图量 |

写入 `task_plan.md` / `progress.md`（若项目已用 planning-with-files）。

### Phase 1 — 功能盘点（代码事实）

只读盘点，产出「菜单/路由/页面 → 可操作动作」清单：

- 路由/菜单配置、`pages.json`、侧栏、Tabbar  
- 各业务页：列表筛选、新增/编辑/删除、审批通过驳回、导出等  
- README / `.env*` 中的端口与演示账号  

**禁止**把规划文档里未实现的模块写成已上线步骤。

### Phase 2 — 材料包骨架

在仓库创建（已存在则补齐）：

```text
_doc/软著申请/
├── README.md                 # 申请清单、环境、如何重导出
├── rule/project_rule.md      # 撰写强制规则（见 references/writing-rules.md）
├── 软著申请-<端>.md          # 素材说明 / 提示词留档（见 references/prompt-kit.md）
├── Screenshot-<端>/README.md # 图号↔文件名清单
├── demo/                     # 可选格式样板 docx
└── .docx-tools/              # 截图与导出脚本（可从本 skill templates 复制）
```

规则模板：[references/writing-rules.md](references/writing-rules.md)  
提示词模板：[references/prompt-kit.md](references/prompt-kit.md)  
章节大纲：[references/outline.md](references/outline.md)

### Phase 3 — 撰写操作说明书（Markdown）

文件建议：`<项目名称>-操作手册-v1.md`（命名：`项目名称-类型-版本`）

**强制结构（对标优质 demo）：**

1. 封面：项目名称 / 用户操作手册 / 文档版本 / 编制日期  
2. 目录  
3. 引言（编写目的、适用范围、术语定义）  
4. 运行环境（硬件最低/推荐表、软件环境）  
5. 系统登录（访问、登录、退出；含失败处理）  
6. 功能概述（架构 + 分模块「功能|说明」表）  
7. **详细操作步骤**（字段级：`字段名：说明`；穿插 `【图n　界面名】`）  
8. 常见问题（Q&A）  
9. 附录  

写作细则见 [references/outline.md](references/outline.md) 与 writing-rules。

### Phase 4 — 自动截图

1. 确认目标服务已启动、账号可登录。  
2. 用 Playwright 优先启动本机 Chrome/Edge；不可用时回退到 Playwright Chromium。首次使用可执行 `npx playwright install chromium` 安装浏览器。
3. 按 `Screenshot-*/README.md` 命名：`图01-登录.png`…  
4. Web 建议 1440×900；H5 建议 390×844 + `deviceScaleFactor: 2`。  
5. **抽检**若干图必须是业务页而非登录页（路由 mode、登录是否成功）。  

可复制并改配置：

- [templates/config.example.json](templates/config.example.json)  
- [templates/capture-screenshots.example.js](templates/capture-screenshots.example.js)

若目标项目已有截图脚本，可结合其路由和登录逻辑调整模板。

### Phase 5 — 导出 Word 并嵌图

1. 确认本任务唯一的 `〈项目名称〉-ruanzhu-doc-config.md`（**配置：doc** + **配置：docx-style**；与产出一对一，见 [references/docx-style.md](references/docx-style.md)）。  
2. `node md-to-docx.js --config "〈项目名称〉-ruanzhu-doc-config.md"`（多项目勿混跑，或显式 `--all`）。  
3. 遇到 `【图n　标题】`：若截图目录有对应 `图NN-*.png` 则嵌入，否则占位。  
4. 交付：`<项目名称>-操作手册-v3.docx`。  
5. 通读：项目名称全文统一、图号连续。

模板：[templates/md-to-docx.example.js](templates/md-to-docx.example.js)
### Phase 6 — 交付清单

向用户给出：

- Markdown 路径与汉字约数、图数量  
- Word 路径与文件大小  
- 截图目录  
- 重跑命令：`node .docx-tools/capture-screenshots.js` → `node .docx-tools/md-to-docx.js`  
- 未覆盖项（如某页需登录态特殊角色、验证码等）

---

## 多端 / 多软著

| 场景 | 做法 |
| --- | --- |
| 管理端 + 员工端 | **两套**项目名称、两套手册、两套截图目录，禁止串写 |
| 仅后端 API | 不写「界面操作说明书」冒充；或单独写接口说明（另议） |
| 有 demo | 先拆 demo 目录与「详细操作步骤」粒度，再按本仓库功能填空 |

---

## 质量闸门（完成前自检）

- [ ] 功能均来自代码盘点，无规划幻想  
- [ ] 项目名称全文一致  
- [ ] 章节齐全且含字段级步骤  
- [ ] 图号与截图文件、正文引用一致；抽检非登录误截  
- [ ] Word 已嵌图或明确标注占位待补  
- [ ] README 写清环境账号与重导出方式  

---

## 参考文件

| 文件 | 用途 |
| --- | --- |
| [references/quick-prompt.md](references/quick-prompt.md) | 用户可粘贴的一键提示词 |
| [references/outline.md](references/outline.md) | 章节与步骤写法 |
| [references/writing-rules.md](references/writing-rules.md) | 强制规则 |
| [references/prompt-kit.md](references/prompt-kit.md) | `软著申请-*.md` 素材说明模板 |
| [templates/](templates/) | config / 截图 / 导出脚本样例 |
| [references/docx-style.md](references/docx-style.md) | `-*-ruanzhu-doc-config.md` / `*-ruanzhu-code-config.md` |
| [templates/docx-style.example.json](templates/docx-style.example.json) | 版式 JSON 样例 |

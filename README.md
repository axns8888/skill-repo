# skill-repo

本仓库提供项目开发流程与中国软件著作权材料准备的 Agent Skills。开发指南覆盖 Python、Vue 3 与 Tauri 项目；软著技能包含操作手册、源码文档、登记信息及聚合编排，以当前项目已实现功能为依据生成材料。

## 技能列表

| Skill | 适用场景 | 产出 |
| --- | --- | --- |
| [python-vue3-tauri-guide](skills/python-vue3-tauri-guide/README.md) | Python + Vue 3 + Tauri 项目规划、开发、联调与交付 | 开发流程、阶段提示词、项目与任务模板 |
| [ruanzhu-gen](skills/ruanzhu-gen/SKILL.md) | 初始化配置、编排整套材料 | 三类独立配置、源码 Word、Agent 待办 |
| [ruanzhu-gen-doc](skills/ruanzhu-gen-doc/SKILL.md) | 用户操作手册、截图与 Word 嵌图 | Markdown / Word 手册及截图 |
| [ruanzhu-gen-code](skills/ruanzhu-gen-code/SKILL.md) | 源码程序鉴别材料 | 按配置抽取源码的 Word 文档 |
| [ruanzhu-gen-intro](skills/ruanzhu-gen-intro/SKILL.md) | 登记表基本信息 | 可分段复制的 Markdown 字段 |

## 安装

```bash
npx skills add axns8888/skill-repo
```

在安装界面选择技能和目标 Agent。使用整套软著聚合流程时，请同时选择全部 4 个 ruanzhu 技能。单独使用操作手册、源码或登记信息时，只安装对应技能即可。

只安装指定技能：

```bash
npx skills add axns8888/skill-repo --skill ruanzhu-gen-code
```

预览仓库中的可用技能：

```bash
npx skills add axns8888/skill-repo --list
```

资源路径均相对于实际加载的 skill 目录。聚合 CLI 默认在本 skill 的相邻目录寻找子技能；安装位置分散时，传入 `--skills-dir "<包含子技能目录的父目录>"`。

Python + Vue 3 + Tauri 指南的本地路径调用、跨项目复用与分享方式见 [使用说明](skills/python-vue3-tauri-guide/README.md)。新增技能通过远程命令安装前，需先发布到远程仓库。

## 环境与依赖

以下依赖用于软著材料生成与截图；开发指南本身是 Markdown 指令，其项目运行依赖按目标项目确定。

- 运行脚本需要 Node.js；本仓库验证环境为 Node.js 24.x。
- 源程序量统计与配置初始化仅使用 Node.js 内置模块。
- Word 导出需要 `docx`；自动截图还需要 `playwright` 及可启动的浏览器。
- 操作手册撰写需要 Agent 读取项目代码；真实页面截图需要已启动、可访问的业务环境和登录信息。

在目标项目准备导出工具目录并安装依赖：

```bash
mkdir -p _doc/软著申请/.docx-tools
cd _doc/软著申请/.docx-tools
npm install docx playwright
npx playwright install chromium
```

PowerShell 可将 `mkdir -p` 替换为 `New-Item -ItemType Directory -Force "_doc/软著申请/.docx-tools"`。若本机 Chrome/Edge 可用，可直接使用；截图脚本依次尝试 Chrome、Edge、Playwright Chromium。

操作手册模板的复制与执行方式见 [模板说明](skills/ruanzhu-gen-doc/templates/README.md)。

## 使用

Python + Vue 3 + Tauri 项目可直接使用：

```text
使用 $python-vue3-tauri-guide，阅读当前项目规范和相关源码，为以下需求制定实施计划，并完成已授权的开发与验证。
需求：〈填写本次需求和预期效果〉
```

更多示例见 [开发指南使用说明](skills/python-vue3-tauri-guide/README.md)。以下为软著技能用法。

直接向 Agent 提出任务，例如：

```text
使用 ruanzhu-gen 为本仓库准备软著材料。
项目名称：示例管理系统
源码范围：apps/server 占 40%，apps/web/src 占 60%
先初始化配置，再生成登记信息、源码文档和操作手册。
```

也可从命令行初始化配置。将 `<SKILL_DIR>` 换成实际加载的 `ruanzhu-gen` 目录：

```bash
node "<SKILL_DIR>/scripts/cli.js" init --root "<目标项目根目录>" --project-name "示例管理系统" --preset custom --paths "apps/server:40,apps/web/src:60"
```

默认在目标项目的 `_doc/软著申请/` 中创建三个独立的 `*-ruanzhu-*-config.md`。已有配置会保留，只有显式传入 `--force` 才覆盖。

执行源码导出并列出其余 Agent 任务：

```bash
node "<SKILL_DIR>/scripts/cli.js" generator --root "<目标项目根目录>" --project-name "示例管理系统"
```

CLI 的 `generator` 执行源码 Word 导出；登记信息正文、操作手册正文、截图配置和业务页面截图由 Agent 按子技能完成。看到待办清单表示这些步骤仍需执行。

可用 `--only code|doc|intro` 选择子任务，或用 `--skip-code-run` 校验配置并查看待办。完整参数见 [CLI 参考](skills/ruanzhu-gen/references/cli.md)。

源程序量采用物理行口径：包含空白行和注释行，空文件计 0 行，末尾换行不额外计行；源码 Word 的“有效行数”另由源码导出脚本统计。

## 本地验证

```bash
node --test tests/ruanzhu.test.cjs
npx skills add . --list
```

第一条运行配置初始化、项目选择、行数边界与浏览器回退测试；第二条检查实际技能发现。完整 Word 导出和真实页面截图还需相应运行依赖与环境。

## 许可证

[MIT](LICENSE)

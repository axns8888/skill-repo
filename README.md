# skill-repo

本仓库提供宝塔面板运维、项目开发流程与中国软件著作权材料准备的 Agent Skills。开发流程由不绑定语言与框架的 axns-devflow 统一提供，技术约定保存在各项目中；软著技能包含操作手册、源码文档、登记信息及聚合编排，以当前项目已实现功能为依据生成材料。

## 技能列表

| Skill | 适用场景 | 产出 |
| --- | --- | --- |
| [axns-ops-bt](skills/axns-ops-bt/README.md) | 宝塔面板运维、网站部署与接口兼容性修复 | 只读 API 诊断、三级执行流程及脱敏修复记录 |
| [axns-devflow](skills/axns-devflow/README.md) | 不限语言、框架和应用形态的项目开发、修复与任务交接 | 通用开发工作流、目录初始化脚本、阶段提示词、项目与任务模板 |
| [axns-copyright-gen](skills/axns-copyright-gen/SKILL.md) | 初始化配置、编排整套材料 | 三类独立配置、源码 Word、Agent 待办 |
| [axns-copyright-gen-doc](skills/axns-copyright-gen-doc/SKILL.md) | 用户操作手册、截图与 Word 嵌图 | Markdown / Word 手册及截图 |
| [axns-copyright-gen-code](skills/axns-copyright-gen-code/SKILL.md) | 源码程序鉴别材料 | 按配置抽取源码的 Word 文档 |
| [axns-copyright-gen-intro](skills/axns-copyright-gen-intro/SKILL.md) | 登记表基本信息 | 可分段复制的 Markdown 字段 |

## 安装

```bash
npx skills add axns8888/skill-repo
```

在安装界面选择技能和目标 Agent。使用整套软著聚合流程时，请同时选择全部 4 个 axns-copyright 技能。单独使用操作手册、源码或登记信息时，只安装对应技能即可。

只安装指定技能：

```bash
npx skills add axns8888/skill-repo --skill axns-copyright-gen-code
```

预览仓库中的可用技能：

```bash
npx skills add axns8888/skill-repo --list
```

资源路径均相对于实际加载的 skill 目录。聚合 CLI 默认在本 skill 的相邻目录寻找子技能；安装位置分散时，传入 `--skills-dir "<包含子技能目录的父目录>"`。

开发流程的本地路径调用与初始化方式见 [使用说明](skills/axns-devflow/README.md)。新增技能通过远程命令安装前，需先发布到远程仓库。

## 名称迁移

| 原技能名称 | 当前名称 |
| --- | --- |
| basic_dev_flow | axns-devflow |
| ops-bt-agent | axns-ops-bt |
| ruanzhu-gen | axns-copyright-gen |
| ruanzhu-gen-doc | axns-copyright-gen-doc |
| ruanzhu-gen-code | axns-copyright-gen-code |
| ruanzhu-gen-intro | axns-copyright-gen-intro |

原 python-vue3-tauri-guide 独立技能已移除，通用流程统一使用 axns-devflow；技术约定整理为上述可选项目模板。

已安装旧名称的成员需安装新名称，确认可用后移除旧技能，并将现有项目提示词中的技能调用改为新名称。安装技能、更新项目提示词和合并项目规范分别处理，已有项目文档不会被自动改写。远程安装前需先将本次变更发布到仓库。

技能改名保留已有 `*-ruanzhu-*-config.md` 配置文件格式、旧 `ruanzhu-gen.md` 配置兼容读取，以及宝塔私有记录目录 `.ops-bt-agent/`。

## 环境与依赖

宝塔技能的内置只读诊断脚本需要 Node.js 22+，SSH 操作按目标环境准备，详见其使用说明。以下依赖用于软著材料生成与截图；开发指南本身是 Markdown 指令，其项目运行依赖按目标项目确定。

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

操作手册模板的复制与执行方式见 [模板说明](skills/axns-copyright-gen-doc/templates/README.md)。

## 使用

任意技术栈项目可使用通用开发工作流：

```text
使用 $axns-devflow，阅读当前项目规范和相关源码，明确成功标准，制定必要计划，并完成已授权的开发、自检与交接。
需求：〈填写本次需求和预期效果〉
```

阶段指令见 [通用开发提示词集](skills/axns-devflow/references/prompt-kit.md)。新项目统一建立 `_doc`、`_plan` 最低流程骨架，可用技能自带初始化脚本快速创建；任务记录按规模裁剪，语言、框架、工具和业务源码目录沿用目标项目。快速上手见 [通用流程使用说明](skills/axns-devflow/README.md)。

技术栈、架构、界面、接口与发布策略写入项目的 `_plan/prompts/project.md` 和 `_plan/guides/`，开发时按任务读取。已采用 Python + Vue 3 + Tauri 的项目可选用 [项目规范模板](templates/python-vue3-tauri/README.md)，裁剪后合并到项目；模板不注册为独立技能，安装技能不会自动复制它。

以下为软著技能用法。

直接向 Agent 提出任务，例如：

```text
使用 axns-copyright-gen 为本仓库准备软著材料。
项目名称：示例管理系统
源码范围：apps/server 占 40%，apps/web/src 占 60%
先初始化配置，再生成登记信息、源码文档和操作手册。
```

也可从命令行初始化配置。将 `<SKILL_DIR>` 换成实际加载的 `axns-copyright-gen` 目录：

```bash
node "<SKILL_DIR>/scripts/cli.js" init --root "<目标项目根目录>" --project-name "示例管理系统" --preset custom --paths "apps/server:40,apps/web/src:60"
```

默认在目标项目的 `_doc/软著申请/` 中创建三个独立的 `*-ruanzhu-*-config.md`。已有配置会保留，只有显式传入 `--force` 才覆盖。

执行源码导出并列出其余 Agent 任务：

```bash
node "<SKILL_DIR>/scripts/cli.js" generator --root "<目标项目根目录>" --project-name "示例管理系统"
```

CLI 的 `generator` 执行源码 Word 导出；登记信息正文、操作手册正文、截图配置和业务页面截图由 Agent 按子技能完成。看到待办清单表示这些步骤仍需执行。

可用 `--only code|doc|intro` 选择子任务，或用 `--skip-code-run` 校验配置并查看待办。完整参数见 [CLI 参考](skills/axns-copyright-gen/references/cli.md)。

源程序量采用物理行口径：包含空白行和注释行，空文件计 0 行，末尾换行不额外计行；源码 Word 的“有效行数”另由源码导出脚本统计。

## 本地验证

```bash
node --test tests/axns-copyright.test.cjs tests/axns-ops-bt.test.cjs tests/workflow-init.test.cjs
npx skills add . --list
```

第一条运行软著行为测试、本地模拟面板测试，以及开发流程目录初始化、重复执行保留已有文件和可移植性测试；第二条检查实际技能发现。完整 Word 导出和真实页面截图还需相应运行依赖与环境。

## 许可证

[MIT](LICENSE)

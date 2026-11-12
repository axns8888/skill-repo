# 通用开发工作流：使用说明

用于个人在不同技术栈项目中快速建立开发流程，也支持接续现有项目。流程目录统一，业务架构和命令按项目事实确定。

## 新项目快速建立流程

新项目至少建立规定的完整 `_doc`、`_plan` 目录骨架，每个子目录有用途 README；目录定义及维护边界见 [最低结构与初始化](references/project-layout.md)。

在 Agent 中打开目标项目后可直接使用：

```text
使用 $axns-devflow，在当前项目初始化开发流程。
按技能规定创建完整 _doc、_plan 最低目录骨架及 README、flow.md，生成项目基线、阶段指南、任务模板和可复制提示词。保留已有文件与现行规范，按真实情况填写已知内容，未知项标记待核实。
本次产品目标：〈目标〉。本次只建立流程文档，业务开发将在后续任务中进行。
```

也可用本技能自带脚本一次建立；需要 Node.js，无第三方依赖。在任意目录执行，替换技能目录、项目路径及名称：

```powershell
node "<技能目录>/scripts/init-workflow.cjs" --project-root "<项目路径>" --project-name "<项目名称>"
```

加 `--dry-run` 可预览；重复执行只补缺失文件，已有文件逐字保留。初始化后先核实 `_plan/prompts/project.md`，再从 `_plan/prompts/stages.md` 选择本次阶段，真实任务放进 `_plan/process/`。没有 Node.js 时 Agent 可按模板手工生成相同结构。

## 进入开发

```text
使用 $axns-devflow，读取当前项目 _plan/README.md、_plan/prompts/project.md 及相关源码，完成以下已授权的开发与验证。
需求：〈目标、预期行为与范围〉。
恢复唯一现行计划和已有工作，按任务规模记录真实变更、验证结果、未覆盖边界及下一步。
```

完整阶段指令见 [提示词集](references/prompt-kit.md)，执行规则见 [SKILL.md](SKILL.md)。已有项目先读取现行规范和任务记录，再增量补齐流程，不覆盖已有业务或创建竞争基线。

## 项目技术约定

具体技术栈、架构、UI、API 和发布策略写入目标项目的 `_plan/prompts/project.md` 与 `_plan/guides/`，按任务读取。生成项目流程时从源码、依赖、配置和现行规范填写实际事实；未知项标明待核实。技能更新不会自动改写已生成的项目文档。

本仓库另提供 [Python + Vue 3 + Tauri 可选项目模板](../../templates/python-vue3-tauri/README.md)，供已采用该技术栈的项目选用。模板独立于技能分发；只安装技能的用户可从仓库获取模板，也可直接让 Agent 依据项目事实生成规范。已有基线按段合并，避免创建第二份。

## 一个窗口一个任务与可选 worktree

窗口指令从 [P0 开窗](prompts/window/P0-open.md) 开始；P1 登记 → P2 执行 → P3 复核 → P4 验收与合入。初始化会生成 `_plan/prompts/window/P0–P5`，更新旧项目时仍只补缺失文件，已有指南需要按需增量整合。P0 回报后等待开窗确认，P5 仅扩展启用时使用。

默认单任务，P1 写 `_plan/.active_plan`，任务放 `_plan/process/<task-id>/`。要隔离多个任务窗口，同时安装 axns-devflow-ext-worktree，并在目标项目 AGENTS.md 声明 `extensions: [worktree]`、实际 `integration_branch` 及可选超时，再按扩展 README 配置忽略项。扩展登记/检查工具会校验范围和修改权，跨窗口共用主检出目录的状态；不会自动提交或合入。

任务结案后窗口不再复用。技术栈规则仍由项目维护，不因 worktree 扩展而改变。

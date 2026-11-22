# skill-repo 技能使用约定

状态：按本仓库当前源码核实，2026-11-22；未声明执行扩展。

本仓库是 Agent Skills 源码与本地同步/验证项目。技能源码唯一入口为 `skills/<skill-name>/`；根 `README.md` 提供技能索引，单项技能版本以各自 `SKILL.md` 的 `metadata.version` 为准，技能行为及使用说明以对应 `SKILL.md`、README 和引用文档为准。

| 技能范围 | 本仓库用途 | 使用/版本事实源 | 项目状态 |
| --- | --- | --- | --- |
| axns-devflow | 维护通用开发流程、初始化模板和协作规范 | `skills/axns-devflow/`；版本字段 `SKILL.md` | 本仓库用于技能改进；生成到目标项目的模板须按该项目事实核实 |
| axns-devflow-ext-worktree | 可选 worktree 隔离能力 | `skills/axns-devflow-ext-worktree/` | 本仓库未在根 `AGENTS.md` 声明启用；本次不使用、不创建 worktree |
| axns-devflow-ext-autopilot | 可选巡检/调度能力及本地配置工具 | `skills/axns-devflow-ext-autopilot/` | 本仓库未在根 `AGENTS.md` 声明启用；存在脚本不表示启用自动执行 |
| 其他仓库技能 | 运维、UI 图转 Vue、软著资料及技能进化 | 根 `README.md` 链接的 `skills/` 子目录 | 源码维护项目；具体使用须遵守各技能自己的适用范围和前置条件 |

维护约定：

- 修改技能时更新对应版本记录与 `skills.lock.json`；根 README 的版本索引须与各技能元数据一致。
- 运行 `npm run skills:lock` 更新快照，`node scripts/skills-local.cjs verify` 校验源码快照；完整验证用 `npm run validate`。
- 安装/同步行为由 `docs/local-development.md` 和 `scripts/skills-local.cjs` 定义。未明确执行同步前，只改源码，不把本机已安装副本视为源码事实源。
- 本仓库中列出或存在某扩展，不代表本仓库项目启用了它；启用需满足项目级明确声明与扩展自身门槛。

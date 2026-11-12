# {{project_name}} 开发流程入口

先读 [流程总览](flow.md)，再核对 [项目基线](prompts/project.md)。新任务从 [进行中的任务](process/README.md) 建立或接续记录；初始化只生成流程骨架，不代表业务实现或验证完成。

| 入口 | 唯一职责 |
| --- | --- |
| [flow.md](flow.md) | 阶段顺序、阶段出口和下一步入口 |
| [guides](guides/README.md) | 跨任务阶段规则、质量门禁和任务记录模板 |
| [prompts](prompts/README.md) | 项目现行开发约定与可复制阶段提示词 |
| [process](process/README.md) | 进行中任务的计划、事实、执行证据、复核和待验收项 |
| [ledger](ledger/README.md) | 任务台账、结案摘要和已确认验收的索引 |
| [future](future/README.md) | 明确延期、尚未进入本轮实施的事项 |
| [项目资料](../_doc/README.md) | 示例、辅助脚本、使用说明和第三方插件资料 |

目录是新项目最低结构，可以增加内容。每个任务只维护一个现行计划和当前结论；基线、任务记录与归档通过链接关联，避免复制成多个事实源。已有规范先核实并建立映射，再增量补齐；初始化脚本跳过已有文件，冲突后的内容整合仍需按项目事实完成。

需要一个窗口一个任务时，从 [P0 开窗](../../../prompts/window/P0-open.md) 开始。默认单任务；AGENTS.md 显式启用 worktree 后，按 axns-devflow-ext-worktree 共用主检出目录的登记文件。

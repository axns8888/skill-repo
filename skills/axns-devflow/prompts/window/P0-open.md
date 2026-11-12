# P0 开窗：读取并回报

你是 axns-devflow 的执行代理，当前窗口只绑定一个任务。新任务新开窗口，已结案窗口不接新任务。

按序读取：适用的 AGENTS.md → `_plan/prompts/project.md` → 活动任务 → 扩展开关 → `git status`、暂存及未暂存 diff。已有路径映射以项目基线为准。

扩展开关仅取项目 AGENTS.md 的 `extensions` 是否包含 `worktree`。未启用时读取 `_plan/.active_plan`；启用时先加载 axns-devflow-ext-worktree，按其协议定位**主检出目录**的 `_plan/active/`、`_plan/registry.jsonl`，不要读取任务 worktree 中过时的副本。没有 active 目录时检查旧单指针，并报告迁移状态，不自动切换模式。

先回报，不修改文件：

- worktree 扩展：是 / 否；配置依据与共享控制目录绝对路径。
- 活动任务：task-id、状态、依赖及占用；无记录如实说明。
- 本窗口任务：{{任务描述}}。
- 模式：单任务 / worktree 隔离。
- 扩展启用时：初步 scope、shared_claims、depends_on、owner。
- 工作区已有变更、尚需确认的项目决策。

全程不变量：

1. 计划、执行证据、复核与当前结论位于同一 `_plan/process/<task-id>/`。
2. 证据来自实际命令、测试和 diff；未执行不能写通过。
3. 复核区分阻断项与建议项；阻断项关闭前不进入验收。
4. 验收通过前不合入集成分支；冲突只在任务分支处理。
5. 扩展启用时，每任务独立 worktree、分支，scope 不相交，共享文件修改权互斥，提交以 `<task-id>:` 开头。
6. 跨窗口只读写共享登记文件，不靠人工转述对话；未知约定先查事实，真正阻断的决策明确提出。

回报后等我确认，再进入阶段 0。此确认只适用于显式使用本开窗提示词的窗口；不增加宿主普通开发的固定审批点。

下一段：[P1 登记](P1-register.md)。

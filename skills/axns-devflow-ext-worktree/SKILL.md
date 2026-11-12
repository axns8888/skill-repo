---
name: axns-devflow-ext-worktree
description: >-
  axns-devflow 的可选 Git worktree 隔离扩展。仅当目标项目 AGENTS.md 的 extensions
  包含 worktree 时，用于多任务窗口的独立分支/工作区、共享登记、scope 与共享文件修改权校验、
  依赖协调、验收合入和安全清理；未启用时保持宿主单任务流程。
---

# Worktree 任务隔离扩展

宿主为 axns-devflow；先读取宿主 SKILL.md 和项目约定。宿主不可用时明确缺失，不重新发明一套宿主流程。扩展不决定项目技术栈，也不自动授权提交、合并、发布或删除已有分支。

## 入口

1. 项目 AGENTS.md 必须明确声明 `extensions` 包含 `worktree`；没有声明时停止扩展动作，回宿主单任务模式。项目需指定本地 `integration_branch`。
2. 阅读 [协议与命令](references/protocol.md)，定位主检出目录的共享登记；使用宿主 `prompts/window/P0-open.md` 至 P5 的唯一提示词，不复制第二套。
3. 一个窗口绑定一个 task-id 和 `task/<task-id>` 分支、`.worktrees/<task-id>`；跨窗口通过主检出目录 `_plan/active/`、`_plan/registry.jsonl` 通信。任务计划与证据只在本任务 `_plan/process/<task-id>/` 维护。
4. 用 `scripts/worktree.cjs` 登记、重新仲裁、检查、升级及结案。脚本只依赖 Node.js 与 Git，批次 1（生命周期/登记）和批次 2（scope/修改权）同时启用。退出码 0 成功、2 已登记但 blocked、1 拒绝或错误。

## 必须保持

- scope 使用仓库相对的精确文件/目录前缀，活动持权任务的 scope 不相交；共享文件单列 shared_claims，同一时刻唯一持权。blocked 不获得任何修改权；escalated 保留原有权但停止推进。
- 开始执行及提交前从任务 worktree 运行 check；越界、依赖未完成、身份错误或持权冲突时不提交。提交以 `<task-id>:` 开头。脚本是协作检查，不是文件系统沙箱或自动 Git hook。
- 复核区分阻断项与建议项。合并冲突和语义冲突在任务分支解决；组合结果重新验收后，才按依赖顺序将已验收提交快进合入集成分支。集成分支前移则回任务分支重新验证。
- 用户验收、命令结果和阻断项关闭证据必须真实。finish 的 `--accepted-head` 是调用者对验收事实的声明，脚本只能核实提交身份、证据文件和 Git 状态，不能判断验收内容真伪。
- 清理前保留并合入任务证据；不强制移除 dirty worktree，不删除任务分支。异常时保留现场和持权，不自动抢锁、放宽 scope 或擅自改集成分支。
- 重复冲突、方案不兼容、共享文件导致的连续 CI 失败或等待超时，按宿主 P5 暂停并记录 `task.escalated`，等待用户裁决。

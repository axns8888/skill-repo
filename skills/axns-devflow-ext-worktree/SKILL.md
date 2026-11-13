---
name: axns-devflow-ext-worktree
description: >-
  axns-devflow 的可选 Git worktree 隔离扩展。仅当目标项目 AGENTS.md 的 extensions
  包含 worktree 时，用于多任务窗口的独立分支/工作区、共享登记、scope 与共享文件修改权校验、
  依赖协调、验收合入和安全清理；未启用时保持宿主单任务流程。
---

# Worktree 任务隔离扩展

宿主为 axns-devflow；先读取宿主 SKILL.md 和项目约定。宿主不可用时明确缺失，不重新发明一套宿主流程。扩展不决定项目技术栈。用户授权完成 worktree 任务后，默认连续完成本任务范围内的提交、验证、本地合入、归档及任务 worktree/分支删除，无需逐步再问；用户明确要求保留、仅评审或等待确认时遵从该要求。远程推送、发布、删除远程分支不包含在本地收尾中。

## 入口

1. 项目 AGENTS.md 必须明确声明 `extensions` 包含 `worktree`；没有声明时停止扩展动作，回宿主单任务模式。项目需指定本地 `integration_branch`。
2. 阅读 [协议与命令](references/protocol.md)，定位主检出目录的共享登记；使用宿主 `prompts/window/P0-open.md` 至 P5 的唯一提示词，不复制第二套。
3. 一轮执行绑定一个 task-id 和 `task/<task-id>` 分支、`.worktrees/<task-id>`；跨窗口通过主检出目录 `_plan/active/`、`_plan/registry.jsonl` 通信。任务计划与证据只在本任务 `_plan/process/<task-id>/` 维护。会话在结案或完成执行权交接后可复用；切换任务时重新核实登记、目录、分支和持权，不把上一任务的修改权带入新任务。
4. 用 `scripts/worktree.cjs` 登记、重新仲裁、检查、自动提交、升级及结案；遗留锁或工作区异常用只读 `doctor` 排查。脚本只依赖 Node.js 与 Git，批次 1（生命周期/登记）和批次 2（scope/修改权）同时启用。退出码 0 成功、2 已登记但 blocked、1 拒绝或错误。

## 必须保持

- scope 使用仓库相对的精确文件/目录前缀，活动持权任务的 scope 不相交；共享文件单列 shared_claims，同一时刻唯一持权。blocked 不获得任何修改权；escalated 保留原有权但停止推进。
- 开始执行及提交前从任务 worktree 运行 check；越界、依赖未完成、身份错误或持权冲突时不提交。提交以 `<task-id>:` 开头。脚本是协作检查，不是文件系统沙箱或自动 Git hook。
- 复核区分阻断项与建议项。合并冲突和语义冲突在任务分支解决；组合结果重新验收后，才按依赖顺序将已验收提交快进合入集成分支。集成分支前移则回任务分支重新验证。
- 命令结果、阻断项关闭证据及人工确认必须真实。人工验收独立读取主检出目录 `_plan/prompts/acceptance.json`，默认关闭；开启且非阻塞时可保留待确认状态结案。显式阻塞时 finish 要求 `--human-accepted-by` 可追溯确认依据，绑定 `--accepted-head`；只等待当前任务。finish 的 `--accepted-head` 是调用者对技术验收事实的声明，脚本只能核实提交身份、证据文件和 Git 状态，不能判断验收内容真伪。
- 清理前保留并合入任务证据；finish 自动快进合入最终候选，先写可恢复归档，再删除本任务干净 worktree 和精确匹配的已合入本地分支；完成后释放持权。不强制移除 dirty worktree。异常时保留现场和持权，不自动抢锁、prune、放宽 scope 或擅自改集成分支；Git 自身的 worktree 锁与本扩展协调锁分别核实。
- 冲突、验证失败、依赖等待、基线前移和清理失败先自行排查、修复并复验；次数或超时只是诊断信号，不自动要求用户介入。只有无法安全恢复、缺少必要权限/秘密，或存在需要用户选择的重大方案分歧时才按 P5 升级；保留证据，暂停受影响任务，其他独立任务继续。

使用 DSH/Orca 与 PyCharm 时，平台和 IDE 打开已登记的同一任务目录，不为同一任务再创建嵌套 worktree；原生任务清单通过 task-id 关联项目计划。未启用本扩展时沿用平台原生工作区。详见宿主 [工具协作](../axns-devflow/references/tool-integration.md)。

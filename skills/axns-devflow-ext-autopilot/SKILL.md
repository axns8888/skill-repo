---
name: axns-devflow-ext-autopilot
description: axns-devflow 的可选自驱调度扩展。在项目 AGENTS.md 的 extensions 包含 autopilot 时，读取已登记任务、阶段完成证据和窗口占用，生成阶段推进、模型路由及已验收任务结案建议；显式开启执行后支持阶段领取、互斥派发、证据回调与中断恢复。用于任务排队、巡检及 DSH/Orca 自动化接入，定时唤醒由平台负责。
---

# 自驱调度扩展

宿主为 `axns-devflow`，可叠加 `axns-devflow-ext-worktree`。先读宿主与项目约定；宿主缺失时报告依赖。本扩展沿用宿主的一份计划、证据与验收流程，新增的仅是临时调度元数据。

## 入口

1. 从主检出目录 `AGENTS.md` 读取 `extensions: [autopilot]` 和 `autopilot_config`。没有开关时保持手动模式；安装或自然语言提及均不启用。
2. 读 [决策协议](references/protocol.md)，按 [配置字段](references/config.md) 核实配置、运行态和平台能力。首次接入按 [README](README.md) 操作。
3. 运行只读脚本，始终同时检查退出码和 JSON：

   ```powershell
   node "<扩展目录>/scripts/autopilot.cjs" status --project "<项目或任务 worktree>"
   node "<扩展目录>/scripts/autopilot.cjs" decide --project "<项目或任务 worktree>"
   ```

4. 需要实际执行时读 [执行与恢复](references/execution.md)；DSH/Orca 接入另读 [平台接入](references/platforms.md)。只有 execution.enabled 为 true 才接受新派发；原生自动化会话使用 runner.cjs claim，外部启动桥使用 tick。claim/tick 优先完成可收尾任务；返回 finished 时该轮已结案，返回 request 时只执行该工单阶段并回调交接。
5. 只读判定退出码 0 时，仅执行当前授权和平台能力允许的建议；1 表示读取或配置失败，不动作；2 表示没有可执行动作且有任务需要处理。任务自身异常只 hold 当前任务（blocks_batch: false），独立任务仍可执行并退出 0；配置、共享登记或协调锁损坏直接退出 1，不派发。显式人工验收等待维持非错误等待。`hold` 是等待原因，不代表测试失败。

## 必须保持

- **建议与执行分离。** autopilot.cjs 始终只读；runner.cjs 在显式开启后维护占位、阶段、心跳、回执和证据事件。平台负责会话和定时唤醒。Orca 适配器仅生成禁用状态的安装计划，command 适配器调用接入方提供的桥；未完成实机接入时不宣称已无人值守运行。
- **不扩张授权。** 只调度已登记、已授权的任务；scope、依赖、交付范围及授权变化交由宿主处理。已授权 worktree 任务默认包含范围内提交、技术验收后的本地合入、归档和本任务资源删除；沿用明确的用户限制。启用配置不授予派生代理或外部发布的权限。平台创建子代理仍须符合会话授权。
- **先完成再推进。** 文件存在不代表阶段完成。只有显式 `completed`、有效证据和当前受测提交身份才可进入下一阶段。默认最高 P4；P0 可沿用已有执行授权，不要求再次开窗确认；用户明确要求回报后等待时保留该边界。
- **窗口属于任务。** 一个任务同一时刻只允许一个活动窗口；需要换模型时先完成交接并关闭旧窗口。扩展不要求每阶段重开窗口，也不复用已结案窗口执行新任务。
- **占用不能靠猜。** 丢失或过期心跳不会自动释放窗口。开窗去重由 runner 在共享锁内原子预留；外部启动桥须能按 dispatch_id 查询，重复读取建议不等于执行幂等。
- **验收必须有事实。** 默认开启 `finish_task` 能力，实际执行仍要求 execution.enabled=true；已有显式 false 保持关闭。仅 worktree 模式支持机械结案，要求技术验收通过、完整候选 HEAD、已提交验收材料、干净工作区，且已合入或可快进合入。人工验收独立读取主检出目录 `_plan/prompts/acceptance.json`，默认关闭；开启且非阻塞时保留待确认状态，不阻止结案；显式阻塞时要求该候选的独立 human_acceptance 真实回执。脚本不能判断验收真伪，由执行窗口用真实检查及 --accepted-head 声明技术通过，不推测或伪造人工确认。
- **复用平台清单。** DSH/Orca 原生自动化负责唤醒，原生清单组织本阶段步骤并关联 task-id；按宿主 [工具协作](../axns-devflow/references/tool-integration.md) 衔接 PyCharm，不复制第二份计划、不同时开启两个平台执行同一任务。
- **失败可追溯。** fail/interrupt 累计当前阶段失败次数；控制者核实原因与原回执后用 retry 恢复相同阶段，保留历史且不清零预算，不自动重试未知会话。非 Git 完成同样绑定内容快照。
- **复用既有仲裁。** 任务状态、依赖、scope、持权与结案仍归 worktree 扩展；runner 在共享锁内委托 worktree helper 收尾，不另造登记协议。单任务模式槽位固定为 1。

## 能力

| 能力 | 默认 | 作用 |
| --- | --- | --- |
| `advance` | 开，最高 P4 | 建议执行当前待办阶段或进入已完成阶段的下一阶段 |
| `switch_model` | 开 | 建议模型路由；没有模型表时沿用平台当前模型 |
| `open_window` | 开，仅已登记任务 | 在可用槽位内建议调度；实际操作由平台完成 |
| `finish_task` | 开 | 对已验收 worktree 任务执行本地合入、归档及工作区/分支删除，支持中断重试 |

调度运行态写在主工作区 `_plan/autopilot/<task-id>/`，计划和证据仍在任务工作区 `_plan/process/<task-id>/`。格式、写入责任、去重及恢复顺序见 [决策协议](references/protocol.md)。

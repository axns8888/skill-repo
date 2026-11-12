# 自驱决策协议

阅读顺序：状态来源 → 阶段与窗口 → 判定 → 执行平台契约 → 结案与恢复。

## 状态来源与职责

宿主负责计划、证据、复核与验收；worktree 负责登记、scope、共享修改权、依赖与清理。本扩展只产出下一步建议，不修改这些事实。

| 来源 | 读取位置及用途 |
| --- | --- |
| 主检出目录 AGENTS.md | 唯一开关、配置路径、共享等待超时 |
| `_plan/active/*.pointer`、`_plan/archive/*.pointer` | worktree 活动任务与已完成依赖；任务 worktree 中的副本不权威 |
| `_plan/.active_plan` | 未启用 worktree 时的当前任务；有效槽位为 1 |
| 任务工作区 `_plan/process/<task-id>/` | 唯一计划、证据、parallel.json 与 acceptance.md |
| 主检出目录 `_plan/autopilot/<task-id>/` | 本扩展新增的临时 stage.json、window.json；不参与版本控制 |

Git 项目先用 `git worktree list --porcelain -z` 定位主检出目录，从任务 worktree 调用也读取同一开关、配置及运行态。worktree 任务记录从登记的 `.worktrees/<task-id>` 读取，校验指针、parallel.json 与当前分支一致。依赖只有在归档指针为 completed 时才算完成；事件流用于 worktree 的审计，不作为另一套依赖或阶段状态。

脚本遇到损坏 JSON、无效路径或身份冲突时直接失败，不能把读失败解释为“没有任务”。读取前后检查协调锁，复读已观测文件、任务 HEAD 和工作区快照；检测到变化则退出 1。读取快照不能保证执行时仍然有效，执行前须重新核实。

## 阶段声明

运行态是调度依据，不证明开发事实；只有任务控制窗口或受其委托的适配器维护，按临时文件加原子替换写入。每个任务一个控制者，不允许多个窗口分别维护自己的版本。stage.json 示例：

```json
{
  "task_id": "20261112-example",
  "stage": "P2",
  "state": "completed",
  "owner": "controller/example",
  "updated_at": "2026-11-12T15:00:00+08:00",
  "attempts": 0,
  "evidence": "evidence.md",
  "completed_head": "完整的受测提交哈希",
  "completed_worktree": "status 返回的 worktree_snapshot"
}
```

- `stage` 为 P0–P5，`state` 为 ready / running / completed / failed；task_id 必须匹配目录，owner 非空，updated_at 为含时区且不晚于当前时间的 ISO 时间。
- `ready` 调度当前阶段；`running` 不允许跳到下一阶段；`completed` 才允许顺推。P5 始终等待人工裁决，不自动进入。
- 除 P0 外，completed 必须给出任务记录目录内非空证据文件的相对路径 `evidence`；Git 项目还要求 `completed_head` 等于当前 HEAD，`completed_worktree` 等于 status 输出的 `worktree_snapshot`。快照覆盖暂存、未暂存差异及非忽略的未跟踪文件内容，避免提交未变但代码已改时误用旧证据；不要求为推进阶段额外提交。忽略文件、依赖与运行环境仍须由实际证据记录，快照不证明它们相同。非 Git 单任务仍须真实证据，不能声明已校验 Git 身份。
- 完成自检/复核、确认没有阻断后才能填写 completed。脚本只验证声明与文件/提交身份的一致性，不能判断自然语言证据是否充分或真实；执行窗口仍遵守宿主门禁。
- 采用宿主 P0 时，其 completed 记录须另有 `user_confirmed: true`，只能据实际开窗确认填写。已登记任务可以从实际阶段接入，无须补跑 P0 或重复取得已有授权。
- `stage_markers` 只在 status 或缺失阶段时报告 marker_hits；无 stage.json 时 hold，不从模板存在推断完成，也不把正常保留的旧产物认作阶段冲突。
- `attempts` 为当前待执行阶段连续启动失败次数，由适配器如实维护，默认 0；成功进入新阶段后归零。失败和证据失效不能通过改 ready 隐去。

阶段完成时先写入实际成果和证据，有提交授权时再提交；运行 status 取得当前 head 与 worktree_snapshot，最后在主工作区写 completed。调度运行态不会改变任务快照。后续提交、源码变更或暂存状态改变都会使旧身份失效，必须按实际影响复核并更新证据；不要只刷新哈希。

## 窗口与槽位

window.json 由执行平台在派发前预留：

```json
{
  "task_id": "20261112-example",
  "stage": "P2",
  "dispatch_id": "decide 输出的稳定去重标识",
  "owner": "platform/window-id",
  "opened_at": "2026-11-12T15:00:00+08:00",
  "heartbeat_at": "2026-11-12T15:05:00+08:00"
}
```

所有活动任务的 window.json 都计入窗口占用，包括 blocked 或 escalated 的窗口。缺少窗口时不按 stage.updated_at 猜测“仍在运行”。存在窗口时同一任务不再派发；超过心跳阈值则 window_stalled，仍占槽位。旧窗口是否真正结束由平台核实，不能靠过期自动接管。

一个窗口只绑定一个任务；不要求每阶段新开窗。阶段内不能同时有第二个执行者。交接换模型时先保存证据并关闭旧窗口，再由适配器协调下一次派发。一个任务完成后窗口不接新任务。

## 判定顺序与输出

按首个命中条件返回一个建议：

| 条件 | 结果 |
| --- | --- |
| escalated 或共享等待超过 lock_timeout_minutes | hold，需要人工 |
| blocked / completed / 未持权 / 未完成依赖 | hold；未持权异常需要人工 |
| 有活动窗口 | window_active；过期为 window_stalled，需要人工 |
| 无显式阶段 / P5 / 尝试达到上限 / failed / running 却无窗口 | hold，需要核实或裁决 |
| completed 缺证据、Git HEAD 或工作区快照已变化 | hold，需要人工处理证据失效 |
| P4 completed | 进入下节的结案检查；默认 finish_disabled |
| P0 completed 未记录真实开窗确认 | p0_confirmation_pending |
| 目标阶段超过上限 / 推进或开窗关闭 / 槽位满 | hold |
| 其他 | advance，next_stage 为 ready 的当前阶段或 completed 的下一阶段 |

多个任务按 task-id 排序，先统计全部窗口占用，再逐项预留本轮建议预算。action 只有 hold、advance、finish，没有独立的 open_window 动作。advance 同时表达阶段和调度建议，实际可复用当前任务的已交接平台会话或打开新会话。

退出码 0 表示快照判定成功，不代表执行成功；1 为输入、配置或读取失败；2 表示存在人工介入项。退出 2 时整轮自动动作都转换为 hold / batch_needs_human，避免部分消费者误执行。status 成功返回 0，真实等待情况在字段中报告。

## 执行平台契约

本仓库尚未提供执行适配器。接入方须实现以下契约，缺少其中任一项时只能运行只读建议：

1. 验证实际会话/模型/调度能力及已有授权。扩展开关不授权派生代理、发消息、提交或合入；平台不支持的动作报告不可用，不伪装已执行。
2. 单控制者串行消费建议。在共同 Git 目录的 axns-devflow.lock 下重新读取任务、阶段、窗口、依赖、HEAD 与配置并判定，确认 dispatch_id 仍相同，再以排他创建 window.json 预留。单任务非 Git 项目也须由平台提供同等互斥。需要多控制者时必须共用互斥和预算，不能各自按 slots 开窗。
3. 锁内不可启动会话或运行 worktree 辅助命令，避免长时间占锁及嵌套死锁。decide 发现该锁时会拒绝读取，所以锁内重验须由适配器读取同一输入或实现等价 CAS；不能递归运行本脚本。核对后写入预留，释放锁，再请求平台启动。
4. 平台启动请求使用 dispatch_id 作为幂等键。同一标识重复投递须返回既有会话；平台若无幂等启动 API，只能在失败后查询并恢复，不能不确定时重试。崩溃在“预留后、启动前”会留下占用，应查询平台结果再恢复。
5. 启动成功后写 running 并维护心跳。启动失败确认没有会话时增加 attempts、记录失败到原任务证据，再释放自己的预留；达到 max_attempts 则停止。不得计数归零来绕过上限。开发阶段失败进入 failed，并按宿主处理阻断，不自动跳阶段。
6. 阶段结束先写真实证据和 completed，再确认旧窗口已关/已交接，校验 owner 与 dispatch_id 后移除预留。已在运行的会话不因重复建议再执行一次。动态配置不会强制撤销已有窗口。
7. 每次副作用前重查授权与当前状态。finish 使用既有 worktree 工具作最终门禁；其拒绝时原样报告并保留现场，不自动重试或绕过。不要把轮询输出当执行日志，实际动作写入原任务证据。

`dispatch_id` 是任务、阶段状态、HEAD、工作区快照、建议动作和配置的哈希，同输入不变；它只能供去重，不能替代原子预留或平台查询。脚本重复执行无副作用，执行系统的幂等依赖以上机制。

## 结案与验收回执

finish_task 默认关闭。即使放开，也仅支持 worktree，并要求：claimed 且持权，依赖已归档 completed，无活动窗口，P4 completed，阶段证据有效，任务分支身份一致，验收材料已提交、所有工作树内容干净（含未跟踪/忽略文件），任务 HEAD 已进入集成分支。

控制窗口在**真实人工验收已记录且最终候选已固定**后，给主工作区的 stage.json 增加：

```json
{
  "acceptance": {
    "result": "passed",
    "accepted_by": "可追溯的验收人或确认记录",
    "accepted_head": "完整的最终候选HEAD"
  }
}
```

`accepted_head` 必须是 40 或 64 位完整 Git 哈希，等于阶段 completed_head 与任务当前 HEAD。任务自身的 acceptance.md 必须非空且与 HEAD 中已提交内容一致。不要让 acceptance.md 写入“包含自身的提交”的哈希；候选身份写到版本控制之外的临时回执，避免自引用；同时记录当前 worktree_snapshot 到 completed_worktree。验收材料中仍须记录实际受测版本和真实验收依据。

脚本不能证明 accepted_by 是真人，也不能凭非空材料证明已验收。填写回执的窗口须依据用户确认，不能凭测试通过、模板存在或启用配置自行填 passed。若验收后有代码或验收范围变化，须重新核实最终候选。

已有合入授权且宿主门禁满足时，宿主完成集成；脚本只消费已集成事实。执行方从主检出目录、任务 worktree 之外调用：

```powershell
node "<worktree扩展>/scripts/worktree.cjs" finish --project "<主检出目录>" --id "<task-id>" --accepted-head "<建议的完整HEAD>"
```

最终仍由 worktree 工具检查、清理、归档并释放修改权。确认完成归档后，适配器可以清理该任务调度元数据；结案失败不得提前删除。单任务模式不模拟这套清理和归档，回到宿主正常收尾。

## 故障恢复

保留错误、任务状态及旧预留。配置或损坏文件先修复再重读；协调锁遗留先查实际进程和 worktree 事件；过期窗口先确认平台会话。需要改变 scope、依赖或授权时交由宿主裁决，worktree 项目沿 P5 升级并保留修改权。不要在单任务项目调用不存在的 worktree 升级命令。

共享协调只覆盖同机同仓库，不能保护不同 clone 或机器。扩展与宿主发生冲突时以宿主和 worktree 为准。

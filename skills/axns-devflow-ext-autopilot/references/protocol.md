# 自驱决策协议

阅读顺序：状态来源 → 阶段与窗口 → 判定 → 执行平台契约 → 结案与恢复。

## 状态来源与职责

宿主负责计划、证据、复核与验收；worktree 负责登记、scope、共享修改权、依赖与清理。判定脚本只产出下一步建议；runner 维护调度运行态与任务证据事件，不修改宿主登记、scope 或验收结论。

| 来源 | 读取位置及用途 |
| --- | --- |
| 主检出目录 AGENTS.md | 扩展启用开关、autopilot 配置路径、共享等待超时 |
| 主检出目录 `_plan/prompts/acceptance.json` | 独立人工验收策略；不由任务工作区副本覆盖 |
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
- 除 P0 外，completed 必须给出任务记录目录内非空证据文件的相对路径 `evidence`；Git 项目还要求 `completed_head` 等于当前 HEAD；所有项目的 `completed_worktree` 均须等于 status 输出的 `worktree_snapshot`。快照覆盖暂存、未暂存差异及非忽略的未跟踪文件内容，避免提交未变但代码已改时误用旧证据；不要求为推进阶段额外提交。忽略文件、依赖与运行环境仍须由实际证据记录，快照不证明它们相同。非 Git 单任务使用完整目录内容指纹（仅排除 `_plan/autopilot/`，链接只记录目标、不遍历），HEAD 为 null；源码、证据、配置或生成物变化均使旧快照失效，不能声明已校验 Git 身份。
- 完成自检/复核、确认没有阻断后才能填写 completed。脚本只验证声明与文件/提交身份的一致性，不能判断自然语言证据是否充分或真实；执行窗口仍遵守宿主门禁。
- 采用宿主 P0 时，其 completed 记录须另有 `user_confirmed: true`，表示已核实本任务适用的执行授权，可依据原执行指令或本次确认，并在任务证据中保留依据；不是每次开窗另问一次。若用户明确要求本次回报后确认，则必须取得该确认，旧授权不能替代。已登记任务可以从实际阶段接入，无须补跑 P0 或重复取得已有授权。
- `stage_markers` 只在 status 或缺失阶段时报告 marker_hits；无 stage.json 时 hold，不从模板存在推断完成，也不把正常保留的旧产物认作阶段冲突。
- `attempts` 为当前阶段累计失败次数（权威未启动、fail 与 interrupt），由 runner 如实维护，默认 0；进入新阶段后归零，retry 不清零。失败和证据失效不能通过改 ready 隐去。

阶段完成时先写入实际成果和证据，有提交授权时再提交；使用 runner complete 记录结果，runner 在完成事件落盘后捕获最终 HEAD/工作区快照并写回执。兼容手动维护时，运行 status 取得当前 head 与 worktree_snapshot，最后在主工作区写 completed。调度运行态不会改变任务快照。后续提交、源码变更或暂存状态改变都会使旧身份失效，必须按实际影响复核并更新证据；不要只刷新哈希。

## 窗口与槽位

window.json 由 runner 在派发前预留；下例为只读判定所需的最小字段，runner 另保存 request、adapter、execution、initial_stage 和 phase 用于恢复：

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

一个活动派发只绑定一个任务；不要求每阶段新开会话，阶段内不能同时有第二个执行者。交接换模型时先保存证据并交接原派发，再由平台协调下一次派发。结案或交接结束后可复用平台会话接续新任务，但须重新核实任务身份、目录与授权，使用新的 owner / dispatch；旧回调不能操作新任务。

## 判定顺序与输出

按首个命中条件返回一个建议：

| 条件 | 结果 |
| --- | --- |
| escalated | hold，需要用户决定 |
| blocked / completed / 未持权 / 未完成依赖 | hold；未持权或等待超时需要自主排查 |
| 有活动窗口 | window_active；过期为 window_stalled，先核实原会话 |
| 无显式阶段 / P5 / 尝试达到上限 / failed / running 却无窗口 | hold，需要核实或裁决 |
| completed 缺证据、Git HEAD 或工作区快照已变化 | hold，先自主核实证据失效 |
| P4 completed | 进入结案检查；集成前移时重新派发 P4 组合验证 |
| P0 completed 未声明已核实适用的执行授权 | p0_confirmation_pending |
| 目标阶段超过上限 / 推进或开窗关闭 / 槽位满 | hold |
| 其他 | advance，next_stage 为 ready 的当前阶段或 completed 的下一阶段 |

多个任务按 task-id 排序，先统计全部窗口占用，再逐项预留本轮建议预算。action 只有 hold、advance、finish，没有独立的 open_window 动作。advance 同时表达阶段和调度建议，实际可复用当前任务的已交接平台会话或打开新会话。

退出码 0 表示判定正常，不代表执行成功；1 为输入、配置、共享登记、协调锁或读取失败，不派发；2 表示没有可执行动作且存在需处理的任务异常。失败、超时、升级及证据失效均标记 blocks_batch: false，仅暂停自身；未完成依赖仍阻塞下游，独立任务有槽位时继续，退出 0。needs_human_count 仅计需要用户决定或显式确认的项，recovery_count 计先由 AI 诊断的异常，blocking_human_count 为 0 表示没有整轮阻断项；不能只看退出码忽略逐任务原因。显式人工验收等待仍退出 0，非阻塞人工待确认以 human_acceptance: pending 报告。status 成功返回 0，真实等待情况在字段中报告。

## 执行平台契约

内置 runner 提供 session 领取与 command 外部启动桥，并由共享 core 执行锁内重判。用法见 [执行与恢复](execution.md)，平台选择见 [平台接入](platforms.md)。runner 实现以下公共契约；接入方仍负责真实平台会话、模型确认及按 dispatch_id 查询：

1. 验证实际会话/模型/调度能力及已有授权。已授权 worktree 任务包含本地自动收尾；扩展开关不授权派生代理、发消息或远程发布；平台不支持的动作报告不可用，不伪装已执行。
2. 单控制者串行消费建议。在共同 Git 目录的 axns-devflow.lock 下重新读取任务、阶段、窗口、依赖、HEAD 与配置并判定，确认 dispatch_id 仍相同，再以排他创建 window.json 预留。单任务非 Git 项目由 runner 的 _plan/autopilot/.lock 提供同等互斥。需要多控制者时必须共用互斥和预算，不能各自按 slots 开窗。
3. 锁内不可启动会话或递归运行会再次取锁的 worktree CLI，避免长时间占锁及嵌套死锁。自动收尾在已持有的同一协调锁内直接调用 worktree finish 函数，不重复取锁。decide 发现该锁时会拒绝读取，所以 runner 使用持锁 token 调用共享 core 重验；外部读取不接受该 token，不能递归运行只读 CLI。核对后写入预留，释放锁，再请求平台启动。
4. 平台启动请求使用 dispatch_id 作为幂等键。同一标识重复投递须返回既有会话；平台若无幂等启动 API，只能在失败后查询并恢复，不能不确定时重试。崩溃在“预留后、启动前”会留下占用，应查询平台结果再恢复。
5. 启动成功后写 running 并维护心跳。启动失败确认没有会话时增加 attempts、记录失败到原任务证据，再释放自己的预留；达到 max_attempts 则停止。不得计数归零来绕过上限。开发阶段 fail/interrupt 同样累计 attempts 并进入 failed。控制者凭当前失败回执与真实处理依据使用 runner retry 恢复相同阶段；历史保留、次数不清零，无活动窗口且未超预算才允许，不自动跳阶段。
6. 阶段结束先写真实证据和 completed，再确认旧窗口已关/已交接，校验 owner 与 dispatch_id 后移除预留。已在运行的会话不因重复建议再执行一次。动态配置不会强制撤销已有窗口。
7. 每次副作用前重查授权与当前状态。finish 使用既有 worktree 工具作最终门禁；其拒绝时保留现场，先自主修复原因再重试；不能绕过候选、scope 或验收检查。不要把轮询输出当执行日志，实际动作写入原任务证据。

`dispatch_id` 是任务、阶段状态、HEAD、工作区快照、建议动作和配置的哈希，同输入不变；它只能供去重，不能替代原子预留或平台查询。脚本重复执行无副作用，执行系统的幂等依赖以上机制。

## 结案与验收回执

finish_task 默认开启，实际执行仍须 execution.enabled=true；显式 false 保持关闭。仅支持 worktree，并要求：claimed 且持权，依赖已归档 completed，无活动窗口，P4 completed，阶段证据有效，任务分支身份一致，验收材料已提交、所有工作树内容干净（含未跟踪/忽略文件），任务 HEAD 已进入集成分支或包含当前集成 HEAD 可安全快进。

项目人工策略只读自主检出目录 `_plan/prompts/acceptance.json`；缺省关闭。enabled: true / blocking: false 跟踪人工待办，不阻止技术结案；只有两者均为 true 才等待当前任务的人工确认。策略也进入 dispatch_id，配置变化后必须重新判定。

P4 技术检查通过且最终候选固定后，控制窗口给主检出目录 stage.json 写入技术回执：

```json
{
  "acceptance": {
    "result": "passed",
    "accepted_head": "<40或64位完整最终HEAD>"
  }
}
```

技术回执不是人工通过。只有真实人工确认后，另加同级 human_acceptance，字段为 result: "passed"、accepted_by: "可追溯验收人及确认记录"、accepted_head: "相同完整HEAD"。旧 acceptance.accepted_by 不再代表人工回执；阻塞项目迁移时须核实原确认后再填写独立字段，不能自动补造。

accepted_head 必须等于 completed_head 和当前任务 HEAD；completed_worktree 记录当前工作区快照。acceptance.md 必须非空且与该 HEAD 已提交内容一致，记录真实命令、技术结论及独立人工状态。不要在文档中写包含自身的提交哈希；最终身份写到版本控制外的回执。人工通过不替代技术验证，后续代码或候选变化使对应回执失效。

脚本不能证明 accepted_by 是真人；窗口必须根据实际确认填写。关闭时返回 human_acceptance: disabled，开启而无当前确认返回 pending，有有效当前回执返回 passed。非阻塞待确认需在项目台账保留任务及候选入口，技术结案不会自动变成人工通过。

finish 建议给出 accepted_head。human_acceptance 为 passed 时还给出 human_accepted_by，实际调用 worktree helper 时传入：

```powershell
node "<worktree扩展>/scripts/worktree.cjs" finish --project "<主检出目录>" --id "<task-id>" --accepted-head "<建议的完整HEAD>"
```

有真实人工回执时追加 `--human-accepted-by "<建议中的 human_accepted_by>"`。阻塞策略缺失真实回执时不调用；worktree helper 也独立读取主配置并拒绝清理。默认关闭或非阻塞待确认时可正常 finish，归档如实记录策略和状态。

P4 工作者使用 complete --accepted-head <最终候选> 声明真实技术验收，runner 校验已提交材料和干净状态后写 acceptance；只有真实人工确认才能附 --human-accepted-by。claim/tick 在无活动窗口时优先收尾，也可用 runner finish；内部在共享锁下委托 worktree helper。存在 finishing 归档时从记录恢复清理，不要求工作区仍存在，不重复生成任务。完成归档后保留 runtime 回执供审计。

recovery_required 不是用户介入请求。控制会话先检查失败证据和真实进程状态，用既有 retry/recover/claim/finish 协议恢复；不得把未知会话当停止或清零失败计数。预算耗尽需给出根因与新的有限修复方案，不能无限重试；只有无法在授权内解决时升级。precheck 对待恢复任务也允许唤醒，以免普通失败永久无人处理。

# 执行与恢复

本页适用于显式开启 runner 的项目。建议和判定见 protocol.md；平台定时唤醒见 platforms.md。

## 入口与退出码

所有命令均要求 --project，路径指向主检出或任务 worktree；运行态统一落主检出。autopilot.cjs status/decide 始终只读。runner 的新任务初始化、失败重试和派发要求 execution.enabled=true；Git 项目还必须忽略 /_plan/autopilot/，且该目录不能已被跟踪。

| 命令 | 参数及行为 |
| --- | --- |
| init | --id --stage --owner；为已登记任务创建缺失的 ready 状态，拒绝覆盖 |
| claim | session 模式；可指定 --id、--owner；领取一个阶段并返回 request，缺省 owner 为独立 UUID |
| tick | command 模式；可指定 --id、--owner；互斥预留后调用外部桥 start |
| heartbeat | --id --owner --dispatch；更新真实工作进度心跳 |
| complete / fail | 上述身份参数及 --evidence；持久化证据回执；可加 --handoff 交接；worktree 的 P4 complete 必须带 --accepted-head，已有真实人工确认时可附 --human-accepted-by |
| handoff | 上述身份参数；验证完成/失败回执与当前成果匹配后移除窗口 |
| recover | 上述身份参数；command 使用原派发配置查询，不重复 start |
| interrupt | 上述身份参数、--evidence、--confirmed-stopped；核实会话已停止后记失败并交接 |
| retry | --id --owner（控制者）--dispatch（当前失败回执）--evidence（处理与授权依据）；无窗口、未超预算时恢复同一阶段 ready，保留回执与次数 |
| finish | 可指定 --id；主目录控制者在共享锁内复查真实验收，调用 worktree finish 自动合入、归档、删除；claim/tick 也优先执行此动作 |
| precheck | 只读，检查是否有可推进阶段或可收尾任务；不检查执行桥连通性 |
| automation | 只读，生成 Orca 禁用状态的安装计划，参数见 platforms.md |

退出码 0 表示命令正常完成，仍须检查 action（hold 不代表已执行）；1 表示读取、配置、身份或操作错误；2 表示阻断/需处理，也可能已持久化 fail 或 interrupt 的失败事实；3 仅用于 precheck 无可推进任务。不要把所有非零退出码理解为完全未写入。

## 阶段生命周期

1. 控制者核实任务已有授权与当前阶段，再 init。例如现有任务等待实施时 init --id <task-id> --stage P2 --owner controller/setup。禁止用 init 覆盖失败或补造完成。
2. 自动化平台唤醒一个 Agent；Agent 从主检出目录执行 claim；返回 finished 表示已自动收尾，结束本轮即可；返回 request 时工单给出 task_id、stage、owner、dispatch_id、cwd、route、prompt、callbacks。callbacks 为可执行文件与字面参数数组，按所在 shell 正确转义，禁止 eval 拼接。
3. 切到 request.cwd，读取项目约定和现有计划；按 request.prompt 仅完成指定阶段。P1 复用现有登记；不创建第二个任务。项目写入前及步骤之间调用 heartbeat。
4. 真实成果与证据写入任务工作区 _plan/process/<task-id>/。--evidence 相对此目录，例如 self-check.md；文件必须非空。complete 表示该阶段门禁确已通过；失败或阻断调用 fail。P0 完成还要传 --user-confirmed，表示已核实适用的执行授权；在证据中引用原指令或可追溯位置，已有授权即可，无须另问一次。用户要求本次回报后等待时，须等该确认，不能沿用更早授权。P4 不自动生成技术或人工验收结论。
5. 使用原工单的 complete/fail callbacks，把证据路径占位符替换为真实文件名。--handoff 表示执行权已交接，之后结束本轮；后续项目写入会使完成身份失效。下次唤醒才领取下一阶段。默认 P2 → P3 → P4，worktree 的 P4 完成后由下一轮自动收尾；显式较低阶段上限仍停止。

同一存活会话可用同一 owner 重取自己的工单；这是恢复读取，不授权再次执行已完成动作。会话可在交接结束后于下一次明确任务指令或唤醒中复用；切换任务须重新 claim 并使用新 owner / dispatch，不能使用上一任务的回调。owner 跨任务不得复用；保留回执的已归档任务同样约束 owner。默认生成 UUID 可避免常见误用。配置了阶段模型时，claim 必须传真实 --provider、--model 及需要的 --reasoning；不匹配时不领取。runner 无法自行证明调用者提供的模型名称，平台须从真实会话信息核实。

## 并发、证据与中断

Git 使用共同 Git 目录 axns-devflow.lock，非 Git 使用 _plan/autopilot/.lock。锁内重新读取和判定，排他创建 window.json；平台启动及 worktree check 均在锁外。worktree claim/complete 前执行宿主 check，再核实快照未变。持锁 token 仅供内部 core 重验，外部只读 CLI 遇锁拒绝读取。

window.json 保存不可丢失的派发请求、原状态及执行配置；receipts/<dispatch_id>.json 保存幂等结果；任务记录目录的 autopilot-events.jsonl 记录实际生命周期。完成事件先落盘，再捕获当前 HEAD/工作区快照。worktree 的 P4 complete 事件保存在主目录 runtime events.jsonl，避免回调修改已验收提交；最终验收证据仍必须在候选中。重复完成回调不重写已完成阶段上的验收元数据；旧回调不改变新窗口。

启动超时、命令错误、非法响应和未知结果均保留占位。recover 只查询同一 dispatch_id；只有权威 absent 且仍在 reserved 才增加 attempts 并释放。达到 max_attempts 后阻断，不重置计数。平台 stopped 不能证明阶段通过，仍需真实结果或中断证据。

session 失联/心跳过期不会自动接管。先核实原会话停止并记录依据，才能 interrupt --confirmed-stopped；该命令将阶段记为 failed，等待按宿主流程处理。已有完成回执时使用 handoff，不改写成中断。崩溃留下不一致状态时保留现场，禁止删窗口、刷新哈希或改 ready 来绕过门禁。

execution.enabled 关闭后停止 init/claim/tick/retry，但已运行窗口可 heartbeat、complete/fail、recover、handoff 或 interrupt，以便完成交接。execution.enabled 关闭后不执行 finish；开启时通过原 worktree helper 完成本地合入和清理，提交由任务窗口执行 commit。

## 失败重试与任务隔离

控制者在原窗口已交接、失败原因得到处理且原任务授权仍适用时，将处理依据写入原任务证据目录，然后引用当前 fail/interrupt 回执：

```powershell
node "<扩展目录>/scripts/runner.cjs" retry --project "<项目>" --id "<task-id>" --owner "controller/recovery" --dispatch "<当前失败回执的完整dispatch_id>" --evidence "retry-review.md"
```

retry 仅恢复相同 failed 阶段，不启动会话、不跳阶段，原回执与事件继续保留；之后由平台下一次唤醒领取新派发。活动、未知或尚未 handoff 的窗口不能 retry，先按原派发恢复或核实停止后 interrupt。只有旧回执匹配且处理依据非空才写入 ready；脚本验证一致性，控制者负责依据真实。旧回调只能幂等读取原回执，不能覆盖新派发。

`attempts` 累计当前阶段的权威未启动、fail 与 interrupt 次数，进入下一阶段才归零；retry 不清零，达到 max_attempts 时拒绝。旧版本 failed 状态若次数为 0，retry 至少记为 1；不得删运行态绕过限制。需继续时先处理根因，再按已有授权显式调整项目预算。

任务自身失败、超时、升级或证据失效只 hold 本任务，依赖它的任务继续 dependency_pending；独立且有槽位的任务继续领取。只读判定有可执行动作则退出 0，同时保留 recovery_count、needs_human_count 和逐任务原因；没有动作且存在需处理异常退出 2。配置、共享登记与协调锁异常退出 1；precheck 没有动作但无异常退出 3。平台应显示需处理任务，不能只看退出 0 隐去它们；recovery_count 先触发 AI 诊断，needs_human_count 才表示需要用户决定或显式确认。

非 Git 同样写 completed_worktree，覆盖整个目录的路径、类型、权限、普通文件字节与链接目标（不遍历链接），仅排除 `_plan/autopilot/`。旧回执没有该快照时不自动补写，应重新核实成果并生成当前证据。大目录、依赖与本地生成物也参与快照；需更明确范围时采用 Git 模式及项目忽略规则。

## Worktree 自动收尾

开启 execution 后，缺省推进到 P4 且 finish_task 开启。P4 工作者先验证、提交 acceptance.md、处理 ignored 生成物，再 complete --accepted-head <HEAD> --handoff。该声明只代表技术验收；人工确认独立且必须真实。工单不会代填通过。主目录的下一轮 claim/tick（或 runner finish）在同一协调锁内调用 worktree helper，原子检查候选后快进合入、写恢复归档、移除 worktree 和本地任务分支，最后释放持权。不得从待删除工作区运行控制者。

中途删除失败保留 finishing 归档及活动持权；下一轮识别归档并续做，不要求重建已经删除的工作区。普通 Git 错误修复后可重试，未知进程和异常 I/O 先按 worktree 协议核实。集成前移需要回任务分支组合及复验，不能重新声明旧候选。只读判定不会执行这些动作。已有显式 P3/finish_task:false 不被覆盖。

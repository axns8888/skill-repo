# DSH 原生调度与上下文交接

DSH 已有可用的子智能体控制时，优先在 DSH 内完成短任务分配、状态观测与结果整合，Orca 是可选平台，不是必经入口。先核对当前会话实际工具，不能仅凭“子智能体”列表认定使用了实验性 Team。本文适用于已授权的原生团队；安装能力不授予新的委派权限。

## 选择协作方式

独立模型文件 `model-routing.json` 可选 `active_preset: "dsh_native"`，对应 `team: {"enabled": true, "mode": "subagent"}`。这会在新 DSH 临时合成配置中启用普通 `subagent` spawn 与共享控制工具，禁用同名冲突的实验性 Team。不会新增单消息限制、任务板数量限制或默认禁用 fork；已有 fork/workflow 的独立配置保留。原生模式不支持机械人数上限，不能填 max_members 假装已落实。

`team.enabled=false` 明确关闭委派；`team.enabled=true` 且省略 mode 保持既有实验性 Team 行为，mode=team 为其显式写法。配置整项覆盖，新派发保存不可变快照。文件中的模型选择不切换已经运行的主会话；当前工具未启用时，先用 DSH 自己的配置/新会话加载能力，不假装仅编辑文件即可改变已有会话。可用 `models:preview -- --preset dsh_native --scenario implementation` 检查路由。

本机已核对 DSH 0.2.2-rc.1：普通原生 `subagent` 每次启动独立 activation，spawn 使用空对话；`send_message` 可引导活跃成员或恢复旧成员；`list_agents` 支持 children/descendants；`interrupt_agent` 只确认接受中断。实验性 Team 使用 spawn_teammate、共享任务板及另一组工具，不与普通 subagent 混用。新主进程可由 DSH 自身 CLI/headless 入口启动，亦可使用随附 dsh-session.cjs；不要求 Orca 工作区/终端登记。

## 先看总体上下文，再看是否适合拆分

在接收新目标、读取大批材料、连续实施、压缩提示及阶段边界时评估。每个仍在工作的主/子会话分别判断，不能只检查父会话或把全队累计 token 当作一个窗口的当前上下文。

1. 核实当前上下文的总 token/容量和来源、下一动作所需输入、预计输出、保存交接的余量；算 `当前上下文 + 下一输入 + 预计输出 + 交接余量`。工具 schema、系统提示、已有工具结果也属于当前上下文。最新请求用量可能未覆盖随后发生的工具结果，必须标为估计并补算，不能冒充精确容量。
2. 同时检查下一目标能否独立验收、写范围是否分离、已有执行者/子树是否还在写、工具是否在执行、检查点是否已保存、当前会话是否仍能承担协调成本。不要为了换窗打断未保存的变更，也不要让新旧执行者并发写同一范围。
3. 上下文足够且当前工作连续，留在当前会话。独立短目标适合拆分且主协调仍有空间时，用原生 spawn 派发 fresh 子会话。优先 fresh 是减少继承历史的选择，不是禁用 fork；使用 fork 时把继承的历史计入评估。
4. 主协调自身已接近边界或达到交接检查点，先落盘、收拢执行子树，再由新主会话接续同一目标/任务/工作区。不断新增子智能体不能替代主会话交接。主/子窗口是否需要换都按当前状态判断，不按固定消息大小、固定窗口数或累计 token 决定。
5. 无法观测 token 时标为未知，读取平台压缩/容量提示、已有工单步数/时间预算与当前执行状态；不编造比例或强行继续大动作。预算只作缺少精确遥测时的辅助依据。

子任务包含目标、必要输入路径、独立写范围、结果/证据、停止条件及已知模型选择。父级接收结果摘要和证据索引，按需读取细节。不要给子级塞整阶段历史，也不要无限向旧成员追加无关目标。普通 subagent 的逐调用路由须启用 modelSelection、后端支持 agentOptions；否则通常继承父模型。新增的 devflow_场景 工具按用户文件固定 agentOptions，适配器实际预检；产品子级使用各自实例的 model 配置，不能套用普通子级的通用路由字段。使用已登记模型，不猜测渠道或悄悄换厂家。

## 只读判断辅助

`node "<技能目录>/scripts/context-decision.cjs" --snapshot "<当前状态.json>"` 返回建议，不调用模型、不创建窗口、不转移执行权。调用方从实际 DSH 会话取得最新观察后填写下列结构；未知数必须填 null。以下数值只是结构示例，不是平台容量或建议阈值：

```json
{
  "version": 1,
  "context": {
    "current_tokens": 30000, "limit_tokens": 100000,
    "next_input_tokens": 10000, "expected_output_tokens": 5000,
    "handoff_reserve_tokens": 5000, "delegation_tokens": 3000,
    "source": "local_estimate"
  },
  "state": {
    "next_action": "independent_task", "checkpoint_saved": true,
    "unpersisted_work": false, "active_writers": 0, "inflight_tools": 0,
    "descendants_confirmed_quiescent": true,
    "budget_reached": false, "compaction_pressure": false,
    "can_delegate": true, "delegation_authorized": true,
    "write_scopes_disjoint": true, "can_start_new_session": false
  }
}
```

source 允许 platform_current_context、request_estimate、local_estimate、unknown；不接受累计 usage 作为当前上下文。delegation_tokens 是给成员派发和回收摘要的协调成本估计。active_writers 只计主执行者之外的写入者，未知填 null。unpersisted_work 指尚未记录以便恢复的工作，不等同于 Git 未提交。所有状态须覆盖实际可执行的后代、后台工作和工具，工具调用成功或列表单行 inactive 不足以确认整棵树。

输出包括 continue_here、delegate_fresh、inspect_context、inspect_execution、drain_execution、save_checkpoint、handoff_new_session、handoff_ready。handoff_new_session 只是“已满足所填快照的交接条件且声称具备入口”，不是新会话已创建；必须取得真实启动/接管回执。没有新主会话入口时返回 handoff_ready，不因能创建子智能体就声称能替换根会话。本脚本仍只读；随附 dsh-context-plugin.mjs 已接入各运行中 DSH 会话的 tokenMeter，自动采集不等于自动证明执行树静止。详见 [运行期采集与直接根会话接续](execution-modes.md)。

## 原生执行权及停止边界

项目已启用 autopilot 且用户已授权执行时，纯 DSH 接入可配置：

```json
{
  "model_config_file": "D:/Coding/Axns8888/skill-repo/model-routing.json",
  "execution": { "enabled": true, "adapter": "session", "require_units": true }
}
```

以上字段合并到项目现有 autopilot 配置，沿用任务/工单；不要复制成本项目以外的新计划。若此前 command 指向 Orca 桥，切换到 session 后不再运行该桥。仅修改模型预设不改变 execution.adapter，不会迁移现有持权执行者。未启用 autopilot 的普通任务可直接遵守宿主原生协作与手动交接规则，不为使用 DSH 子智能体强制启用扩展。

DSH 主执行者沿用 runner 的 session 接入（execution.adapter=session）；主会话用实际身份 claim/takeover，只有主执行者持 runner 执行权并提交阶段/短工单回调。成员只在分配范围工作，不能共享领取令牌、重复领取原任务或替父级提交 yield/complete。原生工具本身负责成员会话，不需要为每个成员再登记 Orca 窗口。

结束一个成员任务不等于整个阶段完成。准备转移主执行权时，保存有效证据与未完成清单，列出后代及目录诊断，停止/等待仍运行的成员和后台工具并再次核实。该版本 interrupt_agent 不等待停稳，也不停止目标后代；send_message 返回接受消息不等于已执行。列表省略一次性外部子级，不能仅凭空列表认定全部停止。无法确认时保留持权和阻断证据，不抢占、不重复派发。

原生子智能体可完成多线调配，但在父进程内运行不等于独立系统窗口，也不保证根协调者崩溃后存活。根会话自动替换需要 DSH 实际提供的新会话入口或进程外控制器，不能把“启动子级”当作已完成根会话交接。纯 DSH 自动根进程接续已提供 dsh-controller 与直接 command 桥；只用子智能体工具仍不构成根进程轮换。需要 Orca 承载时选原有 Orca 桥；Codex/Claude Code 也可经 DSH 官方产品后端直接派发，具体模型与强度限制见 execution-modes.md。

程序链路实现/回归、模型鉴权与实际业务推理分别记录，按任务已确认范围验收。真实推理未验证时保留该事实，不以累计用量推算节约效果。

# 配置字段

扩展启用入口是主检出目录 AGENTS.md 的 `extensions`；启用时必须显式提供 `autopilot_config`，其值为项目内配置 JSON 的相对路径。新派发还需独立开启 execution.enabled。配置错误不会降级为默认自动执行。

配置声明不证明执行端已安装或可调用。派发前按宿主工具协作核实实际入口、连接/模型/会话及并发能力；缺失时保留待执行状态或使用符合已有授权的可用平台。启动结果不明先核实领取与平台状态再重试，不能重复派发。同一目标换窗口继续原 task-id；新目标由 P1 新登记，支持 `YYMMDD-A01-task-title` 和旧编号。slots 不是 worktree 累计数量或上下文预算阈值。

## 默认配置

以下为建议模式的默认配置。autopilot.cjs 始终只读；runner 新派发默认关闭：

```json
{
  "version": 1,
  "slots": 2,
  "capabilities": {
    "advance": { "enabled": true, "max_stage": "P4" },
    "switch_model": { "enabled": true },
    "open_window": { "enabled": true, "only_registered": true },
    "finish_task": { "enabled": true }
  },
  "tiers": {},
  "models": {},
  "stage_markers": { "P1": ["plan.md"], "P4": ["acceptance.md"] },
  "stage_cap_minutes": 30,
  "max_attempts": 3,
  "execution": { "enabled": false, "adapter": "session", "timeout_seconds": 30, "require_units": false }
}
```

| 字段 | 约束与含义 |
| --- | --- |
| `version` | 必填整数 `1` |
| `slots` | 默认 2，正整数；worktree 模式同时持有执行权的并行窗口上限，单任务有效值固定为 1。它不限制生命周期内先后创建的 worktree 总数，也不会自动创建任务或 worktree；新独立任务仍由宿主 P1 登记 |
| `capabilities` | 四个可独立关闭的能力，所有 `enabled` 必须为 JSON 布尔值 |
| `advance.max_stage` | 默认 P4，允许 P0–P4，禁止 P5；限制建议的目标阶段 |
| `open_window.only_registered` | 固定为 true，false 会报错；不得绕过宿主登记 |
| `tiers` | 阶段 P0–P5 或 `conductor` → 档位名 |
| `models` | 档位名 → `{executor?, provider, model, reasoning?}`；executor 为 codex/claude/dsh，provider/model 为已配置路由字符串；省略执行端沿用所用入口 |
| `model_config_file` | 可选个人模型/场景文件路径：显式绝对路径或主检出目录内安全相对路径，最大128 KiB；使用时禁止同时声明内联 models/tiers；文件格式与切换命令见 [模型与场景](launch-controls.md#单独维护模型与场景) |
| `launch.default` | 可选 `{tier?, scenario?, team?}`，tier/scenario 互斥；scenario 引用个人文件中的场景 |
| `launch.tasks` | 可选 task-id → `{tier?, scenario?, team?}`，仅覆盖相应任务的新派发 |
| `stage_markers` | 阶段 → 任务记录目录内的相对路径数组；只用于观测输出，不证明完成或驱动推进 |
| `stage_cap_minutes` | 默认 30，正整数；窗口心跳停滞阈值，超过后等待人工核实，仍占槽位 |
| `execution.enabled` | 默认 false；仅 true 开启 runner 的初始化及新派发。关闭后仍允许已领取窗口提交结果并交接 |
| `execution.adapter` | 默认 session，允许 session / command；分别使用 claim / tick |
| `execution.command` | command 必填 `{ "file": "实际可执行文件", "args": ["字面参数"] }`；shell 固定 false |
| `execution.timeout_seconds` | 默认 30，正整数；command 启动/查询的单次等待上限；超时保留不确定占位 |
| `execution.require_units` | 默认 false，兼容现有项目；true 时 init/每阶段派发必须引用预先落盘的短工单，阶段门禁不能被 yield 替代 |
| `max_attempts` | 默认 3，正整数；调度记录中 `attempts` 达到此值后停止自动动作 |

短工单 JSON 可采用 `{ "id": "inspect-api", "goal": "核实一个接口行为", "inputs": ["src/api.js"], "write_scope": ["src/api.js"], "done_when": ["针对性测试通过"], "stop_when": ["目标达成或预算边界到达"], "budget": { "max_steps": 12, "max_minutes": 20, "reserve_tokens": 6000 } }`。steps/minutes 必填正整数；token 余量可见时由执行会话回报，否则状态为 unknown。工单文件相对 `_plan/process/<task-id>/`，路径字段仅接受仓库相对路径；JSON 最大 16 KiB，以路径引用大输入；该限制只覆盖工单元数据，不限制输入文件或单次工具输出大小。执行者仍须先定位、分块读取，并将大结果落文件后只回传摘要。

未知配置字段、字符串布尔值、错误类型、未定义档位、占位模型字符串（含 `<` 或 `>`）、路径越界和非法 JSON 均退出 1。项目内的配置、证据和运行态相对路径禁止绝对路径、`..`、反斜杠和符号链接，使用 `/` 分隔。execution.command.file 与 args 是平台可执行文件及字面参数，允许实际绝对路径；不作为项目内相对路径解析。model_config_file 是另一个显式允许绝对路径的字段，用于跨项目共用个人模型清单；相对路径仍执行上述安全校验。

## 模型路由

模型表可选。若为空，输出 `model: null`、`model_available: false`、`route_source: inherited`，由平台沿用当前模型。配置了模型表时，tiers 引用的档位必须存在；没有为目标阶段配置档位也会沿用当前模型。

下面只演示结构，路由须替换成所在平台已核实可用的值：

```json
{
  "version": 1,
  "tiers": { "P1": "planning", "P2": "implementation", "P3": "review" },
  "models": {
    "planning": { "provider": "provider-a", "model": "model-a" },
    "implementation": { "provider": "provider-a", "model": "model-b" },
    "review": { "provider": "provider-b", "model": "model-c" }
  }
}
```

`model_available: true` 仅表示配置能解析，不能证明账号权限或一次请求实际使用的计费模型。模型名称和 reasoning 沿用用户已配置的已知值，不内置固定模型表，不强制远端发现，也不擅自换路由。适配器须落实所请求的启动选择并返回相应证据；平台拒绝时停止。阶段路由作用于后续新派发；`conductor` 只是供平台读取的建议，脚本不会切换调用者自身的模型。

模型优先级为短工单 `launch.tier` → `launch.tasks[task-id].tier` → `tiers[阶段]` → `launch.default.tier` → 平台继承。`switch_model.enabled=false` 禁用所有这些模型覆盖。团队策略独立按工单 → 任务 → 默认选择；整项覆盖，不合并开关与人数。`team` 的结构为 `{ "enabled": false }` 或 `{ "enabled": true, "max_members": 3 }`，人数为 1–32 的整数，含 leader，启用时省略则由 DSH 使用 8。未配置 team 表示继承，false 则明确禁用。请求与运行态保存解析后的快照；改配置只影响后续新派发。

短工单可增加 `"launch": { "tier": "review", "team": { "enabled": false } }`。所有档位均须引用 models；未知字段和错误布尔值报错。命令适配器收到显式 team 时须返回匹配的 `effective_team`；原生会话 claim 须按实际设置提供 `--team-enabled true|false` 和必要的 `--team-max-members`，不接受只在提示词里声称已切换。平台支持范围、启动示例及证据层级见 [新会话模型与团队控制](launch-controls.md)。

## 放开阶段与结案

`advance.max_stage` 缺省为 P4。worktree 任务沿用用户已授权范围自动提交及本地合入，但必须先完成真实复核、技术验收和适用的显式人工门禁。配置不会授权外部发布。

`finish_task.enabled` 缺省 true，独立控制自动收尾；显式 false 继续禁用。须满足协议全部条件且仅支持 worktree。execution.enabled 仍默认 false；开启后 claim/tick 可执行 finish 的快进合入、归档及本任务资源删除。单任务收尾沿用宿主流程。

阶段状态、窗口心跳、尝试次数和验收回执属于 [运行态协议](protocol.md)，不放入配置，也不是第二份实施计划。

人工验收不属于 autopilot 能力配置。唯一入口是主检出目录 `_plan/prompts/acceptance.json`：默认 `{ "version": 1, "human_acceptance": { "enabled": false, "blocking": false } }`。开启且非阻塞时不等待用户确认；blocking 为 true 只阻塞当前任务。阶段上限和 finish_task.enabled 仍分别控制是否建议执行 P4、机械结案，不被人工开关改变。


DSH 原生子智能体可选择 `team: {"enabled": true, "mode": "subagent"}`，省略 mode 的旧配置仍使用实验性 Team；显式 mode=team 同义。subagent 模式不支持 max_members；该字段只用于实验性 Team。模式写入不可变请求并核对 effective_team，新增模式声明参数为 claim --team-mode。原生调度无需 Orca，详见 [DSH 原生调度](dsh-native.md)。


## 纯 DSH 直接执行与成员场景

不依赖 Orca 的自动根会话接续、个人文件 dsh 场景字段、上下文运行期插件及交互选型报告，统一见 [执行方式选型](execution-modes.md)。主预设仍决定根执行端；dsh.child_preset 单独决定成员路由。配置或模型选择不改变已持权会话，迁移不得重复派发。


项目模型表：明确 model_config_file 时按引用读取；未指定且没有内联 models/tiers 时自动读取唯一的 `_plan/model-routing.json` 或根目录 `model-routing.json`，两份同时存在则拒绝猜测。执行开关和既有路由迁移仍需显式配置。进入项目目录后运行 `node <扩展目录>/scripts/model-page.cjs`，配置页以当前目录识别项目并在独立页面保存模型与场景配置。

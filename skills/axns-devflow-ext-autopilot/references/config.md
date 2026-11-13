# 配置字段

扩展启用入口是主检出目录 AGENTS.md 的 `extensions`；启用时必须显式提供 `autopilot_config`，其值为项目内配置 JSON 的相对路径。新派发还需独立开启 execution.enabled。配置错误不会降级为默认自动执行。

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
  "execution": { "enabled": false, "adapter": "session", "timeout_seconds": 30 }
}
```

| 字段 | 约束与含义 |
| --- | --- |
| `version` | 必填整数 `1` |
| `slots` | 默认 2，正整数；worktree 模式的并行窗口上限，单任务有效值固定为 1 |
| `capabilities` | 四个可独立关闭的能力，所有 `enabled` 必须为 JSON 布尔值 |
| `advance.max_stage` | 默认 P4，允许 P0–P4，禁止 P5；限制建议的目标阶段 |
| `open_window.only_registered` | 固定为 true，false 会报错；不得绕过宿主登记 |
| `tiers` | 阶段 P0–P5 或 `conductor` → 档位名 |
| `models` | 档位名 → `{provider, model, reasoning?}`；provider/model 为实际路由字符串 |
| `stage_markers` | 阶段 → 任务记录目录内的相对路径数组；只用于观测输出，不证明完成或驱动推进 |
| `stage_cap_minutes` | 默认 30，正整数；窗口心跳停滞阈值，超过后等待人工核实，仍占槽位 |
| `execution.enabled` | 默认 false；仅 true 开启 runner 的初始化及新派发。关闭后仍允许已领取窗口提交结果并交接 |
| `execution.adapter` | 默认 session，允许 session / command；分别使用 claim / tick |
| `execution.command` | command 必填 `{ "file": "实际可执行文件", "args": ["字面参数"] }`；shell 固定 false |
| `execution.timeout_seconds` | 默认 30，正整数；command 启动/查询的单次等待上限；超时保留不确定占位 |
| `max_attempts` | 默认 3，正整数；调度记录中 `attempts` 达到此值后停止自动动作 |

未知配置字段、字符串布尔值、错误类型、未定义档位、占位模型字符串（含 `<` 或 `>`）、路径越界和非法 JSON 均退出 1。项目内的配置、证据和运行态相对路径禁止绝对路径、`..`、反斜杠和符号链接，使用 `/` 分隔。execution.command.file 与 args 是平台可执行文件及字面参数，允许实际绝对路径；不作为项目内相对路径解析。

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

`model_available: true` 仅表示配置能解析，不能证明平台提供此模型、账号有权限或支持相应 reasoning。适配器必须确认这些事实；不可用时报告，不擅自换路由。阶段路由作用于平台允许的后续调度，不承诺能在任意会话中即时换模型。`conductor` 只是供平台读取的建议，脚本不会切换调用者自身的模型。

## 放开阶段与结案

`advance.max_stage` 缺省为 P4。worktree 任务沿用用户已授权范围自动提交及本地合入，但必须先完成真实复核、技术验收和适用的显式人工门禁。配置不会授权外部发布。

`finish_task.enabled` 缺省 true，独立控制自动收尾；显式 false 继续禁用。须满足协议全部条件且仅支持 worktree。execution.enabled 仍默认 false；开启后 claim/tick 可执行 finish 的快进合入、归档及本任务资源删除。单任务收尾沿用宿主流程。

阶段状态、窗口心跳、尝试次数和验收回执属于 [运行态协议](protocol.md)，不放入配置，也不是第二份实施计划。

人工验收不属于 autopilot 能力配置。唯一入口是主检出目录 `_plan/prompts/acceptance.json`：默认 `{ "version": 1, "human_acceptance": { "enabled": false, "blocking": false } }`。开启且非阻塞时不等待用户确认；blocking 为 true 只阻塞当前任务。阶段上限和 finish_task.enabled 仍分别控制是否建议执行 P4、机械结案，不被人工开关改变。

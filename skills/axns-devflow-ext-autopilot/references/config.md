# 配置字段

唯一开关是主检出目录 AGENTS.md 的 `extensions`；启用时必须显式提供 `autopilot_config`，其值为项目内配置 JSON 的相对路径。配置错误不会降级为默认自动执行。

## 默认配置

以下为可直接使用的建议配置，脚本本身仍只读：

```json
{
  "version": 1,
  "slots": 2,
  "capabilities": {
    "advance": { "enabled": true, "max_stage": "P3" },
    "switch_model": { "enabled": true },
    "open_window": { "enabled": true, "only_registered": true },
    "finish_task": { "enabled": false }
  },
  "tiers": {},
  "models": {},
  "stage_markers": { "P1": ["plan.md"], "P4": ["acceptance.md"] },
  "stage_cap_minutes": 30,
  "max_attempts": 3
}
```

| 字段 | 约束与含义 |
| --- | --- |
| `version` | 必填整数 `1` |
| `slots` | 默认 2，正整数；worktree 模式的并行窗口上限，单任务有效值固定为 1 |
| `capabilities` | 四个可独立关闭的能力，所有 `enabled` 必须为 JSON 布尔值 |
| `advance.max_stage` | 默认 P3，允许 P0–P4，禁止 P5；限制建议的目标阶段 |
| `open_window.only_registered` | 固定为 true，false 会报错；不得绕过宿主登记 |
| `tiers` | 阶段 P0–P5 或 `conductor` → 档位名 |
| `models` | 档位名 → `{provider, model, reasoning?}`；provider/model 为实际路由字符串 |
| `stage_markers` | 阶段 → 任务记录目录内的相对路径数组；只用于观测输出，不证明完成或驱动推进 |
| `stage_cap_minutes` | 默认 30，正整数；窗口心跳停滞阈值，超过后等待人工核实，仍占槽位 |
| `max_attempts` | 默认 3，正整数；调度记录中 `attempts` 达到此值后停止自动动作 |

未知配置字段、字符串布尔值、错误类型、未定义档位、占位模型字符串（含 `<` 或 `>`）、路径越界和非法 JSON 均退出 1。所有路径禁止绝对路径、`..`、反斜杠和符号链接。建议使用 `/` 作为配置中的分隔符。

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

把 `advance.max_stage` 设为 P4 只允许建议执行验收阶段，仍须遵守宿主的复核门禁、真实人工验收及集成授权。它不等于允许自动提交或合入。

`finish_task.enabled: true` 独立控制机械结案建议；不受阶段上限隐式开启。须满足协议的全部条件，且仅支持 worktree。单任务收尾沿用宿主手动流程。

阶段状态、窗口心跳、尝试次数和验收回执属于 [运行态协议](protocol.md)，不放入配置，也不是第二份实施计划。

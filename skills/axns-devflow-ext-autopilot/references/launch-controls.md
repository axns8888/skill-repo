# 新会话模型与团队控制

模型表由用户维护，填写执行端 executor、已配置的 provider、模型 ID 与推理强度，不从远端查询模型列表。自动换窗时每份 request 保存本轮解析结果；不会改变当前已运行会话的模型。

executor 是实际执行工具，可选 codex、claude、dsh；provider 是该工具内已配置的供应商渠道名称，不能仅凭 Claude、Codex、DeepSeek 品牌名推导。旧配置省略 executor 时沿用入口行为：Orca 桥使用 Codex，DSH 独立入口使用 DSH。跨工具配置建议显式填写，避免同名模型误投递。

## 单独维护模型与场景

本仓库根目录的 `model-routing.json` 是个人配置文件。它不放在安装技能目录内，技能同步不会覆盖它。可用一个绝对路径让多个项目共用，也可复制到项目内独立维护。配置最大 128 KiB，不保存凭据，不查询远端模型列表。

通常只需修改三个位置：

1. `models`：为每个模型设置 `enabled`、`executor`、`provider`、`model`、`reasoning`，可添加自己的模型条目。同一模型需要不同推理强度时，建立不同条目。
2. `presets.<预设>.scenarios`：为需要单独分配的场景填写 `tier`，值为 models 中的条目名；未列出的场景沿用该预设的 `default`。
3. `active_preset`：切换当前应用方式。

个人文件可直接编辑，无需运行命令：把 `active_preset` 改为下表中的预设 ID，并在相应 `scenarios` 中选择 models 条目名即可。渠道按用户指定填写为 `Codex`、`Claude Code`；Claude 模型名仍待填写，填好后把 enabled 设为 true。`enabled=true` 只表示允许选择，不能证明账号可用。使用禁用模型的预设会被拦截，不会悄悄改用其他模型。推理强度填写执行端实际支持的值。

文件提供以下应用预设，分工示例可自行修改：

| 预设 ID | 应用方式 | 初始状态 |
| --- | --- | --- |
| `codex_only` | 所有场景默认 Codex | 当前选中 |
| `claude_only` | 所有场景默认 Claude | 待补齐并启用 Claude |
| `deepseek_only` | 所有场景通过 DSH 使用 DeepSeek，关闭团队 | 独立入口或配置了 --dsh-bin 的自动桥；需可用凭据 |
| `mixed` | 默认 Codex；方案与复核 Claude；文档 DSH | 待补齐并启用 Claude，桥按 executor 选择执行端 |
| `dsh_native` | DSH 普通原生子智能体 | 原生调配无需 Orca；依据总体上下文及执行状态判断拆分 |
| `dsh_team` | DSH 实验性 Team，最多 3 人，含 leader | 独立入口或自动桥；不新增委派授权 |

场景目录如下。P0–P4 有默认映射；其他场景须在任务或短工单中显式选择，不根据提示词自动猜测。

| 场景 ID | 使用场景 | 默认阶段 |
| --- | --- | --- |
| `intake` | 需求澄清与任务登记 | P0 |
| `planning` | 方案设计与任务拆分 | P1 |
| `implementation` | 日常编码与功能实现 | P2 |
| `quick_fix` | 小改动与快速修复 | 显式选择 |
| `debugging` | 故障排查与根因分析 | 显式选择 |
| `refactoring` | 代码重构 | 显式选择 |
| `ui` | 界面实现与视觉调整 | 显式选择 |
| `testing` | 测试编写与执行 | 显式选择 |
| `review` | 代码与证据复核 | P3 |
| `acceptance` | 技术验收与交付检查 | P4 |
| `documentation` | 文档与操作说明 | 显式选择 |
| `research` | 资料调查与技术核实 | 显式选择 |
| `handoff` | 上下文整理与会话交接 | 显式选择；不会自行触发换窗 |
| `coordination` | 任务协调与调度建议 | conductor，仅建议 |

在本仓库根目录使用以下命令。show 和 preview 只读；use 和 assign 验证成功后才原子写回配置，失败时保留原文件：

```powershell
npm run models:show
npm run models:preview -- --scenario debugging
npm run models:preview -- --preset dsh_team --scenario implementation
npm run models:use -- --preset codex_only
npm run models:assign -- --scenario documentation --model deepseek_main --team off
npm run models:assign -- --preset dsh_team --scenario implementation --model deepseek_main --team on --max-members 3
```

`assign` 未指定 preset 时修改当前预设。未给 `--team` 时保留该场景已有的显式团队策略；`--team inherit` 移除场景覆盖并继承预设默认，`--team off` 明确关闭。指定 `--max-members` 必须同时指定 `--team on`。非 DSH 模型不能带 DSH 团队策略。

安装后的入口也可在任意目录使用：`node <技能目录>/scripts/model-config.cjs show --file <个人配置绝对路径>`。其余子命令同上；不传 file 时读取当前目录的 model-routing.json。`show` 中 ready 只指配置完整，`preview.paths` 区分 Orca structured、DSH 独立启动及自动交接支持；dsh_entry_required 表示项目还须配置实际 DSH 入口，不能把预览当作账号联通证明。

## 项目接入与场景选择

在项目现有 autopilot 配置中加入以下字段，保留原有执行开关、预算和命令：

```json
"model_config_file": "D:/Coding/Axns8888/skill-repo/model-routing.json"
```

路径可为显式绝对路径，或项目主检出目录内的安全相对路径。引用独立文件时，项目配置须移除内联 `models`、`tiers`，避免两份模型表冲突；不引用时旧内联配置继续可用。不要用此字段自动开启 execution、改写项目授权或修改账号。文件变化会使正在进行的观测失效，重新读取后才允许派发。

项目可设置 `launch.tasks[task-id].scenario`，短工单可设置：

```json
"launch": { "scenario": "debugging" }
```

同一选择中 `scenario` 与 `tier` 互斥。模型优先级为工单 → 任务 → 阶段场景 → 项目默认 → 预设默认 → 平台继承。显式团队约束仍按工单/任务/默认选择；未选中的低优先级场景不向新执行端泄漏团队设置。每份新派发保存实际路由、团队以及 `launch_context.preset/scenario`；修改个人文件不改写已派发请求和当前会话。`switch_model.enabled=false` 继续抑制模型覆盖，团队开关独立生效。

独立文件定义调用选择；当前协调窗口不会因切换预设而更换模型。选用 DSH 的场景可走独立启动入口，也可走配置了 --dsh-bin 的 Orca 自动桥，见下节。

## DSH 自动短工单交接

现有项目使用 `execution.adapter=command`、`require_units=true`，command 指向随附 orca-bridge.cjs。在该脚本路径后增加：

```json
["--dsh-bin", "D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js", "--dsh-profile", "headless"]
```

保留原有 Orca 参数和需要的 Codex/Claude 绑定；实际 DSH 路径按本机填写。executor=dsh 不需要 provider 绑定参数，DSH 的临时 overlay 直接选择请求中的已配置 provider/model/reasoning/team。工作区须预先登记在本机 Orca。启动 `orca-controller.cjs --watch` 后，控制器负责每份短工单一个新 DSH 进程与 Orca 执行终端；profile 预设 sessionId 时拒绝启动，不恢复旧会话。

桥先落盘不可变 request、临时 patch、manifest 和启动意图，再让 Orca 创建运行 dsh-worker.cjs 的命令终端。监督进程校验哈希，在实际启动环境重新合成验证配置，并从 DSH JSON session 事件核对真实会话 ID 和 cwd，执行 runner takeover。模型只有在 process.json 的 takeover_confirmed/work_permitted 为 true 时才开始业务写入。监督进程不替模型声明业务成功。

模型按原 callbacks heartbeat/yield/complete 回报证据。yield 后控制器先确认前一 DSH 进程退出，再派发下一份同阶段短工单；complete 仍须满足整个阶段门禁。启动回执丢失后只查询同一派发，不重复创建终端。DSH 完整事件和诊断落盘，控制器只输出有界状态。回调与桥入口遇到短暂协调锁时有限重判，不能绕过门禁。

上下文超限自动恢复必须同时满足：原 session/cwd/dispatch 已核实、已 takeover、一次性 runner 发出 agent/subagent 静止后的 error final，且 OS 确认原进程已退出。控制器保存恢复证据，沿用原目标生成有界接续工单，再用 confirmed-stopped yield 接续；不声称原工单完成、不重置 attempts、不加载旧对话全文。同阶段自动恢复次数受 max_attempts 限制，每次控制器另受 max-cycles/max-launches 限制。无 final、仅心跳过期、身份不明、普通权限/凭据/网络错误都保留持权现场，按原恢复规则处理。

DSH 凭据由本机 credentials 服务读取，不写入模型文件、manifest 或命令行。`deepseek-official` 使用 API Key；`deepseek-account` 使用账号登录，两者不自动互换。本机2026-11-20探针分别遇到 MISSING_CREDENTIAL 和 ACCOUNT_SIGN_IN_REQUIRED：两个真实进程均已建立 session 并 takeover，但未完成真实模型推理，因此不能据此宣称生产任务接续已验收。配置可用凭据后，可沿用保留的工单和真实证据继续验证。

## 兼容：项目内联选择

```json
{
  "version": 1,
  "models": {
    "build": { "executor": "codex", "provider": "my-channel", "model": "my-build-model", "reasoning": "high" },
    "review": { "executor": "claude", "provider": "my-claude-channel", "model": "my-review-model", "reasoning": "medium" },
    "deepseek": { "executor": "dsh", "provider": "my-deepseek-channel", "model": "my-deepseek-model", "reasoning": "high" }
  },
  "tiers": { "P2": "build", "P3": "review" },
  "launch": {
    "default": { "tier": "build" },
    "tasks": {
      "20261120-dsh-review": { "tier": "deepseek", "team": { "enabled": true, "max_members": 3 } }
    }
  }
}
```

以上名称只演示结构，替换为自己的已知模型。任务、执行配置和扩展启用方式仍按现有流程配置。单个短工单可添加：

```json
"launch": { "tier": "deepseek", "team": { "enabled": false } }
```

模型优先级：工单 → 任务 → 阶段 → 项目默认 → 平台继承；团队优先级：工单 → 任务 → 项目默认 → 平台继承。team 整项覆盖，false 明确关闭，省略才继承。`switch_model.enabled=false` 仅停用模型覆盖，不改变团队策略。所有档位引用都要存在；名字或强度不被平台支持时，报告错误并保留原现场，不自动换模型。

无需为每份工单手动切换全局厂家。按上述范围选择完整档位，新会话再应用对应工具及渠道；不会按价格或名称自动猜路由。更换厂家不能替代短工单预算和新会话交接。原阶段仍可拆成多份工单，由后续工单切换完整档位。

## Orca 自动新会话

随附 Orca 桥使用 Codex 或 Claude structured 会话，按 executor 传递 `--agent`。继承模型时沿用 Codex，无需额外参数。指定模型时，在 `execution.command.args` 的桥脚本路径后追加各执行端的渠道绑定：

```json
["--binding", "codex=my-channel", "--binding", "claude=my-claude-channel"]
```

这是部署者对每个执行端当前供应商渠道的绑定声明，必须与 models 中的 provider 相同；它不是供应商切换参数。同一执行端只接受一个绑定，重复或未知执行端报错。旧 `--provider my-channel` 等价于 Codex 绑定，不能代替 Claude 绑定。Orca 的正式启动接口接受 `--agent`、`--model`、`--effort`，没有本桥可用的渠道凭据切换参数，因此不会用模型名称猜测供应商，也不会改全局配置。在 Codex 与 Claude 间选择执行端会使用各自已有渠道；在同一执行端更换渠道时先配置好该工具，再更新绑定。

桥把 model 与可选 reasoning 原样传给 Orca 的 `--model`、`--effort`。Orca 拒绝或未确认新会话/提示投递时不报告 running。启动意图在调用前保存 launch_executor 和 launch_route；丢失回执后只查询同一派发，核对平台 agentType 与原执行端，不再启动。公开 `effective_route` 证明启动选择已按 Orca 接口接受，provider 来源是上述部署声明；它不能独立证明供应商内部实际使用或计费的模型。会话 ID、启动回执和投递结果另存为真实平台证据。

Codex/Claude structured 路径没有 DSH 团队控制接口，显式 team（含 false）返回 `native_team_unsupported`。DSH 路径通过 --dsh-bin、临时 overlay 和监督进程应用供应商/模型/团队并核实真实身份；未指定入口时返回 `dsh_entry_required`，不占窗口。它使用 Orca 命令终端运行受监督的一次性 headless 进程，区别于 Orca 自带的 dsh-tui 启动条目，详见上面的自动交接说明。

## DSH 独立新会话

随附 `scripts/dsh-session.cjs` 使用本机 DSH Node 入口，为本次独立 headless 进程生成最后一层 `--patch`。它先读取并合成选定 profile，再核对结果，默认只输出清单，显式 `--run` 才调用模型：

```powershell
node "<扩展>/scripts/dsh-session.cjs" --project "<项目>" --id "20261120-dsh-review" --stage P2 --dsh-bin "<本机dsh包>/lib/bin.js" --prompt-file "prompt.md" --unit "unit.json"
```

`--prompt-file` 和可选 `--unit` 相对任务工作区 `_plan/process/<task-id>/`，提示文件最多 64 KiB。工单用于解析本次选择，提示文件仍须明确本轮目标、输入、范围、停止条件和需要读取的工单。默认 profile 为 headless，可用 `--profile` 指定同样包含有效 headless-startup/headless-runner 的配置档；不接受用此入口启动持续服务或恢复旧 session。需要执行时在上述命令追加 `--run`。调用时沿用已有任务与授权，不为新窗口复制业务计划。

该独立入口直接选择新 DSH 进程的模型和工具配置，不要求 `execution.enabled=true`，因为它不是自动领取入口。必须有项目的 autopilot 配置声明以读取模型表。它不会为 runner 自动 reserve/claim/takeover，也不把进程退出当作业务成功；已有 runner 持权窗口时拒绝启动。自动调度请使用随附 orca-bridge.cjs、--dsh-bin 与控制器。不要将本独立启动器填入 execution.command。

executor=dsh 或省略时可使用此入口；显式 codex/claude 在合成前拒绝。模型覆盖写入 DSH 的 `agent-default-model.config.provider/model/reasoningEffort`，由这个新进程选择所填的已配置渠道，不改全局 profile。DSH 内调用其他供应商也应保持 executor=dsh，并填写 DSH 自身已登记的 provider；是否能调用取决于本机对应适配器与凭据。这是启动选择，合成检查不探测账号权限或提供方支持。团队配置为：

- `team.enabled=false`：禁用 Team 服务/工具、Team UI，以及普通 subagent、fork、child-control、workflow 委派工具。
- `team.enabled=true`：启用 Team 服务和原生 Team 工具；普通委派与 workflow 工具禁用，保持统一团队管理；人数由 max_members 控制，含 leader，默认 8。Team UI 在此 headless 进程不启用。
- 未配置 team：保留原 profile 的工具组合，不能声称协作已关闭。

开关控制本进程的 DSH 原生团队/委派工具，不改变其他 DSH 进程，也不是限制 shell 启动程序的安全边界。开启能力不授予新的委派权限。已获授权的 leader 仍须保持唯一任务执行权，分配不重叠写范围，给每位成员短目标与预算，收齐结果后整合验证；优先 fresh 上下文，避免 fork 整段长历史。人数上限不能代替上下文预算。

临时 patch、提示快照、manifest 和进程回执保存在主目录 `_plan/autopilot/<task-id>/dsh/<uuid>/`。`--run` 将完整 JSON 事件与诊断写入该目录的 events.jsonl/stderr.log，只回传有界清单、真实 session 事件 ID、退出码和日志路径；不把大段工具输出重新灌入协调上下文。不写用户 profile、凭据或已打开会话。DSH JSON 事件的 final/退出码仍须结合真实业务证据判断。

## 证据与交接

配置合法、合成值匹配、平台接受启动、实际请求模型、业务完成是不同层次。本入口的 DSH 清单标为 `composed_config_only`，进程回执的 business_completion 保持 unverified；Orca 记录启动选择依据和真实会话身份，业务完成仍以 runner 证据为准。无法确认的层次保留未知，不用请求值冒充计费端观察值。

session 接入 claim 使用实际已应用的 `--provider/--model/--reasoning`，档位有 executor 时还需匹配的 `--executor`；显式团队策略还需 `--team-enabled true|false` 与必要的 `--team-max-members`。这些是会话执行者的声明，不是切换配置的命令。command 桥须为显式请求返回匹配的 effective_route/effective_team，其中显式 executor 也必须一致；不匹配时保留未知占位，不重复启动。正常交接仍遵从原短工单和阶段门禁。


## DSH 原生子智能体模式

`team: {"enabled": true, "mode": "subagent"}` 选择普通原生 subagent 与控制工具，无需 Orca；省略 mode 保持原实验性 Team 行为。原生模式不接受 max_members，因为该工具没有对应机械人数门禁。个人文件新增 dsh_native 预设；使用 model-config.cjs assign 的 --team on --team-mode subagent 可选择相同模式。session claim 用 --team-enabled true --team-mode subagent 声明已实际应用的模式；适配器须返回一致的 effective_team.mode。

上下文评估、原生多线派发、工具实际停止语义以及主会话交接边界见 [DSH 原生调度与上下文交接](dsh-native.md)。原生模式不增加消息大小/任务数限制，不改变已有 fork/workflow 配置；基于当前上下文总量和执行状态决定拆分。


## 纯 DSH 直接执行与成员场景

不依赖 Orca 的自动根会话接续、个人文件 dsh 场景字段、上下文运行期插件及交互选型报告，统一见 [执行方式选型](execution-modes.md)。主预设仍决定根执行端；dsh.child_preset 单独决定成员路由。配置或模型选择不改变已持权会话，迁移不得重复派发。


## 可保存的项目配置页面

运行 `node scripts/model-page.cjs --project-root <项目>` 打开本地页面。可保存模型、渠道、强度、场景、预设、阶段与DSH团队配置。必备 planning / implementation / simple_execution；项目场景可自定义。执行层默认沿用Orca，编辑器不启动任务。匹配、模板复制、共享配置范围及读取顺序见宿主 [项目模型配置](../../axns-devflow/references/model-routing.md)。--file仅改变编辑目标，不替换运行时引用。

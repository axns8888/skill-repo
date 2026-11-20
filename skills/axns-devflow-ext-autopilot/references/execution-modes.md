# 选择纯 DSH 或 Orca 执行层

目标：根据用户已有渠道、模型强度要求、上下文及执行状态选择执行路径。原生多智能体和根会话轮换分别落实；普通短任务不强制引入 Orca。适用本机核对版本 DSH 0.2.2-rc.1；升级后复核包接口。

## 能力与选择

| 用户需要 | 推荐路径 | 必须核实 |
|---|---|---|
| DSH 原生模型、多线短任务、减少平台依赖 | 纯 DSH + 直接进程监督器 | DSH 已配置路由与推理强度；原生团队已授权 |
| DSH 协调，Codex / Claude Code 做短任务 | 纯 DSH + 官方可选产品后端 | 插件安装、原生渠道认证、允许沿用原生推理强度 |
| Codex / Claude Code 按工单精确指定模型和强度 | 当前优先 Orca 路径 | 实际执行端支持的参数、准确渠道绑定；绑定声明不切换账号 |
| 需要 Orca 工作区、终端或平台管理 | Orca 执行层 | 本机运行时与目录匹配 |
| 只需要一个短任务或手动接续 | 普通宿主会话 | 不为使用技能强制启用自动调度 |

Orca 本身不消除模型上下文；纯 DSH 原生子智能体也不能替代根会话交接。两条自动路径共用有限 Node 控制器、不可变 request、真实 session/cwd 接管、yield/complete 证据、前进程静止退出门禁。切换路径只影响下一新派发；旧任务仍由原执行者持权，未知状态不重复启动。两个平台共用每派发启动锁，存在另一平台记录时拒绝跨平台重启。

## 纯 DSH 自动路径

已有项目须按宿主流程显式启用 autopilot、登记原任务与短工单。将以下字段合并到现有项目配置；沿用其他能力、阶段和任务，不新建平行计划：

```json
{
  "model_config_file": "<个人模型文件绝对路径>",
  "execution": {
    "enabled": true, "adapter": "command", "require_units": true,
    "command": {
      "file": "<本机node可执行文件>",
      "args": ["<技能目录>/scripts/adapters/dsh-bridge.cjs", "--dsh-bin", "<本机DSH的lib/bin.js>", "--dsh-profile", "headless"]
    }
  }
}
```

个人模型文件中主预设选择 `dsh_native` 等 executor=dsh 的路由。随后启动：

```text
node "<技能目录>/scripts/dsh-controller.cjs" --project "<项目>" --id "<原任务ID>" --watch
```

该进程不是模型协调会话，没有对话历史，循环、启动次数和恢复次数均有边界。直接桥用隐藏的独立监督进程执行 dsh-worker，不要求 Orca 工作区登记。这里创建的是新的 headless 后台会话和上下文；当前实现不自动打开或替换 DSH Desktop 的可见标签，也不迁移正在运行的桌面会话。停止控制器不会抢占或释放仍在工作的执行者。重启控制器先查同派发记录；不存在或模糊记录不推断“可以重新启动”。

`dsh-session.cjs` 仍是准备/独立运行入口；它的 `--run` 不登记 runner 执行权。不要把它与 `dsh-controller` 混为一谈。原生 `execution.adapter=session` 仍适合由当前宿主主动 claim/callback 的接入，但不提供独立的自动新主进程启动。

## 一个文件选择主模型与成员场景

已有个人文件继续使用 models、presets、active_preset。新增可选 dsh 段：

```json
{
  "dsh": {
    "child_preset": "dsh_native",
    "scenarios": ["implementation", "testing", "review", "documentation", "research"],
    "native_reasoning_models": []
  }
}
```

`child_preset` 决定成员使用哪套既有预设，`scenarios` 选择本会话需要公开的成员工具。主模型仍由 active_preset 和工单场景决定。比如主模型选择 dsh_native、child_preset 选择 mixed，就可以在 DSH 内混用产品子级；这要求对应模型已填写并启用。成员配置随 request 保存不可变快照，之后编辑文件只影响后续派发。

DSH 原生路由生成 devflow_implementation 等场景工具，使用空上下文 spawn，固定 provider/model/reasoningEffort，由 DSH 适配器在实际创建前预检。工具不开放任意覆盖，允许模型来自用户明确选择的场景；无需擅自修改 DSH 全局允许模型列表。要临时使用其他已知模型，可增加/调整文件场景，在下一新派发加载。

executor=codex/claude 的场景生成官方 dsh-subagent-codex / dsh-subagent-claude-code 实例，各实例固定 model，并走原生认证与设置。插件按需安装，不因生成配置就自动安装。缺包或渠道失败必须明确记录；不能悄悄退回其他厂家。

这两个产品后端当前没有统一 reasoningEffort 参数。若模型条目指定 reasoning，默认拒绝纯 DSH 场景编译。用户明确接受原生强度时，将对应模型条目名放入 native_reasoning_models；报告将 effective_reasoning 标为 native_settings_unverified，不能把请求值说成已生效。需要精确逐任务强度时，选择现有支持该参数的执行路径并验证。个人模型文件不保存凭据；产品后端的环境认证行为另行核实。

team.enabled=false 会关闭普通及产品子级的 dsh-tool-subagent 工具。安装插件或选择场景不授予新委派权限；所有成员保持独立写范围，只有根执行者提交 runner 回调。

## 总体上下文与执行状态

直接/Orca 承载的 DSH 新进程都会加载 dsh-context-plugin.mjs。它在会话事件和每次 agent/pre-step 读取 tokenMeter.measure/session pressure；当前提示规模、模型容量和估算来源落到 manifest.context_directory 的每会话快照中。按会话 ID 哈希命名，不保存原对话或凭据。容量读取当前路由的 resolveModelInfo().context.contextWindow；未知保留 null。若测量失败，记录未知，不能伪造充足容量。

模型在大动作之前调用 devflow_context。无参数取得当前总体上下文；plan JSON 提供下一输入、预计输出、交接余量、派发成本和真实执行状态，返回同 context-decision 的建议。执行状态目前由调用方报告，尚未自动枚举所有外部后台写入者；空 list_agents 不视为全树静止。

传入的预计输出和交接余量会作为本会话后续步前检查的储备。已观测当前规模加储备达到容量时，插件停止新一步；这条硬保护仅防止继续请求，不声明工作完成、检查点保存或执行树停稳。真实 headless 在静止 final 和进程退出后，监督器才允许上下文恢复。正常情况在建议交接时先保存、收拢执行树，再 yield 到下一工单。

估算可能低估中文、schema，步前测量也不保证包含即将接纳的全部新材料；目前没有将所有后台工具状态与下一动作成本自动推断为精确数值。因此它是运行期观测、合作式提前交接和已到容量的停止保护，不能宣称永不超限。不要新增单条消息截断或以累计 tok 触发换窗。

## 直观选型参考

```text
node "<技能目录>/scripts/execution-guide.cjs" --models "<个人模型文件>" --out "<报告.html>" --dsh-bin "<DSH的lib/bin.js>" --evidence "<可选验证JSON>"
```

离线页面包含需求勾选、两条执行链、配置合并参考、当前模型与可选后端检查、复用生产决策逻辑的上下文试算和证据。报告仅为生成时快照；选择不写配置、不启动任务。页面可下载配置参考，必须合并到原项目而非直接覆盖。模板 execution-guide.html 必须通过生成器填充后查看。

验收必须分开记录：确定性程序回归、真实 DSH 启动/插件加载、真实模型业务推理。按本任务用户要求，DeepSeek 模型/鉴权失败不纳入程序链路失败；未完成真实推理仍保留事实。没有业务测量时不宣称 token 节约百分比。


## 行为复核样例

`evals/execution-modes.json` 保存8类用户情景和应满足的行为。可在隔离项目人工复核，或与已授权的平台评测结合；文件本身不发起模型调用。程序测试覆盖短工单接续、未知启动、模型快照、上下文决策与报告安全生成。

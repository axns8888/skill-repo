# 平台接入：DSH、Orca 与 PyCharm

DSH 已有原生子智能体工具时，优先读取 [DSH 原生调度与上下文交接](dsh-native.md)，在 DSH 内完成分配、状态观测和结果整合。Orca 接入是可选路径，不是 DSH 多线执行的必经步骤。

共用执行契约见 execution.md。平台原生清单承载当前步骤、关联项目 task-id；项目计划和证据保持唯一入口。Orca 唤醒 DSH 作为执行 Agent 时，只配置这一条唤醒链。当前保持一个 skill，公共状态机位于 scripts/lib，平台模块位于 scripts/adapters；平台唤醒和真实会话由接入平台负责。

## 原生自动化会话：session

当平台已经提供“定时启动 Agent 并执行提示词”，使用 execution.adapter=session，无须再派生一个 Agent。可将以下约定填入 DSH 或其他平台的自动化提示词，并替换实际绝对路径：

> 使用 axns-devflow 与 autopilot 扩展。先执行 node "<扩展绝对目录>/scripts/runner.cjs" claim --project "<项目绝对路径>"。检查退出码与 JSON：action=finished 时汇报结案并结束本轮；hold 中 recovery_required 或普通 Git 错误先按恢复协议自主诊断，保持执行权边界，不猜测会话已停止，仅重大且无法安全解决时请求用户介入。普通等待结束本轮。领取成功后切到 request.cwd，执行 request.prompt 所指的一个短工单；有 work_unit 时先用真实 session-id 完成 takeover，再用 callbacks 回报累计步骤心跳。阶段仍有剩余工作时保存下一工单并 yield，阶段门禁通过才 complete；失败则 fail，各回调均引用真实非空证据并交接结束本轮。沿用既有授权，保留 owner 和 dispatch_id，不手改运行态，不自行重领任务。若配置阶段模型，先核实实际会话路由并将真实 provider/model/reasoning 及显式 executor 传给 claim。

DSH 按 DeepSeek Harness 接入。已核对官方 Schedule 与 Todo 文档：原生自动化负责投递指令，Todo 是当前 Agent 会话的步骤列表；采用上面的 session 工单协议即可，无需额外调度插件。完整工具分工、原生清单关联、PyCharm 与跨平台切换见宿主 [工具协作](../../axns-devflow/references/tool-integration.md)。持续执行须核实 Schedule 每次投递创建独立会话；复用同一会话仍会积累历史。协调会话也要按宿主规则落盘轮换，平台唤醒不能代替旧执行者交权及新执行者 takeover。源码核对不等于真实平台联调。

## Orca：生成禁用状态的安装计划

当前适配目标为 stablyai/orca。核对的官方源码版本为 69dc20ed337c515ee27a6021f21eb573ea5d5b79，核对日期为 2026-11-13，其中 Scheduled automations 文档描述 automations create、--workspace、--disabled 及定时运行前的 --precheck。版本来源：

- 仓库：https://github.com/stablyai/orca/tree/69dc20ed337c515ee27a6021f21eb573ea5d5b79
- 安装前再次核对本机 orca automations create --help 与 orca status --json，以实际平台版本为准。

生成计划示例（仅输出 JSON，不运行 Orca、不安装定时任务）：

```powershell
node "<扩展目录>/scripts/runner.cjs" automation --project "<项目>" --adapter orca --workspace "<实际工作区选择器>" --provider "<实际provider>" --trigger hourly --name "devflow-autopilot"
```

输出包含 installs:false、prompt、prerequisites 和 argv。核对目标 workspace 能访问全部绝对路径后，按字面参数数组调用 Orca CLI；计划带 --disabled，创建后先检查再按平台流程启用。这里的 argv 不是可直接拼接执行的 shell 字符串。

--workspace 选已有平台工作区；runner 返回的 request.cwd 才是实际任务目录。不要用平台每轮另建 worktree 的方式替代 devflow 的登记与隔离。默认提示词继承会话模型；需要分阶段模型时补入实际模型参数或使用 command 桥，适配器不在提示词里伪造模型切换。

可选 precheck 为 runner.cjs precheck --project <项目>；平台的 --precheck 接受 shell 命令，需按宿主 shell 正确转义。当前计划不自动生成该 shell 字符串。退出非零时 Orca 会跳过定时运行，诊断仍应单独查看 JSON，避免持续跳过掩盖配置错误。

## 外部启动与查询：command

当控制器需按阶段创建平台会话并选择模型时，配置接入方自己的可执行桥：

```json
{
  "version": 1,
  "execution": {
    "enabled": true,
    "adapter": "command",
    "timeout_seconds": 30,
    "command": { "file": "node", "args": ["D:/adapters/platform-bridge.cjs"] }
  }
}
```

runner tick 锁内占位，锁外执行 file 与字面 args，工作目录为 request.cwd，shell:false。桥从标准输入读取一个 JSON，标准输出只写一个 JSON；诊断写标准错误。桥须在请求超时后仍能按 dispatch_id 查询原会话；运行真实任务的 Agent 须调用 request.callbacks，不把“会话退出”当作阶段完成。

请求格式：

```json
{ "version": 1, "operation": "start", "request": { "version": 1, "task_id": "已登记任务", "stage": "P2", "owner": "原owner", "dispatch_id": "原完整哈希", "project": "主检出", "cwd": "任务目录", "route": null, "prompt": "完整阶段工单", "callbacks": {} } }
```

实际 request 由 runner 返回；勿按上例自行补造。恢复请求的 operation 为 query，request 保持原样。

| 响应 state | 必要字段与语义 |
| --- | --- |
| running | version:1、原 dispatch_id、非空 session_id；请求 route 时需 effective_route 确认请求的 provider/model/reasoning 及显式 executor |
| absent | version:1、原 dispatch_id、非空 reason；权威确认该派发没有启动任何会话 |
| stopped | version:1、原 dispatch_id、非空 reason；原会话停止，不能证明阶段完成 |
| unknown | version:1、原 dispatch_id、非空 reason；无法确定，保留占位 |

短工单的 `running` 回执只识别原平台会话，不代表本轮接管已确认；worker 仍须执行 runner `takeover`，并以匹配的旧 `yield` 回执证明前一写入者已交权。每次 yield 产生新 owner/dispatch；unknown 只 query，不重复 start。会话回报上下文预算不可见时省略 --remaining-tokens（输出为 unknown），并使用工单步骤与时间预算合作式轮换。

start 必须以 dispatch_id 幂等，或在不确定时只允许查询恢复。桥必须自行实现平台 API、身份验证及会话查询，不能用模拟 running 回应冒充成功。通用协议回归使用模拟桥；真实 Orca 链路的核验单列，不由模拟测试推断。

## 本机 Orca 连续短工单：随附桥与控制器

需要连续自动换窗时，可使用随附的 `scripts/adapters/orca-bridge.cjs` 和 `scripts/orca-controller.cjs`。这条路径不依赖调用者拥有 Orca terminal/mailbox 身份：本地 Node 控制器通过正式 `agent launch` 创建会话，以 runner 回调及落盘协议接续，不保留 LLM 协调对话。不要再为同一任务同时开启原生定时领取入口。

在**原项目**已有启用 autopilot、已登记任务及当前短工单的前提下，将项目配置中的 execution 设为：

```json
{
  "enabled": true,
  "adapter": "command",
  "require_units": true,
  "timeout_seconds": 30,
  "command": {
    "file": "<本机 node 的绝对路径>",
    "args": ["<本扩展绝对路径>/scripts/adapters/orca-bridge.cjs"]
  }
}
```

`command.file` 与参数均按字面传递，shell:false。需要固定 CLI 时，在 args 后追加 `--orca-file`, `<orca 可执行文件绝对路径>` 两个参数，不传 shell 拼接命令。桥默认沿用 ORCA_CLI_COMMAND；否则 Windows/macOS 使用 orca，Linux 使用 orca-ide。执行桥前确认该可执行文件的版本匹配指南和 `agent launch --help`。

```powershell
node "<本扩展>/scripts/orca-controller.cjs" --project "<主项目目录>" --id "<原task-id>" --watch --interval-ms 2000 --max-cycles 120 --max-launches 4
```

不带 --watch 只运行一次判定。默认循环最多120次、每次间隔2秒、最多启动4个新会话；可显式调整，范围见 --help 和参数错误。达到启动上限后仍等待最后已启动窗口回调，再阻止后续派发；循环上限或停止信号只结束控制器，不释放执行权、不终止工作者。再次运行同一命令从原状态继续，不重复登记。

每个短工单都启动全新会话，沿用原 cwd/task-id/stage。工作者从本地有界 request JSON 获取工单、回调和原授权，从平台回执读取真实 session_id 并 takeover。正常 yield 后本地控制器自动启动下一工单；完整阶段 complete 后仍通过原阶段与验收门禁。它不创建下一工单、不自行判断业务成功，下一工单由持权工作者按现行计划保存。

request.record_dir 明确证据与工单的路径基准。callbacks 的 --evidence/--next-unit 只传相对此目录的路径，例如 first.md、unit2.json，不重复 _plan/process/task-id/ 前缀；work_unit.inputs/write_scope 仍相对工作目录。短工单 heartbeat 模板带 --steps 占位，执行者替换成累计完成步数，不重复追加参数。

运行态增加 `_plan/autopilot/<task-id>/orca/<dispatch>.json` 与 `.request.json`；记录启动前意图、不可变请求摘要、实际会话身份和投递回执。丢失启动回执后，只查询相同派发，不能再次 start；即使控制器重启也保留此约束。原生会话查询通过本机 worktree ps 的唯一身份/派发标记核验，格式不匹配或会话不唯一时保持 unknown。当前实现不自动重放未知 operationId。

本机帮助进程锁可在操作系统确认原本地 PID 不存在后回收；该规则**只用于控制器/桥进程锁**，不用于工作者持权。无身份锁、仍存在的 PID 或其他主机锁保留现场。桥/控制器不因心跳过期、回合 done 或缺少会话记录而释放工作者。

当前版本范围：本机 Codex/Claude structured 会话，以及由 Orca 命令终端承载的 DSH 一次性 headless 进程。Codex/Claude 按 executor 选择，通过 --binding codex=渠道、--binding claude=渠道 声明各执行端已有渠道，--model/--effort 选择模型；旧 --provider 仅绑定 Codex。DSH 须在桥参数增加 --dsh-bin 与可选 --dsh-profile headless，临时 overlay 直接选择自身 provider/model/reasoning/team，不使用供应商绑定。Codex/Claude 显式团队策略仍拒绝，DSH 可应用团队开关和人数上限。effective_route 是启动选择证据，不是计费端实测。工作区必须预先登记、本机且路径与 request.cwd 完全一致；不会自动创建 worktree 或修改全局账号。request JSON 上限64 KiB，启动消息引用文件，不复制旧对话。DSH 监督进程按原生 JSON 事件取得真实 session/cwd 并 takeover；下一短工单等待前进程退出。详细配置见 [模型与团队控制](launch-controls.md#dsh-自动短工单交接)。

预算依然是合作式门禁，不凭心跳过期强杀或接管。DSH 上下文超限可在真实身份已确认、一次性 runner 报告静止 error final 且 OS 确认进程退出后，由控制器保存证据并生成有界接续工单；同阶段次数受 max_attempts 限制。缺少 final、启动身份不明、普通凭据或网络错误仍保留现场；final/退出码本身不证明业务成功。其它恢复沿用 brief/recover/resume-yield。独立 dsh-session.cjs 继续仅提供单次启动，不代替自动桥。常驻控制器有 max-cycles/max-launches 边界，永久唤醒仍由平台负责。本机真实 DSH 探针已完成 session/takeover，但当前 API Key 缺失、账号登录不可用，完整真实接续尚未验收；不得把模拟链通过当作原业务已恢复。


## 纯 DSH 直接执行与成员场景

不依赖 Orca 的自动根会话接续、个人文件 dsh 场景字段、上下文运行期插件及交互选型报告，统一见 [执行方式选型](execution-modes.md)。主预设仍决定根执行端；dsh.child_preset 单独决定成员路由。配置或模型选择不改变已持权会话，迁移不得重复派发。

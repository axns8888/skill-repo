# 平台接入：DSH、Orca 与 PyCharm

共用执行契约见 execution.md。平台原生清单承载当前步骤、关联项目 task-id；项目计划和证据保持唯一入口。Orca 唤醒 DSH 作为执行 Agent 时，只配置这一条唤醒链。当前保持一个 skill，公共状态机位于 scripts/lib，平台模块位于 scripts/adapters；平台唤醒和真实会话由接入平台负责。

## 原生自动化会话：session

当平台已经提供“定时启动 Agent 并执行提示词”，使用 execution.adapter=session，无须再派生一个 Agent。可将以下约定填入 DSH 或其他平台的自动化提示词，并替换实际绝对路径：

> 使用 axns-devflow 与 autopilot 扩展。先执行 node "<扩展绝对目录>/scripts/runner.cjs" claim --project "<项目绝对路径>"。检查退出码与 JSON：action=finished 时汇报结案并结束本轮；hold 中 recovery_required 或普通 Git 错误先按恢复协议自主诊断，保持执行权边界，不猜测会话已停止，仅重大且无法安全解决时请求用户介入。普通等待结束本轮。领取成功后切到 request.cwd，执行 request.prompt 所指的一个阶段；用返回的 callbacks 心跳，按真实结果和非空证据 complete/fail，并交接结束本轮。沿用既有授权，保留 owner 和 dispatch_id，不手改运行态，不自行重领任务。若配置阶段模型，先核实实际会话路由并将真实 provider/model/reasoning 传给 claim。

DSH 按 DeepSeek Harness 接入。已核对官方 Schedule 与 Todo 文档：原生自动化负责投递指令，Todo 是当前 Agent 会话的步骤列表；采用上面的 session 工单协议即可，无需额外调度插件。完整工具分工、原生清单关联、PyCharm 与跨平台切换见宿主 [工具协作](../../axns-devflow/references/tool-integration.md)。源码核对不等于真实平台联调。

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
| running | version:1、原 dispatch_id、非空 session_id；请求 route 时需 effective_route 确认实际 provider/model/reasoning |
| absent | version:1、原 dispatch_id、非空 reason；权威确认该派发没有启动任何会话 |
| stopped | version:1、原 dispatch_id、非空 reason；原会话停止，不能证明阶段完成 |
| unknown | version:1、原 dispatch_id、非空 reason；无法确定，保留占位 |

start 必须以 dispatch_id 幂等，或在不确定时只允许查询恢复。桥必须自行实现平台 API、身份验证及会话查询，不能用模拟 running 回应冒充成功。当前测试使用模拟桥验证调度协议，尚未启动真实 Orca/DSH 会话。

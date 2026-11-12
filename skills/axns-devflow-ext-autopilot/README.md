# axns-devflow 的可选自驱调度扩展

与 `axns-devflow` 同时安装；需要多任务隔离时再安装 `axns-devflow-ext-worktree`。需要 Node.js 和可用的 Git（worktree 模式）。安装后项目仍默认手动模式。

本版本提供只读状态检查与决策脚本。开窗、模型选择、定时唤醒和执行去重需要平台适配器；仓库尚未提供该适配器。普通会话可以按建议继续已有授权的任务，不能把输出建议视为已经执行。

## 1. 显式启用

先按宿主初始化最低目录，在主检出目录 `AGENTS.md` 声明：

```yaml
extensions: [autopilot]
autopilot_config: _plan/prompts/autopilot.json
```

需要 worktree 时，改为：

```yaml
extensions: [worktree, autopilot]
integration_branch: main
lock_timeout_minutes: 120
autopilot_config: _plan/prompts/autopilot.json
```

支持上述单行列表及简单缩进列表。配置路径相对主检出目录，可以用引号包含空格；不支持完整 YAML、重复键或路径越界。技术栈、模型账号、项目授权和运行命令由项目维护。

在主检出目录 `.gitignore` 增加：

```gitignore
/_plan/autopilot/
```

worktree 的其他忽略项和旧单指针迁移要求仍按其 README 执行。不要把调度运行态提交到仓库或放进任务 worktree；后者会阻止 worktree 的干净结案检查。

## 2. 配置与首次巡检

建立 `_plan/prompts/autopilot.json`。建议先用只读配置：

```json
{
  "version": 1,
  "slots": 2,
  "capabilities": {
    "advance": { "enabled": false, "max_stage": "P3" },
    "switch_model": { "enabled": false },
    "open_window": { "enabled": false, "only_registered": true },
    "finish_task": { "enabled": false }
  }
}
```

```powershell
node "<扩展目录>/scripts/autopilot.cjs" status --project "<项目>"
node "<扩展目录>/scripts/autopilot.cjs" decide --project "<项目>"
```

输出始终为 JSON，`--json` 是兼容选项。未启用返回 `enabled: false`、退出码 0；错误为 1；需要人工处理为 2。退出码 2 时所有自动动作都被抑制，不能挑其中一项继续执行。

## 3. 接入一个已登记任务

任务仍按宿主 P1 登记；多任务必须经过 worktree 的 scope 和持权检查。本扩展不发现未来需求、不登记新任务。单任务读取 `_plan/.active_plan`；worktree 读取主检出目录的活动及归档指针。

控制窗口核实任务已有授权、计划及当前进度后，在主检出目录建立 `_plan/autopilot/<task-id>/stage.json`：

```json
{
  "task_id": "20261112-example",
  "stage": "P2",
  "state": "ready",
  "owner": "controller/example",
  "updated_at": "2026-11-12T15:00:00+08:00",
  "attempts": 0
}
```

以上日期、任务和阶段按实际替换。`ready` 表示等待执行当前阶段；`completed` 表示当前阶段已完成，须填写证据路径，并把 status 返回的 `head`、`worktree_snapshot` 分别写入 Git 项目的 `completed_head`、`completed_worktree`。完整规则见 [协议](references/protocol.md)，不要因看到文件就补写完成。

接好平台预留与恢复机制后，再把 `advance.enabled`、`open_window.enabled` 改为 `true`。最小建议模式可以只写 `{ "version": 1 }`，其默认上限仍是 P3。没有模型表时沿用现有模型；选择模型前由平台验证可用性。

## 4. 执行与验收边界

适配器须实现 [协议的执行契约](references/protocol.md#执行平台契约)，包括原子占位、派发去重、心跳、完成证据和故障恢复。只配置一个定时会话反复运行 `decide` 并不能满足这些要求。

`finish_task` 只建议对已验收、已合入且干净的 worktree 调用 `worktree.cjs finish --accepted-head <完整候选HEAD>`。人工验收和集成授权沿用宿主要求；开启 P4 不授予自动合入权限。脚本不会自动提交、合入、补填验收或删除运行态。

字段默认值见 [配置](references/config.md)，行为测试位于仓库 `tests/autopilot.test.cjs`。

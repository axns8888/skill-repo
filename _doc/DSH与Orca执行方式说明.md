# DSH 与 Orca 执行方式参考

本轮新增纯 DSH 的直接执行路径；Orca 继续作为可选平台。打开同目录 **DSH与Orca执行方式评估.html**，可以勾选需求、查看两条执行链、试算总体上下文与执行状态、下载配置合并参考。页面是生成时快照，改变选项不会修改实际配置或启动模型。

## 如何选择

| 你的实际要求 | 建议 |
|---|---|
| 主要使用 DSH 原生模型，希望减少额外平台步骤 | 纯 DSH + 直接进程监督器 |
| DSH 调配 Codex / Claude Code，接受各自原生推理强度 | 可选纯 DSH，需安装官方产品后端并核实渠道 |
| Codex / Claude Code 需要逐任务精确指定推理强度 | 当前优先已有 Orca 路径，按实际执行端能力验证 |
| 希望统一管理 Orca 工作区、终端或其他平台能力 | Orca 执行层 |

当前个人文件仍保留 active_preset=codex_only，未切换日常使用方式。新增 dsh 段默认只选择已有 DSH 模型场景；Claude 仍因未填写准确模型名而禁用。

## 一个文件直接选择

仓库根 model-routing.json 继续是个人设置入口：

- active_preset：根执行会话的模型应用方式。
- models：渠道、准确模型名、推理强度与启用状态。
- presets：按场景设置模型。
- dsh.child_preset：DSH 成员采用哪套预设，可与根预设不同。
- dsh.scenarios：为本次 DSH 协作公开哪些成员场景工具。
- dsh.native_reasoning_models：明确接受哪些 Codex / Claude Code 模型沿用其原生强度。留空时不把不支持的强度参数假装已生效。

选择纯 DSH 时，根模型必须为 executor=dsh，项目 command 指向 scripts/adapters/dsh-bridge.cjs，运行 scripts/dsh-controller.cjs。只改模型预设不会把现有 Orca 执行适配器迁移过来；新配置对后续新派发生效。直接路径创建 headless 后台新会话；当前实现不自动打开或替换 DSH Desktop 的可见标签，也不迁移正在运行的桌面会话。自动执行仍须沿用原项目的 autopilot 授权、任务和短工单。

完整参数及模型限制见 skills/axns-devflow-ext-autopilot/references/execution-modes.md。

## 上下文如何处理

运行期插件读取每个会话的当前总体上下文估计和模型容量，不把累计 token 当成容量。大动作前结合下一输入、预计输出、交接余量和执行状态，建议继续、派发全新子会话、保存检查点或收拢执行树后交接。主协调者自身也必须轮换。

自动计量已经接入；全执行树静止与下一动作成本仍需据实报告，不能把空成员列表当作后台全部停止。达到已知容量或已声明储备边界时可阻止新一步；正常提前交接仍要求模型保存、收拢和提交证据。无法保证所有估算都精确，也没有实际业务 token 节约比例。

## 本次证据怎么看

验证汇总放在 .planning/2026-11-19-bounded-sessions/dsh-deep-verification.json。页面附同一份汇总。

程序测试验证真实 OS 子进程接续和恢复，但其中模型行为使用测试夹具；真实 DSH 启动探针单独验证版本接口和插件加载，并在模型请求前主动停止。两者均不冒充真实模型业务推理。按用户确认，DeepSeek 模型/鉴权失败不阻断程序链路验收。

## 刷新参考页

在仓库根运行：

```powershell
npm run execution:guide -- --dsh-bin "D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js" --evidence ".planning/2026-11-19-bounded-sessions/dsh-deep-verification.json"
```

报告可离线打开，无外部服务或字体依赖。它只读取指定模型文件与证据，不会连接模型推理或改写项目配置。

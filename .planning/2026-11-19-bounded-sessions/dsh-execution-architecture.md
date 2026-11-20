# DSH 多智能体与 Orca 执行层评估

日期：2026-11-20。范围：本机 DSH 0.2.2-rc.1、同版本官方可选后端原包，以及当前 skill-repo 实现。只读能力评估，未启用插件、切换个人预设或调用模型。

## 决策

目标架构采用 DSH 原生多智能体协作，配合进程外的轻量确定性监督器负责根会话轮换。Orca 保留为可选平台及现有交接链路；在纯 DSH 的根会话闭环通过之前，不移除已实现的 Orca 自动接续路径。一次任务只由选定的一条调度链持权，不能为迁移同时启动两个执行者。

原生多智能体可以减少父会话吸入的任务材料与工具输出，但不保证根会话永不增长，也不保证总 token 一定下降。是否拆分依据当前总体上下文、下一动作成本、检查点与执行树状态；并发只用于可以独立验收的任务。

## 模型选择

| 对象 | DSH 能力 | 当前技能接入情况 |
|---|---|---|
| 新主会话 | 可选 provider、model、reasoningEffort；须为实际适配器支持的路由和强度 | dsh-session 临时 overlay 已接入 |
| DSH 原生 spawn 子级 | 支持 agentOptions；启用 modelSelection 后可逐次选择；同时受 Session 允许路由约束 | 已启用 spawn/control，尚未显式接通子级模型选择、允许路由和场景映射 |
| Codex 外部子级 | 官方 dsh-subagent-codex，原生配置/认证，实例级 model，单任务全新进程和线程 | 可选目录已确认；本轮仅下载原包查证，未安装/启用/实测 |
| Claude Code 外部子级 | 官方 dsh-subagent-claude-code，原生设置/认证，实例级 model，单任务全新 query/进程 | 可选目录已确认；本轮仅下载原包查证，未安装/启用/实测 |

外部两后端不支持普通工具的 agentOptions，不能对它们直接套用 modelSelection。它们的公开配置没有统一 reasoningEffort 字段；逐任务推理强度需要核对原生设置的实际生效方式，或补后端适配再验证。模型 ID、执行渠道、认证来源必须分别核实；已存在原生认证入口不代表用户渠道已成功复用。两个后端会清理具有凭据特征的环境变量，依赖环境认证的配置尤其需要单独验证，不把密钥搬入个人模型文件。

## 架构比较

| 需求 | DSH 原生路径 | 当前 Orca 路径 |
|---|---|---|
| 短任务独立上下文 | 原生 spawn；外部 Codex/Claude Code 也每任务新会话 | 控制器每工单启动新执行会话/进程 |
| 多线调配 | 原生工具可分派、通知和收结果 | 已有桥/控制器；普通 DSH 成员无需额外登记 Orca |
| 跨执行渠道 | 有官方可选产品后端，尚需本机接入验证 | 已有 executor 路由；绑定声明不代替实际渠道切换 |
| 按场景选择模型与强度 | 主会话已接入；子级及外部后端仍有适配缺口 | 个人文件已接入后续派发；真实渠道能力仍分别验证 |
| 当前上下文计量 | 已有 tokenMeter/contextPressure 服务；本技能尚未接入自动采集 | Orca 本身不提供本技能所需的自动上下文决策 |
| 根协调者轮换 | 原生子级不替代根会话，需要新主会话入口和进程外监督 | 有限 Node 控制器/桥已实现接管、停稳后接续与不明启动查询 |
| 重启与停止核实 | 需要补持久派发和全执行树终态观测；空成员列表不足为证 | 已有持久启动/进程记录及门禁；不将其当作所有业务场景已实测 |

## 最小迁移闭环

1. 统一模型文件继续作为唯一选择入口，区分 DSH 原生 LLM 路由与 Codex/Claude Code 产品后端，声明每个后端实际支持的模型/强度/团队能力。
2. 直接读取 tokenMeter.contextPressure(session) 和模型容量，保留数据来源、revision 与估算误差；用下一动作成本、检查点、运行工具/成员共同决策。累计 UI tok 不作为窗口容量。
3. 将既有不可变派发、takeover、yield/complete、未知启动只查询和停稳门禁复用于直接 DSH 进程适配器。根监督器不承担模型对话，避免它自身积累长模型上下文。
4. 纯 DSH 两个根会话依次接续同一任务，确认前执行树静止、新会话真实身份、写入互斥和恢复幂等。程序链路验收继续按用户要求排除 DeepSeek 模型/鉴权失败，保留真实推理是否完成的事实。
5. 上述通过后，选择纯 DSH 的项目不再要求 Orca；既有 Orca 适配器供需要其工作区、终端或其他平台能力的项目使用。

本轮没有修改技能运行代码或安装副本，现有 model-routing.json 仍为 codex_only。

## 证据

- 本机 dsh/node_modules/@deepseek-ai/dsh-tool-subagent/README.zh.md：选择子级 LLM，modelSelection 与 Session 允许路由。
- 本机 dsh-subagent-spawn-in-process/README.zh.md：空上下文和继承/覆盖规则。
- 本机 dsh-token-meter/README.zh.md：measure、contextPressure、projectedTokens、contextWindow 与估算限制。
- 本机 dsh-official-bundles/lib/index.js：官方可选 Codex/Claude Code 子智能体目录。
- .cache/dsh-architecture-eval/dsh-subagent-codex/package/README.zh.md 与 lib/index.js：同版本官方 npm 原包，模型/认证/进程生命周期。
- .cache/dsh-architecture-eval/dsh-subagent-claude-code/package/README.zh.md 与 lib/index.js：同版本官方 npm 原包，模型/认证/进程生命周期。
- skills/axns-devflow-ext-autopilot/scripts/dsh-session.cjs：当前主模型与 subagent overlay。
- 既有 dsh-handoff-verification.json、dsh-native-verification.json：程序链路证明及实际验证边界。

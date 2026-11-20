# 模型与团队配置核验

- Orca 1.4.258 的 agent launch 支持 --model 和 --effort；--effort 必须与 --model 同传。真实只读启动探针已返回新 structured session，证据 orca-model-probe.json。其公开回执不回显模型/供应商。
- 已安装 DSH 0.2.2-rc.1：agent-default-model 使用 provider/model/reasoningEffort；--patch 接受最后一层覆盖。headless 不支持直接 --model/--effort。
- DSH 团队组合包默认关闭；插入 agent-team/tool-agent-team/ui-agent-team，普通 subagent 工具禁用，workflow 仍可派生。关闭团队时需同时禁用常规委派与 workflow 工具，不能只停 Team UI。
- 模型名称和推理强度作为用户配置的不透明字符串；平台自身负责支持性校验，不增加远端模型发现或自动替换。

## 执行端/供应商续项发现（2026-11-20）

- Orca 1.4.258 的本机正式启动接口支持 --agent/--model/--effort。目录中有 codex、claude 和 dsh；dsh 使用 dsh-tui 终端入口，不能据此证明已接通本项目可靠回调或 DSH profile 覆盖。
- provider 是执行端自己的渠道 ID；Codex/Claude 间切换执行端可沿用各自渠道。Orca 无本桥可用的 provider 选择参数，--binding 仅声明已配置渠道；不改凭据/全局配置。
- models 新增可选 executor，Codex/Claude/Dsh 显式区分。旧配置省略时沿用入口默认，避免兼容性迁移。自动控制器支持 Codex/Claude structured；dsh 由独立 launcher 合成专用 overlay，本轮未实现 DSH 自动交接。
- 查验只读取本机安装源码的确定字段及平台 agentType；未打印配置凭据。在线检索未返回可用材料，本轮以版本匹配的本机 guide/安装源码及实际合成验证为依据。
- 本轮只运行 DSH 配置合成，不发起新的 Claude/DeepSeek 推理，不把模拟桥的跨执行端测试当成真实账号联通证据。

## 独立模型场景配置（2026-11-20）

- 单一用户配置放在仓库根model-routing.json，避免同步技能覆盖个人选择；project.model_config_file显式引用，可跨项目共享，禁止与内联models/tiers共存。
- 文件包括模型表、14场景、阶段映射与5应用预设；模型启用与账号可调用性分开表述。Claude未填准确路由保持禁用；当前预设codex_only未被探针改写。
- 场景选择按工单/任务/阶段/项目默认/预设默认解析，派发保存preset/scenario与不可变路由。显式项目team优先于阶段场景默认；未选中的低优先级场景团队配置不泄漏到另一执行端。
- use/assign以helper锁、源内容检查、临时文件和rename更新；失败保留原字节。show/preview只读，ready只表示配置完整，不探测账号或计费模型。
- DSH自动桥尚未实现是原目标缺口，不能归因于Orca未打开；现有JSON身份事件和headless能力只构成接入基础。DSH独立入口仍不承担自动领取、接管、回调和连续启动。原业务项目不可用是另一项复验限制。
- 本轮62项相关测试通过；源码/安装入口各2组真实DSH配置合成通过，无推理。详见model-scenarios-proof.json及model-scenarios-installed-proof.json。

## DSH自动交接接入发现（2026-11-20）

- 用户指定provider渠道名Codex、Claude Code，已更新个人文件；Claude仅渠道已知，模型名仍留空并禁用。文件内active_preset与presets.scenarios为主要设置入口，CLI保留。
- 新增dsh-bridge库和dsh-worker，Orca命令终端运行一次性headless；不冒充structured或dsh-tui原生聊天。真实JSON会话事件提供ID/cwd，监督器执行takeover。每次派发有持久request/manifest/patch/进程记录，哈希校验，丢失回执只查询，旧进程静止并退出后才允许下一工单/收尾。
- 正常yield/complete仍由模型提交真实业务证据；自动恢复只接受已接管、真实进程关闭且headless在等待agent/subagent静止后输出的context-limit error final。普通鉴权/网络错误、缺失final或仅心跳过期不释放执行权。恢复次数受max_attempts限制，启动/循环另有边界。
- 初轮暴露短命模拟CLI无法持有Windows后台进程，测试改由持续平台harness交付命令。进一步并发暴露bridge入口与回调的短暂锁竞争，以及Windows原子rename偶发EPERM；已增加有限重判/重试和监督器异常收尾。
- 真实DSH两次探针都创建了真实session并takeover：API Key渠道deepseek-official报MISSING_CREDENTIAL，账号渠道deepseek-account报ACCOUNT_SIGN_IN_REQUIRED。现有credentials服务已加载，不打印或转存密钥；记录存在不等于登录当前可用。不能据此宣称真实两会话业务接续已验收。证明dsh-live-proof.json。
- 两个测试终端已在确认DSH进程退出后定向关闭，持权和失败证据保留；未更改原业务项目、全局凭据或当前个人预设。

## 2026-11-20 DSH原生调度核实与纠偏

- 截图是普通子智能体列表，不足以认定实验性Team。已核对本机0.2.2-rc.1的tool-subagent、tool-subagent-control、spawn及实验性Team源码。普通subagent可spawn独立上下文、send_message、list_agents和interrupt_agent，无需Orca。
- interrupt仅确认接受，不等待停稳且后代继续运行；descendants列表省略一次性外部子级，空列表不能证明全部静止。父进程内子级不等于可独立存活的根会话。
- UI tok合计非缓存输入、输出、缓存读、缓存写；不能当当前上下文或非缓存费用。
- 已撤回本轮新增单消息/任务板上限及fork禁用；改为team.mode=subagent、上下文+执行状态只读评估和原生优先协议。旧Team/Orca行为兼容。
- 程序验收按用户确认排除DeepSeek模型/鉴权错误，保留真实推理未验证事实；原业务与token节约仍未实测。

## 2026-11-20 纯DSH与Orca执行层评估补充

- 按本机 DSH 0.2.2-rc.1 包内原始文档核实：主会话 provider/model/reasoningEffort 可由临时 overlay 选择；原生 spawn 子级可用 modelSelection 和 agentOptions 独立路由，默认继承父级。显式选择同时受 Session 允许路由约束；仅开启工具开关并不自动授权所有模型。
- 当前 dsh-session.cjs 的 subagent overlay 启用 spawn/control，没有显式接通 modelSelection、modelDiscovery 或场景到子级的独立模型路由。因此应区分“DSH支持”与“本技能已完成集成”。
- dsh-tool-subagent 文档明确：进程内 Spawn/Fork 与 DSH SDK 支持 agentOptions；ACP、Codex、Claude Code 后端不支持该通用字段，开启该字段会使挂载失败。不能把现有 Codex / Claude Code 执行渠道当作已接入 DSH 的同名模型提供方，也不能推断它们永远不能另行集成。
- 新发现：本机 dsh-token-meter 已有 ctx.tokenMeter.measure(session)、contextPressure(session)，可提供 pressureTokens/projectedTokens/contextWindow，模型容量可向 llm.resolveModelInfo().context 查询。文本/schema存在启发式误差；当前只读 context-decision 尚未接上此服务。缺口是采集与生命周期决策的集成，而非 DSH 完全没有上下文遥测能力。
- 评估需分别覆盖短任务原生协作和根协调者进程轮换。原生子级空上下文不解决根协调者持续膨胀；现有有限控制器与 Orca 桥提供已实现的根进程接续门禁，但 Orca 本身不是自动上下文策略，也不是唯一可能的进程外承载。
- 补充核实官方按需目录发现 dsh-subagent-codex 与 dsh-subagent-claude-code。已只下载与本机一致的 0.2.2-rc.1 npm 包到 .cache/dsh-architecture-eval，未安装启用。原始 README 确认：两者均直接使用原生认证/设置、每个短任务新进程/会话、只回传最终答案和安全诊断；均有实例级 model 覆盖，不支持继续旧 activation。不能说纯 DSH 必须经 API 才能使用 Codex/Claude Code。
- 两个外部后端均不接收普通 subagent 的 agentOptions 路由；需要各自插件实例配置。model 是实例级固定值，推理强度并未在其配置表声明为统一参数；应保留原生设置或补适配后实测，不能声称当前个人场景文件已逐任务驱动这两个插件。
- 资料定位发生两次路径偏差：依赖实际在 dsh/node_modules/@deepseek-ai，按需目录实际在 dsh-official-bundles/lib/index.js；随后使用已验证路径核实成功。在线搜索/打开未返回可用正文，版本结论基于本机原包和 npm 同版本原包。


## 2026-11-20 深度完善实现与验证发现

- 新增直接 DSH command 适配器、直接控制器入口，沿用既有 worker、不可变请求、takeover、yield/complete、上下文异常恢复和静止终态门禁。DSH/Orca 共用每派发启动锁，互查平台记录；根执行路径只有一个持权者。
- 新增模型文件 dsh.child_preset/scenarios/native_reasoning_models；生成固定路由场景工具。原生成员用 agentOptions 预检；产品后端明确拒绝伪造 reasoningEffort，显式接受原生强度后仍报告未验证。
- tokenMeter 运行期插件已实现，真实模型容量类型为 info.context.contextWindow（对象字段），已按版本类型核对修正。每个会话自动落盘总体上下文估计，devflow_context 使用生产决策逻辑；执行状态仍来自调用方，根交接入口能力还核对实际 root process 持权。
- 真实 DSH 配置会把本地插件路径转为 file URL，验证已兼容原路径与等价 URL。真实启动探针加载插件、建立会话并访问原生计量，在任何模型请求前以指定错误停止；不算真实模型推理。
- 初轮直接测试的两个失败分别是测试等待过短和测试末尾误推进下一工单后立即清理；修正测试等待/清理后5/5通过。Windows默认测试进程隔离再次出现子进程停滞，精确停止该测试树后用test-isolation=none执行，不重派业务。
- 离线报告曾发现脚本数据转义不正确，已增加注入样例回归并修复；Orca浏览器首次helper过期，后续重试成功；PowerShell @e14 需要作为字符串，修正后正常。浏览器实际选择下拉只触发change，已同时订阅change与input修复交互。
- 兼容链路初轮30/30通过；最终变更后的链路、核心与打包回归继续单独记录，不把历史通过数量累加冒充本轮去重总数。


最终补充：当前路由的 resolveModelInfo().context.contextWindow 优先于上次请求记录的容量，避免切到较小模型后沿用旧大窗口；已补回归。独立主进程入口 dsh-controller 拒绝Orca配置。全树状态仍是显式报告，产品后端强度仍保持未验证语义。全部223项唯一测试均有通过证据；安装及最终交互页已完成。

## 2026-11-20 模型配置页面与项目匹配

- 用户明确保留Orca主要执行层，DSH作为具体可选执行端；不迁移既有派发链。
- 已实现model-page.cjs本地页面与实际JSON保存；同源令牌、128KiB、修订冲突、共同文件锁保护。页面含模型/渠道/强度、场景、预设、阶段、DSH协作、导入导出与自定义场景。
- Devflow init-workflow与project-models匹配显式引用或唯一项目表，否则创建独立_plan/model-routing.json；模板可从个人文件复制。既有预设保留，内联路由需显式迁移，不开启执行。
- 模板基础场景planning/implementation/simple_execution；Astra/Sol/Flash保留用户拼写，不声明官方ID或实际可用性。个人根文件仍codex_only，已增加project_balanced可选预设。
- Autopilot无显式文件且无内联路由时自动消费项目表，保持不可变派发和未来会话生效。修正从DSH默认切到Codex场景时不继承无关团队参数。
- 确定性样例查看器用skill-creator原生成器生成；不是模型技能评测分数。
- 本轮51项功能/路由/初始化回归、14项安装器回归通过。浏览器真保存刷新、定制场景与390px布局通过。安装副本初始化、CLI路由、页面API均实测通过。
- Orca CLI在浏览器验证后原路径消失（Test-Path=false）；后续截图调用报无法识别可执行文件，按orca-cli要求停止该入口，保留早先截图及交互证明。
- 全部交接38项初轮36通过，wrong-cwd等待超时、direct初轮cycle cap断言失败；未修改实现，二者隔离复验2/2通过。保留两次日志，不冒充初轮全绿。

2026-11-20最终确认：核心回归日志model-page-core-final.log汇总66/66；页面服务19321 TCP与HTTP可用。源码/安装校验结果model-page-final-source.json和model-page-final-install.json均ok，Codex与DSH两个autopilot入口matches=true。

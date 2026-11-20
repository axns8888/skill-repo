# 模型与团队续项进度

2026-11-20：恢复原计划与已完成的双新会话证据，读取 DSH 本机随包真源和 Orca 版本匹配指南。开始补齐本次明确提出的模型和团队配置能力。原业务项目仍未找到，不改其配置。

2026-11-20：模型优先级、路由快照、Orca参数与供应商绑定、DSH临时overlay及有界日志回执已实现。专项20/20通过，runner专项44/44通过；随后补充通用桥团队回执验证并启动最终全仓校验。真实Orca工单完成，本机引擎记录确认custom/gpt-6.1-terra/high；DSH仅记配置合成验证。回调锁竞争已修复为有限循环重判，单列其原失败与后续证据。

2026-11-20最终：全仓162/162通过（381708ms）。源码锁及diff检查通过。已带备份同步本机autopilot技能，Codex/DSH入口一致；安装别名DSH合成探针通过，无额外模型调用。备份2026-11-20T02-36-45-429Z-0b53db45，安装收据保留source_dirty=true，未提交。原业务接入、DSH团队实际派生与模型调用、计费端模型及token量化未计入通过。

### 2026-11-20 执行端/供应商选择续项

- 新增可选 executor 与每执行端 provider 绑定，Orca 可按短工单选择 Codex/Claude；保留旧 --provider 和省略 executor 的行为。
- 增加 command/session 执行端确认、原启动执行端日志及 agentType 查询校验；DSH 独立入口提前拒绝不兼容执行端。
- 本机 DSH 实际配置合成2/2通过（团队关闭/3人开启），无模型推理；proof见 provider-routing-proof.json。
- 新增回归7项，专项与其余全仓测试分批运行；源码锁校验通过。DSH启动专项增补断言1/1通过，验证不匹配时不创建第二个启动目录。
- 待测试全部结束后记录精确结果并同步本机安装，不重写原业务项目配置。

本续项最终验证：全仓测试分两批169/169通过（路由相关72/72、其余97/97），DSH入口新增断言专项1/1通过；源码锁和git diff --check通过。已备份并同步axns-devflow-ext-autopilot至本机，Codex/DSH加载入口一致性通过；安装入口真实DSH合成探针通过（仍未发起推理）。证明provider-routing-verification.json；源码仍未提交，source_dirty=true。备份C:/Users/nikos/.agents/skill-repo/backups/2026-11-20T03-14-22-037Z-d9bdc691/previous/axns-devflow-ext-autopilot。Claude真实账号推理、DSH自动交接及原业务恢复不在本次已验证结果中。

### 2026-11-20 独立模型场景配置交付

- 新增model-routing.json、model-config库/CLI及9项场景测试；接通core/launch-policy/units/runtime与DSH独立清单，补充使用说明和配置字段表。
- 初次36项运行35通过，1项为测试fixture移除空scenarios后仍做子属性赋值；已修复测试。随后复核修正项目显式团队约束的优先级，并补断言。
- 最终模型/启动/控制器专项36/36、核心与短工单相关兼容12/12、同步打包14/14，共62/62通过。日志.cache/model-scenarios-final-tests.log、model-scenarios-compat-tests.log、model-scenarios-packaging-tests.log。未在本轮重复整仓基线。
- 本机DSH源码入口和安装入口各2组配置合成通过，保留preset/scenario/model/team证据，未发起推理；个人源文件未变。安装CLI只读show/preview通过：3模型、14场景、5预设，当前codex_only，Claude相关预设如实未就绪。
- 已更新源码锁并verify，备份同步autopilot，Codex/DSH入口一致性通过；备份C:/Users/nikos/.agents/skill-repo/backups/2026-11-20T03-51-52-178Z-a56e8835/previous/axns-devflow-ext-autopilot，source_dirty=true。
- 本轮独立配置交付完成。DSH自动交接桥、原业务恢复与token量化仍未完成；未改业务配置、未提交、未发布。

### 2026-11-20 DSH自动桥与文件内模型选择续项

- 已按用户指定设置provider=Codex、Claude Code；直接编辑model-routing.json选预设、场景、推理强度和团队，CLI保留。未填Claude模型名不自动启用。
- 新增lib/dsh-bridge.cjs、dsh-worker.cjs和11项回归；接入原Orca桥/控制器，真实JSON身份与监督takeover、同阶段连续新进程、前进程退出门禁、只查询恢复、上下文超限有限恢复及证据落盘。
- 初轮模拟平台生命周期、协调锁竞争、Windows rename EPERM等实际失败均已修复并回归。固定旧sessionId拒绝的最后探针发现默认动态引用被误拦截，已兼容内置引用，9项及真实配置合成复验通过。
- 最终组合92/92、打包/文档21/21，113个不同相关测试通过；47/47、20/20和9/9是重复子集，不重复计数。未在本轮重复所有无关技能测试。
- 真实DSH两个不同渠道各创建session并成功takeover，但分别MISSING_CREDENTIAL和ACCOUNT_SIGN_IN_REQUIRED，没有完成真实推理或两会话接续。dsh-live-proof.json保留实际ID及持权；需要DSH本机可用凭据后继续验收，未搬运密钥、未自动回退渠道。
- 原业务项目配置和当前个人codex_only预设未变；本轮两个专用终端确认进程退出后已定向关闭。未恢复原业务，未量化token。
- 最新源码锁、diff、备份同步与Codex/DSH入口一致性通过；安装入口配置合成2组通过。备份2026-11-20T04-51-06-741Z-6424765b，source_dirty=true。汇总dsh-handoff-verification.json。

### 2026-11-20 DSH原生路径与上下文状态判断

- 用户纠正后，撤回本轮单消息限制、任务板上限和默认禁用fork，未同步该错误方向。
- 新增可选team.mode=subagent及dsh_native预设，DSH普通spawn/control与实验性Team明确区分；省略mode保留原行为，mode进入请求/回执核对，CLI支持声明。
- 新增context-decision.cjs，依据当前上下文总量、下一动作/协调成本、检查点、后代与工具状态给出建议；未知值明确保留，不执行启动/停止、不假装自动遥测。原生多线调配不要求Orca；根会话替换能力单独确认。
- 源码真实DSH配置合成3/3通过，包含普通原生、实验性Team与关闭协作；未发起推理。相关41项通过，后续compat测试运行中。

本轮最终：完整通过的专项41/41、上下文/打包30/30、纯DSH原生模式领取1/1及并发领取孤立复验1/1，按测试名称去重65项。重复上下文8项不重复计数。额外runner整组默认Node隔离停滞，改无隔离后并发领取及后续执行权路径通过；与本轮无关的worktree合入清理扩展检查主动停止，部分运行不计全通过。源码/安装真实DSH配置各3/3合成通过，无推理。已备份同步宿主和autopilot，Codex/DSH入口一致，安装时间2026-11-20T06:14:57.838Z；保留当前codex_only，不改原业务。证明dsh-native-verification.json。

## 2026-11-20 纯 DSH 模型与执行层选型复核

完成针对本机 0.2.2-rc.1 的能力评估，记录 dsh-execution-architecture.md。新增核实官方 Codex/Claude Code 可选子级后端及 tokenMeter 当前上下文能力；不能再以“DSH只能用API模型”或“完全没有上下文计量”为保留Orca的理由。

建议目标路径为 DSH 原生协作 + 进程外轻量监督器，Orca 保留为可选平台和迁移期间已实现链路。根会话切换、场景到子级路由、外部后端推理强度与全树停稳观测仍需适配验收。当前仅评估，不变更技能或个人预设，不发起推理，不新增测试通过声明。


## 2026-11-20 深度完善交付完成

交付：直接DSH桥/直接控制器、固定成员场景、运行期上下文插件、8类行为样例、执行方式协议、离线交互报告与说明。个人模型文件新增可选dsh段，active_preset未变；安装入口同步至本机Codex/DSH别名，并保留备份。

验证：全仓17文件按组223项去重通过，详见dsh-deep-verification.json。上下文/路由/报告45，直接DSH6，既有链路30，其余142（worktree28）。额外顺序回归在worktree阶段为减少等待精确停止，剩余16用例分4组全数完成；不把未完整结束的单条命令说成整命令通过。所有已登记测试名均有最终通过证据。

真实DSH源码/安装入口配置合成、安装副本插件boot无推理检查通过。曾在仓库环境boot超时，改隔离临时目录成功；保留时序与边界。Python快检缺少PyYAML，使用已安装YAML库执行同一frontmatter规则通过；不改全局依赖。

浏览器：Orca内打开离线页，验证推荐切换、交接时活动执行树先收拢、390px无页面横向溢出，修复下拉change事件。最终报告附223项证据，静态预览_doc/DSH与Orca评估预览.png。源码锁、安装一致性及git diff --check通过。

当前仍未声明真实模型业务接续或token节约；纯DSH路径是headless后台新会话，不自动替换Desktop标签。准确Claude模型未填且保持禁用；DeepSeek模型/鉴权按用户要求不阻断程序验收。

2026-11-20 模型配置：源技能与本机Codex/DSH已同步，安装回执2026-11-20T08:36:30.920Z。51项相关功能、66项核心调度、14项安装器回归通过；桥接38项初跑36项通过，2项时序失败隔离复验通过。浏览器真实保存/刷新、自定义场景及390px布局验证通过。独立页面已恢复至127.0.0.1:19321；使用说明与入口位于_doc。真实模型推理未在本次验证。

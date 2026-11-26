# 当前有效模型同步（本地维护补丁）

同步只读取本机明确选择且当前有效的来源，使用该 DSH 安装的 `loadProfile`、`createRuntimeResolution`、`composeEntries` 和 provider schema；保留来源真实 provider/model ID、名称和能力。不推断或创建 namespace 映射，不从备份、旧报告或未选择 profile 合并模型。凭据不可解析的历史节点不成为新的有效来源；这不证明节点已删除，也不允许自动补造凭据。

## 版本与安装边界

这是 runtime 源码维护补丁对应的可选入口，**不是 manifest 中固定 commit 已具备的功能**。原 `Prepare/Build/Install` 仍校验 manifest 的固定来源，不会自动升级到未发布代码。先对补丁执行类型检查、定向测试、构建和包审计，再把本地包/SHA256 交给 runtime 原 `scripts/install-runtime.ps1`；该 helper 的 receipt、备份及安装回退继续有效。不要复制单个 dist 文件到已安装包、改 daemon 路径、强改 pin 或绕过安装 helper。旧 runtime 的 `--sync-status` 不可用时，本入口拒绝写入。

## 每台电脑独立选择

只包含模型来源选择的本机策略文件例子：

```json
{"schema":1,"sources":[{"profile":"desktop","enabled":true}]}
```

这只是策略格式示例，实际 profile 必须由本机当前有效配置/运行目录证据确认。headless/web 可逐项明确选择，不能因其中留有 patch 节点就当作当前来源。可选 `providers` 是显式选择列表，不提供时读取该已选择 profile 的全部有效 provider；不要永久硬编码某次截图的分组或数量。既有别名策略会被拒绝，需要重新按原 ID 配置。

```powershell
pwsh -NoProfile -File '<skill>/scripts/model-sync.ps1' -Action Status -DshHome '<本机DSH_HOME>' -DshCommand '<已核实DSH绝对路径>'
pwsh -NoProfile -File '<skill>/scripts/model-sync.ps1' -Action Configure -PolicyFile '<本机无秘密策略.json>' -DshHome '<本机DSH_HOME>' -DshCommand '<已核实DSH绝对路径>'
pwsh -NoProfile -File '<skill>/scripts/model-sync.ps1' -Action Enable -DshHome '<本机DSH_HOME>' -DshCommand '<已核实DSH绝对路径>'
pwsh -NoProfile -File '<skill>/scripts/model-sync.ps1' -Action Reconcile -DshHome '<本机DSH_HOME>' -DshCommand '<已核实DSH绝对路径>'
```

主入口也提供 `-Action SyncStatus/SyncConfigure/SyncEnable/SyncDisable/SyncReconcile/SyncRollback`，策略参数 `-SyncPolicyFile`、回退参数 `-SyncRevision`。Configure 不启用，Enable 是显式本机写入；不创建任务、服务、计划任务或其他 runner/controller。

## 生命周期与删除

监听属于现有 native DSH runtime 进程：启动对账、目录事件 2 秒防抖、60 秒内容指纹补偿；目录监听处理原子替换，重新对账会更新 bundle 监听集合。活动 execute 固定就绪时的配置 revision，监听只准备后续进程的目标配置；新进程从最新有效目标配置启动。退出时清理监听和计时器，不遗留子进程。

当前 native 协议每个进程只接收一次 execute。**没有 native runtime 进程运行时，没有后台监听**；60 秒是进程存活时的调度间隔，不是空闲时同步保证或硬性 SLA。大依赖图解析、磁盘和受限 ACL 操作会增加实测延迟，必须测量，不承诺十秒。独立的五分钟远程模型发现刷新未实现：现有 DSH draft-discovery API 不等同于受支持的后台 catalog refresh 合同。

成功读取所选当前源后，仅对同步拥有且未被人工改写的目标项应用明确删除/禁用；历史引用保存在本机事务备份和禁用集合，不进入当前可选目录。目标未知项只预览；同 key 冲突和人工漂移保留原有效组，其他组继续。缺文件、损坏/半写、超时、不可解析来源或凭据不可用不作为权威删除。初次接管不能凭当前 target 存在就认领，需有归属证据与三方基线；迁移历史项前先备份，并发修改则停止对应写入。

## 状态与回退

安全状态仅含随机 revision、最后成功时间、下次检查、changed/removed/conflicts/drift/stale/failures/deletionPreview/inactive/pinned 等；不输出原始配置、凭据引用/值、端点、headers、秘密内容 hash 或原始异常。目标 patch 与 `.model-sync` 的事务、history、state 保留本机受限权限，不打包、不上传、不跨机复制。源码/技能只含脱敏夹具。

```powershell
pwsh -NoProfile -File '<skill>/scripts/model-sync.ps1' -Action Disable -DshHome '<本机DSH_HOME>' -DshCommand '<已核实DSH绝对路径>'
pwsh -NoProfile -File '<skill>/scripts/model-sync.ps1' -Action Rollback -Revision '<安全状态revision>' -DshHome '<本机DSH_HOME>' -DshCommand '<已核实DSH绝对路径>'
```

Disable 停止后续监听/写入，保留最近目标配置。Rollback 先停用，检查目标仍等于对应事务写后版本，再原子恢复目标及前一 state；人工漂移则拒绝覆盖。活动执行保持原 revision；下一个 native 进程从恢复目标启动。journal 处理“文件已写但 state 未落盘”的中断；失效 writer 锁在独立恢复锁保护下回收。若恢复锁本身因进程异常遗留，先核实无写入者，再人工处理该锁；不自动抢占活进程。

## 平台刷新缺口

`catalog-generation.json` 是**本地**失效标记，不是 Multica 已消费的通知合同。所核验 CLI 不提供目录刷新，任务上下文拒绝宿主 `daemon probe-runtimes`，不能用频繁重启代替。daemon 发现缓存与 server/UI 缓存的 TTL、失效和 force 语义未获安装版可验证合同，不编造已联通，也不把 server force 视为 daemon 重探测。报告必须分别列出本地文件、provider 执行注册表、`--list-models`、平台 online、UI 和真实推理的证据。推理保持单独授权。

另一台电脑使用同一脱敏源码/技能包，在本机重新选择目录、安装并校验版本和包 hash、确认当前 profile、配置凭据引用、选择来源并显式启用；不复制任何 DSH_HOME、身份、session、备份或受限 state。

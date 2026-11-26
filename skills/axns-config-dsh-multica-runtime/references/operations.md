# 操作、安全及验收边界

## 固定来源与目录保护

`manifest.json` 固定仓库 URL、commit、源码 Git tree OID（40 位 Git 对象 ID） 与 runtime 版本。Prepare 使用 Git 获取该精确 commit。目标目录若已有内容，仅接受其 origin URL 精确匹配、HEAD 等于固定 commit 且 tracked/untracked 均干净的 clone；否则停止，不 reset、clean、stash、强切换或挪用内容。需在自己的 `-Workspace` 下提供空子目录，或使用本技能默认独立目录。Git 私有仓库凭据由用户自己的 Git Credential Manager/SSH 管理；不索取或输出 token。

构建调用固定源码中的 `prepare-pnpm.ps1` 和 `build-release.ps1`，显式将输出与 pnpm 工具目录置于本次工作目录。固定 Node 24.21.0 与 pnpm 12.5.1；不会安装/升级系统 Node、DSH、Git 或 CLI。固定源码的 build 会核对源码 commit、上游祖先、manifest 版本、lockfile，并构建、测试及审计 tgz；失败即停止。产物有 SHA256SUMS、build-info 和来源 commit。Install 将本地包和校验文件交给原有 `install-runtime.ps1`，不下载 Release；原 helper 负责 profile 备份、hash、安装、验证与 backup ID。脚本不重新实现其事务。

## 前置与秘密

逐项检查 PowerShell 7.4+、精确 Node、Git 和 DSH；不假定 Multica CLI 环境变量在普通终端存在。Platform 检查必须提供真实 CLI 绝对路径 `-MulticaCliPath`，否则拒绝从 PATH 猜测旧 CLI。支持明确指定本机 `-DshHome`、`-DshCommand`；DSH 可执行路径错误时不猜测。

先检查 `dsh --profile multica --probe` 与 `--list-models`。probe 协议需为 JSONL v1、runtime dsh、插件版本非空；模型目录必须非空。若为空，报告“本机 DSH 模型配置尚未就绪”，按 DSH 官方安装/配置入口由用户在本机完成，之后重试；不把缺凭据当安装成功、不读取/回显环境值。DEEPSEEK_API_KEY 仅能作为是否设置的布尔提示，终端变量未必对已运行 Desktop daemon 可见；必须由启动 daemon 的同一用户上下文配置，并按需在该上下文重启。不要采集、复制、记录或打印 token/API key。

## 动作语义

- `Check`（默认）：环境/版本/路径/模型目录和仓库 clone 状态诊断，不写真实 profile，不启停服务。
- `Prepare`：仅从固定 SHA 获取源码到空的独立目录；Git 网络或权限缺失时失败。不会构建。
- `Build`：准备固定源码（已存在目录严格校验）并调用固定 pnpm 准备/构建和包审计，产生可审查 tgz 与来源摘要；不安装。
- `Install`：先构建并要求模型目录非空，然后仅安装本机 `profiles/multica`，返回 receipt 版本/hash/backup ID；不重启 daemon。确认 Desktop 是否正使用该 profile 并避免并发插件操作。失败时只报告 helper 的真实恢复结果。
- `Verify`：运行固定 helper 检查 probe、非空模型目录与 stdio ready/能力握手，另以用户指定精确 CLI 检查 runtime 列表。不会运行模型推理。
- `Rollback`：必须显式提供 helper 返回的 `-BackupId` 并指定同一个 `-DshHome`；交给原 helper 检查当前安装 marker 后回退。勿把目录当普通备份手工覆盖。
- `Platform`：精确 CLI 执行 `daemon status` 与 `runtime list` 诊断。不自动 restart/create/rebind。

工作目录与 DSH_HOME/Multica 登录上下文各机独立。跨机共享项目优先使用可访问的 Git 仓库或逐机显式配置，不能复用其他电脑的绝对路径。每台须独立登录同一 workspace。runtime 出现在列表仅证明平台发现，不代表 Agent 已选择该 runtime 或自动均衡/故障切换。

## 验收分层

1. 本地安装产物：包身份、SHA256 与 build-info 来源 SHA。
2. Runtime 自检：probe v1、非空模型目录、stdio 握手和能力。
3. 平台发现：runtime list 中对应设备的独立 runtime ID/online 状态；daemon 启动账户和运行环境要与本地检查区分。
4. 独立运行验收：有授权、有可用模型时另行测试真实推理、取消、恢复及工具结果回传。前三项通过不能替代此项。

仅由设备用户依据当前 Multica CLI 帮助，在确认无活动任务且接受影响后手动启停 daemon。runtime 注册/在线不是 Agent 绑定预览；改变 Agent 时先人工确认 workspace、Agent、runtime ID、当前绑定及切换影响，再单独操作。此技能不执行这些副作用。

首次安装如模型目录为空或私有 Git 不可读，准确报告具体缺项和由设备用户完成的本地步骤；不要扩大权限或猜路径。可安全重试 Check/Prepare/Build。每台电脑分别完成以上验收并记录版本、设备名和 runtime ID，不共享身份目录。

## 当前有效模型与恢复入口

持续同步属于本机可选维护补丁，使用 [model-sync.md](model-sync.md) 中的来源选择、Enable/Status/Reconcile/Disable/Rollback 入口。区分配置存在与当前有效来源；未选择或缺凭据的历史节点不自动导入。删除只应用于已接管且三方基线未漂移的目标项；其他项预览，不从备份复活。原 manifest 来源和安装 helper 的 hash/receipt 校验保持有效。目录事件与兜底仅在 native runtime 进程存活时运行；本地失效标记不代表 daemon/UI 刷新已接入，必须分层验收。

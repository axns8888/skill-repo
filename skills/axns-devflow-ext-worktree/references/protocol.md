# Worktree 登记、检查与结案协议

## 启用及共享位置

只读取**主检出目录** AGENTS.md 的显式配置，详见扩展 README。`git worktree list --porcelain -z` 第一项定位主检出，`git rev-parse --git-common-dir` 定位共享 Git 目录。支持从任一任务 worktree 找回同一控制目录，不支持 bare 仓库。

```text
<主检出目录>/
  AGENTS.md                         # extensions、integration_branch、超时配置
  .worktrees/<task-id>/              # 独立工作区，分支 task/<task-id>
    _plan/process/<task-id>/
      plan.md                       # 唯一现行计划，按宿主模板补足
      parallel.json                 # 与共享活动指针同步的任务元数据
      acceptance.md                 # 实际验收依据；结案前提交并合入
      <按需的证据和复核文件>
  _plan/active/<task-id>.pointer     # JSON；活动状态与持权的权威快照
  _plan/archive/<task-id>.pointer    # JSON；已完成任务的本地协调归档
  _plan/registry.jsonl               # 事件审计流，不作为第二套计划
<共享 Git 目录>/axns-devflow.lock/  # 短时协调锁，非文件修改权
```

主目录的 active/archive/registry 是本地运行状态，必须被 `.gitignore` 忽略，不随分支合并；任务 worktree 里的同名目录不是共享源。任务计划与证据正常提交，合入后在集成分支 `_plan/process/<task-id>/` 留存，再从台账索引。仓库 clone 到其他机器不会同步本地协调状态。

所有修改登记的命令都用原子 mkdir 取得共享协调锁，依次校验、更新元数据、追加事件、原子替换指针。JSONL 每个事件一行，包含 task-id、owner、scope、shared_claims、依赖、基线及状态等审计字段。并发命令争锁失败就停止，可重跑；不会自动删除未知锁。status 同样取得协调锁再读取，以免读到其他命令更新一半的快照；不会创建任务或流程运行文件。文件系统操作不具备跨文件事务能力；进程崩溃或意外 I/O/Git 错误会留下锁或部分记录，按末尾恢复，不宣称崩溃后自动恢复。

## 范围、修改权与依赖

登记 JSON 示例（自行创建临时清单，放在任务 scope 之外的项目外位置）：

```json
{
  "scope": ["apps/api/orders/", "tests/orders.test.js"],
  "shared_claims": ["package-lock.json"],
  "depends_on": [],
  "owner": "nikos/window-orders"
}
```

- task-id：`YYYYMMDD-short-name`，后半为小写字母、数字和连字符；关闭后的编号不复用。
- scope：仓库相对路径，文件必须精确匹配；目录必须以 `/` 结尾。`src/a/` 与 `src/a/file.py` 相交，与 `src/ab/` 不相交。不支持 glob、绝对路径、反斜杠、`..`。路径按大小写不敏感保守比较，兼容 Windows 协作。
- shared_claims：精确文件路径，不能与本任务 scope 重叠。共享文件若落在大目录范围内，需把 scope 拆成较小目录/文件，让该文件只属于 shared_claims。两个任务的 shared_claims 可以请求同一文件，但只会有一个任务成功持权。
- `.git/`、`.worktrees/`、`_plan/active/`、`_plan/archive/`、`_plan/registry.jsonl`、`_plan/.active_plan` 和 `_plan/process/` 是保留范围，不可声明或用祖先目录覆盖。自己的 `_plan/process/<task-id>/` 隐式允许，其他任务记录不能改。提示词、基线和台账可声明精确 scope/shared_claims，按普通任务独占/串行维护。
- depends_on：引用已登记或已归档的 task-id，禁止未知、自引用、循环。依赖未 completed 可以登记，但不得开始执行、提交或合入。依赖建立后需把所需提交合入自己的任务分支，重新检查/验收。
- `base_commit` 记录登记时集成分支提交，不随合并基线改写。check 使用当前集成分支与 HEAD 的 merge-base 查任务净差异，并分别检查暂存、未暂存和未跟踪文件；每次检查固定一次集成提交快照，输出 integration_head，每次提交前调用才能防止历史越界被后来回滚掩盖。

scope 冲突（包含 scope 覆盖他人的 shared_claims）拒绝登记；shared_claims 互撞则 blocked，**不预留任何 scope 或共享文件权**。blocked 任务不能开始实现。escalated 保留原有持权，但禁止继续执行。持权持续到成功结案；不按超时自动释放。

## 命令与阶段

所有命令使用 Node.js 标准库与 Git，无安装依赖；以下 `<脚本>` 指本扩展 `scripts/worktree.cjs`。--project 显式指定项目根或任务 worktree；--manifest 路径相对于命令调用目录。

```powershell
node "<脚本>" status --project "<项目>"
node "<脚本>" register --project "<项目>" --id 20261112-orders --manifest "<项目外>/orders.json"
node "<脚本>" check --project "<项目>/.worktrees/20261112-orders" --id 20261112-orders
node "<脚本>" claim --project "<项目>" --id 20261112-orders
node "<脚本>" escalate --project "<项目>" --id 20261112-orders --reason "重复冲突，证据见任务记录"
node "<脚本>" claim --project "<项目>" --id 20261112-orders --reason "用户已裁决，依据见任务记录"
```

- **P1 register**：在协调锁内检查已有编号/分支/路径和忽略配置，从集成分支创建新 worktree/分支，再做范围、持权和依赖校验。scope/依赖无效时只回滚本次新建且干净的 worktree 与分支；不接管已有工作。共享持权冲突时保留 blocked 任务、指针及 `task.blocked` 事件；成功时写骨架和 `task.claimed`。退出码 2 表示已登记 blocked，不能当成可执行任务。
- **claim**：等待方重新获取修改权或协调决定后恢复。重算全部冲突，不自动抢权。变更范围/依赖可带 `--manifest <新清单> --reason <用户授权与决定依据>`；新清单仍只接受四个登记字段。变更冲突且本任务原来持权时拒绝修改，保留原权。成功会更新 parallel.json，记得在任务分支提交这项真实变更。
- **P2/P3 check**：必须从任务 worktree 执行，可从其子目录调用。核对分支、根路径、活动状态、元数据、scope/持权、依赖、已提交净差异、暂存/未暂存/未跟踪路径及独有提交前缀；改名按删除与新增都检查。组合合并进行中须 MERGE_HEAD 等于当前集成分支且冲突已解决；暂存差异相对集成基线检查，排除继承的其他任务改动。忽略文件不当成业务改动，项目的 ignored 生成物若会影响验收需另行检查。失败退出 1，窗口必须阻断执行/提交；未安装自动 Git hook。
- **P5 escalate**：调用者根据真实冲突次数/CI 证据判断，写原因与 `task.escalated`，停止推进并保持已有持权。status 报 waiting_since 和 wait_exceeded；超时默认 120 分钟，窗口据此升级，脚本不猜测 CI 结果。

## P4 组合验收、合入及清理

复用宿主 P4，不维护扩展版提示词。具体顺序：

1. 先关闭复核阻断项，再在任务分支合并最新本地集成分支：`git merge --no-ff --no-commit <集成分支>`。合并前确保任务变更已按授权提交；有冲突回任务实施阶段。合并进行中不能把“命令没有退出错误”当作验收通过。
2. 验证组合代码的接口/调用方、测试夹具、锁文件及任务验收项；据实记录。完成任务分支的合并提交（前缀仍为 task-id），提交验收记录。记录被检代码身份和最终候选 HEAD；最终检查及用户验收必须适用该候选，不得用旧基线测试替代。
3. 获准合入后，在干净的集成分支 `git merge --ff-only task/<task-id>`。其他任务先合入导致无法快进时，回任务分支重新合并及验收。共享文件任务在登记层就串行持权，依赖必须先 completed。
4. 从**主检出根目录**调用：

```powershell
node "<脚本>" finish --project "<主检出根目录>" --id 20261112-orders --accepted-head "<真实已验收的完整 HEAD>"
```

运行 finish 的进程也不能位于待删除的 worktree 内。finish 核对任务仍持权、正确分支/HEAD、元数据一致、依赖 completed、候选已在集成分支历史中、候选包含非空 acceptance.md，且 worktree 无修改、无未跟踪或忽略文件。它不运行验收、不解析 Markdown 以推测通过，也不创建提交或执行合并。`--accepted-head` 声明该提交已获真实验收，调用者须有可追溯依据。通过后不用 --force 移除 worktree，写归档、追加 `task.completed`（含释放列表）、移除活动指针。先清理再释放，避免清理失败时其他窗口取得修改权。task 分支继续保留。

依赖缓存、node_modules 等 ignored 内容也会阻止 finish；按项目约定先另行处理，不能为完成结案自动加 --force。真实任务记录已提交并合入才允许清理，因此验收证据不会只留在被删除目录。

## 异常与恢复边界

- 预期拒绝（越界、范围冲突等）释放短时协调锁，仍保留既有任务权；意外错误保留协调锁和现场。看到锁先确认是否仍有命令进程，不能只看锁的年龄删除。
- 若进程已停止，协调者读取 Git worktree/分支清单、所有活动/归档指针、parallel.json 与事件尾部，判断最后完成的步骤。保存恢复证据，修复到唯一一致状态，再移除**已核实的**协调锁。不要通过手改 holds_claims 抢占其他任务。
- finish 在移除 worktree 后若归档失败，任务指针可能仍活动，保持锁并从集成分支恢复已提交记录和归档。不要再创建同名任务或把该分支当作孤儿删除。
- 需要废弃尚未合入的任务时，不调用 finish 或假填验收结果；先保存变更/证据，再由用户决定保留、转交或放弃，并记录协调结论。当前 helper 不自动取消或强删未合入任务。
- 本工具不提供跨 clone 分布式锁，也不能阻止绕过命令的直接文件修改/Git 提交。语义冲突和人工验收由窗口负责，不能称为操作系统级隔离。

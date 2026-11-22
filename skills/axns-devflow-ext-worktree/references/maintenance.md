# 项目级维护与快照保全

已登记业务任务按原范围与持权协议处理。以下操作都不创建业务 worktree、不放宽范围；读取时用窄输出，写入仍用共享协调锁。

## 状态查询与项目模型表

配置写入以所有者和生效引用为准，不以当前工作目录中“看起来像配置”的文件推断：

| 配置 | 所有者/生效路径 | 冲突与写入边界 |
| --- | --- | --- |
| `AGENTS.md` 扩展声明、分支及配置引用 | 目标项目主检出目录的项目维护者 | 页面保存前比较已读版本；声明扩展不等于启用执行；不把全局/个人配置写入业务任务 scope |
| autopilot execution 配置 | 主检出 `AGENTS.md` 明确引用的项目内 JSON | 检查 AGENTS/config 修订及运行态冲突；仅显式保存后生效，不能顺带改模型表 |
| 项目模型表 | `model_config_file` 实际引用；未引用时按唯一发现规则 | 先读生效路径与 SHA256；共享表/个人表/任务专属表不由项目维护命令写入；独立原子替换，单独复核和提交 |
| 模式-预设可选关联 | 项目开发设置配置域 | 默认无关联；编辑关联不改模型表，编辑模型路由不改开发/执行设置 |

同时存在多个候选模型表、引用损坏、版本变化、根目录变脏或活动持权冲突时停止并报告，不静默选表、覆盖或把并发保护降级为提示。

```powershell
node "<扩展>/scripts/worktree.cjs" status --project "<目录>" --summary --id "<task-id>"
node "<宿主>/scripts/project-models.cjs" show --project-root "<主检出目录>"
node "<autopilot>/scripts/model-config.cjs" show --file "<生效模型表>" --summary --scenario implementation
```

全局状态省略 `--id`；旧调用省略 `--summary` 保留完整结果。项目统一表的所有者以实际引用为准：外部共享表、个人配置及任务专属表不在下列入口写入。使用带完整模型校验的 `maintain-models` 需要同布局安装 devflow `1.0.0-rc.5`、worktree `1.0.0-rc.4` 和 autopilot `1.0.0-rc.4`；无需开启 autopilot 执行。

```powershell
node "<扩展>/scripts/worktree.cjs" maintain-models --project "<主检出目录>" --manifest "<项目外候选 JSON>" --expected-head "<完整 HEAD>" --expected-config "<小写 SHA256 或 missing>"
```

- 先核实工作目录、主检出分支和已生效模型表，再在项目外准备候选。`missing` 仅用于确无模型表时；已有表用 `show --summary` 的 SHA256，或对原文件按字节取 SHA256。
- 脚本核对当前 HEAD、根目录清洁状态、配置发现路径、活动 scope/shared_claims 与文件版本，使用协调锁和模型文件锁。冲突、脏目录、版本落后或解析失败时停止，保留原内容；不要删除他人的锁、持权或未提交改动。
- 只写该项目级模型表，不改变引用、执行开关、Git 分支或业务记录。核查实际变更后独立提交（如授权）；新的路由只适用于后续派发。协调锁属于协作协议，不是对未遵守协议的手工编辑器的文件系统锁。

## 快照保全，不是交付

先由原任务协调者核对旧写入者及后台任务已停稳、原派发已交权，再指定目录及需要保留的本地文件。`--confirmed-stopped` 是调用者确认；脚本只能拒绝仍有登记的 runner 窗口，不能探测或证明真实平台进程已停止。状态未知时不得快照后立刻迁移/退役。保存目录必须是全部项目 worktree 和 Git 管理目录之外的新目录。补丁、本地文件和 bundle 可能含未发布代码或历史敏感数据，只放入用户控制的适当位置，不上传。

```powershell
node "<扩展>/scripts/worktree.cjs" snapshot --project "<已登记项目>" --id "<task-id>" --out "<项目外新目录>" --confirmed-stopped --manifest "<项目外清单 JSON>"
```

清单可省略；格式为 `{"include":["_plan/process/<task-id>/window-handoff.md","本地资料/必要文件"]}`。清单只列未跟踪的普通文件，含需要的忽略文件及本地证据；不会自动复制忽略文件、子模块、运行态、凭据或完整工作区。提交历史在 bundle 中，已暂存与未暂存跟踪变更分别保存为 Git 二进制补丁。`snapshot.json` 最后写入，记录原 task-id/status、目标分支与 HEAD、原任务记录路径、产物摘要、显式保存文件摘要和未纳入的非忽略未跟踪路径；没有该文件的部分产物不能视为保全完成。该回执不复制或转移持权、活动登记或自动化运行态。进行中的 Git 操作、子模块或隐藏索引状态需单独处理。

在独立空 Git 仓库验证恢复：先比对 snapshot.json 中每个产物的 SHA256；用 `git fetch <candidate.bundle> <snapshot.json 的 ref>` 获取候选，检出 `FETCH_HEAD` 并比对 HEAD；非空的 `index.patch` 用 `git apply --index` 应用，再用 `git apply` 应用非空的 `worktree.patch`，最后按清单核对摘要、恢复 `local/` 中选定资料。Git 补丁遵循实际仓库的换行、过滤器与权限语义，不替代磁盘镜像。核实需要的未完成项、原 task-id、当前状态、文件和证据均可恢复后，仍由原任务协调者决定是否建立新的执行权交接及如何迁移/退役旧工作区；不得复用快照回执或复制的登记元数据作为新目录的持权。

报告分别标出保全、合入（提交及目标分支）、技术验收（被检身份与环境）和结案。此命令不调用 finish、不改原任务状态、不删除旧工作区，不提供未验收候选合入捷径。

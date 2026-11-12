# axns-devflow 的可选 worktree 扩展

安装时同时选择 `axns-devflow`、`axns-devflow-ext-worktree`。安装扩展不等于启用；项目仍默认单任务模式。

项目已有宿主最低目录后，在 AGENTS.md 声明：

```yaml
extensions: [worktree]
integration_branch: main
lock_timeout_minutes: 120
```

`main` 换成项目真实本地集成分支。多行 `extensions` 列表也支持；这些字段各自独占一行，使用上面的明确配置形式。AGENTS.md 是唯一开关源，技能安装状态和提及 worktree 的自然语言都不会启用扩展。

在项目 `.gitignore` 中加入以下**本地协调文件**，按项目授权将配置提交到集成分支，再开任务：

```gitignore
/.worktrees/
/_plan/active/
/_plan/archive/
/_plan/registry.jsonl
```

已有非空 `_plan/.active_plan` 时先完成原任务，或明确迁移旧任务并归档单指针。不要在执行中的单任务上直接切换模式。

每个新窗口贴宿主 P0，再按 P1–P4 推进；P5 仅协调升级时使用。宿主初始化会把提示词放在项目 `_plan/prompts/window/`。检查活动任务：

```powershell
node "<扩展技能目录>/scripts/worktree.cjs" status --project "<项目目录>"
```

登记清单、完整命令、范围语法、组合验收和恢复方式见 [协议](references/protocol.md)。范围和共享持权检查已经实现，不是仅告警模式。脚本不安装 hook、不运行 CI、不自动合并或提交；这些动作由窗口按项目授权和真实证据执行。跨窗口协调仅覆盖同一台机器、同一 Git 仓库的 worktree，独立 clone 或其他成员机器需要另行协调。

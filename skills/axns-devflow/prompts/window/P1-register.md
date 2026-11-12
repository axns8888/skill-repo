# P1 阶段 0：任务登记

执行 axns-devflow 阶段 0。任务：{{任务描述}}。先回报模式、已有授权及登记方案，再执行已授权动作。

1. 分配日期前缀加短标识的 task-id，确认目标、成功标准与范围；扩展登记完成前不在主检出目录另建任务副本。
2. **若 worktree 扩展启用**，按扩展登记协议操作：在共享协调锁内，从已核实的集成分支创建 `.worktrees/<task-id>` 与 `task/<task-id>`，然后校验 scope、shared_claims、depends_on。scope 相交则拒绝登记并回滚本次新建资源；共享修改权冲突则登记为 blocked，保留任务窗口，不获得任何修改权。通过后写 parallel.json、共享活动指针及 `task.claimed` 事件。仅在新任务 worktree 的 `_plan/process/<task-id>/` 按宿主模板补足计划骨架，不提前宣称持权。
3. **若扩展未启用**，在当前项目 `_plan/process/<task-id>/` 建立计划骨架，写 `_plan/.active_plan` 指向本任务；不创建 worktree、active 目录或注册表。
4. 登记后本窗口切换到任务 worktree。阻断任务恢复须重新仲裁，不能手改指针抢占。

回报：task-id、模式、worktree 绝对路径、分支、scope / shared_claims / depends_on、校验结果与占用方、事件位置、计划入口、下一步。

扩展同时交付批次 1（创建/清理、登记、指针、事件）与批次 2（范围和修改权校验），检查会阻断。若目标环境使用仅批次 1 的旧扩展，必须报告“仅告警、不具备阻断保护”。

下一段：[P2 执行](P2-execute.md)。

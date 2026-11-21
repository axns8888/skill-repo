# Findings & Decisions

## Requirements
- 执行 `_doc/skill进化树/axns-devflow/261121-SmartKnora单工作区与worktree按需启用.md` 的明确综合方案，合并原始重复读取反馈。旧实施记录不重复改写。
- 覆盖意图入口、角色和派发、窄输出、模型表并发保护与独立快照；保持现有输出和门禁。无依据不修改业务项目、外部技能、安装副本或远程。

## Research Findings
- 本地基线：239 项，238 通过、1 跳过。历史记录里的 DSH `stage_cap` 两项故障在本轮基线未复现。
- 现有 Git 集成分支已由项目配置，不依赖 master/main；修改集中在入口/角色语义与新增维护行为。
- 工作区仅有本技能库，没有可用于本轮独立复验的 SmartKnora 原任务目录；临时 Git 可验证真实持权、候选与恢复，不代表模型平台或使用方业务复验。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
-

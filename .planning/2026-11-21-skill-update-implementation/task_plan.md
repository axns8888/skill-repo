# 技能更新批次：入口减负与维护工具

## Goal
实施 2026-11-21 综合方案的明确条目，保留授权、门禁、回调及完整 JSON 兼容性。

## Next Step
源码批次可交付；真实项目可用时，用原任务在 Orca/DSH 复验，并独立排查全仓并行下的 DSH 偶发失败。

## Current Phase
已交付本地源码与验证记录（不等同真实平台复验）

## Phases

### Phase 1: Requirements & Discovery
- [x] 核对原始反馈、综合方案与历史实施状态，保留用户已暂存内容。
- **Status:** complete

### Phase 2: Planning & Structure
- [x] 复用协议、权威模型表、现有入口与锁，明确验收范围。
- **Status:** complete

### Phase 3: Implementation
- [x] 更新三个技能的源码、提示词、模板、文档、版本和快照。
- **Status:** complete

### Phase 4: Testing & Verification
- [x] 执行全仓、行为和格式验证；记录失败、单独复跑及未覆盖边界。
- **Status:** complete

### Phase 5: Delivery
- [x] 交付本地源码、技能版本、快照校验和实施摘要。
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 用进化记录和 Codex 技能创建规范定界 | 保留原反馈与原计划；只实现明确的仓库内事项，复用已生效的模型确认门禁、登记、权威计划和脚本。 |
| 保持旧 JSON、增加 opt-in 窄视图 | 模型交互减负，不破坏脚本消费者。 |
| 真平台和可选提案单独记录 | 不操作未定位的 SmartKnora 项目，不开启未验收合入、无 worktree 自动结案或新调度器。 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| 旧方案无原生 Phase 标记 | 保留原案，新建独立实施计划。 |
| rg 路径通配符、补丁批处理传参不支持 | 用 -g 筛选；直接调用 apply_patch 的原生入口。 |
| 首轮快照验收发现额外未跟踪的 parallel.json | 应显式选入必要的本地登记文件；测试补充验证恢复并保留未选文件清单。 |
| 默认 Python 无 PyYAML | 用已缓存依赖的 `uv run --no-project --offline --with pyyaml python -X utf8` 执行原技能校验器，未修改技能安装。 |
| 模板源位置存在生成项目才具备的旧链接 | 校验本批新增/修改的 10 个相对链接；已有模板由初始化测试验证。 |
| 两轮全仓分别有一个 DSH 模拟未返回 stage_cap | 记录失败现象和差异，不降低断言；增加末次事件及有限证据的诊断，整份 DSH 测试单独复跑 6/6。 |

# 项目模型配置

Devflow 保留 Orca 作为主要执行承载层。模型表决定场景使用的渠道、模型及推理强度；项目执行配置决定通过 Orca 或可选直接 DSH 入口启动。编辑模型表不自动开启执行。

## 配置页面

同时安装 axns-devflow 与 axns-devflow-ext-autopilot 后，先在目标项目目录打开终端，再运行扩展目录中的脚本：

```powershell
node <axns-devflow-ext-autopilot>/scripts/model-page.cjs
```

打开命令输出的本地页面。支持编辑模型参数、按场景分配模型、控制 DSH 协作、切换或复制应用方式、增加项目场景、修改阶段关联，并保存到实际文件。保留 JSON 直接编辑、导入导出及 model-config.cjs 的 show/preview/use/assign 命令。

相同模型 ID 的参数由所有引用场景共用。需要同一模型在不同场景使用不同强度时，添加两个模型条目，分别填写强度，再分配给场景。强度留空表示遵循渠道原生设置；填写值必须由实际渠道接受。DSH 子级产品后端仍遵循原有强度约束。

| 场景 | 默认模型 | 推理强度 | 渠道 / 执行端 |
| --- | --- | --- | --- |
| 制定计划（planning） | gpt-6.2-astra | high | Codex / codex |
| 一般执行（implementation） | gpt-6.2-sol | high | Codex / codex |
| 简单执行（simple_execution） | deepseek-v4.1-flash | 留空，原生设置 | deepseek-official / dsh |
| 代码复核、验收、协调、需求梳理 | gpt-6.2-astra | high | Codex / codex |
| 调试、重构、界面实现、测试、快速修复 | gpt-6.2-sol | high | Codex / codex |
| 文档、资料归纳、交接材料 | deepseek-v4.1-flash | 留空，原生设置 | deepseek-official / dsh |

模型名称为用户提供的可编辑默认值，不是官方模型目录或账号联通证明。简单模型生成的交接材料仍由主执行者核对；文档和资料中的关键业务判断需要复核。高风险小改动应选择复核或一般执行场景，而非按改动行数选择简单模型。

Claude Code 与 Codex 使用准确渠道名称。Claude 没有预填模型 ID，初始禁用；填写已知 ID 并启用后即可选择。

## 新旧项目匹配

已启用 worktree 的项目维护统一模型表时，从主检出核实生效位置和文件版本；不要把它写进业务 scope。经授权且符合所有者与持权条件时使用 worktree 扩展的项目级维护入口（其 `references/maintenance.md`）。模型查询优先用 `model-config.cjs show --summary [--scenario <场景>]` 查生效配置和摘要；用户需选模时按需展开完整权威选项。

新路由或模型场景尚未获授权时，在对应正式计划或派发前匹配模型表；沿用当前会话或已登记派发不重选。现成表直接复用；缺少时一次说明实际路径与缺项，区分引用已有表和创建草稿。init-workflow.cjs 创建流程时也自动匹配或创建，不因此开启执行。旧项目不必重建整个流程。

### 用户预设与场景选择

模型表是用户维护的配置，不是 Agent 局部发现的目录。确需选择时先核实生效路径及 `active_preset`，展示相关已登记场景、渠道、模型和推理强度；未联通验证的值标记为配置值。推荐不等于授权，等待用户明确选择后才启动相应正式计划或派发。已明确选择或固定授权可复用；仅指定场景时保留现行预设。状态查询、当前会话轻量维护和同工单接续不选模。

若表缺失、引用冲突/损坏、场景不存在或配置路由不完整，说明已核实的文件与缺项，暂停路由并请用户选择修复/配置方式。获准初始化时可以从模板生成模型表，但必须将其标为待用户确认的草稿；不能把模板默认值、局部平台查询结果或不可用性未知的模型伪装成用户预设或完整目录，也不能因初始化成功就视为用户已完成选择。除非用户明确授权，不静默回退到其他预设、模型或执行器。

用户确认场景后，将其写入本任务/短工单的 `launch.scenario`，并在派发前核对该选择能解析到当前生效预设的实际模型路由。保存预设与场景配置只影响后续新会话，不改变已有会话。

```powershell
node <axns-devflow>/scripts/project-models.cjs init --project-root <项目>
```

查找顺序：

1. AGENTS.md 中 autopilot_config 所指 JSON 的 model_config_file。可引用项目内或共享绝对路径；引用损坏时报告问题，不另建表遮盖问题。
2. 项目中的 _plan/model-routing.json 或根目录 model-routing.json。两份都存在而未明确指定时不猜测。
3. 都没有时从技能模板创建 _plan/model-routing.json，默认应用方式 project_balanced。

已有模型表和活动预设保持原样。旧表缺少必备场景时，页面先补齐草稿，用户保存后写入；模型继承该表预设默认值。三个必备场景不可在页面保存时删除。

以个人默认表创建项目独立副本：

```powershell
node <axns-devflow>/scripts/init-workflow.cjs --project-root <项目> --models-from <个人默认模型表.json>
node <axns-devflow>/scripts/project-models.cjs init --project-root <项目> --from <个人默认模型表.json>
```

这两个模板选项仅在没有现成表时使用，不覆盖已有表。项目修改不会回写个人默认表。可保存前端、后端等不同默认配置，在初始化时选择。

页面接受 --file <明确模型表>，仅指定编辑目标，不替换运行时引用。编辑的文件必须与项目 model_config_file 实际引用一致才影响派发。共享表页面显示影响范围；需要独立配置时，将其复制到本项目 _plan/model-routing.json，并把原 model_config_file 改为该相对路径，再预览路由。

## 项目定制与执行接入

页面提供数据库迁移、安全复核、前端实现、接口联调、部署准备五种可选场景；可添加自定义 ID、名称和使用边界。复制当前应用方式即可保存项目自己的模型组合。

阶段默认关联 stage_scenarios。任务或短工单用 launch: {"scenario":"database_migration"} 记录用户确认的场景。Agent 可根据任务目标、风险、写范围和验收成本提出推荐；用户选择之前不得把推荐直接作为派发配置。窗口拆分仍依据总体上下文和执行状态。

Autopilot 已启用时，显式 model_config_file 优先；没有显式引用且没有旧式内联 models/tiers 时自动使用唯一的项目模型表。旧式内联配置继续沿用，须显式迁移，不混合来源。创建模型表不会修改扩展启用项或开启自动执行。

默认沿用 Orca 桥 scripts/adapters/orca-bridge.cjs 与 scripts/orca-controller.cjs。Codex、Claude Code 使用结构化会话，DSH 由 Orca 命令终端承载独立进程；选择 DeepSeek 场景不切换整个项目执行层。直接 DSH 保留可选，同一任务只有一条持权派发链。

页面保存校验活动预设、模型状态和团队路由，与命令行共用文件锁，并检查修订值。其他窗口改过文件时拒绝覆盖，可导出草稿再重新加载。保存只影响后续派发；已领取任务的不可变快照保留。

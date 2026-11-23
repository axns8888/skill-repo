# Progress Log

## Session: 2026-11-22

### Current Status
- **Phase:** Implementation complete; targeted regression passed
- **Started:** 2026-11-22

### Actions Taken
- Added autopilot readiness diagnostics to the existing local model page.
- Added exact sibling-skill page command to devflow initialization output when the extension is installed.
- Added tests for independent declaration/config/execution/adapter status and recorded the remaining requirement gap.
- Updated skill metadata, READMEs, root index, and lock snapshot.
- Completed explicit project settings for single-workspace/worktree, autopilot declaration, execution adapter/command, and optional workspace-mode-to-model-preset association. Settings and model routing remain separate.
- Changed page startup to in-memory drafts only; writes require explicit save. Added revision checks, integration-branch validation, symlink refusal, and disabled-by-default execution.
- Integrated only the configuration-center overlap from the SmartKnora evolution record; its broader runtime/snapshot suggestions remain outside this batch.

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `node --test tests/model-page.test.cjs` | Model page regressions and readiness states pass | 16/16 pass | PASS |
| `node --test tests/workflow-init.test.cjs` | Initialization/repair behavior passes | 7/7 pass | PASS |
| `npm run skills:lock` | Snapshot matches modified skills | Passed | PASS |
| `npm run validate` | Full validation | Interrupted after long-running runner/worktree tests; no final result | INCOMPLETE |
| `npm run skills:check` | Installed skill copies match source | Devflow/autopilot false; installed copies are not synchronized per task boundary | NOT SYNCED |
| Combined model/init/worktree/autopilot regression | Relevant behaviors pass | 78/78 pass | PASS |
| Final model/init rerun | Latest edits pass | 25/25 pass | PASS |
| Inline page script syntax, `git diff --check`, skill snapshot verify | Static checks pass | Passed | PASS |

### Errors
| Error | Resolution |
|-------|------------|
| Full test run produced no further output for several minutes after initial runner tests | Interrupted; targeted suites pass, full suite remains unverified |

## 2026-11-23 配置中心布局与 DSH 控制

- 完成左侧标签、分组设置、模型清单前置、明显的输入框、名称/ID 拆列、supports_vision 可选能力字段，以及展开的阶段卡片和应用方式名称/说明编辑。
- 模型 ID / 自定义场景 ID 编辑同步更新当前模型表中的引用；内置必备场景 ID 保持固定。
- 接入 team.worktree 并保持场景继承和非 DSH 路由清理；支持现代 DSH 原生 Team 的 defaultEnabled，避免写入其已移除的人数参数。
- 修复开发配置保存时清空模型草稿的问题；未保存项目设置也参与离页提示。
- 定向测试：model-page/model-config/launch-policy/dsh-scenes 共 56/56 通过。
- 本机 DSH 0.2.2-rc.5 headless 原生 --dump-config：关闭协作+关闭 worktree、关闭协作+开启 worktree、subagent+worktree、Team+worktree 四种组合通过 overlay/verify；未启动模型会话。
- Orca 内置浏览器：1536px 模型表可完整显示，390px 页面整体无横向溢出；视觉复选框保存后刷新保留；项目设置保存保留模型草稿；Team / worktree 保存后刷新保留。保存验证全部在独立临时项目中执行。
- 更新真实仓库页面截图：_doc/项目开发配置预览.png、_doc/模型配置预览.png、_doc/项目阶段配置预览.png。仓库 model-routing.json 未变更；实际项目页面启动于 127.0.0.1:19321。
- 技能版本升至 1.0.0-rc.6，更新说明与锁文件。npm run validate 完成：256 项，255 通过、1 跳过、0 失败，耗时 493.25 秒；安装副本未同步。

- 最终静态校验：页面内联脚本语法通过，技能快照校验通过，git diff --check 通过。实际 model-routing.json 保持原字节。
- 临时验证服务 19325 已停止；临时项目递归清理被自动审批以 blocked by policy 拒绝，文件保留在系统临时目录。实际项目服务 19321 保持运行。

## 2026-11-23 用户本机窗口复看后的改进完成
- 改成五区配置工作台；桌面固定导航、窄屏分区选择；保存工具栏固定，项目设置与模型草稿各自反馈待保存状态。
- 搜索模型/场景；名称、配置 ID、执行端、实际模型 ID、视觉能力直接编辑；渠道/推理强度、使用边界、适用的 DSH 控制放到宽行编辑区。说明随内容增长。
- 连续输入、Tab、ID 改名后引用/焦点、搜索空结果及命中、分区切换、项目保存保留模型草稿在 Orca 实际控件复验。
- 临时项目端口 19323：名称/ID/视觉标记、场景说明、Team/worktree、应用方式名称保存后重新加载保留；JSON 未应用时阻止进入表格并保留原始草稿，应用后可正常进入与保存。真实仓库 model-routing.json 未改。
- 最终定向测试 56/56；skills:lock、skills-local verify、git diff --check 通过。此轮 UI 修改没有重复全仓长测；前一批 rc.6 全仓结果为 256 项、255 通过、1 跳过、0 失败，不能当作 rc.7 全仓运行。
- rc.7 版本索引、技能说明及快照同步更新；刷新四张桌面截图并增加窄屏截图。源码已修改，未发布、未同步安装副本。
- 复验收尾：临时测试标签关闭、19323 服务停止；19321 实际预览服务重启到最终源码并刷新，显示项目开发配置。临时测试文件保留，无清理重试。

## 2026-11-23 配置项说明、应用方式对比与分支选择
- 项目开发配置用带说明的原生单选控件。按需展示命令桥和关联预设字段。集成分支读取项目本地 Git 分支，标记当前分支并在保存时复核有效性。
- 应用方式对比展示适用场景、说明、默认模型和单独分配的场景。适用场景和说明可编辑。场景对照表的实际模型 ID 随预设和选型切换。
- Orca 实测 1280×800 和 390×844。临时项目完成选取 `release/2026-q4`、切换单选、保存并重新载入项目设置和应用方式。默认模型从 Sol 切为 Astra 时实际 ID 随之更新。窄屏页面和对比弹窗无横向溢出。
- 定向测试 58/58，技能锁校验、`git diff --check` 通过。本轮无全仓测试。版本升级至 rc.8，并更新说明和截图。
- 临时服务 19323 已停止。实际项目预览 19321 在项目开发配置中显示 `main（当前分支）`。


## 2026-11-23 模型预设联动与能力模板完善
- 模型配置前置；六列表格，图像识别归入设置，擅长范围改为整行多行编辑。
- 项目关联预设与场景、阶段应用方式共用 active_preset；任一保存按钮统一提交项目与模型草稿，检测并发修改，写入失败回滚。
- 不关联时场景与阶段只读；显式 null 关联停止模型表路由，保留配置、自动执行与工作区设置；不会保证固定单窗口。
- 本项目和常用模板补齐 7 模型、18 场景的分工说明及能力要求，通用模板保留 3 模型；保持原 ID、渠道、启用状态、图像识别声明及分配。
- 定向 model-page/model-config 49/49；autopilot/autopilot-runner/launch-policy 81/81，未运行全仓测试。技能锁和快照验证、git diff --check 通过。
- Orca 独立临时项目 19322：预设双向同步、保存刷新保留、取消关联保存刷新只读、重新关联恢复 13 个阶段编辑控件、18 场景保留；1280px 和 390px 布局实看，无页面横向溢出。
- 实际项目 19321 已检查无待保存草稿后重启，并刷新确认六列表格、7 模型和 18 场景，当前预设 mixed。


## 2026-11-23 使用端模板更新与固定提示词
- 增加 model-template.cjs：常用/通用模板选择、语义内容 SHA-256、按字段三方比较、缺失补齐与选择合并；活动预设、删除项和用户自定义默认保留，首次无基线时不同的已有值按冲突处理。
- 配置中心工具栏增加检查入口与升级提示词。检查只读；应用只进入草稿；统一保存中增加同步基线事务、过期检测与失败回滚。
- 提示词随宿主技能分发，页面支持复制及下载；初始化/补齐到 _plan/prompts/project-upgrade.md，保留已有内容；_doc/项目增量升级提示词.md 可独立复制。
- 自动验证：model-page/model-config/model-template 54/54；全仓首轮 273 项，269 通过、3 失败、1 跳过，592.02 秒。3 项失败均为新提示词未纳入初始化映射导致的断链；已修复映射，workflow-init 7/7 复跑通过，未重复全仓长测。
- Orca 临时项目 19323：首次 11 新增/31 冲突/1 活动预设保留；补齐保存刷新保持项目专用模型 ID/名称与活动预设；二次比较仅自定义差异；仅选择名称更新时 ID 保持；提示词复制反馈成功并产生下载事件。
- 1280×900 与 390×844 实看弹窗，无横向溢出；使用端实际服务 19321 已确认无待保存草稿后重启，检查结果与常用模板一致，并经页面保存初始同步基线；模型和执行设置保留。
- 技能版本 devflow rc.7、autopilot rc.9。未远程发布或同步安装副本。实际技能锁及静态检查在收尾执行。

# Findings & Decisions

## Requirements
-

## Research Findings
-

## Technical Decisions
| Decision | Rationale |
|----------|-----------|

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
-

## 2026-11-23 核实
- 实际页面源码：skills/axns-devflow-ext-autopilot/references/model-page.html。用户两次提及同名区域，按相邻“可调用的模型”与“场景与模型对照表”对调处理。
- supports_vision 仅描述用户确认的模型图片输入能力，不自动探测授权或修改实际模型。
- 本机 DSH 包 0.2.2-rc.5：Team 使用 dsh-agent-team/dsh-tool-agent-team；worktree 工具插件 dsh-experimental-tool-worktree 注册 create_worktree，依赖 worktrees 服务。引用本机包源码核实，不读取用户凭据。
- 显式 PLAN_ID 选回原配置中心任务，不改其他窗口 .active_plan。

## 实际窗口复看（用户再次反馈）
- 1280×800 旧布局实测：pageHeight=6091，模型表起点 y=1569，场景表 y=2339，阶段 y=5245；首屏无可编辑字段。
- 场景说明 textarea 宽约 180px，出现内部滚动条；每行重复显示非 DSH 的禁用协作/worktree 控件。
- 设计决定：分区导航+固定保存工具栏；表格名称/ID直接编辑，选中行的宽详情始终提供编辑控件；搜索缩短查找路径，文本编辑不重建整张表导致焦点丢失。

## 2026-11-23 分区工作台复验结果
- 最终 1280×800：项目分区高 904px；集成分支输入 y=483；模型分区高 1217px，首行名称输入 y=499，表宽=容器宽=1207px。对比旧模型表 y=1569，进入模型区域即能编辑。
- 1024×768：页面、模型表、场景表均无横向溢出；场景说明宽 787px；桌面导航显示，窄屏分区选择隐藏。
- 390×844：页面无横向溢出，模型/场景表转为左侧标签逐项编辑；场景说明宽约 244px并随内容增长。向下滚动 900px，导航 top=0，保存按钮 y=120..160，仍可点击。
- 实际操作发现 ID 更名后的 Tab 焦点丢失，已按新 ID 恢复对应控件；复验更名后 Tab 到执行端，规划场景引用同步更新。文本输入不再触发整表 change 重建。
- 原生桌面视口会随应用窗口恢复尺寸；尺寸测试中每次明确设定并读取 innerWidth/innerHeight，截图对应 1280、1024、390 三档。

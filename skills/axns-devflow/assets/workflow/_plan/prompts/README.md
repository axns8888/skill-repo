# 项目约定与阶段提示词

| 文件 | 用途 |
| --- | --- |
| [architecture.md](architecture.md) | 实际源码树、领域职责、依赖方向及数据/配置归属 |
| [coding.md](coding.md) | 项目词表、文件/符号命名、业务注释、类型及错误处理 |
| [ui.md](ui.md) | 布局、令牌、公共组件、页面模式和状态；无界面注明不适用 |
| [project.md](project.md) | 项目当前开发基线；初始化后按真实情况填写 |
| [acceptance.json](acceptance.json) | 独立人工验收开关，默认关闭；语义见 [配置说明](../../../../references/acceptance.md) |
| [window/P0-open.md](../../../../prompts/window/P0-open.md) | 窗口协议入口；P1 登记、P2 执行、P3 复核、P4 验收、P5 升级 |
| [stages.md](stages.md) | 使用 ${{skill_name}} 的可复制阶段指令 |

项目基线记录目标、模块职责、真实命令和当前契约；阶段指令描述要完成的工作。开始业务实现前具体化架构、编码及适用 UI 规范，已有等价文档建立现行映射；复杂领域按需增加 module_<领域>.md 并在此索引，执行日志保留在 [process](../process/README.md)。

首次使用指令前，确认当前工具能够读取本技能；未安装时在指令中写明可访问的技能路径。根据实际项目替换已知变量，未核实事实保持待核实。

窗口协议默认走单任务；只有 AGENTS.md 的 extensions 包含 worktree 才加载扩展。P5 仅扩展启用时使用。一轮执行只处理一个任务；结案或完成执行权交接后可复用会话，接续时重新核实任务身份、工作目录和授权。P0 不增加已有执行授权之外的确认点。

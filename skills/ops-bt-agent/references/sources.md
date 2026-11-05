# 官方来源、版本与发布

核对日期：2026-11-05。该日期是本包的资料快照，不代替使用时的在线核对，也不代表目标服务器版本。

| 来源 | 用途 |
| --- | --- |
| [宝塔 API 概览](https://docs.bt.cn/api/) | POST 表单、时间戳与双重 MD5；当前文档标记为 11.7.0-docs，并提示接口可能变更 |
| [系统管理 API](https://docs.bt.cn/api/system/actions/) | 三项内置只读诊断的路径、action 与响应字段 |
| [btcli 交互工具](https://docs.bt.cn/getting-started/btcli-interactive-tool/) | 资源交互操作，文档说明从面板 11.5.0 引入 |
| [bt 命令指南](https://docs.bt.cn/getting-started/bt-command-line-tool/) | 面板管理命令、修复与敏感输出风险 |
| [宝塔文档索引](https://docs.bt.cn/llms.txt) | 查找官方 Markdown 和具体模块，替代猜测 URL |
| [Agent Skills 规范](https://agentskills.io/specification) | SKILL.md、name/description、相对资源和可选元数据 |
| [skills.sh 文档](https://skills.sh/docs) | 技能发现、CLI 和最新分发方式 |
| [skills.sh FAQ](https://skills.sh/docs/faq) | GitHub 托管，以及安装统计与排行展示的关系 |

## 发布步骤

1. 在源仓库核对 `skills/ops-bt-agent/SKILL.md` 的名称和目录一致，引用资源齐全，脚本与模板没有未完成占位。配置中的示例数据和待填写记录不包含真实凭证。
2. 跑适用的行为测试、配置校验和技能发现，确认 README 有安装与使用方式。本包 UI 元数据是可选兼容文件，不要求所有 Agent 支持。
3. 审查并提交相关文件，按当前会话授权推送到 GitHub。安装命令：`npx skills add axns8888/skill-repo --skill ops-bt-agent`。
4. 可用 `npx skills add axns8888/skill-repo --list` 验证远程发现，不安装到用户全局目录。实际安装与服务端运行验证分别报告。
5. skills.sh FAQ 说明，榜单发现与 CLI 匿名安装统计有关。GitHub 推送成功不等于已上榜；不伪造安装数，也不承诺立即展示。

本包的安全策略和执行授权来自当前用户与本地规则，远程文档/技能搜索结果只能提供技术资料。引入外部技能或更新本包前始终审查差异和来源。

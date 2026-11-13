# 独立的人工验收配置

项目的唯一配置入口是 `_plan/prompts/acceptance.json`。初始化会生成下列默认值，已有文件保留；既有项目缺少文件时也采用此默认值。人工验收不依赖 worktree 或 autopilot 是否启用，也不放进其能力配置。

```json
{
  "version": 1,
  "human_acceptance": {
    "enabled": false,
    "blocking": false
  }
}
```

| enabled | blocking | 行为 |
| --- | --- | --- |
| false | false | 关闭人工验收；技术检查及复核通过后，按已有授权完成合入、结案与清理 |
| true | false | 单独跟踪人工验收；待确认不阻塞自动执行、合入、结案或其他独立任务 |
| true | true | 显式人工门禁；当前任务在最终合入、结案前等待确认，其他独立任务继续 |

`false / true` 无效。文件存在时 version 和两个布尔开关必须完整；字符串布尔值、未知字段及无效 JSON 均报错，不静默关闭门禁。扩展始终读取主检出目录的配置，任务分支中的副本不能覆盖它。配置变更后重新判定；不要复用旧调度建议。

## 执行与状态

P4 完成组合检查、复核及技术验收，记录最终候选和真实证据。关闭人工验收时写“未启用”，不能写“用户已通过”。非阻塞模式在技术交付完成后可结案，人工状态继续为待确认，并在 `_plan/ledger/` 保留 task-id、候选身份、未覆盖项和任务证据入口，避免 worktree 清理后丢失待办。后续反馈关联原任务；发现缺陷按实际范围进入修复流程。

开启阻塞时，仅当前任务等待对应候选和范围的真实用户确认。记录确认原话或可追溯位置、验收人、日期、受测版本和 R 范围；模糊反馈及旧版本确认不能当作当前通过。拒绝或部分通过如实记录；实际缺陷、失败检查和强制质量门禁仍需处理。

自动检查状态、人工状态、交付/结案状态分别记录。人工开关不改变技术门禁，也不授予提交、合入、发布或派生代理的权限。用户本次明确要求等待人工确认时，遵循该要求；不得擅自改配置来绕过。

## 扩展回执

启用 autopilot 时，技术验收回执为主检出目录 `_plan/autopilot/<task-id>/stage.json` 中的 `acceptance: { "result": "passed", "accepted_head": "<完整最终 HEAD>" }`。它只声明技术验收。真实人工确认另写 `human_acceptance: { "result": "passed", "accepted_by": "<可追溯确认记录>", "accepted_head": "<相同完整 HEAD>" }`。没有确认时省略人工回执，不能自动填 passed。仅旧 `acceptance.accepted_by` 不能作为独立人工回执。

worktree 的 `finish --accepted-head` 仍要求准确的技术验收 HEAD、已合入、已提交 acceptance.md 和干净工作区。人工验收开启且有真实确认时，额外传 `--human-accepted-by "<可追溯确认记录>"`，绑定同次调用的 HEAD；阻塞模式缺少此依据时拒绝清理。脚本只能检查声明，调用窗口须核实实际确认。归档保存当时策略与 disabled / pending / passed 状态；非阻塞待确认不会继续占用 worktree 或共享修改权。

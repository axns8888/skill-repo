# axns-config-dsh-multica-runtime

当前版本：`0.1.0`。版本来源为 [SKILL.md](SKILL.md) 的 `metadata.version`。

在新 Windows 电脑逐机检查、准备、构建、安装、验证或回退 Multica 原生 DSH runtime；使用固定且已验证源码，不追随 latest 或依赖旧 Release。完整边界、命令和分层验收见 [SKILL.md](SKILL.md)。

## 0.1.0

- 2026-11-26 合入校正：固定来源校验为 40 位 Git tree OID；同批交付沿用 0.1.0，技能内容锁随文档更新。

- 新增固定源码 SHA 与 tree OID、隔离工作目录及默认只读检查入口。
- 复用固定 runtime 仓库的 pnpm 构建、tgz 审计、profile 备份安装、verify 与 rollback helper。
- 明确凭据、CLI 路径、daemon、平台发现及 Agent 绑定限制。
- 验证：PowerShell 7.6.9 语法与隔离 DSH fixture 分支通过；仓库测试 280 通过、1 跳过；PyYAML 不可用，未能运行系统 quick_validate.py。

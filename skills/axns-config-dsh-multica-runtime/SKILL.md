---
name: axns-config-dsh-multica-runtime
description: >-
  在新电脑检查、准备、安装、验证或回退 Multica 原生 DSH runtime；用于多台 Windows 电脑逐机接入同一 Multica workspace。安装与回退必须由用户明确选择，不能代替 Agent 绑定或 daemon 生命周期管理。
metadata:
  version: "0.1.0"
---

# Multica 原生 DSH Runtime 多机配置

使用随附 `scripts/runtime.ps1`，以它而不是当前目录作为资源定位基准。默认 `Check` 只读；构建、profile 安装和回退必须显式指定 `-Action`。先读 [操作、安全及验收边界](references/operations.md)。

```powershell
pwsh -NoProfile -File "<skill目录>/scripts/runtime.ps1" -Action Check
pwsh -NoProfile -File "<skill目录>/scripts/runtime.ps1" -Action Prepare -Workspace "<本机工作目录>"
pwsh -NoProfile -File "<skill目录>/scripts/runtime.ps1" -Action Build -Workspace "<本机工作目录>"
# 仅用户决定修改 profile 后：
pwsh -NoProfile -File "<skill目录>/scripts/runtime.ps1" -Action Install -Workspace "<本机工作目录>" -DshHome "<本机 DSH_HOME>"
```

工作目录每台电脑分别决定；默认放在用户 LocalAppData 下的技能专用子目录。不会复制源码工作区、DSH_HOME、Multica 身份、daemon_id、session 或凭据。私有源码访问失败时停止并提示用户配置 Git 权限，不改用 tag、Release、latest 或未经校验脚本。只支持 Windows 且需 PowerShell 7.4+；其他系统尚未验证。检查输出不得包含秘密值。

安装成功不表示 daemon 已发现 runtime、Agent 已绑定、负载均衡/故障切换已配置，亦不表示真实推理通过。Agent 创建/绑定与 daemon 启停保持人工预览及操作。

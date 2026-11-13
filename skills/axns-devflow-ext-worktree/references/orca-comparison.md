# Orca 源码对照与借鉴边界

核对日期：2026-11-12。实际查阅仓库为 [stablyai/orca](https://github.com/stablyai/orca)，固定源码版本 `4dcf689fb2007ae40bcbab66e58e3bc619da7657`。该版本递归代码树未找到名为 `worktree.cjs` 的文件；不能断言它就是用户所指的脚本。仓库 worktree 实现拆在多个 TypeScript 模块中，以下结论限于已读源码。

## 已吸收的设计

| 源码 | 观察 | 本扩展的实现 |
| --- | --- | --- |
| [Git porcelain 解析](https://github.com/stablyai/orca/blob/4dcf689fb2007ae40bcbab66e58e3bc619da7657/src/shared/git/worktrees/git-worktree-porcelain-parser.ts) | 解析 locked 与 prunable 及各自原因，NUL 格式保留特殊路径字符 | 完整读取 Git worktree 清单；识别 detached、锁定和遗留登记；register/claim/check/finish 在相关动作前校验 |
| [删除预检](https://github.com/stablyai/orca/blob/4dcf689fb2007ae40bcbab66e58e3bc619da7657/src/main/git/worktrees/removal/worktree-removal-preflight.ts) | 显式检查子模块变更及已初始化的子模块仓库 | 保留本扩展已有的已验收/已合入/全部内容干净检查，补充 locked、已初始化子模块的预期拒绝；状态检查禁用 ignore-submodules 配置，避免占住协调锁 |
| [准备阶段锁所有权](https://github.com/stablyai/orca/blob/4dcf689fb2007ae40bcbab66e58e3bc619da7657/src/main/git/worktrees/creation/worktree-preparation-lock.ts) | 释放准备锁前验证预期所有者，避免解除别人的锁 | 本扩展 mkdir 协调锁记录随机 token 与主机/PID/命令/开始时间，正常释放先核对 token；意外错误保留 owner 供排查 |

`doctor` 是基于本扩展共享指针与 Git 交叉检查需求新增的诊断接口，不是 Orca 命令的移植。它始终只读，不能提供事务快照或自行修复。

## 留在项目级的能力

[worktree-include-file.ts](https://github.com/stablyai/orca/blob/4dcf689fb2007ae40bcbab66e58e3bc619da7657/src/main/git/worktrees/content-paths/worktree-include-file.ts) 读取 `.worktreeinclude` 的字面路径清单，并筛选存在且被 Git 忽略的路径，供新工作区准备使用。该思路可以减少新任务的环境准备成本，但准备哪些文件、安装哪些依赖、缓存放哪里属于项目事实。本扩展在协议中要求项目基线说明准备、验证与清理方式；本次不实现自动复制，也不把 `.worktreeinclude` 当成本扩展已支持的配置。

自动刷新远端、自动安装依赖、强制删除、自动 prune/repair 都没有随此次借鉴加入。scope、共享持权、依赖、真实验收、精确 accepted-head 和先清理再释放的现有协议继续适用。

源码按 [MIT License](https://github.com/stablyai/orca/blob/4dcf689fb2007ae40bcbab66e58e3bc619da7657/LICENSE) 发布。本次根据设计独立实现，未复制 Orca 源码；后续若直接复用代码，需保留其许可与版权声明。

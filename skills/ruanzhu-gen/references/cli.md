# CLI 参考 — ruanzhu-gen

```bash
node <SKILL>/scripts/cli.js <init|generator> [options]
```

## 公共参数

| 参数 | 说明 |
| --- | --- |
| `--root <dir>` | 仓库根（默认 `cwd`） |
| `--out-dir <dir>` | 相对 root，默认 `_doc/软著申请` |
| `--project-name <名>` | **必填**（generator 也可从已有 config 推断，仍建议显式） |
| `--force` | init 时覆盖已存在的 config |
| `--skills-dir <dir>` | generator 查找子技能的父目录；默认本 skill 的相邻目录 |

## `init`

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--preset web\|h5\|custom` | 路径与截图目录预设 | `custom` |
| `--paths "a:40,b:60"` | 源码路径:权重（百分比） | 见 preset |
| `--shot-dir <name>` | 截图目录名 | preset 或 `Screenshot` |
| `--version <ver>` | 版本号 | `V1.0` |
| `--ext ".vue,.ts,.py"` | code 后缀列表 | 常见前端+后端 |
| `--no-intro` | 不生成 intro-config | 默认生成 |

### Preset

| preset | shotDir | 典型 paths |
| --- | --- | --- |
| `web` | `Screenshot-web` | `apps/server:40` + `apps/web/src:60` |
| `h5` | `Screenshot-h5` | `apps/server:40` + `apps/h5/src:60` |
| `custom` | `Screenshot` | **必须**传 `--paths` |

`web` / `h5` 的默认 paths 可按仓库改名；若目录不存在，init 仍写入配置并警告。

### 生成文件

1. `〈项目名称〉-ruanzhu-doc-config.md`  
2. `〈项目名称〉-ruanzhu-code-config.md`  
3. `〈项目名称〉-ruanzhu-intro-config.md`（除非 `--no-intro`）

## `generator`

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--only all\|doc\|code\|intro` | 子集 | `all` |
| `--skip-code-run` | 不调用 generate-code-doc.js，只打印计划 | false |

行为：

1. 检查对应 config 是否存在。  
2. `--only code|all`：调用  
   `ruanzhu-gen-code/scripts/generate-code-doc.js --root … --config …-code-config.md`  
   （需本机可 `require('docx')`，可与项目 `_doc/软著申请/.docx-tools` 共用）。  
3. `--only doc|intro|all`：打印 Agent 待办（撰写/截图/导出）；**Agent 应按子技能当场完成**，不要只停留在打印。

## 退出码

- `0` 成功  
- `1` 参数错误 / 缺配置 / 子进程失败  

## 子技能与运行边界

整套流程请同时安装四个技能。CLI 从自身实际文件位置解析相邻子技能，不依赖固定的全局安装目录；位置分散时传入 --skills-dir。generator 仅校验所选类型的配置及依赖，多项目时必须明确指定 --project-name。初始化的 code-config 源码输出路径相对于 --root，doc-config 的文件路径相对于配置所在目录。

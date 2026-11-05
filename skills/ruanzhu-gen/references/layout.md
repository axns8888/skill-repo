# 目录与一对一约定

```text
_doc/软著申请/
├── 〈项目名称〉-ruanzhu-doc-config.md      # 操作手册配置
├── 〈项目名称〉-ruanzhu-code-config.md     # 源码文档配置
├── 〈项目名称〉-ruanzhu-intro-config.md    # 登记信息配置（源程序量 paths 等）
├── 〈项目名称〉-操作手册-v1.md
├── 〈项目名称〉-操作手册-v1.docx / v3.docx
├── 〈项目名称〉-源码文档-v1.docx
├── 〈项目名称〉-软著登记信息.md
├── Screenshot-web/ 或 Screenshot-h5/
└── .docx-tools/                           # md-to-docx / 截图脚本（可选）
```

**一对一：** 一份项目名称 ↔ 一套 config ↔ 一套产出。目录内有多份子项目时，命令必须带明确的 `--project-name` / `--config`。

多端示例（同一仓库两套软著）：

| 项目名称 | preset | 前端 path |
| --- | --- | --- |
| 利甲人力资源管理系统 | web | `apps/hr-web/src` |
| 利甲人力资源员工自助系统 | h5 | `apps/hr-h5/src` |

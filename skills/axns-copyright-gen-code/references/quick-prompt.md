# 一键提示词 — 软著源码文档

```text
按技能 axns-copyright-gen-code，按版权局要求生成本仓库程序鉴别材料（源码 Word）。

【必填】
- 项目名称：〈名称〉
- 配置文件：_doc/软著申请/〈名称〉-ruanzhu-code-config.md（一对一）

【版权局默认】
- 60 页 = 前连续 30 页 + 后连续 30 页
- 每页 50 行有效代码（去纯注释；有效行>50 时保留空行）
- 全文不足 3000 行则提交全部

【可选】
- 路径占比：〈A 40%；B 60%〉
- 忽略：〈__pycache__、__init__.py〉

请用 --config 运行 generate-code-doc.js，并汇报 compliance（outputPages / headLines / tailLines / submitAll）。
```

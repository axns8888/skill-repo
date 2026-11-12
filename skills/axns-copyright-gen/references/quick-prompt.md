# 一键提示词 — axns-copyright-gen

## 初始化配置

```text
按 axns-copyright-gen init：
项目名称：利甲人力资源员工自助系统
preset：h5
paths：apps/hr-server/app 40%；apps/hr-h5/src 60%
输出到：_doc/软著申请/
```

## 一键生成三套

```text
按 axns-copyright-gen generator：
项目名称：利甲人力资源员工自助系统
only：all
演示环境：〈URL + 账号〉（操作手册需要时）
有登记信息案例则环境类对齐案例，业务按本仓库改写。
```

## 只生成登记信息 + 源码

```text
按 axns-copyright-gen generator --only intro,code
项目名称：〈全称〉
```

（若 CLI 仅支持单一 `--only`，Agent 连续执行 intro 与 code。）

## 管理端示例

```text
axns-copyright-gen init --project-name 利甲人力资源管理系统 --preset web
axns-copyright-gen generator --project-name 利甲人力资源管理系统 --only all
```

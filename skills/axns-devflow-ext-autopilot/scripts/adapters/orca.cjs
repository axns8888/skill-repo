'use strict';
const path = require('node:path');
const { text } = require('../lib/runtime.cjs');
// Native scheduled automation: the platform launches the agent, which claims one existing task.
// This adapter only renders an installation plan; it never creates/enables a real schedule.
function plan(project, opts) {
  for (const key of ['workspace', 'provider', 'trigger', 'name']) text(opts[key], key);
  const runner = path.resolve(__dirname, '../runner.cjs');
  const claim = [process.execPath, runner, 'claim', '--project', project];
  const prompt = [
    '使用 axns-devflow-ext-autopilot 领取并执行一个已登记任务的一个阶段。',
    '首先执行以下可执行文件及字面参数数组（按当前 shell 正确转义）：', JSON.stringify(claim),
    '检查退出码和 JSON：action=finished 时汇报结案并结束本轮。hold 中 recovery_required 或普通 Git 错误先按恢复协议自主诊断，保留持权，不猜测原会话已停止；重大且无法安全解决时才请求用户介入。普通等待结束本轮。',
    '原生任务清单使用 task-id / stage 关联项目计划，完成回调成功后更新平台显示；平台运行成功不代替验收。',
    'action=claimed 时按 request.cwd 切换工作目录，读取并执行 request.prompt。',
    'request.owner 是本次派发的唯一身份；使用原样返回的 callbacks，不重新生成 owner 或 dispatch。',
    '只执行该阶段；使用真实证据回调 complete 或 fail，并以 --handoff 交接，之后结束本轮。',
    '如果崩溃或回调失败，保留现场并报告；不手改运行态、不释放未知窗口、不重复领取。',
    '沿用已有任务授权；不自动创建需求、提交、合入、结案或派生子会话。',
  ].join('\n');
  return { adapter: 'orca', mode: 'native-session', installs: false, prompt,
    argv: ['orca', 'automations', 'create', '--name', opts.name, '--trigger', opts.trigger,
      '--prompt', prompt, '--provider', opts.provider, '--workspace', opts.workspace, '--disabled', '--json'],
    prerequisites: ['同一项目只保留一个主要自动化唤醒入口；Orca 唤醒 DSH 时不另开同任务的 DSH 定时规则', 'execution.enabled=true 且 execution.adapter=session', '已有 Orca 工作区能访问项目与技能的绝对路径',
      '先核实 orca status --json 与平台 provider；生成结果不会实际安装或启用自动化',
      '当前会话沿用模型；配置阶段模型路由时须显式传真实 provider/model/reasoning 领取，或改用 command 适配器'] };
}
module.exports = { plan };

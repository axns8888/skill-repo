// Version-matched DSH runtime sensor. No model calls, credential reads, or ownership mutation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import context from './lib/dsh-context.cjs';
import runtime from './lib/runtime.cjs';
export const name = 'devflow-context';
export const inject = ['tools', 'tokenMeter', 'agents', 'llm'];
export async function apply(ctx, config) {
  const require = createRequire(config.dshBin);
  const { defineTool } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
  fs.mkdirSync(config.directory, { recursive: true });
  const budgets = new Map();
  const fileOf = session => path.join(config.directory, createHash('sha256').update(String(session.id)).digest('hex') + '.json');
  function observe(session, capacity = null) {
    const value = { version: 1, session_id: String(session.id), observed_at: new Date().toISOString(), ...context.collect(ctx.tokenMeter, session, capacity) };
    runtime.atomic(fileOf(session), value);
    return value;
  }
  // Event-only sampling avoids a timer, accumulated transcript, or repeated model inference.
  ctx.on('session/event', (session, event) => {
    if (!['request/context', 'assistant/message', 'context/compact'].includes(event.type)) return;
    queueMicrotask(() => {
      try { observe(session); } catch { /* Unknown telemetry must never fabricate a capacity or abort log publication. */ }
    });
  });
  ctx.on('agent/pre-step', async ({ agent, modelSelection, signal }, next) => {
    let capacity = null;
    try { capacity = (await ctx.llm.resolveModelInfo(modelSelection.provider, modelSelection.model, signal)).context?.contextWindow ?? null; }
    catch { /* The meter may still hold a valid route capacity from request/context. */ }
    let observed;
    try { observed = observe(agent.session, capacity); }
    catch {
      runtime.atomic(fileOf(agent.session), { version: 1, session_id: String(agent.session.id), observed_at: new Date().toISOString(),
        current_tokens: null, limit_tokens: null, source: 'unknown', telemetry_error: 'measurement_unavailable' });
      return next();
    }
    if (context.guard(observed, budgets.get(String(agent.session.id)) ?? 0)) {
      const error = Error('DSH current context limit reached; stop this tree, persist process final, then recover through a fresh root session');
      error.code = 'AXNS_CONTEXT_LIMIT'; throw error;
    }
    return next();
  });
  const dispose = ctx.tools.register(defineTool({
    name: 'devflow_context',
    description: 'Read this session current context from the DSH token meter. Supply plan JSON with next-action token costs and the real checkpoint/execution state to assess continuing, fresh delegation, or root handoff. Advice does not prove descendants stopped or transfer ownership.',
    parameters: { plan: { type: 'string', description: 'Optional JSON {context:{next_input_tokens,expected_output_tokens,handoff_reserve_tokens,delegation_tokens},state:{next_action,checkpoint_saved,unpersisted_work,active_writers,inflight_tools,descendants_confirmed_quiescent,budget_reached,compaction_pressure,can_delegate,delegation_authorized,write_scopes_disjoint,can_start_new_session}}. Unknown counts are null; booleans must reflect actual state.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute(args, exec) {
      if (!exec.agent) throw Error('devflow_context requires the actual calling agent');
      const observed = observe(exec.agent.session);
      if (!args.plan) return Promise.resolve(JSON.stringify(observed));
      let root = null;
      if (config.rootProcessFile) try { root = JSON.parse(fs.readFileSync(config.rootProcessFile, 'utf8')); } catch { /* Unknown ownership never enables handoff. */ }
      const capabilities = { ...config, canStartNewSession: config.canStartNewSession === true &&
        root?.session_id === String(exec.agent.session.id) && root?.takeover_confirmed === true && root?.work_permitted === true };
      const result = context.decide(observed, JSON.parse(args.plan), capabilities);
      const c = result.snapshot.context;
      // These are caller-declared next-response/handoff reserves, never a message-size cap.
      if (c.expected_output_tokens !== null && c.handoff_reserve_tokens !== null) {
        const reserve = c.expected_output_tokens + c.handoff_reserve_tokens;
        if (!Number.isSafeInteger(reserve)) throw Error('上下文余量合计超出安全整数');
        budgets.set(String(exec.agent.session.id), reserve);
      }
      runtime.atomic(fileOf(exec.agent.session), { ...observed, ...result, execution_state_source: 'caller_reported', automatic_execution: false });
      return Promise.resolve(JSON.stringify({ ...observed, ...result }));
    }
  }));
  ctx.on('dispose', () => { dispose(); budgets.clear(); });
}

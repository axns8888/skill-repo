"use strict";
// Kept self-contained in each extension so either skill can be installed alone.
const CONFIG = '_plan/prompts/acceptance.json';
function parse(text) {
  if (text === null) return { enabled: false, blocking: false };
  const value = JSON.parse(text.replace(/^\uFEFF/, ''));
  function keys(obj, allowed, label) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${label} 必须为对象`);
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) throw new Error(`${label}.${key} 未知字段`);
  }
  keys(value, ['version', 'human_acceptance'], 'acceptance');
  if (value.version !== 1) throw new Error('acceptance.version 必须为 1');
  const policy = value.human_acceptance;
  keys(policy, ['enabled', 'blocking'], 'human_acceptance');
  for (const key of ['enabled', 'blocking']) if (typeof policy[key] !== 'boolean') throw new Error(`human_acceptance.${key} 必须为布尔值`);
  if (policy.blocking && !policy.enabled) throw new Error('human_acceptance.blocking 需要 enabled: true');
  return { enabled: policy.enabled, blocking: policy.blocking };
}
function status(policy, receipt, head) {
  if (!policy.enabled) return 'disabled';
  return receipt?.result === 'passed' && typeof receipt.accepted_by === 'string' && receipt.accepted_by.trim() &&
    receipt.accepted_head === head && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? 'passed' : 'pending';
}
module.exports = { CONFIG, parse, status };

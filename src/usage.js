import { AsyncLocalStorage } from 'node:async_hooks';

// Transports report token usage into whichever assessment is running, without
// threading a callback through every reviewer and grading layer.
const meter = new AsyncLocalStorage();
export const withUsageMeter = (sink, operation) => meter.run(sink, operation);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function reportUsage({ inputTokens, outputTokens, cost } = {}) {
  const sink = meter.getStore();
  if (!sink) return;
  try { sink({ inputTokens: count(inputTokens), outputTokens: count(outputTokens), cost: Number.isFinite(cost) && cost >= 0 ? cost : null }); } catch {}
}
export function addUsage(total = {}, usage) {
  return {
    input: count(total.input) + usage.inputTokens,
    output: count(total.output) + usage.outputTokens,
    // Cost is only known for billed API routes; subscription CLIs report none.
    cost: usage.cost === null ? (total.cost ?? null) : (total.cost ?? 0) + usage.cost,
  };
}

const compact = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const money = cost => cost === 0 ? '$0' : cost < 0.0001 ? '<$0.0001' : cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
/** Tokens and running cost; a configured call cap is shown only when one is set. */
export const modelUsageText = ({ calls, limit } = {}, tokens = {}) => [
  `${compact(count(tokens?.input) + count(tokens?.output))} tokens`,
  ...(Number.isFinite(tokens?.cost) ? [money(tokens.cost)] : []),
  ...(limit !== null && limit !== undefined ? [`${calls}/${limit} calls`] : []),
].join(' · ');

export const modelLimitText = limit => limit === null ? 'no limit' : `${limit} model calls per assessment`;

import { questionLimit } from './routing.js';

const setupCodes = new Set(['INVALID_CONFIG', 'INVALID_SNAPSHOT', 'STALE_SNAPSHOT', 'CONTEXT_LIMIT', 'TOOL_RESULT_LIMIT', 'OUTPUT_LIMIT', 'PROVIDER_NOT_FOUND', 'PROVIDER_START_FAILED', 'PROVIDER_FAILED']);
const setupTypes = new Set(['authentication', 'permission_denied', 'payment_required', 'context_length_exceeded', 'max_tokens_exceeded', 'token_limit_exceeded', 'string_too_long', 'invalid_request', 'invalid_prompt', 'not_found', 'precondition_failed', 'payload_too_large', 'unprocessable', 'content_policy_violation', 'refusal']);

function retryable(error, before, state, minimum) {
  if (setupCodes.has(error.code) || setupTypes.has(error.errorType)) return false;
  if (error.code === 'OPENROUTER_PROVIDER_ERROR' && [400, 401, 402, 403, 404, 413, 422].includes(error.status)) return false;
  // A failed preflight cannot improve by spending more. Budget exhaustion is
  // different: an explicit human choice can authorize a new allowance.
  if (state.usage.calls === before.usage.calls) {
    return state.usage.limit - state.usage.calls < minimum
      && (error.code === 'REVIEWER_BUDGET' || /^Assessment call limit \(/u.test(error.message));
  }
  return !/API key|sign.in|model access|output (?:token )?limit|finish_reason: length|refused or filtered/iu.test(error.message);
}

function diagnostic(error, state) {
  // The interactive menu replaces only Sphinx's own appended command advice;
  // the underlying failure and its sanitized provider diagnostics stay visible.
  const hints = [
    ` Run sphinx check --id ${state.id} --retry-review to explicitly authorize a fresh review allowance; prior usage will be retained.`,
    ` ${state.usage.limit - state.usage.calls} model calls remain in the existing assessment allowance (${state.usage.calls}/${state.usage.limit} used). When ready, retry within that allowance: sphinx check --id ${state.id}.`,
  ];
  let message = error.message || String(error);
  for (const hint of hints) if (message.endsWith(hint)) message = message.slice(0, -hint.length);
  return message;
}

/** Keep a human-owned terminal open after review failure. This function never
 * chooses to retry, expands a budget, changes a route, or awards completion on
 * its own. inspect() exposes public state only; validate() checks current Git
 * content and policy before a recovery choice is shown. */
export async function prepareInteractiveCheck({ start, inspect, authorizeMore, validate, config, choose, ui, waitingGit = false, signal }) {
  for (;;) {
    signal?.throwIfAborted();
    const before = await inspect();
    signal?.throwIfAborted();
    try { const result = await start(); signal?.throwIfAborted(); return result; }
    catch (error) {
      signal?.throwIfAborted();
      if (error.name === 'AbortError' || ['SPHINX_CANCELLED', 'EVALUATOR_CANCELLED'].includes(error.code)) throw error;
      const state = await inspect();
      signal?.throwIfAborted();
      if (state.status !== 'pending' || state.preparation?.status !== 'failed' || state.progress.total !== 0) throw error;
      await validate();
      signal?.throwIfAborted();
      const reserve = questionLimit(config.level, state.route.tier);
      const reviewMinimum = state.preparation.minimumReviewerCalls === 1 ? 1 : 2, minimum = reserve + reviewMinimum;
      const remaining = state.usage.limit - state.usage.calls;
      const choices = [];
      ui.warning(diagnostic(error, state));
      ui.note(`${state.usage.calls}/${state.usage.limit} model calls used. No questions or approval were recorded.`);
      if (retryable(error, before, state, minimum)) {
        if (remaining >= minimum) choices.push({
          value: 'retry', label: state.preparation.resumable ? 'Continue the saved review' : 'Retry within the remaining allowance',
          description: `${remaining} calls remain, including ${reserve} reserved for grading. ${state.preparation.resumable ? 'Reuse the evidence and investigation already saved.' : 'Keep the same evaluator route and total limit.'}`,
        });
        else if (config.maxModelCalls >= minimum) choices.push({
          value: 'extend', label: `Allow up to ${config.maxModelCalls} more calls and retry`,
          description: `${remaining} calls remain; review needs at least ${reviewMinimum} plus ${reserve} reserved for grading. Keep all ${state.usage.calls} used calls counted and record this new allowance.`,
        });
      }
      if (!choices.length) ui.note('Resolve the reported setup or evidence problem before resuming. Repeating this attempt is not offered here.');
      choices.push({ value: 'pause', label: 'Pause this check', description: 'Save progress without making another model request. The Git operation remains unapproved.' });
      const action = await choose({
        title: 'Review did not finish',
        description: waitingGit
          ? 'The original Git operation is waiting while this terminal stays open, subject to its time limit. Choose how to continue.'
          : 'Choose how to continue. Nothing is retried automatically.',
        choices, current: 'pause',
      });
      signal?.throwIfAborted();
      if (action === 'pause') {
        ui.note('Progress saved. No approval was recorded.');
        ui.command(`sphinx check --id ${state.id}`);
        return null;
      }
      if (!choices.some(choice => choice.value === action)) throw new Error('Invalid review recovery choice. No additional model request was made.');
      if (action === 'extend') {
        await authorizeMore();
        signal?.throwIfAborted();
        ui.note(`Authorized up to ${config.maxModelCalls} additional model calls, including grading. Earlier usage remains counted.`);
      }
      // The next start still performs the store's locked policy/snapshot and
      // budget checks. A new failure always returns to the human, never a retry loop.
    }
  }
}

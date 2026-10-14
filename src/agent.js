import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/** Session setup only. Git and native lifecycle hooks control the actual checkpoint. */
export async function agentHook({ agent, event, input = '', env = process.env }) {
  if (env.SPHINX_EVALUATOR === '1') return { output: null, exitCode: 0 };
  if (!['codex', 'claude'].includes(agent)) throw new Error(`Unsupported agent: ${agent}`);
  let payload;
  try {
    payload = typeof input === 'object' && !Buffer.isBuffer(input) ? input : JSON.parse(String(input || '{}'));
  } catch {
    throw new Error('Agent hook input must be valid JSON.');
  }
  const name = payload?.hook_event_name || event;
  if (name !== 'SessionStart') return { output: null, exitCode: 0 };
  if (agent === 'claude' && env.CLAUDE_ENV_FILE && /^[A-Za-z0-9_-]{1,200}$/.test(payload?.session_id || '')) {
    // Claude's documented SessionStart environment channel tags later Bash calls,
    // including `git -C` and `cd`, without reading the command or its output.
    const file = await open(env.CLAUDE_ENV_FILE, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
    try { await file.writeFile(`\nexport SPHINX_CLAUDE_SESSION='${payload.session_id}'\n`); }
    finally { await file.close(); }
  }
  return {
    exitCode: 0,
    output: {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: [
          'Sphinx is installed to help the human retain understanding of agent-assisted changes.',
          'Repository branch and event policy lives in .sphinxconfig (with .sphinx.json as a legacy fallback). Use `sphinx status --json` to inspect effective policy and pending assessments; do not change policy to avoid a checkpoint.',
          'Git deterministically queues a checkpoint when repository policy matches a push or commit. The installed PostToolUse / PostToolUseFailure MCP hook opens the native Sphinx questionnaire automatically; you do not initiate or conduct it.',
          'Sphinx collects the human\'s answers directly through the host\'s question forms and grades them using an independent evaluator. Only the outcome is returned to you. Do not relay questions through chat, call sphinx answer/explain/dispute for the human, or automate the questionnaire UI.',
          'Never answer on the human\'s behalf, fabricate a response, read private Sphinx session files or answer keys, or bypass the Git hook to finish the task.',
          'Respect .sphinxignore and configured exclusions: do not read excluded files to supplement an assessment or send them to the evaluator.',
          'The form offers learning, dispute, and pause actions. The human chooses them directly. A paused or cancelled check remains incomplete; do not repeatedly retry the Git operation to force another prompt.',
          'After Sphinx reports completion, retry only Git operations that Sphinx blocked. Advisory operations already proceeded; do not repeat them. A changed commit or destination may require another assessment. If the human wants to reopen a paused blocking questionnaire, retrying their original Git operation queues it again; for an advisory check they can use sphinx check in their terminal.',
          'If the native form is unavailable, report the integration issue and use sphinx doctor to diagnose it. The human can run sphinx check in their own terminal. Do not substitute a chat-based questionnaire or submit answers yourself.',
          'The assessment is open-book. Helping the human inspect code is encouraged. The coding agent must not grade the response itself.',
        ].join('\n'),
      },
    },
  };
}

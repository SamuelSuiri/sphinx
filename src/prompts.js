import { parseRoute, questionLimit } from './routing.js';

export const routeText = route => `${route.provider}${route.model ? `:${route.model}` : ''}`;
export const splitList = value => String(value).split(',').map(item => item.trim()).filter(Boolean);
export const questionCapsText = level => ['small', 'medium', 'large'].map(tier => `${tier} ${questionLimit(level, tier)}`).join(', ');

export function createPrompts({ ask, ui }) {
  async function choose({ title, description, choices, current }) {
    ui.section(title); if (description) ui.paragraph(description);
    const selected = Math.max(0, choices.findIndex(choice => choice.value === current));
    ui.blank();
    ui.rows(choices.map((choice, index) => [`${index + 1}. ${choice.label}${index === selected ? ' (default)' : ''}`, choice.description]));
    for (;;) {
      const answer = (await ask(`\nChoose [${selected + 1}]: `)).trim();
      if (!answer) return choices[selected].value;
      const exact = choices.find(choice => choice.value.toLowerCase() === answer.toLowerCase());
      const number = /^\d+$/.test(answer) ? Number(answer) : 0;
      if (exact) return exact.value;
      if (number >= 1 && number <= choices.length) return choices[number - 1].value;
      ui.warning(`Enter a number from 1 to ${choices.length}, or press Enter for ${choices[selected].label}.`);
    }
  }
  async function text({ title, description, current, validate = value => value }) {
    ui.section(title); if (description) ui.paragraph(description);
    for (;;) {
      const value = (await ask(`\nValue [${current || 'none'}]: `)).trim() || current;
      try { validate(value); return value; } catch (error) { ui.warning(error.message); }
    }
  }
  return { choose, text };
}

const lists = value => { if (!splitList(value).length) throw new Error('Enter at least one comma-separated value.'); if (/\s/.test(splitList(value).join(''))) throw new Error('Use commas between patterns; patterns cannot contain spaces.'); };

export async function askPolicy(config, initial, prompts) {
  const values = { ...initial };
  if (values.events === undefined) {
    const original = config.events.join(',');
    const current = config.events.includes('pre-push') && config.events.includes('pre-commit') ? 'pre-push,pre-commit' : original;
    const selected = await prompts.choose({
    title: 'When should Sphinx run?', description: 'Git decides deterministically when a checkpoint is needed. Hooks make no model calls.', current,
    choices: [
      { value: 'pre-push', label: 'Before pushing', description: 'Check commits when they leave your machine for a matching destination branch.' },
      { value: 'pre-commit', label: 'Before committing', description: 'Check staged changes on a matching local branch. More frequent checkpoints.' },
      { value: 'pre-push,pre-commit', label: 'Before both', description: 'Check both boundaries. Commit and push snapshots may require separate assessments.' },
      ...(config.events.length ? [] : [{ value: '', label: 'Keep checkpoints disabled', description: 'Preserve the current empty event policy.' }]),
    ],
    });
    values.events = selected === current ? original : selected;
  }
  if (values.branches === undefined) values.branches = await prompts.text({ title: 'Which branches?', description: 'Pushes match the destination branch, not your checkout. A feature:main push matches main. Commit checks match the current local branch. Use comma-separated names or patterns, such as main,release/*. An empty inherited list matches no branches.', current: config.branches.join(','), validate: value => { if (value || config.branches.length) lists(value); } });
  if (values.remotes === undefined) values.remotes = await prompts.text({ title: 'Which remotes?', description: 'Limit push checkpoints by remote name. Use * for every remote, or names such as origin,upstream. This does not affect commit checks. An empty inherited list matches no remotes.', current: config.remotes.join(','), validate: value => { if (value || config.remotes.length) lists(value); } });
  if (values.level === undefined) values.level = await prompts.choose({ title: 'How much understanding should the check cover?', description: 'Question caps depend on change size and depth. The evaluator can ask fewer, without filler. Model selection is separate.', current: config.level, choices: [
    { value: 'relaxed', label: 'Relaxed', description: `Caps: ${questionCapsText('relaxed')}. Behavior and the most consequential edge case.` },
    { value: 'standard', label: 'Standard', description: `Caps: ${questionCapsText('standard')}. Behavior, failures, and system interactions.` },
    { value: 'thorough', label: 'Thorough', description: `Caps: ${questionCapsText('thorough')}. Also consider rollout, rollback, and compatibility.` },
  ] });
  if (values.mode === undefined) values.mode = await prompts.choose({ title: 'What happens at a checkpoint?', current: config.mode, choices: [
    { value: 'block', label: 'Pause until complete', description: 'Stop the Git operation. Complete the understanding check, then retry.' },
    { value: 'advisory', label: 'Remind and continue', description: 'Record a pending check and allow the Git operation to proceed.' },
  ] });
  return values;
}

export async function askInstall(config, initial, prompts) {
  let values = await askPolicy(config, initial, prompts);
  const explicitRoute = ['provider', 'model', 'small', 'medium', 'large'].some(key => initial[key] !== undefined);
  if (!explicitRoute) {
    const choice = await prompts.choose({ title: 'Who should evaluate your understanding?', description: 'A separate evaluator receives filtered code evidence without your coding conversation. Sphinx collects your answers directly in native forms or the terminal.', current: 'keep', choices: [
      { value: 'keep', label: 'Keep current model routes', description: `Small: ${routeText(config.models.small)}. Medium: ${routeText(config.models.medium)}. Large: ${routeText(config.models.large)}.` },
      { value: 'openrouter', label: 'OpenRouter free models', description: 'Use openrouter/free for every size. Requires an API key; filtered evidence is sent to OpenRouter and its model provider.' },
      { value: 'codex', label: 'Codex', description: 'Use your installed, signed-in Codex CLI and its usage allowance for every size.' },
      { value: 'claude', label: 'Claude Code', description: 'Use your installed, signed-in Claude CLI and its usage allowance for every size.' },
      { value: 'custom', label: 'Choose by change size', description: 'Set separate provider:model routes for small, medium, and large changes.' },
    ] });
    if (choice === 'custom') {
      for (const [tier, description] of [['small', 'At most 80 changed lines and 3 files, with no consequential paths, by default.'], ['medium', 'Changes between the small and large thresholds.'], ['large', 'At least 400 lines, 12 files, or a consequential path by default.']]) {
        values[tier] = await prompts.text({ title: `Evaluator for ${tier} changes`, description: `${description} Enter provider:model, such as openrouter:openrouter/free or claude:sonnet.`, current: routeText(config.models[tier]), validate: parseRoute });
      }
    } else if (choice !== 'keep') values.provider = choice;
  }
  if (values.agents === undefined) values.agents = await prompts.choose({ title: 'Connect your coding agents', description: 'Hooks open a native questionnaire or a dedicated Sphinx terminal automatically. You answer directly; your coding model receives only the outcome. Existing integrations are preserved.', current: 'auto', choices: [
    { value: 'auto', label: 'Detect installed agents', description: 'Connect available Codex, Claude Code, Pi, Cursor, and OpenCode installations.' },
    { value: 'codex,claude,pi,cursor,opencode', label: 'All supported agents', description: 'Configure all five clients, including ones you plan to install later.' },
    { value: 'codex,claude', label: 'Codex and Claude Code', description: 'Configure both agents, including ones you plan to install later.' },
    { value: 'codex', label: 'Codex only', description: 'Add Codex instructions. Review and trust the hook in /hooks after setup.' },
    { value: 'claude', label: 'Claude Code only', description: 'Add Claude Code instructions. Start a new session after setup.' },
    { value: 'pi', label: 'Pi only', description: 'Show questions directly in Pi dialogs. Run /reload after setup.' },
    { value: 'cursor', label: 'Cursor only', description: 'Open a dedicated Sphinx terminal from local Cursor sessions. Start a new session after setup.' },
    { value: 'opencode', label: 'OpenCode only', description: 'Open a dedicated Sphinx terminal from OpenCode 1.x. Restart OpenCode after setup.' },
    { value: 'none', label: 'Git and terminal only', description: 'Do not add agent integrations. Use sphinx check in your terminal.' },
  ] });
  return values;
}

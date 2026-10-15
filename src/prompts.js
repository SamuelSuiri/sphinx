import { parseRoute, questionLimit } from './routing.js';
import { reviewerTurnLimit } from './reviewer-limits.js';

export const routeText = route => `${route.provider}${route.model ? `:${route.model}` : ''}`;
export const splitList = value => String(value).split(',').map(item => item.trim()).filter(Boolean);
export const questionCapsText = level => ['small', 'medium', 'large'].map(tier => `${tier} ${questionLimit(level, tier)}`).join(', ');
export const reviewCapsText = config => ['small', 'medium', 'large'].map(tier => `${tier} ${reviewerTurnLimit(tier, config.agentMaxTurns)}`).join(', ');

export function createPrompts({ ask, ui, select }) {
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
  async function multiselect(options) {
    if (select) return select(options);
    // Accessible line-input fallback for dumb terminals and redirected output.
    const { title, description, choices, current = [] } = options;
    const selected = new Set(current.filter(value => choices.some(choice => choice.value === value)));
    ui.section(title); if (description) ui.paragraph(description);
    ui.note('Toggle numbers or names separated by commas. all selects every agent; none clears the list. Enter confirms.');
    for (;;) {
      ui.blank();
      const all = selected.size === choices.length, partial = selected.size > 0;
      ui.rows([
        [`1. [${all ? 'x' : partial ? '-' : ' '}] All supported agents`, 'Select or clear every agent.'],
        ...choices.map((choice, index) => [`${index + 2}. [${selected.has(choice.value) ? 'x' : ' '}] ${choice.label}`, choice.description]),
      ]);
      const answer = (await ask('\nToggle selection (Enter to confirm): ')).trim().toLowerCase();
      if (!answer) return choices.filter(choice => selected.has(choice.value)).map(choice => choice.value);
      if (answer === 'all') { choices.forEach(choice => selected.add(choice.value)); continue; }
      if (answer === 'none') { selected.clear(); continue; }
      const toggles = answer.split(/[\s,]+/u).filter(Boolean).map(value => {
        if (/^\d+$/.test(value)) return Number(value) - 1;
        const index = choices.findIndex(choice => choice.value.toLowerCase() === value);
        return index === -1 ? -1 : index + 1;
      });
      if (toggles.some(index => index < 0 || index > choices.length)) { ui.warning('Choose numbers from the list, agent names, all, or none.'); continue; }
      for (const index of new Set(toggles)) {
        if (index === 0) { if (selected.size === choices.length) selected.clear(); else choices.forEach(choice => selected.add(choice.value)); }
        else { const value = choices[index - 1].value; if (selected.has(value)) selected.delete(value); else selected.add(value); }
      }
    }
  }
  return { choose, text, multiselect };
}

const lists = value => { if (!splitList(value).length) throw new Error('Enter at least one comma-separated value.'); if (/\s/.test(splitList(value).join(''))) throw new Error('Use commas between patterns; patterns cannot contain spaces.'); };

export async function askPolicy(config, initial, prompts, { scope = 'repository' } = {}) {
  const values = { ...initial };
  if (values.events === undefined) {
    const original = config.events.join(',');
    const current = config.events.includes('pre-push') && config.events.includes('pre-commit') ? 'pre-push,pre-commit' : original;
    const selected = await prompts.choose({
    title: 'When should Sphinx run?', description: 'Git decides deterministically when a checkpoint is needed. The Git gate makes no model calls.', current,
    choices: [
      { value: 'pre-push', label: 'Before pushing', description: 'Check commits when they leave your machine for a matching destination branch.' },
      { value: 'pre-commit', label: 'Before committing', description: 'Check staged changes on a matching local branch. More frequent checkpoints.' },
      { value: 'pre-push,pre-commit', label: 'Before both', description: 'Check both boundaries. Commit and push snapshots may require separate assessments.' },
      ...(config.events.length ? [] : [{ value: '', label: 'Keep checkpoints disabled', description: 'Preserve the current empty event policy.' }]),
    ],
    });
    values.events = selected === current ? original : selected;
  }
  const branchScope = scope === 'global'
    ? 'By default, Sphinx runs on pushes to the destination branch names below. Each repository can override these machine-wide defaults by setting branches in .sphinxconfig to its own production branch name.'
    : 'Choose the destination branches that should trigger push checks in this repository. These override your machine-wide defaults and are saved as branches in .sphinxconfig. Use this project\'s production branch name.';
  const remoteScope = scope === 'global'
    ? 'By default, push checks apply to the remote names below. These are machine-wide defaults; each repository can override remotes in .sphinxconfig.'
    : 'Choose which remotes should trigger push checks in this repository. These override your machine-wide defaults and are saved as remotes in .sphinxconfig.';
  if (values.branches === undefined) values.branches = await prompts.text({ title: 'Which branches?', description: `${branchScope} Use comma-separated names or patterns, such as main,release/*. Commit checks match the current local branch. An empty list matches no branches.`, current: config.branches.join(','), validate: value => { if (value || config.branches.length) lists(value); } });
  if (values.remotes === undefined) values.remotes = await prompts.text({ title: 'Which remotes?', description: `${remoteScope} Use * for every remote, or names such as origin,upstream. This does not affect commit checks. An empty list matches no remotes.`, current: config.remotes.join(','), validate: value => { if (value || config.remotes.length) lists(value); } });
  if (values.level === undefined) values.level = await prompts.choose({ title: 'How much understanding should the check cover?', description: 'Question caps depend on change size and depth. The evaluator can ask fewer, without filler. Model selection is separate.', current: config.level, choices: [
    { value: 'relaxed', label: 'Relaxed', description: `Caps: ${questionCapsText('relaxed')}. Behavior and the most consequential edge case.` },
    { value: 'standard', label: 'Standard', description: `Caps: ${questionCapsText('standard')}. Behavior, failures, and system interactions.` },
    { value: 'thorough', label: 'Thorough', description: `Caps: ${questionCapsText('thorough')}. Also consider rollout, rollback, and compatibility.` },
  ] });
  if (values.mode === undefined) values.mode = await prompts.choose({ title: 'What happens at a checkpoint?', current: config.mode, choices: [
    { value: 'block', label: 'Pause until complete', description: 'The Git operation will only go through after you answer the understanding questions correctly.' },
    { value: 'advisory', label: 'Remind and continue', description: 'Record a pending check and allow the Git operation to proceed.' },
  ] });
  return values;
}

export async function askInstall(config, initial, prompts, { detectedAgents = [] } = {}) {
  let values = await askPolicy(config, initial, prompts, { scope: 'global' });
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
  if (values.agents === undefined) {
    const selected = await prompts.multiselect({ title: 'Connect your coding agents', description: 'Detected agents are preselected. Choose any combination, or clear all to skip agent setup. Previously connected agents remain installed.', current: detectedAgents, choices: [
      { value: 'codex', label: 'Codex', description: 'Native forms. Review and trust Sphinx hooks in /hooks.' },
      { value: 'claude', label: 'Claude Code', description: 'Native questionnaire forms.' },
      { value: 'pi', label: 'Pi', description: 'Native questionnaire dialogs.' },
      { value: 'cursor', label: 'Cursor', description: 'A Sphinx terminal for answers from local Agent sessions.' },
      { value: 'opencode', label: 'OpenCode', description: 'A Sphinx terminal for answers. Requires OpenCode 1.x.' },
    ] });
    values.agents = selected.length ? selected.join(',') : 'none';
  }
  return values;
}

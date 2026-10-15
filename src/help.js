import { questionCapsText } from './prompts.js';
import { DEFAULT_CONFIG } from './config.js';

const common = [['--help, -h', 'Explain this command and show examples.'], ['--json', 'Return machine-readable JSON without color, banners, or progress.']];
const modelCalls = ['--max-model-calls <1-100>', `Set the machine-wide total per assessment, including review, compaction, grading, learning, and failed requests. Default: ${DEFAULT_CONFIG.maxModelCalls}. Per-review size caps remain 3/5/8 with the default agentMaxTurns.`];
const policy = [
  ['--branches <patterns>', 'Comma-separated branches. Pushes match destination names, e.g. main,release/*. Commits match the current local branch.'],
  ['--events <events>', 'pre-push, pre-commit, or both separated by a comma. Default: pre-push.'],
  ['--level <level>', `Question caps: relaxed (${questionCapsText('relaxed')}); standard (${questionCapsText('standard')}, default); thorough (${questionCapsText('thorough')}). Fewer when sufficient. Model routes are separate.`],
  ['--mode <mode>', 'block requires correct answers before the Git operation can go through (default). advisory records a pending check and allows it.'],
  ['--remotes <patterns>', 'Comma-separated remote names, e.g. origin. Default: * (any remote). Applies to pushes.'],
];

export const HELP = {
  prepare: {
    summary: 'Prepare questions in the background before the next push.', usage: 'sphinx prepare [--retry] [--json]',
    paragraphs: ['Installed post-commit, post-merge, post-rewrite, and post-checkout hooks schedule a debounced reviewer automatically. This command schedules the same preparation explicitly.', 'The reviewer investigates filtered Git evidence and project context, but never answers questions or approves a push. Preparation uses local remote-tracking refs; a different actual destination or remote base safely starts a fresh check.'],
    groups: [['Preparation', [['--retry', 'Explicitly retry a failed preparation within the remaining assessment budget. Automatic hooks do not retry failures.']]], ['Output', common]],
    examples: ['sphinx prepare', 'sphinx status', 'sphinx prepare --retry'],
    footer: 'Set backgroundPreparation: false in your global config or repository .sphinxconfig to disable preparation. Models and call budgets remain machine-wide. Background work shares the check’s model-call budget.',
  },
  mcp: {
    summary: 'Run the native questionnaire connection for your coding agent.',
    usage: 'sphinx mcp',
    paragraphs: ['The installer registers this stdio MCP server for Codex and Claude Code. Their lifecycle hooks call it for fallback or advisory checkpoints after Git exits; no coding-model decision or question relay is involved. Blocking Git normally waits for a separate Sphinx terminal. Pi has its own fallback dialogs.', 'Input and output are JSON-RPC. Human answers arrive through native form elicitation, never as tool arguments. Without a queued Git checkpoint, the handler makes no model requests.'],
    groups: [['Output', [common[0]]]],
    examples: ['sphinx doctor'],
    footer: 'Usually you do not run this yourself. Use sphinx activate to open fresh clients and review Codex hook trust in /hooks. Outside a supported agent, use sphinx check in your own terminal.',
  },
  install: {
    summary: 'Connect Sphinx to Git and your coding agents for this machine.',
    usage: 'sphinx install [options]',
    paragraphs: [
      'Without flags, guided setup explains each choice. Agent selection uses checkboxes with All supported agents first; detected agents are preselected. Branch and remote selections are machine-wide defaults; each repository can override them in .sphinxconfig to match its production setup. Existing model routes and policy remain the defaults when you rerun setup.',
      'Global Git hooks cover existing and new repositories using that Git configuration. Existing hooks run first. Repositories with their own core.hooksPath need --repo.',
      'Guided installation opens selected installed clients in fresh sessions. Existing sessions stay open. Codex still requires you to review and trust Sphinx hooks in /hooks. Launching a client does not prove its MCP connection or hook trust.',
      'Git opens a dedicated Sphinx terminal on supported desktops and waits for your answers. Passing continues the same Git operation automatically. Native agent dialogs remain available for fallback and advisory checks. The coding model receives only status. Requires Node.js 22.19 or newer.',
    ],
    groups: [
      ['Setup', [['--yes', 'Use existing settings, or first-install defaults, without questions. Does not open apps unless --launch is also passed.'], ['--launch', 'Open selected installed clients after setup, including with --yes. This is the guided-install default.'], ['--no-launch', 'Install without opening apps. Run sphinx activate later.'], ['--repo', 'Chain the current repository’s hook override. Does not change global settings, model routes, or agent integrations.'], ['--agents <selection>', 'auto detects clients (default); select codex, claude, pi, cursor, opencode, a comma-separated subset, or none for Git-only setup.']]],
      ['Checkpoint policy', policy],
      ['Evaluators and usage', [
        ['--provider <provider>', 'openrouter, codex, or claude. Explicitly sets all three size routes. Default: openrouter.'],
        ['--model <id>', 'Set one model for all sizes. OpenRouter defaults to openrouter/free; coding agents use their own default.'],
        ['--small <provider:model>', 'Model for at most 80 changed lines and 3 files, with no consequential paths. Example: openrouter:openrouter/free.'],
        ['--medium <provider:model>', 'Model for changes between the small and large thresholds. Example: claude:sonnet.'],
        ['--large <provider:model>', 'Model for at least 400 lines, 12 files, or consequential paths. Example: claude:opus.'],
        ['--allow-paid', 'Explicitly allow paid OpenRouter routes. Free routes remain free; no automatic paid fallback.'],
        modelCalls,
      ]], ['Output', [common[0]]],
    ],
    examples: ['sphinx install', 'sphinx install --no-launch', 'sphinx install --yes --launch --provider claude', 'sphinx install --small openrouter:openrouter/free --large claude:opus', 'sphinx install --repo'],
    footer: `The reviewer runs in the embedded Pi SDK. OpenRouter needs an API key, even for free models; Codex/Claude routes use fresh isolated CLI calls with your existing sign-in. The default budget is ${DEFAULT_CONFIG.maxModelCalls} requests per assessment, including Pi compaction, grading, and failures. Change it later with sphinx config --max-model-calls <1-100>; no reinstall is needed. Automatic CLI windows use macOS Terminal or a graphical Linux/WSL terminal; macOS may require Terminal automation permission.`,
  },
  activate: {
    summary: 'Open coding clients with your installed Sphinx integrations.', usage: 'sphinx activate [--agents <selection>] [--json]',
    paragraphs: ['Opens fresh Codex, Claude Code, Pi, and OpenCode terminal sessions in the current directory, or a new Cursor editor window. Defaults to all configured Sphinx integrations. Existing sessions remain open; no integration is reinstalled.', 'Sphinx sends no prompt or model request. Review any native startup approvals; in Codex, open /hooks to trust Sphinx. In Cursor, start a new Agent conversation in the opened window. Launch status does not verify hook trust or MCP connectivity.'],
    groups: [['Clients', [['--agents <selection>', 'A comma-separated subset of configured codex, claude, pi, cursor, opencode integrations. auto selects all configured clients.']]], ['Output', common]],
    examples: ['sphinx activate', 'sphinx activate --agents codex,claude', 'sphinx activate --json'],
    footer: 'Requires a supported desktop terminal or editor. Missing clients and headless sessions get a manual fallback. Exit status is 1 if any selected client could not open. macOS may request permission to control Terminal.',
  },
  init: {
    summary: 'Set up a repository policy and content exclusions.',
    usage: 'sphinx init [options]',
    paragraphs: ['Creates .sphinxconfig (JSON policy), .sphinxignore, and .sphinxcontext.md (project purpose, workflows, and architecture). The reviewer receives project context every time. Existing files are preserved. Defaults inherit your effective global policy, not the current checkout branch.', 'Legacy .sphinx.json policy is copied into a new .sphinxconfig when needed; the original remains. This command does not install hooks, change global settings, or call a model.'],
    groups: [['Setup', [['--yes', 'Accept inherited defaults without prompts.'], ['--context <description>', 'Initial project context when .sphinxcontext.md does not exist. Otherwise the existing file is preserved.'], ...policy]], ['Output', common]],
    examples: ['sphinx init', 'sphinx init --yes --branches main', 'sphinx init --events pre-push,pre-commit --level thorough', 'sphinx init --yes --json'],
    footer: 'Destination branches are where a push lands: pushing feature:main matches main. Add sensitive project paths to .sphinxignore before your first assessment.',
  },
  check: {
    summary: 'Start or resume an understanding check.', usage: 'sphinx check [options]',
    paragraphs: ['Resumes a pending checkpoint, reusing matching background preparation. A fresh reviewer investigates immutable Git evidence with read-only diff, file, and search tools, using .sphinxcontext.md without your coding conversation. If preparation is still running, this waits for it instead of starting a duplicate review.', 'Small changes get one question. Larger changes use depth-based ceilings, with fewer questions when sufficient. Answer with a prediction and a brief reason; inspect the code when helpful. A missed concept gets an explanation and a replacement scenario about that concept.', 'If review fails before questions are ready, the interactive terminal offers a same-budget retry or explicit additional allowance when needed. Pause is the default. Usage stays counted, and nothing retries automatically. Resolve setup or evidence-loading problems before resuming. A Git operation that is still waiting can continue after success, within its time limit.'],
    groups: [['Choose the change', [['--id <assessment-id>', 'Resume a specific pending checkpoint. Find IDs with sphinx pending.'], ['--staged', 'Assess the index for a pre-commit checkpoint, including partial staging.'], ['--remote <name>', 'Select the push remote instead of the upstream/default origin.'], ['--branch <name>', 'Select the destination branch for a manual push check.'], ['--retry-review', 'With --id, authorize more calls after review failed before producing questions. Use ordinary --id while enough calls remain. Explicitly allows up to maxModelCalls additional requests, including grading; prior usage stays counted. Does not reset an active questionnaire.']]], ['During an interview', [['/learn', 'Explain the current concept and ask a new transfer question.'], ['/dispute <reason>', 'Review an ambiguous or unsupported premise. A dispute cannot complete a concept.'], ['/quit', 'Save progress and leave the operation pending.']]], ['Output', common]],
    examples: ['sphinx check', 'sphinx check --staged', 'sphinx check --remote origin --branch main', 'sphinx check --json'],
    footer: 'Pi manages the reviewer session, tools, and context compaction within Sphinx’s request budget. Small reviews use at most 3 calls and medium reviews at most 5, further bounded by agentMaxTurns and remaining calls. The last review call is reserved for questions. Each answer, learning request, or dispute uses one further call against archived evidence. After completion, a waiting Git operation verifies the result and continues automatically. An operation that already exited cannot be resumed.',
  },
  answer: {
    summary: 'Submit an answer explicitly from the terminal.', usage: 'sphinx answer <assessment-id> --text <answer> [--json]',
    paragraphs: ['This is a manual terminal interface for the human. Use the integrated questionnaire when available; the coding agent must not call this command for you. A correct answer clears a concept; an incorrect answer returns an explanation and a new question.'],
    groups: [['Answer', [['--text <answer>', 'The human’s prediction and brief causal explanation. Quote the entire response.']]], ['Output', common]],
    examples: ["sphinx answer <assessment-id> --text 'No, the transaction rolls back both writes.' --json"],
  },
  explain: { summary: 'Learn the current concept and try a new scenario.', usage: 'sphinx explain <assessment-id> [--json]', paragraphs: ['Use this when you do not know or want a walkthrough. The concept remains incomplete until you apply the explanation to a different question. Uses one model call.'], groups: [['Output', common]], examples: ['sphinx explain <assessment-id> --json'] },
  dispute: { summary: 'Challenge an ambiguous or unsupported question.', usage: 'sphinx dispute <assessment-id> --text <reason> [--json]', paragraphs: ['Explain the missing assumption or conflicting evidence. The independent evaluator reviews the question and may replace it. A dispute never awards completion. Uses one model call.'], groups: [['Reason', [['--text <reason>', 'What is ambiguous or contradicted by the evidence?']]], ['Output', common]], examples: ["sphinx dispute <assessment-id> --text 'The question assumes retries, but this path does not retry.' --json"] },
  pending: { summary: 'List unfinished checkpoints for this repository.', usage: 'sphinx pending [--json]', paragraphs: ['Shows valid pending and active checks, progress, selected route, and remaining call budget. Stale snapshots are filtered out. Makes no model calls.'], groups: [['Output', common]], examples: ['sphinx pending', 'sphinx pending --json'] },
  status: { summary: 'See repository coverage, effective policy, and pending checks.', usage: 'sphinx status [--json]', paragraphs: ['Shows whether Git is using a Sphinx hook dispatcher and which events, destinations, and remotes the current policy covers. It does not contact remotes, call a model, or establish Codex hook trust.'], groups: [['Output', common]], examples: ['sphinx status', 'sphinx status --json'] },
  config: { summary: 'Inspect effective settings or set the machine-wide call limit.', usage: 'sphinx config [--max-model-calls <1-100>] [--json]', paragraphs: ['Without a setter, this command only displays effective configuration. Repository .sphinxconfig overrides supported global policy fields; legacy .sphinx.json is used only when the canonical file is absent. Model routes, credentials, and usage budgets remain machine-wide.', 'Use --max-model-calls to save the total assessment allowance without reinstalling or invoking a model. This works outside a Git repository and preserves all other global settings. With --json, a save reports the global path, previous and new limit, and resulting global configuration. Per-review size caps stay unchanged.'], groups: [['Settings', [modelCalls]], ['Output', common]], examples: ['sphinx config', 'sphinx config --json', `sphinx config --max-model-calls ${DEFAULT_CONFIG.maxModelCalls}`, 'sphinx config --max-model-calls 30 --json'] },
  doctor: { summary: 'Check Git dispatchers and coding-agent integration settings.', usage: 'sphinx doctor [--json]', paragraphs: ['Finds local hook overrides, missing dispatchers, and edited integration settings. Optional agents that were not selected do not count as failures. Codex trust must be reviewed in /hooks; Sphinx cannot verify it.'], groups: [['Output', common]], examples: ['sphinx doctor', 'sphinx install --repo'], footer: 'Exit status is 0 when checks pass and 1 when something needs attention. No model calls or configuration changes.' },
  auth: { summary: 'Save or replace your OpenRouter API key.', usage: 'sphinx auth', paragraphs: ['Prompts for a key with hidden input. The key is stored in a user-only credentials.json file outside repositories; this is a local file, not an OS keychain.', 'For scripts, set OPENROUTER_API_KEY instead. Free models also require a key. Codex/Claude use their own CLI authentication.'], groups: [['Output', [common[0]]]], examples: ['sphinx auth'], footer: 'Create a key at https://openrouter.ai/settings/keys. Never put it in .sphinxconfig or commit it to Git.' },
  uninstall: { summary: 'Remove Sphinx integrations and restore previous hooks.', usage: 'sphinx uninstall [--repo]', paragraphs: ['Removes unchanged Sphinx files and agent handlers, preserving unrelated settings and later user edits. Configuration, credentials, and assessment state remain for you to keep or delete.', 'Global uninstall leaves explicit repository integrations in place. Remove those in each repository before removing the npm package.'], groups: [['Scope', [['--repo', 'Remove only this repository’s explicit hook integration.']]], ['Output', [common[0]]]], examples: ['sphinx uninstall --repo', 'sphinx uninstall', 'npm uninstall -g sphinx-understand'], footer: 'Run Sphinx uninstall before npm uninstall. Resolve warnings about preserved handlers that still refer to Sphinx before removing its executable.' },
};

export function printHelp(ui, command, { json = false } = {}) {
  if (command && !HELP[command]) throw new Error(`Unknown command ${command}. Run sphinx --help.`);
  const data = command ? { command, ...HELP[command] } : { command: 'sphinx', summary: 'Outsource your thinking, not your understanding.', commands: Object.fromEntries(Object.entries(HELP).map(([name, help]) => [name, help.summary])) };
  if (json) { console.log(JSON.stringify(data, null, 2)); return; }
  if (!command) {
    ui.banner();
    ui.paragraph('A comprehension checkpoint for agent-assisted development. Git pauses a configured operation; you explain what the change will do.');
    ui.section('Get started');
    ui.rows([['sphinx install', 'Connect Git and coding agents once for this machine.'], ['sphinx init', 'Choose this repository’s policy and excluded paths.'], ['sphinx status', 'See what is covered and whether anything is pending.']]);
    ui.section('At a checkpoint');
    ui.rows([['sphinx check', 'Start or resume the interview.'], ['sphinx pending', 'List unfinished checks.'], ['sphinx explain <id>', 'Get a walkthrough and a new scenario.']]);
    ui.section('Settings and troubleshooting');
    ui.rows([['sphinx activate', 'Open fresh coding-agent sessions with Sphinx.'], ['sphinx config', 'Inspect effective policy, model routes, and file paths.'], ['sphinx doctor', 'Check Git and agent integrations.'], ['sphinx auth', 'Save an OpenRouter key with hidden input.'], ['sphinx uninstall', 'Restore previous hooks and remove integrations.']]);
    ui.blank(); ui.paragraph('Use sphinx <command> --help for options and examples. Installed client adapters automatically open native dialogs or a dedicated Sphinx terminal at checkpoints. Terminal commands also include answer and dispute; use --json for structured output.');
    ui.blank(); ui.note(`Default: pushes to main/master · question caps: ${questionCapsText('standard')} · free OpenRouter route (API key required).`);
    return;
  }
  ui.section(`sphinx ${command}`); ui.paragraph(data.summary); ui.blank(); ui.command(data.usage);
  for (const paragraph of data.paragraphs || []) { ui.blank(); ui.paragraph(paragraph); }
  for (const [title, rows] of data.groups || []) { ui.section(title); ui.rows(rows); }
  if (data.examples?.length) { ui.section('Examples'); for (const example of data.examples) ui.command(example); }
  if (data.footer) { ui.blank(); ui.note(data.footer); }
  ui.blank();
}

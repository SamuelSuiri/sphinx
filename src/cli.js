import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { getPaths, loadConfig, saveConfig, saveOpenRouterKey, openRouterKey, validateConfig, repositoryConfigInfo } from './config.js';
import { initializeRepository } from './repo-config.js';
import * as git from './git.js';
import { install, uninstall, doctor, dispatchHook } from './install.js';
import { agentHook } from './agent.js';
import { createSessionStore } from './sessions.js';
import { parseRoute } from './routing.js';
import { createTerminal, withProgress } from './terminal.js';
import { HELP, printHelp } from './help.js';
import { askInstall, askPolicy, createPrompts, questionCapsText, routeText, splitList } from './prompts.js';
import { queuePresentation } from './presentations.js';

const CLI_PATH = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));
const POLICY_FLAGS = ['branches', 'events', 'level', 'mode', 'remotes'];
const OPTIONS = {
  install: ['yes', 'repo', 'agents', 'provider', 'model', 'small', 'medium', 'large', 'allow-paid', ...POLICY_FLAGS],
  init: ['yes', 'json', ...POLICY_FLAGS], check: ['json', 'id', 'remote', 'branch', 'staged'],
  answer: ['json', 'text'], explain: ['json'], dispute: ['json', 'text'], pending: ['json'],
  status: ['json'], config: ['json'], doctor: ['json'], auth: [], uninstall: ['repo'],
  mcp: [],
};
const json = value => console.log(JSON.stringify(value, null, 2));
const ui = () => createTerminal();
const cancelled = () => Object.assign(new Error('Cancelled. No further changes were made.'), { code: 'SPHINX_CANCELLED', exitCode: 130 });

async function readStdin() {
  let value = '';
  for await (const chunk of process.stdin) { value += chunk; if (value.length > 2e6) throw new Error('Hook input too large.'); }
  return value;
}

async function withReadline(operation, { output = process.stdout, terminal = true } = {}) {
  const rl = createInterface({ input: process.stdin, output, terminal });
  let closed = false;
  rl.on('close', () => { closed = true; });
  rl.on('SIGINT', () => rl.close());
  const ask = prompt => {
    if (closed) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const onClose = () => reject(cancelled());
      rl.once('close', onClose);
      rl.question(prompt).then(answer => { rl.off('close', onClose); resolve(answer); }, error => { rl.off('close', onClose); reject(closed ? cancelled() : error); });
    });
  };
  try { return await operation(ask); } finally { rl.close(); }
}

async function repoConfig(cwd = process.cwd()) {
  const repo = await git.repository(cwd);
  return { repo, config: await loadConfig(repo.root) };
}
const store = createSessionStore({ validate: async (snapshot, config) => {
  if (!(await git.revalidateSnapshot(snapshot, config))) throw new Error('The code or ignore policy changed since this checkpoint. Retry the Git operation or run sphinx check with an explicit target.');
} });

async function gate({ event, args, input, cwd }) {
  if (process.env.SPHINX_EVALUATOR === '1') return 0;
  const { config } = await repoConfig(cwd);
  const snapshots = event === 'pre-push'
    ? await git.pushSnapshots({ cwd, remote: args[0], remoteUrl: args[1], input, config })
    : event === 'pre-commit' ? [await git.commitSnapshot({ cwd, config })].filter(Boolean) : [];
  let pending = 0;
  for (const snapshot of snapshots) {
    if (await store.approved(snapshot, config)) continue;
    const session = await store.ensure(snapshot, config); pending++;
    await queuePresentation(session);
    // Git hook output is always plain, including when FORCE_COLOR is set.
    console.error(`Sphinx: understanding check needed for ${snapshot.target.ref} (${session.route.tier} change).`);
    console.error('The installed agent hook opens the Sphinx questionnaire automatically. Complete it yourself, then retry.');
    console.error(`Outside a supported agent, run sphinx check --id ${session.id} in your terminal.`);
  }
  if (pending && config.mode === 'advisory') console.error('Sphinx: advisory mode; allowing this operation with an incomplete assessment.');
  return pending && config.mode === 'block' ? 1 : 0;
}

export function applyInstallOptions(current, values) {
  const config = structuredClone(current);
  for (const key of ['provider', 'model', 'level', 'mode']) if (values[key] !== undefined) config[key] = values[key];
  for (const key of ['branches', 'events', 'remotes']) if (values[key] !== undefined) config[key] = splitList(values[key]);
  if (values.provider !== undefined || values.model !== undefined) {
    if (values.provider !== undefined && values.model === undefined) config.model = values.provider === 'openrouter' ? 'openrouter/free' : null;
    for (const tier of ['small', 'medium', 'large']) config.models[tier] = { provider: config.provider, model: config.model };
  }
  for (const tier of ['small', 'medium', 'large']) if (values[tier] !== undefined) config.models[tier] = parseRoute(values[tier]);
  if (values['allow-paid']) config.allowPaid = true;
  validateConfig(config);
  if (values.agents !== undefined && !['auto', 'codex', 'claude', 'codex,claude', 'claude,codex', 'none'].includes(values.agents)) throw new Error('--agents must be auto, codex, claude, codex,claude, or none.');
  for (const route of Object.values(config.models)) {
    if (route.provider === 'openrouter' && route.model && route.model !== 'openrouter/free' && !route.model.endsWith(':free') && !config.allowPaid) throw new Error(`Model ${route.model} may be paid. Explicitly pass --allow-paid or choose a free route.`);
  }
  return config;
}

function policyRows(config) {
  const enabled = config.enabled;
  return [
    ['Push checkpoints', enabled && config.events.includes('pre-push') ? `Destination branches: ${config.branches.join(', ') || 'none'}. Remotes: ${config.remotes.join(', ') || 'none'}.` : 'Off. Local pushes are not checked by this policy.'],
    ['Commit checkpoints', enabled && config.events.includes('pre-commit') ? `Staged changes on local branches: ${config.branches.join(', ') || 'none'}.` : 'Off. Local commits are not checked by this policy.'],
    ['Depth', `${config.level} · question caps: ${questionCapsText(config.level)}`],
    ['Behavior', !enabled ? 'Disabled for this repository' : config.mode === 'block' ? 'Pause the Git operation until the check is complete' : 'Advisory: record a check and allow the Git operation'],
  ];
}

function printConfiguration(terminal, config, { routes = true } = {}) {
  terminal.rows(policyRows(config));
  if (routes) {
    terminal.section('Evaluator routes');
    terminal.rows(['small', 'medium', 'large'].map(tier => [tier[0].toUpperCase() + tier.slice(1), routeText(config.models[tier])]));
    terminal.blank(); terminal.note(`Up to ${config.maxModelCalls} model calls per assessment, including failed requests. Completion lasts ${config.receiptHours} hours unless code, destination, or policy changes.`);
  }
}

function printInstallationResult(terminal, result) {
  terminal.blank();
  for (const line of result.messages) terminal.success(line);
  for (const line of result.warnings) terminal.warning(line);
}

async function auth() {
  if (!process.stdin.isTTY) throw new Error('Use OPENROUTER_API_KEY in noninteractive environments; sphinx auth requires a terminal.');
  const terminal = ui();
  terminal.section('OpenRouter API key'); terminal.paragraph('Free models also require a key. Create one at:');
  terminal.command('https://openrouter.ai/settings/keys');
  terminal.blank(); terminal.note('Input is hidden. The key stays in a user-only credentials file outside your repositories.');
  for (;;) {
    const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    process.stdout.write('\nAPI key: ');
    let key;
    try { key = await withReadline(ask => ask(''), { output: hidden }); } finally { process.stdout.write('\n'); }
    if (!key.trim() || /\s/.test(key.trim())) { terminal.warning('Enter a nonempty key without spaces, or press Ctrl+C to cancel.'); continue; }
    await saveOpenRouterKey(key);
    terminal.success('OpenRouter key saved.'); terminal.note(getPaths().credentials); return;
  }
}

async function installCommand(initial) {
  const terminal = ui(), current = await loadConfig();
  if (initial.repo) {
    const incompatible = Object.keys(initial).filter(key => !['repo', 'yes'].includes(key));
    if (incompatible.length) throw new Error(`install --repo only repairs repository hook coverage. Remove ${incompatible.map(key => `--${key}`).join(', ')} or run global sphinx install separately.`);
    terminal.banner(); terminal.section('Connect this repository');
    printInstallationResult(terminal, await install({ config: current, agents: 'none', repo: true, cliPath: CLI_PATH })); return 0;
  }
  applyInstallOptions(current, initial);
  if (!initial.yes && !process.stdin.isTTY) throw new Error('Run sphinx install in a terminal for guided setup, or use --yes with your chosen options. See sphinx install --help.');
  terminal.banner(); terminal.paragraph('Connect Git and your coding agents once for this machine. Existing hooks and unrelated agent settings are preserved.');
  const values = initial.yes ? initial : await withReadline(ask => askInstall(current, initial, createPrompts({ ask, ui: terminal })));
  const config = applyInstallOptions(current, values);
  terminal.section('Your setup'); printConfiguration(terminal, config);
  terminal.rows([['Agent integrations', values.agents || 'auto (detect installed agents)']]);
  if (Object.values(config.models).some(route => route.provider === 'openrouter') && !(await openRouterKey())) {
    if (process.stdin.isTTY && !values.yes) await auth();
    else throw new Error('OpenRouter requires a key before installation. Set OPENROUTER_API_KEY or run sphinx auth. Alternatively choose --provider codex or --provider claude.');
  }
  const result = await install({ config, agents: values.agents || 'auto', cliPath: CLI_PATH });
  await saveConfig(config); printInstallationResult(terminal, result);
  terminal.section('Next'); terminal.command('sphinx status');
  terminal.note('Use sphinx init for repository policy and excluded paths. Restart agent sessions to load the integration.');
  terminal.blank(); terminal.note(`Global settings: ${getPaths().config}`); return 0;
}

async function initCommand(initial) {
  const { repo, config } = await repoConfig(), info = await repositoryConfigInfo(repo.root), terminal = ui();
  let values = initial;
  if (!initial.json) { terminal.banner(); terminal.section('Repository setup'); terminal.note(repo.root); }
  if (!info.exists || info.legacy) {
    applyInstallOptions(config, initial);
    if (!initial.yes && !initial.json) {
      if (!process.stdin.isTTY) throw new Error('Run sphinx init in a terminal, or use --yes to accept inherited defaults. See sphinx init --help.');
      if (info.legacy) terminal.note('Existing .sphinx.json policy will be carried into .sphinxconfig; the legacy file remains.');
      values = await withReadline(ask => askPolicy(config, initial, createPrompts({ ask, ui: terminal })));
    }
  }
  const overrides = {};
  for (const key of ['level', 'mode']) if (values[key] !== undefined) overrides[key] = values[key];
  for (const key of ['branches', 'events', 'remotes']) if (values[key] !== undefined) overrides[key] = splitList(values[key]);
  const result = await initializeRepository({ repoRoot: repo.root, config, overrides });
  if (initial.json) { json(result); return 0; }
  terminal.blank();
  for (const file of result.created) terminal.success(`Created ${path.basename(file)}`);
  for (const file of result.preserved) terminal.note(`Preserved ${path.basename(file)}`);
  if (info.exists && !info.legacy && Object.keys(overrides).length) terminal.warning('The existing .sphinxconfig was preserved; command-line overrides were not applied. Edit that file to change its policy.');
  terminal.section('Effective repository policy'); printConfiguration(terminal, await loadConfig(repo.root), { routes: false });
  terminal.blank(); terminal.paragraph('Add project-specific sensitive or generated paths to .sphinxignore before an assessment.');
  terminal.note('This command does not install Git hooks. Check coverage with sphinx status.'); return 0;
}

function printSession(session, terminal = ui()) {
  if (session.feedback) {
    terminal.section(session.verdict === 'incorrect' ? 'Review this concept' : session.verdict === 'ambiguous' ? 'Clarification needed' : 'Feedback'); terminal.paragraph(session.feedback);
  }
  if (session.status === 'passed') { terminal.blank(); terminal.success('Understanding check complete.'); terminal.paragraph('Retry your original Git operation.'); return; }
  terminal.blank(); terminal.note(`${session.route.tier} change · ${routeText(session.route)} · ${session.usage.calls}/${session.usage.limit} model calls`);
  if (!session.question) { terminal.paragraph('Assessment queued. Run sphinx check to begin.'); return; }
  terminal.section(`Question ${session.progress.completed + 1} of ${session.progress.total}`); terminal.paragraph(session.question.prompt);
  if (session.question.choices.length) { terminal.blank(); terminal.rows(session.question.choices.map((choice, index) => [`${index + 1}.`, choice])); }
  terminal.blank(); terminal.note('Give a prediction and a short reason. /learn for help · /dispute <reason> · /quit to save progress');
}

async function checkCommand(values) {
  const { repo, config } = await repoConfig(); let session;
  if (values.id) session = await store.read(values.id);
  else if (!values.staged && !values.remote && !values.branch) {
    for (const candidate of await store.pending(repo.root)) if (await git.revalidateSnapshot(candidate.snapshot, config)) { session = candidate; break; }
  }
  if (session && session.snapshot.repoRoot !== repo.root) throw new Error('This checkpoint belongs to a different repository.');
  if (!session) {
    const snapshot = values.staged ? await git.commitSnapshot({ cwd: repo.root, config }) : await git.manualSnapshot({ cwd: repo.root, config, remote: values.remote, branch: values.branch });
    if (!snapshot) { if (values.json) json({ status: 'not-required' }); else ui().success('No assessment required by the current policy.'); return 0; }
    session = await store.ensure(snapshot, config);
  }
  if (!values.json && !process.stdin.isTTY) throw new Error('Use sphinx check --json from a coding agent, or run in an interactive terminal.');
  let state = await withProgress(`Preparing questions with ${routeText(session.route)}`, () => store.start(session.id, config), { enabled: !values.json });
  if (values.json) { json(state); return 0; }
  const terminal = ui(); terminal.section('Understanding check'); terminal.paragraph('This is open-book. Inspect the code when useful; explain the behavior in your own words.');
  return withReadline(async ask => {
    while (state.status !== 'passed') {
      printSession(state, terminal);
      const answer = (await ask('\nYour answer: ')).trim();
      if (answer === '/quit') { terminal.note('Progress saved. Run sphinx check when you are ready to continue.'); return 1; }
      if (!answer) continue;
      const dispute = answer.startsWith('/dispute '), learn = answer === '/learn';
      if (answer === '/dispute') { terminal.warning('Add a reason: /dispute <what is ambiguous or unsupported>'); continue; }
      if (answer.startsWith('/') && !dispute && !learn) { terminal.warning('Use /learn, /dispute <reason>, or /quit; otherwise enter your answer.'); continue; }
      state = await withProgress(learn ? 'Preparing an explanation and new scenario' : dispute ? 'Reviewing the question' : 'Checking your reasoning', () => store.answer(session.id, learn ? 'I do not know. Explain this concept and give me a different scenario to apply it to.' : dispute ? answer.slice(9) : answer, config, { dispute, learn }));
    }
    printSession(state, terminal); return 0;
  });
}

function printPending(terminal, pending) {
  if (!pending.length) { terminal.success('No pending assessments.'); return; }
  for (const session of pending) {
    terminal.section(`${session.target} · ${session.status}`);
    terminal.paragraph(`${session.route.tier} change · ${routeText(session.route)} · ${session.progress.completed}/${session.progress.total} concepts complete · ${session.usage.calls}/${session.usage.limit} model calls`);
    terminal.command(`sphinx check --id ${session.id}`);
  }
}

async function statusCommand(command, values) {
  const { repo, config } = await repoConfig(), pending = [];
  for (const session of await store.pending(repo.root)) if (await git.revalidateSnapshot(session.snapshot, config)) pending.push(store.public(session));
  if (values.json) { json(command === 'status' ? { repo: repo.root, config, pending } : pending); return 0; }
  const terminal = ui();
  if (command === 'pending') { terminal.section('Pending assessments'); printPending(terminal, pending); return 0; }
  const info = await repositoryConfigInfo(repo.root), report = await doctor();
  const coverage = report.checks.filter(check => check.name === 'Current repository' || check.name.endsWith('dispatcher'));
  const active = coverage.length > 0 && coverage.every(check => check.ok);
  const branch = await promisify(execFile)('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repo.root }).then(result => result.stdout.trim()).catch(() => 'detached HEAD');
  terminal.section('Repository status');
  terminal.rows([['Repository', repo.root], ['Current local branch', branch], ['Git integration', active ? 'Active · Sphinx dispatchers are configured' : 'Not active or needs repair · run sphinx doctor'], ['Repository policy', info.exists ? `${info.path}${info.legacy ? ' (legacy)' : ''}` : 'Global defaults; use sphinx init to create .sphinxconfig']]);
  if (info.shadowed) terminal.warning(`${info.shadowed} is ignored because .sphinxconfig takes precedence.`);
  terminal.section('Configured checkpoints'); printConfiguration(terminal, config, { routes: false });
  if (!active) { terminal.blank(); terminal.warning('Policy alone does not install hooks. Use sphinx install, or sphinx install --repo when this repository overrides core.hooksPath.'); }
  terminal.section('Pending assessments'); printPending(terminal, pending);
  terminal.blank(); terminal.note('Status uses local Git state only. Agent hook trust is not verified here.'); return 0;
}

export async function main(argv) {
  if (argv[0] === 'mcp' && argv.length === 1) {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer(); return 0;
  }
  if (argv[0] === 'hook') {
    if (process.env.SPHINX_EVALUATOR === '1') return 0;
    if (argv[1] === 'git') {
      const event = argv[2], input = event === 'pre-push' ? await readStdin() : '';
      return dispatchHook({ event, args: argv.slice(3), input, cwd: process.cwd(), env: process.env, gate });
    }
    if (argv[1] === 'agent') {
      const result = await agentHook({ agent: argv[2], input: await readStdin(), cwd: process.cwd(), env: process.env });
      if (result.output) console.log(JSON.stringify(result.output)); return result.exitCode;
    }
    throw new Error('Unknown hook entry point.');
  }
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' }, yes: { type: 'boolean' }, repo: { type: 'boolean' }, staged: { type: 'boolean' },
    provider: { type: 'string' }, model: { type: 'string' }, small: { type: 'string' }, medium: { type: 'string' }, large: { type: 'string' }, level: { type: 'string' }, branches: { type: 'string' }, events: { type: 'string' }, agents: { type: 'string' }, mode: { type: 'string' }, remotes: { type: 'string' },
    remote: { type: 'string' }, branch: { type: 'string' }, id: { type: 'string' }, text: { type: 'string' }, 'allow-paid': { type: 'boolean' },
  } });
  const [command, id] = positionals;
  if (values.version) { if (values.json) json({ version: '0.1.0' }); else console.log('0.1.0'); return 0; }
  if (values.help || !command || command === 'help') { printHelp(ui(), command === 'help' ? id : command, { json: values.json }); return 0; }
  if (!HELP[command]) throw new Error(`Unknown command ${command}. Run sphinx --help.`);
  for (const key of Object.keys(values)) if (!OPTIONS[command].includes(key)) throw new Error(`--${key} is not an option for ${command}. Run sphinx ${command} --help.`);
  const needsId = ['answer', 'explain', 'dispute'].includes(command);
  if (positionals.length > (needsId ? 2 : 1)) throw new Error(`Unexpected argument. Usage: ${HELP[command].usage}`);
  if (needsId && !id) throw new Error(`An assessment ID is required. Run sphinx pending to find it. Usage: ${HELP[command].usage}`);
  if (['answer', 'dispute'].includes(command) && !values.text?.trim()) throw new Error(`--text is required. Usage: ${HELP[command].usage}`);
  if (command === 'install') return installCommand(values);
  if (command === 'init') return initCommand(values);
  if (command === 'auth') { await auth(); return 0; }
  if (command === 'uninstall') { printInstallationResult(ui(), await uninstall({ repo: !!values.repo })); return 0; }
  if (command === 'doctor') {
    const result = await doctor();
    if (values.json) json(result);
    else {
      const terminal = ui(); terminal.section('Integration health');
      for (const check of result.checks) { terminal.blank(); (check.ok ? terminal.success : terminal.warning)(check.name); terminal.paragraph(check.detail, '  '); }
      terminal.blank(); (result.checks.every(check => check.ok) ? terminal.success : terminal.warning)(result.checks.every(check => check.ok) ? 'Configured integrations are in place.' : 'Some integrations need attention. See the steps above.');
    }
    return result.checks.every(check => check.ok) ? 0 : 1;
  }
  if (command === 'config') {
    const repo = await git.repository(process.cwd()).catch(() => null), config = await loadConfig(repo?.root);
    if (values.json) { json(config); return 0; }
    const terminal = ui(); terminal.section('Effective configuration'); terminal.rows([['Global settings', getPaths().config]]);
    if (repo) {
      const info = await repositoryConfigInfo(repo.root);
      terminal.rows([['Repository policy', info.exists ? `${info.path}${info.legacy ? ' (legacy)' : ''}` : 'None; global policy applies']]);
      if (info.shadowed) terminal.warning(`Legacy ${info.shadowed} is shadowed by .sphinxconfig.`);
    }
    terminal.section('Checkpoint policy'); printConfiguration(terminal, config);
    terminal.section('Limits and exclusions'); terminal.rows([['Evidence', `${config.maxContextBytes.toLocaleString()} bytes per assessment`], ['Model timeout', `${config.timeoutSeconds} seconds per request`], ['Configured exclusions', config.exclude.join(', ') || 'None beyond built-in rules and ignore files']]);
    terminal.blank(); terminal.note('Edit the listed files to change settings. Use sphinx config --json for every effective field.'); return 0;
  }
  if (command === 'check') return checkCommand(values);
  if (['pending', 'status'].includes(command)) return statusCommand(command, values);
  if (needsId) {
    const { repo, config } = await repoConfig(), existing = await store.read(id);
    if (existing.snapshot.repoRoot !== repo.root) throw new Error('This checkpoint belongs to a different repository.');
    const learn = command === 'explain', dispute = command === 'dispute';
    const result = await withProgress(learn ? 'Preparing an explanation and new scenario' : dispute ? 'Reviewing the question' : 'Checking your reasoning', () => store.answer(id, learn ? 'I do not know. Explain this concept and give me a different scenario to apply it to.' : values.text, config, { learn, dispute }), { enabled: !values.json });
    if (values.json) json(result); else printSession(result); return 0;
  }
}

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lstat, readFile, mkdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { listPresentations, claimPresentation } from './presentations.js';
import { launchCheckpointTerminal, waitForCheckpointTerminal } from './terminal-launch.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sessionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : undefined;
const HERE = fileURLToPath(import.meta.url);

export const TERMINAL_GUIDANCE = [
  'Sphinx checks the human\'s understanding at Git checkpoints selected by .sphinxconfig.',
  'Git alone decides when a checkpoint is required. Do not alter policy or bypass its hooks.',
  'This integration automatically opens a separate Sphinx terminal window for the exact queued checkpoint and waits for the human\'s result. The human answers directly in that window. Do not open another interview or poll for answers.',
  'If automatic terminal opening is unavailable, the notice gives a manual fallback: the human runs `sphinx check` in their own terminal in the checked repository.',
  'Never run the interview or answer, explain, or dispute commands for the human. Do not relay questions or answers through chat, read private Sphinx session files or answer keys, or automate the questionnaire.',
  'Respect .sphinxignore and configured exclusions. The independent evaluator only sees permitted immutable Git evidence.',
  'The human can learn, dispute, or pause inside the terminal questionnaire. Retry a blocked Git operation only after they complete the check; do not repeat advisory operations that already proceeded.',
].join('\n');

export function lifecycleHome(name, paths, env = process.env) {
  if (name === 'cursor') return path.join(paths.userHome, '.cursor');
  if (name === 'opencode') {
    if (!env.SPHINX_USER_HOME && env.OPENCODE_CONFIG_DIR) return path.resolve(env.OPENCODE_CONFIG_DIR);
    return path.join(!env.SPHINX_USER_HOME && env.XDG_CONFIG_HOME || path.join(paths.userHome, '.config'), 'opencode');
  }
  throw new Error(`Unsupported lifecycle integration: ${name}`);
}

async function text(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error(`Refusing to replace a symlink, non-file, or oversized integration: ${file}`);
    return await readFile(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function checkDirectories(home, file) {
  for (const directory of new Set([home, path.dirname(file)])) {
    const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Refusing to change a symlinked or non-directory integration path: ${directory}`);
  }
}

function json(content, file) {
  if (content === null) return {};
  try { const value = JSON.parse(content); if (!object(value)) throw new Error(); return value; }
  catch { throw new Error(`Cannot read ${file}: invalid JSON object. Fix the file and try again.`); }
}

async function write(file, content) {
  if (content === null) { await rm(file, { force: true }); return; }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const mode = await stat(file).then(info => info.mode & 0o777).catch(() => 0o600);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { mode, flag: 'wx' }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

function plan({ name, file, before, after, record, warnings }) {
  return {
    name, record, warnings,
    async commit() {
      await checkDirectories(record.home, file);
      if (await text(file) !== before) throw new Error(`Settings changed during installation: ${file}. Retry installation.`);
      if (before !== after) await write(file, after);
    },
    async rollback() { if (await text(file) === after) await write(file, before); },
  };
}

/** Cursor exposes command hooks, but no documented hook that invokes MCP forms. */
export async function prepareCursorIntegration(paths, { env = process.env, previous } = {}) {
  const home = lifecycleHome('cursor', paths, env), file = path.join(home, 'hooks.json');
  await checkDirectories(home, file);
  if (previous && previous.file !== file) throw new Error('Cursor integration home changed. Uninstall from the original home before reinstalling.');
  const before = await text(file), document = json(before, file);
  if (document.version !== undefined && document.version !== 1) throw new Error(`Unsupported Cursor hooks version in ${file}`);
  if (document.hooks !== undefined && !object(document.hooks)) throw new Error(`Invalid hooks object in ${file}`);
  const command = `SPHINX_HOME=${quote(paths.home)} ${quote(process.execPath)} ${quote(fileURLToPath(new URL('./cursor-hook.js', import.meta.url)))}`;
  const hooks = [
    { event: 'sessionStart', handler: { command, timeout: 10 } },
    { event: 'postToolUse', handler: { command, timeout: 1800, matcher: '^Shell$' } },
    { event: 'postToolUseFailure', handler: { command, timeout: 1800, matcher: '^Shell$' } },
  ];
  for (const { event } of hooks) {
    const entries = document.hooks?.[event];
    if (entries !== undefined && (!Array.isArray(entries) || entries.some(item => !object(item)))) throw new Error(`Invalid ${event} hooks in ${file}`);
  }
  for (const { event, handler } of previous?.hooks || []) {
    const entries = document.hooks?.[event] || [];
    if (entries.some(item => item.command === handler.command && !same(item, handler))) throw new Error(`Refusing to replace an edited cursor integration in ${file}. Uninstall first to preserve your edits.`);
    if (entries.some(item => same(item, handler))) document.hooks[event] = entries.filter(item => !same(item, handler));
  }
  const emptyEvents = previous?.emptyEvents ?? hooks.filter(({ event }) => document.hooks?.[event]?.length === 0).map(({ event }) => event);
  const record = { kind: 'cursor-terminal-v1', home, file, hooks, emptyEvents, existed: previous?.existed ?? before !== null, hooksExisted: previous?.hooksExisted ?? document.hooks !== undefined, versionExisted: previous?.versionExisted ?? document.version !== undefined };
  document.version = 1; document.hooks ??= {};
  for (const { event, handler } of hooks) {
    document.hooks[event] ??= [];
    if (!document.hooks[event].some(item => same(item, handler))) document.hooks[event].push(handler);
  }
  return plan({ name: 'cursor', file, before, after: `${JSON.stringify(document, null, 2)}\n`, record,
    warnings: ['Cursor automatically opens a separate Sphinx terminal window for human answers on supported desktops. macOS may request permission to control Terminal. Headless sessions use a manual fallback. User hooks apply locally, not to cloud agents. Start a new session after installation.'] });
}

/** OpenCode 1.x local JS plugins load without changing opencode.json/JSONC. */
export async function prepareOpenCodeIntegration(paths, { env = process.env, previous } = {}) {
  const home = lifecycleHome('opencode', paths, env), file = path.join(home, 'plugins', 'sphinx.js');
  await checkDirectories(home, file);
  if (previous && previous.file !== file) throw new Error('OpenCode integration home changed. Uninstall from the original home before reinstalling.');
  const before = await text(file);
  const after = `// Managed by Sphinx. OpenCode 1.x lifecycle integration.\nimport { registerOpenCodeIntegration } from ${JSON.stringify(pathToFileURL(HERE).href)};\nexport const SphinxPlugin = async context => registerOpenCodeIntegration(context, { home: ${JSON.stringify(paths.home)} });\n`;
  if (before !== null && before !== after && (!previous || hash(before) !== previous.digest)) throw new Error(`Refusing to replace an existing or edited OpenCode plugin: ${file}`);
  return plan({ name: 'opencode', file, before, after, record: { kind: 'opencode-terminal-v1', home, file, digest: hash(after) },
    warnings: ['OpenCode 1.x automatically opens a separate Sphinx terminal window for human answers on supported desktops. macOS may request permission to control Terminal. Headless sessions use a manual fallback. Restart OpenCode to load the plugin.'] });
}

export async function removeLifecycleIntegration(_paths, record) {
  const warnings = [];
  await checkDirectories(record.home, record.file);
  const before = await text(record.file);
  if (before === null) return warnings;
  if (record.kind === 'opencode-terminal-v1') {
    if (hash(before) === record.digest) await rm(record.file);
    else warnings.push(`Preserved edited OpenCode plugin: ${record.file}`);
    return warnings;
  }
  const document = json(before, record.file);
  for (const { event, handler } of record.hooks || []) {
    const entries = document.hooks?.[event];
    if (!Array.isArray(entries) || !entries.some(item => same(item, handler))) { warnings.push(`Preserved removed or edited Cursor ${event} hook in ${record.file}.`); continue; }
    document.hooks[event] = entries.filter(item => !same(item, handler));
    if (!document.hooks[event].length && !record.emptyEvents?.includes(event)) delete document.hooks[event];
  }
  if (document.hooks && !Object.keys(document.hooks).length && !record.hooksExisted) delete document.hooks;
  if (!record.versionExisted && document.version === 1) delete document.version;
  if (await text(record.file) !== before) throw new Error(`Settings changed during uninstall: ${record.file}. Retry uninstall.`);
  await write(record.file, !record.existed && !Object.keys(document).length ? null : `${JSON.stringify(document, null, 2)}\n`);
  return warnings;
}

export async function lifecycleIntegrationStatus(_paths, { record } = {}) {
  if (!record) return { installed: false, healthy: false };
  try {
    await checkDirectories(record.home, record.file);
    const content = await text(record.file);
    const healthy = record.kind === 'opencode-terminal-v1' ? content !== null && hash(content) === record.digest
      : content !== null && record.hooks.every(({ event, handler }) => json(content, record.file).hooks?.[event]?.some(item => same(item, handler)));
    return { installed: true, healthy, file: record.file };
  } catch { return { installed: true, healthy: false, file: record.file }; }
}

/** Read only routing metadata. Never load questions, answers, source, or tool output. */
export async function terminalHandoff({ cwd, host, hostSession, checkpointIds, env = process.env, listRequests = listPresentations, claimRequest = claimPresentation, launch = launchCheckpointTerminal, waitForResult = waitForCheckpointTerminal } = {}) {
  if (env.SPHINX_EVALUATOR === '1' || !cwd) return null;
  const requests = await listRequests({ cwd, host, hostSession, ...(checkpointIds?.length ? { checkpointIds } : {}), env });
  const opened = [];
  let unavailable = 0;
  for (const request of requests) {
    const result = await launch({ request, env });
    if (result.status === 'unavailable') { unavailable++; continue; }
    if (!['opened', 'already-open', 'passed'].includes(result.status)) continue;
    if (await claimRequest(request, { env })) opened.push({ request, status: result.status });
  }
  const outcomes = await Promise.all(opened.map(async ({ request, status }) => status === 'passed' ? 'passed' : waitForResult({ id: request.id, env })));
  if (!outcomes.length && !unavailable) return null;
  const completed = outcomes.filter(status => status === 'passed').length;
  unavailable += outcomes.filter(status => ['unavailable', 'interrupted'].includes(status)).length;
  if (unavailable) return `Sphinx could not open a desktop terminal or keep its questionnaire running for ${unavailable === 1 ? 'a checkpoint' : `${unavailable} checkpoints`}. The checkpoint remains pending. The human can run \`sphinx check\` in their own terminal in the checked repository. Check desktop availability or Terminal automation permission before retrying the original Git operation. Do not open another interview, relay questions, answer for the human, or repeatedly retry Git.`;
  if (completed === outcomes.length) return 'Sphinx understanding check completed directly in its terminal window. Retry only the original Git operation that was blocked; Git will verify the exact code and policy again. Do not repeat advisory operations that already proceeded.';
  return 'The Sphinx terminal questionnaire remains incomplete or is still open. The human answers directly there. Do not open another interview, relay questions, answer for the human, poll for answers, or repeatedly retry Git. Wait for the human before continuing a blocked Git operation.';
}

/** Read only Sphinx's exact emitted marker, never interpret or execute shell text. */
export function cursorCheckpointIds({ tool_output, error_message } = {}) {
  const strings = [];
  if (typeof tool_output === 'string' && Buffer.byteLength(tool_output) <= 1024 * 1024) {
    try {
      const output = JSON.parse(tool_output);
      if (object(output)) for (const key of ['stdout', 'stderr', 'output']) if (typeof output[key] === 'string') strings.push(output[key]);
    } catch { /* Cursor documents a JSON result payload; unknown shapes add no routing hints. */ }
  }
  if (typeof error_message === 'string' && Buffer.byteLength(error_message) <= 1024 * 1024) strings.push(error_message);
  const ids = new Set();
  for (const value of strings) {
    for (const match of value.matchAll(/(?:^|\r?\n)Outside a supported agent, run sphinx check --id ([a-f0-9]{64}) in your terminal\.(?=\r?\n|$)/gu)) {
      ids.add(match[1]);
      if (ids.size === 64) return [...ids];
    }
  }
  return [...ids];
}

export async function cursorAgentHook({ input = {}, env = process.env, handoff = terminalHandoff } = {}) {
  if (env.SPHINX_EVALUATOR === '1') return {};
  const event = input.hook_event_name;
  if (event === 'sessionStart') return { additional_context: TERMINAL_GUIDANCE, ...(sessionId(input.session_id || input.conversation_id) ? { env: { SPHINX_CURSOR_SESSION: sessionId(input.session_id || input.conversation_id) } } : {}) };
  if (!['postToolUse', 'postToolUseFailure'].includes(event) || input.tool_name !== 'Shell') return {};
  try {
    const checkpointIds = cursorCheckpointIds(input);
    const notice = await handoff({ cwd: typeof input.cwd === 'string' ? input.cwd : undefined, host: 'cursor', hostSession: sessionId(input.session_id || input.conversation_id), ...(checkpointIds.length ? { checkpointIds } : {}), env });
    return notice ? { additional_context: notice } : {};
  } catch { return { additional_context: 'Sphinx could not inspect its checkpoint queue. The human can run sphinx doctor and sphinx check in their own terminal. Do not answer for them.' }; }
}

export function registerOpenCodeIntegration({ client, directory }, { home, env = process.env, handoff = terminalHandoff } = {}) {
  const scopedEnv = { ...env, ...(home ? { SPHINX_HOME: home } : {}) };
  if (env.SPHINX_EVALUATOR === '1') return {};
  return {
    'shell.env': async (input, output) => {
      if (home) output.env.SPHINX_HOME = home;
      if (sessionId(input.sessionID)) output.env.SPHINX_OPENCODE_SESSION = input.sessionID;
    },
    'experimental.chat.system.transform': async (_input, output) => { if (!output.system.includes(TERMINAL_GUIDANCE)) output.system.push(TERMINAL_GUIDANCE); },
    'tool.execute.after': async (input, output) => {
      if (input.tool !== 'bash') return;
      let notice;
      try { notice = await handoff({ cwd: directory, host: 'opencode', hostSession: sessionId(input.sessionID), env: scopedEnv }); }
      catch { notice = 'Sphinx could not inspect its checkpoint queue. Run sphinx doctor and sphinx check in your own terminal.'; }
      if (!notice) return;
      // Only a handoff notice reaches the coding agent; the questionnaire stays
      // in the human's terminal. A Git checkpoint remains incomplete meanwhile.
      if (typeof output.output === 'string') output.output += `\n\n${notice}`;
      try { await client?.tui?.showToast({ body: { title: 'Sphinx checkpoint', message: notice, variant: 'info', duration: 10000 } }); } catch { /* The tool output still carries the status when no TUI is attached. */ }
    },
  };
}

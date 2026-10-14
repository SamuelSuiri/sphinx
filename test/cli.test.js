import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const CLI = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));

// A subprocess fixture exercising the real provider transport and output validation.
// It never calls a model or connects to a service.
const PROVIDER = `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.SPHINX_TEST_LOG, JSON.stringify({cwd:process.cwd(),argv:process.argv.slice(2),input,evaluator:process.env.SPHINX_EVALUATOR})+'\\n');
  if (process.env.SPHINX_TEST_FAILURE === '1') process.exit(23);
  const data = JSON.parse(input.slice(input.lastIndexOf('\\n')+1));
  const evidence = [{path:'app.js',reason:'The set records IDs before enqueue returns, so duplicate IDs are rejected in one process.'}];
  const question = {id:'duplicate',concept:'deduplication lifetime',prompt:'In the same running process, enqueue receives the same ID twice. Does the second request enqueue again? Explain why.',choices:['Yes','No'],expectedAnswer:'No, the set already contains the ID.',rationale:'Membership is checked before insertion. The second call returns false.',evidence};
  const followUp = {...question,id:'restart',prompt:'After the process restarts, the same ID arrives again. Can this implementation enqueue it? Explain why.',expectedAnswer:'Yes. The in-memory set is recreated on restart.',rationale:'The deduplication state is only an in-memory set.'};
  let result;
  if (!data.question) result = {questions:[question]};
  else if (data.humanAnswer === 'WRONG' || data.humanAnswer.startsWith('I do not know')) result = {verdict:'incorrect',feedback:'The set belongs to this process. It rejects duplicate IDs until the process restarts; the state is not persisted.',evidence,followUp};
  else if (data.dispute) result = {verdict:'ambiguous',feedback:'The assumptions need clarification.',evidence,followUp};
  else result = {verdict:'correct',feedback:'You connected the observable result to the lifetime of the stored IDs.',evidence,followUp:null};
  process.stdout.write(JSON.stringify({type:'result',subtype:'success',structured_output:result}));
});
`;

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'sphinx-cli-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repo');
  const bare = path.join(base, 'remote.git');
  const bin = path.join(base, 'bin');
  for (const dir of [home, repo, bin]) await mkdir(dir);
  const env = { ...process.env, HOME: home, SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, 'sphinx'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${bin}${path.delimiter}${process.env.PATH}`, SPHINX_TEST_LOG: path.join(base, 'model-calls.jsonl'),
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG', 'SPHINX_EVALUATOR', 'SPHINX_INSTALL_ID', 'SPHINX_HOOK_DEPTH', 'OPENROUTER_API_KEY', 'SPHINX_TEST_FAILURE', 'CODEX_THREAD_ID', 'SPHINX_CLAUDE_SESSION']) delete env[key];
  await writeFile(path.join(bin, 'claude'), PROVIDER, { mode: 0o755 });
  await chmod(path.join(bin, 'claude'), 0o755);
  const run = (command, args, changes = {}) => spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', input: '', timeout: 20000, ...changes });
  const ok = (command, args, changes) => {
    const result = run(command, args, changes);
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}\n${result.error || ''}`);
    return result.stdout.trim();
  };
  const git = (...args) => ok('git', args);
  const cli = (...args) => ok(process.execPath, [CLI, ...args]);
  const cliJson = (...args) => JSON.parse(cli(...args, '--json'));
  git('init', '-q', '-b', 'main');
  git('config', '--local', 'user.name', 'Sphinx Test');
  git('config', '--local', 'user.email', 'sphinx@example.test');
  git('config', '--local', 'commit.gpgsign', 'false');
  git('init', '--bare', '-q', bare);
  git('remote', 'add', 'origin', bare);
  const app = 'const seen = new Set();\nexport function enqueue(id) {\n  if (seen.has(id)) return false;\n  seen.add(id);\n  return true;\n}\n';
  await writeFile(path.join(repo, 'app.js'), app);
  await writeFile(path.join(repo, '.sphinxignore'), '.env\n');
  await writeFile(path.join(repo, '.env'), 'PRIVATE_TEST_SECRET=do-not-transmit-92bfa\n');
  git('add', '.'); git('commit', '-qm', 'Add queue deduplication');
  const calls = async () => (await readFile(env.SPHINX_TEST_LOG, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { base, home, repo, bare, env, run, ok, git, cli, cliJson, calls, app };
}

test('CLI blocks a push, conducts the learning loop, reuses completion, and rejects changed code', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none');
  const blocked = f.run('git', ['push', 'origin', 'main']);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Sphinx: understanding check needed/);
  assert.deepEqual(await f.calls(), [], 'Git hooks must not invoke the evaluator');
  const pending = f.cliJson('pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending');
  assert.equal(pending[0].route.provider, 'claude');
  const first = f.cliJson('check');
  assert.equal(first.id, pending[0].id);
  assert.equal(first.status, 'active');
  assert.equal(first.question.id, 'duplicate');
  assert.equal(Object.hasOwn(first.question, 'expectedAnswer'), false);
  assert.equal(Object.hasOwn(first.question, 'rationale'), false);
  assert.equal((await f.calls()).length, 1);
  // Resuming an existing interview does not spend another generation call.
  assert.equal(f.cliJson('check').question.id, 'duplicate');
  assert.equal((await f.calls()).length, 1);
  const wrong = f.cliJson('answer', first.id, '--text', 'WRONG');
  assert.equal(wrong.verdict, 'incorrect');
  assert.equal(wrong.status, 'active');
  assert.equal(wrong.progress.completed, 0);
  assert.equal(wrong.question.id, 'restart');
  assert.notEqual(wrong.question.prompt, first.question.prompt);
  assert.match(wrong.feedback, /not persisted/);
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  assert.equal((await f.calls()).length, 2);
  const passed = f.cliJson('answer', first.id, '--text', 'Yes. Restart recreates the set, so it cannot remember the previous process\'s IDs.');
  assert.equal(passed.status, 'passed');
  assert.equal(passed.progress.completed, 1);
  assert.equal(Object.hasOwn(passed, 'question'), false);
  const sessionPath = path.join(f.env.SPHINX_HOME, 'sessions', `${first.id}.json`);
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600);
  f.git('push', 'origin', 'main');
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0], f.git('rev-parse', 'HEAD'));
  f.git('push', 'origin', 'main');
  assert.equal((await f.calls()).length, 3);
  assert.deepEqual(f.cliJson('pending'), []);
  await writeFile(path.join(f.repo, 'app.js'), `${f.app}\nexport const maxQueueSize = 100;\n`);
  f.git('add', 'app.js'); f.git('commit', '-qm', 'Expose queue limit');
  const changed = f.run('git', ['push', 'origin', 'main']);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /understanding check needed/);
  assert.notEqual(f.cliJson('pending')[0].id, first.id);
  for (const invocation of await f.calls()) {
    assert.equal(invocation.evaluator, '1');
    assert.notEqual(invocation.cwd, f.repo);
    assert.ok(invocation.argv.includes('--no-session-persistence'));
    assert.equal(invocation.input.includes('do-not-transmit-92bfa'), false);
  }
  f.cli('uninstall');
  assert.notEqual(f.run('git', ['config', '--global', '--get', 'core.hooksPath']).status, 0);
});

test('CLI keeps a failed evaluator pending and enforces the checkpoint on retry', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none');
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  const failure = f.run(process.execPath, [CLI, 'check', '--json'], { env: { ...f.env, SPHINX_TEST_FAILURE: '1' } });
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /No completion was\s+recorded/);
  assert.equal(f.cliJson('pending')[0].status, 'pending');
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  const first = f.cliJson('check');
  const learned = f.cliJson('explain', first.id);
  assert.equal(learned.status, 'active');
  assert.equal(learned.question.id, 'restart');
  assert.equal(learned.progress.completed, 0);
});

test('CLI pre-commit gate assesses staged content without waiting for terminal input', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none', '--events', 'pre-commit');
  await writeFile(path.join(f.repo, 'app.js'), `${f.app}\nexport const retries = 3;\n`);
  f.git('add', 'app.js');
  const commit = f.run('git', ['commit', '-qm', 'Add retries']);
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /understanding check needed/);
  const first = f.cliJson('check', '--staged');
  assert.equal(first.event, 'pre-commit');
  assert.equal(f.cliJson('answer', first.id, '--text', 'No. The set already contains the ID and the function returns false.').status, 'passed');
  f.git('commit', '-qm', 'Add retries');
});

test('CLI init creates canonical main-branch policy without reinstalling hooks or overwriting files', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const ignoreBefore = await readFile(path.join(f.repo, '.sphinxignore'), 'utf8');
  f.cli('init', '--yes', '--branches', 'main', '--events', 'pre-push', '--level', 'standard', '--mode', 'block');
  const configPath = path.join(f.repo, '.sphinxconfig');
  const saved = await readFile(configPath, 'utf8');
  const policy = JSON.parse(saved);
  assert.deepEqual(policy.branches, ['main']);
  assert.deepEqual(policy.events, ['pre-push']);
  assert.equal(policy.level, 'standard');
  assert.equal(policy.mode, 'block');
  for (const key of ['provider', 'model', 'models', 'allowPaid', 'maxModelCalls', 'maxOutputTokens']) assert.equal(Object.hasOwn(policy, key), false);
  assert.equal(await readFile(path.join(f.repo, '.sphinxignore'), 'utf8'), ignoreBefore);
  assert.notEqual(f.run('git', ['config', '--global', '--get', 'core.hooksPath']).status, 0);
  assert.notEqual(f.run('git', ['config', '--local', '--get', 'core.hooksPath']).status, 0);
  await assert.rejects(stat(path.join(f.env.SPHINX_HOME, 'config.json')), { code: 'ENOENT' });
  f.cli('init', '--yes', '--branches', 'release/*', '--level', 'thorough');
  assert.equal(await readFile(configPath, 'utf8'), saved, 'A second init must not replace existing repository policy');
  assert.equal(await readFile(path.join(f.repo, '.sphinxignore'), 'utf8'), ignoreBefore);
  assert.deepEqual(await f.calls(), []);
});

test('CLI init defaults inherit configured destinations rather than the current feature branch', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.git('checkout', '-qb', 'feature/setup');
  const initialized = f.cliJson('init');
  assert.equal(typeof initialized, 'object');
  const policy = JSON.parse(await readFile(path.join(f.repo, '.sphinxconfig'), 'utf8'));
  assert.deepEqual(policy.branches, ['main', 'master']);
  assert.equal(policy.branches.includes('feature/setup'), false);
  assert.deepEqual(await f.calls(), []);
});

test('canonical repository policy controls actual destination pushes through existing global hooks', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none');
  const hooksBefore = f.git('config', '--global', '--get', 'core.hooksPath');
  f.cli('init', '--yes', '--branches', 'release/*', '--events', 'pre-push');
  assert.equal(f.git('config', '--global', '--get', 'core.hooksPath'), hooksBefore);
  f.git('push', 'origin', 'main');
  assert.deepEqual(f.cliJson('pending'), []);
  const release = f.run('git', ['push', 'origin', 'HEAD:refs/heads/release/v1']);
  assert.notEqual(release.status, 0);
  assert.match(release.stderr, /understanding check needed/);
  assert.equal(f.cliJson('pending').length, 1);
  assert.deepEqual(f.cliJson('status').config.branches, ['release/*']);
  assert.deepEqual(await f.calls(), [], 'Policy setup and Git gates must not invoke an evaluator');
});

test('each public CLI command provides contextual help without setup or model calls', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const commands = ['install', 'init', 'auth', 'check', 'pending', 'answer', 'explain', 'dispute', 'status', 'config', 'doctor', 'uninstall'];
  const generalHelp = f.cli('--help');
  for (const command of commands) {
    const optionHelp = f.cli(command, '--help');
    const topicHelp = f.cli('help', command);
    assert.match(optionHelp, new RegExp(`sphinx ${command}`));
    assert.match(topicHelp, new RegExp(`sphinx ${command}`));
    assert.notEqual(optionHelp, generalHelp, 'Command help must describe that command instead of repeating the entire command index');
    assert.equal(optionHelp, topicHelp, 'Both contextual help forms should present the same guidance');
    assert.equal(/\u001b\[/u.test(optionHelp), false, 'Piped help must not contain ANSI styling');
  }
  assert.match(f.cli('init', '--help'), /\.sphinxconfig/);
  assert.match(f.cli('check', '--help'), /--staged/);
  assert.match(f.cli('install', '--help'), /--allow-paid/);
  await assert.rejects(stat(path.join(f.repo, '.sphinxconfig')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(f.env.SPHINX_HOME, 'config.json')), { code: 'ENOENT' });
  assert.deepEqual(await f.calls(), []);
});

test('JSON inspection and out-of-policy checks stay unstyled and require no remote or evaluator', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.git('remote', 'remove', 'origin');
  const env = { ...f.env, FORCE_COLOR: '1' };
  delete env.NO_COLOR;
  const json = (...args) => {
    const raw = f.ok(process.execPath, [CLI, ...args, '--json'], { env });
    assert.equal(/\u001b\[/u.test(raw), false, 'JSON must not contain ANSI even when color is forced');
    return JSON.parse(raw);
  };
  assert.equal(typeof json('init', '--branches', 'main'), 'object');
  assert.deepEqual(json('pending'), []);
  assert.deepEqual(json('status').config.branches, ['main']);
  const configuration = json('config');
  assert.deepEqual((configuration.config ?? configuration).branches, ['main']);
  assert.equal(typeof json('init', '--help'), 'object');
  assert.deepEqual(json('check', '--remote', 'not-configured', '--branch', 'feature/skip'), { status: 'not-required' });
  assert.deepEqual(await f.calls(), []);
});

async function nativeClient(f, t) {
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd: f.repo, env: { ...f.env, FORCE_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let buffer = '', stderr = ''; const messages = [], waiters = [];
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n'); if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line);
      const waiter = waiters.find(item => item.matches(message));
      if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message); }
      else messages.push(message);
    }
  });
  const next = matches => new Promise((resolve, reject) => {
    const index = messages.findIndex(matches);
    if (index >= 0) { resolve(messages.splice(index, 1)[0]); return; }
    const item = { matches, resolve };
    item.timer = setTimeout(() => { waiters.splice(waiters.indexOf(item), 1); reject(new Error(`MCP response timed out: ${stderr}`)); }, 10000);
    waiters.push(item);
  });
  const send = value => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: { form: {} } }, clientInfo: { name: 'sphinx-test-host', version: '1' } } });
  const initialized = await next(message => message.id === 1);
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  send({ method: 'notifications/initialized' });
  const hook = id => send({ id, method: 'tools/call', params: { name: 'sphinx_checkpoint', arguments: { cwd: f.repo, host: 'claude', hookEvent: 'PostToolUseFailure', hostSession: 'test-host-session' } } });
  return { child, send, next, hook };
}

test('Git triggers a native questionnaire, direct human replies complete it, and only summary reaches the model', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none');
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  assert.deepEqual(await f.calls(), [], 'The Git hook only queues; it does not call the coding model or evaluator');
  const client = await nativeClient(f, t);
  client.hook(2); // The host lifecycle invokes this deterministically, without a model tools/call decision.
  const first = await client.next(message => message.method === 'elicitation/create');
  assert.match(first.params.message, /same ID twice/);
  assert.equal(first.params.message.includes('do-not-transmit-92bfa'), false);
  client.send({ id: first.id, result: { action: 'accept', content: { action: 'answer', response: 'WRONG' } } });
  const transfer = await client.next(message => message.method === 'elicitation/create');
  assert.match(transfer.params.message, /process restarts/);
  assert.match(transfer.params.message, /not persisted/);
  client.send({ id: transfer.id, result: { action: 'accept', content: { action: 'answer', response: 'Yes, restarting recreates the in-memory set.' } } });
  const completed = await client.next(message => message.id === 2);
  assert.equal(completed.result.structuredContent.status, 'passed');
  const modelOutput = JSON.stringify(completed.result);
  for (const hidden of ['same ID twice', 'process restarts', 'not persisted', 'WRONG', 'restarting recreates', 'expectedAnswer', 'do-not-transmit-92bfa']) assert.equal(modelOutput.includes(hidden), false);
  const hookOutput = JSON.parse(completed.result.content[0].text);
  assert.equal(hookOutput.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.match(hookOutput.hookSpecificOutput.additionalContext, /retry/i);
  assert.equal((await f.calls()).length, 3);
  assert.deepEqual(f.cliJson('pending'), []);
  f.git('push', 'origin', 'main');
  client.hook(3);
  assert.equal((await client.next(message => message.id === 3)).result.structuredContent.status, 'not-required');
  assert.equal((await f.calls()).length, 3);
  client.child.stdin.end();
});

test('cancelled native forms do not reopen on unrelated tools; retrying Git resumes without regeneration', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none');
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  const client = await nativeClient(f, t);
  client.hook(2);
  const first = await client.next(message => message.method === 'elicitation/create');
  client.send({ id: first.id, result: { action: 'cancel' } });
  assert.equal((await client.next(message => message.id === 2)).result.structuredContent.status, 'pending');
  client.hook(3);
  assert.equal((await client.next(message => message.id === 3)).result.structuredContent.status, 'not-required');
  assert.equal((await f.calls()).length, 1);
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  client.hook(4);
  const resumed = await client.next(message => message.method === 'elicitation/create');
  assert.equal(resumed.params.message, first.params.message);
  assert.equal((await f.calls()).length, 1);
  client.send({ id: resumed.id, result: { action: 'accept', content: { action: 'answer', response: 'No, the set already contains the ID.' } } });
  assert.equal((await client.next(message => message.id === 4)).result.structuredContent.status, 'passed');
  f.git('push', 'origin', 'main');
  client.child.stdin.end();
});

test('native resume trims a legacy small-change questionnaire without regeneration and still requires a human answer', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.cli('install', '--yes', '--provider', 'claude', '--agents', 'none');
  assert.notEqual(f.run('git', ['push', 'origin', 'main']).status, 0);
  const [pending] = f.cliJson('pending');
  assert.equal(pending.route.tier, 'small');
  const sessionPath = path.join(f.env.SPHINX_HOME, 'sessions', `${pending.id}.json`);
  const legacy = JSON.parse(await readFile(sessionPath, 'utf8'));
  const current = {
    id: 'legacy-duplicate', concept: 'deduplication lifetime',
    prompt: 'In the same running process, enqueue receives the same ID twice. Does the second request enqueue again? Explain why.',
    choices: ['Yes', 'No'], expectedAnswer: 'No, the set already contains the ID.',
    rationale: 'Membership is checked before insertion. The second call returns false.',
    evidence: [{ path: 'app.js', reason: 'The existing ID returns before insertion.' }],
  };
  legacy.status = 'active';
  legacy.calls = 1; // The previous version already paid for these stored questions.
  legacy.questions = [current,
    { ...current, id: 'legacy-restart', prompt: 'Can an ID enqueue again after the process restarts?' },
    { ...current, id: 'legacy-workers', prompt: 'Can two independent processes each enqueue the same ID?' },
  ];
  await writeFile(sessionPath, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });

  const client = await nativeClient(f, t);
  client.hook(2);
  const form = await client.next(message => message.method === 'elicitation/create');
  assert.match(form.params.message, /1 of 1 concepts/);
  assert.ok(form.params.message.includes(current.prompt));
  assert.doesNotMatch(form.params.message, /process restarts|two independent processes/);
  assert.deepEqual(await f.calls(), [], 'Resuming stored questions must not invoke generation');
  const resumed = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.deepEqual(resumed.questions, [current]);
  assert.equal(resumed.index, 0);
  assert.equal(resumed.status, 'active', 'Trimming must never approve the change');
  assert.equal(resumed.expiresAt, null);
  assert.equal(resumed.calls, 1);

  client.send({ id: form.id, result: { action: 'accept', content: {
    action: 'answer', response: 'No, the set retains the ID in this process, so the second call returns before insertion.',
  } } });
  const completed = await client.next(message => message.id === 2);
  assert.equal(completed.result.structuredContent.status, 'passed');
  assert.deepEqual(completed.result.structuredContent.checkpoints[0].progress, { completed: 1, total: 1 });
  const calls = await f.calls();
  assert.equal(calls.length, 1, 'Only grading the fresh human response should invoke the evaluator');
  const gradingInput = JSON.parse(calls[0].input.slice(calls[0].input.lastIndexOf('\n') + 1));
  assert.equal(gradingInput.question.id, current.id);
  assert.match(gradingInput.humanAnswer, /set retains the ID/);
  assert.equal(JSON.parse(await readFile(sessionPath, 'utf8')).calls, 2);
  assert.deepEqual(f.cliJson('pending'), []);
  f.git('push', 'origin', 'main');
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0], f.git('rev-parse', 'HEAD'));
  client.child.stdin.end();
});

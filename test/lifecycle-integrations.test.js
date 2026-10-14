import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cursorAgentHook, cursorCheckpointIds, terminalHandoff, registerOpenCodeIntegration, TERMINAL_GUIDANCE } from '../src/lifecycle-integrations.js';

test('Cursor SessionStart uses documented context/env fields and never installs a model questionnaire', async () => {
  const output = await cursorAgentHook({ input: { hook_event_name: 'sessionStart', session_id: 'conversation-123' }, env: {} });
  assert.equal(output.additional_context, TERMINAL_GUIDANCE);
  assert.deepEqual(output.env, { SPHINX_CURSOR_SESSION: 'conversation-123' });
  assert.match(output.additional_context, /own terminal/);
  assert.match(output.additional_context, /Never run the interview/);
  assert.deepEqual(await cursorAgentHook({ input: { hook_event_name: 'sessionStart' }, env: { SPHINX_EVALUATOR: '1' } }), {});
});

test('Cursor post-tool hooks send only routing fields to queue inspection and handle failures safely', async () => {
  let captured;
  const handoff = async options => { captured = options; return 'Human terminal notice'; };
  const output = await cursorAgentHook({ env: {}, handoff, input: { hook_event_name: 'postToolUseFailure', tool_name: 'Shell', cwd: '/repo', conversation_id: 'conversation-7', tool_input: { command: 'PRIVATE COMMAND' }, tool_output: 'PRIVATE SOURCE', transcript_path: '/private/transcript' } });
  assert.deepEqual(output, { additional_context: 'Human terminal notice' });
  assert.deepEqual(captured, { cwd: '/repo', host: 'cursor', hostSession: 'conversation-7', env: {} });
  assert.deepEqual(await cursorAgentHook({ handoff: () => { throw new Error('must not inspect'); }, input: { hook_event_name: 'postToolUse', tool_name: 'Read' }, env: {} }), {});
  const failed = await cursorAgentHook({ input: { hook_event_name: 'postToolUse', tool_name: 'Shell' }, env: {}, handoff: () => { throw new Error('PRIVATE FAILURE'); } });
  assert.match(failed.additional_context, /sphinx doctor/); assert.doesNotMatch(failed.additional_context, /PRIVATE/);
});

test('Cursor cross-directory routing reads only exact Git-emitted checkpoint markers', async () => {
  const id = 'a'.repeat(64), second = 'b'.repeat(64);
  const marker = value => `Outside a supported agent, run sphinx check --id ${value} in your terminal.`;
  const tool_output = JSON.stringify({ exitCode: 1, stdout: `PRIVATE_SOURCE\n${marker(id)}\n`, stderr: `${marker(second)}\r\n${marker(id)}`, unrelated: marker('c'.repeat(64)) });
  assert.deepEqual(cursorCheckpointIds({ tool_output }), [id, second]);
  assert.deepEqual(cursorCheckpointIds({ error_message: `Command failed\n${marker(id)}` }), [id]);
  for (const payload of [
    marker(id), JSON.stringify({ stdout: `sphinx check --id ${id}` }),
    JSON.stringify({ stdout: marker(id.toUpperCase()) }),
    JSON.stringify({ stdout: `Quoted: ${marker(id)}` }),
    JSON.stringify({ transcript: marker(id) }),
    JSON.stringify({ stdout: marker(`${id}0`) }),
    JSON.stringify({ stdout: `${marker(id)}; execute unwanted command` }),
  ]) assert.deepEqual(cursorCheckpointIds({ tool_output: payload }), []);
  let inspected;
  const response = await cursorAgentHook({ input: { hook_event_name: 'postToolUse', tool_name: 'Shell', cwd: '/first-repository', conversation_id: 'cursor-session', tool_output, tool_input: { command: 'PRIVATE_COMMAND' } }, env: {},
    handoff: options => terminalHandoff({ ...options, listRequests: async value => { inspected = value; return []; } }),
  });
  assert.deepEqual(inspected, { cwd: '/first-repository', host: 'cursor', hostSession: 'cursor-session', checkpointIds: [id, second], env: {} });
  assert.deepEqual(response, {});
  assert.doesNotMatch(JSON.stringify(inspected), /PRIVATE_SOURCE|PRIVATE_COMMAND|exitCode|stdout|stderr/);
});

test('terminal handoff consumes only Git-created requests once, without reading or grading assessments', async () => {
  const requests = [{ token: 'one', id: 'a'.repeat(64), privateQuestion: 'NEVER SEND' }, { token: 'two', id: 'b'.repeat(64) }];
  const seen = new Set();
  const launched = [];
  const options = { cwd: '/repo', host: 'opencode', hostSession: 'ses_123', env: {}, listRequests: async () => requests, claimRequest: async request => { if (seen.has(request.token)) return false; seen.add(request.token); return true; }, launch: async ({ request }) => { launched.push(request.id); return { status: 'opened' }; }, waitForResult: async () => 'passed' };
  const notice = await terminalHandoff(options);
  assert.match(notice, /completed directly in its terminal window/);
  assert.deepEqual(launched, [requests[0].id, requests[1].id]);
  assert.doesNotMatch(notice, /NEVER SEND|aaaaa|bbbbb/);
  assert.equal(await terminalHandoff(options), null);
  assert.equal(await terminalHandoff({ ...options, env: { SPHINX_EVALUATOR: '1' }, listRequests: () => { throw new Error('must skip'); } }), null);
});

test('a terminal that fails after launch gives the human a manual fallback rather than an open-window claim', async () => {
  for (const status of ['unavailable', 'interrupted']) {
    let claimed = 0;
    const notice = await terminalHandoff({ cwd: '/repo', env: {},
      listRequests: async () => [{ id: 'a'.repeat(64), token: 'attempt' }],
      launch: async () => ({ status: 'opened' }), claimRequest: async () => { claimed++; return true; },
      waitForResult: async () => status,
    });
    assert.equal(claimed, 1);
    assert.match(notice, /remains pending/);
    assert.match(notice, /human can run `sphinx check` in their own terminal/);
    assert.doesNotMatch(notice, /still open|completed directly/);
  }
});

test('OpenCode plugin tags shell sessions and supplies a one-time terminal notice through documented hooks', async () => {
  const calls = [], toasts = [];
  const hooks = registerOpenCodeIntegration({ directory: '/repo', client: { tui: { showToast: async value => toasts.push(value) } } }, { home: '/sphinx', env: {}, handoff: async value => { calls.push(value); return calls.length === 1 ? 'Run sphinx check in your own terminal.' : null; } });
  const shell = { env: { EXISTING: 'keep' } };
  await hooks['shell.env']({ sessionID: 'ses_123' }, shell);
  assert.deepEqual(shell.env, { EXISTING: 'keep', SPHINX_HOME: '/sphinx', SPHINX_OPENCODE_SESSION: 'ses_123' });
  const system = { system: ['Existing instructions'] };
  await hooks['experimental.chat.system.transform']({}, system);
  await hooks['experimental.chat.system.transform']({}, system);
  assert.deepEqual(system.system, ['Existing instructions', TERMINAL_GUIDANCE]);
  const result = { output: 'Original Git rejection', metadata: { code: 1 } };
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: 'ses_123', args: { command: 'PRIVATE' } }, result);
  assert.match(result.output, /^Original Git rejection/); assert.match(result.output, /own terminal/);
  assert.deepEqual(result.metadata, { code: 1 });
  assert.deepEqual(calls[0], { cwd: '/repo', host: 'opencode', hostSession: 'ses_123', env: { SPHINX_HOME: '/sphinx' } });
  assert.equal(toasts.length, 1);
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: 'ses_123' }, { output: 'Other output' });
  await hooks['tool.execute.after']({ tool: 'read' }, { output: 'PRIVATE FILE' });
  assert.equal(calls.length, 2); assert.equal(toasts.length, 1);
  assert.deepEqual(registerOpenCodeIntegration({}, { env: { SPHINX_EVALUATOR: '1' } }), {});
});

test('Cursor command entry emits clean protocol JSON with no transcript or shell content', () => {
  const file = fileURLToPath(new URL('../src/cursor-hook.js', import.meta.url));
  const env = { ...process.env, FORCE_COLOR: '1', SPHINX_EVALUATOR: '' }; delete env.NO_COLOR;
  const output = execFileSync(process.execPath, [file], { input: JSON.stringify({ hook_event_name: 'sessionStart', session_id: 'conv_1', tool_output: 'PRIVATE OUTPUT', transcript_path: '/private' }), env, encoding: 'utf8' });
  assert.equal(JSON.parse(output).env.SPHINX_CURSOR_SESSION, 'conv_1');
  assert.doesNotMatch(output, /PRIVATE|\u001b/);
  const broken = execFileSync(process.execPath, [file], { input: 'PRIVATE INVALID JSON', encoding: 'utf8' });
  assert.match(JSON.parse(broken).additional_context, /sphinx doctor/); assert.doesNotMatch(broken, /PRIVATE/);
});

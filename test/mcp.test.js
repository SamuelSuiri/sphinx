import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate as immediate } from 'node:timers/promises';
import { CHECKPOINT_TOOL, MCP_PROTOCOL_VERSION, runMcpServer, sanitizeCheckpointSummary, supportsFormElicitation, validateFormSchema } from '../src/mcp.js';

const args = { cwd: '/test/repository', host: 'codex', hookEvent: 'PostToolUse', hostSession: 'host-session-123' };
const checkpointId = 'a'.repeat(64);
const form = {
  message: 'Native question only: does the retry repeat the operation?',
  requestedSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['answer', 'learn', 'dispute', 'pause'] },
      response: { type: 'string', maxLength: 8000 },
    },
    required: ['action'],
  },
};
const passed = { status: 'passed', checkpoints: [{ id: checkpointId, status: 'passed', progress: { completed: 1, total: 1 }, usage: { calls: 2, limit: 10 } }], completed: 1, total: 1, calls: 2 };
const pending = { status: 'pending', checkpoints: [{ id: checkpointId, status: 'pending', progress: { completed: 0, total: 1 }, usage: { calls: 1, limit: 10 } }], completed: 0, total: 1, calls: 1 };

function client(t, checkpointHandler, options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const history = [];
  const unread = [];
  const waiting = [];
  let raw = '';
  let partial = '';
  output.setEncoding('utf8');
  output.on('data', text => {
    raw += text;
    partial += text;
    let newline;
    while ((newline = partial.indexOf('\n')) !== -1) {
      const line = partial.slice(0, newline);
      partial = partial.slice(newline + 1);
      const message = JSON.parse(line); // Any banner or log on stdout fails the test.
      history.push(message);
      const index = waiting.findIndex(waiter => waiter.match(message));
      if (index < 0) unread.push(message);
      else { const [waiter] = waiting.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    }
  });
  const done = runMcpServer({ input, output, checkpointHandler, env: { SPHINX_HOME: '/isolated-test-state' }, ...options });
  t.after(async () => {
    input.end(); await done;
    for (const waiter of waiting) clearTimeout(waiter.timer);
    input.destroy(); output.destroy();
  });
  const send = value => input.write(`${JSON.stringify(value)}\n`);
  const next = (match, timeout = 1500) => {
    const index = unread.findIndex(match);
    if (index >= 0) return Promise.resolve(unread.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve };
      waiter.timer = setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error('Timed out waiting for a mock MCP message.'));
      }, timeout);
      waiting.push(waiter);
    });
  };
  const initialize = async (capabilities = { elicitation: { form: {} } }, protocolVersion = MCP_PROTOCOL_VERSION) => {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities, clientInfo: { name: 'sphinx-test-client', version: '1' } } });
    const response = await next(message => message.id === 1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return response;
  };
  const call = (id = 3, values = args) => send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'sphinx_checkpoint', arguments: values } });
  return { input, output, done, send, next, initialize, call, history, raw: () => raw };
}

test('MCP negotiates the supported protocol and advertises only the answer-free checkpoint tool', async t => {
  const c = client(t, async () => ({ status: 'not-required', checkpoints: [] }));
  const initialized = await c.initialize();
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.deepEqual(initialized.result.capabilities, { tools: {} });
  c.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const list = (await c.next(message => message.id === 2)).result;
  assert.deepEqual(list.tools, [CHECKPOINT_TOOL]);
  assert.deepEqual(Object.keys(list.tools[0].inputSchema.properties), ['cwd', 'host', 'hookEvent', 'hostSession']);
  assert.equal(list.tools[0].inputSchema.additionalProperties, false);
  c.call();
  const idle = (await c.next(message => message.id === 3)).result;
  assert.equal(idle.content[0].text, '{}', 'Unrelated shell hooks produce no questionnaire chatter');
  assert.equal(idle.structuredContent.status, 'not-required');
});

test('native form answers go directly to the controller and tool results contain only hook summary', async t => {
  let received;
  const answer = 'UNIQUE HUMAN ANSWER: no, the identifier guard returns the old result.';
  const c = client(t, async request => {
    assert.equal(request.supportsForm, true);
    assert.deepEqual(Object.fromEntries(Object.keys(args).map(key => [key, request[key]])), args);
    received = await request.elicit(form);
    return { ...passed, feedback: 'PRIVATE FEEDBACK', question: form.message, answer, checkpoints: [{ ...passed.checkpoints[0], question: form.message }] };
  });
  await c.initialize(); c.call();
  const request = await c.next(message => message.method === 'elicitation/create');
  assert.equal(request.params.mode, 'form');
  assert.deepEqual(request.params.requestedSchema, form.requestedSchema);
  assert.equal(request.params.message, form.message);
  c.send({ jsonrpc: '2.0', id: request.id, result: { action: 'accept', content: { action: 'answer', response: answer } } });
  const final = (await c.next(message => message.id === 3)).result;
  assert.deepEqual(received, { action: 'accept', content: { action: 'answer', response: answer } });
  assert.deepEqual(final.structuredContent, passed);
  const hook = JSON.parse(final.content[0].text);
  assert.equal(hook.hookSpecificOutput.hookEventName, args.hookEvent);
  assert.match(hook.hookSpecificOutput.additionalContext, /fallback native questionnaire/);
  assert.match(hook.hookSpecificOutput.additionalContext, /does not resume an exited Git process/);
  assert.match(hook.hookSpecificOutput.additionalContext, /Before retrying, verify that the original Git operation has exited with a Sphinx blocking failure/);
  assert.match(hook.hookSpecificOutput.additionalContext, /Never duplicate a waiting operation or repeat a successful or advisory operation/);
  for (const secret of [answer, form.message, 'PRIVATE FEEDBACK']) assert.equal(JSON.stringify(final).includes(secret), false);
  assert.equal(final.isError, false);
  assert.equal(c.raw().includes('\u001b'), false);
});

test('each form is correlated to its active request and unrelated responses cannot answer it', async t => {
  const received = [];
  const c = client(t, async ({ elicit }) => {
    received.push(await elicit(form));
    received.push(await elicit({ ...form, message: 'A different transfer scenario.' }));
    return passed;
  });
  await c.initialize(); c.call();
  const first = await c.next(message => message.method === 'elicitation/create');
  c.send({ jsonrpc: '2.0', id: 'unrelated-response', result: { action: 'accept', content: { action: 'answer', response: 'fake' } } });
  await immediate(); assert.equal(received.length, 0);
  c.send({ jsonrpc: '2.0', id: first.id, result: { action: 'accept', content: { action: 'learn' } } });
  const second = await c.next(message => message.method === 'elicitation/create');
  assert.notEqual(second.id, first.id);
  c.send({ jsonrpc: '2.0', id: first.id, result: { action: 'accept', content: { action: 'answer', response: 'late' } } });
  await immediate(); assert.equal(received.length, 1);
  c.send({ jsonrpc: '2.0', id: second.id, result: { action: 'accept', content: { action: 'answer', response: 'human answer' } } });
  assert.equal((await c.next(message => message.id === 3)).result.structuredContent.status, 'passed');
  assert.equal(received[1].content.response, 'human answer');
});

test('unsupported clients can inspect an empty queue but cannot receive a form or start inference', async t => {
  for (const capabilities of [{}, { elicitation: { url: {} } }, { elicitation: false }, { elicitation: { form: false } }]) {
    let controllerCalls = 0;
    let modelCalls = 0;
    const c = client(t, async ({ supportsForm, elicit }) => {
      controllerCalls++;
      assert.equal(supportsForm, false);
      await assert.rejects(elicit(form), { code: 'MCP_ELICITATION_UNSUPPORTED' });
      if (supportsForm) modelCalls++;
      return { status: 'unsupported', checkpoints: [] };
    });
    await c.initialize(capabilities); c.call();
    const response = (await c.next(message => message.id === 3)).result;
    assert.equal(response.structuredContent.status, 'unsupported');
    assert.equal(response.isError, true);
    assert.equal(controllerCalls, 1);
    assert.equal(modelCalls, 0);
    assert.equal(c.history.some(message => message.method === 'elicitation/create'), false);
  }
  const empty = client(t, async ({ supportsForm }) => { assert.equal(supportsForm, false); return { status: 'not-required', checkpoints: [] }; });
  await empty.initialize({}); empty.call();
  assert.equal((await empty.next(message => message.id === 3)).result.content[0].text, '{}');
});

test('legacy form capability works and newer protocol offers negotiate the compatible version', async t => {
  assert.equal(supportsFormElicitation({ elicitation: {} }), true);
  const legacy = client(t, async ({ elicit }) => { await elicit(form); return pending; });
  assert.equal((await legacy.initialize({ elicitation: {} }, '2025-06-18')).result.protocolVersion, '2025-06-18');
  legacy.call();
  const question = await legacy.next(message => message.method === 'elicitation/create');
  assert.equal(Object.hasOwn(question.params, 'mode'), false);
  legacy.send({ jsonrpc: '2.0', id: question.id, result: { action: 'cancel' } });
  await legacy.next(message => message.id === 3);
  const modern = client(t, async () => ({ status: 'not-required', checkpoints: [] }));
  assert.equal((await modern.initialize({ elicitation: { form: {} } }, '2026-07-01')).result.protocolVersion, '2025-11-25');
});

test('decline and cancel remain pending and discard any attached answer content', async t => {
  for (const action of ['decline', 'cancel']) {
    let received;
    const c = client(t, async ({ elicit }) => { received = await elicit(form); return pending; });
    await c.initialize(); c.call();
    const request = await c.next(message => message.method === 'elicitation/create');
    c.send({ jsonrpc: '2.0', id: request.id, result: { action, content: { response: 'must not be graded' } } });
    const response = (await c.next(message => message.id === 3)).result;
    assert.deepEqual(received, { action });
    assert.equal(response.structuredContent.status, 'pending');
    assert.match(JSON.parse(response.content[0].text).hookSpecificOutput.additionalContext, /Do not retry.*until the human asks/);
  }
});

test('malformed accepted answers fail before grading and never leak rejected input', async t => {
  for (const result of [
    { action: 'accept' }, { action: 'accept', content: {} },
    { action: 'accept', content: { action: 'unknown action' } },
    { action: 'accept', content: { action: 'answer', response: ['private-answer'] } },
    { action: 'accept', content: { action: 'answer', secret: 'private-answer' } },
    { action: 'approve', content: { action: 'answer', response: 'private-answer' } },
  ]) {
    let grades = 0;
    const c = client(t, async ({ elicit }) => { await elicit(form); grades++; return passed; });
    await c.initialize(); c.call();
    const request = await c.next(message => message.method === 'elicitation/create');
    c.send({ jsonrpc: '2.0', id: request.id, result });
    const response = (await c.next(message => message.id === 3)).result;
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.status, 'error');
    assert.equal(grades, 0);
    assert.equal(JSON.stringify(response).includes('private-answer'), false);
  }
});

test('client cancellation aborts the controller, cancels its form, and suppresses a late tool response', async t => {
  let observed;
  const c = client(t, async ({ elicit, signal }) => { observed = signal; await elicit(form); return passed; });
  await c.initialize(); c.call();
  const request = await c.next(message => message.method === 'elicitation/create');
  c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3, reason: 'human cancelled' } });
  assert.equal((await c.next(message => message.method === 'notifications/cancelled')).params.requestId, request.id);
  assert.equal(observed.aborted, true);
  c.send({ jsonrpc: '2.0', id: request.id, result: { action: 'accept', content: { action: 'answer', response: 'late answer' } } });
  await immediate();
  assert.equal(c.history.some(message => message.id === 3), false);
  c.send({ jsonrpc: '2.0', id: 4, method: 'ping' });
  assert.deepEqual((await c.next(message => message.id === 4)).result, {});
});

test('disconnection aborts pending forms and emits no approval afterward', async t => {
  let observed;
  const c = client(t, async ({ elicit, signal }) => { observed = signal; await elicit(form); return passed; });
  await c.initialize(); c.call();
  await c.next(message => message.method === 'elicitation/create');
  c.input.end();
  assert.equal(await c.done, 0);
  await immediate();
  assert.equal(observed.aborted, true);
  assert.equal(c.history.some(message => message.id === 3), false);
});

test('form timeout cancels the server request and leaves completion pending', async t => {
  const c = client(t, async ({ elicit }) => { await elicit(form); return passed; }, { elicitationTimeoutMs: 20 });
  await c.initialize(); c.call();
  const request = await c.next(message => message.method === 'elicitation/create');
  assert.equal((await c.next(message => message.method === 'notifications/cancelled')).params.requestId, request.id);
  const response = (await c.next(message => message.id === 3)).result;
  assert.equal(response.structuredContent.status, 'pending');
  assert.equal(response.isError, true);
});

test('overall timeout aborts a stuck controller without waiting indefinitely', async t => {
  let observed;
  const c = client(t, ({ signal }) => { observed = signal; return new Promise(() => {}); }, { requestTimeoutMs: 20 });
  await c.initialize(); c.call();
  const response = (await c.next(message => message.id === 3)).result;
  assert.equal(response.structuredContent.status, 'pending');
  assert.equal(observed.aborted, true);
});

test('MCP rejects answer parameters, invalid lifecycle requests, and malformed JSON without echoing input', async t => {
  let calls = 0;
  const c = client(t, async () => { calls++; return passed; });
  c.send({ jsonrpc: '2.0', id: 8, method: 'tools/list' });
  assert.equal((await c.next(message => message.id === 8)).error.code, -32002);
  await c.initialize();
  for (const values of [{ ...args, answer: 'private-answer' }, { ...args, hostSession: null }, { ...args, host: 'other' }, { ...args, question: 'private-question' }]) {
    c.call(3, values);
    const response = await c.next(message => message.id === 3);
    assert.equal(response.error.code, -32602);
    assert.equal(JSON.stringify(response).includes('private-answer'), false);
  }
  c.input.write('private invalid json\n');
  const parseError = await c.next(message => message.id === null);
  assert.equal(parseError.error.code, -32700);
  assert.equal(JSON.stringify(parseError).includes('private invalid'), false);
  c.send([]);
  assert.equal((await c.next(message => message.id === null)).error.code, -32600);
  c.send({ jsonrpc: '2.0', id: 9, method: 'sampling/createMessage' });
  assert.equal((await c.next(message => message.id === 9)).error.code, -32601);
  assert.equal(calls, 0);
});

test('a concurrent checkpoint is refused while the first native question is open', async t => {
  let calls = 0;
  const c = client(t, async ({ elicit }) => { calls++; await elicit(form); return pending; });
  await c.initialize(); c.call();
  const request = await c.next(message => message.method === 'elicitation/create');
  c.call(4);
  assert.equal((await c.next(message => message.id === 4)).result.structuredContent.status, 'busy');
  assert.equal(calls, 1);
  c.send({ jsonrpc: '2.0', id: request.id, result: { action: 'cancel' } });
  await c.next(message => message.id === 3);
});

test('input limits terminate oversized unterminated messages and clean stdout remains JSON-lines', async t => {
  const c = client(t, async () => passed, { maxInputBytes: 128 });
  c.input.write('x'.repeat(129));
  assert.equal((await c.next(message => message.id === null)).error.code, -32600);
  assert.equal(await c.done, 0);
  assert.equal(c.raw().trim().split('\n').length, 1);
});

test('form schemas remain flat, and summary sanitation strips all unconstrained strings', () => {
  assert.deepEqual(validateFormSchema(form.requestedSchema), form.requestedSchema);
  for (const property of [{ type: 'object', properties: {} }, { type: 'array', items: { type: 'string' } }, { type: 'string', $ref: '/private/file' }]) {
    assert.throws(() => validateFormSchema({ type: 'object', properties: { answer: property } }), { code: 'INVALID_FORM_SCHEMA' });
  }
  assert.deepEqual(sanitizeCheckpointSummary({ ...passed, question: 'secret', feedback: 'secret', answer: 'secret' }), passed);
  assert.throws(() => sanitizeCheckpointSummary({ status: 'passed', checkpoints: [{ ...passed.checkpoints[0], id: 'raw question' }] }), { code: 'INVALID_CHECKPOINT_SUMMARY' });
});

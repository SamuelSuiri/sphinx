import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createBrowserInterview, openQuestionnaireBrowser } from '../src/browser-interview.js';
import { createSessionStore } from '../src/sessions.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { claimCheckpointDialog, checkpointTerminalStatus } from '../src/terminal-launch.js';
import { recentOverrides } from '../src/overrides.js';

const q = { id: 'duplicate', concept: 'idempotency', prompt: 'Can a retry duplicate the insert? <script>PRIVATE_SCRIPT</script>', choices: ['Yes', 'No'], expectedAnswer: 'PRIVATE_KEY', rationale: 'PRIVATE_RUBRIC', evidence: [{ path: 'app.js', reason: 'The insert is unconditional.' }] };
async function fixture(t, { generate, grade, maxModelCalls = 20, validate = async () => {} } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'sphinx-browser-'));
  const env = { SPHINX_HOME: path.join(home, 'state'), SPHINX_USER_HOME: home }, repoRoot = path.join(home, 'repo'); await mkdir(repoRoot);
  const config = { ...structuredClone(DEFAULT_CONFIG), maxModelCalls };
  const snapshot = { id: 'a'.repeat(64), repoRoot, event: 'pre-push', target: { ref: 'refs/heads/main' }, files: ['app.js'], stats: { additions: 5, deletions: 1, files: 1 } };
  let generated = 0, graded = 0, opened = 0;
  const store = createSessionStore({ env, validate,
    generate: async (_s, _c, options) => { generated++; if (generate) return generate(generated, options); await options.beforeCall(); return { questions: [q] }; },
    grade: async request => { graded++; await request.beforeCall(); return grade ? grade(request, graded) : { verdict: 'correct', feedback: 'Correct.', followUp: null }; },
  });
  await store.ensure(snapshot, config);
  const controller = new AbortController(), output = [];
  const interview = createBrowserInterview({ env, signal: controller.signal, store, readConfig: async () => config, revalidate: async () => { await validate(); return true; }, openBrowser: async () => { opened++; return true; }, output: text => output.push(text) });
  const request = { id: snapshot.id, token: randomUUID(), repoRoot, delivery: 'hook', createdAt: Date.now() };
  const tasks = [];
  const present = (next = request) => { const task = interview.present({ request: next }); tasks.push(task); return task; };
  t.after(async () => { controller.abort(); await Promise.allSettled(tasks); await interview.close(); await rm(home, { recursive: true, force: true }); });
  const waitFor = async phase => {
    for (let i = 0; i < 300 && interview.state.phase !== phase; i++) await delay(10);
    assert.equal(interview.state.phase, phase, JSON.stringify(interview.state)); return interview.state;
  };
  const post = async (action, extra = {}, selected = interview.state, headers = {}) => fetch(`${interview.url}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(interview.url).origin, 'X-Sphinx-Token': new URL(interview.url).pathname.slice(1), ...headers }, body: JSON.stringify({ id: selected.id, revision: selected.revision, action, ...(['answer', 'learn', 'dispute'].includes(action) ? { questionId: selected.question.id } : {}), ...extra }) });
  return { env, config, snapshot, store, interview, request, present, waitFor, post, controller, generated: () => generated, graded: () => graded, opened: () => opened, output };
}

test('browser launch uses only macOS background open and never activates or minimizes another app', async () => {
  let invocation;
  const result = await openQuestionnaireBrowser('http://127.0.0.1:12345/token', { platform: 'darwin', env: {}, spawnImpl: (command, args, options) => {
    invocation = { command, args, options }; const child = new EventEmitter(); setImmediate(() => child.emit('exit', 0)); return child;
  } });
  assert.equal(result, true); assert.equal(invocation.command, '/usr/bin/open'); assert.deepEqual(invocation.args, ['-g', 'http://127.0.0.1:12345/token']);
  assert.doesNotMatch(JSON.stringify(invocation), /activate|minimiz|frontmost|osascript/);
  for (const options of [{ platform: 'linux', env: { DISPLAY: ':1' } }, { platform: 'darwin', env: { SSH_TTY: '/dev/tty' } }, { platform: 'darwin', env: { CI: '1' } }]) assert.equal(await openQuestionnaireBrowser('http://127.0.0.1:12345/token', { ...options, spawnImpl: () => assert.fail('must not invoke a foreground launcher') }), false);
});

test('local page requires its token and rejects cross-origin, rebinding, and stale submissions', async t => {
  const f = await fixture(t), done = f.present(); const current = await f.waitFor('question');
  const page = await fetch(f.interview.url); const html = await page.text();
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('cache-control'), /no-store/); assert.match(page.headers.get('referrer-policy'), /no-referrer/);
  assert.doesNotMatch(html, /PRIVATE_KEY|PRIVATE_RUBRIC|PRIVATE_SCRIPT/); assert.doesNotMatch(html, /innerHTML|https?:\/\//);
  const state = await (await fetch(`${f.interview.url}/state`)).json();
  assert.match(state.question.prompt, /<script>/); assert.doesNotMatch(JSON.stringify(state), /PRIVATE_KEY|PRIVATE_RUBRIC/);
  assert.equal((await fetch(`${new URL(f.interview.url).origin}/wrong/state`)).status, 404);
  const rebound = await new Promise(resolve => get(`${f.interview.url}/state`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }));
  assert.equal(rebound, 403);
  assert.equal((await f.post('answer', { response: 'Yes.' }, current, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post('answer', { response: 'Yes.' }, current, { 'X-Sphinx-Token': 'wrong' })).status, 403);
  assert.equal((await f.post('answer', { response: 'Yes.', questionId: 'old-question' })).status, 409);
  assert.equal(f.graded(), 0);
  assert.equal((await f.post('answer', { response: 'Yes, the operation repeats.' }, current)).status, 202);
  assert.equal((await f.post('answer', { response: 'DUPLICATE' }, current)).status, 409);
  assert.equal((await done).status, 'passed'); assert.equal(f.graded(), 1);
  assert.equal(await f.store.approved(f.snapshot, f.config), true);
});

test('wrong answers stay in the same page and require a human response to the transfer question', async t => {
  const f = await fixture(t, { grade: async (_request, count) => count === 1 ? { verdict: 'incorrect', feedback: 'There is no durable deduplication.', followUp: { ...q, id: 'transfer', prompt: 'What changes after restart?' } } : { verdict: 'correct', feedback: 'Correct.', followUp: null } });
  const done = f.present(); await f.waitFor('question'); await f.post('answer', { response: 'No.' }); await f.waitFor('question');
  assert.equal(f.interview.state.question.id, 'transfer'); assert.match(f.interview.state.feedback, /durable/);
  assert.equal(await f.store.approved(f.snapshot, f.config), false);
  await f.post('answer', { response: 'The set is recreated.' }); assert.equal((await done).status, 'passed'); assert.equal(f.opened(), 1);
});

test('browser responses omit private concept and acceptance metadata even from a permissive public-state adapter', async t => {
  const concept = 'PRIVATE_CONCEPT_ANSWER: yes, each retry repeats the unconditional insertion.';
  const acceptance = { prediction: 'PRIVATE_ACCEPTANCE_PREDICTION: A retry can insert again.', causalReason: 'PRIVATE_ACCEPTANCE_CAUSE: The next request repeats the unconditional insertion.' };
  const f = await fixture(t, {
    generate: async (_count, options) => { await options.beforeCall(); return { questions: [{ ...q, concept, acceptance }] }; },
    grade: async request => {
      assert.equal(request.question.concept, concept);
      assert.deepEqual(request.question.acceptance, acceptance);
      return { verdict: 'correct', feedback: 'Correct.', followUp: null };
    },
  });
  const start = f.store.start;
  f.store.start = async (...args) => {
    const state = await start(...args);
    return { ...state, question: { ...state.question, concept, acceptance } };
  };
  const done = f.present();
  await f.waitFor('question');
  const current = await (await fetch(`${f.interview.url}/state`)).json();
  assert.deepEqual(current.question, { id: q.id, prompt: q.prompt, choices: q.choices });
  assert.doesNotMatch(JSON.stringify(current), /PRIVATE_CONCEPT_ANSWER|PRIVATE_ACCEPTANCE|"concept"|"acceptance"/);
  const submitted = await f.post('answer', { response: 'Yes, another insertion is attempted.' });
  assert.doesNotMatch(await submitted.text(), /PRIVATE_CONCEPT_ANSWER|PRIVATE_ACCEPTANCE|"concept"|"acceptance"/);
  assert.equal((await done).status, 'passed');
  assert.equal((await f.store.read(f.snapshot.id)).questions[0].concept, concept);
  assert.deepEqual((await f.store.read(f.snapshot.id)).questions[0].acceptance, acceptance);
  assert.doesNotMatch(JSON.stringify(f.interview.state), /PRIVATE_CONCEPT_ANSWER|PRIVATE_ACCEPTANCE|"concept"|"acceptance"/);
});

test('the character allowance accepts UTF-8 answers without truncation', async t => {
  const answer = '因'.repeat(8000);
  const f = await fixture(t, { grade: async request => {
    assert.equal(request.answer, answer);
    return { verdict: 'ambiguous', feedback: 'Use a complete causal explanation.', followUp: null };
  } });
  const done = f.present(); await f.waitFor('question');
  assert.equal((await f.post('answer', { response: answer })).status, 202);
  await f.waitFor('question'); assert.equal(f.graded(), 1);
  await f.post('pause'); assert.equal((await done).status, 'pending');
});

test('Pause aborts active grading and releases Git without storing late success', async t => {
  let entered;
  const grading = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { grade: async request => { entered(); await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true })); return { verdict: 'correct', feedback: 'Late success.', followUp: null }; } });
  const done = f.present(); await f.waitFor('question'); await f.post('answer', { response: 'Yes.' }); await grading;
  await f.post('pause'); assert.equal((await done).status, 'pending'); assert.equal(await f.store.approved(f.snapshot, f.config), false);
  assert.equal((await checkpointTerminalStatus({ id: f.snapshot.id, env: f.env })).status, 'pending');
  assert.equal((await f.store.read(f.snapshot.id)).calls, 2);
});

test('Pause after a receipt was committed stops the interview without revoking or denying saved completion', async t => {
  const f = await fixture(t);
  let saved;
  const committed = new Promise(resolve => { saved = resolve; });
  const answer = f.store.answer;
  f.store.answer = async (...args) => {
    const result = await answer(...args);
    saved();
    await new Promise(resolve => args[3].signal.addEventListener('abort', resolve, { once: true }));
    return result;
  };
  const done = f.present(); await f.waitFor('question');
  await f.post('answer', { response: 'Yes, the insert is repeated.' }); await committed;
  assert.equal(await f.store.approved(f.snapshot, f.config), true);
  const paused = await (await f.post('pause')).json();
  assert.match(paused.message, /Progress is saved; the waiting Git operation was stopped/);
  assert.equal((await done).status, 'pending');
  assert.doesNotMatch(f.interview.state.message, /No approval/);
  assert.equal(await f.store.approved(f.snapshot, f.config), true, 'An already committed receipt must remain saved');
  assert.equal((await checkpointTerminalStatus({ id: f.snapshot.id, env: f.env })).status, 'pending');
});

test('review failure stays in the page and cannot retry or add an allowance without human action', async t => {
  const f = await fixture(t, { generate: async (attempt, options) => { await options.beforeCall(); if (attempt === 1) throw Object.assign(new Error('Review did not retain evidence.'), { code: 'INSUFFICIENT_EVIDENCE' }); return { questions: [q] }; } });
  const done = f.present(); await f.waitFor('recovery');
  assert.deepEqual(f.interview.state.choices.map(choice => choice.value), ['retry', 'pause']);
  assert.equal(f.generated(), 1); assert.equal((await f.store.read(f.snapshot.id)).calls, 1);
  await f.post('retry'); await f.waitFor('question'); assert.equal(f.generated(), 2);
  await f.post('pause'); assert.equal((await done).status, 'pending');
  assert.equal((await f.store.read(f.snapshot.id)).reviewRetries, undefined);
});

test('a batch reuses one local page and stale prior-checkpoint submissions cannot reach the next one', async t => {
  const f = await fixture(t), first = f.present(); await f.waitFor('question'); const stale = f.interview.state;
  await f.post('answer', { response: 'Yes.' }); await first;
  const next = { ...f.snapshot, id: 'b'.repeat(64), target: { ref: 'refs/heads/master' } }; await f.store.ensure(next, f.config);
  const second = f.present({ ...f.request, id: next.id, token: randomUUID() }); await f.waitFor('question');
  assert.equal(f.opened(), 1); assert.equal(f.output.filter(line => line.startsWith('Sphinx questionnaire:')).length, 1);
  assert.equal((await f.post('answer', { response: 'Old answer' }, stale)).status, 409);
  await f.post('pause'); assert.equal((await second).status, 'pending');
});

test('browser reservation prevents simultaneous native dialogs and errors never approve stale source', async t => {
  let stale = false;
  const f = await fixture(t, { validate: async () => { if (stale) throw new Error('Snapshot changed.'); } });
  const done = f.present(); await f.waitFor('question');
  assert.equal((await claimCheckpointDialog({ request: f.request, env: f.env })).status, 'busy');
  stale = true; await f.post('answer', { response: 'Yes.' });
  assert.equal((await done).status, 'pending'); assert.equal(f.graded(), 0);
  assert.doesNotMatch(f.interview.state.message, /No approval/);
  assert.equal(await f.store.approved(f.snapshot, f.config), false);
});

test('disconnected event streams cannot interrupt grading and the operation closes its HTTP listener', async t => {
  const f = await fixture(t), done = f.present(); await f.waitFor('question');
  await new Promise((resolve, reject) => {
    const request = get(`${f.interview.url}/events`, response => {
      response.once('data', () => { response.destroy(); request.destroy(); resolve(); });
    });
    request.once('error', reject);
  });
  await f.post('answer', { response: 'Yes, the insert is repeated.' });
  assert.equal((await done).status, 'passed');
  const final = await (await fetch(`${f.interview.url}/state`)).json();
  assert.equal(final.phase, 'passed');
  assert.equal(final.operationClosed, false);
  await f.interview.close();
  assert.equal(f.interview.state.operationClosed, true);
  await assert.rejects(fetch(`${f.interview.url}/state`));
});

test('Git cancellation during review aborts work, releases the reservation, and never approves a late result', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { generate: async (_attempt, options) => {
    await options.beforeCall(); entered();
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return { questions: [q] };
  } });
  const done = f.present(); await started; f.controller.abort(new Error('Git stopped.'));
  assert.equal((await done).status, 'pending');
  assert.equal(f.interview.state.phase, 'paused');
  assert.equal((await checkpointTerminalStatus({ id: f.snapshot.id, env: f.env })).status, 'pending');
  assert.equal(await f.store.approved(f.snapshot, f.config), false);
  assert.equal((await f.store.read(f.snapshot.id)).questions.length, 0);
});

test('CI and evaluator subprocesses never start a browser or model', async () => {
  for (const env of [{ CI: '1' }, { SPHINX_EVALUATOR: '1' }]) {
    const interview = createBrowserInterview({ env, openBrowser: () => assert.fail('must not open'), reserve: () => assert.fail('must not reserve') });
    assert.equal((await interview.present({ request: { id: 'a'.repeat(64) } })).status, 'unavailable'); await interview.close();
  }
});

test('the page receives a chat transcript of questions, answers, feedback, follow-ups, and live review activity', async t => {
  const f = await fixture(t, {
    generate: async (_count, options) => { options.onProgress?.('Reading app.js'); await options.beforeCall(); return { questions: [q] }; },
    grade: async (_request, count) => count === 1 ? { verdict: 'incorrect', feedback: 'There is no durable deduplication.', followUp: { ...q, id: 'transfer', prompt: 'What changes after restart?' } } : { verdict: 'correct', feedback: 'Correct.', followUp: null },
  });
  const done = f.present(); await f.waitFor('question');
  await f.post('answer', { response: 'No.' });
  for (let i = 0; i < 300 && f.interview.state.question?.id !== 'transfer'; i++) await delay(10);
  await f.waitFor('question');
  const shape = f.interview.state.messages.map(item => [item.role, item.kind, item.status, item.followUp].filter(value => value !== undefined));
  assert.deepEqual(shape, [['sphinx', 'activity'], ['sphinx', 'question', false], ['human', 'answer', 'graded'], ['sphinx', 'feedback'], ['sphinx', 'question', true]]);
  assert.equal(f.interview.state.messages[2].text, 'No.');
  assert.doesNotMatch(JSON.stringify(f.interview.state), /PRIVATE_KEY|PRIVATE_RUBRIC|idempotency/);
  await f.post('answer', { response: 'The set is recreated.' });
  assert.equal((await done).status, 'passed');
});

test('Skip this time lets Git continue during review, logs the reason, and never writes a receipt', async t => {
  let entered;
  const reviewing = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { generate: async (_count, options) => { entered(); await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); throw options.signal.reason; } });
  const done = f.present(); await reviewing; await f.waitFor('working');
  const response = await f.post('skip', { response: 'prod is down', revision: 'stale-revision' });
  assert.equal(response.status, 200, 'Skip does not need the latest revision while progress streams');
  assert.equal((await done).status, 'skipped');
  assert.equal(f.interview.state.phase, 'skipped');
  assert.equal(await f.store.approved(f.snapshot, f.config), false);
  const [entry] = await recentOverrides({ env: f.env });
  assert.equal(entry.kind, 'skip'); assert.equal(entry.reason, 'prod is down'); assert.equal(entry.id, f.snapshot.id);
  assert.equal((await f.store.read(f.snapshot.id)).status, 'skipped');
  assert.deepEqual(await f.store.pending(f.snapshot.repoRoot), [], 'A skipped check never resurfaces as pending');
});

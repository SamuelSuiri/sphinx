import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserPage } from '../src/browser-page.js';

function page(fetchImpl = () => assert.fail('No request expected')) {
  const element = () => ({ textContent: '', hidden: false, value: '', disabled: false, children: [],
    replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); }, focus() {},
    set innerHTML(_value) { assert.fail('Untrusted strings must not enter HTML'); },
  });
  const nodes = Object.fromEntries(['meta', 'status', 'message', 'feedback', 'error', 'question', 'prompt', 'choices', 'form', 'response', 'recovery', 'pause', 'waiting'].map(id => [id, element()]));
  const buttons = [nodes.pause, element(), { ...element(), dataset: { action: 'learn' } }, { ...element(), dataset: { action: 'dispute' } }];
  let events;
  const context = vm.createContext({ document: { getElementById: id => nodes[id], createElement: element, querySelectorAll: selector => selector === '[data-action]' ? buttons.slice(2) : buttons }, fetch: fetchImpl,
    EventSource: class { constructor() { events = this; this.closed = false; } close() { this.closed = true; } },
  });
  const script = browserPage({ token: 'fixture-token', nonce: 'fixture-nonce' }).match(/<script[^>]*>([\s\S]*?)<\/script>/u)[1];
  vm.runInContext(script, context);
  const update = state => events.onmessage({ data: JSON.stringify(state) });
  return { nodes, buttons, context, update, get events() { return events; } };
}
const question = { id: 'a'.repeat(64), sequence: 1, revision: 'r1', phase: 'question', waitingGit: true, target: 'refs/heads/main', repoRoot: '/fixture', question: { id: 'q1', prompt: '<img src=x onerror=steal()>', choices: ['<script>attack()</script>'] }, progress: { completed: 0, total: 1 }, usage: { calls: 1, limit: 20 } };

test('browser renders source-controlled question text as literal text and does not auto-submit', () => {
  const p = page(); p.update(question);
  assert.equal(p.nodes.prompt.textContent, question.question.prompt);
  assert.equal(p.nodes.choices.children[0].textContent, question.question.choices[0]);
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1');
  assert.equal(p.nodes.response.value, '');
});

test('late POST working response cannot overwrite a newer passed SSE update', async () => {
  let respond;
  const p = page(() => new Promise(resolve => { respond = resolve; }));
  p.update(question); p.nodes.response.value = 'My direct answer.';
  const submitted = p.context.send('answer');
  p.update({ ...question, sequence: 3, phase: 'passed', message: 'Complete.' });
  respond({ ok: true, json: async () => ({ ...question, sequence: 2, phase: 'working' }) });
  await submitted;
  assert.equal(p.nodes.status.textContent, 'Complete');
  assert.equal(p.nodes.question.hidden, true);
});

test('transient SSE disconnect disables actions without replay and reconnect restores the current question', () => {
  const p = page(); p.update(question); p.nodes.response.value = 'Unsent text';
  p.events.onerror();
  assert.equal(p.events.closed, false);
  assert.ok(p.buttons.every(button => button.disabled));
  assert.match(p.nodes.error.textContent, /Reconnecting/);
  p.update(question);
  assert.equal(p.nodes.response.value, 'Unsent text');
  assert.ok(p.buttons.every(button => !button.disabled));
  assert.equal(p.nodes.error.hidden, true);
});

test('completing one checkpoint keeps the event connection available for the next checkpoint in the batch', () => {
  const p = page(); p.update(question);
  p.update({ ...question, sequence: 2, phase: 'passed' });
  assert.equal(p.events.closed, false);
  p.events.onerror();
  assert.equal(p.events.closed, false, 'An intermediate pass must reconnect after a transient stream failure');
  assert.ok(p.buttons.every(button => button.disabled));
  p.update({ ...question, id: 'b'.repeat(64), sequence: 3 });
  assert.equal(p.nodes.status.textContent, 'Question 1 of 1');
  assert.equal(p.nodes.question.hidden, false);
  assert.ok(p.buttons.every(button => !button.disabled));
});

test('the page stops reconnecting only after an explicit operation-close update', () => {
  const p = page(); p.update(question);
  p.update({ ...question, sequence: 2, phase: 'passed', operationClosed: true });
  assert.equal(p.events.closed, true);
  assert.ok(p.buttons.every(button => button.disabled));
  p.events.onerror();
  assert.equal(p.nodes.error.hidden, true);
  assert.equal(p.nodes.status.textContent, 'Complete');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReviewer, reviewedData } from '../src/reviewer.js';
import { QUESTION_SCHEMA, validateQuestion, createEvaluator } from '../src/evaluator.js';
import { DEFAULT_CONFIG, saveConfig } from '../src/config.js';
import { pushSnapshots } from '../src/git.js';
import { createReviewWorkspace } from '../src/review-workspace.js';

const exec = promisify(execFile);
const snapshot = { version: 2, id: 'snapshot', files: ['worker.js'], projectContext: { path: '.sphinxcontext.md', text: 'A queue worker that must deduplicate retries within one process.', hash: 'context-hash' } };
const config = { ...structuredClone(DEFAULT_CONFIG), provider: 'codex', level: 'standard', changeTier: 'small', maxContextBytes: 100000, timeoutSeconds: 2, agentMaxTurns: 8, toolResultBytes: 16000 };
const question = { id: 'retry', concept: 'Duplicate operation', prompt: 'When an already-seen id is retried in this process, will another operation run? Explain why.', choices: ['Yes', 'No'], expectedAnswer: 'No; the unchanged helper returns before the operation.', rationale: 'Identify the stored id lookup and early return.', evidence: [{ path: 'worker.js', reason: 'Delegates to once().' }, { path: 'lib/once.js', reason: 'The helper remembers ids and returns early.' }] };
const schema = { type: 'object', additionalProperties: false, properties: { questions: { type: 'array', minItems: 1, maxItems: 1, items: QUESTION_SCHEMA } }, required: ['questions'] };
const toolAction = calls => ({ action: 'tools', calls: calls.map(([name, args]) => ({ name, arguments: JSON.stringify(args) })), assessment: null, summary: '', evidenceIds: [] });
const compactionReads = () => Array.from({ length: 6 }, (_, index) => [index === 0 ? 'read_diff' : 'read_file', { path: index === 0 ? 'worker.js' : 'lib/once.js' }]);
const finish = (evidenceIds = ['e1', 'e2'], q = question) => ({ action: 'finish', calls: [], assessment: { questions: [q] }, summary: 'The worker delegates retry deduplication to a process-local helper.', evidenceIds });
const validate = (assessment, paths) => assessment.questions.map(item => validateQuestion(item, paths));
const options = { snapshot, config, assessmentSchema: schema, assessmentInstructions: 'Ask at most one bounded outcome question. Precommit its key.', validateAssessment: validate };
const decode = invocation => JSON.parse(invocation.prompt.split('\n').at(-1));
const observations = data => data.conversation.flatMap(message => message.content.startsWith('Workspace observation') ? [JSON.parse(message.content.split('\n').at(-1))] : []);
const isSummary = args => args.schema.required.length === 1 && args.schema.required[0] === 'summary';
const summary = 'The changed worker calls once(id, operation). Exact observation e1 contains its diff; e2 contains the unchanged helper and process-local stored-id early return. Investigate no further if those observations suffice.';

function workspace({ padding = 0, read } = {}) {
  const evidencePaths = new Set(), history = [];
  return {
    tools: ['list_files', 'read_file', 'read_diff', 'search'].map(name => ({ name, description: 'Read immutable, filtered source.', inputSchema: { type: 'object', properties: {} } })), evidencePaths, history,
    async execute(name, args) {
      history.push({ name, args });
      if (read) return read(name, args, evidencePaths);
      if (args.path === '.env' || name === 'list_files') return { evidencePaths: [], files: ['worker.js', 'lib/once.js'] };
      const path = args.path ?? 'lib/once.js'; evidencePaths.add(path);
      return { path, revision: name === 'read_diff' ? 'base..head' : 'head', oid: 'a'.repeat(40), text: name === 'read_diff' ? '+return once(id, operation);' : `if (seen.has(id)) return; seen.add(id); operation();\n${'x'.repeat(padding)}`, startLine: 1, endLine: 2, truncated: false, evidencePaths: [path] };
    },
  };
}

test('investigative reviewer follows unchanged dependencies and saves exact evidence for grading', async () => {
  const space = workspace(), requests = [];
  let charges = 0;
  const result = await runReviewer({ ...options, workspace: space, beforeCall: async () => { charges++; }, runModel: async args => {
    await args.beforeCall(); requests.push(args); const data = decode(args), seen = observations(data);
    assert.deepEqual(data.projectContext, snapshot.projectContext);
    if (!seen.length) return toolAction([['read_diff', { path: 'worker.js' }]]);
    if (seen.length === 1) { assert.match(seen[0].result.text, /once/); return toolAction([['search', { query: 'once', prefix: 'lib/' }]]); }
    if (seen.length === 2) return toolAction([['read_file', { path: seen[1].result.path, revision: 'head', startLine: 1, limit: 20 }]]);
    return finish(['e1', 'e3']);
  } });
  assert.equal(charges, 4); assert.equal(result.review.calls, 4);
  assert.deepEqual(space.history.map(item => item.name), ['read_diff', 'search', 'read_file']);
  assert.ok(!snapshot.files.includes('lib/once.js'));
  assert.deepEqual(result.review.evidencePaths, ['worker.js', 'lib/once.js']);
  assert.match(result.review.evidence[1].result.text, /seen\.has/);
  assert.equal(result.review.evidence[1].result.oid, 'a'.repeat(40));
  assert.deepEqual(result.review.projectContext, snapshot.projectContext);
  const data = reviewedData(snapshot, result.review, question, config);
  assert.deepEqual(data.allowedEvidencePaths, ['worker.js', 'lib/once.js']);
  assert.equal(data.evidence.length, 2);
  assert.ok(requests.every(request => !request.prompt.includes('/private/checkout')));
});

test('Pi sequentially executes bounded 3–8 read batches for native and structured transports', async () => {
  for (const nativeTools of [false, true]) for (const count of [3, 8]) {
    const space = workspace();
    const execute = space.execute.bind(space);
    let active = 0, maximum = 0, requests = 0, charges = 0;
    space.execute = async (...args) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setImmediate(resolve));
      try { return await execute(...args); } finally { active--; }
    };
    const readCalls = Array.from({ length: count }, (_, index) => ({ id: `read-${index}`, name: index === 0 ? 'read_diff' : 'read_file', arguments: { path: index === 0 ? 'worker.js' : 'lib/once.js' } }));
    const provider = async args => {
      await args.beforeCall(); requests++;
      assert.ok(requests <= 2);
      const done = requests === 2;
      if (nativeTools) return { calls: done ? [{ id: 'finish', name: 'finish_review', arguments: { assessment: { questions: [question] }, summary, evidenceIds: ['e1', `e${count}`] } }] : readCalls };
      assert.equal(args.schema.properties.calls.maxItems, 8);
      return done ? finish(['e1', `e${count}`]) : toolAction(readCalls.map(call => [call.name, call.arguments]));
    };
    const result = await runReviewer({ ...options, workspace: space, nativeTools, beforeCall: async () => { charges++; }, runModel: provider, runToolModel: provider });
    assert.equal(maximum, 1);
    assert.equal(space.history.length, count);
    assert.equal(result.review.toolCalls, count);
    assert.equal(result.review.calls, 2);
    assert.equal(charges, 2);
    assert.deepEqual(result.review.evidence.map(item => item.id), ['e1', `e${count}`]);
  }
});

test('oversized or mixed-finish native batches execute no tools and never request a repair', async () => {
  const read = { id: 'read', name: 'read_diff', arguments: { path: 'worker.js' } };
  const done = { id: 'finish', name: 'finish_review', arguments: { assessment: { questions: [question] }, summary, evidenceIds: ['e1'] } };
  for (const calls of [[], Array.from({ length: 9 }, (_, index) => ({ ...read, id: `read-${index}` })), [read, done]]) {
    const space = workspace(); let requests = 0;
    await assert.rejects(runReviewer({ ...options, workspace: space, nativeTools: true, runToolModel: async args => {
      await args.beforeCall(); requests++; return { calls };
    }, runModel: async () => assert.fail('No summary or repair request is allowed') }), { code: 'INVALID_REVIEW_ACTION' });
    assert.equal(space.history.length, 0);
    assert.equal(requests, 1);
  }
});

test('read pages honor both the configured ceiling and context room reserved for bounded batches', async () => {
  for (const limits of [{ maxContextBytes: 32000, toolResultBytes: 16000 }, { maxContextBytes: 100000, toolResultBytes: 1000 }]) {
    const result = { evidencePaths: [], text: 'x'.repeat(1000) };
    const space = workspace({ read: () => result });
    let requests = 0;
    await assert.rejects(runReviewer({ ...options, config: { ...config, ...limits }, workspace: space, runModel: async args => {
      await args.beforeCall(); requests++;
      return toolAction(compactionReads());
    } }), { code: 'TOOL_RESULT_LIMIT' });
    assert.equal(requests, 1, 'An oversized observation cannot cause a repair request');
    assert.equal(space.history.length, 1, 'The rest of the batch stops when its page budget is exceeded');
  }
});

test('Pi native compaction preserves the exact evidence archive, project context and charged remaining budget', async () => {
  const space = workspace({ padding: 600 });
  const limit = 8;
  let turns = 0, charges = 0, summaryCalls = 0;
  const result = await runReviewer({ ...options, config: { ...config, maxContextBytes: 30000, timeoutSeconds: 5 }, maxReviewerCalls: limit, workspace: space, beforeCall: async () => { charges++; }, runModel: async args => {
    await args.beforeCall();
    assert.deepEqual(decode(args).projectContext, snapshot.projectContext);
    if (isSummary(args)) {
      summaryCalls++;
      assert.deepEqual(args.schema.required, ['summary']);
      assert.match(args.systemPrompt, /context summarization assistant/);
      assert.match(args.prompt, /\[Assistant tool calls\]|\[Tool result\]/);
      assert.match(args.prompt, /Workspace observation/);
      assert.ok(charges < limit, 'Compaction must leave a request to finish');
      return { summary };
    }
    turns++;
    const data = decode(args);
    assert.equal(data.remainingCalls, limit - charges + 1);
    if (summaryCalls) {
      assert.match(JSON.stringify(data.conversation), /Exact observation e1/);
      return finish(['e1', 'e2']);
    }
    return toolAction(compactionReads());
  } });
  assert.ok(summaryCalls >= 1, 'The real Pi session must issue native summarization calls');
  assert.ok(turns >= 3, 'Accumulate several bounded investigation turns before compacting');
  assert.equal(result.review.compactions, 1);
  assert.equal(result.review.harness, 'pi');
  assert.equal(result.review.calls, charges);
  assert.equal(charges, turns + summaryCalls);
  assert.deepEqual(result.review.evidence.map(item => item.id), ['e1', 'e2']);
  assert.equal(result.review.evidence[0].result.text, '+return once(id, operation);');
  assert.equal(result.review.evidence[1].result.text, `if (seen.has(id)) return; seen.add(id); operation();\n${'x'.repeat(600)}`);
  assert.equal(result.review.evidence[1].result.oid, 'a'.repeat(40));
  assert.deepEqual(result.review.projectContext, snapshot.projectContext);
  assert.ok(Buffer.byteLength(JSON.stringify(result.review)) < 30000);
});

test('Pi retains opaque reasoning for native continuation but excludes it from native summaries', async () => {
  let turns = 0, compactCalls = 0, charges = 0, continuedWithReasoning = false;
  const encrypted = 'opaque-private-reasoning-' + 'A'.repeat(800);
  const result = await runReviewer({ ...options, config: { ...config, maxContextBytes: 40000, timeoutSeconds: 5 }, workspace: workspace({ padding: 900 }), nativeTools: true,
    beforeCall: async () => { charges++; },
    runToolModel: async args => {
      await args.beforeCall();
      turns++;
      assert.match(args.messages.at(-1).content, /A queue worker that must deduplicate retries within one process/);
      if (compactCalls) return { calls: [{ id: 'finish', name: 'finish_review', arguments: { assessment: { questions: [question] }, summary: 'The helper makes duplicate operations return early.', evidenceIds: ['e1', 'e2'] } }] };
      if (turns > 1) {
        const original = args.messages.find(message => message.reasoning_details);
        assert.equal(original.reasoning_details[0].data, encrypted);
        continuedWithReasoning = true;
      }
      const calls = compactionReads().map(([name, args], index) => ({ id: `read-${turns}-${index}`, name, arguments: args }));
      return { calls, message: { role: 'assistant', content: null, tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })), reasoning_details: [{ type: 'reasoning.encrypted', data: encrypted }] } };
    },
    runModel: async args => {
      await args.beforeCall(); compactCalls++;
      assert.ok(isSummary(args));
      assert.match(args.systemPrompt, /context summarization assistant/);
      assert.ok(!args.prompt.includes(encrypted));
      assert.doesNotMatch(args.prompt, /opaque-private-reasoning|reasoning_details/);
      assert.deepEqual(decode(args).projectContext, snapshot.projectContext);
      assert.match(args.prompt, /Workspace observation/);
      return { summary };
    },
  });
  assert.ok(compactCalls >= 1);
  assert.equal(continuedWithReasoning, true);
  assert.equal(result.review.compactions, 1);
  assert.equal(result.review.calls, turns + compactCalls);
  assert.equal(result.review.calls, charges);
  assert.equal(result.review.evidence[0].result.text, '+return once(id, operation);');
  assert.equal(result.review.evidence[1].result.oid, 'a'.repeat(40));
  assert.doesNotMatch(JSON.stringify(result.review), /opaque-private-reasoning|reasoning_details/);
});

test('an oversized opaque continuation fails closed when Pi has no earlier turn it can compact', async () => {
  let calls = 0, charges = 0;
  await assert.rejects(runReviewer({ ...options, config: { ...config, maxContextBytes: 30000 }, workspace: workspace(), nativeTools: true,
    beforeCall: async () => { charges++; },
    runToolModel: async args => {
      await args.beforeCall(); calls++;
      assert.equal(calls, 1, 'An oversized second request must not reach the provider');
      const toolCalls = [{ id: 'diff', name: 'read_diff', arguments: { path: 'worker.js' } }];
      return { calls: toolCalls, message: { role: 'assistant', content: null,
        tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
        reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-' + 'A'.repeat(28000) }],
      } };
    },
    runModel: async () => assert.fail('There is no earlier completed turn for Pi to summarize'),
  }), { code: 'CONTEXT_LIMIT' });
  assert.equal(calls, 1); assert.equal(charges, 1);
});

test('fabricated or listing-only evidence cannot support an assessment', async () => {
  for (const [first, ids, candidate = question] of [
    [toolAction([['list_files', {}]]), ['e1']],
    [toolAction([['read_diff', { path: 'worker.js' }]]), ['invented']],
    [toolAction([['read_file', { path: 'lib/once.js' }]]), ['e1'], { ...question, evidence: [question.evidence[1]] }],
    [toolAction([['read_diff', { path: '.env' }]]), ['e1']],
  ]) {
    let turn = 0;
    await assert.rejects(runReviewer({ ...options, workspace: workspace(), runModel: async args => { await args.beforeCall(); return turn++ ? finish(ids, candidate) : first; } }), { code: 'INSUFFICIENT_EVIDENCE' });
    assert.equal(turn, 2, 'Unsupported evidence cannot trigger an automatic repair request');
  }
});

test('provider calls including compaction obey the shared budget with no retry or escalation', async () => {
  let charges = 0, requests = 0;
  await assert.rejects(runReviewer({ ...options, maxReviewerCalls: 1, workspace: workspace(), runModel: async () => { requests++; } }), { code: 'REVIEWER_BUDGET' });
  assert.equal(requests, 0);
  await assert.rejects(runReviewer({ ...options, maxReviewerCalls: 2, workspace: workspace(), beforeCall: async () => { charges++; }, runModel: async args => { await args.beforeCall(); requests++; return toolAction([['read_diff', { path: 'worker.js' }]]); } }), { code: 'REVIEWER_BUDGET' });
  assert.equal(charges, 2); assert.equal(requests, 2);
  requests = 0;
  await assert.rejects(runReviewer({ ...options, workspace: workspace(), beforeCall: async () => { throw new Error('shared budget exhausted'); }, runModel: async args => { await args.beforeCall(); requests++; } }), /shared budget exhausted/);
  assert.equal(requests, 0);
});

test('Pi compaction must pass the shared beforeCall budget before any summary is requested', async () => {
  let summaryAttempt = false, summaries = 0, normalCalls = 0, charges = 0;
  await assert.rejects(runReviewer({ ...options, config: { ...config, maxContextBytes: 30000, timeoutSeconds: 5 }, workspace: workspace({ padding: 600 }),
    beforeCall: async () => {
      if (summaryAttempt) throw Object.assign(new Error('Shared budget exhausted before compaction'), { code: 'TEST_SHARED_BUDGET' });
      charges++;
    },
    runModel: async args => {
      summaryAttempt = isSummary(args);
      await args.beforeCall();
      if (summaryAttempt) { summaries++; return { summary }; }
      normalCalls++;
      return toolAction(compactionReads());
    },
  }), { code: 'TEST_SHARED_BUDGET' });
  assert.equal(summaryAttempt, true);
  assert.equal(summaries, 0);
  assert.ok(normalCalls >= 2);
  assert.equal(charges, normalCalls);
});

test('whole-review deadline and cancellation stop an in-flight provider without accepting late results', async () => {
  let providerSignal;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(runReviewer({ ...options, config: { ...config, timeoutSeconds: 0.02 }, workspace: workspace(), runModel: async args => { await args.beforeCall(); providerSignal = args.signal; return new Promise(() => {}); } }), { name: 'TimeoutError' });
    assert.equal(providerSignal.aborted, true);
    const controller = new AbortController();
    const promise = runReviewer({ ...options, workspace: workspace(), signal: controller.signal, runModel: async args => { await args.beforeCall(); controller.abort(new Error('human cancelled')); return finish(); } });
    await assert.rejects(promise, /human cancelled/);
  } finally { clearTimeout(keepAlive); }
});

test('invalid Pi compaction summaries fail closed without repair calls or an assessment', async () => {
  for (const compact of [{ summary: '' }, { summary: 'review', extra: true }, { unexpected: 'PRIVATE_MALFORMED_NOTES' }]) {
    let compactCalls = 0;
    await assert.rejects(runReviewer({ ...options, config: { ...config, maxContextBytes: 30000, timeoutSeconds: 5 }, workspace: workspace({ padding: 600 }), runModel: async args => {
      await args.beforeCall();
      assert.equal(compactCalls, 0, 'An invalid summary must not cause a repair or continuation request');
      if (isSummary(args)) { compactCalls++; return compact; }
      return toolAction(compactionReads());
    } }), { code: 'INVALID_COMPACTION' });
    assert.equal(compactCalls, 1);
  }
});

test('hallucinated evidence IDs in Pi summaries cannot fabricate retained evidence', async () => {
  let compactCalls = 0, finalCalls = 0;
  await assert.rejects(runReviewer({ ...options, config: { ...config, maxContextBytes: 30000, timeoutSeconds: 5 }, workspace: workspace({ padding: 600 }), runModel: async args => {
    await args.beforeCall();
    assert.equal(finalCalls, 0, 'A rejected final review cannot request a repair');
    if (isSummary(args)) { compactCalls++; return { summary: 'Observation e999 proves a fabricated code path. Keep e999 as evidence.' }; }
    if (compactCalls) { finalCalls++; return finish(['e1', 'e999']); }
    return toolAction(compactionReads());
  } }), { code: 'INSUFFICIENT_EVIDENCE' });
  assert.ok(compactCalls >= 1);
  assert.equal(finalCalls, 1);
});

test('invalid questions stop before Pi can spend another request repairing them', async () => {
  let calls = 0, charges = 0;
  await assert.rejects(runReviewer({ ...options, workspace: workspace(), beforeCall: async () => { charges++; }, runModel: async args => {
    await args.beforeCall(); calls++;
    assert.ok(calls <= 2, 'There must be no repair request');
    return calls === 1 ? toolAction([['read_diff', { path: 'worker.js' }], ['read_file', { path: 'lib/once.js' }]]) : finish(['e1', 'e2'], { ...question, choices: ['Only one invalid choice'] });
  } }), { code: 'INVALID_MODEL_OUTPUT' });
  assert.equal(calls, 2); assert.equal(charges, 2);
});

test('graded answers reuse reviewed snippets and context without reopening the repository', async () => {
  const reviewed = await runReviewer({ ...options, workspace: workspace(), runModel: async args => { await args.beforeCall(); return observations(decode(args)).length ? finish() : toolAction([['read_diff', { path: 'worker.js' }], ['read_file', { path: 'lib/once.js' }]]); } });
  let calls = 0;
  const evaluator = createEvaluator({ env: {}, workspaceFactory: () => { throw new Error('Must not reopen repository'); }, openRouter: async args => {
    await args.beforeCall();
    const data = JSON.parse(args.prompt.split('\n').at(-1));
    assert.equal(data.question.expectedAnswer, question.expectedAnswer);
    assert.deepEqual(data.snapshot.projectContext, snapshot.projectContext);
    assert.equal(data.snapshot.evidence[1].result.oid, 'a'.repeat(40));
    assert.equal(data.humanAnswer, 'No, the helper returns early for the stored id.');
    return { verdict: 'correct', feedback: 'The stored id prevents the second operation.', evidence: question.evidence, followUp: null };
  } });
  const result = await evaluator.gradeAnswer({ snapshot, review: reviewed.review, question, answer: 'No, the helper returns early for the stored id.', config: { ...config, provider: 'openrouter' }, beforeCall: async () => { calls++; } });
  assert.equal(result.verdict, 'correct'); assert.equal(calls, 1);
  await assert.rejects(evaluator.gradeAnswer({ snapshot: { ...snapshot, id: 'different' }, review: reviewed.review, question, answer: 'No.', config }), { code: 'INVALID_REVIEW' });
});

test('real immutable workspace follows unchanged callers while ignored and working-tree content stay unread', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sphinx-review-integration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo'), home = join(directory, 'home');
  await mkdir(repo); await mkdir(home);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', SPHINX_HOME: home, SPHINX_USER_HOME: home };
  const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Sphinx test'); await git('config', 'user.email', 'sphinx@example.invalid');
  await mkdir(join(repo, 'lib'));
  await writeFile(join(repo, 'worker.js'), 'export const run = operation => operation();\n');
  await writeFile(join(repo, 'lib/once.js'), 'const seen = new Set();\nexport function once(id, operation) { if (seen.has(id)) return; seen.add(id); operation(); }\n');
  await writeFile(join(repo, '.env'), 'DO_NOT_SEND_PRIVATE_KEY=secret-marker\n');
  await git('add', '.'); await git('commit', '-m', 'initial'); const base = await git('rev-parse', 'HEAD');
  await writeFile(join(repo, 'worker.js'), 'import { once } from "./lib/once.js";\nexport const run = (id, operation) => once(id, operation);\n');
  await git('add', 'worker.js'); await git('commit', '-m', 'deduplicate'); const head = await git('rev-parse', 'HEAD');
  await writeFile(join(repo, 'lib/once.js'), 'UNCOMMITTED_SECRET_CONTENT\n');
  const settings = { ...structuredClone(DEFAULT_CONFIG), provider: 'codex', models: { small: { provider: 'codex', model: null }, medium: { provider: 'codex', model: null }, large: { provider: 'codex', model: null } } };
  await saveConfig(settings, env);
  const [change] = await pushSnapshots({ cwd: repo, remote: 'origin', remoteUrl: 'https://example.invalid/repo', input: `refs/heads/main ${head} refs/heads/main ${base}\n`, config: settings, env });
  const space = await createReviewWorkspace(change, settings, { env });
  const rejected = await space.execute('read_file', { path: '.env' });
  assert.deepEqual(rejected.evidencePaths, []);
  assert.equal(rejected.error.code, 'PATH_UNAVAILABLE');
  const result = await runReviewer({ ...options, snapshot: change, config: { ...settings, changeTier: 'small' }, workspace: space, runModel: async args => {
    await args.beforeCall(); const seen = observations(decode(args));
    if (!seen.length) return toolAction([['read_diff', { path: 'worker.js' }]]);
    if (seen.length === 1) { assert.match(seen[0].result.text, /once/); return toolAction([['read_file', { path: 'lib/once.js' }]]); }
    assert.match(seen[1].result.text, /seen\.has/);
    return finish();
  } });
  assert.deepEqual(result.review.evidencePaths, ['worker.js', 'lib/once.js']);
  assert.doesNotMatch(JSON.stringify(result), /secret-marker|UNCOMMITTED_SECRET_CONTENT|DO_NOT_SEND_PRIVATE_KEY/);
});

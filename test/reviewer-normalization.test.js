import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeFinishArguments } from '../src/reviewer-response.js';
import { runReviewer } from '../src/reviewer.js';
import { QUESTION_SCHEMA, validateQuestion } from '../src/evaluator.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createReviewWorkspace } from '../src/review-workspace.js';
import { CASES } from '../eval/cases.js';
import { createFixture } from '../eval/harness.js';

const recorded = JSON.parse(await readFile(new URL('./fixtures/reviewer-finish-envelopes.json', import.meta.url), 'utf8')).fixtures;
const config = { ...structuredClone(DEFAULT_CONFIG), timeoutSeconds: 10 };
const schema = { type: 'object', additionalProperties: false, properties: { questions: { type: 'array', minItems: 1, maxItems: 1, items: QUESTION_SCHEMA } }, required: ['questions'] };

async function replay(data, fixture, input, nativeTools, { maxReviewerCalls = 3 } = {}) {
  const workspace = await createReviewWorkspace(data.snapshot, config, { env: data.env });
  const raw = structuredClone(input);
  let calls = 0, audits = 0, charges = 0, checkpoint;
  const nativeMessage = { role: 'assistant', content: null, tool_calls: [{ id: 'finish-raw', type: 'function', function: { name: 'finish_review', arguments: JSON.stringify(raw) } }], reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-continuation' }] };
  const provider = async args => {
    await args.beforeCall(); calls++;
    if (calls === 1) {
      const reads = fixture.requiredPaths.map((path, index) => ({ id: `read-${index}`, name: 'read_file', arguments: { path, revision: 'head' } }));
      return nativeTools ? { calls: reads } : { action: 'tools', calls: reads.map(call => ({ name: call.name, arguments: JSON.stringify(call.arguments) })), assessment: null, summary: '' };
    }
    assert.equal(calls, 2, 'Normalization must not request a model repair');
    return nativeTools ? { calls: [{ id: 'finish-raw', name: 'finish_review', arguments: raw }], message: nativeMessage }
      : { action: 'finish', calls: [], ...raw };
  };
  const pending = runReviewer({ snapshot: data.snapshot, config: { ...config, changeTier: 'small' }, env: data.env, workspace, nativeTools,
    maxReviewerCalls, assessmentSchema: schema, assessmentInstructions: 'Ask one grounded question.',
    validateAssessment: (assessment, paths) => assessment.questions.map(question => validateQuestion(question, paths)),
    runModel: provider, runToolModel: provider, beforeCall: async () => { charges++; },
    auditAssessment: async args => { await args.beforeCall(); audits++; return { questions: args.questions }; },
    reviewerCheckpoint: { load: async () => null, save: async state => { checkpoint = structuredClone(state); } },
  });
  return { pending, inspect: () => ({ calls, audits, charges, checkpoint, nativeMessage, raw }) };
}

test('recorded first finish envelopes complete through real Pi and immutable evidence in both transports', async t => {
  for (const entry of recorded) {
    const fixture = CASES.find(item => item.id === entry.case);
    const data = await createFixture(fixture, config); t.after(data.cleanup);
    for (const nativeTools of [false, true]) {
      const run = await replay(data, fixture, entry.arguments, nativeTools);
      const result = await run.pending;
      const { calls, audits, charges, checkpoint, nativeMessage, raw } = run.inspect();
      assert.equal(calls, 2); assert.equal(audits, 1); assert.equal(charges, 3);
      assert.deepEqual(result.questions, entry.arguments.assessment.questions);
      assert.equal(result.review.summary, entry.arguments.assessment.summary);
      assert.deepEqual(raw, entry.arguments, 'The provider payload must not be mutated');
      const message = checkpoint.entries.map(item => item.message).find(item => Array.isArray(item?.content) && item.content.some(part => part.type === 'toolCall' && part.name === 'finish_review'));
      const canonical = message.content.find(part => part.name === 'finish_review').arguments;
      assert.deepEqual(canonical.assessment, { questions: entry.arguments.assessment.questions });
      assert.equal(canonical.summary, entry.arguments.assessment.summary);
      if (nativeTools) assert.deepEqual(message.sphinxNativeMessage, nativeMessage, 'Raw signed provider continuation is preserved beside canonical Pi arguments');
    }
  }
});

test('valid JSON-string assessments decode without changing question or evidence values', async t => {
  const fixture = CASES[0], data = await createFixture(fixture, config); t.after(data.cleanup);
  const original = recorded.find(item => item.case === fixture.id).arguments;
  const encoded = { ...original, assessment: JSON.stringify(original.assessment) };
  for (const nativeTools of [false, true]) {
    const run = await replay(data, fixture, encoded, nativeTools);
    const result = await run.pending;
    assert.deepEqual(result.questions, original.assessment.questions);
    assert.equal(run.inspect().charges, 3);
  }
});

test('normalization preserves unknown fields and never overwrites or discards duplicate metadata', () => {
  const question = { prompt: 'Exact text\n"quotes"', evidence: [{ path: 'source.js', reason: 'exact reason' }] };
  const input = { assessment: { questions: [question], summary: 'inside', evidenceIds: ['e1'], unknown: 42 }, summary: 'outside', evidenceIds: ['e2'], unexpected: true };
  assert.deepEqual(normalizeFinishArguments(input), input);
  const same = { assessment: { questions: [question], summary: 'same' }, summary: 'same' };
  assert.deepEqual(normalizeFinishArguments(same), same, 'Even identical duplicates remain subject to strict validation');
  const moved = normalizeFinishArguments({ assessment: { questions: [question], summary: 'notes', evidenceIds: ['e1'] } });
  assert.deepEqual(moved, { assessment: { questions: [question] }, summary: 'notes', evidenceIds: ['e1'] });
  assert.equal(moved.assessment.questions[0], question);
});

test('malformed JSON, ambiguous metadata, unknown fields and unread citations remain unapproved', async t => {
  const fixture = CASES[0], data = await createFixture(fixture, config); t.after(data.cleanup);
  const original = recorded.find(item => item.case === fixture.id).arguments;
  const invalid = [
    { ...original, assessment: `${JSON.stringify({ questions: original.assessment.questions })}, "summary":"trailing fragment"}` },
    { ...original, assessment: JSON.stringify([original.assessment]) },
    { ...original, summary: 'conflicts with nested summary' },
    { ...original, summary: original.assessment.summary },
    { ...original, summary: '' },
    { ...original, unexpected: true },
    { ...original, assessment: { ...original.assessment, unexpected: true } },
    { ...original, assessment: { ...original.assessment, questions: [{ ...original.assessment.questions[0], evidence: [{ path: 'unread.js', reason: 'Invented support' }] }] } },
    { ...original, assessment: { ...original.assessment, questions: [{ ...original.assessment.questions[0], evidence: [{ path: '.env', reason: 'Excluded support' }] }] } },
  ];
  for (const input of invalid) for (const nativeTools of [false, true]) {
    const run = await replay(data, fixture, input, nativeTools);
    await assert.rejects(run.pending, error => error.code === 'REVIEWER_BUDGET');
    assert.equal(run.inspect().audits, 0);
    assert.equal(run.inspect().charges, 2, 'Invalid metadata/evidence must not spend an audit or a repair request outside the allowance');
  }
});

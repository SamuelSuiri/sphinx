import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewer } from '../src/reviewer.js';
import { QUESTION_SCHEMA, validateQuestion } from '../src/evaluator.js';
import { DEFAULT_CONFIG } from '../src/config.js';

test('Pi resumes compaction inside a reopened repair allowance and preserves the shared ceiling', async () => {
  const question = {
    id: 'retry', concept: 'Retry boundary', prompt: 'Will the same id execute again? Explain why.', choices: [],
    expectedAnswer: 'No, the guard returns for an already-seen id.', rationale: 'The changed worker delegates to the id guard.',
    evidence: [{ path: 'worker.js', reason: 'Calls the retry guard.' }],
  };
  const schema = { type: 'object', properties: { questions: { type: 'array', maxItems: 1, items: QUESTION_SCHEMA } }, required: ['questions'] };
  for (const maxReviewerCalls of [5, 8]) {
    let turns = 0, summaries = 0, audits = 0, charges = 0;
    const evidencePaths = new Set();
    const workspace = {
      evidencePaths,
      tools: ['list_files', 'read_file', 'read_diff', 'search'].map(name => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })),
      async execute(name) {
        if (name === 'list_files') return { files: [], evidencePaths: [] };
        evidencePaths.add('worker.js');
        return {
          path: 'worker.js', baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), offset: 0,
          text: '--- a/worker.js\n+++ b/worker.js\n@@ -1 +1 @@\n-execute();\n+guard();\n', evidencePaths: ['worker.js'],
        };
      },
    };
    const result = runReviewer({
      snapshot: { id: 'repair-compaction', files: ['worker.js'] },
      config: { ...DEFAULT_CONFIG, changeTier: 'small', maxContextBytes: 30000, maxOutputTokens: 8192, timeoutSeconds: 5, agentMaxTurns: 8 },
      assessmentSchema: schema, assessmentInstructions: 'Ask one bounded causal prediction.',
      validateAssessment: (assessment, paths) => assessment.questions.map(item => validateQuestion(item, paths)),
      workspace, nativeTools: true, maxReviewerCalls,
      beforeCall: async () => { charges++; },
      runToolModel: async args => {
        await args.beforeCall(); turns++;
        if (turns < 4) return { calls: [{ id: `turn-${turns}`, name: 'list_files', arguments: {} }] };
        // Each field fits its validation limit, but retaining this rejected
        // candidate makes the repair request exceed the active context cap.
        const candidate = turns === 4 ? {
          ...question, prompt: 'x'.repeat(7400), rationale: 'x'.repeat(11000), expectedAnswer: 'x'.repeat(2600),
          evidence: [{ path: 'unread.js', reason: 'An unsupported citation.' }],
        } : question;
        return { calls: [{ id: `turn-${turns}`, name: 'finish_review', arguments: { assessment: { questions: [candidate] }, summary: 'The worker delegates retry handling.' } }] };
      },
      runModel: async args => {
        assert.deepEqual(args.schema.required, ['summary'], 'Only Pi can initiate this compaction request');
        await args.beforeCall(); summaries++;
        return { summary: 'Observation e1 contains the worker diff. Correct the unread citation using worker.js.' };
      },
      auditAssessment: async args => {
        await args.beforeCall(); audits++;
        assert.deepEqual(args.questions, [question]);
        return { questions: args.questions };
      },
    });
    if (maxReviewerCalls === 5) {
      await assert.rejects(result, { code: 'REVIEWER_BUDGET' });
      assert.deepEqual({ turns, summaries, audits, charges }, { turns: 4, summaries: 0, audits: 0, charges: 4 });
    } else {
      const accepted = await result;
      assert.deepEqual(accepted.questions, [question]);
      assert.equal(accepted.review.compactions, 1);
      assert.equal(accepted.review.calls, 7);
      assert.deepEqual({ turns, summaries, audits, charges }, { turns: 5, summaries: 1, audits: 1, charges: 7 });
    }
  }
});

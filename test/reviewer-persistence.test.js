import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, writeJson } from '../src/config.js';
import { createSessionStore, sessionFile } from '../src/sessions.js';

const snapshot = { id: 'e'.repeat(64), repoRoot: '/fixture/repo', repoId: 'fixture', event: 'pre-push', target: { ref: 'refs/heads/main' }, files: ['worker.js'], stats: { additions: 2, deletions: 1, files: 1 } };
const question = { id: 'retry', concept: 'idempotency', prompt: 'Does a repeated request create another record? Explain why.', choices: ['Yes', 'No'], expectedAnswer: 'No, the request id is deduplicated.', rationale: 'The key is checked before insertion.', evidence: [{ path: 'worker.js', reason: 'Deduplicates by request id.' }] };
const checkpoint = { version: 1, snapshotId: snapshot.id, entries: [], archive: [{ id: 'e1', paths: ['worker.js'], result: { text: 'PRIVATE_REVIEW_EVIDENCE' } }], calls: 1 };

async function fixture(t, generate) {
  const home = await mkdtemp(path.join(tmpdir(), 'sphinx-review-persistence-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { SPHINX_HOME: home };
  const config = { ...structuredClone(DEFAULT_CONFIG), maxModelCalls: 4 };
  const makeStore = extra => createSessionStore({ env, generate, ...extra });
  const store = makeStore();
  await store.ensure(snapshot, config);
  return { store, makeStore, config, env };
}

test('a pending audit survives a new store process, resumes with one call left, and stays private', async t => {
  let runs = 0;
  const pendingAudit = { ...checkpoint, pendingAssessment: { assessment: { questions: [question] }, summary: 'The request id guards insertion.' } };
  const f = await fixture(t, async (_snapshot, _config, { reviewerCheckpoint, beforeCall, maxReviewerCalls }) => {
    const saved = await reviewerCheckpoint.load();
    if (++runs === 1) {
      assert.equal(saved, null);
      await beforeCall();
      await reviewerCheckpoint.save(pendingAudit);
      await beforeCall();
      throw new Error('Transport interrupted');
    }
    assert.deepEqual(saved, pendingAudit);
    assert.equal(maxReviewerCalls, 1);
    await beforeCall();
    return { questions: [question], review: { evidence: saved.archive } };
  });
  await assert.rejects(f.store.start(snapshot.id, f.config), /Transport interrupted/);
  const failed = await f.store.read(snapshot.id);
  assert.equal(failed.calls, 2);
  assert.equal(failed.preparation.status, 'failed');
  assert.equal(await f.store.approved(snapshot, f.config), false);
  assert.deepEqual(failed.reviewerCheckpoint, pendingAudit);
  assert.equal(f.store.public(failed).preparation.minimumReviewerCalls, 1);
  assert.doesNotMatch(JSON.stringify(f.store.public(failed)), /PRIVATE_REVIEW_EVIDENCE|reviewerCheckpoint/);
  assert.equal((await stat(sessionFile(snapshot.id, f.env))).mode & 0o777, 0o600);
  const resumed = f.makeStore();
  const state = await resumed.start(snapshot.id, f.config);
  assert.equal(state.status, 'active');
  assert.equal(state.usage.calls, 3);
  assert.equal((await resumed.read(snapshot.id)).reviewerCheckpoint, undefined);
  assert.equal(await resumed.approved(snapshot, f.config), false, 'Resuming investigation never answers for the human');
});

test('saved reads without a pending audit cannot spend a lone remaining review call', async t => {
  let runs = 0;
  const f = await fixture(t, async (_s, _c, { reviewerCheckpoint, beforeCall }) => {
    runs++;
    await beforeCall(); await reviewerCheckpoint.save(checkpoint); await beforeCall();
    throw new Error('Investigation interrupted before finalization');
  });
  await assert.rejects(f.store.start(snapshot.id, f.config), /Investigation interrupted/);
  assert.equal(f.store.public(await f.store.read(snapshot.id)).preparation.minimumReviewerCalls, 2);
  await assert.rejects(f.store.start(snapshot.id, f.config), /review needs at least 2/);
  assert.equal(runs, 1);
  assert.equal((await f.store.read(snapshot.id)).calls, 2);
  assert.equal(await f.store.approved(snapshot, f.config), false);
});

test('a pending audit can explicitly extend by just one audit and one grading call', async t => {
  let runs = 0;
  const pendingAudit = { ...checkpoint, pendingAssessment: { assessment: { questions: [question] }, summary: 'The request id guards insertion.' } };
  const f = await fixture(t, async (_s, _c, { reviewerCheckpoint, beforeCall }) => {
    if (++runs > 1) { await beforeCall(); return { questions: [question] }; }
    await beforeCall(); await beforeCall(); await reviewerCheckpoint.save(pendingAudit);
    throw new Error('Audit provider interrupted');
  });
  await assert.rejects(f.store.start(snapshot.id, f.config), /Audit provider interrupted/);
  const reduced = { ...f.config, maxModelCalls: 2 };
  const authorized = await f.store.retryReview(snapshot.id, reduced);
  assert.deepEqual(authorized.usage, { calls: 2, limit: 4 });
  const state = await f.store.start(snapshot.id, reduced);
  assert.equal(state.status, 'active');
  assert.deepEqual(state.usage, { calls: 3, limit: 4 });
  assert.equal(await f.store.approved(snapshot, reduced), false);
});

test('an explicit allowance extension retains investigative progress and charged usage', async t => {
  const f = await fixture(t, async (_s, _c, { reviewerCheckpoint, beforeCall }) => {
    await beforeCall();
    await reviewerCheckpoint.save(checkpoint);
    throw new Error('Interrupted');
  });
  await assert.rejects(f.store.start(snapshot.id, f.config), /Interrupted/);
  await f.store.retryReview(snapshot.id, f.config);
  const saved = await f.store.read(snapshot.id);
  assert.deepEqual(saved.reviewerCheckpoint, checkpoint);
  assert.equal(saved.calls, 1);
  assert.equal(saved.callLimit, 5);
});

test('policy or source changes prevent loading a saved investigation', async t => {
  let loaded = false;
  const f = await fixture(t, async () => { loaded = true; throw new Error('Should not run'); });
  const saved = await f.store.read(snapshot.id);
  saved.reviewerCheckpoint = checkpoint;
  await writeJson(sessionFile(snapshot.id, f.env), saved);
  await assert.rejects(f.store.start(snapshot.id, { ...f.config, level: 'thorough' }), /settings changed/);
  const stale = f.makeStore({ validate: async () => { throw new Error('Source changed'); } });
  await assert.rejects(stale.start(snapshot.id, f.config), /Source changed/);
  assert.equal(loaded, false);
});

test('a checkpoint cannot be stored for a different immutable snapshot', async t => {
  const f = await fixture(t, async (_s, _c, { reviewerCheckpoint }) => {
    await reviewerCheckpoint.save({ ...checkpoint, snapshotId: 'f'.repeat(64) });
  });
  await assert.rejects(f.store.start(snapshot.id, f.config), /checkpoint is invalid/);
  assert.equal((await f.store.read(snapshot.id)).reviewerCheckpoint, undefined);
  assert.equal(await f.store.approved(snapshot, f.config), false);
});

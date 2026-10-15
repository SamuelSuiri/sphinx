import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createSessionStore, sessionFile } from '../src/sessions.js';

test('approval cannot read a transient receipt across an entire write-and-rollback lock cycle', { timeout: 5000 }, async t => {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'sphinx-receipt-race-'));
  const env = { SPHINX_HOME: home, SPHINX_USER_HOME: home }, config = structuredClone(DEFAULT_CONFIG);
  const snapshot = { id: 'a'.repeat(64), repoRoot: home, event: 'pre-push', target: { ref: 'refs/heads/main' }, files: ['app.js'], stats: { additions: 1, deletions: 1, files: 1 } };
  const question = { id: 'q', concept: 'retry', prompt: 'Can a retry duplicate this effect?', choices: [], expectedAnswer: 'Yes', rationale: 'An unconditional effect.', evidence: [{ path: 'app.js', reason: 'The effect is unconditional.' }] };
  const store = createSessionStore({ env,
    generate: async (_snapshot, _config, options) => { await options.beforeCall(); return { questions: [question] }; },
    grade: async request => { await request.beforeCall(); return { verdict: 'correct', feedback: 'Correct.', followUp: null }; },
  });
  await store.ensure(snapshot, config); await store.start(snapshot.id, config);
  const controller = new AbortController(), file = sessionFile(snapshot.id, env);
  const originalOpen = fs.open, originalRename = fs.rename;
  let renamed, releaseWriter, intercept = true, writer;
  const visibleReceipt = new Promise(resolve => { renamed = resolve; });
  const continueWriter = new Promise(resolve => { releaseWriter = resolve; });
  t.after(async () => {
    controller.abort(); releaseWriter(); await writer;
    t.mock.restoreAll(); syncBuiltinESMExports();
    await fs.rm(home, { recursive: true, force: true });
  });
  t.mock.method(fs, 'rename', async (from, to) => {
    const pending = to === file ? JSON.parse(await fs.readFile(from, 'utf8')) : null;
    await originalRename(from, to);
    if (pending?.status === 'passed') { renamed(); await continueWriter; }
  });
  t.mock.method(fs, 'open', async (filePath, ...args) => {
    if (filePath !== file || !intercept) return originalOpen(filePath, ...args);
    intercept = false;
    writer = store.answer(snapshot.id, 'Yes, the effect is unconditional.', config, { signal: controller.signal }).catch(error => error);
    const outcome = await Promise.race([
      visibleReceipt.then(() => 'receipt-renamed'), writer.then(() => 'writer-stopped'),
    ]);
    if (outcome === 'writer-stopped') {
      // The receipt reader owns the same lock, so the writer cannot start.
      assert.equal((await writer).code, 'SPHINX_SESSION_BUSY');
      return originalOpen(filePath, ...args);
    }
    // Without a read lock, capture the transient passed inode, then complete
    // cancellation and rollback before readJson returns and rechecks the lock.
    // Both lock-presence checks would see no lock despite this intervening cycle.
    const handle = await originalOpen(filePath, ...args);
    controller.abort(new Error('Pause during receipt persistence'));
    releaseWriter(); await writer;
    return handle;
  });
  syncBuiltinESMExports();
  assert.equal(await store.approved(snapshot, config), false);
  assert.equal(intercept, false, 'The writer race was scheduled during the approval read');
  assert.equal((await store.read(snapshot.id)).status, 'active');
  assert.equal(await store.approved(snapshot, config), false);
});

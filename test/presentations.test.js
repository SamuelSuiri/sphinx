import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { queuePresentation, listPresentations, claimPresentation } from '../src/presentations.js';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'sphinx-presentations-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const env = { SPHINX_HOME: path.join(base, 'state') };
  const root = path.join(base, 'repo'); await mkdir(root);
  execFileSync('git', ['init', '-q', root], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  const repoRoot = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const session = { id: 'a'.repeat(64), snapshot: { repoRoot, patch: 'NEVER_STORE_EVIDENCE' } };
  const list = options => listPresentations({ cwd: root, host: 'claude', hostSession: 'human-session', env, ...options });
  return { base, root, repoRoot, env, session, list };
}

test('Git presentation requests contain metadata only and are claimed once', async t => {
  const f = await fixture(t), request = await queuePresentation(f.session, { env: f.env });
  const raw = await readFile(path.join(f.env.SPHINX_HOME, 'presentations', `${request.token}.json`), 'utf8');
  assert.equal(raw.includes('NEVER_STORE_EVIDENCE'), false);
  const pending = await f.list(); assert.equal(pending.length, 1);
  const claims = await Promise.all([claimPresentation(pending[0], { env: f.env }), claimPresentation(pending[0], { env: f.env })]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.deepEqual(await f.list(), []);
  await queuePresentation(f.session, { env: f.env });
  assert.equal((await f.list()).length, 1, 'Retrying Git queues a new automatic form');
});

test('same-snapshot retries coalesce without discarding attempts queued after listing', async t => {
  const f = await fixture(t);
  await queuePresentation(f.session, { env: f.env }); await queuePresentation(f.session, { env: f.env });
  const pending = await f.list(); assert.equal(pending.length, 1); assert.equal(pending[0].superseded.length, 1);
  const newer = await queuePresentation(f.session, { env: f.env });
  await claimPresentation(pending[0], { env: f.env });
  assert.equal((await f.list())[0].token, newer.token);
});

test('unowned forms stay in their repo; Codex-owned forms follow only their thread across directories', async t => {
  const f = await fixture(t);
  await queuePresentation(f.session, { env: f.env });
  assert.deepEqual(await f.list({ cwd: f.base }), []);
  const env = { ...f.env, CODEX_THREAD_ID: 'codex-thread' };
  const owned = await queuePresentation({ ...f.session, id: 'b'.repeat(64) }, { env });
  assert.equal((await f.list()).length, 1);
  assert.equal((await f.list({ host: 'codex', hostSession: 'other' })).length, 1);
  const across = await f.list({ cwd: f.base, host: 'codex', hostSession: 'codex-thread' });
  assert.equal(across.length, 1); assert.equal(across[0].token, owned.token);
});

test('Claude session tags take precedence over a parent Codex thread and follow cross-repository pushes', async t => {
  const f = await fixture(t);
  const env = { ...f.env, SPHINX_CLAUDE_SESSION: 'claude-session', CODEX_THREAD_ID: 'parent-codex' };
  const request = await queuePresentation(f.session, { env });
  assert.equal(request.host, 'claude');
  assert.deepEqual(await f.list({ cwd: f.base, host: 'codex', hostSession: 'parent-codex' }), []);
  assert.equal((await f.list({ cwd: f.base, host: 'claude', hostSession: 'claude-session' }))[0].token, request.token);
});

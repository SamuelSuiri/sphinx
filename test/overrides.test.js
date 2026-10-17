import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { toggleYolo, yoloStatus } from '../src/overrides.js';

async function sphinxEnv(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'sphinx-overrides-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { HOME: home, SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, '.sphinx') };
}

test('a repository toggle flips its effective yolo state even when global yolo is on', async t => {
  const env = await sphinxEnv(t), repoRoot = '/work/repo';
  await toggleYolo({ repoRoot: null, env });
  assert.equal((await yoloStatus(repoRoot, env)).scope, 'global');
  const off = await toggleYolo({ repoRoot, env });
  assert.equal(off.enabled, false);
  assert.equal(await yoloStatus(repoRoot, env), null);
  assert.equal((await yoloStatus('/work/other', env)).scope, 'global', 'Other repositories keep the global setting');
  const on = await toggleYolo({ repoRoot, env });
  assert.equal(on.enabled, true);
  assert.equal((await yoloStatus(repoRoot, env)).scope, 'repo');
});

test('repository yolo off without global yolo removes the repository entry', async t => {
  const env = await sphinxEnv(t), repoRoot = '/work/repo';
  await toggleYolo({ repoRoot, env });
  assert.equal((await toggleYolo({ repoRoot, env })).enabled, false);
  await toggleYolo({ repoRoot: null, env });
  assert.equal((await yoloStatus(repoRoot, env)).scope, 'global', 'No stale OFF entry is left behind');
});

test('turning global yolo off reports repositories that still bypass checks', async t => {
  const env = await sphinxEnv(t);
  await toggleYolo({ repoRoot: '/work/on', env });
  await toggleYolo({ repoRoot: null, env });
  await toggleYolo({ repoRoot: '/work/off', env });
  const result = await toggleYolo({ repoRoot: null, env });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.reposStillOn, ['/work/on']);
});

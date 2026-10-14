import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectContext, PROJECT_CONTEXT_FILE, PROJECT_CONTEXT_MAX_BYTES } from '../src/repo-context.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sphinx-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); await mkdir(repo);
  return { repo, file: join(repo, PROJECT_CONTEXT_FILE), env: { SPHINX_HOME: join(root, 'state') } };
}

test('project context is optional, bounded, and changes its identity with its contents', async t => {
  const { repo, file, env } = await fixture(t);
  const missing = await loadProjectContext(repo, { env });
  assert.equal(missing.text, '');
  await writeFile(file, 'A scheduling app. Reservations must never overlap.');
  const first = await loadProjectContext(repo, { env });
  assert.match(first.text, /Reservations/);
  assert.notEqual(first.hash, missing.hash);
  await writeFile(file, 'A scheduling app for shared laboratory equipment.');
  assert.notEqual((await loadProjectContext(repo, { env })).hash, first.hash);
  await writeFile(file, 'x'.repeat(PROJECT_CONTEXT_MAX_BYTES + 1));
  await assert.rejects(loadProjectContext(repo, { env }), /exceeds/);
});

test('ignored context never opens or follows its target, and an allowed symlink is rejected', async t => {
  const { repo, file, env } = await fixture(t);
  const target = join(repo, '.env');
  await writeFile(target, 'DO_NOT_READ_THIS_PRIVATE_CONTEXT');
  await symlink(target, file);
  await assert.rejects(loadProjectContext(repo, { env }), /symlinks/);
  const ignored = await loadProjectContext(repo, { env, ignore: { matches: name => name === PROJECT_CONTEXT_FILE } });
  assert.equal(ignored.text, '');
  assert.equal(JSON.stringify(ignored).includes('DO_NOT_READ_THIS'), false);
});

test('context cannot masquerade as binary data or a directory', async t => {
  const { repo, file, env } = await fixture(t);
  await writeFile(file, 'binary\0context');
  await assert.rejects(loadProjectContext(repo, { env }), /UTF-8 text/);
  await rm(file); await mkdir(file);
  await assert.rejects(loadProjectContext(repo, { env }), /regular file/);
});

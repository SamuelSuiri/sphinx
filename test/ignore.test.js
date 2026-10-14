import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileIgnore, loadIgnorePolicy } from '../src/ignore.js';

test('sensitive defaults apply recursively and cannot be negated', () => {
  const ignored = compileIgnore(['!.env', '!**/*.key', '!credentials.json']);
  for (const path of ['.env', '.env.example', 'app/.env.production', 'nested/private.key', 'private.pem', 'id_ed25519', 'app/credentials.json', '.aws/credentials']) {
    assert.equal(ignored(path), true, path);
  }
  for (const path of ['src/main.js', 'env.js', 'public/id_ed25519.pub', 'README.md']) assert.equal(ignored(path), false, path);
});

test('gitignore-like rules support roots, directories, globs, negations, comments, and escaped prefixes', () => {
  const ignored = compileIgnore(['# comment', '/root.txt', 'build/', '*.log', '**/generated/**', '!keep.log', '\\#literal', '\\!literal']);
  for (const path of ['root.txt', 'build/a.js', 'app/build/a.js', 'a.log', 'nested/a.log', 'generated/a.js', 'nested/generated/a.js', '#literal', '!literal']) assert.equal(ignored(path), true, path);
  for (const path of ['nested/root.txt', 'build', 'keep.log', 'nested/keep.log', 'src/main.js']) assert.equal(ignored(path), false, path);
});

test('loads global and repository policies, and hashes effective policy inputs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sphinx-ignore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = join(root, 'state');
  const repo = join(root, 'repo');
  await mkdir(state);
  await mkdir(repo);
  await writeFile(join(state, 'ignore'), '*.data\n!allowed.data\n');
  await writeFile(join(repo, '.sphinxignore'), '!public.data\nprivate/\n*.local\n!allowed.local\n!*.generated\n');
  const env = { SPHINX_HOME: state, SPHINX_USER_HOME: root };
  const first = await loadIgnorePolicy(repo, { env, exclude: ['*.generated'] });
  assert.equal(first.matches('private.data'), true);
  assert.equal(first.matches('public.data'), true);
  assert.equal(first.matches('allowed.data'), false);
  assert.equal(first.matches('private.local'), true);
  assert.equal(first.matches('allowed.local'), false);
  assert.equal(first.matches('private/a.js'), true);
  assert.equal(first.matches('a.generated'), true);
  assert.equal(first.matches('.env'), true);
  assert.equal(first.hash, (await loadIgnorePolicy(repo, { env, exclude: ['*.generated'] })).hash);
  await writeFile(join(state, 'ignore'), '*.data\n*.tmp\n');
  assert.notEqual(first.hash, (await loadIgnorePolicy(repo, { env, exclude: ['*.generated'] })).hash);
});

test('refuses policy symlinks before reading their target', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sphinx-ignore-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.env'), 'DO_NOT_READ_THIS\n');
  await symlink(join(root, '.env'), join(root, '.sphinxignore'));
  await assert.rejects(loadIgnorePolicy(root, { env: { SPHINX_HOME: join(root, 'state') } }), /regular file, not a symlink/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG, loadConfig, writeJson } from '../src/config.js';
import { commitSnapshot, pushSnapshots } from '../src/git.js';
import { createReviewWorkspace } from '../src/review-workspace.js';

const exec = promisify(execFile);
const zero = '0'.repeat(40);
async function fixture(t, overrides = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'sphinx-workspace-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const cwd = join(temporary, 'repo'), home = join(temporary, 'home');
  await mkdir(cwd); await mkdir(home);
  const env = { ...process.env, SPHINX_HOME: home, SPHINX_USER_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, maxBuffer: 10 * 1024 * 1024 })).stdout.trimEnd();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Sphinx fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await writeJson(join(home, 'config.json'), { ...structuredClone(DEFAULT_CONFIG), events: ['pre-push', 'pre-commit'], ...overrides });
  const config = await loadConfig(cwd, env);
  const put = async files => {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(join(cwd, path, '..'), { recursive: true });
      await writeFile(join(cwd, path), contents);
    }
  };
  const commit = async files => {
    await put(files);
    await git('add', '--all');
    await git('commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const snapshot = async (base = zero) => {
    const head = await git('rev-parse', 'HEAD');
    return (await pushSnapshots({ cwd, config, env, remote: 'origin', remoteUrl: 'https://example.invalid/repo', input: `refs/heads/main ${head} refs/heads/main ${base}\n` }))[0];
  };
  const workspace = async (base = zero, options = {}) => createReviewWorkspace(await snapshot(base), { ...config, ...options }, { env });
  const spy = async () => {
    const realGit = (await exec('which', ['git'])).stdout.trim();
    const bin = join(temporary, 'bin'), logfile = join(temporary, 'git.jsonl');
    await mkdir(bin, { recursive: true });
    await writeFile(logfile, '');
    await writeFile(join(bin, 'git'), `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst child = require('node:child_process');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(logfile)}, JSON.stringify(args) + '\\n');\nconst result = child.spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'});\nprocess.exit(result.status ?? 1);\n`, { mode: 0o755 });
    env.PATH = `${bin}:${env.PATH}`;
    return async () => (await readFile(logfile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  };
  return { cwd, home, env, config, git, put, commit, snapshot, workspace, spy };
}
const success = result => { assert.equal(result.error, undefined, JSON.stringify(result)); return result; };

test('workspace investigates immutable changed and unchanged files and records exact evidence', async t => {
  const f = await fixture(t);
  const base = await f.commit({ 'src/changed.js': 'export const limit = 1;\n', 'src/dependency.js': 'export const invariant = "dependency";\n', 'removed.txt': 'deleted behavior\n' });
  await rm(join(f.cwd, 'removed.txt'));
  await f.commit({ 'src/changed.js': 'export const limit = 2;\n' });
  const reads = await f.spy();
  const workspace = await f.workspace(base);
  assert.ok(!(await reads()).some(args => args.includes('blob')), 'creating a workspace does not read source blobs');
  await f.put({ 'src/changed.js': 'UNCOMMITTED_PRIVATE_TEXT\n', 'src/dependency.js': 'UNCOMMITTED_DEPENDENCY\n' });
  const listed = success(await workspace.execute('list_files'));
  assert.deepEqual(listed.files.map(file => file.path), ['removed.txt', 'src/changed.js', 'src/dependency.js']);
  assert.equal(listed.files.find(file => file.path.endsWith('dependency.js')).changed, false);
  assert.deepEqual(listed.evidencePaths, []);
  const dependency = success(await workspace.execute('read_file', { path: 'src/dependency.js' }));
  assert.equal(dependency.text, 'export const invariant = "dependency";\n');
  assert.match(dependency.oid, /^[a-f0-9]{40}$/);
  const previous = success(await workspace.execute('read_file', { path: 'src/changed.js', revision: 'base' }));
  assert.equal(previous.text, 'export const limit = 1;\n');
  const diff = success(await workspace.execute('read_diff', { path: 'src/changed.js' }));
  assert.match(diff.text, /-export const limit = 1/);
  assert.match(diff.text, /\+export const limit = 2/);
  assert.equal(diff.revision, 'base..head');
  const removed = success(await workspace.execute('read_diff', { path: 'removed.txt' }));
  assert.match(removed.text, /-deleted behavior/);
  assert.equal((await workspace.execute('read_file', { path: 'removed.txt' })).error.code, 'PATH_UNAVAILABLE');
  assert.equal(success(await workspace.execute('read_file', { path: 'removed.txt', revision: 'base' })).text, 'deleted behavior\n');
  assert.deepEqual([...workspace.evidencePaths].sort(), ['removed.txt', 'src/changed.js', 'src/dependency.js']);
  const logs = workspace.evidenceLog;
  assert.deepEqual(logs.find(entry => entry.tool === 'read_diff').result, diff);
  assert.doesNotMatch(JSON.stringify(logs), /UNCOMMITTED/);
  logs[0].result.files.length = 0;
  assert.equal(workspace.evidenceLog[0].result.files.length, 3, 'external mutation cannot change archived evidence');
  workspace.evidencePaths.clear();
  assert.equal(workspace.evidencePaths.size, 3);
});

test('ignore layers, traversal, magic paths, and symlinks cannot expose excluded blobs', async t => {
  const f = await fixture(t, { exclude: ['config-private.txt'] });
  await writeFile(join(f.home, 'ignore'), 'global-private.txt\n');
  await f.put({ '.sphinxignore': 'repo-private.txt\n!global-private.txt\n!config-private.txt\n!.env\n', '.env': 'DO_NOT_READ_ENV\n', 'global-private.txt': 'DO_NOT_READ_GLOBAL\n', 'config-private.txt': 'DO_NOT_READ_CONFIG\n', 'repo-private.txt': 'DO_NOT_READ_REPO\n', 'source.js': 'readable source\n', ':(glob)*.txt': 'literal path\n', 'nested/key.pem': 'DO_NOT_READ_KEY\n' });
  await symlink('.env', join(f.cwd, 'link'));
  await f.commit({});
  const secretOids = await Promise.all(['.env', 'global-private.txt', 'config-private.txt', 'repo-private.txt', 'nested/key.pem', 'link'].map(path => f.git('rev-parse', `HEAD:${path}`)));
  const calls = await f.spy();
  const workspace = await f.workspace();
  const listed = success(await workspace.execute('list_files'));
  assert.deepEqual(listed.files.map(file => file.path), ['.sphinxignore', ':(glob)*.txt', 'link', 'source.js']);
  assert.equal((await workspace.execute('read_file', { path: 'link' })).error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal((await workspace.execute('read_diff', { path: 'link' })).error.code, 'UNSUPPORTED_FILE_TYPE');
  for (const path of ['.env', 'global-private.txt', 'config-private.txt', 'repo-private.txt', 'nested/key.pem']) {
    assert.equal((await workspace.execute('read_file', { path })).error.code, 'PATH_UNAVAILABLE');
    assert.equal((await workspace.execute('read_diff', { path })).error.code, 'PATH_UNAVAILABLE');
    assert.equal((await workspace.execute('search', { query: 'DO_NOT_READ', paths: [path] })).error.code, 'PATH_UNAVAILABLE');
  }
  for (const path of ['../.env', '/etc/passwd', 'source.js/../.env', 'nested\\key.pem', 'C:\\secret', './source.js']) {
    assert.equal((await workspace.execute('read_file', { path })).error.code, 'INVALID_PATH');
  }
  assert.equal(success(await workspace.execute('read_file', { path: ':(glob)*.txt' })).text, 'literal path\n');
  success(await workspace.execute('search', { query: 'source' }));
  for (const args of await calls()) {
    if (args.includes('blob') || args.includes('-s')) assert.ok(!secretOids.includes(args.at(-1)), 'an excluded/symlink object was read');
    assert.ok(!args.some(arg => /DO_NOT_READ/.test(arg)));
  }
  assert.doesNotMatch(JSON.stringify(workspace.evidenceLog), /DO_NOT_READ/);
});

test('UTF-8 and JSON-escaped text paginate without gaps, repetition, or oversized results', async t => {
  const f = await fixture(t, { toolResultBytes: 1000 });
  const body = `${'🙂"\\\t'.repeat(400)}\nsecond line\nthird line\n`;
  await f.commit({ 'long.txt': body });
  const workspace = await f.workspace();
  let offset = 0, full = '', pages = 0;
  do {
    const page = success(await workspace.execute('read_file', { path: 'long.txt', offset, limit: 2 }));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1000);
    assert.ok(page.text.length > 0);
    full += page.text; pages++;
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
    assert.ok(pages < 30);
  } while (true);
  assert.equal(full, body);
  assert.ok(pages > 2);
  const line = success(await workspace.execute('read_file', { path: 'long.txt', startLine: 2, limit: 1 }));
  assert.equal(line.text, 'second line\n');
  assert.equal(line.startLine, 2);
  assert.equal(line.endLine, 2);
  assert.equal(line.nextLine, 3);
  let patch = '', diffOffset = 0;
  for (let n = 0; n < 40; n++) {
    const page = success(await workspace.execute('read_diff', { path: 'long.txt', offset: diffOffset }));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1000);
    patch += page.text;
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset > diffOffset);
    diffOffset = page.nextOffset;
  }
  assert.match(patch, /\+second line\n\+third line/);
  assert.ok(patch.endsWith('+third line\n'));
});

test('literal search inspects unchanged dependencies and reports incomplete and oversized results', async t => {
  const f = await fixture(t, { toolResultBytes: 1600 });
  const base = await f.commit({ 'dependency.js': 'literal a.*b\nnot aXYZb\n', 'large.txt': 'a'.repeat(300000), 'binary.bin': Buffer.from([0, 2, 3]), 'many.txt': 'needle in line\n'.repeat(100) });
  await f.commit({ 'changed.js': 'change\n' });
  const workspace = await f.workspace(base);
  const literal = success(await workspace.execute('search', { query: 'a.*b', paths: ['dependency.js'] }));
  assert.equal(literal.matches.length, 1);
  assert.equal(literal.matches[0].text, 'literal a.*b');
  assert.deepEqual(literal.evidencePaths, ['dependency.js']);
  const result = success(await workspace.execute('search', { query: 'needle' }));
  assert.ok(result.skipped.some(item => item.path === 'large.txt' && item.reason === 'large-file-use-read_file'));
  assert.ok(result.skipped.some(item => item.path === 'binary.bin' && item.reason === 'binary'));
  assert.deepEqual(result.incompletePaths, ['many.txt']);
  assert.equal(result.truncated, true);
  assert.ok(result.matches.length > 0 && result.matches.length < 100);
  assert.deepEqual(result.evidencePaths, ['many.txt']);
  const continuation = success(await workspace.execute('read_file', { path: 'large.txt', limit: 1 }));
  assert.equal(continuation.truncated, true);
  assert.ok(continuation.nextOffset > 0);
});

test('staged content pins index blobs, allows dirty edits, and refuses changed index before reading', async t => {
  const f = await fixture(t);
  await f.commit({ 'code.js': 'base\n', 'dependency.js': 'unchanged\n' });
  await f.put({ 'code.js': 'staged\n', '.env': 'INDEX_SECRET\n' });
  await f.git('add', '--all');
  const snapshot = await commitSnapshot({ cwd: f.cwd, config: f.config, env: f.env });
  assert.ok(!snapshot.indexEntries.some(entry => entry.path === '.env'));
  const workspace = await createReviewWorkspace(snapshot, f.config, { env: f.env });
  await f.put({ 'code.js': 'working edit\n' });
  assert.equal(success(await workspace.execute('read_file', { path: 'code.js' })).text, 'staged\n');
  const diff = success(await workspace.execute('read_diff', { path: 'code.js' }));
  assert.match(diff.text, /-base\n\+staged/);
  await f.git('add', 'code.js');
  const spy = await f.spy();
  assert.equal((await workspace.execute('read_file', { path: 'code.js' })).error.code, 'STALE_SNAPSHOT');
  assert.ok(!(await spy()).some(args => args.includes('blob')));
});

test('an unborn index and deleted base files remain readable from pinned objects', async t => {
  const f = await fixture(t);
  await f.put({ 'first.txt': 'staged initial\n' });
  await f.git('add', 'first.txt');
  const snapshot = await commitSnapshot({ cwd: f.cwd, config: f.config, env: f.env });
  const workspace = await createReviewWorkspace(snapshot, f.config, { env: f.env });
  assert.equal(success(await workspace.execute('read_file', { path: 'first.txt' })).text, 'staged initial\n');
  assert.match(success(await workspace.execute('read_diff', { path: 'first.txt' })).text, /\+staged initial/);
  assert.deepEqual(success(await workspace.execute('list_files', { revision: 'base' })).files, []);
});

test('intent-to-add placeholders stay out of the staged tree and changing the flag invalidates it', async t => {
  const f = await fixture(t);
  await f.commit({ 'code.js': 'base\n', 'removed.txt': 'previously tracked\n' });
  await f.git('rm', 'removed.txt');
  await f.put({ 'code.js': 'staged\n', 'empty.txt': '', 'removed.txt': 'unstaged replacement\n' });
  await f.git('add', 'code.js');
  await f.git('add', '--intent-to-add', 'empty.txt', 'removed.txt');
  const snapshot = await commitSnapshot({ cwd: f.cwd, config: f.config, env: f.env });
  assert.deepEqual(snapshot.indexEntries.map(entry => entry.path), ['code.js']);
  const workspace = await createReviewWorkspace(snapshot, f.config, { env: f.env });
  assert.deepEqual(success(await workspace.execute('list_files', { revision: 'head' })).files.map(entry => entry.path), ['code.js']);
  assert.match(success(await workspace.execute('read_diff', { path: 'removed.txt' })).text, /-previously tracked/);
  await f.git('add', 'empty.txt');
  assert.equal((await workspace.execute('read_file', { path: 'code.js' })).error.code, 'STALE_SNAPSHOT');
  const next = await commitSnapshot({ cwd: f.cwd, config: f.config, env: f.env });
  assert.notEqual(next.id, snapshot.id);
  assert.ok(next.indexEntries.some(entry => entry.path === 'empty.txt'));
});

test('each tool rejects changes to source, ignore rules, project context, and reviewer policy', async t => {
  for (const change of ['source', 'ignore', 'context', 'config']) await t.test(change, async t => {
    const f = await fixture(t);
    await f.commit({ 'code.js': 'allowed\n' });
    const workspace = await f.workspace();
    if (change === 'source') await f.commit({ 'code.js': 'new revision\n' });
    if (change === 'ignore') await f.put({ '.sphinxignore': 'code.js\n' });
    if (change === 'context') await f.put({ '.sphinxcontext.md': 'New architecture.\n' });
    if (change === 'config') await writeJson(join(f.home, 'config.json'), { ...f.config, level: 'thorough' });
    const calls = await f.spy();
    const result = await workspace.execute('read_file', { path: 'code.js' });
    assert.equal(result.error.code, 'STALE_SNAPSHOT');
    assert.deepEqual(result.evidencePaths, []);
    assert.equal(workspace.evidenceLog.length, 0);
    assert.ok(!(await calls()).some(args => args.includes('blob')));
  });
});

test('mode changes, binary files, invalid UTF-8, and unusual paths have explicit behavior', async t => {
  const f = await fixture(t);
  const strange = 'tab\tand\nnewline.txt';
  const base = await f.commit({ 'run.sh': '#!/bin/sh\nexit 0\n', 'binary.bin': Buffer.from([0, 1, 2]), 'invalid.txt': Buffer.from([0xff, 0xfe]), [strange]: 'unusual name\n' });
  await chmod(join(f.cwd, 'run.sh'), 0o755);
  await f.commit({ 'binary.bin': Buffer.from([0, 1, 3]) });
  const workspace = await f.workspace(base);
  assert.match(success(await workspace.execute('read_diff', { path: 'run.sh' })).text, /100644 -> 100755/);
  assert.equal(success(await workspace.execute('read_diff', { path: 'binary.bin' })).binary, true);
  assert.equal((await workspace.execute('read_file', { path: 'binary.bin' })).error.code, 'BINARY_FILE');
  assert.equal((await workspace.execute('read_file', { path: 'invalid.txt' })).error.code, 'NON_TEXT_FILE');
  assert.equal(success(await workspace.execute('read_file', { path: strange })).text, 'unusual name\n');
});

test('review reads never run external diff, textconv, or replace-object content', async t => {
  const f = await fixture(t);
  const base = await f.commit({ '.gitattributes': '*.txt diff=custom\n', 'code.txt': 'old behavior\n', 'replacement.txt': 'REPLACED_CONTENT\n' });
  await f.commit({ 'code.txt': 'new behavior\n' });
  const headOid = await f.git('rev-parse', 'HEAD:code.txt'), replacement = await f.git('rev-parse', 'HEAD:replacement.txt');
  await f.git('replace', headOid, replacement);
  await f.git('config', 'diff.external', 'false');
  await f.git('config', 'diff.custom.textconv', 'false');
  const workspace = await f.workspace(base);
  assert.equal(success(await workspace.execute('read_file', { path: 'code.txt' })).text, 'new behavior\n');
  const diff = success(await workspace.execute('read_diff', { path: 'code.txt' }));
  assert.match(diff.text, /-old behavior\n\+new behavior/);
  assert.doesNotMatch(diff.text, /REPLACED_CONTENT/);
});

test('large initial content is read in pages and evidence retention stays bounded', async t => {
  const f = await fixture(t, { maxContextBytes: 1000, toolResultBytes: 1000 });
  await f.commit({ 'large.txt': 'source line\n'.repeat(50000) });
  const snapshot = await f.snapshot();
  assert.ok(Buffer.byteLength(snapshot.evidence) <= 1000);
  const workspace = await createReviewWorkspace(snapshot, f.config, { env: f.env });
  const first = success(await workspace.execute('read_diff', { path: 'large.txt', limit: 3 }));
  assert.equal(first.truncated, true);
  assert.ok(first.nextOffset > 0);
  let exhausted;
  for (let i = 0; i < 20; i++) {
    const result = await workspace.execute('read_file', { path: 'large.txt', limit: 40 });
    if (result.error) { exhausted = result; break; }
  }
  assert.equal(exhausted?.error.code, 'EVIDENCE_LIMIT');
  assert.ok(Buffer.byteLength(JSON.stringify(workspace.evidenceLog)) < 4050);
});

test('tool schemas reject unsupported arguments and list pagination is explicit', async t => {
  const f = await fixture(t);
  await f.commit({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'nested/c.txt': 'c\n' });
  const workspace = await f.workspace();
  assert.deepEqual(workspace.tools.map(tool => tool.name), ['list_files', 'read_file', 'read_diff', 'search']);
  assert.equal((await workspace.execute('shell', { command: 'cat .env' })).error.code, 'UNKNOWN_TOOL');
  assert.equal((await workspace.execute('read_file', { path: 'a.txt', shell: 'cat' })).error.code, 'INVALID_ARGUMENTS');
  assert.equal((await workspace.execute('read_file', { path: 'a.txt', offset: 0, startLine: 1 })).error.code, 'INVALID_ARGUMENTS');
  assert.equal((await workspace.execute('read_diff', { path: 'a.txt', limit: 201 })).error.code, 'INVALID_ARGUMENTS');
  assert.equal((await workspace.execute('search', { query: 'a\nb' })).error.code, 'INVALID_ARGUMENTS');
  const first = success(await workspace.execute('list_files', { limit: 2 }));
  assert.equal(first.nextOffset, 2);
  const last = success(await workspace.execute('list_files', { offset: first.nextOffset }));
  assert.equal(last.nextOffset, null);
  assert.deepEqual(last.files.map(file => file.path), ['nested/c.txt']);
});

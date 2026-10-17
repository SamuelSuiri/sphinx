import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCommandLine } from '../src/cli.js';

const CLI = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));
const README = fileURLToPath(new URL('../README.md', import.meta.url));
const DOCS = ['configuration.md', 'integrations.md', 'architecture.md'].map(name => fileURLToPath(new URL(`../docs/${name}`, import.meta.url)));

// Splits a documented shell line into argv: single-quoted strings, trailing comments,
// and <placeholders> (which a reader replaces) are the only shell syntax the README uses.
function shellWords(line) {
  const words = [];
  for (const [, quoted, bare] of line.matchAll(/'([^']*)'|(#.*|\S+)/gu)) {
    if (bare?.startsWith('#')) break;
    words.push(quoted ?? bare.replace(/^<[^>]+>$/u, 'placeholder'));
  }
  return words;
}

async function documentedCommands(file = README) {
  const text = await readFile(file, 'utf8');
  const blocks = [...text.matchAll(/^```(?:sh|bash|shell)\n([\s\S]*?)^```/gmu)].map(match => match[1]);
  return blocks.flatMap(block => block.split('\n')).map(line => line.trim()).filter(line => line.startsWith('sphinx '));
}

test('shell word splitting keeps quoted text and drops comments', () => {
  assert.deepEqual(shellWords("sphinx answer <assessment-id> --text 'Your answer and reason' --json"),
    ['sphinx', 'answer', 'placeholder', '--text', 'Your answer and reason', '--json']);
  assert.deepEqual(shellWords('sphinx uninstall --repo   # Remove an explicit repository integration'), ['sphinx', 'uninstall', '--repo']);
});

test('every README sphinx command uses options the CLI accepts', async () => {
  const commands = await documentedCommands();
  assert.ok(commands.some(line => line.startsWith('sphinx init --yes')), 'README should document noninteractive init');
  for (const line of commands) assert.doesNotThrow(() => parseCommandLine(shellWords(line).slice(1)), `README command is rejected by the CLI: ${line}`);
});

test('every reference-doc sphinx command uses options the CLI accepts', async () => {
  for (const file of DOCS) {
    for (const line of await documentedCommands(file)) assert.doesNotThrow(() => parseCommandLine(shellWords(line).slice(1)), `${path.basename(file)} command is rejected by the CLI: ${line}`);
  }
});

test('README and reference-doc noninteractive init examples succeed when copied into a fresh repository', { timeout: 30000 }, async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'sphinx-readme-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  await mkdir(home);
  const env = { ...process.env, CI: '1', HOME: home, SPHINX_USER_HOME: home, SPHINX_HOME: path.join(home, 'sphinx'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'SPHINX_EVALUATOR', 'OPENROUTER_API_KEY']) delete env[key];
  const readmeExamples = (await documentedCommands()).filter(line => line.startsWith('sphinx init --yes'));
  assert.ok(readmeExamples.length > 0);
  const docExamples = (await Promise.all(DOCS.map(file => documentedCommands(file)))).flat().filter(line => line.startsWith('sphinx init --yes'));
  const examples = [...readmeExamples, ...docExamples];
  for (const [index, line] of examples.entries()) {
    // Each example gets its own repository because init deliberately preserves existing files.
    const repo = path.join(base, `repo-${index}`);
    await mkdir(repo);
    assert.equal(spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env }).status, 0);
    const result = spawnSync(process.execPath, [CLI, ...shellWords(line).slice(1)], { cwd: repo, env, encoding: 'utf8', input: '', timeout: 20000 });
    assert.equal(result.status, 0, `${line} failed:\n${result.stderr}\n${result.stdout}`);
    JSON.parse(await readFile(path.join(repo, '.sphinxconfig'), 'utf8'));
  }
});

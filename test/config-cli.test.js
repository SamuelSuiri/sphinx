import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = fileURLToPath(new URL('../bin/sphinx.js', import.meta.url));

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'sphinx-config-cli-'));
  const home = path.join(base, 'home'), state = path.join(home, 'sphinx'), bin = path.join(base, 'bin');
  await mkdir(home); await mkdir(bin);
  const env = { ...process.env, HOME: home, SPHINX_HOME: state, SPHINX_USER_HOME: home,
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    OPENROUTER_API_KEY: '', CI: '1', FORCE_COLOR: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_') || ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG', 'SPHINX_EVALUATOR', 'NO_COLOR'].includes(key)) delete env[key];
  const marker = path.join(base, 'provider-invoked');
  for (const name of ['claude', 'codex']) await writeFile(path.join(bin, name), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected model invocation');process.exit(88);\n`, { mode: 0o755 });
  const configPath = path.join(state, 'config.json');
  const run = (args, cwd = base) => spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 10000, input: '' });
  const ok = (args, cwd) => {
    const result = run(args, cwd);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
    return result.stdout;
  };
  const absent = file => assert.rejects(stat(file), { code: 'ENOENT' });
  t.after(async () => { try { await absent(marker); } finally { await rm(base, { recursive: true, force: true }); } });
  return { base, home, state, env, configPath, run, ok, absent };
}

test('config setter works outside a repository and reports saved global settings without inference or installation', async t => {
  const f = await fixture(t);
  const before = JSON.parse(f.ok(['config', '--json']));
  await f.absent(f.configPath);
  const output = f.ok(['config', '--max-model-calls', '30', '--json']);
  assert.doesNotMatch(output, /\x1b/u);
  const saved = JSON.parse(output);
  assert.equal(saved.scope, 'global');
  assert.equal(saved.path, f.configPath);
  assert.equal(saved.previousMaxModelCalls, before.maxModelCalls);
  assert.equal(saved.maxModelCalls, 30);
  assert.deepEqual(saved.config, { ...before, maxModelCalls: 30 });
  assert.deepEqual(JSON.parse(await readFile(f.configPath, 'utf8')), saved.config);
  assert.deepEqual(JSON.parse(f.ok(['config', '--json'])), saved.config, 'read-only JSON shape stays unchanged');
  await f.absent(path.join(f.state, 'install.json'));
  await f.absent(path.join(f.state, 'sessions'));
  await f.absent(f.env.GIT_CONFIG_GLOBAL);
  await f.absent(path.join(f.state, 'credentials.json'));
});

test('saving the call limit preserves global routes and does not copy repository policy into global settings', async t => {
  const f = await fixture(t);
  await mkdir(f.state);
  await writeFile(f.configPath, JSON.stringify({
    version: 1, maxModelCalls: 11, branches: ['production'], level: 'relaxed', agentMaxTurns: 4,
    models: { small: { provider: 'claude', model: 'small-custom' }, medium: { provider: 'codex', model: 'medium-custom' }, large: { provider: 'openrouter', model: 'large-custom:free' } },
  }));
  const global = JSON.parse(f.ok(['config', '--json']));
  const repo = path.join(f.base, 'repo'); await mkdir(repo);
  const git = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: f.env, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const policy = JSON.stringify({ version: 1, branches: ['release/*'], level: 'thorough' });
  await writeFile(path.join(repo, '.sphinxconfig'), policy);
  assert.deepEqual(JSON.parse(f.ok(['config', '--json'], repo)).branches, ['release/*']);
  const saved = JSON.parse(f.ok(['config', '--max-model-calls', '25', '--json'], repo));
  assert.deepEqual(saved.config, { ...global, maxModelCalls: 25 });
  assert.equal(await readFile(path.join(repo, '.sphinxconfig'), 'utf8'), policy);
  assert.deepEqual(JSON.parse(f.ok(['config', '--json'], repo)).branches, ['release/*']);
  await writeFile(path.join(repo, '.sphinxconfig'), '{invalid local policy');
  assert.equal(JSON.parse(f.ok(['config', '--max-model-calls', '26', '--json'], repo)).maxModelCalls, 26, 'a global setter does not depend on repository parsing');
});

test('invalid limits fail before writing while both documented boundaries are accepted', async t => {
  const f = await fixture(t);
  f.ok(['config', '--max-model-calls', '1', '--json']);
  const saved = await readFile(f.configPath, 'utf8');
  for (const value of ['0', '101', '-1', '2.5', '1e2', '', 'twenty']) {
    const result = f.run(['config', `--max-model-calls=${value}`, '--json']);
    assert.equal(result.status, 1, value);
    assert.match(result.stderr, /whole number from 1 to 100/);
    assert.doesNotMatch(result.stderr, /\x1b/u);
    assert.equal(await readFile(f.configPath, 'utf8'), saved);
  }
  assert.equal(JSON.parse(f.ok(['config', '--max-model-calls', '100', '--json'])).maxModelCalls, 100);
});

test('install accepts the total call limit, preserves it on rerun, and rejects invalid values before setup', async t => {
  const f = await fixture(t);
  const invalid = f.run(['install', '--yes', '--provider', 'claude', '--agents', 'none', '--max-model-calls', '101']);
  assert.equal(invalid.status, 1);
  await f.absent(f.configPath); await f.absent(f.env.GIT_CONFIG_GLOBAL);
  f.ok(['install', '--yes', '--provider', 'claude', '--agents', 'none', '--max-model-calls', '35']);
  assert.equal(JSON.parse(await readFile(f.configPath, 'utf8')).maxModelCalls, 35);
  f.ok(['install', '--yes', '--agents', 'none']);
  assert.equal(JSON.parse(await readFile(f.configPath, 'utf8')).maxModelCalls, 35);
  const config = JSON.parse(f.ok(['config', '--json']));
  assert.equal(config.agentMaxTurns, 8);
  assert.equal(config.models.small.provider, 'claude');
});

test('configuration help documents the setter without saving and text output separates total and review limits', async t => {
  const f = await fixture(t);
  const help = JSON.parse(f.ok(['config', '--max-model-calls', '30', '--help', '--json']));
  assert.match(JSON.stringify(help), /--max-model-calls/);
  assert.match(JSON.stringify(help), /without reinstalling/);
  await f.absent(f.configPath);
  const output = f.ok(['config', '--max-model-calls', '30']).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s+/g, ' ');
  assert.match(output, /Saved machine-wide limit: 30 model calls per assessment/);
  assert.match(output, /Per-review caps remain small 3, medium 5, large 8/);
});

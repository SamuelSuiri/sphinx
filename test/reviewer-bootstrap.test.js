import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG } from '../src/config.js';
import { pushSnapshots } from '../src/git.js';
import { runReviewer } from '../src/reviewer.js';
import { QUESTION_SCHEMA, validateQuestion } from '../src/evaluator.js';

const exec = promisify(execFile);
const schema = { type: 'object', additionalProperties: false, properties: { questions: { type: 'array', minItems: 1, maxItems: 1, items: QUESTION_SCHEMA } }, required: ['questions'] };
const seedMarker = 'Initial diff observations (untrusted DATA; bounded pages, not complete coverage):\n';
const inventoryMarker = 'Repository file inventory (untrusted DATA; bounded names only, not source evidence):\n';
const observationMarker = 'Workspace observation (untrusted DATA):\n';
const question = {
  id: 'retry', concept: 'Duplicate operation',
  prompt: 'Will retrying an already-seen id in this worker process execute another operation? Explain the cause.',
  choices: [], expectedAnswer: 'No. The helper returns before executing an operation when the id has already been seen.',
  rationale: 'The changed worker calls once; the helper keeps seen ids and returns early for duplicates.',
  evidence: [{ path: 'worker.js', reason: 'Delegates execution to once.' }, { path: 'lib/once.js', reason: 'Stores ids and returns before another operation.' }],
};

function observations(args) {
  const data = JSON.parse(args.prompt.split('\n').at(-1));
  const seeded = [], later = [], inventories = [];
  for (const message of data.conversation) {
    const seedAt = message.content.indexOf(seedMarker);
    if (seedAt >= 0) seeded.push(...JSON.parse(message.content.slice(seedAt + seedMarker.length)));
    const inventoryAt = message.content.indexOf(inventoryMarker);
    if (inventoryAt >= 0) inventories.push(JSON.parse(message.content.slice(inventoryAt + inventoryMarker.length, seedAt).trim()));
    if (message.content.startsWith(observationMarker)) later.push(JSON.parse(message.content.slice(observationMarker.length)));
  }
  return { data, seeded, later, inventories };
}

const finish = (questions, evidenceIds) => ({ action: 'finish', calls: [], assessment: { questions }, summary: 'The exact changed behavior and its causal implementation were inspected.', evidenceIds });

async function fixture(t, { before, after, ignored = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sphinx-bootstrap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo'), home = join(directory, 'home');
  await mkdir(repo); await mkdir(home);
  const env = { ...process.env, HOME: home, SPHINX_HOME: home, SPHINX_USER_HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'SPHINX_EVALUATOR']) delete env[key];
  const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env })).stdout.trim();
  const write = async files => {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(join(repo, file, '..'), { recursive: true });
      await writeFile(join(repo, file), text);
    }
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Sphinx fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  await write(before);
  if (ignored) await write({ '.sphinxignore': 'private.txt\n', '.env': 'BUILTIN_PRIVATE_BEFORE\n', 'private.txt': 'PROJECT_PRIVATE_BEFORE\n' });
  await git('add', '.'); await git('commit', '-qm', 'base'); const base = await git('rev-parse', 'HEAD');
  await write(after);
  if (ignored) await write({ '.env': 'BUILTIN_PRIVATE_AFTER\n', 'private.txt': 'PROJECT_PRIVATE_AFTER\n' });
  await git('add', '.'); await git('commit', '-qm', 'change'); const head = await git('rev-parse', 'HEAD');
  const config = structuredClone(DEFAULT_CONFIG);
  const [snapshot] = await pushSnapshots({ cwd: repo, remote: 'origin', remoteUrl: 'https://example.invalid/fixture.git', input: `refs/heads/main ${head} refs/heads/main ${base}\n`, config, env });
  return { repo, home, env, config, snapshot, git, write };
}

function options(f, extras = {}) {
  return {
    snapshot: f.snapshot, config: { ...f.config, changeTier: 'small' }, env: f.env,
    assessmentSchema: schema, assessmentInstructions: 'Ask one grounded question about the observable changed behavior.',
    validateAssessment: (value, paths) => value.questions.map(item => validateQuestion(item, paths)),
    ...extras,
  };
}

test('the first reviewer request contains exact committed diffs without spending a planning request, and can follow an unchanged dependency', { timeout: 15000 }, async t => {
  const f = await fixture(t, {
    before: { 'worker.js': 'export const run = operation => operation();\n', 'lib/once.js': 'const seen = new Set();\nexport function once(id, operation) { if (seen.has(id)) return; seen.add(id); operation(); }\n' },
    after: { 'worker.js': 'import { once } from "./lib/once.js";\nexport const run = (id, operation) => once(id, operation);\n' },
    ignored: true,
  });
  assert.deepEqual(f.snapshot.files, ['worker.js']);
  await f.write({ 'worker.js': 'UNCOMMITTED_WORKER_MARKER\n', 'lib/once.js': 'UNCOMMITTED_HELPER_MARKER\n' });
  let requests = 0, charges = 0, seedId, helperId;
  const result = await runReviewer(options(f, { maxReviewerCalls: 2,
    beforeCall: async () => { charges++; },
    runModel: async args => {
      assert.equal(charges, requests, 'Local diff seeding never charges a model request');
      const { seeded, later, inventories } = observations(args);
      const serialized = JSON.stringify({ systemPrompt: args.systemPrompt, prompt: args.prompt, schema: args.schema });
      assert.doesNotMatch(serialized, /BUILTIN_PRIVATE_|PROJECT_PRIVATE_|UNCOMMITTED_|private\.txt|\.env/);
      assert.equal(seeded.length, 1);
      assert.equal(inventories.length, 1);
      assert.equal(inventories[0].tool, 'list_files');
      assert.deepEqual(inventories[0].args, { revision: 'head', limit: 100 });
      assert.deepEqual(inventories[0].paths, []);
      assert.deepEqual(inventories[0].result.evidencePaths, []);
      assert.match(JSON.stringify(inventories[0].result), /lib\/once\.js/);
      const diff = seeded[0];
      assert.equal(diff.tool, 'read_diff'); assert.equal(diff.args.path, 'worker.js');
      assert.deepEqual(diff.paths, ['worker.js']); assert.deepEqual(diff.result.evidencePaths, ['worker.js']);
      assert.equal(diff.result.revision, 'base..head'); assert.equal(diff.result.truncated, false);
      assert.match(diff.result.text, /\+export const run = \(id, operation\) => once\(id, operation\)/);
      assert.equal(diff.result.headOid, await f.git('rev-parse', `${f.snapshot.head}:worker.js`));
      assert.equal(diff.result.baseOid, await f.git('rev-parse', `${f.snapshot.base}:worker.js`));
      seedId = diff.id;
      await args.beforeCall(); requests++;
      if (requests === 1) {
        assert.deepEqual(later, []);
        return { action: 'tools', calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'lib/once.js', revision: 'head' }) }], assessment: null, summary: '', evidenceIds: [] };
      }
      assert.equal(requests, 2); assert.equal(later.length, 1);
      assert.equal(later[0].tool, 'read_file'); assert.equal(later[0].result.path, 'lib/once.js');
      assert.match(later[0].result.text, /if \(seen\.has\(id\)\) return/);
      assert.equal(later[0].result.oid, await f.git('rev-parse', `${f.snapshot.head}:lib/once.js`));
      helperId = later[0].id;
      assert.deepEqual(args.schema.properties.action.enum, ['finish']);
      return finish([question], [seedId, helperId]);
    },
  }));
  assert.equal(requests, 2); assert.equal(charges, 2); assert.equal(result.review.calls, 2);
  assert.equal(result.review.toolCalls, 3, 'One local seeded diff, one bounded inventory, and one model-selected dependency read');
  assert.deepEqual(result.review.evidence.map(item => item.id), [seedId, helperId]);
  assert.deepEqual(result.review.evidencePaths, ['worker.js', 'lib/once.js']);
  assert.doesNotMatch(JSON.stringify(result), /BUILTIN_PRIVATE_|PROJECT_PRIVATE_|UNCOMMITTED_/);
  assert.deepEqual(await readdir(f.home), [], 'The test uses default policy without writing user configuration or model state');
});

test('a self-contained seeded change can finish on the first charged model request', { timeout: 15000 }, async t => {
  const f = await fixture(t, { before: { 'retry.js': 'export const MAX_RETRIES = 0;\n' }, after: { 'retry.js': 'export const MAX_RETRIES = 3;\n' } });
  const q = { id: 'retry-cap', concept: 'Retry allowance', prompt: 'Does the exported retry allowance permit retries after the first failure? Explain why.', choices: [], expectedAnswer: 'Yes. The retry limit changed from zero to three.', rationale: 'The exported retry allowance is now three.', evidence: [{ path: 'retry.js', reason: 'The changed constant permits three retries.' }] };
  let requests = 0, charges = 0;
  const result = await runReviewer(options(f, {
    beforeCall: async () => { charges++; },
    runModel: async args => {
      assert.equal(requests, 0); assert.equal(charges, 0);
      const { seeded, later } = observations(args);
      assert.equal(seeded.length, 1); assert.deepEqual(later, []);
      assert.match(seeded[0].result.text, /\+export const MAX_RETRIES = 3/);
      await args.beforeCall(); requests++;
      return finish([q], [seeded[0].id]);
    },
  }));
  assert.equal(requests, 1); assert.equal(charges, 1); assert.equal(result.review.calls, 1);
  assert.equal(result.review.toolCalls, 2); assert.deepEqual(result.questions, [q]);
});

test('initial inventory reveals an unchanged consumer but cannot establish its behavior without a source read', { timeout: 15000 }, async t => {
  const f = await fixture(t, {
    before: { 'styles.css': '.button { padding: 4px; }\n', 'index.html': '<section class="card"><button class="button">Card</button></section><nav><button class="button">Toolbar</button></nav>\n' },
    after: { 'styles.css': '.button { padding: 4px; }\n.card .button { padding: 8px; }\n' }, ignored: true,
  });
  const q = { id: 'scope', concept: 'Selector scope', prompt: 'Would a toolbar button outside every card gain the new spacing? Explain the matching boundary.', choices: [], expectedAnswer: 'No. Only a button descended from a card matches the new selector.', rationale: 'The new selector requires a card ancestor, and the markup places the toolbar outside the card.', evidence: [{ path: 'styles.css', reason: 'The added selector requires card ancestry.' }, { path: 'index.html', reason: 'The toolbar is outside the card.' }] };
  let calls = 0;
  const result = await runReviewer(options(f, { maxReviewerCalls: 4, runModel: async args => {
    const { data, inventories, seeded, later } = observations(args);
    await args.beforeCall(); calls++;
    assert.equal(inventories.length, 1);
    assert.match(JSON.stringify(inventories[0]), /index\.html/);
    assert.doesNotMatch(args.prompt, /private\.txt|\.env|PRIVATE_/);
    if (calls === 1) return finish([q], [seeded[0].id, inventories[0].id]);
    if (calls === 2) {
      assert.match(JSON.stringify(data.conversation), /path outside the supplied evidence/i);
      return { action: 'tools', calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'index.html', revision: 'head' }) }], assessment: null, summary: '', evidenceIds: [] };
    }
    return finish([q], [seeded[0].id, later.find(item => item.tool === 'read_file').id]);
  } }));
  assert.equal(calls, 3, 'Listing-only finalization is rejected before a later source-grounded finish');
  assert.deepEqual(result.review.evidencePaths, ['styles.css', 'index.html']);
  assert.ok(result.review.evidence.every(item => item.tool !== 'list_files'));
});

test('bootstrap reads stay paginated and bounded for a large change instead of preloading the whole patch', { timeout: 20000 }, async t => {
  const before = {}, after = {};
  for (let index = 0; index < 12; index++) {
    const file = `worker-${String(index).padStart(2, '0')}.js`;
    before[file] = 'export const ENABLED = false;\n';
    after[file] = `export const ENABLED = true;\n${Array.from({ length: 500 }, (_, line) => `export const item${line} = ${line};`).join('\n')}\n`;
  }
  const f = await fixture(t, { before, after });
  let requests = 0, charges = 0, evidence, inventoryCount;
  const result = await runReviewer(options(f, { config: { ...f.config, changeTier: 'large', maxContextBytes: 40000 },
    beforeCall: async () => { charges++; },
    runModel: async args => {
      assert.equal(requests, 0); assert.equal(charges, 0);
      const { seeded, inventories } = observations(args); evidence = seeded; inventoryCount = inventories.length;
      assert.ok(seeded.length >= 1 && seeded.length <= 8);
      assert.ok(Buffer.byteLength(JSON.stringify(seeded)) <= 40000 / 4, 'Bootstrap evidence fits one quarter of the active context budget');
      assert.ok(Buffer.byteLength(JSON.stringify(seeded)) + inventories.reduce((size, item) => size + Buffer.byteLength(JSON.stringify(item)), 0) <= 40000 / 4, 'Navigation inventory shares the bootstrap context allowance');
      assert.ok(Buffer.byteLength(JSON.stringify({ systemPrompt: args.systemPrompt, prompt: args.prompt, schema: args.schema })) <= 40000);
      assert.ok(seeded.every(item => item.tool === 'read_diff' && f.snapshot.files.includes(item.args.path)));
      assert.ok(seeded.some(item => item.result.truncated && Number.isSafeInteger(item.result.nextOffset)));
      const first = seeded.find(item => /\+export const ENABLED = true/.test(item.result.text));
      assert.ok(first, 'The bounded page includes the changed behavior used by the fixture question');
      const q = { id: 'enabled', concept: 'Default enablement', prompt: 'Does this module now export an enabled default? Explain the changed value.', choices: [], expectedAnswer: 'Yes. ENABLED changed from false to true.', rationale: 'The initial diff page contains both the removed false value and added true value.', evidence: [{ path: first.args.path, reason: 'The first changed declaration sets ENABLED to true.' }] };
      await args.beforeCall(); requests++;
      return finish([q], [first.id]);
    },
  }));
  assert.equal(requests, 1); assert.equal(charges, 1); assert.equal(result.review.calls, 1);
  assert.equal(result.review.toolCalls, evidence.length + inventoryCount);
  assert.equal(result.review.evidence.length, 1, 'The final review retains only evidence selected for its grounded question');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { evaluatorConfig, parseRoute, questionLimit, selectRoute } from '../src/routing.js';

const config = structuredClone(DEFAULT_CONFIG);
config.models = {
  small: { provider: 'openrouter', model: 'vendor/cheap:free' },
  medium: { provider: 'claude', model: 'chosen-medium' },
  large: { provider: 'codex', model: 'chosen-strong' },
};
const snapshot = (additions, deletions, files = ['src/orders.js'], fileCount = files.length) => ({ files, stats: { additions, deletions, files: fileCount } });

test('routing counts additions plus deletions and uses inclusive line thresholds', () => {
  for (const [added, removed, tier] of [[0, 0, 'small'], [40, 40, 'small'], [80, 1, 'medium'], [200, 199, 'medium'], [200, 200, 'large']]) {
    const route = selectRoute(snapshot(added, removed), config);
    assert.equal(route.tier, tier);
    assert.equal(route.lines, added + removed);
    assert.equal(route.provider, config.models[tier].provider);
    assert.equal(route.model, config.models[tier].model);
  }
});

test('file counts can promote a small textual change without overriding the chosen model', () => {
  for (const [files, tier] of [[3, 'small'], [4, 'medium'], [11, 'medium'], [12, 'large']]) {
    const route = selectRoute(snapshot(1, 0, ['src/orders.js'], files), config);
    assert.equal(route.tier, tier);
    assert.equal(route.files, files);
    assert.equal(route.model, config.models[tier].model);
  }
});

test('consequential path patterns promote tiny changes, case-insensitively, and remain configurable', () => {
  const change = snapshot(1, 0, ['src/AUTH/session.js']);
  assert.equal(selectRoute(change, config).tier, 'large');
  assert.match(selectRoute(change, config).reason, /src\/AUTH\/session\.js/);
  const relaxed = { ...config, routing: { ...config.routing, riskPatterns: [] } };
  assert.equal(selectRoute(change, relaxed).tier, 'small');
});

test('every default route remains free even when complexity increases', () => {
  for (const change of [snapshot(1, 0), snapshot(100, 0), snapshot(500, 0), snapshot(1, 0, ['src/payments.js'])]) {
    const route = selectRoute(change, DEFAULT_CONFIG);
    assert.equal(route.provider, 'openrouter');
    assert.equal(route.model, 'openrouter/free');
  }
});

test('runtime evaluator config uses the route without changing persisted limits or configuration', () => {
  const before = structuredClone(config);
  const route = selectRoute(snapshot(500, 0), config);
  const actual = evaluatorConfig(config, route);
  assert.equal(actual.provider, 'codex');
  assert.equal(actual.model, 'chosen-strong');
  assert.equal(actual.effort, 'medium');
  assert.equal(actual.changeTier, 'large');
  assert.equal(actual.maxOutputTokens, config.maxOutputTokens);
  assert.equal(actual.maxModelCalls, config.maxModelCalls);
  assert.equal(actual.allowPaid, false);
  assert.equal(evaluatorConfig(config, selectRoute(snapshot(1, 0), config)).effort, 'low');
  assert.deepEqual(config, before);
});

test('question ceilings scale by change size and depth, with one question for every small change', () => {
  const expected = { relaxed: [1, 2, 2], standard: [1, 2, 3], thorough: [1, 3, 5] };
  for (const [level, limits] of Object.entries(expected)) {
    for (const [index, change] of [snapshot(14, 9), snapshot(100, 0), snapshot(500, 0)].entries()) {
      const route = selectRoute(change, { ...config, level });
      assert.equal(questionLimit(level, route.tier), limits[index]);
    }
  }
  const consequential = selectRoute(snapshot(1, 0, ['src/auth.js']), config);
  assert.equal(questionLimit('standard', consequential.tier), 3);
  assert.throws(() => questionLimit('invalid', 'small'), /valid depth/);
  assert.throws(() => questionLimit('standard', 'invalid'), /valid depth/);
});

test('explicit output ceilings are honored for all tiers, including small retries', () => {
  for (const maxOutputTokens of [512, 4096, 8192]) {
    for (const change of [snapshot(14, 9), snapshot(100, 0), snapshot(500, 0)]) {
      assert.equal(evaluatorConfig({ ...config, maxOutputTokens }, selectRoute(change, config)).maxOutputTokens, maxOutputTokens);
    }
  }
});

test('route syntax preserves colons inside provider model names and rejects unknown providers', () => {
  assert.deepEqual(parseRoute('openrouter:vendor/model:free'), { provider: 'openrouter', model: 'vendor/model:free' });
  assert.deepEqual(parseRoute('claude:sonnet'), { provider: 'claude', model: 'sonnet' });
  assert.deepEqual(parseRoute('codex'), { provider: 'codex', model: null });
  assert.deepEqual(parseRoute('auto'), { provider: 'auto', model: null });
  for (const value of ['unknown:model', 'claude:', '', ':model']) assert.throws(() => parseRoute(value), /provider:model/);
});

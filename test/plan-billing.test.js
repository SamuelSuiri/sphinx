import test from 'node:test';
import assert from 'node:assert/strict';
import { childEnvironment, createEvaluator } from '../src/evaluator.js';

const keys = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', OPENAI_API_KEY: 'c', CODEX_API_KEY: 'd', CLAUDE_CODE_OAUTH_TOKEN: 'plan-token', PATH: '/usr/bin' };

test('plan billing strips API credentials from the reviewer CLI environment; api billing keeps them', () => {
  const claude = childEnvironment(keys, { provider: 'claude' });
  assert.equal(claude.ANTHROPIC_API_KEY, undefined); assert.equal(claude.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(claude.CLAUDE_CODE_OAUTH_TOKEN, 'plan-token', 'A plan OAuth token still authenticates the plan');
  const codex = childEnvironment(keys, { provider: 'codex' });
  assert.equal(codex.OPENAI_API_KEY, undefined); assert.equal(codex.CODEX_API_KEY, undefined);
  assert.equal(childEnvironment(keys, { provider: 'claude', billing: 'api' }).ANTHROPIC_API_KEY, 'a');
});

test('a failed plan-billed call explains a missing plan sign-in instead of a generic CLI error', async () => {
  for (const [provider, status, expected] of [
    ['claude', JSON.stringify({ loggedIn: true, authMethod: 'apiKey' }), /not signed in with a Claude plan/],
    ['codex', 'Logged in using an API key', /not signed in with a ChatGPT plan/],
    ['claude', JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), /exited with code 1/],
  ]) {
    const calls = [];
    const runner = async request => {
      calls.push(request);
      if (request.args[0] === 'auth' || request.args[0] === 'login') return { exitCode: 0, stdout: status, stderr: '' };
      return { exitCode: 1, stdout: '', stderr: 'error' };
    };
    const evaluator = createEvaluator({ runner, env: { ...keys } });
    await assert.rejects(evaluator.runModel({ prompt: 'p', schema: { type: 'object' }, config: { provider, timeoutSeconds: 5 } }), expected);
    assert.equal(calls[0].env[provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'], undefined, 'The reviewer call itself never sees an API key');
  }
});

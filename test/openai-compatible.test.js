import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, validateConfig, saveOpenAIEndpoint, saveOpenRouterKey, openAIEndpoint, normalizeBaseUrl, getPaths } from '../src/config.js';
import { parseRoute } from '../src/routing.js';
import { callOpenRouter, callOpenRouterTurn } from '../src/openrouter.js';
import { withTextStream } from '../src/stream.js';

async function home(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sphinx-openai-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { SPHINX_HOME: dir, SPHINX_USER_HOME: dir };
}
const reply = (data, seen) => async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, headers: new Headers(), body: (async function* () { yield Buffer.from(JSON.stringify(data)); })() }; };
const schema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] };

test('openai routes are valid only with an explicit model', () => {
  assert.deepEqual(parseRoute('openai:gpt-5-mini'), { provider: 'openai', model: 'gpt-5-mini' });
  assert.throws(() => parseRoute('openai'), /needs the model ID/);
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.small = { provider: 'openai', model: null };
  assert.throws(() => validateConfig(config), /models.small needs a model ID/);
  config.models.small = { provider: 'openai', model: 'llama3.3' };
  assert.equal(validateConfig(config).models.small.provider, 'openai');
  assert.throws(() => validateConfig({ ...structuredClone(DEFAULT_CONFIG), cliBilling: 'credits' }), /cliBilling must be plan, api/);
});

test('base URLs require https except localhost, and a pasted full endpoint is normalized', () => {
  assert.equal(normalizeBaseUrl('https://api.groq.com/openai/v1/chat/completions/'), 'https://api.groq.com/openai/v1');
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.throws(() => normalizeBaseUrl('http://example.com/v1'), /must use https/);
  assert.throws(() => normalizeBaseUrl('https://user:pw@example.com/v1'), /without credentials/);
});

test('saving an endpoint keeps the OpenRouter key, and a key is optional only for localhost', async t => {
  const env = await home(t);
  await saveOpenRouterKey('or-key', env);
  await assert.rejects(saveOpenAIEndpoint({ baseUrl: 'https://api.openai.com/v1', apiKey: '' }, env), /needs an API key/);
  await saveOpenAIEndpoint({ baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test' }, env);
  const saved = JSON.parse(await readFile(getPaths(env).credentials, 'utf8'));
  assert.deepEqual(saved, { openrouter: 'or-key', openai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' } });
  await saveOpenAIEndpoint({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '' }, env);
  assert.deepEqual(await openAIEndpoint(env), { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null });
});

test('environment variables replace the saved endpoint as a pair and OPENAI_API_KEY is never read', async t => {
  const env = await home(t);
  await saveOpenAIEndpoint({ baseUrl: 'https://saved.example/v1', apiKey: 'saved-key' }, env);
  assert.deepEqual(await openAIEndpoint({ ...env, OPENAI_API_KEY: 'ignored' }), { baseUrl: 'https://saved.example/v1', apiKey: 'saved-key' });
  assert.deepEqual(await openAIEndpoint({ ...env, SPHINX_OPENAI_BASE_URL: 'https://env.example/v1', SPHINX_OPENAI_API_KEY: 'env-key' }), { baseUrl: 'https://env.example/v1', apiKey: 'env-key' });
  await assert.rejects(openAIEndpoint({ ...env, SPHINX_OPENAI_API_KEY: 'env-key' }), /together with/, 'An environment key never goes to the saved URL');
});

test('requests go to the saved endpoint with plain chat-completions fields only', async t => {
  const env = await home(t);
  await saveOpenAIEndpoint({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' }, env);
  const seen = [];
  const config = { provider: 'openai', model: 'gpt-5-mini', maxOutputTokens: 512, timeoutSeconds: 5 };
  const data = { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
  assert.deepEqual(await callOpenRouter({ prompt: 'x', schema, config, env, fetchImpl: reply(data, seen) }), { ok: true });
  const [request] = seen;
  assert.equal(request.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(request.init.headers['X-OpenRouter-Title'], undefined);
  assert.equal(request.body.provider, undefined);
  assert.equal(request.body.model, 'gpt-5-mini');
  assert.equal(request.body.response_format.type, 'json_schema');
});

test('a localhost endpoint without a key sends no Authorization header, and paid gating does not apply', async t => {
  const env = await home(t);
  await saveOpenAIEndpoint({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }, env);
  const seen = [];
  const config = { provider: 'openai', model: 'qwen3-coder:30b', allowPaid: false, maxOutputTokens: 512, timeoutSeconds: 5 };
  await callOpenRouter({ prompt: 'x', schema, config, env, fetchImpl: reply({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }, seen) });
  assert.equal(seen[0].init.headers.Authorization, undefined);
});

test('streaming requests ask the endpoint for usage, and reviewer turns never echo reasoning extensions', async t => {
  const env = await home(t);
  await saveOpenAIEndpoint({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' }, env);
  const config = { provider: 'openai', model: 'gpt-5-mini', maxOutputTokens: 512, timeoutSeconds: 5 };
  const bodies = [];
  const streaming = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, headers: new Headers(), body: (async function* () { yield Buffer.from('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); })() }; };
  await withTextStream(() => {}, () => callOpenRouter({ prompt: 'x', schema, config, env, fetchImpl: streaming }));
  assert.deepEqual([bodies[0].stream, bodies[0].stream_options], [true, { include_usage: true }]);
  const tools = [{ type: 'function', function: { name: 'read_file', description: 'r', parameters: { type: 'object', properties: {} } } }];
  const seen = [];
  const message = { content: null, reasoning: 'private chain', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] };
  const result = await callOpenRouterTurn({ messages: [{ role: 'user', content: 'x' }], tools, config, env, fetchImpl: reply({ choices: [{ message, finish_reason: 'tool_calls' }] }, seen) });
  assert.equal(result.message.reasoning, undefined);
  assert.equal(seen[0].body.tool_choice, 'required');
});

test('an unsaved endpoint fails with the command that fixes it', async t => {
  const env = await home(t);
  await assert.rejects(callOpenRouter({ prompt: 'x', schema, config: { provider: 'openai', model: 'm', maxOutputTokens: 512, timeoutSeconds: 5 }, env, fetchImpl: async () => assert.fail('No request') }), /sphinx auth --provider openai/);
});

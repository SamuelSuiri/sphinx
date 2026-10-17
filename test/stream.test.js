import test from 'node:test';
import assert from 'node:assert/strict';
import { partialField, readCompletionStream, withTextStream } from '../src/stream.js';
import { callOpenRouter } from '../src/openrouter.js';

test('partialField decodes an incomplete JSON string field, including escapes', () => {
  assert.equal(partialField('{"verdict":"incorrect","feed', 'feedback'), null);
  assert.deepEqual(partialField('{"verdict":"incorrect","feedback":"Not qu', 'feedback'), { text: 'Not qu', complete: false });
  assert.deepEqual(partialField('{"feedback":"line one\\nsaid \\"x\\" \\u00e9', 'feedback'), { text: 'line one\nsaid "x" é', complete: false });
  assert.deepEqual(partialField('{"feedback":"done.","evidence":[]}', 'feedback'), { text: 'done.', complete: true });
  assert.deepEqual(partialField('{"feedback":"half \\u00', 'feedback'), { text: 'half ', complete: false }, 'An incomplete escape waits for more text');
});

const sse = events => (async function* () {
  for (const event of events) yield Buffer.from(event);
})();

test('readCompletionStream assembles deltas split across chunks, keeps usage, and ignores keep-alive comments', async () => {
  const seen = [];
  const data = await readCompletionStream(sse([
    ': OPENROUTER PROCESSING\n\n',
    'data: {"choices":[{"delta":{"content":"{\\"feedback\\":\\"Hel"}}]}\n\ndata: {"choices":[{"del',
    'ta":{"content":"lo\\"}"},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"cost":0.0001}}\n\ndata: [DONE]\n\n',
  ]), { onContent: text => seen.push(text) });
  assert.equal(data.choices[0].message.content, '{"feedback":"Hello"}');
  assert.equal(data.choices[0].finish_reason, 'stop');
  assert.deepEqual(data.usage, { prompt_tokens: 10, completion_tokens: 4, cost: 0.0001 });
  assert.deepEqual(seen, ['{"feedback":"Hel', '{"feedback":"Hello"}']);
});

test('OpenRouter streams only when someone is watching, and the final JSON is still validated', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const text = '{"ok":true}';
    if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: sse([`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 5) } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(5) }, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n']) };
    return { ok: true, status: 200, headers: new Headers(), body: sse([JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] })]) };
  };
  const schema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  const config = { model: 'openrouter/free', maxOutputTokens: 512, timeoutSeconds: 5 };
  const env = { OPENROUTER_API_KEY: 'test-key', SPHINX_HOME: '/nonexistent-sphinx-home' };
  assert.deepEqual(await callOpenRouter({ prompt: 'x', schema, config, env, fetchImpl }), { ok: true });
  const seen = [];
  assert.deepEqual(await withTextStream(text => seen.push(text), () => callOpenRouter({ prompt: 'x', schema, config, env, fetchImpl })), { ok: true });
  assert.deepEqual(bodies.map(body => body.stream), [false, true]);
  assert.deepEqual(seen, ['{"ok"', '{"ok":true}']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callOpenRouter, callOpenRouterTurn, OpenRouterError } from '../src/openrouter.js';
import { DEFAULT_CONFIG, saveOpenRouterKey } from '../src/config.js';

const apiKey = 'test-only-private-openrouter-key';
const schema = { type: 'object', properties: { questions: { type: 'array' } }, required: ['questions'], additionalProperties: false };
const result = { questions: [] };
const defaults = { prompt: 'Assess only the supplied snapshot.', schema, config: structuredClone(DEFAULT_CONFIG), env: { OPENROUTER_API_KEY: apiKey } };
const success = (content = JSON.stringify(result), finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content } }] });

test('default OpenRouter request requires zero-priced structured output and enforces the token budget', async () => {
  let calls = 0;
  let captured;
  const actual = await callOpenRouter({ ...defaults, fetchImpl: async (url, init) => { calls++; captured = { url, init }; return success(); } });
  assert.deepEqual(actual, result);
  assert.equal(calls, 1);
  assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.redirect, 'error');
  assert.equal(captured.init.headers.Authorization, `Bearer ${apiKey}`);
  assert.ok(captured.init.signal instanceof AbortSignal);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, 'openrouter/free');
  assert.deepEqual(body.provider, { require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } });
  assert.equal(body.max_completion_tokens, DEFAULT_CONFIG.maxOutputTokens);
  assert.equal(body.reasoning, undefined, 'Do not require reasoning support on otherwise compatible models');
  assert.equal(body.stream, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, schema);
  assert.equal(body.messages[1].content, defaults.prompt);
  assert.ok(!captured.init.body.includes(apiKey));
  assert.equal(body.models, undefined, 'No implicit fallback model list');
});

test('free selections retain zero-price caps even when paid routes are enabled elsewhere', async () => {
  for (const model of ['openrouter/free', 'vendor/model:free']) {
    let body;
    await callOpenRouter({ ...defaults, config: { ...defaults.config, allowPaid: true, model, maxOutputTokens: 768 }, fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return success(); } });
    assert.equal(body.model, model);
    assert.equal(body.max_completion_tokens, 768);
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
  }
});

test('paid models require explicit configuration and never silently substitute another model', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return success(); };
  await assert.rejects(callOpenRouter({ ...defaults, config: { ...defaults.config, model: 'vendor/paid-model' }, fetchImpl }), /Paid OpenRouter model.*disabled/);
  assert.equal(calls, 0);
  let body;
  await callOpenRouter({ ...defaults, config: { ...defaults.config, model: 'vendor/paid-model', allowPaid: true, effort: 'low' }, fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return success(); } });
  assert.equal(body.model, 'vendor/paid-model');
  assert.equal(body.provider.max_price, undefined);
  assert.equal(body.reasoning, undefined, 'CLI effort must not impose reasoning support on a selected OpenRouter model');
  assert.equal(body.reasoning_effort, undefined);
});

test('missing authentication fails before a request and an isolated saved key is reused', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sphinx-openrouter-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { SPHINX_HOME: directory, SPHINX_USER_HOME: directory };
  let calls = 0;
  const fetchImpl = async () => { calls++; return success(); };
  await assert.rejects(callOpenRouter({ ...defaults, env, fetchImpl }), /requires an API key/);
  assert.equal(calls, 0);
  await saveOpenRouterKey(apiKey, env);
  await callOpenRouter({ ...defaults, env, fetchImpl: async (_url, init) => { assert.equal(init.headers.Authorization, `Bearer ${apiKey}`); return success(); } });
});

test('HTTP errors remain actionable without exposing authentication or the provider response body', async () => {
  for (const [status, message] of [[401, /sphinx auth/], [429, /will not switch to a paid model/], [400, /structured-output/], [402, /insufficient credits/], [503, /unavailable/], [502, /Request failed/]]) {
    let calls = 0;
    await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => { calls++; return new Response(`server diagnostic ${apiKey}`, { status }); } }), error => {
      assert.match(error.message, message);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
    assert.equal(calls, 1, 'No automatic retry or paid fallback');
  }
});

test('network and timeout errors do not leak request credentials', async () => {
  for (const error of [new Error(`request failed with ${apiKey}`), new DOMException(`request ${apiKey}`, 'TimeoutError')]) {
    await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => { throw error; } }), failure => {
      assert.match(failure.message, /Could not reach|timed out/);
      assert.ok(!failure.message.includes(apiKey));
      return true;
    });
  }
});

test('typed provider failures expose only known categories and numeric status, including HTTP error bodies', async () => {
  const diagnostic = { code: 502, message: apiKey, metadata: { error_type: 'provider_overloaded', provider_name: apiKey, provider_code: apiKey, raw: apiKey } };
  for (const response of [
    () => Response.json({ id: apiKey, error: diagnostic }),
    () => Response.json({ choices: [{ finish_reason: 'error', error: diagnostic, message: { content: apiKey } }] }),
    () => Response.json({ error: diagnostic }, { status: 502 }),
  ]) {
    let charges = 0, requests = 0;
    await assert.rejects(callOpenRouter({ ...defaults, beforeCall: async () => { charges++; }, fetchImpl: async () => { requests++; return response(); } }), error => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.code, 'OPENROUTER_PROVIDER_ERROR');
      assert.equal(error.status, 502);
      assert.equal(error.errorType, 'provider_overloaded');
      assert.match(error.message, /code: 502; error_type: provider_overloaded/);
      assert.match(error.message, /temporarily overloaded/);
      assert.ok(!error.message.includes(apiKey));
      assert.ok(!JSON.stringify(error).includes(apiKey));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(charges, 1); assert.equal(requests, 1);
  }
});

test('unknown provider diagnostics stay unclassified and safe; typed causes take precedence over status', async () => {
  for (const diagnostic of [undefined, { code: apiKey, message: apiKey, metadata: { error_type: apiKey } }, { code: 9999, metadata: { error_type: 'constructor' } }]) {
    await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'error', error: diagnostic }] }) }), error => {
      assert.equal(error.code, 'OPENROUTER_PROVIDER_ERROR');
      assert.equal(error.status, undefined); assert.equal(error.errorType, undefined);
      assert.match(error.message, /no error code or category returned/);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
  }
  await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => Response.json({ error: { code: 500, metadata: { error_type: 'authentication' } } }, { status: 500 }) }), error => {
    assert.match(error.message, /error_type: authentication/);
    assert.match(error.message, /sphinx auth/);
    assert.doesNotMatch(error.message, /internal error/);
    return true;
  });
});

test('truncated, refused, malformed, and provider-error responses never pass', async () => {
  const cases = [
    [() => success('{"questions":', 'length'), /output limit/],
    [() => success(JSON.stringify(result), 'content_filter'), /refused or filtered/],
    [() => success('This is not JSON'), /malformed assessment JSON/],
    [() => success(null), /no assessment text/],
    [() => Response.json({ error: { message: apiKey } }), /provider error/],
    [() => new Response(`not valid json ${apiKey}`), /invalid.*JSON/],
    [() => Response.json({ choices: [] }), /no completed assessment choice/],
    [() => Response.json(null), /invalid|malformed|no assessment|did not finish/i],
  ];
  for (const [response, pattern] of cases) {
    await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => response() }), error => {
      assert.match(error.message, pattern);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
  }
});

test('output-limit errors identify the actual budget and safe usage counts without accepting partial JSON', async () => {
  let calls = 0;
  await assert.rejects(callOpenRouter({ ...defaults, config: { ...defaults.config, maxOutputTokens: 2500 }, fetchImpl: async () => {
    calls++;
    return Response.json({
      choices: [{ finish_reason: 'length', native_finish_reason: apiKey, message: { content: JSON.stringify(result), reasoning: apiKey } }],
      usage: { completion_tokens: 2500, completion_tokens_details: { reasoning_tokens: 2490 } },
    });
  } }), error => {
    assert.match(error.message, /finish_reason: length; request budget: 2500 tokens, including reasoning/);
    assert.match(error.message, /2500 completion tokens, 2490 reasoning tokens/);
    assert.match(error.message, /Increase maxOutputTokens in your global Sphinx configuration/);
    assert.match(error.message, /did not retry or switch models/);
    assert.ok(!error.message.includes(apiKey));
    return true;
  });
  assert.equal(calls, 1);
});

test('non-budget failures have distinct advice and never recommend increasing tokens', async () => {
  const cases = [
    [{ choices: [{ finish_reason: 'content_filter', message: { content: apiKey } }] }, /refused or filtered/],
    [{ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result), refusal: apiKey } }] }, /refused or filtered/],
    [{ choices: [{ finish_reason: 'tool_calls', message: { content: JSON.stringify(result) } }] }, /requested tool calls/],
    [{ choices: [{ finish_reason: 'error', error: { code: 429, message: apiKey } }] }, /provider error.*rate limit/],
    [{ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) }, error: { code: 503, message: apiKey } }] }, /provider error.*unavailable/],
    [{ error: { code: 401, message: apiKey } }, /provider error.*sphinx auth/],
    [{ choices: [{ finish_reason: apiKey, native_finish_reason: apiKey }] }, /unrecognized finish reason/],
    [{ choices: {} }, /no completed assessment choice/],
  ];
  for (const [data, pattern] of cases) {
    let calls = 0;
    await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => { calls++; return Response.json(data); } }), error => {
      assert.match(error.message, pattern);
      assert.match(error.message, /No completion was recorded/);
      assert.ok(!error.message.includes('maxOutputTokens'));
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('empty completed content reports reasoning usage without exposing malformed usage metadata', async () => {
  for (const content of [null, '', '   ']) {
    await assert.rejects(callOpenRouter({ ...defaults, fetchImpl: async () => Response.json({
      choices: [{ finish_reason: 'stop', message: { content, reasoning: apiKey } }],
      usage: { completion_tokens: apiKey, completion_tokens_details: { reasoning_tokens: 2500 } },
    }) }), error => {
      assert.match(error.message, /no assessment text/);
      assert.match(error.message, /2500 reasoning tokens/);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
  }
});

test('oversized API bodies are rejected even if the provider ignores its output token budget', async () => {
  await assert.rejects(callOpenRouter({
    ...defaults,
    fetchImpl: async () => success(JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 1) })),
  }), /oversized/);
});

const nativeTools = [{ type: 'function', function: { name: 'read_diff', description: 'Read an immutable diff.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } }];
const nativeCall = { id: 'diff-1', type: 'function', function: { name: 'read_diff', arguments: '{"path":"worker.js"}' } };

test('native reviewer requests preserve tool calls and observations with free-only routing', async () => {
  const messages = [{ role: 'system', content: 'Use read-only tools.' }, { role: 'user', content: 'Review the change.' }, { role: 'assistant', content: null, tool_calls: [nativeCall] }, { role: 'tool', tool_call_id: 'diff-1', content: '{"text":"+return dedupe(id)"}' }];
  let body, charged = false;
  const result = await callOpenRouterTurn({ ...defaults, schema: undefined, messages, tools: nativeTools, beforeCall: async () => { charged = true; }, fetchImpl: async (_url, init) => {
    assert.equal(charged, true); body = JSON.parse(init.body);
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [nativeCall], reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-provider-state' }] } }] });
  } });
  assert.deepEqual(body.messages, messages);
  assert.deepEqual(body.tools, nativeTools);
  assert.equal(body.response_format, undefined);
  assert.equal(body.tool_choice, 'required');
  assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
  assert.deepEqual(result.calls, [{ id: 'diff-1', name: 'read_diff', arguments: { path: 'worker.js' } }]);
  assert.deepEqual(result.message.reasoning_details, [{ type: 'reasoning.encrypted', data: 'opaque-provider-state' }]);
});

test('forced final synthesis preserves history schemas while selecting exactly one finish tool', async () => {
  const finishTool = { type: 'function', function: { name: 'finish_review', parameters: { type: 'object', properties: {}, additionalProperties: false } } };
  const toolChoice = { type: 'function', function: { name: 'finish_review' } };
  const tools = [...nativeTools, finishTool];
  const messages = [{ role: 'assistant', content: null, tool_calls: [nativeCall] }, { role: 'tool', tool_call_id: 'diff-1', content: 'immutable code observation' }];
  const finishCall = { id: 'finish-1', type: 'function', function: { name: 'finish_review', arguments: '{}' } };
  let requests = 0, charges = 0;
  const options = { ...defaults, schema: undefined, messages, tools, toolChoice, beforeCall: async () => { charges++; } };
  const response = await callOpenRouterTurn({ ...options, fetchImpl: async (_url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    assert.deepEqual(body.tools, tools); assert.deepEqual(body.messages, messages);
    assert.deepEqual(body.tool_choice, toolChoice);
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [finishCall] } }] });
  } });
  assert.deepEqual(response.calls, [{ id: 'finish-1', name: 'finish_review', arguments: {} }]);
  assert.equal(requests, 1); assert.equal(charges, 1);
  for (const tool_calls of [[nativeCall], [finishCall, nativeCall], [finishCall, { ...finishCall, id: 'finish-2' }]]) {
    await assert.rejects(callOpenRouterTurn({ ...options, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls } }] }) }), /did not return the required reviewer tool.*No tools.*executed/);
  }
});

test('invalid forced tools fail before any budget charge or request', async () => {
  let requests = 0, charges = 0;
  for (const toolChoice of ['none', {}, null, { type: 'function', function: { name: 'shell' } }, { type: 'function', function: { name: 'read_diff', extra: apiKey } }]) {
    await assert.rejects(callOpenRouterTurn({ ...defaults, schema: undefined, messages: [], tools: nativeTools, toolChoice,
      beforeCall: async () => { charges++; }, fetchImpl: async () => { requests++; return success(); },
    }), /required reviewer tool/);
  }
  assert.equal(requests, 0); assert.equal(charges, 0);
});

test('native reviewer accepts bounded multi-tool batches, including completed stop responses with no text', async () => {
  for (const count of [3, 8]) for (const finish_reason of ['tool_calls', 'stop']) {
    const tool_calls = Array.from({ length: count }, (_, index) => ({ ...nativeCall, id: `read-${index}` }));
    let requests = 0, charges = 0;
    const response = await callOpenRouterTurn({ ...defaults, schema: undefined, messages: [], tools: nativeTools,
      beforeCall: async () => { charges++; }, fetchImpl: async (_url, init) => {
        requests++;
        const body = JSON.parse(init.body);
        assert.equal(body.tool_choice, 'required');
        assert.equal(body.models, undefined);
        assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
        return Response.json({ choices: [{ finish_reason, message: { content: null, tool_calls } }] });
      },
    });
    assert.equal(response.calls.length, count);
    assert.equal(response.message.tool_calls.length, count);
    assert.equal(requests, 1); assert.equal(charges, 1);
  }
});

test('native batch failures distinguish zero calls from overflow without disclosing output or retrying', async () => {
  for (const finish_reason of ['stop', 'tool_calls']) for (const count of [0, 9]) {
    let requests = 0, charges = 0;
    const tool_calls = Array.from({ length: count }, (_, index) => ({ ...nativeCall, id: `read-${index}` }));
    await assert.rejects(callOpenRouterTurn({ ...defaults, schema: undefined, messages: [], tools: nativeTools,
      beforeCall: async () => { charges++; }, fetchImpl: async () => {
        requests++;
        return Response.json({ choices: [{ finish_reason, message: { content: apiKey, reasoning: apiKey, tool_calls } }], usage: { completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 100 } } });
      },
    }), error => {
      assert.match(error.message, new RegExp(`returned ${count} reviewer tool calls`));
      assert.ok(error.message.includes(`finish_reason: ${finish_reason}`));
      assert.match(error.message, /120 completion tokens, 100 reasoning tokens/);
      assert.match(error.message, count === 0 ? /requires a workspace call or finish_review/ : /batch limit of 8.*No tools from this response were executed/);
      assert.match(error.message, /did not retry or switch models/);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
    assert.equal(requests, 1); assert.equal(charges, 1);
  }
});

test('native reviewer rejects fabricated tools, malformed arguments, duplicate IDs and partial output', async () => {
  const cases = [
    { tool_calls: [{ ...nativeCall, function: { name: 'shell', arguments: '{}' } }] },
    { tool_calls: [{ ...nativeCall, function: { name: 'read_diff', arguments: '{' } }] },
    { tool_calls: [{ ...nativeCall, function: { name: 'read_diff', arguments: '[]' } }] },
    { tool_calls: [nativeCall, nativeCall] },
    { tool_calls: [] },
  ];
  for (const message of cases) await assert.rejects(callOpenRouterTurn({ ...defaults, schema: undefined, messages: [], tools: nativeTools, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message }] }) }));
  await assert.rejects(callOpenRouterTurn({ ...defaults, schema: undefined, messages: [], tools: nativeTools, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'length', message: { tool_calls: [nativeCall] } }] }) }), /output limit/);
});

test('native reviewer preserves raw reasoning continuation when structured details are absent', async () => {
  for (const field of ['reasoning', 'reasoning_content']) {
    const response = await callOpenRouterTurn({ ...defaults, schema: undefined, messages: [], tools: nativeTools, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [nativeCall], [field]: 'opaque continuation text' } }] }) });
    assert.equal(response.message.reasoning, 'opaque continuation text');
  }
});

test('all request types await the budget callback and cancellation prevents network access', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return success(); };
  for (const call of [callOpenRouter, callOpenRouterTurn]) {
    await assert.rejects(call({ ...defaults, messages: [], tools: nativeTools, fetchImpl, beforeCall: async () => { throw new Error('budget exhausted'); } }), /budget exhausted/);
    const controller = new AbortController(); controller.abort(new Error('human cancelled'));
    await assert.rejects(call({ ...defaults, messages: [], tools: nativeTools, fetchImpl, signal: controller.signal }), /human cancelled/);
  }
  assert.equal(requests, 0);
});

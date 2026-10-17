import { AsyncLocalStorage } from 'node:async_hooks';

// When a human is watching, transports stream model text into this sink. The
// final response is still parsed and validated exactly as before.
const listener = new AsyncLocalStorage();
export const withTextStream = (sink, operation) => listener.run(sink, operation);
export const textStream = () => listener.getStore();

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
/** Decode a JSON string field from a possibly incomplete JSON document. */
export function partialField(raw, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"`, 'u').exec(raw);
  if (!match) return null;
  let text = '';
  for (let i = match.index + match[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') return { text, complete: true };
    if (char !== '\\') { text += char; continue; }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/u.test(hex)) break;
      text += String.fromCharCode(parseInt(hex, 16)); i += 5; continue;
    }
    text += ESCAPES[next] ?? next; i++;
  }
  return { text, complete: false };
}

/** Parse an OpenRouter server-sent event stream into one chat completion. */
export async function readCompletionStream(body, { onContent, signal, maxBytes = 1024 * 1024 } = {}) {
  const decoder = new TextDecoder();
  let buffer = '', content = '', finishReason, usage, error, bytes = 0;
  const handle = line => {
    if (!line.startsWith('data:')) return; // comments keep the connection alive
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    if (chunk.error) error = chunk.error;
    const choice = chunk.choices?.[0];
    if (choice?.error) error = choice.error;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) { content += delta; try { onContent?.(content); } catch {} }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };
  for await (const chunk of body) {
    signal?.throwIfAborted();
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Response too large'), { oversized: true });
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, newline).replace(/\r$/u, '')); buffer = buffer.slice(newline + 1); }
  }
  handle(buffer);
  return { ...(error ? { error } : {}), choices: [{ message: { content }, finish_reason: finishReason ?? (error ? 'error' : undefined) }], ...(usage ? { usage } : {}) };
}

// Local UI fixture only: no real Git operation, provider, credentials, or home edits.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createBrowserInterview } from '../src/browser-interview.js';
import { createSessionStore } from '../src/sessions.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const home = await mkdtemp(path.join(tmpdir(), 'sphinx-browser-demo-'));
const repoRoot = path.join(home, 'example-project'); await mkdir(repoRoot);
const env = { SPHINX_HOME: path.join(home, 'state'), SPHINX_USER_HOME: home }, config = structuredClone(DEFAULT_CONFIG);
const snapshot = { id: 'd'.repeat(64), repoRoot, event: 'pre-push', target: { ref: 'refs/heads/main' }, files: ['src/queue.js'], stats: { additions: 23, deletions: 0, files: 1 } };
const question = { id: 'duplicate', concept: 'Duplicate requests', prompt: 'A job finishes successfully, but the caller times out before receiving the response. If the caller retries with the same job ID in the same process, will this change prevent the job from running twice? Explain why.', choices: [], expectedAnswer: 'The process-local set rejects a duplicate until the process restarts.', rationale: 'The set is held in memory.', evidence: [{ path: 'src/queue.js', reason: 'Process-local membership is checked before execution.' }] };
const store = createSessionStore({ env,
  generate: async (_snapshot, _config, { beforeCall }) => { await beforeCall(); await delay(300); return { questions: [question] }; },
  grade: async request => { await request.beforeCall(); await delay(500); return request.learn || request.dispute || /wrong/i.test(request.answer)
    ? { verdict: request.dispute ? 'ambiguous' : 'incorrect', feedback: 'This set lives in one process. It remembers IDs while that process is running; a restart creates an empty set.', followUp: { ...question, id: randomUUID(), prompt: 'The process restarts after completing a job. The caller retries that job ID. Can the same job run again, and why?' } }
    : { verdict: 'correct', feedback: 'You connected the behavior to the lifetime of the stored IDs.', followUp: null }; },
});
await store.ensure(snapshot, config);
const controller = new AbortController();
process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
const interview = createBrowserInterview({ env, signal: controller.signal, store, readConfig: async () => config, revalidate: async () => true, openBrowser: async () => false, output: console.log });
console.log('Sphinx browser UI fixture. No real repository, model, or Git approval is involved.');
try { console.log(await interview.present({ request: { id: snapshot.id, repoRoot, token: randomUUID(), createdAt: Date.now(), delivery: 'hook' } })); }
finally { await delay(500); await interview.close(); await rm(home, { recursive: true, force: true }); }

// Scripted-reviewer screenshot capture for CRI-49. Not a live model run.
// Builds a real temporary Git repository, a real frozen push checkpoint, real
// reviewer workspace observations, and drives headless Chrome over CDP.
// Usage: node .itervox/evidence/CRI-49/capture.mjs [outputDir]
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { DEFAULT_CONFIG } = await import(path.join(root, 'src/config.js'));
const { pushSnapshots } = await import(path.join(root, 'src/git.js'));
const { createReviewWorkspace } = await import(path.join(root, 'src/review-workspace.js'));
const { createSessionStore } = await import(path.join(root, 'src/sessions.js'));
const { createBrowserInterview } = await import(path.join(root, 'src/browser-interview.js'));
const exec = promisify(execFile);
const out = path.resolve(process.argv[2] || path.join(root, '.itervox/evidence/CRI-49'));
await mkdir(out, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const home = await mkdtemp(path.join(tmpdir(), 'sphinx-cri49-'));
const repoRoot = path.join(home, 'payments-service'); await mkdir(repoRoot);
const env = { ...process.env, SPHINX_HOME: path.join(home, 'state'), SPHINX_USER_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repoRoot, env, maxBuffer: 64 << 20 })).stdout.trim();
const put = async files => { for (const [file, body] of Object.entries(files)) { await mkdir(path.dirname(path.join(repoRoot, file)), { recursive: true }); await writeFile(path.join(repoRoot, file), body); } };
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
const retryBefore = `import { charge } from './gateway.js';\n\nexport async function submitPayment(order, { attempts = 1 } = {}) {\n  let last;\n  for (let i = 0; i < attempts; i++) {\n    try {\n      return await charge(order.id, order.amount);\n    } catch (error) {\n      last = error;\n    }\n  }\n  throw last;\n}\n`;
const base = {
  'src/payments/retry.js': retryBefore,
  'src/payments/gateway.js': lines(60, i => i === 30 ? 'export async function charge(id, amount) { return post("/charge", { id, amount }); }' : `// gateway helper ${i}`),
  'src/payments/legacy-ledger.js': lines(80, i => `export const ledger${i} = ${i};`),
  'docs/old-runbook.md': lines(20, i => `Runbook step ${i}`),
  'assets/receipt-logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
};
for (let i = 1; i <= 28; i++) base[`src/modules/module-${String(i).padStart(2, '0')}.js`] = lines(120, l => `export const value${l} = ${l};`);
await put(base); await git('add', '.'); await git('commit', '-qm', 'base'); const baseOid = await git('rev-parse', 'HEAD');

await rm(path.join(repoRoot, 'docs/old-runbook.md'));
await mkdir(path.join(repoRoot, 'src/payments/ledger'), { recursive: true });
await git('mv', 'src/payments/legacy-ledger.js', 'src/payments/ledger/journal.js');
const retryAfter = `import { charge } from './gateway.js';\nimport { remember, recall } from './idempotency.js';\n\nexport async function submitPayment(order, { attempts = 3 } = {}) {\n  const previous = recall(order.id);\n  if (previous) return previous;\n  let last;\n  for (let i = 0; i < attempts; i++) {\n    try {\n      const receipt = await charge(order.id, order.amount);\n      remember(order.id, receipt);\n      return receipt;\n    } catch (error) {\n      if (error.status && error.status < 500) throw error;\n      last = error;\n    }\n  }\n  throw last;\n}\n`;
const changed = {
  'src/payments/retry.js': retryAfter,
  'src/payments/idempotency.js': `const receipts = new Map();\n\nexport function remember(id, receipt) {\n  receipts.set(id, receipt);\n}\n\nexport function recall(id) {\n  return receipts.get(id);\n}\n`,
  'src/payments/ledger/journal.js': lines(80, i => i === 40 ? 'export const ledger40 = 40; // moved into the journal' : `export const ledger${i} = ${i};`),
  'assets/receipt-logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]),
  'config/feature-flags/payments/international/settlement/a-deliberately-long-directory-name/retry-policy.json': '{\n  "attempts": 3\n}\n',
  'generated/schema-snapshot.sql': lines(4200, i => `INSERT INTO fixtures VALUES (${i}, 'row ${i}');`),
  '.env': 'PAYMENTS_KEY=never-shown\n',
};
for (let i = 1; i <= 28; i++) changed[`src/modules/module-${String(i).padStart(2, '0')}.js`] = lines(120, l => l % 9 === 0 ? `export const value${l} = ${l * 2}; // doubled` : `export const value${l} = ${l};`);
await put(changed); await git('add', '.'); await git('commit', '-qm', 'Idempotent payment retries'); const headOid = await git('rev-parse', 'HEAD');

const config = { ...structuredClone(DEFAULT_CONFIG), events: ['pre-push'] };
const [snapshot] = await pushSnapshots({ cwd: repoRoot, config, env, remote: 'origin', remoteUrl: 'https://example.invalid/payments', input: `refs/heads/main ${headOid} refs/heads/main ${baseOid}\n` });
const workspace = await createReviewWorkspace(snapshot, config, { env });
const observe = async (tool, args) => { const result = await workspace.execute(tool, args); if (result.error) throw new Error(JSON.stringify(result.error)); return { id: `read-${tool}-${Math.random()}`, tool, args, result, paths: result.evidencePaths }; };
const review = { version: 1, snapshotId: snapshot.id, summary: 'Scripted fixture review.', evidence: [
  await observe('read_diff', { path: 'src/payments/retry.js' }),
  await observe('read_file', { path: 'src/payments/idempotency.js', startLine: 1, limit: 9 }),
  await observe('read_file', { path: 'src/payments/gateway.js', startLine: 28, limit: 5 }),
] };
review.evidencePaths = ['src/payments/retry.js', 'src/payments/idempotency.js', 'src/payments/gateway.js'];
const question = { id: 'duplicate-charge', concept: 'idempotent retry', prompt: 'A charge succeeds at the gateway, but the response is lost and the caller retries submitPayment for the same order in the same process. Does the gateway receive a second charge, and why?', choices: [], expectedAnswer: 'No (only when the first call recorded a receipt)…', rationale: 'scripted', acceptance: { prediction: 'p', causalReason: 'c' }, evidence: [{ path: 'src/payments/retry.js', reason: 'r' }, { path: 'src/payments/idempotency.js', reason: 'r' }, { path: 'src/payments/gateway.js', reason: 'r' }] };
const followUp = { ...question, id: 'restart-retry', prompt: 'Now the process restarts between the lost response and the retry. Does the retry charge the order again, and why?' };

let gate, gradeCalls = 0;
const store = createSessionStore({ env,
  generate: async (_s, _c, options) => { await options.beforeCall(); return { questions: [question], review }; },
  grade: async request => { await request.beforeCall(); gradeCalls++; await new Promise(resolve => { gate = resolve; });
    return gradeCalls === 1
      ? { verdict: 'incorrect', feedback: 'Not quite. The retry checks recall(order.id) first, but the receipt is only remembered after charge() resolves; a lost response that surfaces as an error never reaches remember().', followUp }
      : { verdict: 'correct', feedback: 'Correct: the receipt map lives only in memory, so a restart forgets it and the retry charges again.', followUp: null }; } });
await store.ensure(snapshot, config);
const controller = new AbortController();
const interview = createBrowserInterview({ env, signal: controller.signal, store, readConfig: async () => config, revalidate: async () => true, openBrowser: async () => false, output: () => {} });
const done = interview.present({ request: { id: snapshot.id, token: randomUUID(), repoRoot: snapshot.repoRoot, delivery: 'hook', createdAt: Date.now() } });
while (!interview.url || !interview.state.evidence) await delay(20);

// Minimal CDP client.
const profile = await mkdtemp(path.join(tmpdir(), 'sphinx-cri49-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let port; for (let i = 0; i < 200 && !port; i++) { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]; await delay(50); }
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let ids = 0; const pending = new Map();
ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++ids; pending.set(id, data => data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result)); ws.send(JSON.stringify({ id, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + expression); return r.result.value; };
const until = async (expression, label) => { for (let i = 0; i < 300; i++) { if (await run(expression)) return; await delay(30); } throw new Error(`Timed out: ${label}`); };
const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const shot = async name => { await delay(250); const { data } = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); console.log('captured', name); };
const checks = [];
const check = async (label, expression) => { const ok = await run(expression); checks.push(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

await send('Page.enable'); await send('Runtime.enable');
await viewport(1440, 900);
await send('Page.navigate', { url: interview.url });
await until(`document.querySelectorAll('#file-list button').length > 0 && document.querySelectorAll('#evidence-list button').length > 0`, 'files and evidence');
await shot('01-desktop-initial');
await check('no page-level horizontal overflow at 1440px', `document.documentElement.scrollWidth <= innerWidth`);

// Answering: type a draft, browse three files, change filters, expand context, follow evidence.
await run(`(() => { const r = document.getElementById('response'); r.value = 'No second charge: recall(order.id) returns the remembered receipt before charge() runs again, because'; r.dispatchEvent(new Event('input')); })()`);
for (const index of [0, 3, 5]) { await run(`document.querySelectorAll('#file-list button')[${index}].click()`); await until(`!document.getElementById('diff-meta').textContent.startsWith('Loading')`, 'diff'); }
await run(`document.getElementById('filter-relevant').click()`); await run(`document.getElementById('filter-all').click()`);
await run(`document.getElementById('context-more').click()`); await until(`/25 lines of context/.test(document.getElementById('diff-meta').textContent)`, 'more context');
await run(`document.querySelector('#evidence-list button').click()`); await until(`document.querySelectorAll('#diff-body tr.evidence').length > 0`, 'evidence rows');
await check('draft answer preserved after browsing 3 files, filters, context expansion and an evidence link', `document.getElementById('response').value.startsWith('No second charge')`);
await check('current question unchanged while browsing', `document.querySelector('#messages .question .turn-text')?.textContent.includes('response is lost')`);
await run(`document.getElementById('filter-relevant').click()`);
await shot('02-desktop-answering-evidence');
for (const [width, height] of [[360, 760], [390, 844], [768, 1024]]) {
  await viewport(width, height, width < 768);
  await run(`document.getElementById('tab-question').click()`); await shot(`03-${width}-question`);
  await check(`no page-level horizontal overflow at ${width}px`, `document.documentElement.scrollWidth <= innerWidth`);
  await check(`primary touch targets >= 44px at ${width}px`, `[...document.querySelectorAll('.tabs button, #submit, #evidence-list button')].every(b => b.getBoundingClientRect().height >= 44)`);
  await run(`document.getElementById('tab-files').click()`); await shot(`03-${width}-files`);
  await run(`document.getElementById('tab-diff').click()`); await shot(`03-${width}-diff`);
  await check(`draft preserved after switching views at ${width}px`, `document.getElementById('response').value.startsWith('No second charge')`);
}
await viewport(1440, 900);
// Truncated context: the generated 4,200-line file exceeds the display row limit.
await run(`document.getElementById('filter-all').click()`);
await run(`[...document.querySelectorAll('#file-list button')].find(b => b.dataset.path === 'generated/schema-snapshot.sql').click()`);
await until(`/first 3,000 of/.test(document.getElementById('diff-note').textContent)`, 'truncated');
await shot('04-desktop-truncated-context');
await run(`[...document.querySelectorAll('#file-list button')].find(b => b.dataset.path === 'assets/receipt-logo.png').click()`);
await until(`/Binary file/.test(document.getElementById('diff-note').textContent)`, 'binary'); await shot('05-desktop-binary-file');

// Checking, follow-up, passed.
await run(`document.querySelector('#evidence-list button').click()`); await until(`document.querySelectorAll('#diff-body tr.evidence').length > 0`, 'evidence again');
await run(`(() => { const r = document.getElementById('response'); r.value += ' the receipt is remembered after the first success.'; document.getElementById('submit').click(); })()`);
await until(`document.querySelector('.turn-note')?.textContent.includes('Checking')`, 'checking'); await shot('06-desktop-checking');
gate();
await until(`[...document.querySelectorAll('#messages .question-number')].some(n => n.textContent.includes('Follow-up'))`, 'follow-up');
await until(`document.querySelectorAll('#evidence-list button').length > 0`, 'follow-up evidence'); await shot('07-desktop-follow-up');
await run(`(() => { const r = document.getElementById('response'); r.value = 'Yes. The receipts map is in memory only, so after a restart recall() finds nothing and charge() runs again.'; document.getElementById('submit').click(); })()`);
await delay(200); gate();
await until(`document.getElementById('status').textContent === 'Complete'`, 'passed'); await shot('08-desktop-passed');
await check('passed state does not claim the whole change was reviewed', `/not a review of every changed line/.test(document.getElementById('message').textContent) && !/safe to ship|all reviewed/i.test(document.body.innerText)`);
console.log((await done).status);

// Paused: a second scripted checkpoint on the same frozen change.
const pausedStore = createSessionStore({ env: { ...env, SPHINX_HOME: path.join(home, 'state-paused') }, generate: async (_s, _c, options) => { await options.beforeCall(); return { questions: [question], review }; } });
await pausedStore.ensure(snapshot, config);
const second = createBrowserInterview({ env: { ...env, SPHINX_HOME: path.join(home, 'state-paused') }, store: pausedStore, readConfig: async () => config, revalidate: async () => true, openBrowser: async () => false, output: () => {} });
const pausedRun = second.present({ request: { id: snapshot.id, token: randomUUID(), repoRoot: snapshot.repoRoot, delivery: 'hook', createdAt: Date.now() } });
while (!second.url || !second.state.evidence) await delay(20);
await send('Page.navigate', { url: second.url });
await until(`document.querySelectorAll('#evidence-list button').length > 0`, 'second page');
await run(`document.getElementById('pause').click()`); await until(`document.getElementById('status').textContent === 'Paused'`, 'paused');
await shot('09-desktop-paused');
console.log((await pausedRun).status);

await writeFile(path.join(out, 'checks.txt'), `Scripted reviewer fixture (not live-model evidence). Chrome headless.\n${checks.join('\n')}\n`);
console.log(checks.join('\n'));
ws.close(); chrome.kill(); controller.abort(); await interview.close(); await second.close();
await rm(home, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(checks.some(line => line.startsWith('FAIL')) ? 1 : 0);

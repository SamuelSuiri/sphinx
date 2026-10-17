// Renders the real browserPage() markup with scripted (synthetic) states; no model is involved.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [src, outDir, prefix] = process.argv.slice(2);
const { browserPage } = await import(src);
const base = { id: 'a'.repeat(64), revision: 'r', waitingGit: true, target: 'refs/heads/main', repoRoot: '/work/checkride-ai', progress: { completed: 0, total: 2 }, usage: { calls: 6, limit: null }, tokens: { input: 3900, output: 240, cost: 0.0009 } };
const activity = ['Reading the diff', 'Opening src/ui/sizes.ts', 'Opening src/cards/actions.tsx', 'Searching for BUTTON_SM', 'Drafting questions', 'Checking the questions against the source'].map((text, i) => ({ id: 'act' + i, role: 'sphinx', kind: 'activity', text }));
const q1 = { id: 'm1', role: 'sphinx', kind: 'question', questionId: 'q1', number: 1, text: 'The card actions now use BUTTON_CARD instead of BUTTON_SM. If another screen still renders a small button, does its height change? Explain briefly.' };
const wrong = { id: 'm2', role: 'human', kind: 'answer', text: 'Yes, every small button gets taller.' };
const fb = { id: 'm3', role: 'sphinx', kind: 'feedback', text: 'Not quite. BUTTON_CARD is a new constant used only by the card actions; BUTTON_SM is unchanged, so other small buttons keep their height.' };
const q1b = { id: 'm4', role: 'sphinx', kind: 'question', questionId: 'q1b', number: 1, followUp: true, text: 'A teammate adds a new card that imports BUTTON_SM directly. Which height does it get, and why?' };
const states = {
  working: { ...base, sequence: 1, phase: 'working', message: 'Reviewing the change…', messages: activity.slice(0, 3) },
  question: { ...base, sequence: 2, phase: 'question', question: { id: 'q1', prompt: q1.text }, messages: [...activity, q1] },
  checking: { ...base, sequence: 3, phase: 'working', message: 'Checking your answer…', messages: [...activity, q1, { ...wrong, status: 'checking' }] },
  followup: { ...base, sequence: 4, phase: 'question', question: { id: 'q1b', prompt: q1b.text }, messages: [...activity, q1, { ...wrong, status: 'graded' }, fb, q1b] },
  passed: { ...base, sequence: 5, phase: 'passed', progress: { completed: 2, total: 2 }, message: 'Understanding check complete. Return to the original Git output for the operation’s result.', messages: [...activity, q1, { ...wrong, status: 'graded' }, fb, q1b, { id: 'm5', role: 'human', kind: 'answer', status: 'graded', text: 'The original small height. BUTTON_SM was not changed; only card actions moved to BUTTON_CARD.' }, { id: 'm6', role: 'sphinx', kind: 'feedback', text: 'Correct. Importing BUTTON_SM keeps the unchanged small height.' }] },
  paused: { ...base, sequence: 5, phase: 'paused', message: 'Paused. Progress is saved; the waiting Git operation was stopped.', messages: [...activity, q1] },
  error: { ...base, sequence: 5, phase: 'error', message: 'The check could not finish. Saved progress and completed checkpoints are retained.', error: 'The reviewer model returned an error: rate limited (429).', messages: [...activity.slice(0, 4)] },
};
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
fs.mkdirSync(outDir, { recursive: true });
for (const [name, state] of Object.entries(states)) for (const [w, h] of [[390, 844], [1280, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const stub = `<script>window.EventSource=class{constructor(){setTimeout(()=>this.onmessage&&this.onmessage({data:${JSON.stringify(JSON.stringify(state))}}),0)}close(){}}</script>`;
  await page.setContent(browserPage({ token: 't', nonce: 'n' }).replace('<script nonce', stub + '<script nonce'));
  await page.waitForTimeout(150);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (sw) console.log('HORIZONTAL SCROLL', name, w);
  await page.screenshot({ path: `${outDir}/${prefix}-${name}-${w}.png` });
  await page.close();
}
await browser.close(); console.log('done');

// Captures the redesigned landing page and walks the scripted checkpoint end to end.
// Usage: node workspace.mjs <site/out> <outDir>. Needs playwright-core and a local Chrome.
import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const [dir, outDir] = process.argv.slice(2);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
fs.mkdirSync(outDir, { recursive: true });
const shot = (page, name, opts = {}) => page.screenshot({ path: `${outDir}/${name}.png`, ...opts });

// 1. Layout at each width, light, plus dark at desktop and mobile.
for (const [w, h, scheme] of [[360, 740], [390, 844], [768, 1024], [1173, 761], [1440, 900], [1440, 900, 'dark'], [390, 844, 'dark']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme || 'light' });
  await page.goto(url); await page.waitForLoadState('networkidle');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, h: document.documentElement.scrollHeight }));
  console.log(scheme || 'light', w, JSON.stringify(m), m.sw > m.iw ? 'HORIZONTAL SCROLL' : 'no horizontal scroll');
  assert.ok(m.sw <= m.iw, `horizontal scroll at ${w}`);
  const small = await page.evaluate(() => [...document.querySelectorAll('a.button, button, .bar nav a, footer a, summary')]
    .filter(e => e.getClientRects().length).map(e => [e.textContent.trim().slice(0, 24), Math.round(e.getBoundingClientRect().height)]).filter(([, hh]) => hh < 44));
  console.log('  targets under 44px:', JSON.stringify(small));
  if (w === 1440 && !scheme) {
    const fold = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { action: Math.round(r('.step-actions').bottom), question: Math.round(r('.q-text').bottom), fileRows: [...document.querySelectorAll('.file-row')].filter(e => e.getBoundingClientRect().bottom < innerHeight).length, diffBottom: Math.round(r('.ws-diff').bottom) };
    });
    console.log('  1440 fold:', JSON.stringify(fold));
  }
  await shot(page, `${scheme === 'dark' ? 'dark' : 'light'}-${w}-viewport`);
  if (!scheme && (w === 1440 || w === 390)) await shot(page, `light-${w}-full`, { fullPage: true });
  await page.close();
}

// 2. Full scripted walkthrough at 1440, with file navigation mid-way to show state is preserved.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url); await page.waitForLoadState('networkidle');
await page.getByRole('link', { name: 'Explore a checkpoint' }).click();
console.log('focus after Explore:', await page.evaluate(() => document.activeElement.id));
const ws = page.locator('.workspace');
const label = () => page.locator('.q-label').textContent();
for (let i = 0; i < 6; i++) {
  await ws.screenshot({ path: `${outDir}/step-${i + 1}.png` });
  if (i === 2) {
    await page.getByRole('button', { name: /All changed files/ }).click();
    assert.equal(await page.locator('.file-row').count(), 35);
    await page.getByRole('button', { name: /src\/legacy\/billing-cron\.js/ }).click();
    await ws.screenshot({ path: `${outDir}/step-3-all-files-excerpt.png` });
    assert.ok(await page.locator('.diff-outside').isVisible(), 'outside-evidence note on a browsed file');
    assert.match(await page.locator('.step-count').textContent(), /Step 3 of 7/);
    await page.getByRole('button', { name: /Relevant to this question/ }).click();
  }
  if (i === 4) {
    // Question 2 cites two files; the scope count and filter follow it, not the whole excerpt.
    assert.match(await page.locator('.q-scope').textContent(), /^2 relevant files · out of 35 changed/);
    assert.match(await page.getByRole('button', { name: /Relevant to this question/ }).textContent(), /2$/);
    assert.equal(await page.locator('.file-row').count(), 2);
    assert.equal(await page.locator('.diff-outside').count(), 0);
  }
  const action = page.locator('.step-actions .button.primary');
  console.log(`step ${i + 1}:`, await label(), '→', await action.textContent());
  await action.click();
}
await ws.screenshot({ path: `${outDir}/step-7-finished.png` });
assert.match(await page.locator('.finish').textContent(), /Checkpoint passed/);
await page.getByRole('button', { name: 'Back' }).click();
assert.match(await page.locator('.step-count').textContent(), /Step 6 of 7/);
await page.locator('.step-actions .button.primary').click();
await page.locator('.step-actions .button.primary').click(); // Restart
assert.match(await page.locator('.step-count').textContent(), /Step 1 of 7/);

// Evidence chip highlights the matching hunk.
await page.getByRole('button', { name: /client\.js · L11–18/ }).click();
assert.equal(await page.locator('.diff-title .path').textContent(), 'src/billing/client.js');
console.log('highlighted lines for client.js ref:', await page.locator('tr.lit').count());
await ws.screenshot({ path: `${outDir}/evidence-client.png` });

// Keyboard focus is visible.
await page.locator('.ref').first().focus(); await page.keyboard.press('Tab');
await page.locator('.ws-question').screenshot({ path: `${outDir}/focus-visible.png` });

// Copy copies only the command.
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.locator('#start .command button').nth(1).click();
console.log('clipboard:', JSON.stringify(await page.evaluate(() => navigator.clipboard.readText())));
await page.locator('#start').screenshot({ path: `${outDir}/start-copied.png` });
await page.close();

// 3. Mobile: question first, then Files/Diff tabs; evidence opens the Diff view.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(url); await mobile.waitForLoadState('networkidle');
await mobile.locator('#checkpoint').scrollIntoViewIfNeeded();
await mobile.locator('.workspace').screenshot({ path: `${outDir}/mobile-390-workspace.png` });
await mobile.getByRole('button', { name: 'Files', exact: true }).click();
await mobile.getByRole('button', { name: /All changed files/ }).click();
await mobile.locator('.ws-files').screenshot({ path: `${outDir}/mobile-390-files.png` });
await mobile.getByRole('button', { name: /payment-webhook\.js · L19–24/ }).click();
assert.ok(await mobile.locator('.ws-diff').isVisible());
await mobile.locator('.ws-diff').screenshot({ path: `${outDir}/mobile-390-diff.png` });
await mobile.close();

await browser.close(); server.close();

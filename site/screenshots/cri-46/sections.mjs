import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [dir, outDir, w] = process.argv.slice(2);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => { let p = path.join(dir, req.url.split('?')[0]); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); }).listen(0);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: +w, height: 800 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForLoadState('networkidle');
for (const id of ['how', 'example', 'start']) await page.locator('#' + id).screenshot({ path: `${outDir}/sec-${w}-${id}.png` });
// Interaction: details toggles, focus visible on copy, copy feedback.
await page.locator('.activity summary').click();
await page.locator('.activity').screenshot({ path: `${outDir}/sec-${w}-activity-open.png` });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
const btn = page.locator('#start .command button').nth(1); await btn.focus(); await page.keyboard.press('Enter');
console.log('clipboard:', JSON.stringify(await page.evaluate(() => navigator.clipboard.readText())));
await page.locator('#start .setup li').nth(1).screenshot({ path: `${outDir}/sec-${w}-copied-focus.png` });
const small = await page.evaluate(() => [...document.querySelectorAll('a.button, .command button, .bar nav a, summary')].map(e => [e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
console.log('under 44px:', JSON.stringify(small));
await browser.close(); server.close();

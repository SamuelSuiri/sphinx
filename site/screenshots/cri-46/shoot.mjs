import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [dir, outDir, prefix] = process.argv.slice(2);
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
for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1173, 761], [1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: process.env.SCHEME || 'light' });
  await page.goto(url); await page.waitForLoadState('networkidle');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, h: document.documentElement.scrollHeight }));
  console.log(prefix, w, JSON.stringify(m), m.sw > m.iw ? 'HORIZONTAL SCROLL' : 'ok');
  await page.screenshot({ path: `${outDir}/${prefix}-${w}-viewport.png` });
  await page.screenshot({ path: `${outDir}/${prefix}-${w}-full.png`, fullPage: true });
  await page.close();
}
await browser.close(); server.close();

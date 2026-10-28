// 用法：node tools/players/run-convert.mjs <Rocketbox 根目錄> [輸出資料夾] [頁面查詢字串]
// 在無頭 Chromium 裡開 convert.html，把它產生的檔案（player.glb）寫到輸出資料夾（預設 assets/players/）。
// Rocketbox 根目錄底下要有 README 列出的 Assets/Avatars/... 與 Assets/Animations/... 檔案。
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactGlb } from './compact-glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rbDir = path.resolve(process.argv[2] || 'rocketbox');
const outDir = path.resolve(process.argv[3] || path.join(here, '../../assets/players'));
const query = process.argv[4] || '';
const nm = path.join(here, '../../node_modules/');
const roots = { '/three/': nm + 'three/', '/meshopt/': nm + 'meshoptimizer/', '/rb/': rbDir + '/', '/tool/': here + '/' };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  let u;
  try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  for (const [pre, dir] of Object.entries(roots)) if (u.startsWith(pre)) {
    const f = path.join(dir, u.slice(pre.length));
    if (!f.startsWith(dir)) break;
    try {
      const d = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(d);
      return;
    } catch { break; }
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/tool/convert.html${query ? '?' + query : ''}`);
await page.waitForFunction(() => document.title === 'done', null, { timeout: 900000 });
const out = await page.evaluate(() => window.__out);
console.log(out.log.join('\n'));
if (out.error) console.log('ERROR', out.error);
await mkdir(outDir, { recursive: true });
for (const [name, b64] of Object.entries(out.files || {})) {
  let buf = Buffer.from(b64, 'base64');
  if (name.endsWith('.glb')) { const n0 = buf.length; buf = compactGlb(buf); console.log('compacted', n0, '->', buf.length); }
  await writeFile(path.join(outDir, name), buf);
  console.log('wrote', path.join(outDir, name), buf.length);
}
await browser.close();
server.close();

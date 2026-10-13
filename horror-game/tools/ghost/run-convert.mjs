// 用法：node tools/ghost/run-convert.mjs <放 FBX 的資料夾> [輸出 glb 路徑]
// 資料夾裡需要 Medical_Female_01_facial.fbx 與 convert.html 列出的動作 .max.fbx。
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const fbxDir = path.resolve(process.argv[2] || '.');
const outFile = path.resolve(process.argv[3] || path.join(here, '../../assets/ghost/ghost.glb'));
const roots = { '/three/': path.join(here, '../../node_modules/three/'), '/conv/': fbxDir + '/', '/tool/': here + '/' };
const server = http.createServer(async (req, res) => {
  let u;
  try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  for (const [pre, dir] of Object.entries(roots)) if (u.startsWith(pre)) {
    const f = path.join(dir, u.slice(pre.length));
    if (!f.startsWith(dir)) break;
    try { const d = await readFile(f); res.writeHead(200, { 'content-type': u.endsWith('.js') ? 'text/javascript' : u.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(d); return; } catch { break; }
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/tool/convert.html`);
await page.waitForFunction(() => document.title === 'done', null, { timeout: 600000 });
const out = await page.evaluate(() => window.__out);
console.log(out.log.join('\n'));
if (out.error) console.log('ERROR', out.error);
if (out.glb) { await writeFile(outFile, Buffer.from(out.glb, 'base64')); console.log('wrote', outFile, out.size); }
await browser.close(); server.close();

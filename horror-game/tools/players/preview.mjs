// 用無頭 Chromium 開 preview.html，把四個玩家模型的各種狀態截圖存起來，人工檢查方向、貼圖、動作與手電筒。
// 用法：node tools/players/preview.mjs [輸出資料夾，預設 tests/output/players]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serveDir } from '../../tests/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'tests/output/players'));
await mkdir(outDir, { recursive: true });
const server = await serveDir(root);
const base = `http://127.0.0.1:${server.address().port}/tools/players/preview.html`;
const S = (o) => encodeURIComponent(JSON.stringify(o));
const LOCO = [{ speed: 0 }, { speed: 1.4 }, { speed: 3.5, running: true }, { speed: 0.8, crouch: true }];
const shots = [
  // 待機 / 走 / 跑 / 蹲著走，同一組狀態取兩個時間點比對動作有沒有在動
  ['loco_a', `states=${S(LOCO)}&t=2`],
  ['loco_b', `states=${S(LOCO)}&t=2.3`],
  ['loco_side', `states=${S(LOCO)}&t=2.15&cam=side`],
  ['loco_back', `states=${S(LOCO)}&t=2&cam=back`],
  ['crouch_dead', `states=${S([{ speed: 0, crouch: true }, { speed: 0, crouch: true }, { dead: true }, { dead: true }])}&t=2&cam=side`],
  ['dead_mid', `states=${S([{ dead: true }, { dead: true }, { dead: true }, { dead: true }])}&t=0.55&cam=side`],
  ['hand', `states=${S(LOCO)}&t=2&cam=hand`],
  ['flashlights', `states=${S([{ speed: 0 }, { speed: 0, pitch: 0.4 }, { speed: 0, pitch: -0.5 }, { speed: 0.5, crouch: true }])}&t=2&light=1`],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
const infos = {};
for (const [name, q] of shots) {
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
  infos[name] = await page.evaluate(() => window.__info);
  await page.screenshot({ path: path.join(outDir, name + '.png') });
  console.log(name, JSON.stringify(infos[name]));
}
await writeFile(path.join(outDir, 'info.json'), JSON.stringify(infos, null, 1));
if (errors.length) console.log('errors:', [...new Set(errors)].join('\n'));
await browser.close();
server.close();

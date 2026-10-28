// 多人連線測試：本機架一個 PeerJS 配對伺服器，開 3 個無頭瀏覽器分頁一起玩，
// 檢查大廳、開始、位置、門、道具、保險絲、女鬼、被抓與結算是否同步。
//   node tests/mp.mjs
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerServer } from 'peer';
import { serveDir } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2]) || 3;
const PORT = 9123;
const peerServer = PeerServer({ port: PORT, path: '/', host: '127.0.0.1' });
const server = await serveDir(path.join(root, 'dist'));
const base = `http://127.0.0.1:${server.address().port}/index.html?debug&peer=127.0.0.1:${PORT}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const errors = [];
let failed = false;
const log = (...a) => console.log('   ', ...a);
const check = (ok, msg) => { if (!ok) { failed = true; console.log('  ✗', msg); } else console.log('  ✓', msg); };
const until = async (page, fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });

const pages = [];
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 240 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('silentward.settings', JSON.stringify({ quality: 'low', difficulty: 'normal', fpsCap: 30 }));
    localStorage.setItem('silentward.introSeen', 'true');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[p${i}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|swiftshader|Failed to load resource/i.test(m.text())) errors.push(`[p${i}] ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__SW);
  pages.push(page);
}
const [host, ...clients] = pages;
const t0 = Date.now();
try {
  // 大廳
  await host.click('#btnMp');
  await host.fill('#mpName', '房主');
  await host.click('#btnMpCreate');
  await until(host, () => document.getElementById('mpCodeShow').textContent.length === 5);
  const code = await host.textContent('#mpCodeShow');
  log('room', code);
  for (const [i, c] of clients.entries()) {
    await c.click('#btnMp');
    await c.fill('#mpName', `玩家${i + 2}`);
    await c.fill('#mpCode', code.toLowerCase());
    await c.click('#btnMpJoin');
  }
  await until(host, (n) => document.querySelectorAll('#mpList li').length === n, N);
  for (const c of clients) await until(c, (n) => document.querySelectorAll('#mpList li').length === n, N);
  check(true, `lobby has ${N} players`);
  const slots = await Promise.all(pages.map((p) => p.evaluate(() => window.__SW.mp.mySlot)));
  check(new Set(slots).size === N, `unique slots ${slots}`);

  // 開始
  await host.evaluate(() => document.getElementById('btnMpStart').click());
  for (const p of pages) await until(p, () => window.__SW.state === 'playing', null, 180000);
  check(true, `all playing (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  const seeds = await Promise.all(pages.map((p) => p.evaluate(() => window.__SW.game.seed)));
  check(new Set(seeds).size === 1, 'same seed');
  const sig = await Promise.all(pages.map((p) => p.evaluate(() => { const lv = window.__SW.game.lv; return `${lv.doors.length}/${lv.items.length}/${lv.lockers.length}`; })));
  check(new Set(sig).size === 1, `same level ${sig[0]}`);

  // 位置：房主移動，其他人看得到
  const spot = await host.evaluate(() => { const g = window.__SW.game, P = g.player; P.pos.x += 1.2; return { x: P.pos.x, z: P.pos.z }; });
  for (const c of clients) {
    await until(c, (s) => { const r = window.__SW.game.remotes.get(0); return r && Math.abs(r.pos.x - s.x) < 0.1 && Math.abs(r.pos.z - s.z) < 0.1; }, spot);
  }
  check(true, 'positions sync');
  const rc = await Promise.all(pages.map((p) => p.evaluate(() => window.__SW.game.remotes.size)));
  check(rc.every((n) => n === N - 1), `remotes ${rc}`);

  // 門：玩家 2 打開 3 號門
  const doorI = await clients[0].evaluate(() => { const g = window.__SW.game, lv = g.lv; const i = lv.doors.findIndex((d) => d.target < 0.3); g.world.setDoor(lv.doors[i], 1.5, 2.6); return i; });
  for (const p of [host, ...clients.slice(1)]) await until(p, (i) => window.__SW.game.lv.doors[i].target === 1.5, doorI);
  check(true, `door ${doorI} sync`);

  // 道具：兩個人搶同一個電池，只有一個拿到
  const itemI = await host.evaluate(() => window.__SW.game.lv.items.findIndex((it) => it.kind === 'battery' && !it.taken));
  await Promise.all(clients.map((c) => c.evaluate((i) => { const g = window.__SW.game; g.player.battery = 0.2; g.mpRequestPick(g.lv.items[i]); }, itemI)));
  for (const p of pages) await until(p, (i) => window.__SW.game.lv.items[i].taken, itemI);
  await host.waitForTimeout(500);
  const bats = await Promise.all(clients.map((c) => c.evaluate(() => window.__SW.game.player.battery)));
  check(bats.filter((b) => b > 0.5).length === 1, `item taken once (batteries ${bats.map((b) => b.toFixed(2))})`);

  // 保險絲
  // 保險絲：沒撿就插不進去（房主會拒絕），撿了才算
  await clients[0].evaluate(() => { const g = window.__SW.game; g.player.fuses = 1; g.useFusebox(); });
  await host.waitForTimeout(800);
  check(await host.evaluate(() => window.__SW.game.fusesInserted === 0), 'fake fuse refused');
  const f0 = await host.evaluate(() => window.__SW.game.lv.items.findIndex((it) => it.kind === 'fuse' && !it.taken));
  await clients[0].evaluate((i) => { const g = window.__SW.game; g.mpRequestPick(g.lv.items[i]); }, f0);
  await until(clients[0], () => window.__SW.game.player.fuses === 1);
  await clients[0].evaluate(() => window.__SW.game.useFusebox());
  for (const p of pages) await until(p, () => window.__SW.game.fusesInserted === 1);
  check(true, 'fuse count sync');

  // 女鬼：房主讓她在玩家 2 附近出現並追逐
  const target = await clients[0].evaluate(() => { const P = window.__SW.game.player; return { x: P.pos.x, z: P.pos.z }; });
  await host.evaluate((t) => { const g = window.__SW.game, gh = g.ghost; const s = gh.findSpot(4, 12) || { x: t.x + 3, z: t.z }; gh.spawnAt(s.x, s.z, 'chase'); gh.dormantUntil = 0; }, target);
  for (const c of clients) await until(c, () => window.__SW.game.ghost.state !== 'dormant');
  const gp = await Promise.all(pages.map((p) => p.evaluate(() => { const gh = window.__SW.game.ghost; return [gh.pos.x, gh.pos.z, gh.state]; })));
  log('ghost', JSON.stringify(gp.map((g) => [g[0].toFixed(1), g[1].toFixed(1), g[2]])));
  check(gp.every((g) => Math.hypot(g[0] - gp[0][0], g[1] - gp[0][1]) < 1.5), 'ghost position sync');

  // 玩家 2 撿起一個保險絲，等一下被抓走時它要回到原處
  const fuseI = await host.evaluate(() => window.__SW.game.lv.items.findIndex((it) => it.kind === 'fuse' && !it.taken));
  await clients[0].evaluate((i) => { const g = window.__SW.game; g.mpRequestPick(g.lv.items[i]); }, fuseI);
  for (const p of pages) await until(p, (i) => window.__SW.game.lv.items[i].taken, fuseI);
  check(await clients[0].evaluate(() => window.__SW.game.player.fuses === 1), 'fuse picked by player 2');
  // 惡意資料：角度給超大的數字不能讓房主卡死
  await clients[0].evaluate(() => window.__SW.mp.net.broadcast({ t: 'st', x: 1e300, z: 'a', y: 1e300, p: NaN, a: 'x', v: -5 }));
  await host.waitForTimeout(500);
  check(await host.evaluate(() => { const g = window.__SW.game; return [...g.remotes.values()].every((r) => Number.isFinite(r.yaw) && Number.isFinite(r.pos.x)); }), 'bad state is sanitized');

  // 被抓：房主的女鬼抓到玩家 2 → 玩家 2 看到跳嚇然後觀戰
  const s1 = slots[1];
  await host.evaluate((s) => { const g = window.__SW.game; g.onCaught(false, g.remotes.get(s)); }, s1);
  await until(clients[0], () => !!window.__SW.game.dying || window.__SW.game.mpStatus === 1);
  // 軟體繪圖很慢：直接推進模擬把跳嚇播完
  await clients[0].evaluate(() => { const A = window.__SW, g = A.game; for (let i = 0; i < 60 && g.mpStatus === 0; i++) g.update(0.05, A.emptyInput()); });
  await until(clients[0], () => window.__SW.game.mpStatus === 1, null, 15000);
  await until(host, (s) => window.__SW.game.remotes.get(s).a === 1, s1);
  check(true, 'catch → dead → spectating');
  for (const p of pages) await until(p, (i) => !window.__SW.game.lv.items[i].taken, fuseI);
  check(true, 'dropped fuse respawned for everyone');
  const spec = await clients[0].evaluate(() => window.__SW.game.spectate);
  check(spec >= 0 || N === 2, `spectating slot ${spec}`);

  // 其他人逃出 → 結算
  for (const p of [host, ...clients.slice(1)]) await p.evaluate(() => window.__SW.game.mpEscaped());
  for (const p of pages) await until(p, () => window.__SW.game.over && !document.getElementById('end').hidden, null, 15000);
  const rows = await clients[0].evaluate(() => document.getElementById('endStats').textContent);
  log('end', rows.slice(0, 80));
  check(/逃出去了/.test(rows) && /被帶走了/.test(rows), 'end screen lists results');

  // 回大廳再開一局
  await host.evaluate(() => document.getElementById('btnMenu').click());
  await until(host, () => !document.getElementById('mpPanel').hidden && !document.getElementById('btnMpStart').hidden);
  for (const c of clients) await c.evaluate(() => document.getElementById('btnMenu').click());
  await host.evaluate(() => document.getElementById('btnMpStart').click());
  for (const p of pages) await until(p, () => window.__SW.state === 'playing' && window.__SW.game.mpStatus === 0 && !window.__SW.game.over, null, 180000);
  check(true, 'second round started');

  // 房主離開 → 其他人收到通知
  await host.close();
  for (const c of clients) await until(c, () => window.__SW.game && window.__SW.game.over, null, 60000);
  check(true, 'host leaving ends game for clients');
} catch (e) {
  failed = true;
  console.log('  ✗', e.message.split('\n')[0]);
  for (const [i, p] of pages.entries()) {
    try { log(`p${i}`, JSON.stringify(await p.evaluate(() => ({ state: window.__SW.state, status: window.__SW.mp.status, players: window.__SW.mp.players, over: window.__SW.game && window.__SW.game.over })))); } catch (x) { /* 已關閉 */ }
  }
}
for (const e of errors) console.log('  !', e);
if (errors.length) failed = true;
await browser.close();
server.close();
try { peerServer.close?.(); } catch (e) { /* 忽略 */ }
console.log(failed ? '\nFAILED' : `\nALL PASSED (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
process.exit(failed ? 1 : 0);

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
// 截圖：暫時把視窗放大（平常用很小的視窗省效能）
const bigShot = async (page, name, prep) => {
  await page.setViewportSize({ width: 960, height: 540 });
  if (prep) await page.evaluate(prep);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(root, 'tests/output', name + '.png') }).catch(() => {});
  await page.setViewportSize({ width: 400, height: 240 });
};

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

// 房主只讓站在道具旁邊（同一層、4 公尺內）的人撿：先把玩家移到道具旁邊、等房主看到，再撿；撿到後回到原處
async function moveNear(page, f, i) {
  const slot = await page.evaluate(([f, i]) => {
    const A = window.__SW, g = A.game, P = g.player, it = g.floors[f].lv.items[i];
    g.pickBack = { f: g.floorIdx, x: P.pos.x, z: P.pos.z };
    if (g.floorIdx !== f) g.setFloor(f);
    P.pos.x = it.x; P.pos.z = it.z; g.mp.sendT = 0;
    g.mp.tick(0.016);
    return g.mp.mySlot;
  }, [f, i]);
  try {
    await until(pages[0], ([s, f, i]) => { const g = window.__SW.game, r = g.remotes.get(s), it = g.floors[f].lv.items[i]; return r && r.floor === f && Math.hypot(r.tx - it.x, r.tz - it.z) < 1.5; }, [slot, f, i]);
  } catch (e) {
    log('moveNear', JSON.stringify(await pages[0].evaluate(([s, f, i]) => { const g = window.__SW.game, r = g.remotes.get(s), it = g.floors[f].lv.items[i]; return { r: r && [r.floor, r.tx, r.tz], it: [it.x, it.z, it.kind, it.taken] }; }, [slot, f, i])), JSON.stringify(await page.evaluate(() => { const g = window.__SW.game; return [g.floorIdx, g.player.pos.x, g.player.pos.z]; })));
    throw e;
  }
}
async function moveBack(page) {
  const b = await page.evaluate(() => { const g = window.__SW.game, B = g.pickBack, P = g.player; if (!B) return null; if (g.floorIdx !== B.f) g.setFloor(B.f); P.pos.x = B.x; P.pos.z = B.z; g.pickBack = null; g.mp.sendT = 0; g.mp.tick(0.016); return { s: g.mp.mySlot, ...B }; });
  // 等房主看到他回到原處（之後的刷卡、放遺物都會核對距離）
  if (b) await until(pages[0], (b) => { const r = window.__SW.game.remotes.get(b.s); return r && r.floor === b.f && Math.hypot(r.tx - b.x, r.tz - b.z) < 0.6; }, b);
}
async function pickNear(page, f, i) {
  await moveNear(page, f, i);
  await page.evaluate(([f, i]) => { const g = window.__SW.game; g.mpRequestPick(g.floors[f].lv.items[i]); }, [f, i]);
  try { await until(page, ([f, i]) => window.__SW.game.floors[f].lv.items[i].taken, [f, i]); } catch (e) { log('pick not granted', f, i); throw e; }
  await moveBack(page);
}

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
  const doorI = await clients[0].evaluate(() => { const g = window.__SW.game, lv = g.lv; const i = lv.doors.findIndex((d) => d.target < 0.3 && !(d.lock >= 0)); g.world.setDoor(lv.doors[i], 1.5, 2.6); return i; });
  for (const p of [host, ...clients.slice(1)]) await until(p, (i) => window.__SW.game.lv.doors[i].target === 1.5, doorI);
  check(true, `door ${doorI} sync`);

  // 多層樓（普通難度 = 2 層）：每個人生成的樓層一樣
  const fsig = await Promise.all(pages.map((p) => p.evaluate(() => window.__SW.game.floors.map((F) => `${F.theme}:${F.lv.doors.length}/${F.lv.items.length}/${F.lv.stairs.length}`).join(' '))));
  check(new Set(fsig).size === 1 && fsig[0].split(' ').length === 2, `same 2 floors ${fsig[0]}`);
  // 玩家 2 走樓梯到另一層
  const upTo = await clients[0].evaluate(() => {
    const A = window.__SW, g = A.game, s = g.lv.stairs[0];
    g.useStairs(s);
    for (let i = 0; i < 20; i++) g.update(0.05, A.emptyInput());
    return { to: s.to, cur: g.floorIdx, vis: g.floors.map((F) => F.world.root.visible) };
  });
  check(upTo.cur === upTo.to && upTo.vis.filter(Boolean).length === 1, `player 2 took the stairs to floor ${upTo.cur}`);
  // 不同層的人看不到彼此（人物隱藏、手電筒不亮）
  await until(host, ([s, f]) => { const r = window.__SW.game.remotes.get(s); return r && r.floor === f && r.bodyShown === false && r.light.intensity === 0; }, [slots[1], upTo.to]);
  await until(clients[0], () => { const r = window.__SW.game.remotes.get(0); return r && r.floor === 0 && r.bodyShown === false; });
  check(true, 'players on different floors do not see each other');
  // 另一層的門：帶樓層索引同步，不會動到第 0 層同一個索引的門
  const door2 = await clients[0].evaluate(() => { const g = window.__SW.game, lv = g.lv; const i = lv.doors.findIndex((d) => d.target < 0.3 && !(d.lock >= 0)); g.world.setDoor(lv.doors[i], 1.5, 2.6); return i; });
  const before0 = await host.evaluate((i) => window.__SW.game.floors[0].lv.doors[i] && window.__SW.game.floors[0].lv.doors[i].target, door2);
  await until(host, ([f, i]) => window.__SW.game.floors[f].lv.doors[i].target === 1.5, [upTo.to, door2]);
  const after0 = await host.evaluate((i) => window.__SW.game.floors[0].lv.doors[i] && window.__SW.game.floors[0].lv.doors[i].target, door2);
  check(before0 === after0, `door ${door2} on floor ${upTo.to} synced with floor index`);
  // 不合法的樓層索引要被忽略
  await clients[0].evaluate(() => { const n = window.__SW.mp.net; n.broadcast({ t: 'door', f: 9, i: 0, tg: 1, sp: 2 }); n.broadcast({ t: 'door', f: 'x', i: 0, tg: 1, sp: 2 }); n.broadcast({ t: 'pick', f: -1, i: 0 }); n.broadcast({ t: 'noise', f: 1.5, x: 1, z: 1, r: 5 }); n.broadcast({ t: 'sfx', f: 7, n: 'bottleBreak', x: 1, z: 1 }); });
  await host.waitForTimeout(500);
  check(await host.evaluate(() => !window.__SW.game.over), 'bad floor indices ignored');
  // 女鬼換樓層：房主讓她出現在第二層，玩家 2（在那一層）看得到她，房主（在第 0 層）看不到
  await host.evaluate((f) => { const g = window.__SW.game, gh = g.ghost, L = g.floors[f].lv; const far = L.rooms.slice(1).reduce((a, b) => (Math.hypot(b.cx - L.spawn.x, b.cz - L.spawn.z) > Math.hypot(a.cx - L.spawn.x, a.cz - L.spawn.z) ? b : a)); gh.spawnAt(far.cx, far.cz, 'wander', f); gh.dormantUntil = 0; gh.path = null; gh.idleT = 30; }, upTo.to);
  await until(clients[0], (f) => { const gh = window.__SW.game.ghost; return gh.floor === f && gh.state !== 'dormant' && gh.model.root.visible; }, upTo.to, 150000); // 第一次在這個分頁畫她：軟體繪圖要先編譯著色器，比較久
  check(await host.evaluate(() => !window.__SW.game.ghost.model.root.visible), 'ghost floor syncs (visible only on her floor)');
  // 回到第 0 層繼續後面的測試
  await clients[0].evaluate(() => {
    const A = window.__SW, g = A.game, s = g.lv.stairs.find((x) => x.to === 0);
    g.useStairs(s);
    for (let i = 0; i < 20; i++) g.update(0.05, A.emptyInput());
  });
  await until(host, (s) => window.__SW.game.remotes.get(s).floor === 0, slots[1]);
  await host.evaluate(() => { const gh = window.__SW.game.ghost; gh.setState('dormant'); gh.setFloor(0); gh.dormantUntil = 1e9; });

  // 道具：兩個人搶同一個電池，只有一個拿到
  const itemI = await host.evaluate(() => window.__SW.game.lv.items.findIndex((it) => it.kind === 'battery' && !it.taken));
  const itemF = await host.evaluate(() => window.__SW.game.floorIdx);
  for (const c of clients) await moveNear(c, itemF, itemI);
  await Promise.all(clients.map((c) => c.evaluate((i) => { const g = window.__SW.game; g.player.battery = 0.2; g.mpRequestPick(g.lv.items[i]); }, itemI)));
  for (const p of pages) await until(p, (i) => window.__SW.game.lv.items[i].taken, itemI);
  await host.waitForTimeout(500);
  const bats = await Promise.all(clients.map((c) => c.evaluate(() => window.__SW.game.player.battery)));
  for (const c of clients) await moveBack(c);
  check(bats.filter((b) => b > 0.5).length === 1, `item taken once (batteries ${bats.map((b) => b.toFixed(2))})`);

  // 保險絲
  // 保險絲：沒撿就插不進去（房主會拒絕），撿了才算
  await clients[0].evaluate(() => { const g = window.__SW.game; g.player.fuses = 1; g.useFusebox(); });
  await host.waitForTimeout(800);
  check(await host.evaluate(() => window.__SW.game.fusesInserted === 0), 'fake fuse refused');
  // 保險絲分散在各層：找任何一層還沒被撿的
  const findFuse = () => host.evaluate(() => { for (const F of window.__SW.game.floors) { const i = F.lv.items.findIndex((it) => it.kind === 'fuse' && !it.taken); if (i >= 0) return [F.index, i]; } return null; });
  const f0 = await findFuse();
  await pickNear(clients[0], ...f0);
  await until(clients[0], () => window.__SW.game.player.fuses === 1);
  await clients[0].evaluate(() => window.__SW.game.useFusebox());
  for (const p of pages) await until(p, () => window.__SW.game.fusesInserted === 1);
  check(true, 'fuse count sync');

  // 門禁卡：沒帶卡的「刷卡」要被房主拒絕；撿了卡再刷，每個人的門都開了、卡用掉
  const lk = await host.evaluate(() => {
    const g = window.__SW.game, d = g.floors[0].lv.doors.find((x) => x.lock >= 0);
    let card = null;
    for (const F of g.floors) { const i = F.lv.items.findIndex((it) => it.kind === 'keycard' && it.color === d.lock); if (i >= 0) card = [F.index, i]; }
    return { i: d.id, color: d.lock, x: d.cx, z: d.cz, card };
  });
  await clients[0].evaluate((d) => {
    const g = window.__SW.game, P = g.player;
    // 站到門外（讀卡機那一側）
    for (const [ox, oz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) { const r = g.lv.roomAtWorld(d.x + ox, d.z + oz); if (r && r.locked === undefined && !g.collision.overlapsAny(d.x + ox, d.z + oz, 0.3)) { P.pos.x = d.x + ox; P.pos.z = d.z + oz; break; } }
    P.keys = [d.color];
    g.mp.sendT = 0;
  }, lk);
  await host.waitForTimeout(500);
  await clients[0].evaluate((d) => window.__SW.game.mp.send({ t: 'unlock', f: 0, i: d.i }), lk);
  // 亂來的索引也不能讓房主出錯
  await clients[0].evaluate(() => { const n = window.__SW.mp.net; n.broadcast({ t: 'unlock', f: 0, i: 99999 }); n.broadcast({ t: 'unlock', f: 'a', i: -1 }); n.broadcast({ t: 'door', f: 0, i: 0, tg: 1.5, sp: 2 }); });
  await host.waitForTimeout(800);
  check(await host.evaluate((i) => !window.__SW.game.floors[0].lv.doors[i].unlocked, lk.i), 'fake keycard unlock refused');
  // 鎖著的門不能被「開門」訊息打開
  await clients[0].evaluate((d) => window.__SW.mp.net.broadcast({ t: 'door', f: 0, i: d.i, tg: 1.5, sp: 2 }), lk);
  await host.waitForTimeout(500);
  check(await host.evaluate((i) => window.__SW.game.floors[0].lv.doors[i].target < 0.3, lk.i), 'locked door ignores door-open messages');
  await clients[0].evaluate(() => { window.__SW.game.player.keys = []; });
  await pickNear(clients[0], ...lk.card);
  await until(clients[0], (c) => window.__SW.game.player.keys.includes(c), lk.color);
  await until(clients[0], () => !document.getElementById('keyStat').hidden);
  await clients[0].evaluate((d) => window.__SW.game.mp.send({ t: 'unlock', f: 0, i: d.i }), lk);
  for (const p of pages) await until(p, (i) => window.__SW.game.floors[0].lv.doors[i].unlocked, lk.i);
  check(await clients[0].evaluate((c) => !window.__SW.game.player.keys.includes(c), lk.color), 'keycard unlock syncs to everyone, card consumed');

  // 遺物：撿一件、走到搖籃那一層放回去 → 每個人的搖籃裡都有；沒帶在身上的那件放不進去
  const rel = await host.evaluate(() => {
    const g = window.__SW.game, out = [];
    for (const F of g.floors) F.lv.items.forEach((it, i) => { if (it.kind === 'relic') out.push([F.index, i, it.relic]); });
    return { list: out, altar: g.altarFloor.index };
  });
  const [rf, ri, rr] = rel.list[0];
  await pickNear(clients[0], ...[rf, ri]);
  await until(clients[0], (r) => window.__SW.game.player.relics.includes(r), rr);
  await clients[0].evaluate(() => { const A = window.__SW, g = A.game; if (g.ui.noteOpen) { g.ui.closeNote(); g.player.locked = false; } });
  // 走樓梯到搖籃那一層，站到搖籃前
  await clients[0].evaluate((f) => {
    const A = window.__SW, g = A.game;
    if (g.floorIdx !== f) { g.useStairs(g.lv.stairs.find((s) => s.to === f)); for (let k = 0; k < 20; k++) g.update(0.05, A.emptyInput()); }
    const a = g.lv.altar, P = g.player;
    P.pos.x = a.x + Math.sin(a.rot) * 0.9; P.pos.z = a.z + Math.cos(a.rot) * 0.9;
    g.mp.sendT = 0;
  }, rel.altar);
  await until(host, ([s, f]) => window.__SW.game.remotes.get(s).floor === f, [slots[1], rel.altar]);
  await host.waitForTimeout(400);
  const other = [0, 1, 2].find((r) => r !== rr);
  await clients[0].evaluate((r) => window.__SW.game.mp.send({ t: 'relic', r }), other);
  await clients[0].evaluate(() => { const n = window.__SW.mp.net; n.broadcast({ t: 'relic', r: 7 }); n.broadcast({ t: 'relic', r: 'x' }); });
  await host.waitForTimeout(700);
  check(await host.evaluate(() => window.__SW.game.relicsPlaced.size === 0), 'fake relic placement refused');
  await clients[0].evaluate(() => window.__SW.game.useAltar());
  for (const p of pages) await until(p, (r) => window.__SW.game.relicsPlaced.has(r) && window.__SW.game.altarFloor.world.altar.userData.slots[r].children.length === 1, rr);
  check(await clients[0].evaluate(() => window.__SW.game.player.relics.length === 0 && document.getElementById('relicCount').textContent === '1/3'), 'relic placement syncs to everyone');
  // 回到第 0 層
  await clients[0].evaluate(() => {
    const A = window.__SW, g = A.game;
    if (g.floorIdx !== 0) { g.useStairs(g.lv.stairs.find((s) => s.to === 0)); for (let k = 0; k < 20; k++) g.update(0.05, A.emptyInput()); }
  });
  await until(host, (s) => window.__SW.game.remotes.get(s).floor === 0, slots[1]);

  // ---------------------------------------------------------------------
  // 雙人鐵捲門：開局 2 人以上才有；按住把手才開、放手就關；離把手很遠的「我在轉」不算數
  const sh = await host.evaluate(() => {
    const g = window.__SW.game;
    for (const F of g.floors) if (F.lv.shutters.length) { const q = F.lv.shutters[0]; return { f: F.index, i: q.id, n: g.floors.reduce((a, G) => a + G.lv.shutters.length, 0), np: g.startPlayers }; }
    return { n: 0, np: g.startPlayers };
  });
  check(sh.np === N && sh.n >= 1 && sh.n <= 2, `${sh.n} shutter(s) for ${sh.np} players`);
  const shut = (p) => p.evaluate(([f, i]) => { const q = window.__SW.game.floors[f].lv.shutters[i]; return { t: q.target, o: q.open, j: q.jammed }; }, [sh.f, sh.i]);
  check((await Promise.all(pages.map(shut))).every((q) => q.t === 0 && !q.j), 'shutter starts closed');
  // 玩家 2 走到那一層、站到把手前面看著它
  await clients[0].evaluate(([f, i]) => {
    const A = window.__SW, g = A.game;
    if (g.floorIdx !== f) { g.useStairs(g.lv.stairs.find((x) => x.to === f)); for (let k = 0; k < 20; k++) g.update(0.05, A.emptyInput()); }
    const c = g.lv.shutters[i].crank, P = g.player;
    P.pos.x = c.useX; P.pos.z = c.useZ;
    P.yaw = Math.atan2(-(c.x - c.useX), -(c.z - c.useZ)); P.pitch = -0.5;
    g.mp.sendT = 0;
  }, [sh.f, sh.i]);
  await until(host, ([s, f]) => window.__SW.game.remotes.get(s).floor === f, [slots[1], sh.f]);
  await host.waitForTimeout(500);
  // 遠處送來的「我在轉把手」：房主不理
  await clients[0].evaluate(([i]) => { const g = window.__SW.game, st = g.mpLocalState(); g.mp.net.broadcast({ t: 'st', ...st, x: st.x + 6, z: st.z + 6, ck: i }); g.mp.net.broadcast({ t: 'st', ...st, ck: 999 }); }, [sh.i]);
  await host.waitForTimeout(300);
  check((await shut(host)).t === 0, 'far-away crank holder ignored');
  const tgt = await clients[0].evaluate(() => { const g = window.__SW.game; g.updateInteraction(); return g.target && g.target.kind + ':' + g.target.label; });
  log('crank target', tgt);
  await bigShot(clients[0], 'mp-crank');
  // 從把手前面看鐵捲門（關著）
  const lookShutter = `(() => { const g = window.__SW.game, q = g.lv.shutters[${sh.i}], P = g.player; P.yaw = Math.atan2(-(q.cx - P.pos.x), -(q.cz - P.pos.z)); P.pitch = 0.05; })()`;
  await bigShot(clients[0], 'mp-shutter-closed', lookShutter);
  await clients[0].evaluate(([i]) => { const g = window.__SW.game, c = g.lv.shutters[i].crank, P = g.player; P.yaw = Math.atan2(-(c.x - c.useX), -(c.z - c.useZ)); P.pitch = -0.5; }, [sh.i]);
  await clients[0].evaluate(() => window.__SW.input.keys.add('KeyE'));
  for (const p of pages) await until(p, ([f, i]) => window.__SW.game.floors[f].lv.shutters[i].target === 1, [sh.f, sh.i]);
  await until(host, ([f, i]) => window.__SW.game.floors[f].lv.shutters[i].open > 0.95, [sh.f, sh.i]);
  check(true, 'shutter opens while the crank is held (synced)');
  await until(clients[0], ([f, i]) => window.__SW.game.floors[f].lv.shutters[i].open > 0.95, [sh.f, sh.i]);
  await bigShot(clients[0], 'mp-shutter-open', lookShutter);
  await clients[0].evaluate(() => window.__SW.input.keys.delete('KeyE'));
  for (const p of pages) await until(p, ([f, i]) => window.__SW.game.floors[f].lv.shutters[i].target === 0, [sh.f, sh.i]);
  check(true, 'shutter drops when the crank is released');
  await clients[0].evaluate(() => {
    const A = window.__SW, g = A.game;
    if (g.floorIdx !== 0) { g.useStairs(g.lv.stairs.find((x) => x.to === 0)); for (let k = 0; k < 20; k++) g.update(0.05, A.emptyInput()); }
  });
  await until(host, (s) => window.__SW.game.remotes.get(s).floor === 0, slots[1]);

  // ---------------------------------------------------------------------
  // 倒地與扶起：房主被抓 → 倒地（不會馬上被帶走）；隊友在遠處說「我在扶」不算；站到旁邊按住 E 三秒 → 站起來
  await host.evaluate(() => { const g = window.__SW.game; g.onCaught(false, g.player); });
  check(await host.evaluate(() => !!window.__SW.game.downed && !window.__SW.game.dying && window.__SW.game.mpStatus === 0), 'host is down, not taken');
  await until(clients[0], () => { const r = window.__SW.game.remotes.get(0); return r && r.downed; });
  check(true, 'downed state syncs');
  await bigShot(host, 'mp-downed');
  // 玩家 2 站在 4 公尺外，一直送「我在扶」
  const hp = await host.evaluate(() => { const P = window.__SW.game.player; return { x: P.pos.x, z: P.pos.z }; });
  await clients[0].evaluate((h) => {
    const g = window.__SW.game, P = g.player;
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]]) if (!g.collision.overlapsAny(h.x + dx, h.z + dz, 0.3)) { P.pos.x = h.x + dx; P.pos.z = h.z + dz; break; }
    g.mp.sendT = 0;
  }, hp);
  await host.waitForTimeout(500);
  await clients[0].evaluate(() => new Promise((res) => { const g = window.__SW.game; let n = 0; const id = setInterval(() => { g.mp.send({ t: 'rv', s: 0 }); if (++n >= 19) { clearInterval(id); res(); } }, 200); }));
  await host.waitForTimeout(300);
  check(await host.evaluate(() => !!window.__SW.game.downed), 'far-away revive refused');
  // 站到旁邊、看著他、按住 E
  await clients[0].evaluate((h) => {
    const g = window.__SW.game, P = g.player;
    for (const [dx, dz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) if (!g.collision.overlapsAny(h.x + dx, h.z + dz, 0.3)) { P.pos.x = h.x + dx; P.pos.z = h.z + dz; break; }
    P.yaw = Math.atan2(-(h.x - P.pos.x), -(h.z - P.pos.z)); P.pitch = -0.6;
    g.mp.sendT = 0;
    window.__SW.input.keys.add('KeyE');
  }, hp);
  await clients[0].waitForTimeout(300);
  await bigShot(clients[0], 'mp-revive');
  const ring = await clients[0].evaluate(() => ({ t: window.__SW.game.target && window.__SW.game.target.label, ring: !document.getElementById('holdRing').hidden }));
  log('revive prompt', JSON.stringify(ring));
  await until(host, () => !window.__SW.game.downed && window.__SW.game.reviveUsed && window.__SW.game.mpStatus === 0, null, 15000);
  await clients[0].evaluate(() => window.__SW.input.keys.delete('KeyE'));
  await until(clients[0], () => !window.__SW.game.remotes.get(0).downed);
  check(ring.ring && /扶起/.test(ring.t || ''), 'teammate revive works (hold E, progress ring)');
  check(await host.evaluate(() => window.__SW.game.player.sanity <= 0.26), 'revived with low sanity');

  // 女鬼：房主讓她在玩家 2 附近出現並追逐
  const target = await clients[0].evaluate(() => { const P = window.__SW.game.player; return { x: P.pos.x, z: P.pos.z }; });
  await host.evaluate((t) => { const g = window.__SW.game, gh = g.ghost; const s = gh.findSpot(4, 12) || { x: t.x + 3, z: t.z }; gh.spawnAt(s.x, s.z, 'chase'); gh.dormantUntil = 0; }, target);
  for (const c of clients) await until(c, () => window.__SW.game.ghost.state !== 'dormant');
  const gp = await Promise.all(pages.map((p) => p.evaluate(() => { const gh = window.__SW.game.ghost; return [gh.pos.x, gh.pos.z, gh.state]; })));
  log('ghost', JSON.stringify(gp.map((g) => [g[0].toFixed(1), g[1].toFixed(1), g[2]])));
  check(gp.every((g) => Math.hypot(g[0] - gp[0][0], g[1] - gp[0][1]) < 1.5), 'ghost position sync');

  // 玩家 2 撿起一個保險絲，等一下被抓走時它要回到原處
  const fuseI = await findFuse();
  await pickNear(clients[0], ...fuseI);
  for (const p of pages) await until(p, ([f, i]) => window.__SW.game.floors[f].lv.items[i].taken, fuseI);
  check(await clients[0].evaluate(() => window.__SW.game.player.fuses === 1), 'fuse picked by player 2');
  // 惡意資料：角度給超大的數字不能讓房主卡死
  await clients[0].evaluate(() => window.__SW.mp.net.broadcast({ t: 'st', x: 1e300, z: 'a', y: 1e300, p: NaN, a: 'x', v: -5 }));
  await host.waitForTimeout(500);
  check(await host.evaluate(() => { const g = window.__SW.game; return [...g.remotes.values()].every((r) => Number.isFinite(r.yaw) && Number.isFinite(r.pos.x)); }), 'bad state is sanitized');

  // 被抓：房主的女鬼抓到玩家 2 → 倒地；30 秒沒人扶 → 被帶走（看到跳嚇然後觀戰）
  const s1 = slots[1];
  await host.evaluate((s) => { const g = window.__SW.game; g.onCaught(false, g.remotes.get(s)); }, s1);
  await until(clients[0], () => !!window.__SW.game.downed);
  await until(host, (s) => window.__SW.game.remotes.get(s).downed, s1);
  // 倒數快轉：房主那邊的 30 秒到了 → 房主送 'taken'（由房主決定，玩家自己的計時只是保險）
  await host.evaluate((s) => { const g = window.__SW.game, r = g.remotes.get(s); r.downSince = g.time - 40; }, s1);
  await until(clients[0], () => !window.__SW.game.downed);
  await clients[0].evaluate(() => { const A = window.__SW, g = A.game; for (let i = 0; i < 80 && g.mpStatus === 0; i++) g.update(0.05, A.emptyInput()); });
  await until(clients[0], () => window.__SW.game.mpStatus === 1, null, 15000);
  await until(host, (s) => window.__SW.game.remotes.get(s).a === 1, s1);
  check(true, 'downed timeout → taken → spectating');
  if (N === 2) {
    // 只剩一個人在裡面：鐵捲門卡在打開的位置
    for (const p of pages) await until(p, ([f, i]) => { const q = window.__SW.game.floors[f].lv.shutters[i]; return q.jammed && q.target === 1; }, [sh.f, sh.i]);
    check(true, 'shutters jam open when one player remains');
  }
  await host.evaluate(() => { const gh = window.__SW.game.ghost; gh.setState('dormant'); gh.dormantUntil = 1e9; });
  check(true, 'catch → dead → spectating');
  for (const p of pages) await until(p, ([f, i]) => !window.__SW.game.floors[f].lv.items[i].taken, fuseI);
  check(true, 'dropped fuse respawned for everyone');
  const spec = await clients[0].evaluate(() => window.__SW.game.spectate);
  check(spec >= 0 || N === 2, `spectating slot ${spec}`);
  // 觀戰列：顯示正在看誰
  await until(clients[0], () => !document.getElementById('specBar').hidden && document.getElementById('specName').textContent.length > 0);
  const specName = await clients[0].evaluate(() => document.getElementById('specName').textContent);
  const expectName = await clients[0].evaluate(() => window.__SW.mp.slotName(window.__SW.game.spectate));
  check(specName === expectName, `spectator bar shows "${specName}"`);
  // 換人：下一位、上一位（還在裡面的人有兩個以上才有得換）
  const alive = await clients[0].evaluate(() => [...window.__SW.game.remotes.values()].filter((r) => r.a === 0).length);
  if (alive >= 2) {
    const s0 = await clients[0].evaluate(() => window.__SW.game.spectate);
    await clients[0].evaluate(() => { const A = window.__SW; A.input.push('specNext'); A.game.update(0.016, { ...A.emptyInput(), actions: A.input.poll().actions }); });
    const s1 = await clients[0].evaluate(() => window.__SW.game.spectate);
    await clients[0].evaluate(() => { const A = window.__SW; A.input.push('camera'); A.game.update(0.016, { ...A.emptyInput(), actions: A.input.poll().actions }); });
    const s2 = await clients[0].evaluate(() => window.__SW.game.spectate);
    check(s1 !== s0 && s2 === s0, `switch spectate target ${s0}→${s1}→${s2}`);
  }
  // 觀戰的人不會干擾別人：別人收到的位置停在他倒下的地方，看不到他的人、手電筒
  const home = await clients[0].evaluate(() => window.__SW.game.specHome);
  await host.waitForTimeout(800);
  const seen = await host.evaluate((s) => { const g = window.__SW.game, r = g.remotes.get(s); return { x: r.tx, z: r.tz, light: r.light.intensity, body: r.bodyShown, a: r.a, t: g.time, dying: !!g.dying, over: g.over, st: g.mpStatus, fl: r.floor, me: g.floorIdx }; }, slots[1]);
  check(Math.abs(seen.x - home.x) < 0.05 && Math.abs(seen.z - home.z) < 0.05 && seen.light === 0 && !seen.body, `spectator stays put and hidden for others ${JSON.stringify(seen)}`);
  // 觀戰的人按互動、拍照、丟瓶子都不會影響遊戲
  const before = await host.evaluate(() => { const g = window.__SW.game; return [g.ghost.state, g.fusesInserted, g.lv.doors.map((d) => d.target).join()]; });
  await clients[0].evaluate(() => { const A = window.__SW; for (const a of ['throw', 'flashlight', 'crouch']) A.input.push(a); A.game.update(0.016, { ...A.emptyInput(), actions: A.input.poll().actions }); });
  await host.waitForTimeout(600);
  const after = await host.evaluate(() => { const g = window.__SW.game; return [g.ghost.state, g.fusesInserted, g.lv.doors.map((d) => d.target).join()]; });
  check(before[1] === after[1] && before[2] === after[2], 'spectator actions do not change the game');

  // 其他人逃出 → 結算
  if (N > 2) {
    // 房主先逃出去：裡面只剩一個人 → 鐵捲門卡在打開的位置
    await host.evaluate(() => window.__SW.game.mpEscaped());
    for (const p of pages) await until(p, ([f, i]) => { const q = window.__SW.game.floors[f].lv.shutters[i]; return q.jammed && q.target === 1; }, [sh.f, sh.i]);
    check(true, 'shutters jam open when one player remains');
  }
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
    try { log(`p${i}`, JSON.stringify(await p.evaluate(() => ({ state: window.__SW.state, status: window.__SW.mp.status, players: window.__SW.mp.players, over: window.__SW.game && window.__SW.game.over, cur: window.__SW.game && window.__SW.game.floorIdx, gh: window.__SW.game && [window.__SW.game.ghost.floor, window.__SW.game.ghost.state, window.__SW.game.ghost.model.root.visible, window.__SW.game.ghost.net && window.__SW.game.ghost.net.fl, window.__SW.game.ghost.net && window.__SW.game.ghost.net.s], dbg: window.__SW.game && (() => { const g = window.__SW.game; const t0 = g.time; return { t: g.time, locked: g.player.locked, stairT: !!g.stairT, dying: !!g.dying, st: g.mpStatus, paused: window.__SW.paused, note: g.ui.noteOpen, hidden: document.hidden, banished: !!g.ghost.banished, ritual: !!g.ritual, downed: !!g.downed }; })() })))); } catch (x) { /* 已關閉 */ }
  }
}
for (const e of errors) console.log('  !', e);
if (errors.length) failed = true;
await browser.close();
server.close();
try { peerServer.close?.(); } catch (e) { /* 忽略 */ }
console.log(failed ? '\nFAILED' : `\nALL PASSED (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
process.exit(failed ? 1 : 0);

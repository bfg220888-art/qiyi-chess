// 每個樓層主題拍幾張截圖（肉眼檢查用）：大廳、走廊、主題房間。
//   node tests/themes-shots.mjs [輸出資料夾] [主題...]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tests/output/themes'));
const themes = process.argv.length > 3 ? process.argv.slice(3) : ['ward', 'morgue', 'pediatric', 'psych'];
await mkdir(out, { recursive: true });
const server = await serveDir(path.join(root, 'dist'));
const base = `http://127.0.0.1:${server.address().port}/index.html?debug`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
// 每個主題要看的房間（依序找第一個存在的）
const SIGNATURE = {
  ward: [['ward', 'bed'], ['operating', 'optable'], ['nurse', 'counter']],
  morgue: [['morgue', 'drawers'], ['autopsy', 'autopsy'], ['coldstore', 'bagrail']],
  pediatric: [['kidward', 'crib'], ['playroom', 'rockinghorse'], ['nursery', 'bassinet']],
  psych: [['cell', 'bed'], ['nurse', 'counter'], ['therapy', 'ectchair'], ['dayroom', 'table']],
};
for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('silentward.settings', JSON.stringify({ quality: 'medium', qualityChosen: true, cfgVer: 2 }));
    localStorage.setItem('silentward.introSeen', 'true');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${theme}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (/KHR_parallel_shader_compile|GPU stall|swiftshader|Automatic fallback/i.test(t)) return;
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${theme}] console.${m.type()}: ${t}`);
  });
  await page.goto(base);
  await page.waitForSelector('#btnStart');
  const t0 = Date.now();
  await page.evaluate((th) => { window.__SW.startGame(1234567, true, th); }, theme);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${theme}-0-loading.png`), timeout: 60000 }).catch((e) => console.log('   loading shot failed', e.message.split('\n')[0]));
  await page.waitForFunction(() => window.__SW.state === 'playing' && window.__SW.game, null, { timeout: 240000 });
  await page.evaluate(() => { window.__SW.paused = true; });
  const info = await page.evaluate(() => {
    const g = window.__SW.game, r = g.renderer.info;
    g.renderer.info.autoReset = false; g.renderer.info.reset(); g.render(0.016);
    return { theme: g.lv.theme, title: g.floorTitle, W: g.lv.W, H: g.lv.H, shape: g.lv.shape, rooms: g.lv.rooms.length, calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, corpses: g.world.corpseMeshes.length };
  });
  console.log(theme, `${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(info));
  const shot = async (name, setup, arg) => {
    const ok = await page.evaluate(setup, arg);
    if (!ok) { console.log('   skip', name); return; }
    await page.evaluate(() => { const g = window.__SW.game; for (let i = 0; i < 3; i++) g.update(0.05, { mx: 0, my: 0, look: { x: 0, y: 0 }, actions: [] }); g.render(0.05); });
    await page.screenshot({ path: path.join(out, `${theme}-${name}.png`) });
  };
  // 1. 大廳（出生點往北看）
  await shot('1-lobby', () => { const g = window.__SW.game; g.ghost.state = 'dormant'; g.ghost.dormantUntil = 1e9; g.player.flashOn = true; return true; });
  // 通電之後看得比較清楚
  await page.evaluate(() => { const g = window.__SW.game; g.world.setPower(3); for (const f of g.lv.fixtures) if (f.stage > 0) f.on = true; });
  // 2. 走廊：找一條長直走廊往前看
  await shot('2-corridor', () => {
    const g = window.__SW.game, lv = g.lv, P = g.player;
    let best = null;
    for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
      if (lv.cellAt(x, y) !== 0 || lv.blockedCell[y * lv.W + x]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let n = 0;
        while (lv.cellAt(x + dx * (n + 1), y + dy * (n + 1)) === 0 && !lv.blockedCell[(y + dy * (n + 1)) * lv.W + x + dx * (n + 1)]) n++;
        if (!best || n > best.n) best = { x, y, dx, dy, n };
      }
    }
    P.pos.x = (best.x + 0.5) * 3; P.pos.z = (best.y + 0.5) * 3;
    P.yaw = Math.atan2(-best.dx, -best.dy); P.pitch = -0.05;
    return true;
  });
  // 3+. 主題房間
  let k = 3;
  for (const [type, kind] of SIGNATURE[theme]) {
    await shot(`${k++}-${type}`, ([type, kind]) => {
      const g = window.__SW.game, lv = g.lv, P = g.player;
      const rooms = lv.rooms.filter((r) => r.type === type).sort((a, b) => b.area - a.area);
      for (const room of rooms) {
        const f = lv.furniture.find((f) => f.room === room.id && f.kind === kind) || lv.furniture.find((f) => f.room === room.id);
        if (!f) continue;
        // 站在離家具 2～4 公尺、看得到它的地方
        let best = null;
        for (let r = 3.2; r >= 1.6 && !best; r -= 0.3) for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
          const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
          if (g.collision.overlapsAny(x, z, 0.35) || lv.roomAtWorld(x, z) !== room || !g.sight(x, z, f.x, f.z)) continue;
          best = { x, z }; break;
        }
        if (!best) continue;
        P.pos.x = best.x; P.pos.z = best.z;
        P.yaw = Math.atan2(-(f.x - best.x), -(f.z - best.z)); P.pitch = -0.28;
        return true;
      }
      return false;
    }, [type, kind]);
  }
  await page.screenshot({ path: path.join(out, `${theme}-z-last.png`) });
  // 地圖
  await page.evaluate(() => { const g = window.__SW.game; for (let i = 0; i < g.explored.length; i++) g.explored[i] = 1; g.update(0.05, { mx: 0, my: 0, look: { x: 0, y: 0 }, actions: ['map'] }); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `${theme}-9-map.png`) });
  await ctx.close();
}
await browser.close();
server.close();
if (errors.length) { console.log('\nErrors / warnings:'); for (const e of [...new Set(errors)].slice(0, 40)) console.log('  ' + e); }

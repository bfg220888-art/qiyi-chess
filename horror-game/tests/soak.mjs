// 長時間模擬：機器人在醫院裡亂走、開門、躲櫃子、丟瓶子、拍照，鬼魂正常追獵。
// 檢查例外、NaN、卡住，並量測每格更新時間。  node tests/soak.mjs [秒數]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seconds = Number(process.argv[2] || 600);
const server = await serveDir(path.join(root, 'dist'));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
await ctx.addInitScript(() => { localStorage.setItem('silentward.settings', JSON.stringify({ quality: 'low', difficulty: 'nightmare' })); localStorage.setItem('silentward.introSeen', 'true'); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug`);
await page.click('#btnStart');
await page.waitForFunction(() => window.__SW && (window.__SW.state === 'intro' || window.__SW.state === 'playing'), null, { timeout: 180000 });
for (let i = 0; i < 4; i++) { await page.evaluate(() => document.getElementById('intro').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await page.waitForTimeout(150); }
await page.waitForFunction(() => window.__SW.state === 'playing');
let total = { states: {}, chases: 0, caught: 0, hides: 0, stuns: 0, maxMs: 0, sumMs: 0, n: 0, doors: 0, throws: 0, items: 0 };
for (let chunk = 0; chunk < seconds / 30; chunk++) {
  const r = await page.evaluate(() => {
    const app = window.__SW, g = app.game;
    app.paused = true;
    const P = g.player;
    P.lives = 999;
    const st = window.__bot || (window.__bot = { target: null, path: null, i: 0, t: 0, stuck: 0, last: null });
    // 量測各子系統的最大耗時
    if (!window.__prof) {
      window.__prof = {};
      const wrap = (obj, name, label) => {
        const fn = obj[name].bind(obj);
        obj[name] = (...a) => { const t = performance.now(); const r = fn(...a); const d = performance.now() - t; const p = window.__prof; if (!p[label] || d > p[label]) p[label] = d; return r; };
      };
      wrap(g.ghost, 'update', 'ghost'); wrap(g.director, 'update', 'director'); wrap(g.world, 'update', 'world');
      wrap(P, 'update', 'player'); wrap(g, 'updateInteraction', 'interaction'); wrap(g, 'updateMood', 'mood');
      wrap(g, 'markExplored', 'explored'); wrap(g.audio, 'setListener', 'listener'); wrap(g.ghostNav, 'findPath', 'findPath');
      wrap(g, 'updateProjectiles', 'projectiles');
    }
    const out = { states: {}, maxMs: 0, sumMs: 0, n: 0, doors: 0, throws: 0 };
    for (let k = 0; k < 600; k++) {
      if (g.over || g.dying) {
        // 被抓到就重新開始這一局的狀態（不重建場景）
        g.dying = null; g.over = false; P.lives = 999;
        g.ghost.state = 'dormant'; g.ghost.dormantUntil = g.time + 5; g.ghost.model.root.visible = false;
        g.post.u.uFade.value = 0;
      }
      // 機器人：沿著尋路網格走向隨機目標
      if (!st.path || st.i >= st.path.length || st.t > 25) {
        const s = g.ghost.findSpot(4, 30, false);
        st.path = s ? g.ghostNav.findPath(P.pos.x, P.pos.z, s.x, s.z) : null;
        st.i = 0; st.t = 0;
      }
      let mx = 0, my = 0, actions = [];
      if (st.path && st.path[st.i]) {
        const wp = st.path[st.i];
        const dx = wp.x - P.pos.x, dz = wp.z - P.pos.z;
        if (Math.hypot(dx, dz) < 0.4) st.i++;
        P.yaw = Math.atan2(-dx, -dz);
        my = 1;
      }
      st.t += 0.05;
      // 卡住偵測：一直撞門就開門
      if (st.last && Math.hypot(st.last.x - P.pos.x, st.last.z - P.pos.z) < 0.01 && my) { st.stuck += 0.05; } else st.stuck = 0;
      st.last = { x: P.pos.x, z: P.pos.z };
      if (st.stuck > 0.5) { actions.push('interact'); st.stuck = 0; out.doors++; }
      const r = Math.random();
      if (r < 0.002) actions.push('flashlight');
      else if (r < 0.004) { actions.push('camera'); P.film = Math.max(P.film, 1); }
      else if (r < 0.006) { P.bottles = Math.max(P.bottles, 1); actions.push('throw'); out.throws++; }
      else if (r < 0.007) actions.push('crouch');
      else if (r < 0.0085 && g.target && g.target.kind === 'locker') actions.push('interact');
      if (P.hiding && Math.random() < 0.01) actions.push('interact');
      if (g.ui.noteOpen) actions.push('interact');
      const sprint = g.ghost.state === 'chase';
      const t0 = performance.now();
      g.update(0.05, { mx, my, sprint, crouchHold: false, holdBreath: g.ghost.listening, look: { x: 0, y: 0 }, actions });
      const ms = performance.now() - t0;
      out.maxMs = Math.max(out.maxMs, ms); out.sumMs += ms; out.n++;
      out.states[g.ghost.state] = (out.states[g.ghost.state] || 0) + 1;
      for (const v of [P.pos.x, P.pos.z, g.ghost.pos.x, g.ghost.pos.z, P.sanity, P.battery]) if (!Number.isFinite(v)) throw new Error('NaN state');
      if (g.lv.cellAt(Math.floor(P.pos.x / 3), Math.floor(P.pos.z / 3)) < 0 && !g.collision.allowOutside) throw new Error('player outside map ' + P.pos.x + ',' + P.pos.z);
    }
    g.render(0.016);
    out.prof = window.__prof;
    return { ...out, stats: { ...g.stats }, items: g.lv.items.filter((i) => i.taken).length, emitters: g.audio.emitters.size };
  });
  for (const [k, v] of Object.entries(r.states)) total.states[k] = (total.states[k] || 0) + v;
  total.maxMs = Math.max(total.maxMs, r.maxMs); total.sumMs += r.sumMs; total.n += r.n; total.doors += r.doors; total.throws += r.throws;
  total.stats = r.stats; total.items = r.items; total.emitters = r.emitters; total.prof = r.prof;
}
console.log(JSON.stringify({ seconds, avgUpdateMs: (total.sumMs / total.n).toFixed(3), maxUpdateMs: total.maxMs.toFixed(1), ghostStates: total.states, doorsOpened: total.doors, throws: total.throws, stats: total.stats, itemsTaken: total.items, liveAudioEmitters: total.emitters, maxMsBySystem: Object.fromEntries(Object.entries(total.prof || {}).map(([k, v]) => [k, +v.toFixed(1)])) }, null, 1));
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n') : 'no errors');
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);

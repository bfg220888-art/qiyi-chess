// 端對端測試：在無頭 Chromium（軟體 WebGL）裡實際跑遊戲。
// 透過 ?debug 暴露的 window.__SW 直接推進模擬，不依賴即時畫面速度。
//   node tests/smoke.mjs            全部
//   node tests/smoke.mjs desktop    只跑某一組
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/output');
await mkdir(out, { recursive: true });
const server = await serveDir(path.join(root, 'dist'));
const base = `http://127.0.0.1:${server.address().port}/index.html?debug`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const only = process.argv[2];
let failures = 0;
const errors = [];
const log = (...a) => console.log('   ', ...a);

async function run(name, ctxOpts, settings, fn) {
  if (only && only !== name) return;
  const t0 = Date.now();
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript((s) => {
    localStorage.setItem('silentward.settings', JSON.stringify(s));
    localStorage.setItem('silentward.introSeen', 'true');
  }, settings);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (/KHR_parallel_shader_compile|GPU stall|swiftshader|Automatic fallback/i.test(t)) return;
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] console.${m.type()}: ${t}`);
  });
  try {
    await fn(page);
    console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name}: ${e.stack || e.message}`);
    await page.screenshot({ path: path.join(out, `${name}-fail.png`) }).catch(() => {});
  }
  await ctx.close();
}

const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const assert = (c, msg) => { if (!c) throw new Error('assert: ' + msg); };

async function startGame(page, opts = {}) {
  await page.goto(base);
  await page.waitForSelector('#btnStart');
  if (opts.menuShot) await shot(page, opts.menuShot);
  if (opts.diff) await page.click(`[data-diff="${opts.diff}"]`);
  if (opts.touch) await page.tap('#btnStart'); else await page.click('#btnStart');
  await page.waitForFunction(() => window.__SW && (window.__SW.state === 'intro' || window.__SW.state === 'playing'), null, { timeout: 180000 });
  for (let i = 0; i < 4; i++) {
    const st = await page.evaluate(() => window.__SW.state);
    if (st === 'playing') break;
    await page.evaluate(() => document.getElementById('intro').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => window.__SW.state === 'playing', null, { timeout: 30000 });
  // 停掉即時迴圈，改由測試推進
  await page.evaluate(() => { window.__SW.paused = true; });
}

// 在頁面裡推進模擬
const sim = (page, seconds, input = {}) => page.evaluate(([seconds, input]) => {
  const g = window.__SW.game;
  const n = Math.round(seconds / 0.05);
  const t0 = performance.now();
  for (let i = 0; i < n && !g.over; i++) {
    const near = Math.hypot(g.ghost.pos.x - g.player.pos.x, g.ghost.pos.z - g.player.pos.z) < 2.5 && g.ghost.state !== 'dormant';
    const holdBreath = input.breath === 'smart' ? (g.ghost.listening || near) : !!input.breath;
    g.update(0.05, { mx: input.mx || 0, my: input.my || 0, sprint: !!input.sprint, crouchHold: !!input.crouch, holdBreath, look: { x: input.lookX || 0, y: 0 }, actions: i === 0 ? (input.actions || []) : [] });
    const p = g.player.pos;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(g.ghost.pos.x)) throw new Error('NaN position at step ' + i);
  }
  return { ms: (performance.now() - t0) / Math.max(1, n), x: g.player.pos.x, z: g.player.pos.z, ghost: g.ghost.state, over: g.over, dying: !!g.dying };
}, [seconds, input]);

const render = (page) => page.evaluate(() => {
  const g = window.__SW.game;
  g.renderer.info.autoReset = false;
  g.renderer.info.reset();
  g.render(0.016);
  const i = g.renderer.info.render;
  return { calls: i.calls, tris: i.triangles, programs: g.renderer.info.programs.length, textures: g.renderer.info.memory.textures, geometries: g.renderer.info.memory.geometries };
});

// 把玩家放到某個東西旁邊並看著它
const faceThing = (page, kind, idx = 0) => page.evaluate(([kind, idx]) => {
  const g = window.__SW.game, P = g.player, lv = g.lv;
  let tx, ty, tz;
  if (kind === 'item') { const it = lv.items.filter((i) => !i.taken)[idx]; tx = it.x; ty = it.y + 0.03; tz = it.z; }
  else if (kind === 'fuse') { const it = lv.items.filter((i) => i.kind === 'fuse' && !i.taken)[0]; tx = it.x; ty = it.y + 0.03; tz = it.z; }
  else if (kind === 'note') { const it = lv.items.filter((i) => i.kind === 'note' && !i.taken)[0]; tx = it.x; ty = it.y + 0.01; tz = it.z; }
  else if (kind === 'fusebox') { const p = g.world.fusebox.userData.sockets[0].getWorldPosition(new (P.pos.constructor)()); tx = p.x; ty = p.y; tz = p.z; }
  else if (kind === 'locker') { const l = lv.lockers[idx]; tx = l.x + Math.sin(l.rot) * 0.3; ty = 1.2; tz = l.z + Math.cos(l.rot) * 0.3; }
  else if (kind === 'door') { const d = lv.doors[idx]; tx = d.cx; ty = 1.2; tz = d.cz; }
  // 找一個站得到的位置（鐵櫃就站在櫃門正前方）
  let best = kind === 'locker' ? { x: lv.lockers[idx].exitX, z: lv.lockers[idx].exitZ } : null;
  for (let r = 0.7; r <= 1.5 && !best; r += 0.1) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
      if (g.collision.overlapsAny(x, z, 0.32)) continue;
      const room = lv.roomAtWorld(x, z);
      if (!room) continue;
      // 不能隔牆
      if (!g.sight(x, z, tx - (tx - x) * 0.1, tz - (tz - z) * 0.1)) continue;
      best = { x, z };
      break;
    }
  }
  if (!best) return null;
  P.pos.x = best.x; P.pos.z = best.z;
  P.hiding = null;
  const dx = tx - best.x, dz = tz - best.z, dy = ty - P.eye;
  P.yaw = Math.atan2(-dx, -dz);
  P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  P.aim.set(0, 0, -1);
  P.applyCamera(0.016, 0);
  g.updateInteraction();
  return g.target ? g.target.kind + ':' + g.target.label : 'none';
}, [kind, idx]);

// ---------------------------------------------------------------------------
await run('desktop', { viewport: { width: 1280, height: 720 } }, { quality: 'high' }, async (page) => {
  await startGame(page, { menuShot: 'menu-desktop' });
  const r0 = await render(page);
  log('render', JSON.stringify(r0));
  await shot(page, 'd1-start');
  // 外部素材真的有載入（路徑壞掉時遊戲會默默改用程序版本，這裡要抓出來）
  const assets = await page.evaluate(async () => {
    const g = window.__SW.game;
    if (g.audio.samplesLoading) await g.audio.samplesLoading;
    return { real: !!g.ghost.model.isReal, photos: !!g.tf.photos, sfx: Object.keys(g.audio.buf || {}).length };
  });
  log('assets', JSON.stringify(assets));
  assert(assets.real && assets.photos && assets.sfx >= 40, 'external assets should load');
  const before = await sim(page, 0.05);
  const after = await sim(page, 3, { my: 1 });
  log('walk', before.x.toFixed(2), before.z.toFixed(2), '->', after.x.toFixed(2), after.z.toFixed(2), `update ${after.ms.toFixed(2)}ms`);
  assert(Math.hypot(after.x - before.x, after.z - before.z) > 3, 'player should move forward');
  await render(page);
  await shot(page, 'd2-walk');
  // 看大廳平面圖
  await page.evaluate(() => { const g = window.__SW.game, P = g.player; P.pos.x = g.lv.spawn.x - 2.2; P.pos.z = g.lv.spawn.z - 1.2; P.yaw = 0; P.pitch = 0.05; });
  await sim(page, 0.1);
  await render(page);
  await shot(page, 'd3-board');
  // 撿保險絲
  for (let k = 0; k < 3; k++) {
    const t = await faceThing(page, 'fuse');
    log('fuse target', t);
    assert(t && t.startsWith('item'), 'should target fuse, got ' + t);
    if (k === 0) { await render(page); await shot(page, 'd4-fuse'); }
    await sim(page, 0.05, { actions: ['interact'] });
  }
  const carried = await page.evaluate(() => window.__SW.game.player.fuses);
  assert(carried === 3, 'carry 3 fuses');
  // 筆記
  const nt = await faceThing(page, 'note');
  assert(nt && nt.includes('閱讀'), 'note target ' + nt);
  await sim(page, 0.05, { actions: ['interact'] });
  assert(await page.evaluate(() => !document.getElementById('note').hidden), 'note open');
  await shot(page, 'd5-note');
  await sim(page, 0.05, { actions: ['interact'] });
  assert(await page.evaluate(() => document.getElementById('note').hidden), 'note closed');
  // 配電箱
  const fb = await faceThing(page, 'fusebox');
  log('fusebox target', fb);
  assert(fb && fb.startsWith('fusebox'), 'fusebox target ' + fb);
  for (let k = 0; k < 3; k++) await sim(page, 0.1, { actions: ['interact'] });
  assert(await page.evaluate(() => window.__SW.game.fusesInserted) === 3, '3 fuses inserted');
  await page.waitForTimeout(2200); // setTimeout 的通電演出
  await sim(page, 1.5);
  await render(page);
  await shot(page, 'd6-power');
  const gate = await page.evaluate(() => window.__SW.game.lv.gate.open);
  assert(gate, 'gate should open after 3 fuses');
  // 地圖
  await sim(page, 0.05, { actions: ['map'] });
  assert(await page.evaluate(() => !document.getElementById('mapView').hidden), 'map open');
  await shot(page, 'd7-map');
  await sim(page, 0.05, { actions: ['map'] });
  // 讓鬼魂消失以免干擾，走出大門
  await page.evaluate(() => { const g = window.__SW.game; g.ghost.state = 'dormant'; g.ghost.dormantUntil = 1e9; g.ghost.enraged = false; const P = g.player; P.pos.x = g.lv.gate.x; P.pos.z = g.lv.gate.z - 1.2; P.yaw = Math.PI; P.pitch = 0; });
  await sim(page, 2.5);
  await render(page);
  await shot(page, 'd8-gate');
  await sim(page, 3, { my: 1 });
  assert(await page.evaluate(() => window.__SW.game.over), 'should win after walking out');
  await page.waitForTimeout(2200);
  assert(await page.evaluate(() => !document.getElementById('end').hidden && document.getElementById('endTitle').textContent.includes('逃')), 'victory screen');
  await page.waitForTimeout(1000);
  const fadeOpacity = await page.evaluate(() => Number(getComputedStyle(document.getElementById('fade')).opacity));
  assert(fadeOpacity < 0.1, 'victory screen must not be covered by the black fade (opacity ' + fadeOpacity + ')');
  await shot(page, 'd9-win');
});

await run('ghost', { viewport: { width: 960, height: 540 } }, { quality: 'low' }, async (page) => {
  await startGame(page);
  // 1. 鬼魂在面前：相機閃光定住她
  const placed = await page.evaluate(() => {
    const g = window.__SW.game, P = g.player, lv = g.lv;
    for (let k = 0; k < 600; k++) {
      const x = Math.random() * lv.W * 3, z = Math.random() * lv.H * 3;
      if (!g.ghostNav.isFree(x, z) || g.collision.overlapsAny(x, z, 0.35)) continue;
      const a = Math.random() * Math.PI * 2;
      const gx = x - Math.sin(a) * 5, gz = z - Math.cos(a) * 5;
      if (!g.ghostNav.isFree(gx, gz) || !g.sight(x, z, gx, gz)) continue;
      P.pos.x = x; P.pos.z = z; P.yaw = a; P.pitch = 0;
      g.ghost.spawnAt(gx, gz, 'wander');
      g.ghost.yaw = Math.atan2(gx - x, gz - z); // 背對玩家
      g.ghost.path = [{ x: gx, z: gz }];
      return true;
    }
    return false;
  });
  assert(placed, 'could place ghost in view');
  await sim(page, 0.3);
  await render(page);
  await shot(page, 'g1-ghost');
  const st = await page.evaluate(() => { const g = window.__SW.game; g.player.film = 3; g.player.flashCooldown = 0; return g.ghost.state; });
  log('ghost before flash', st);
  await sim(page, 0.05, { actions: ['camera'] });
  await sim(page, 0.6);
  const afterFlash = await page.evaluate(() => window.__SW.game.ghost.state);
  log('ghost after flash', afterFlash);
  if (afterFlash !== 'stunned') {
    const geo = await page.evaluate(() => {
      const g = window.__SW.game, P = g.player, gh = g.ghost, cam = P.camera;
      const fwd = P.forward(cam.position.clone());
      const to = gh.pos.clone().setY(1.5).sub(cam.position);
      const d = to.length();
      return { d, dot: to.normalize().dot(fwd), sight: g.sight(P.pos.x, P.pos.z, gh.pos.x, gh.pos.z), yaw: P.yaw, pitch: P.pitch, stats: g.stats, pending: P.pendingFlash, film: P.film };
    });
    log('flash debug', JSON.stringify(geo));
  }
  assert(afterFlash === 'stunned', 'camera flash should stun her');
  // 2. 長時間 AI 模擬：玩家站著不動，鬼魂遊蕩，不能出錯
  await page.evaluate(() => { const g = window.__SW.game; g.player.lives = 99; });
  const states = new Set();
  for (let k = 0; k < 12; k++) {
    const r = await sim(page, 10);
    states.add(r.ghost);
  }
  log('ghost states seen', [...states].join(','));
  // 3. 被抓到 → 死亡畫面
  await page.evaluate(() => {
    const g = window.__SW.game, P = g.player;
    P.lives = 1;
    P.hiding = null;
    const fwdX = -Math.sin(P.yaw), fwdZ = -Math.cos(P.yaw);
    let gx = P.pos.x + fwdX * 1.5, gz = P.pos.z + fwdZ * 1.5;
    if (!g.ghostNav.isFree(gx, gz)) {
      // 隨機關卡偶爾在正前方放不下：在玩家附近找一個能走的點
      let s = g.ghost.findSpot(1, 3, false);
      for (let k = 0; k < 4000 && !s; k++) {
        const a = Math.random() * Math.PI * 2, d = 0.8 + Math.random() * 3;
        const x = P.pos.x + Math.sin(a) * d, z = P.pos.z + Math.cos(a) * d;
        if (g.ghostNav.isFree(x, z)) s = { x, z };
      }
      gx = s.x; gz = s.z;
    }
    g.ghost.spawnAt(gx, gz, 'chase');
    g.ghost.lastKnown = { x: P.pos.x, z: P.pos.z };
    g.ghost.enraged = true;
  });
  let r;
  for (let k = 0; k < 20; k++) { r = await sim(page, 0.5); if (r.dying || r.over) break; }
  log('caught', JSON.stringify(r));
  assert(r.dying || r.over, 'ghost should catch a standing player');
  await sim(page, 0.6);
  await render(page);
  await shot(page, 'g2-jumpscare');
  await sim(page, 2);
  assert(await page.evaluate(() => window.__SW.game.over && !document.getElementById('end').hidden), 'game over screen');
  await shot(page, 'g3-dead');
  // 4. 再試一次（同一個種子）
  const seed = await page.evaluate(() => window.__SW.game.seed);
  await page.click('#btnRetry');
  await page.waitForFunction((s) => window.__SW.state === 'playing' && window.__SW.game && window.__SW.game.seed === s && !window.__SW.game.over, seed, { timeout: 180000 });
  await page.evaluate(() => { window.__SW.paused = true; });
  // 5. 躲進鐵櫃，鬼魂沒看到 → 她找不到
  const lk = await faceThing(page, 'locker', 0);
  log('locker target', lk);
  assert(lk && lk.startsWith('locker'), 'locker target ' + lk);
  await sim(page, 0.05, { actions: ['interact'] });
  await sim(page, 1.2);
  assert(await page.evaluate(() => !!window.__SW.game.player.hiding), 'player hiding');
  await render(page);
  await shot(page, 'g4-hiding');
  await page.evaluate(() => { const g = window.__SW.game; let s = g.ghost.findSpot(5, 9, false) || g.ghost.findSpot(3, 15, false) || g.ghost.findSpot(2, 25, false); for (let k = 0; k < 4000 && !s; k++) { const x = g.player.pos.x + (Math.random() - 0.5) * 30, z = g.player.pos.z + (Math.random() - 0.5) * 30; if (g.ghostNav.isFree(x, z) && Math.hypot(x - g.player.pos.x, z - g.player.pos.z) > 3) s = { x, z }; } g.ghost.spawnAt(s.x, s.z, 'search'); g.ghost.lastKnown = { x: g.player.pos.x, z: g.player.pos.z }; });
  const hid = await sim(page, 15, { breath: 'smart' });
  log('while hiding ghost', hid.ghost, 'dying', hid.dying);
  assert(!hid.dying && !hid.over, 'unseen hiding player should survive');
  // 屏息：她停在櫃子前面聽
  await page.evaluate(() => {
    const g = window.__SW.game, P = g.player, l = P.hiding, gh = g.ghost;
    P.breath = 1;
    gh.spawnAt(l.exitX + Math.sin(l.rot) * 1.2, l.exitZ + Math.cos(l.rot) * 1.2, 'search');
    gh.path = null; gh.idleT = 60; gh.stateT = 0; gh.knowsLocker = null; gh.hearT = 0;
  });
  const held = await sim(page, 5, { breath: true });
  const heldInfo = await page.evaluate(() => ({ listening: window.__SW.game.ghost.listening, knows: !!window.__SW.game.ghost.knowsLocker, breath: window.__SW.game.player.breath }));
  log('holding breath', JSON.stringify(heldInfo));
  assert(!held.dying && !heldInfo.knows, 'holding breath should keep you hidden');
  await page.evaluate(() => { const g = window.__SW.game; g.ghost.state = 'dormant'; g.ghost.model.root.visible = false; g.ghost.dormantUntil = g.time + 999; g.ghost.stopHum(); });
  await sim(page, 0.05, { actions: ['interact'] });
  await sim(page, 1);
  assert(await page.evaluate(() => !window.__SW.game.player.hiding), 'player left locker');
  // 丟瓶子：她會去查看
  const thrown = await page.evaluate(() => {
    const g = window.__SW.game, P = g.player;
    P.bottles = 2;
    let s = g.ghost.findSpot(5, 10, true) || g.ghost.findSpot(4, 12, false) || g.ghost.findSpot(2, 20, false);
    // 隨機關卡偶爾在附近找不到位置：退而求其次找任何一個能走的點
    for (let k = 0; k < 2000 && !s; k++) {
      const x = P.pos.x + (Math.random() - 0.5) * 30, z = P.pos.z + (Math.random() - 0.5) * 30;
      if (g.ghostNav.isFree(x, z) && Math.hypot(x - P.pos.x, z - P.pos.z) > 3) s = { x, z };
    }
    g.ghost.spawnAt(s.x, s.z, 'wander');
    g.ghost.path = null; g.ghost.idleT = 30;
    g.ghost.dormantUntil = 0;
    P.pitch = 0.2;
    g.throwBottle();
    return g.projectiles.length;
  });
  assert(thrown === 1, 'bottle in flight');
  await sim(page, 2);
  const after = await page.evaluate(() => { const g = window.__SW.game, p = g.projectiles[0]; return { n: g.projectiles.length, state: g.ghost.state, bottles: g.player.bottles, over: g.over, dying: !!g.dying, time: g.time, p: p && [p.pos.x, p.pos.y, p.pos.z, p.vel.y, p.life] }; });
  log('after throw', JSON.stringify(after));
  assert(after.n === 0 && after.bottles === 1, 'bottle shattered');
  // 她去查看聲音時也可能順便看到玩家而直接追過來，只要不是繼續閒晃就算有反應
  assert(['investigate', 'search', 'chase'].includes(after.state), 'ghost should react to the noise, got ' + after.state);
  // 6. 門
  const di = await page.evaluate(() => window.__SW.game.lv.doors.findIndex((d) => d.angle < 0.05));
  const dt = await faceThing(page, 'door', di);
  log('door target', di, dt);
  assert(dt && dt.startsWith('door'), 'door target ' + dt);
  await sim(page, 0.05, { actions: ['interact'] });
  await sim(page, 1);
  const a1 = await page.evaluate((i) => window.__SW.game.lv.doors[i].angle, di);
  log('door angle 0 ->', a1.toFixed(2));
  assert(a1 > 1, 'door opened');
});

await run('mobile', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { quality: 'low' }, async (page) => {
  await startGame(page, { touch: true, menuShot: 'menu-mobile' });
  assert(await page.evaluate(() => window.__SW.input.touchMode && !document.getElementById('touch').hidden), 'touch controls visible');
  await render(page);
  await shot(page, 'm1-game');
  // 用 pointer 事件模擬搖桿往前推
  const mv = await page.evaluate(() => {
    const L = document.getElementById('touch');
    const ev = (type, x, y) => L.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, pointerType: 'touch', bubbles: true, cancelable: true }));
    window.__SW.input.enabled = true;
    ev('pointerdown', 150, 280);
    ev('pointermove', 150, 220);
    const p = window.__SW.input.poll();
    ev('pointerup', 150, 220);
    const p2 = window.__SW.input.poll();
    return { my: p.my, sprint: p.sprint, after: p2.my };
  });
  log('joystick', JSON.stringify(mv));
  assert(mv.my > 0.9 && mv.after === 0, 'joystick forward');
  // 右半邊滑動看四周
  const look = await page.evaluate(() => {
    const L = document.getElementById('touch');
    const ev = (type, x, y) => L.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: x, clientY: y, pointerType: 'touch', bubbles: true, cancelable: true }));
    ev('pointerdown', 600, 200);
    ev('pointermove', 660, 200);
    const p = window.__SW.input.poll();
    ev('pointerup', 660, 200);
    return p.look.x;
  });
  log('look dx', look.toFixed(3));
  assert(look > 0.1, 'touch look');
  // 按鈕
  await page.evaluate(() => document.querySelector('[data-action="flashlight"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
  const acts = await page.evaluate(() => window.__SW.input.poll().actions);
  assert(acts.includes('flashlight'), 'flashlight button');
  const w0 = await sim(page, 0.05);
  const w1 = await sim(page, 2, { my: 1 });
  if (Math.hypot(w1.x - w0.x, w1.z - w0.z) <= 2) {
    const dbg = await page.evaluate(() => { const g = window.__SW.game, P = g.player; return { pos: [P.pos.x, P.pos.z], yaw: P.yaw, locked: P.locked, hiding: !!P.hiding, near: g.lv.furniture.filter((f) => Math.hypot(f.x - P.pos.x, f.z - P.pos.z) < 3).map((f) => f.kind + '@' + f.x.toFixed(1) + ',' + f.z.toFixed(1)) }; });
    log('walk debug', JSON.stringify(dbg), JSON.stringify(w0), JSON.stringify(w1));
  }
  assert(Math.hypot(w1.x - w0.x, w1.z - w0.z) > 2, 'mobile walk');
  await render(page);
  await shot(page, 'm2-walk');
  // 暫停按鈕
  await page.evaluate(() => { window.__SW.paused = false; window.__SW.input.enabled = true; });
  await page.evaluate(() => document.querySelector('[data-action="pause"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
  await page.waitForFunction(() => !document.getElementById('pause').hidden, null, { timeout: 30000 });
  await shot(page, 'm3-pause');
  await page.tap('#btnResume');
  assert(await page.evaluate(() => document.getElementById('pause').hidden && !window.__SW.paused), 'resumed');
});

await run('portrait', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { quality: 'low' }, async (page) => {
  await page.goto(base);
  await page.waitForSelector('#btnStart');
  await shot(page, 'p1-menu');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!overflow, 'no horizontal overflow');
});

await browser.close();
server.close();
if (errors.length) { console.log('\nErrors / warnings:'); for (const e of [...new Set(errors)].slice(0, 40)) console.log('  ' + e); }
const fatal = errors.filter((e) => e.includes('pageerror') || e.includes('console.error'));
console.log(failures || fatal.length ? `\nFAILED (${failures} failed, ${fatal.length} errors)` : '\nALL PASSED');
process.exit(failures || fatal.length ? 1 : 0);

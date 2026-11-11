// 關卡生成模糊測試：大量種子都必須產生合法、可通關的關卡（每個樓層主題輪流測，含手術部與燒毀的舊院區）
// 也檢查格局的變化：每個主題都要生出好幾種不同的走廊拓樸（棋盤格、環狀、天井、H 形、魚骨形……）
//   node tests/level.test.mjs [數量] [主題]
import { generateLevel, generateHospital, E, VOID, FURN } from '../src/level.js';
import { validateLevel, NavGrid, Collision, sightClear, lockedDoorBox } from '../src/nav.js';
import { DIFFICULTY, GHOST_R, CELL, COOP_ITEMS } from '../src/config.js';
import { THEME_KEYS, THEMES, resolveTheme } from '../src/themes.js';
import { DOCS, DOC_LINES, DOC_TYPES, MAIN_DOCS, LOBBY_DOC, GEN_DOC, pickDocs, sideDocCount, docTree, sanitizeCollection } from '../src/docs.js';

// 文件（紙條）：這一局出現的就是 pickDocs(種子, 樓層數) 那幾份，各一份；主線七份一定都在；
// 交班紀錄在大廳、錄音逐字稿在發電機房
const docSeen = new Map();
function checkDocs(fl, seed, assert) {
  const want = pickDocs(seed, fl.length);
  const notes = fl.flatMap((l) => l.items.filter((i) => i.kind === 'note').map((it) => ({ l, it })));
  assert(notes.map((x) => x.it.note).sort((a, b) => a - b).join() === want.join(), 'documents = pickDocs: ' + notes.map((x) => x.it.note).join());
  assert(MAIN_DOCS.every((n) => want.includes(n)), 'full main line');
  assert(want.length === MAIN_DOCS.length + sideDocCount(fl.length), 'document count ' + want.length);
  const lob = notes.find((x) => x.it.note === LOBBY_DOC), gen = notes.find((x) => x.it.note === GEN_DOC);
  assert(lob && lob.l === fl[0] && lob.l.roomAtWorld(lob.it.x, lob.it.z) === fl[0].lobby, 'handover log in the lobby');
  assert(gen && gen.l.generatorRoom && gen.l.roomAtWorld(gen.it.x, gen.it.z) === gen.l.generatorRoom, 'transcript in the generator room');
  for (const n of want) docSeen.set(n, (docSeen.get(n) || 0) + 1);
}

const N = Number(process.argv[2] || 300);

// 門禁卡與上鎖的房間（整棟醫院一起看）：
// 每一扇上鎖的門剛好有一張同色的卡；卡不在任何上鎖的房間裡（=不用開任何鎖就拿得到，所以不可能有「鑰匙在自己的門後」或循環依賴）；
// 上鎖的房間只有一扇門；每層最多一個保險絲鎖在裡面；鎖起來之後其他地方都還走得到（validateLevel 的嚴格模式另外檢查）
// 遺物與搖籃：三件遺物各一件、不在劇情房間；整棟醫院剛好一個搖籃，放在劇情房間裡、走得到（validateLevel 也檢查）
function checkRelics(fl, assert, altarThemes) {
  const relics = fl.flatMap((l) => l.items.filter((i) => i.kind === 'relic').map((it) => ({ l, it })));
  assert(relics.map((x) => x.it.relic).sort().join() === '0,1,2', 'three relics 0,1,2');
  const altars = fl.filter((l) => l.altar);
  assert(altars.length === 1, `exactly one altar (${altars.length})`);
  for (const l of altars) {
    assert(l.room707 && l.altar.room === l.room707.id && l.altar.kind === 'altar', `altar sits in the story room ${l.room707 && l.room707.label}`);
    if (altarThemes) altarThemes.add(l.theme);
  }
  for (const { l, it } of relics) assert(l.roomAtWorld(it.x, it.z) !== l.room707, 'relic not already in the story room');
  if (fl.length > 1) assert(new Set(relics.map((x) => x.l.floorIndex)).size === Math.min(3, fl.length), 'relics spread across floors');
}
function checkLocks(fl, assert) {
  const doors = fl.flatMap((l) => l.doors.filter((d) => d.lock >= 0).map((d) => ({ l, d })));
  const cards = fl.flatMap((l) => l.items.filter((i) => i.kind === 'keycard').map((it) => ({ l, it })));
  assert(doors.length >= fl.length, `at least one locked door per floor (${doors.length})`);
  assert(new Set(doors.map((x) => x.d.lock)).size === doors.length, 'lock colours unique');
  for (const { l, d } of doors) {
    const room = l.rooms.find((r) => r.locked === d.lock);
    assert(room && room.doors.length === 1 && room.doors[0] === d.id, `locked room ${d.lock} has exactly its one door`);
    assert(room && room.label && room !== l.room707 && room !== l.generatorRoom && room !== l.stairRoom, 'locked room is not a story / generator / stair room');
    assert(cards.filter((c) => c.it.color === d.lock).length === 1, `one keycard for colour ${d.lock}`);
  }
  for (const { l, it } of cards) {
    const rm = l.roomAtWorld(it.x, it.z);
    assert(!rm || rm.locked === undefined, `keycard ${it.color} is behind a locked door`);
    assert(doors.some((x) => x.d.lock === it.color), `keycard ${it.color} has a door`);
  }
  for (const l of fl) {
    const lockedFuses = l.items.filter((i) => i.kind === 'fuse' && (l.roomAtWorld(i.x, i.z) || {}).locked !== undefined);
    assert(lockedFuses.length <= 1, 'at most one fuse behind locks per floor');
  }
}
const onlyTheme = process.argv[3];
let fails = 0, retries = 0;
const altarThemes = new Set();
const t0 = Date.now();
const stats = {};
for (const k of THEME_KEYS) stats[k] = { n: 0, rooms: 0, items: 0, lockers: 0, doors: 0, cells: 0, corpses: 0, shapes: {}, types: {}, inner: 0 };
for (let s = 1; s <= N; s++) {
  const diff = DIFFICULTY[['easy', 'normal', 'nightmare'][s % 3]];
  const theme = onlyTheme || THEME_KEYS[s % THEME_KEYS.length];
  const seed = s * 2654435761 >>> 0;
  let lv;
  try {
    lv = generateLevel(seed, diff, (l) => validateLevel(l), theme);
  } catch (e) {
    fails++;
    console.error('seed', s, theme, 'FAILED:', e.message);
    continue;
  }
  const assert = (c, m) => { if (!c) { fails++; console.error('seed', s, theme, m); } };
  assert(lv.theme === theme, 'theme ' + lv.theme);
  if (lv.seed !== seed) retries++;
  const st = stats[theme];
  st.n++; st.rooms += lv.rooms.length; st.items += lv.items.length; st.lockers += lv.lockers.length; st.doors += lv.doors.length;
  st.cells += lv.cells.reduce((a, v) => a + (v !== VOID ? 1 : 0), 0);
  st.corpses += lv.furniture.filter((f) => f.corpse).length;
  st.shapes[lv.shape] = (st.shapes[lv.shape] || 0) + 1;
  st.inner += lv.rooms.filter((r) => r.inner).length;
  for (const r of lv.rooms) st.types[r.type] = (st.types[r.type] || 0) + 1;
  const fuses = lv.items.filter((i) => i.kind === 'fuse');
  const notes = lv.items.filter((i) => i.kind === 'note');
  assert(fuses.length === 3, 'fuse count');
  assert(notes.length === 11, 'note count');
  checkDocs([lv], lv.seed, assert); // 沒有給 plan 時，文件由實際生成的那個種子決定
  assert(lv.items.filter((i) => i.kind === 'battery' && !i.loot).length === diff.batteries, 'battery count');
  checkLocks([lv], assert);
  checkRelics([lv], assert, altarThemes);
  assert(lv.shutters.length === 0, 'single player has no shutters');
  assert(lv.fusebox, 'fusebox');
  assert(lv.generatorRoom && lv.generatorRoom.type === 'generator', 'generator room');
  assert(lv.lobby && lv.lobby.type === 'lobby', 'lobby');
  assert(lv.lockers.length >= 6, 'locker count ' + lv.lockers.length);
  // 道具不能在牆或家具裡（地板上的道具）
  const col = new Collision(lv);
  for (const it of lv.items) {
    if (it.y > 0.01) continue;
    assert(!col.overlapsAny(it.x, it.z, 0.12), `item ${it.kind} inside obstacle at ${it.x.toFixed(2)},${it.z.toFixed(2)}`);
  }
  // 鬼魂能從大廳走到每一個房間
  const nav = new NavGrid(lv, GHOST_R, { ghost: true });
  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    const p = nav.findPath(lv.spawn.x, lv.spawn.z, room.cx, room.cz, 60000);
    assert(p && p.length, `ghost path to room ${room.id} ${room.type}`);
  }
  // 她的動態尋路網格：還鎖著的門是牆（進不了上鎖的房間），開鎖後只更新那幾格就走得進去
  if (s % 5 === 0) {
    const dnav = new NavGrid(lv, GHOST_R, { ghost: true, dynamic: true });
    for (const room of lv.rooms.filter((r) => r.locked !== undefined)) {
      const d = lv.doors[room.doors[0]];
      assert(!dnav.findPath(lv.spawn.x, lv.spawn.z, room.cx, room.cz, 60000), `ghost walks into locked room ${room.id}`);
      assert(dnav.compAt(room.cx, room.cz) !== dnav.compAt(lv.spawn.x, lv.spawn.z), 'locked room is its own nav component');
      assert(dnav.setBlock('d' + d.id, lockedDoorBox(d), false), 'unlock changes the nav grid');
      assert(dnav.findPath(lv.spawn.x, lv.spawn.z, room.cx, room.cz, 60000), `ghost cannot enter unlocked room ${room.id}`);
      assert(dnav.compAt(room.cx, room.cz) === dnav.compAt(lv.spawn.x, lv.spawn.z), 'unlocked room joins the main component');
      // 重新上鎖、再打開：計數正確，網格回到同一個狀態
      const snap = dnav.blocked.slice();
      dnav.setBlock('d' + d.id, lockedDoorBox(d), true); dnav.setBlock('d' + d.id, null, false);
      assert(snap.every((v, k) => v === dnav.blocked[k]), 'incremental nav update is reversible');
    }
  }
  // 內室（不貼走廊的房間）一定有門通到別的房間
  for (const room of lv.rooms) if (room.inner) assert(room.doors.length > 0, `inner room ${room.id} has no door`);
  // 置物櫃前方必須不在牆裡
  for (const l of lv.lockers) assert(!col.overlapsAny(l.exitX, l.exitZ, 0.25), `locker exit blocked ${l.id}`);
  // 大門在通電前不透視
  assert(!sightClear(lv, lv.gate.x, lv.gate.z - 1, lv.gate.x, lv.gate.z + 1), 'gate sight');
  // 決定性：同樣的 (seed, 難度, 主題) 生出一模一樣的樓層（多人連線靠這個）
  if (s % 10 === 0) {
    const again = generateLevel(seed, diff, (l) => validateLevel(l), theme);
    assert(again.ascii() === lv.ascii() && again.items.length === lv.items.length && again.furniture.length === lv.furniture.length
      && again.items.every((it, i) => it.x === lv.items[i].x && it.z === lv.items[i].z), 'not deterministic');
    // 「隨機」主題也要先由 seed 決定，再照樣生成
    const rnd = generateLevel(seed, diff, (l) => validateLevel(l), 'random');
    assert(rnd.theme === resolveTheme('random', seed) && THEME_KEYS.includes(rnd.theme), 'random theme');
    const rnd2 = generateLevel(seed, diff, (l) => validateLevel(l));
    assert(rnd2.theme === rnd.theme && rnd2.ascii() === rnd.ascii(), 'random theme not deterministic');
  }
}
// ---------------------------------------------------------------------------
// 多層樓（1～3 層）：每一層都能走到所有道具與樓梯、樓梯成對、保險絲 / 紙條 / 發電機房分散在各層、結果有決定性
const MF = Math.max(4, Math.round(N / 4));
let mfLevels = 0;
const mt0 = Date.now();
for (let s = 1; s <= MF; s++) {
  const count = 1 + (s % 3);
  const diff = DIFFICULTY[['easy', 'normal', 'nightmare'][count - 1]];
  const theme = s % 5 === 0 ? 'random' : THEME_KEYS[s % THEME_KEYS.length];
  const seed = (s * 2246822519) >>> 0;
  let fl;
  try {
    fl = generateHospital(seed, diff, (l) => validateLevel(l), theme, count);
  } catch (e) {
    fails++;
    console.error('hospital', s, count, 'FAILED:', e.message);
    continue;
  }
  mfLevels += fl.length;
  const assert = (c, m) => { if (!c) { fails++; console.error('hospital', s, count, theme, m); } };
  assert(fl.length === count, 'floor count');
  assert(fl[0].theme === resolveTheme(theme, seed), 'ground floor theme');
  assert(new Set(fl.map((l) => l.theme)).size === count, 'floor themes differ');
  // 太平間只會在最下面
  const lowest = Math.min(...fl.map((l) => THEMES[l.theme].level));
  for (const l of fl) if (l.theme === 'morgue') assert(THEMES[l.theme].level === lowest && l.stairs.every((st) => st.dir === 'up'), 'morgue is the basement');
  assert(fl.filter((l) => l.generatorRoom && l.fusebox).length === 1, 'exactly one generator room');
  assert(fl.filter((l) => l.gate).length === 1 && fl[0].gate && fl[0].lobby.type === 'lobby', 'gate only on floor 0');
  const items = fl.flatMap((l) => l.items);
  assert(items.filter((i) => i.kind === 'fuse').length === 3, 'fuse total');
  if (count > 1) assert(fl.every((l) => l.items.some((i) => i.kind === 'fuse')), 'a fuse on every floor');
  checkDocs(fl, seed, assert);
  if (count === 1) assert(fl[0].items.filter((i) => i.kind === 'battery' && !i.loot).length === diff.batteries, 'single floor batteries');
  checkLocks(fl, assert);
  checkRelics(fl, assert);
  for (const [i, l] of fl.entries()) {
    assert(l.floorIndex === i, 'floor index');
    assert(!validateLevel(l), 'floor valid: ' + validateLevel(l));
    if (i > 0) assert(l.lobby.type === 'landing' && !l.gate, 'upper floor has a landing');
    // 樓梯成對：A 往 B 的樓梯，B 一定有往 A 的樓梯，方向相反
    for (const st of l.stairs) {
      const back = fl[st.to] && fl[st.to].stairs.find((b) => b.to === i);
      assert(back && back.dir !== st.dir, `stairs ${i}->${st.to} have a matching flight`);
      assert((st.dir === 'up') === (THEMES[fl[st.to].theme].level > THEMES[l.theme].level), 'stair direction follows floor order');
    }
    // 樓層之間連通：每一層都有樓梯（單層沒有）
    assert(count === 1 ? l.stairs.length === 0 : l.stairs.length >= 1, 'stair count');
    // 她走得到每一座樓梯，玩家抵達點不在障礙物裡
    const col = new Collision(l);
    const nav = new NavGrid(l, GHOST_R, { ghost: true });
    for (const st of l.stairs) {
      const p = nav.findPath(l.spawn.x, l.spawn.z, st.use.x, st.use.z, 60000);
      assert(p && p.length, `ghost path to stairs ${st.id}`);
      assert(!col.overlapsAny(st.arrive.x, st.arrive.z, 0.3), `stairs ${st.id} arrival inside obstacle`);
    }
    for (const it of l.items) if (it.y <= 0.01) assert(!col.overlapsAny(it.x, it.z, 0.12), `item ${it.kind} inside obstacle`);
  }
  // 決定性
  if (s % 3 === 0) {
    const again = generateHospital(seed, diff, (l) => validateLevel(l), theme, count);
    assert(again.length === fl.length && again.every((l, i) => l.ascii() === fl[i].ascii() && l.theme === fl[i].theme && l.items.length === fl[i].items.length
      && l.items.every((it, k) => it.x === fl[i].items[k].x && it.z === fl[i].items[k].z) && l.stairs.every((st, k) => st.x === fl[i].stairs[k].x && st.to === fl[i].stairs[k].to)), 'multi-floor not deterministic');
  }
}
console.log(`hospitals: ${MF} (1-3 floors, ${mfLevels} floors), ${((Date.now() - mt0) / Math.max(1, mfLevels)).toFixed(1)} ms/floor`);
// ---------------------------------------------------------------------------
// 雙人鐵捲門（多人、開局 2 人以上）：整棟 1～2 道；關著的時候也不會擋住任何必要的東西（捷徑，或後面只有額外好東西的死路）；
// 把手不用開鎖、不用拉起鐵捲門就走得到；同一組種子＋人數生成同一棟醫院；開局 1 人（或單人）沒有鐵捲門
const MS = Math.max(6, Math.round(N / 6));
let shTotal = 0, shGated = 0, noShutter = 0;
for (let s = 1; s <= MS; s++) {
  const count = 1 + (s % 3);
  const diff = DIFFICULTY[['easy', 'normal', 'nightmare'][count - 1]];
  const theme = THEME_KEYS[s % THEME_KEYS.length];
  const seed = (s * 3266489917) >>> 0;
  const assert = (c, m) => { if (!c) { fails++; console.error('shutters', s, count, theme, m); } };
  let fl;
  try { fl = generateHospital(seed, diff, (l) => validateLevel(l), theme, count, { players: 2 + (s % 3) }); } catch (e) { fails++; console.error('shutters', s, 'FAILED:', e.message); continue; }
  const n = fl.reduce((a, l) => a + l.shutters.length, 0);
  shTotal += n;
  // 多人：電池等道具照人數多放（每個人的手電筒各自耗電）
  const np = 2 + (s % 3);
  const wantBat = Math.round(diff.batteries * (1 + 0.5 * (count - 1)) * (1 + COOP_ITEMS.batteries * (np - 1)));
  const gotBat = fl.reduce((a, l) => a + l.items.filter((i) => i.kind === 'battery' && !i.loot).length, 0);
  assert(gotBat === wantBat, `co-op battery count ${gotBat} != ${wantBat} for ${np} players`);
  // 鐵捲門是加分的機關：偶爾放不下（找不到夠長的繞路）可以接受，但不能太常發生
  assert(n <= 2, `at most 2 shutters per hospital (${n})`);
  if (n === 0) noShutter++;
  checkLocks(fl, assert);
  checkRelics(fl, assert);
  for (const l of fl) {
    assert(!validateLevel(l), 'floor valid with shutters: ' + validateLevel(l));
    const col = new Collision(l);
    for (const sh of l.shutters) {
      shGated += sh.gated ? 1 : 0;
      assert(l.cellAt(sh.x, sh.y) === 0 && !l.blockedCell[sh.y * l.W + sh.x], 'shutter sits in a corridor');
      assert(!col.overlapsAny(sh.crank.useX, sh.crank.useZ, 0.3), 'crank front is free');
      // 擋住鐵捲門那一格：沒被隔開的地方都走得到；隔開的死路裡沒有必要的東西
      l.blockedCell[sh.y * l.W + sh.x] = 1;
      const d = l.bfs(l.lobbyX, l.lobbyTop);
      l.blockedCell[sh.y * l.W + sh.x] = 0;
      for (let i = 0; i < l.W * l.H; i++) if (l.cells[i] >= 0 && !l.blockedCell[i] && d[i] < 0 && i !== sh.y * l.W + sh.x) assert(l.gatedCells.has(i), `cell ${i} cut off by a shutter`);
      const ci = (it) => Math.floor(it.z / CELL) * l.W + Math.floor(it.x / CELL);
      for (const it of l.items) if (['fuse', 'keycard', 'relic'].includes(it.kind)) assert(!l.gatedCells.has(ci(it)), `${it.kind} behind a shutter`);
      for (const rm of [l.generatorRoom, l.stairRoom, l.room707, ...l.locked].filter(Boolean)) assert(!rm.gated, `${rm.type} behind a shutter`);
      // 她的尋路網格：鐵捲門關著時過不去那一格（死路的話整塊走不到），拉起來之後走得過去
      const dnav = new NavGrid(l, GHOST_R, { ghost: true, dynamic: true });
      const a = sh.axis === 'x' ? { x: sh.cx - CELL * 0.45, z: sh.cz } : { x: sh.cx, z: sh.cz - CELL * 0.45 };
      const b = sh.axis === 'x' ? { x: sh.cx + CELL * 0.45, z: sh.cz } : { x: sh.cx, z: sh.cz + CELL * 0.45 };
      const lineThrough = (p) => !!p && p.length && (() => { let pr = a; for (const q of p) { const minX = Math.min(pr.x, q.x), maxX = Math.max(pr.x, q.x), minZ = Math.min(pr.z, q.z), maxZ = Math.max(pr.z, q.z); if (maxX >= sh.box.minX && minX <= sh.box.maxX && maxZ >= sh.box.minZ && minZ <= sh.box.maxZ) return true; pr = q; } return false; })();
      assert(dnav.isDynBlocked('s' + sh.id) && !dnav.isFree(sh.cx, sh.cz), 'closed shutter blocks her nav');
      const closedPath = dnav.findPath(a.x, a.z, b.x, b.z, 60000);
      assert(!lineThrough(closedPath), 'ghost path goes through a closed shutter');
      if (sh.gated) assert(!closedPath, 'gated dead end unreachable for her while closed');
      dnav.setBlock('s' + sh.id, null, false);
      assert(dnav.isFree(sh.cx, sh.cz) && dnav.findPath(a.x, a.z, b.x, b.z, 60000), 'open shutter lets her through');
    }
  }
  if (s % 3 === 0) {
    const again = generateHospital(seed, diff, (l) => validateLevel(l), theme, count, { players: 2 + (s % 3) });
    assert(again.every((l, i) => l.ascii() === fl[i].ascii() && l.shutters.length === fl[i].shutters.length && l.shutters.every((sh, k) => sh.x === fl[i].shutters[k].x && sh.y === fl[i].shutters[k].y)), 'shutters not deterministic');
    const solo = generateHospital(seed, diff, (l) => validateLevel(l), theme, count, { players: 1 });
    assert(solo.every((l) => l.shutters.length === 0), 'no shutters with one player');
  }
}
if (noShutter > Math.ceil(MS * 0.08)) { fails++; console.error(`too many hospitals without a shutter: ${noShutter}/${MS}`); }
console.log(`shutter hospitals: ${MS}, shutters ${shTotal} (${shGated} gating a dead end, ${noShutter} without any)`);
// 每一種樓層的劇情房間（707 病房、0713 冷藏室、嬰兒室、0713 隔離室、第 7 手術室、313 病房）都放得下搖籃
if (!onlyTheme && N >= 6) for (const k of THEME_KEYS) if (!altarThemes.has(k)) { fails++; console.error(`no altar generated for theme ${k}`); }
// 文件資料本身：id 不重複、每一份的類型都不一樣、主線是 0～6、挑選只看種子（重算一次要一樣）、每一份都會在某些種子出現
{
  const assert = (c, m) => { if (!c) { fails++; console.error('docs:', m); } };
  assert(new Set(DOCS.map((d) => d.id)).size === DOCS.length, 'doc ids unique');
  assert(new Set(DOCS.map((d) => d.type)).size === DOCS.length, 'every document has its own type');
  assert(DOCS.every((d) => DOC_TYPES[d.type] && DOC_LINES.some((l) => l.key === d.line) && d.title && docTree(d).k.length > 0), 'doc type / line / title / content');
  assert(MAIN_DOCS.join() === '0,1,2,3,4,5,6' && DOCS[LOBBY_DOC].place === 'lobby' && DOCS[GEN_DOC].place === 'gen', 'main line = 0..6 with anchors');
  const mixes = new Set();
  for (let s = 1; s <= 400; s++) {
    for (const c of [1, 2, 3]) {
      const a = pickDocs(s * 2654435761 >>> 0, c);
      assert(a.join() === pickDocs(s * 2654435761 >>> 0, c).join(), 'pickDocs deterministic');
      assert(new Set(a).size === a.length && a.every((n) => n >= 0 && n < DOCS.length), 'pickDocs valid');
      if (c === 1) { mixes.add(a.join()); for (const n of a) docSeen.set(n, (docSeen.get(n) || 0) + 1); }
    }
  }
  assert(mixes.size >= 8, 'single-floor runs get different side-line mixes: ' + mixes.size);
  assert(DOCS.every((d, i) => docSeen.get(i) > 0), 'every document appears in some run');
  assert(sanitizeCollection(['handover', 'nope', 'handover', 3, 'receipt']).join() === 'handover,receipt' && sanitizeCollection('x').length === 0, 'collection validation');
  console.log(`documents: ${DOCS.length} (${MAIN_DOCS.length} main), ${mixes.size} single-floor mixes`);
}
const dt = Date.now() - t0;
console.log(`levels: ${N}, failures: ${fails}, regenerated: ${retries}, avg ${(dt / N).toFixed(1)} ms/level`);
for (const [k, st] of Object.entries(stats)) {
  if (!st.n) continue;
  const f = (v) => (v / st.n).toFixed(1);
  console.log(`  ${k.padEnd(9)} n=${st.n} cells ${f(st.cells)} rooms ${f(st.rooms)} inner ${f(st.inner)} items ${f(st.items)} lockers ${f(st.lockers)} doors ${f(st.doors)} corpses ${f(st.corpses)} shapes ${JSON.stringify(st.shapes)}`);
  // 格局變化：種子夠多時，每個主題至少要出現四種外形 / 拓樸
  if (st.n >= 40 && Object.keys(st.shapes).length < 4) { fails++; console.error(`  ${k}: only ${Object.keys(st.shapes).length} layout shapes`); }
  console.log('            types', Object.entries(st.types).map(([t, n]) => `${t}:${f(n)}`).join(' '));
}
process.exit(fails ? 1 : 0);

// 關卡生成模糊測試：大量種子都必須產生合法、可通關的關卡（每個樓層主題輪流測，含手術部與燒毀的舊院區）
// 也檢查格局的變化：每個主題都要生出好幾種不同的走廊拓樸（棋盤格、環狀、天井、H 形、魚骨形……）
//   node tests/level.test.mjs [數量] [主題]
import { generateLevel, generateHospital, E, VOID, FURN } from '../src/level.js';
import { validateLevel, NavGrid, Collision, sightClear } from '../src/nav.js';
import { DIFFICULTY, GHOST_R, CELL } from '../src/config.js';
import { THEME_KEYS, THEMES, resolveTheme } from '../src/themes.js';

const N = Number(process.argv[2] || 300);
const onlyTheme = process.argv[3];
let fails = 0, retries = 0;
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
  assert(notes.length === 7, 'note count');
  assert(lv.items.filter((i) => i.kind === 'battery').length === diff.batteries, 'battery count');
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
  const notes = items.filter((i) => i.kind === 'note').map((i) => i.note).sort();
  assert(notes.join() === '0,1,2,3,4,5,6', 'notes 0..6 once each, got ' + notes.join());
  if (count === 1) assert(fl[0].items.filter((i) => i.kind === 'battery').length === diff.batteries, 'single floor batteries');
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

// 關卡生成模糊測試：大量種子都必須產生合法、可通關的關卡
import { generateLevel, E, VOID, FURN } from '../src/level.js';
import { validateLevel, NavGrid, Collision, sightClear } from '../src/nav.js';
import { DIFFICULTY, GHOST_R, CELL } from '../src/config.js';

const N = Number(process.argv[2] || 300);
let fails = 0, retries = 0;
const t0 = Date.now();
const stats = { rooms: 0, items: 0, lockers: 0, doors: 0 };
for (let s = 1; s <= N; s++) {
  const diff = DIFFICULTY[['easy', 'normal', 'nightmare'][s % 3]];
  let lv;
  try {
    lv = generateLevel(s * 2654435761 >>> 0, diff, (l) => validateLevel(l));
  } catch (e) {
    fails++;
    console.error('seed', s, 'FAILED:', e.message);
    continue;
  }
  if (lv.seed !== (s * 2654435761 >>> 0)) retries++;
  stats.rooms += lv.rooms.length; stats.items += lv.items.length; stats.lockers += lv.lockers.length; stats.doors += lv.doors.length;
  const fuses = lv.items.filter((i) => i.kind === 'fuse');
  const notes = lv.items.filter((i) => i.kind === 'note');
  const assert = (c, m) => { if (!c) { fails++; console.error('seed', s, m); } };
  assert(fuses.length === 3, 'fuse count');
  assert(notes.length === 7, 'note count');
  assert(lv.items.filter((i) => i.kind === 'battery').length === diff.batteries, 'battery count');
  assert(lv.fusebox, 'fusebox');
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
  // 置物櫃前方必須不在牆裡
  for (const l of lv.lockers) assert(!col.overlapsAny(l.exitX, l.exitZ, 0.25), `locker exit blocked ${l.id}`);
  // 大門在通電前不透視
  assert(!sightClear(lv, lv.gate.x, lv.gate.z - 1, lv.gate.x, lv.gate.z + 1), 'gate sight');
}
const dt = Date.now() - t0;
console.log(`levels: ${N}, failures: ${fails}, regenerated: ${retries}, avg ${(dt / N).toFixed(1)} ms/level`);
console.log('avg rooms', (stats.rooms / N).toFixed(1), 'items', (stats.items / N).toFixed(1), 'lockers', (stats.lockers / N).toFixed(1), 'doors', (stats.doors / N).toFixed(1));
process.exit(fails ? 1 : 0);

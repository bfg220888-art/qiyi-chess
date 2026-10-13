// 醫院樓層程序生成：走廊網格、房間、門、家具、道具、燈具、血跡。
// 這個模組不碰 DOM / three.js，可以在 Node 裡測試。
import { RNG } from './rng.js';
import { CELL, WALL_T, WALL_H, DOOR_W, DOOR_H, GATE_W, GATE_H } from './config.js';

export const E = { NONE: 0, WALL: 1, DOOR: 2, WINDOW: 3, OPEN: 4, GATE: 5 };
export const VOID = -1;
export const CORRIDOR = 0;
const HT = WALL_T / 2;

export const isWallish = (t) => t === E.WALL || t === E.DOOR || t === E.WINDOW || t === E.GATE;
export const isPassable = (t) => t === E.NONE || t === E.DOOR || t === E.OPEN;

// 家具尺寸：w = 沿牆寬度，d = 離牆深度，h = 高度；surf = 可放道具的檯面
export const FURN = {
  bed:        { w: 1.0, d: 2.1, h: 0.7,  surf: { y: 0.66, hx: 0.28, hz: 0.3, oz: 0.55 } },
  gurney:     { w: 2.0, d: 0.7, h: 0.9,  surf: { y: 0.93, hx: 0.6, hz: 0.16 } },
  locker:     { w: 0.62, d: 0.55, h: 1.95, tall: true },
  cabinet:    { w: 1.0, d: 0.45, h: 1.9, tall: true },
  shelf:      { w: 1.2, d: 0.45, h: 1.9, tall: true, surf: { y: 0.86, hx: 0.45, hz: 0.08 } },
  desk:       { w: 1.4, d: 0.7,  h: 0.76, surf: { y: 0.77, hx: 0.5, hz: 0.2 } },
  chair:      { w: 0.5, d: 0.5,  h: 0.9 },
  wheelchair: { w: 0.66, d: 1.0, h: 0.95 },
  ivstand:    { w: 0.45, d: 0.45, h: 1.9 },
  sink:       { w: 0.62, d: 0.48, h: 0.88 },
  counter:    { w: 2.4, d: 0.75, h: 1.05, surf: { y: 1.06, hx: 0.95, hz: 0.18 } },
  bench:      { w: 2.0, d: 0.6,  h: 0.85, surf: { y: 0.47, hx: 0.8, hz: 0.12 } },
  morgue:     { w: 2.6, d: 0.8,  h: 2.0, tall: true },
  optable:    { w: 0.8, d: 2.0,  h: 0.95, surf: { y: 0.97, hx: 0.2, hz: 0.4, oz: 0.4 } },
  trolley:    { w: 0.7, d: 0.45, h: 0.9, surf: { y: 0.91, hx: 0.25, hz: 0.12 } },
  boxes:      { w: 0.9, d: 0.6,  h: 0.65, surf: { y: 0.66, hx: 0.3, hz: 0.18 } },
  bin:        { w: 0.42, d: 0.42, h: 0.6 },
  plant:      { w: 0.55, d: 0.55, h: 1.3 },
  generator:  { w: 2.2, d: 1.1,  h: 1.5 },
  fusebox:    { w: 0.9, d: 0.22, h: 2.0, tall: true },
};

export const ROOM_NAMES = {
  ward: '病房', office: '醫師辦公室', storage: '儲藏室', utility: '工具間', operating: '手術室',
  morgue: '太平間', nurse: '護理站', generator: '發電機房', lobby: '大廳', corridor: '走廊',
};

export class Level {
  constructor(seed, W, H) {
    this.seed = seed;
    this.W = W;
    this.H = H;
    this.cells = new Int16Array(W * H).fill(VOID);
    this.blockedCell = new Uint8Array(W * H); // 走廊路障
    this.hEdges = new Uint8Array(W * (H + 1));
    this.vEdges = new Uint8Array((W + 1) * H);
    this.rooms = [];
    this.doors = [];
    this.doorByEdge = new Map();
    this.furniture = [];
    this.blockers = [];   // 家具擺放用（含門前淨空區）
    this.items = [];
    this.lockers = [];
    this.fixtures = [];
    this.emergency = [];
    this.exitSigns = [];
    this.decals = [];
    this.windows = [];
    this.barricades = [];
    this.signs = [];
    this.wallPieces = [];
  }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  cellAt(x, y) { return this.inBounds(x, y) ? this.cells[y * this.W + x] : VOID; }
  // 水平邊：位於格子 (x, y) 的上緣（介於 (x,y-1) 與 (x,y)），y ∈ [0, H]
  hEdge(x, y) { return (x < 0 || x >= this.W || y < 0 || y > this.H) ? E.NONE : this.hEdges[y * this.W + x]; }
  setH(x, y, t) { this.hEdges[y * this.W + x] = t; }
  // 垂直邊：位於格子 (x, y) 的左緣（介於 (x-1,y) 與 (x,y)），x ∈ [0, W]
  vEdge(x, y) { return (x < 0 || x > this.W || y < 0 || y >= this.H) ? E.NONE : this.vEdges[y * (this.W + 1) + x]; }
  setV(x, y, t) { this.vEdges[y * (this.W + 1) + x] = t; }
  doorAt(orient, x, y) { return this.doorByEdge.get(`${orient}${x},${y}`) || null; }
  cellOfWorld(wx, wz) { return [Math.floor(wx / CELL), Math.floor(wz / CELL)]; }
  roomAtWorld(wx, wz) {
    const [x, y] = this.cellOfWorld(wx, wz);
    const id = this.cellAt(x, y);
    return id >= 0 ? this.rooms[id] : null;
  }
  // 兩相鄰格子之間的邊類型
  edgeBetween(x, y, dx, dy) {
    if (dx === 1) return this.vEdge(x + 1, y);
    if (dx === -1) return this.vEdge(x, y);
    if (dy === 1) return this.hEdge(x, y + 1);
    return this.hEdge(x, y);
  }
  canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!this.inBounds(nx, ny)) return false;
    if (this.cellAt(nx, ny) === VOID || this.blockedCell[ny * this.W + nx]) return false;
    return isPassable(this.edgeBetween(x, y, dx, dy));
  }
  bfs(sx, sy) {
    const dist = new Int32Array(this.W * this.H).fill(-1);
    const q = [sx + sy * this.W];
    dist[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], x = c % this.W, y = (c / this.W) | 0;
      for (const [dx, dy] of DIRS) {
        if (!this.canStep(x, y, dx, dy)) continue;
        const n = (x + dx) + (y + dy) * this.W;
        if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
      }
    }
    return dist;
  }
  // 方便除錯：ASCII 地圖
  ascii() {
    const out = [];
    for (let y = 0; y <= this.H; y++) {
      let line = '';
      for (let x = 0; x < this.W; x++) {
        const t = this.hEdge(x, y);
        line += '+' + (t === E.WALL ? '--' : t === E.DOOR ? 'DD' : t === E.WINDOW ? '==' : t === E.GATE ? 'GG' : t === E.OPEN ? '..' : '  ');
      }
      out.push(line + '+');
      if (y === this.H) break;
      line = '';
      for (let x = 0; x <= this.W; x++) {
        const t = this.vEdge(x, y);
        line += t === E.WALL ? '|' : t === E.DOOR ? 'D' : t === E.WINDOW ? '‖' : t === E.OPEN ? '.' : ' ';
        if (x < this.W) {
          const id = this.cellAt(x, y);
          const r = id >= 0 ? this.rooms[id] : null;
          line += this.blockedCell[y * this.W + x] ? 'XX' : id === VOID ? '##' : id === 0 ? '  ' : (r.type[0].toUpperCase() + r.type[1]);
        }
      }
      out.push(line);
    }
    return out.join('\n');
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------------------------------------------------------------------------
// 文字內容
export const NOTES = [
  {
    title: '護理站交班紀錄',
    body: '1999 年 8 月 13 日　夜班\n\n又停電了。備用發電機需要三個保險絲才能啟動，但維修的老陳把它們拆下來，說要「藏好」。\n\n大門的電子鎖沒電就打不開。我們被困在裡面了。\n\n707 號床的病人又在哼歌。院長說不要理她。',
  },
  {
    title: '維修工老陳的紙條',
    body: '保險絲我分開藏在三個房間裡了。\n不要讓「她」拿到。\n\n發電機房在這層樓最裡面。三個保險絲都插回配電箱，大門的電子鎖就會重新通電打開。\n\n有電的地方她比較不敢靠近……我希望是這樣。',
  },
  {
    title: '警衛的筆記',
    body: '規則：\n一、聽到哼歌聲，代表她在附近閒晃。\n二、哼歌聲突然停了——快跑。\n三、跑不掉就躲進鐵櫃，千萬別讓她看到你躲進去。\n四、手電筒的光會讓她更容易發現你，不必要時關掉。\n五、不要在黑暗裡待太久，你會開始看見不存在的東西。',
  },
  {
    title: '主治醫師日誌',
    body: '第 41 次「治療」。\n\n電擊之後，患者 0713 對強光產生劇烈反應。相機的閃光燈會讓她僵住好幾秒，像是被釘在原地。\n\n護理師說半夜看見她站在走廊盡頭，可是那時候她明明被綁在床上。\n\n我開始不確定我們在治療的是什麼。',
  },
  {
    title: '病歷　編號 0713',
    body: '姓名：林○蓮　性別：女　年齡：27\n職業：本院七樓護理師\n入院原因：產後精神失常\n\n患者堅稱她的孩子還在醫院裡，每晚穿著護理服在走廊上「巡房」、尋找。\n拒絕進食。整夜哼著同一首搖籃曲。\n\n備註：嬰兒於入院當天死亡。患者未被告知。',
  },
  {
    title: '蠟筆畫',
    body: '（一張孩子的蠟筆畫。一個長頭髮的白衣女人牽著一個小孩。）\n\n背面歪歪扭扭地寫著：\n「媽媽一直在找我。\n　我在這裡呀。\n　為什麼她看不到我？」',
  },
  {
    title: '最後的錄音逐字稿',
    body: '……如果有人找到這個……\n\n她不是要傷害我們。她只是在找她的孩子。可是只要被她抓到的人，就再也沒有出來過。\n\n發電機一啟動，她會發狂。全部的燈都亮的那一刻，往大門跑，不要回頭。\n\n不要——（錄音中斷）',
  },
];

export const WALL_WRITINGS = ['救救我', '她在看你', '不要回頭', '707', '媽媽在哪裡', '快逃', '別出聲', '她聽得到'];

// ---------------------------------------------------------------------------
export function generateLevel(seed, diff, validator) {
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const lv = buildLevel((seed + attempt * 7919) >>> 0, diff);
      if (validator) {
        const problem = validator(lv);
        if (problem) { lastErr = new Error(problem); continue; }
      }
      lv.requestedSeed = seed;
      return lv;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('level generation failed');
}

function segmentLengths(rng, L) {
  const out = [];
  while (L > 0) {
    let s;
    if (L <= 3) s = L;
    else {
      s = rng.chance(0.3) ? 3 : 2;
      if (rng.chance(0.12)) s = 1;
      if (L - s === 1) s = s === 3 ? 2 : 3;
    }
    out.push(s);
    L -= s;
  }
  return rng.shuffle(out);
}

function buildLevel(seed, diff) {
  const rng = new RNG(seed);
  const M = 2;
  const bw = [rng.int(4, 5), rng.int(4, 5)];
  const bh = [rng.int(3, 4), rng.int(3, 4)];
  const c = [M, M + 1 + bw[0], M + 2 + bw[0] + bw[1]];
  const r = [M, M + 1 + bh[0], M + 2 + bh[0] + bh[1]];
  const W = c[2] + 1 + M, H = r[2] + 1 + M;
  const lv = new Level(seed, W, H);
  lv.corrCols = c;
  lv.corrRows = r;
  const idx = (x, y) => y * W + x;

  // --- 走廊
  lv.rooms.push({ id: 0, type: 'corridor', x0: 0, y0: 0, x1: W - 1, y1: H - 1, doors: [], area: 0 });
  for (const ry of r) for (let x = c[0]; x <= c[2]; x++) lv.cells[idx(x, ry)] = CORRIDOR;
  for (const cx of c) for (let y = r[0]; y <= r[2]; y++) lv.cells[idx(cx, y)] = CORRIDOR;

  const addRoom = (x0, y0, x1, y1, type = null) => {
    const room = { id: lv.rooms.length, type, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, doors: [] };
    room.area = room.w * room.h;
    room.cx = (x0 + x1 + 1) * CELL / 2;
    room.cz = (y0 + y1 + 1) * CELL / 2;
    lv.rooms.push(room);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) lv.cells[idx(x, y)] = room.id;
    return room;
  };
  const stripX = (xa, xb, y0, y1) => {
    let x = xa;
    for (const s of segmentLengths(rng, xb - xa + 1)) { addRoom(x, y0, x + s - 1, y1); x += s; }
  };
  const stripY = (ya, yb, x0, x1) => {
    let y = ya;
    for (const s of segmentLengths(rng, yb - ya + 1)) { addRoom(x0, y, x1, y + s - 1); y += s; }
  };

  // --- 大廳（下方中央）
  const lobby = addRoom(c[1] - 1, r[2] + 1, c[1] + 1, H - 1, 'lobby');
  lv.lobby = lobby;
  // --- 外圍房間帶
  stripX(c[0], c[2], 0, r[0] - 1);
  stripX(c[0], c[1] - 2, r[2] + 1, H - 1);
  stripX(c[1] + 2, c[2], r[2] + 1, H - 1);
  stripY(r[0], r[2], 0, c[0] - 1);
  stripY(r[0], r[2], c[2] + 1, W - 1);
  // --- 內部街區
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x0 = c[i] + 1, x1 = c[i + 1] - 1, y0 = r[j] + 1, y1 = r[j + 1] - 1;
      const d = y1 - y0 + 1;
      let x = x0;
      for (const s of segmentLengths(rng, x1 - x0 + 1)) {
        if (rng.chance(0.4)) addRoom(x, y0, x + s - 1, y1);
        else {
          const top = rng.chance(0.5) ? Math.floor(d / 2) : Math.ceil(d / 2);
          addRoom(x, y0, x + s - 1, y0 + top - 1);
          addRoom(x, y0 + top, x + s - 1, y1);
        }
        x += s;
      }
    }
  }

  // --- 預設牆
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) {
    const a = lv.cellAt(x, y - 1), b = lv.cellAt(x, y);
    lv.setH(x, y, a !== b ? E.WALL : E.NONE);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) {
    const a = lv.cellAt(x - 1, y), b = lv.cellAt(x, y);
    lv.setV(x, y, a !== b ? E.WALL : E.NONE);
  }

  // --- 大廳開口與大門
  lv.setH(c[1], r[2] + 1, E.OPEN);
  lv.setH(c[1], H, E.GATE);
  lv.gate = { x: (c[1] + 0.5) * CELL, z: H * CELL, open: false, angle: 0 };

  // --- 門
  const roomEdges = (room) => {
    const out = [];
    for (let x = room.x0; x <= room.x1; x++) {
      out.push({ o: 'h', x, y: room.y0, side: 'N', ox: x, oy: room.y0 - 1 });
      out.push({ o: 'h', x, y: room.y1 + 1, side: 'S', ox: x, oy: room.y1 + 1 });
    }
    for (let y = room.y0; y <= room.y1; y++) {
      out.push({ o: 'v', x: room.x0, y, side: 'W', ox: room.x0 - 1, oy: y });
      out.push({ o: 'v', x: room.x1 + 1, y, side: 'E', ox: room.x1 + 1, oy: y });
    }
    return out;
  };
  const edgeType = (e) => (e.o === 'h' ? lv.hEdge(e.x, e.y) : lv.vEdge(e.x, e.y));
  const setEdge = (e, t) => (e.o === 'h' ? lv.setH(e.x, e.y, t) : lv.setV(e.x, e.y, t));
  const addDoor = (e) => {
    if (edgeType(e) === E.DOOR) return;
    setEdge(e, E.DOOR);
    // 門開向「房間」那側（id 較大者通常是房間）
    let ax, ay, bx, by;
    if (e.o === 'h') { ax = e.x; ay = e.y - 1; bx = e.x; by = e.y; } else { ax = e.x - 1; ay = e.y; bx = e.x; by = e.y; }
    const ida = lv.cellAt(ax, ay), idb = lv.cellAt(bx, by);
    const swing = idb > 0 && (ida <= 0 || rng.chance(0.5)) ? 1 : -1; // +1 = 往 +z / +x 開
    const door = {
      id: lv.doors.length, o: e.o, x: e.x, y: e.y, swing,
      hingeSide: rng.chance(0.5) ? -1 : 1,
      rooms: [ida, idb], angle: 0, target: 0, locked: false,
    };
    lv.doors.push(door);
    lv.doorByEdge.set(`${e.o}${e.x},${e.y}`, door);
    if (ida > 0) lv.rooms[ida].doors.push(door.id);
    if (idb > 0) lv.rooms[idb].doors.push(door.id);
  };

  for (const room of lv.rooms) {
    if (room.id === 0 || room.type === 'lobby') continue;
    const edges = roomEdges(room).filter((e) => lv.cellAt(e.ox, e.oy) === CORRIDOR);
    if (!edges.length) throw new Error('room without corridor access');
    const first = rng.pick(edges);
    addDoor(first);
    if (room.area >= 4 && rng.chance(0.55)) {
      const other = edges.filter((e) => e.side !== first.side);
      if (other.length) addDoor(rng.pick(other));
    }
  }
  // 房間之間的門（製造繞圈逃跑路線）
  for (const room of lv.rooms) {
    if (room.id === 0 || room.type === 'lobby') continue;
    if (!rng.chance(0.22)) continue;
    const edges = roomEdges(room).filter((e) => {
      const o = lv.cellAt(e.ox, e.oy);
      return o > 0 && lv.rooms[o].type !== 'lobby' && edgeType(e) === E.WALL;
    });
    if (edges.length) addDoor(rng.pick(edges));
  }

  // --- 窗戶（朝外的牆）
  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    for (const e of roomEdges(room)) {
      if (lv.cellAt(e.ox, e.oy) !== VOID || edgeType(e) !== E.WALL) continue;
      if (room.type === 'lobby' ? rng.chance(0.5) : rng.chance(0.42)) setEdge(e, E.WINDOW);
    }
  }

  // --- 走廊路障
  const isIntersection = (x, y) => r.includes(y) && c.includes(x);
  const corridorCells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lv.cellAt(x, y) === CORRIDOR) corridorCells.push([x, y]);
  const nBarricades = rng.int(1, 2);
  for (const [x, y] of rng.shuffle(corridorCells.slice())) {
    if (lv.barricades.length >= nBarricades) break;
    if (isIntersection(x, y)) continue;
    if (Math.abs(x - c[1]) <= 1 && y >= r[2] - 1) continue; // 大廳附近不要擋
    let touchesDoor = false;
    for (const [dx, dy] of DIRS) {
      const t = lv.edgeBetween(x, y, dx, dy);
      if (t === E.DOOR || t === E.OPEN) touchesDoor = true;
    }
    if (touchesDoor) continue;
    lv.blockedCell[idx(x, y)] = 1;
    const dist = lv.bfs(c[1], r[2] + 1);
    let ok = true;
    for (let i = 0; i < W * H; i++) if (lv.cells[i] !== VOID && !lv.blockedCell[i] && dist[i] < 0) { ok = false; break; }
    if (!ok) { lv.blockedCell[idx(x, y)] = 0; continue; }
    const horizontal = r.includes(y);
    lv.barricades.push({ x, y, cx: (x + 0.5) * CELL, cz: (y + 0.5) * CELL, horizontal });
  }

  // --- 距離與房型
  const lobbyCellX = c[1], lobbyCellY = H - 1;
  const dist = lv.bfs(lobbyCellX, lobbyCellY);
  lv.distFromLobby = dist;
  for (let i = 0; i < W * H; i++) if (lv.cells[i] !== VOID && !lv.blockedCell[i] && dist[i] < 0) throw new Error('unreachable cell');
  const normal = lv.rooms.filter((rm) => rm.id > 0 && rm.type !== 'lobby');
  for (const rm of normal) {
    let best = 1e9;
    for (let y = rm.y0; y <= rm.y1; y++) for (let x = rm.x0; x <= rm.x1; x++) best = Math.min(best, dist[idx(x, y)]);
    rm.dist = best;
  }
  const byDist = normal.slice().sort((a, b) => b.dist - a.dist);
  const gen = byDist.find((rm) => rm.area >= 2 && rm.area <= 6) || byDist[0];
  gen.type = 'generator';
  lv.generatorRoom = gen;
  const nurse = normal.filter((rm) => !rm.type && rm.area >= 2 && rm.area <= 6).sort((a, b) => a.dist - b.dist)[0];
  if (nurse) nurse.type = 'nurse';
  const big = rng.shuffle(normal.filter((rm) => !rm.type && rm.area >= 4));
  if (big.length && rng.chance(0.9)) big.shift().type = 'operating';
  if (big.length && rng.chance(0.85)) big.shift().type = 'morgue';
  for (const rm of normal) {
    if (rm.type) continue;
    if (rm.area >= 4) rm.type = rng.weighted([['ward', 0.55], ['office', 0.25], ['storage', 0.2]]);
    else if (rm.area >= 2) rm.type = rng.weighted([['office', 0.32], ['storage', 0.26], ['ward', 0.26], ['utility', 0.16]]);
    else rm.type = rng.chance(0.55) ? 'storage' : 'utility';
  }
  // 病房編號
  let wardNo = 701;
  const wards = normal.filter((rm) => rm.type === 'ward').sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const rm of wards) { if (wardNo === 707) wardNo++; rm.label = `${wardNo++} 病房`; }
  if (wards.length) {
    const special = wards.reduce((a, b) => (b.dist > a.dist ? b : a));
    special.label = '707 病房';
    special.special = true;
    lv.room707 = special;
  }
  for (const rm of lv.rooms) if (!rm.label) rm.label = ROOM_NAMES[rm.type];

  // --- 保險絲房間：彼此分散
  const chosen = [];
  const anchors = [[lobby.cx, lobby.cz], [gen.cx, gen.cz]];
  const fuseCandidates = normal.filter((rm) => rm !== gen);
  for (let k = 0; k < 3; k++) {
    let best = null, bestScore = -1;
    for (const rm of fuseCandidates) {
      if (chosen.includes(rm)) continue;
      let m = 1e9;
      for (const [ax, az] of anchors) m = Math.min(m, Math.hypot(rm.cx - ax, rm.cz - az));
      const score = m * rng.range(0.75, 1.0);
      if (score > bestScore) { bestScore = score; best = rm; }
    }
    chosen.push(best);
    anchors.push([best.cx, best.cz]);
  }
  lv.fuseRooms = chosen;

  // --- 家具
  furnish(lv, rng);

  // --- 道具
  placeItems(lv, rng, diff || { batteries: 6, film: 3, pills: 3, bottles: 4 });

  // --- 燈具
  placeLights(lv, rng);

  // --- 血跡、字跡、紙張
  placeDecals(lv, rng);

  // --- 牆體幾何
  buildWallPieces(lv);

  // 出生點：大廳靠大門處，面向北方（-z）
  lv.spawn = { x: (c[1] + 0.5) * CELL, z: H * CELL - 1.3, yaw: 0 };
  return lv;
}

// ---------------------------------------------------------------------------
// 家具擺放
function roomBounds(room) {
  return {
    minX: room.x0 * CELL + HT, maxX: (room.x1 + 1) * CELL - HT,
    minZ: room.y0 * CELL + HT, maxZ: (room.y1 + 1) * CELL - HT,
  };
}
function cellBounds(x, y) {
  return { minX: x * CELL + HT, maxX: (x + 1) * CELL - HT, minZ: y * CELL + HT, maxZ: (y + 1) * CELL - HT };
}
const overlaps = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const inside = (a, b) => a.minX >= b.minX - 1e-6 && a.maxX <= b.maxX + 1e-6 && a.minZ >= b.minZ - 1e-6 && a.maxZ <= b.maxZ + 1e-6;

// 旋轉後矩形的外接 AABB
function footprint(x, z, rot, w, d) {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const hx = c * w / 2 + s * d / 2, hz = s * w / 2 + c * d / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

// 牆面插槽：每一段牆（一格長）都是可以靠牆擺家具的位置
function wallSlots(lv, room, cellsList) {
  const slots = [];
  const list = cellsList || [];
  if (!cellsList) for (let y = room.y0; y <= room.y1; y++) for (let x = room.x0; x <= room.x1; x++) list.push([x, y]);
  const me = room.id;
  for (const [x, y] of list) {
    const tests = [
      { side: 'N', t: lv.hEdge(x, y), o: lv.cellAt(x, y - 1), wall: y * CELL, a0: x * CELL, x, y },
      { side: 'S', t: lv.hEdge(x, y + 1), o: lv.cellAt(x, y + 1), wall: (y + 1) * CELL, a0: x * CELL, x, y },
      { side: 'W', t: lv.vEdge(x, y), o: lv.cellAt(x - 1, y), wall: x * CELL, a0: y * CELL, x, y },
      { side: 'E', t: lv.vEdge(x + 1, y), o: lv.cellAt(x + 1, y), wall: (x + 1) * CELL, a0: y * CELL, x, y },
    ];
    for (const s of tests) {
      if (s.o === me) continue;
      if (s.t !== E.WALL && s.t !== E.WINDOW) continue;
      s.window = s.t === E.WINDOW;
      s.a1 = s.a0 + CELL;
      slots.push(s);
    }
  }
  return slots;
}

function slotPose(slot, along, f, gap = 0.02) {
  const off = HT + f.d / 2 + gap;
  switch (slot.side) {
    case 'N': return { x: along, z: slot.wall + off, rot: 0 };
    case 'S': return { x: along, z: slot.wall - off, rot: Math.PI };
    case 'W': return { x: slot.wall + off, z: along, rot: Math.PI / 2 };
    default:  return { x: slot.wall - off, z: along, rot: -Math.PI / 2 };
  }
}

function frontVec(rot) { return [Math.sin(rot), Math.cos(rot)]; }

// 檢查房間在多擺一件家具後，是否仍然整個走得到（不會被床或櫃子隔成死角）
function roomStaysConnected(lv, room, extra) {
  if (!room || room.id === 0) return true;
  const b = roomBounds(room);
  const res = 0.25, r = 0.34;
  const nx = Math.ceil((b.maxX - b.minX) / res), nz = Math.ceil((b.maxZ - b.minZ) / res);
  const blocked = new Uint8Array(nx * nz);
  const boxes = lv.furniture.filter((f) => f.room === room.id).map((f) => f.box);
  if (extra) boxes.push(extra);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = b.minX + (i + 0.5) * res, z = b.minZ + (j + 0.5) * res;
    if (x < b.minX + r || x > b.maxX - r || z < b.minZ + r || z > b.maxZ - r) { blocked[j * nx + i] = 1; continue; }
    for (const q of boxes) {
      const cx = Math.max(q.minX, Math.min(x, q.maxX)), cz = Math.max(q.minZ, Math.min(z, q.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { blocked[j * nx + i] = 1; break; }
    }
  }
  // 種子：門口內側
  const seeds = [];
  const entries = [];
  for (const id of room.doors) {
    const d = lv.doors[id];
    const along = (d.o === 'h' ? d.x : d.y) * CELL + CELL / 2;
    const plane = (d.o === 'h' ? d.y : d.x) * CELL;
    for (const s of [-0.6, 0.6]) entries.push(d.o === 'h' ? [along, plane + s] : [plane + s, along]);
  }
  if (room.type === 'lobby') {
    entries.push([(lv.corrCols[1] + 0.5) * CELL, (lv.corrRows[2] + 1) * CELL + 0.6]);
    entries.push([lv.gate.x, lv.gate.z - 0.8]);
  }
  for (const [x, z] of entries) {
    const i = Math.floor((x - b.minX) / res), j = Math.floor((z - b.minZ) / res);
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    if (blocked[j * nx + i]) return false; // 門口被堵住
    seeds.push(j * nx + i);
  }
  if (!seeds.length) return true;
  const seen = new Uint8Array(nx * nz);
  const q = seeds.slice();
  for (const k of q) seen[k] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], i = k % nx, j = (k / nx) | 0;
    if (i > 0 && !seen[k - 1] && !blocked[k - 1]) { seen[k - 1] = 1; q.push(k - 1); }
    if (i < nx - 1 && !seen[k + 1] && !blocked[k + 1]) { seen[k + 1] = 1; q.push(k + 1); }
    if (j > 0 && !seen[k - nx] && !blocked[k - nx]) { seen[k - nx] = 1; q.push(k - nx); }
    if (j < nz - 1 && !seen[k + nx] && !blocked[k + nx]) { seen[k + nx] = 1; q.push(k + nx); }
  }
  let lost = 0;
  for (let k = 0; k < nx * nz; k++) if (!blocked[k] && !seen[k]) lost++;
  return lost * res * res < 0.6; // 允許極小的死角
}

class Placer {
  constructor(lv, rng) { this.lv = lv; this.rng = rng; }
  free(box, margin = 0.03) {
    for (const b of this.lv.blockers) if (overlaps(box, b, margin)) return false;
    return true;
  }
  add(kind, room, pose, extra = {}) {
    const f = FURN[kind];
    const box = footprint(pose.x, pose.z, pose.rot, f.w, f.d);
    const item = { kind, room: room ? room.id : 0, x: pose.x, z: pose.z, rot: pose.rot, w: f.w, d: f.d, h: f.h, box, ...extra };
    this.lv.furniture.push(item);
    this.lv.blockers.push(box);
    return item;
  }
  againstWall(kind, room, opts = {}) {
    const f = FURN[kind];
    const slots = this.rng.shuffle((opts.slots || wallSlots(this.lv, room)).slice());
    const bounds = opts.bounds || roomBounds(room);
    for (const slot of slots) {
      if (slot.window && (f.tall || opts.noWindow)) continue;
      if (opts.sides && !opts.sides.includes(slot.side)) continue;
      const lo = slot.a0 + HT + f.w / 2 + 0.05, hi = slot.a1 - HT - f.w / 2 - 0.05;
      if (hi < lo) continue;
      for (let t = 0; t < 4; t++) {
        const along = opts.center ? (lo + hi) / 2 : this.rng.range(lo, hi);
        const pose = slotPose(slot, along, f, opts.gap ?? 0.02);
        const box = footprint(pose.x, pose.z, pose.rot, f.w, f.d);
        if (!inside(box, bounds) || !this.free(box)) continue;
        if (!roomStaysConnected(this.lv, room, box)) continue;
        let clear = null;
        if (opts.clearance) {
          const [fx, fz] = frontVec(pose.rot);
          const cd = opts.clearance;
          const cx = pose.x + fx * (f.d / 2 + cd / 2), cz = pose.z + fz * (f.d / 2 + cd / 2);
          clear = footprint(cx, cz, pose.rot, f.w + 0.2, cd);
          if (!this.free(clear)) continue;
        }
        const item = this.add(kind, room, pose, { side: slot.side, slot });
        if (clear) this.lv.blockers.push(clear);
        return item;
      }
    }
    return null;
  }
  freeStanding(kind, room, opts = {}) {
    const f = FURN[kind];
    const b = opts.bounds || roomBounds(room);
    for (let t = 0; t < 14; t++) {
      const m = Math.max(f.w, f.d) / 2 + (opts.margin ?? 0.5);
      if (b.maxX - b.minX < 2 * m || b.maxZ - b.minZ < 2 * m) return null;
      const pose = {
        x: opts.center ? (b.minX + b.maxX) / 2 : this.rng.range(b.minX + m, b.maxX - m),
        z: opts.center ? (b.minZ + b.maxZ) / 2 : this.rng.range(b.minZ + m, b.maxZ - m),
        rot: opts.rot ?? this.rng.range(-Math.PI, Math.PI),
      };
      if (opts.axisAligned) pose.rot = this.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + this.rng.range(-0.08, 0.08);
      const box = footprint(pose.x, pose.z, pose.rot, f.w, f.d);
      if (!inside(box, b) || !this.free(box)) continue;
      if (!roomStaysConnected(this.lv, room, box)) continue;
      return this.add(kind, room, pose, opts.extra || {});
    }
    return null;
  }
}

function doorClearance(lv) {
  for (const d of lv.doors) {
    const along0 = (d.o === 'h' ? d.x : d.y) * CELL + CELL / 2;
    const plane = (d.o === 'h' ? d.y : d.x) * CELL;
    const half = DOOR_W / 2 + 0.35, depth = 1.45;
    if (d.o === 'h') lv.blockers.push({ minX: along0 - half, maxX: along0 + half, minZ: plane - depth, maxZ: plane + depth, clearance: true });
    else lv.blockers.push({ minX: plane - depth, maxX: plane + depth, minZ: along0 - half, maxZ: along0 + half, clearance: true });
  }
  // 大廳開口與大門
  const { c, r } = { c: lv.corrCols, r: lv.corrRows };
  const ox = (c[1] + 0.5) * CELL;
  lv.blockers.push({ minX: ox - 1.6, maxX: ox + 1.6, minZ: (r[2] + 1) * CELL - 1.6, maxZ: (r[2] + 1) * CELL + 1.6, clearance: true });
  lv.blockers.push({ minX: ox - 1.9, maxX: ox + 1.9, minZ: lv.H * CELL - 2.4, maxZ: lv.H * CELL, clearance: true });
  // 大廳中央通道保持淨空（最後逃跑的路線）
  lv.blockers.push({ minX: ox - 1.0, maxX: ox + 1.0, minZ: (r[2] + 1) * CELL, maxZ: lv.H * CELL, clearance: true });
  // 路障
  for (const b of lv.barricades) lv.blockers.push({ ...cellBounds(b.x, b.y), clearance: true });
}

function furnish(lv, rng) {
  const P = new Placer(lv, rng);
  doorClearance(lv);
  const lockerCount = { n: 0 };
  const addLocker = (room, opts = {}) => {
    const it = P.againstWall('locker', room, { clearance: 1.0, ...opts });
    if (it) {
      const [fx, fz] = frontVec(it.rot);
      it.lockerId = lv.lockers.length;
      lv.lockers.push({
        id: it.lockerId, furn: it, x: it.x, z: it.z, rot: it.rot,
        exitX: it.x + fx * 0.95, exitZ: it.z + fz * 0.95,
        insideX: it.x - fx * 0.02, insideZ: it.z - fz * 0.02, open: 0, target: 0,
      });
      lockerCount.n++;
    }
    return it;
  };

  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    const t = room.type;
    const bounds = roomBounds(room);
    switch (t) {
      case 'lobby': {
        P.againstWall('counter', room, { sides: ['E', 'W'], clearance: 0.9 });
        for (let i = 0; i < 3; i++) P.againstWall('bench', room, { noWindow: false });
        P.againstWall('plant', room);
        P.againstWall('plant', room);
        P.freeStanding('wheelchair', room, { margin: 0.6 });
        lv.signs.push({ kind: 'tv', room: room.id });
        break;
      }
      case 'generator': {
        const g = P.againstWall('generator', room, { center: true, gap: 0.15 });
        const fb = P.againstWall('fusebox', room, { clearance: 1.2, noWindow: true });
        if (!fb) throw new Error('no fusebox slot');
        lv.fusebox = fb;
        P.againstWall('shelf', room);
        if (rng.chance(0.6)) P.againstWall('boxes', room);
        if (g) lv.generator = g;
        break;
      }
      case 'ward': {
        if (rng.chance(0.45)) addLocker(room);
        const nBeds = Math.min(6, Math.max(1, Math.round(room.area * rng.range(0.8, 1.3))));
        for (let i = 0; i < nBeds; i++) {
          const bed = P.againstWall('bed', room, { gap: 0.04 });
          if (!bed) break;
          bed.variant = rng.int(0, 3);
          if (rng.chance(0.55)) {
            // 點滴架放在床頭旁
            const [fx, fz] = frontVec(bed.rot);
            const sx = fz, sz = -fx; // 側向
            const side = rng.chance(0.5) ? 1 : -1;
            const px = bed.x - fx * 0.75 + sx * side * 0.78, pz = bed.z - fz * 0.75 + sz * side * 0.78;
            const box = footprint(px, pz, 0, 0.45, 0.45);
            if (inside(box, bounds) && P.free(box) && roomStaysConnected(lv, room, box)) P.add('ivstand', room, { x: px, z: pz, rot: rng.range(0, 6) });
          }
          if (rng.chance(0.4)) {
            const [fx, fz] = frontVec(bed.rot);
            const sx = fz, sz = -fx;
            const side = rng.chance(0.5) ? 1 : -1;
            lv.decals.push({ kind: 'curtain', x: bed.x + sx * side * 0.68, z: bed.z + fz * 0.1, rot: bed.rot, len: 2.0 });
          }
        }
        if (rng.chance(0.6)) P.againstWall('cabinet', room);
        if (rng.chance(0.5)) P.freeStanding('chair', room, { margin: 0.4 });
        if (rng.chance(0.3)) P.freeStanding('wheelchair', room, { margin: 0.5 });
        break;
      }
      case 'office': {
        if (rng.chance(0.35)) addLocker(room);
        const nd = room.area >= 4 ? 2 : 1;
        for (let i = 0; i < nd; i++) {
          const desk = P.againstWall('desk', room, { clearance: 0.8, noWindow: false });
          if (desk) {
            const [fx, fz] = frontVec(desk.rot);
            // 椅子放在桌子前方（淨空區裡，椅子本身很小）
            const cbox = footprint(desk.x + fx * 0.62, desk.z + fz * 0.62, 0, 0.46, 0.46);
            if (roomStaysConnected(lv, room, cbox)) lv.furniture.push({ kind: 'chair', room: room.id, x: desk.x + fx * 0.62, z: desk.z + fz * 0.62, rot: desk.rot + Math.PI + rng.range(-0.5, 0.5), w: 0.5, d: 0.5, h: 0.9, box: cbox });
          }
        }
        P.againstWall('cabinet', room);
        if (rng.chance(0.6)) P.againstWall('shelf', room);
        if (rng.chance(0.5)) P.againstWall('boxes', room);
        if (rng.chance(0.5)) P.againstWall('bin', room);
        break;
      }
      case 'storage': {
        if (rng.chance(0.5)) addLocker(room);
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) P.againstWall('shelf', room);
        for (let i = 0; i < 2; i++) P.againstWall('boxes', room);
        if (rng.chance(0.5)) P.againstWall('cabinet', room);
        break;
      }
      case 'utility': {
        if (rng.chance(0.3)) addLocker(room);
        P.againstWall('sink', room, { noWindow: false });
        if (rng.chance(0.5)) P.againstWall('sink', room);
        P.againstWall('shelf', room);
        P.againstWall('bin', room);
        if (rng.chance(0.6)) P.againstWall('boxes', room);
        break;
      }
      case 'operating': {
        const tbl = P.freeStanding('optable', room, { center: true, axisAligned: true, margin: 0.6 });
        if (tbl) lv.decals.push({ kind: 'surgicalLamp', x: tbl.x, z: tbl.z, rot: tbl.rot });
        P.againstWall('trolley', room);
        P.againstWall('trolley', room);
        P.againstWall('cabinet', room);
        if (rng.chance(0.6)) P.againstWall('sink', room);
        if (rng.chance(0.4)) addLocker(room);
        break;
      }
      case 'morgue': {
        P.againstWall('morgue', room);
        if (rng.chance(0.7)) P.againstWall('morgue', room);
        const g = P.againstWall('gurney', room, { noWindow: false, gap: 0.25 });
        if (g) g.body = true;
        if (rng.chance(0.6)) { const g2 = P.freeStanding('gurney', room, { margin: 0.5 }); if (g2) g2.body = rng.chance(0.7); }
        P.againstWall('sink', room);
        break;
      }
      case 'nurse': {
        const ct = P.againstWall('counter', room, { clearance: 0.9 });
        if (ct) lv.phone = { x: ct.x, z: ct.z, rot: ct.rot, y: FURN.counter.surf.y };
        P.againstWall('cabinet', room);
        P.againstWall('shelf', room);
        P.freeStanding('chair', room, { margin: 0.4 });
        if (rng.chance(0.4)) addLocker(room);
        break;
      }
    }
  }

  // --- 走廊：置物櫃、推床、輪椅、長椅、垃圾桶
  const corridor = lv.rooms[0];
  const corrCells = [];
  for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
    if (lv.cellAt(x, y) === CORRIDOR && !lv.blockedCell[y * lv.W + x]) corrCells.push([x, y]);
  }
  const used = new Set();
  const lockerSpots = [];
  const wantLockers = Math.max(6, 10 - lockerCount.n);
  for (const [x, y] of rng.shuffle(corrCells.slice())) {
    if (lockerSpots.length >= wantLockers) break;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
    if (lockerSpots.some(([px, pz]) => Math.hypot(px - cx, pz - cz) < 9)) continue;
    const slots = wallSlots(lv, corridor, [[x, y]]);
    if (!slots.length) continue;
    const it = addLocker(corridor, { slots, bounds: cellBounds(x, y) });
    if (it) { lockerSpots.push([cx, cz]); used.add(x + ',' + y); }
  }
  for (const [x, y] of rng.shuffle(corrCells.slice())) {
    if (used.has(x + ',' + y) || !rng.chance(0.33)) continue;
    const slots = wallSlots(lv, corridor, [[x, y]]);
    if (!slots.length) continue;
    const kind = rng.weighted([['gurney', 3], ['wheelchair', 2], ['bench', 1.5], ['bin', 1.5], ['chair', 1.5], ['boxes', 1]]);
    const it = P.againstWall(kind, corridor, { slots, bounds: cellBounds(x, y), gap: kind === 'gurney' ? 0.1 : 0.03 });
    if (it) {
      used.add(x + ',' + y);
      if (kind === 'gurney' && rng.chance(0.35)) it.body = true;
      if (kind === 'wheelchair' || kind === 'chair') it.rot += rng.range(-0.6, 0.6);
    }
  }
  // 有些輪椅會在事件中被推動
  lv.movable = rng.shuffle(lv.furniture.filter((f) => f.kind === 'wheelchair')).slice(0, 2);
}

// ---------------------------------------------------------------------------
function surfacePoint(rng, f) {
  const s = FURN[f.kind].surf;
  if (!s) return null;
  const lx = rng.range(-s.hx, s.hx), lz = rng.range(-s.hz, s.hz) + (s.oz || 0);
  const cs = Math.cos(f.rot), sn = Math.sin(f.rot);
  // three.js 的 rotation.y：world = (x cos + z sin, -x sin + z cos)
  return { x: f.x + lx * cs + lz * sn, y: s.y, z: f.z - lx * sn + lz * cs };
}

function floorPoint(lv, rng, bounds, margin = 0.45) {
  for (let t = 0; t < 30; t++) {
    const x = rng.range(bounds.minX + margin, bounds.maxX - margin);
    const z = rng.range(bounds.minZ + margin, bounds.maxZ - margin);
    const box = { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 };
    let ok = true;
    for (const b of lv.blockers) if (overlaps(box, b)) { ok = false; break; }
    for (const f of lv.furniture) if (overlaps(box, f.box, 0.1)) { ok = false; break; }
    if (ok) return { x, y: 0, z };
  }
  return null;
}

function placeItems(lv, rng, diff) {
  const usedRooms = new Map();
  const spotInRoom = (room, preferSurface = true) => {
    const furn = lv.furniture.filter((f) => f.room === room.id && FURN[f.kind].surf && f.kind !== 'locker');
    if (preferSurface && furn.length && rng.chance(0.75)) {
      const p = surfacePoint(rng, rng.pick(furn));
      if (p) return p;
    }
    return floorPoint(lv, rng, roomBounds(room)) || (furn.length ? surfacePoint(rng, rng.pick(furn)) : null);
  };
  const spotInCorridor = () => {
    for (let t = 0; t < 40; t++) {
      const x = rng.int(0, lv.W - 1), y = rng.int(0, lv.H - 1);
      if (lv.cellAt(x, y) !== CORRIDOR || lv.blockedCell[y * lv.W + x]) continue;
      const p = floorPoint(lv, rng, cellBounds(x, y), 0.35);
      if (p) return p;
    }
    return null;
  };
  const add = (kind, pick, extra = {}) => {
    // pick 是產生候選位置的函式；避免兩個道具疊在一起
    let p = null;
    for (let t = 0; t < 12 && !p; t++) {
      const c = pick();
      if (!c) continue;
      if (lv.items.some((it) => Math.hypot(it.x - c.x, it.z - c.z) < 0.4 && Math.abs(it.y - c.y) < 0.3)) continue;
      p = c;
    }
    if (!p) throw new Error('no spot for ' + kind);
    const item = { id: lv.items.length, kind, x: p.x, y: p.y, z: p.z, rot: rng.range(0, Math.PI * 2), taken: false, ...extra };
    lv.items.push(item);
    return item;
  };

  for (const room of lv.fuseRooms) add('fuse', () => spotInRoom(room), { room: room.id });

  // 筆記
  const lobby = lv.lobby;
  const counter = lv.furniture.find((f) => f.room === lobby.id && f.kind === 'counter');
  add('note', () => (counter ? surfacePoint(rng, counter) : spotInRoom(lobby)), { note: 0 });
  const others = lv.rooms.filter((rm) => rm.id > 0 && rm.type !== 'lobby');
  const nurse = lv.rooms.find((rm) => rm.type === 'nurse');
  const nurseRoom = nurse || rng.pick(others);
  add('note', () => spotInRoom(nurseRoom), { note: 1 });
  const fallback = rng.pick(others);
  add('note', () => spotInCorridor() || spotInRoom(fallback), { note: 2 });
  const office = rng.shuffle(others.filter((rm) => rm.type === 'office' || rm.type === 'operating'))[0] || rng.pick(others);
  add('note', () => spotInRoom(office), { note: 3 });
  const r707 = lv.room707 || rng.pick(others);
  add('note', () => spotInRoom(r707), { note: 4 });
  add('note', () => spotInRoom(r707), { note: 5 });
  add('note', () => spotInRoom(lv.generatorRoom), { note: 6 });

  const scatter = (kind, n) => {
    const pool = rng.shuffle(others.slice());
    for (let i = 0; i < n; i++) {
      let room = pool[i % pool.length];
      if (rng.chance(0.25)) { add(kind, () => spotInCorridor() || spotInRoom(room)); continue; }
      for (let k = 0; k < pool.length && (usedRooms.get(room.id) || 0) >= 1; k++) room = pool[(i + k) % pool.length];
      usedRooms.set(room.id, (usedRooms.get(room.id) || 0) + 1);
      add(kind, () => spotInRoom(room));
    }
  };
  scatter('battery', diff.batteries);
  scatter('bottle', diff.bottles ?? 4);
  scatter('film', diff.film);
  scatter('pills', diff.pills);
}

// ---------------------------------------------------------------------------
function placeLights(lv, rng) {
  const stageOf = () => rng.weighted([[1, 0.17], [2, 0.17], [3, 0.2], [0, 0.46]]); // 0 = 壞掉
  const { c, r } = { c: lv.corrCols, r: lv.corrRows };
  for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
    const id = lv.cellAt(x, y);
    if (id === VOID || lv.blockedCell[y * lv.W + x]) continue;
    const room = lv.rooms[id];
    let place = false;
    if (id === CORRIDOR) place = (x + y) % 2 === 0;
    else if (room.area <= 2) place = x === room.x0 && y === room.y0;
    else place = (x - room.x0) % 2 === 0 && (y - room.y0) % 2 === 0;
    if (!place) continue;
    let fx = (x + 0.5) * CELL, fz = (y + 0.5) * CELL;
    if (id !== CORRIDOR && room.area <= 2) { fx = room.cx; fz = room.cz; }
    let stage = stageOf();
    if (room.type === 'generator') stage = 1;
    if (room.type === 'lobby') stage = 3;
    if (room.type === 'nurse' && stage === 0) stage = 2;
    const mode = stage === 0 ? 'broken' : rng.chance(0.35) ? 'flicker' : 'steady';
    lv.fixtures.push({ x: fx, z: fz, y: WALL_H - 0.04, room: id, stage, mode, rot: id === CORRIDOR ? (r.includes(y) && !c.includes(x) ? 0 : Math.PI / 2) : 0, phase: rng.range(0, 100), on: false, level: 0 });
  }
  // 緊急照明（紅色，一直亮著）
  const inter = [];
  for (const y of r) for (const x of c) inter.push([x, y]);
  for (const [x, y] of rng.shuffle(inter).slice(0, 5)) {
    lv.emergency.push({ x: (x + 0.5) * CELL + rng.range(-0.8, 0.8), y: WALL_H - 0.25, z: (y + 0.5) * CELL + rng.range(-0.8, 0.8), phase: rng.range(0, 10) });
  }
  // 出口標示
  lv.exitSigns.push({ x: (c[1] + 0.5) * CELL, y: DOOR_H + 0.35, z: (r[2] + 1) * CELL - HT - 0.05, rot: Math.PI });
  lv.exitSigns.push({ x: (c[1] + 0.5) * CELL, y: GATE_H + 0.25, z: lv.H * CELL - HT - 0.05, rot: Math.PI });
}

// ---------------------------------------------------------------------------
function placeDecals(lv, rng) {
  // 地板血跡
  const floorCells = [];
  for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) if (lv.cellAt(x, y) !== VOID && !lv.blockedCell[y * lv.W + x]) floorCells.push([x, y]);
  const nBlood = Math.round(floorCells.length * 0.12);
  for (let i = 0; i < nBlood; i++) {
    const [x, y] = rng.pick(floorCells);
    lv.decals.push({ kind: 'blood', x: (x + rng.range(0.15, 0.85)) * CELL, z: (y + rng.range(0.15, 0.85)) * CELL, rot: rng.range(0, 6.28), size: rng.range(0.5, 1.4), variant: rng.int(0, 3) });
  }
  // 拖行血痕
  for (let i = 0; i < 3; i++) {
    const [x, y] = rng.pick(floorCells);
    lv.decals.push({ kind: 'drag', x: (x + 0.5) * CELL, z: (y + 0.5) * CELL, rot: rng.pick([0, Math.PI / 2]) + rng.range(-0.3, 0.3), size: rng.range(2.0, 2.8) });
  }
  // 紙張
  const nPaper = Math.round(floorCells.length * 0.35);
  for (let i = 0; i < nPaper; i++) {
    const [x, y] = rng.pick(floorCells);
    lv.decals.push({ kind: 'paper', x: (x + rng.range(0.1, 0.9)) * CELL, z: (y + rng.range(0.1, 0.9)) * CELL, rot: rng.range(0, 6.28), size: rng.range(0.22, 0.32), variant: rng.int(0, 3) });
  }
  // 牆上字跡與手印
  const allSlots = [];
  for (const room of lv.rooms) {
    if (room.id === 0) {
      const list = [];
      for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) if (lv.cellAt(x, y) === CORRIDOR && !lv.blockedCell[y * lv.W + x]) list.push([x, y]);
      for (const s of wallSlots(lv, room, list)) allSlots.push(s);
    } else for (const s of wallSlots(lv, room)) allSlots.push(s);
  }
  const wallSlotsClean = allSlots.filter((s) => !s.window);
  rng.shuffle(wallSlotsClean);
  const words = rng.shuffle(WALL_WRITINGS.slice());
  let wi = 0;
  for (const s of wallSlotsClean) {
    if (wi >= 5) break;
    const along = s.a0 + CELL / 2 + rng.range(-0.4, 0.4);
    if (!wallDecalFree(lv, s, along, 1.2)) continue;
    lv.decals.push({ kind: 'writing', text: words[wi++ % words.length], ...wallDecalPose(s, along, rng.range(1.35, 1.75)), size: rng.range(1.3, 1.8) });
  }
  let hp = 0;
  for (const s of wallSlotsClean.slice(5)) {
    if (hp >= 7) break;
    const along = s.a0 + rng.range(0.6, CELL - 0.6);
    if (!wallDecalFree(lv, s, along, 0.4)) continue;
    lv.decals.push({ kind: 'hand', ...wallDecalPose(s, along, rng.range(0.9, 1.6)), size: rng.range(0.22, 0.28), rotZ: rng.range(-0.6, 0.6), variant: rng.int(0, 1) });
    hp++;
  }
  // 天花板滲水流下的水痕、牆上抹開的血（照片貼花；沒有照片素材時不畫）。
  // 用另一個亂數來源，不影響後面關卡生成的結果
  const r2 = new RNG((lv.seed ^ 0x1eaf5) >>> 0);
  let leaks = 0, smears = 0;
  for (const s of r2.shuffle(wallSlotsClean.slice())) {
    if (leaks >= 18 && smears >= 7) break;
    const leak = leaks < 18 && (smears >= 7 || r2.chance(0.72));
    const w = leak ? r2.range(0.45, 0.8) : r2.range(0.8, 1.3);
    const along = s.a0 + r2.range(w / 2 + 0.15, CELL - w / 2 - 0.15);
    if (leak) {
      const h = Math.min(2.6, w * 4);
      lv.decals.push({ kind: 'leak', ...wallDecalPose(s, along, WALL_H - h / 2 - 0.02), w, h, flip: r2.chance(0.5) });
      leaks++;
    } else {
      if (!wallDecalFree(lv, s, along, w)) continue;
      lv.decals.push({ kind: 'smear', ...wallDecalPose(s, along, r2.range(0.7, 1.45)), w, h: w * 0.2, rotZ: r2.range(-0.2, 0.2), band: r2.int(0, 3) });
      smears++;
    }
  }
  // 房門上方的門牌
  for (const d of lv.doors) {
    const ids = d.rooms.filter((id) => id > 0);
    for (const id of ids) {
      const room = lv.rooms[id];
      // 門牌掛在走廊那一側（若兩側都是房間，就掛在其中一側）
      const otherId = d.rooms[0] === id ? d.rooms[1] : d.rooms[0];
      if (otherId > 0 && id !== ids[0]) continue;
      const along = (d.o === 'h' ? d.x : d.y) * CELL + CELL / 2;
      const plane = (d.o === 'h' ? d.y : d.x) * CELL;
      // 房間在哪一側？
      const roomSide = d.rooms[1] === id ? 1 : -1;  // +1 表示房間在 +z/+x 側
      const off = -roomSide * (HT + 0.012);
      const rot = d.o === 'h' ? (roomSide > 0 ? Math.PI : 0) : (roomSide > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (d.o === 'h') lv.signs.push({ kind: 'roomSign', text: room.label, x: along, y: DOOR_H + 0.32, z: plane + off, rot });
      else lv.signs.push({ kind: 'roomSign', text: room.label, x: plane + off, y: DOOR_H + 0.32, z: along, rot });
    }
  }
}

function wallDecalFree(lv, s, along, width) {
  const p = wallDecalPose(s, along, 1.2);
  const box = { minX: p.x - width / 2 - 0.3, maxX: p.x + width / 2 + 0.3, minZ: p.z - width / 2 - 0.3, maxZ: p.z + width / 2 + 0.3 };
  for (const f of lv.furniture) if (FURN[f.kind].tall && overlaps(box, f.box)) return false;
  return true;
}

function wallDecalPose(s, along, y) {
  const off = HT + 0.012;
  switch (s.side) {
    case 'N': return { x: along, y, z: s.wall + off, rot: 0 };
    case 'S': return { x: along, y, z: s.wall - off, rot: Math.PI };
    case 'W': return { x: s.wall + off, y, z: along, rot: Math.PI / 2 };
    default:  return { x: s.wall - off, y, z: along, rot: -Math.PI / 2 };
  }
}

// ---------------------------------------------------------------------------
// 牆體幾何：每一段牆是一個盒子（不含頂/底面），牆角補柱子
function buildWallPieces(lv) {
  const P = lv.wallPieces;
  const piece = (minX, maxX, minY, maxY, minZ, maxZ, extra = {}) => {
    if (maxX - minX < 1e-4 || maxZ - minZ < 1e-4 || maxY - minY < 1e-4) return;
    P.push({ minX, maxX, minY, maxY, minZ, maxZ, ...extra });
  };
  const openingPieces = (o, a0, a1, plane, w, h, kind) => {
    const m = (a0 + a1) / 2;
    if (o === 'h') {
      piece(a0 + HT, m - w / 2, 0, WALL_H, plane - HT, plane + HT, { jamb: kind });
      piece(m + w / 2, a1 - HT, 0, WALL_H, plane - HT, plane + HT, { jamb: kind });
      piece(m - w / 2, m + w / 2, h, WALL_H, plane - HT, plane + HT, { lintel: true });
    } else {
      piece(plane - HT, plane + HT, 0, WALL_H, a0 + HT, m - w / 2, { jamb: kind });
      piece(plane - HT, plane + HT, 0, WALL_H, m + w / 2, a1 - HT, { jamb: kind });
      piece(plane - HT, plane + HT, h, WALL_H, m - w / 2, m + w / 2, { lintel: true });
    }
  };
  for (let y = 0; y <= lv.H; y++) for (let x = 0; x < lv.W; x++) {
    const t = lv.hEdge(x, y);
    if (!isWallish(t)) continue;
    const a0 = x * CELL, a1 = a0 + CELL, z = y * CELL;
    if (t === E.WALL || t === E.WINDOW) {
      piece(a0 + HT, a1 - HT, 0, WALL_H, z - HT, z + HT, { window: t === E.WINDOW, o: 'h', ex: x, ey: y });
      if (t === E.WINDOW) lv.windows.push(windowFor(lv, 'h', x, y));
    } else if (t === E.DOOR) openingPieces('h', a0, a1, z, DOOR_W, DOOR_H, 'door');
    else if (t === E.GATE) openingPieces('h', a0, a1, z, GATE_W, GATE_H, 'gate');
  }
  for (let y = 0; y < lv.H; y++) for (let x = 0; x <= lv.W; x++) {
    const t = lv.vEdge(x, y);
    if (!isWallish(t)) continue;
    const a0 = y * CELL, a1 = a0 + CELL, px = x * CELL;
    if (t === E.WALL || t === E.WINDOW) {
      piece(px - HT, px + HT, 0, WALL_H, a0 + HT, a1 - HT, { window: t === E.WINDOW, o: 'v', ex: x, ey: y });
      if (t === E.WINDOW) lv.windows.push(windowFor(lv, 'v', x, y));
    } else if (t === E.DOOR) openingPieces('v', a0, a1, px, DOOR_W, DOOR_H, 'door');
    else if (t === E.GATE) openingPieces('v', a0, a1, px, GATE_W, GATE_H, 'gate');
  }
  // 柱子
  for (let vy = 0; vy <= lv.H; vy++) for (let vx = 0; vx <= lv.W; vx++) {
    const any = isWallish(lv.hEdge(vx - 1, vy)) || isWallish(lv.hEdge(vx, vy)) || isWallish(lv.vEdge(vx, vy - 1)) || isWallish(lv.vEdge(vx, vy));
    if (!any) continue;
    piece(vx * CELL - HT, vx * CELL + HT, 0, WALL_H, vy * CELL - HT, vy * CELL + HT, { post: true });
  }
}

function windowFor(lv, o, x, y) {
  // 窗戶面向房間內側
  if (o === 'h') {
    const inside = lv.cellAt(x, y) !== VOID ? 1 : -1; // 房間在 +z 側？
    return { o, x: (x + 0.5) * CELL, z: y * CELL + inside * (HT + 0.004), rot: inside > 0 ? 0 : Math.PI };
  }
  const inside = lv.cellAt(x, y) !== VOID ? 1 : -1;
  return { o, x: x * CELL + inside * (HT + 0.004), z: (y + 0.5) * CELL, rot: inside > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

export { roomBounds, cellBounds, overlaps, footprint, frontVec };

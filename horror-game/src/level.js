// 醫院樓層程序生成：走廊網格、房間、門、家具、道具、燈具、血跡。
// 這個模組不碰 DOM / three.js，可以在 Node 裡測試。
import { RNG } from './rng.js';
import { CORPSE_POSES, corpseShift } from './corpse-poses.js';
import { CELL, WALL_T, WALL_H, DOOR_W, DOOR_H, GATE_W, GATE_H } from './config.js';
import { THEMES, THEME_KEYS, resolveTheme } from './themes.js';

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
  // 地下太平間
  drawers:    { w: 2.6, d: 0.8,  h: 2.05, tall: true },   // 一整面冷藏櫃（3 × 3 個抽屜）
  tray:       { w: 0.66, d: 1.0, h: 1.12 },              // 拉出來的冷藏抽屜（長邊垂直於櫃子）
  autopsy:    { w: 0.9, d: 2.2,  h: 0.98 },
  bagrail:    { w: 2.2, d: 0.7,  h: 2.4, tall: true },    // 天花板吊軌與吊著的屍袋
  bodybag:    { w: 0.66, d: 1.95, h: 0.32 },
  // 兒童病房
  crib:       { w: 0.78, d: 1.36, h: 1.05 },
  kidbed:     { w: 0.86, d: 1.7,  h: 0.75, surf: { y: 0.52, hx: 0.22, hz: 0.2, oz: 0.45 } },
  bassinet:   { w: 0.56, d: 0.9,  h: 0.95 },
  rockinghorse: { w: 0.44, d: 1.06, h: 0.95 },
  kidtable:   { w: 0.96, d: 0.96, h: 0.52, surf: { y: 0.53, hx: 0.3, hz: 0.3 } },
  kidchair:   { w: 0.36, d: 0.36, h: 0.62 },
  // 精神科
  ectchair:   { w: 0.74, d: 0.92, h: 1.38 },
  ectmachine: { w: 0.64, d: 0.5,  h: 1.15 },
  table:      { w: 1.3, d: 0.86,  h: 0.75, surf: { y: 0.76, hx: 0.5, hz: 0.25 } },
  // 樓梯（多層樓）：上樓是一段往天花板爬的階梯，下樓是地上一個圍著欄杆往下的樓梯口
  stairs:     { w: 1.5, d: 2.6,  h: 3.0, tall: true },
  // 手術部
  anesthesia: { w: 0.72, d: 0.62, h: 1.55, surf: { y: 0.93, hx: 0.22, hz: 0.1, oz: 0.1 } }, // 麻醉機
  monitor:    { w: 0.5,  d: 0.5,  h: 1.65 },             // 推車上的生理監視器
  scrubsink:  { w: 2.1,  d: 0.66, h: 1.15 },             // 刷手槽（一長排、膝控水龍頭）
  autoclave:  { w: 1.1,  d: 0.85, h: 1.7, tall: true },  // 高壓蒸氣滅菌鍋
  // 燒毀的舊院區
  rubble:     { w: 1.5,  d: 1.3,  h: 0.8 },              // 塌下來的天花板、水泥塊與燒焦的木樑
  beam:       { w: 2.3,  d: 0.55, h: 1.5 },              // 斜靠在牆上的斷樑
};

export const ROOM_NAMES = {
  ward: '病房', office: '醫師辦公室', storage: '儲藏室', utility: '工具間', operating: '手術室',
  morgue: '太平間', nurse: '護理站', generator: '發電機房', lobby: '大廳', corridor: '走廊',
  autopsy: '解剖室', coldstore: '屍袋冷藏室', kidward: '兒童病房', nursery: '嬰兒室', playroom: '遊戲室',
  cell: '隔離室', therapy: '電療室', dayroom: '交誼廳', landing: '樓梯間', stairs: '樓梯間',
  icu: '加護病房', recovery: '恢復室', scrub: '刷手間', sterile: '無菌器械室', collapsed: '坍塌病房',
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
// theme：主題 key（'ward' / 'morgue' / 'pediatric' / 'psych'），或 'random' / 不給 = 由 seed 決定。
// 主題在重試之前就決定好（不受 validator 重試影響），結果存在 lv.theme。
// plan：多層樓時這一層的配置（planHospital 產生）；不給 = 單層樓（大廳、發電機房、全部的道具都在這一層）。
export function generateLevel(seed, diff, validator, theme, plan = null) {
  const themeKey = resolveTheme(theme, seed >>> 0);
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const lv = buildLevel((seed + attempt * 7919) >>> 0, diff, themeKey, plan);
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

// ---------------------------------------------------------------------------
// 多層樓的醫院：決定每一層的主題、上下順序、樓梯怎麼接、發電機房 / 保險絲 / 紙條 / 道具放哪一層。
// 只用 seed（與主題、層數、難度）決定，多人連線時每個人都會算出一樣的結果。
// 第 0 層是有大廳與大門的那一層（玩家的起點）；其他樓層的大廳位置換成樓梯間。
export const MAX_FLOORS = 3;
const ITEM_KINDS = [['batteries', 6], ['bottles', 4], ['film', 3], ['pills', 3]];
export function planHospital(seed, theme, count = 1, diff = null) {
  count = Math.max(1, Math.min(MAX_FLOORS, Math.floor(Number(count)) || 1));
  const t0 = resolveTheme(theme, seed >>> 0);
  const all = [0, 1, 2, 3, 4, 5, 6];
  if (count === 1) return [{ index: 0, count: 1, theme: t0, level: THEMES[t0].level, ord: 0, entry: 'lobby', generator: true, fuses: 3, notes: all, stairs: [], counts: null }];
  const rng = new RNG((seed ^ 0x3c6ef372) >>> 0);
  const keys = [t0, ...rng.shuffle(THEME_KEYS.filter((k) => k !== t0)).slice(0, count - 1)];
  // 上下順序：照主題的樓層編號由低到高
  const order = keys.map((k, i) => i).sort((a, b) => THEMES[keys[a]].level - THEMES[keys[b]].level);
  const ord = [];
  order.forEach((fi, p) => { ord[fi] = p; });
  const floors = keys.map((k, i) => ({
    index: i, count, theme: k, level: THEMES[k].level, ord: ord[i], entry: i === 0 ? 'lobby' : 'landing',
    generator: false, fuses: 0, notes: [], stairs: [], counts: {},
  }));
  for (let p = 0; p + 1 < count; p++) {
    const a = order[p], b = order[p + 1];
    floors[a].stairs.push({ dir: 'up', to: b, label: THEMES[keys[b]].floor });
    floors[b].stairs.push({ dir: 'down', to: a, label: THEMES[keys[a]].floor });
  }
  // 發電機房：離大門那一層最遠（要爬最多段樓梯）的樓層
  const hops = (i) => Math.abs(ord[i] - ord[0]);
  const far = Math.max(...floors.slice(1).map((f) => hops(f.index)));
  const gen = rng.pick(floors.filter((f) => f.index > 0 && hops(f.index) === far));
  gen.generator = true;
  // 保險絲：每一層至少一個
  if (count === 2) { floors[0].fuses = rng.int(1, 2); floors[1].fuses = 3 - floors[0].fuses; }
  else for (const f of floors) f.fuses = 1;
  // 紙條：交班紀錄在大廳、錄音逐字稿在發電機房，其他的分散到每一層
  floors[0].notes.push(0);
  gen.notes.push(6);
  rng.shuffle([1, 2, 3, 4, 5]).forEach((n, k) => floors[k % count].notes.push(n));
  for (const f of floors) f.notes.sort((a, b) => a - b);
  // 電池、瓶子、底片、鎮定劑：總量比單層多一半左右，平均分到每一層
  for (const [kind, def] of ITEM_KINDS) {
    const base = diff && Number.isFinite(diff[kind]) ? diff[kind] : def;
    const total = Math.round(base * (1 + 0.5 * (count - 1)));
    for (const f of floors) f.counts[kind] = Math.floor(total / count) + (f.index < total % count ? 1 : 0);
  }
  return floors;
}

// 每一層各自生成（各自重試直到通過驗證）；回傳樓層陣列，index 0 是有大門的那一層
export function floorSeed(seed, i) { return i ? (seed ^ Math.imul(i, 0x85ebca6b)) >>> 0 : seed >>> 0; }
export function generateHospital(seed, diff, validator, theme, count = 1) {
  const plan = planHospital(seed >>> 0, theme, count, diff);
  return plan.map((p) => {
    const lv = generateLevel(floorSeed(seed >>> 0, p.index), diff, validator, p.theme, plan.length > 1 ? p : null);
    lv.floorIndex = p.index;
    lv.plan = p;
    lv.requestedSeed = seed;
    return lv;
  });
}

function segmentLengths(rng, L, pref = { p3: 0.3, p1: 0.12 }) {
  const out = [];
  while (L > 0) {
    let s;
    if (L <= 3) s = L >= 2 && rng.chance(pref.p1 * 0.5) ? 1 : L;
    else {
      s = rng.chance(pref.p3) ? 3 : 2;
      if (rng.chance(pref.p1)) s = 1;
      if (L - s === 1 && s !== 1) s = s === 3 ? 2 : 3;
    }
    out.push(s);
    L -= s;
  }
  return rng.shuffle(out);
}

// ---------------------------------------------------------------------------
// 走廊拓樸：在 nC × nR 條走廊格線上決定哪幾段走廊存在。
// hs[j][i] = 第 j 列橫走廊在第 i、i+1 條直走廊之間那一段；vs[i][j] = 第 i 條直走廊在第 j、j+1 列之間那一段。
// lobbyK = 大廳接的那一條直走廊（-1 = 只有兩欄，大廳在最下面一排走廊的中間）
function corridorPlan(rng, LY, nC, nR, lobbyK) {
  let topo = rng.weighted(LY.topo || [['grid', 1]]);
  if ((topo === 'ring' || topo === 'atrium') && nC < 3 && nR < 3) topo = 'grid';
  if (topo === 'H' && (nC < 3 || nR < 3)) topo = 'spine';
  const hs = Array.from({ length: nR }, () => new Array(nC - 1).fill(true));
  const vs = Array.from({ length: nC }, () => new Array(nR - 1).fill(true));
  const bottomK = lobbyK >= 0 ? lobbyK : 0;
  if (topo === 'ring' || topo === 'atrium') {
    // 只留最外圈；環狀走廊有時候往中央街區伸出一小段死路
    for (let j = 1; j < nR - 1; j++) hs[j].fill(false);
    for (let i = 1; i < nC - 1; i++) vs[i].fill(false);
    if (topo === 'ring' && rng.chance(0.6)) {
      if (nC >= 3 && (nR < 3 || rng.chance(0.5))) vs[rng.int(1, nC - 2)][rng.chance(0.5) ? 0 : nR - 2] = true;
      else if (nR >= 3) hs[rng.int(1, nR - 2)][rng.chance(0.5) ? 0 : nC - 2] = true;
    }
  } else if (topo === 'H') {
    // 左右兩條直走廊＋中間一條橫走廊，再從橫走廊往下接到大廳；有時候也往上長出一段死路
    const jm = rng.int(1, nR - 2);
    for (let j = 0; j < nR; j++) hs[j].fill(j === jm);
    for (let i = 1; i < nC - 1; i++) vs[i].fill(false);
    for (let j = jm; j < nR - 1; j++) vs[lobbyK][j] = true;
    if (rng.chance(0.5)) {
      const i = rng.int(1, nC - 2), top = rng.int(0, jm - 1);
      for (let j = top; j < jm; j++) vs[i][j] = true;
    }
  } else if (topo === 'spine') {
    // 一條橫向主走廊（常常靠在一側），兩旁長出長短不一的側翼，很多死路
    const js = lobbyK < 0 ? nR - 1 : rng.int(0, nR - 1);
    for (let j = 0; j < nR; j++) hs[j].fill(j === js);
    for (let i = 0; i < nC; i++) {
      vs[i].fill(false);
      const side = i === 0 || i === nC - 1;
      // 往上
      if (js > 0 && rng.chance(side ? 0.75 : 0.6)) {
        const end = rng.chance(0.6) ? 0 : rng.int(0, js - 1);
        for (let j = end; j < js; j++) vs[i][j] = true;
      }
      // 往下（大廳那一條一定要通到最下面）
      if (js < nR - 1 && (i === lobbyK || rng.chance(side ? 0.75 : 0.6))) {
        const end = i === lobbyK || rng.chance(0.6) ? nR - 1 : rng.int(js + 1, nR - 1);
        for (let j = js; j < end; j++) vs[i][j] = true;
      }
    }
  } else if (topo === 'broken') {
    // 完整棋盤格拆掉三到四成的走廊段：街區合併成大小不一的形狀，路口變成死路
    const segs = [];
    for (let j = 0; j < nR; j++) for (let i = 0; i < nC - 1; i++) segs.push(['h', j, i]);
    for (let i = 0; i < nC; i++) for (let j = 0; j < nR - 1; j++) segs.push(['v', i, j]);
    const want = Math.round(segs.length * rng.range(0.25, 0.42));
    const get = ([o, a, b]) => (o === 'h' ? hs[a][b] : vs[a][b]);
    const put = ([o, a, b], v) => { if (o === 'h') hs[a][b] = v; else vs[a][b] = v; };
    const connected = () => {
      // 路口圖：每個有走廊接到的路口都要從大廳那個路口走得到
      const id = (i, j) => j * nC + i, seen = new Uint8Array(nC * nR), deg = new Uint8Array(nC * nR);
      const nb = (i, j) => {
        const out = [];
        if (i > 0 && hs[j][i - 1]) out.push([i - 1, j]);
        if (i < nC - 1 && hs[j][i]) out.push([i + 1, j]);
        if (j > 0 && vs[i][j - 1]) out.push([i, j - 1]);
        if (j < nR - 1 && vs[i][j]) out.push([i, j + 1]);
        return out;
      };
      for (let j = 0; j < nR; j++) for (let i = 0; i < nC; i++) deg[id(i, j)] = nb(i, j).length;
      const q = [[bottomK, nR - 1]];
      seen[id(bottomK, nR - 1)] = 1;
      for (let k = 0; k < q.length; k++) for (const [i, j] of nb(...q[k])) if (!seen[id(i, j)]) { seen[id(i, j)] = 1; q.push([i, j]); }
      for (let k = 0; k < nC * nR; k++) if (deg[k] && !seen[k]) return false;
      return deg[id(bottomK, nR - 1)] > 0;
    };
    let removed = 0;
    for (const s of rng.shuffle(segs)) {
      if (removed >= want) break;
      // 大廳上方那一段不拆
      if (lobbyK >= 0 && s[0] === 'v' && s[1] === lobbyK && s[2] === nR - 2) continue;
      if (lobbyK < 0 && s[0] === 'h' && s[1] === nR - 1) continue;
      put(s, false);
      if (connected()) removed++;
      else put(s, true);
    }
  }
  return { topo, hs, vs };
}

// 把非棋盤格樓層剩下的空地切成房間：先把空地拆成矩形，再遞迴二分。
// 盡量讓切出來的兩半都貼著走廊；切不到走廊的房間就變成「內室」，之後從隔壁房間開門進去。
function fillRooms(lv, rng, LY, eligible, addRoom) {
  const { W, H } = lv;
  const taken = new Uint8Array(W * H);
  const ok = (x, y) => lv.inBounds(x, y) && !taken[y * W + x] && eligible(x, y);
  const isCorr = (x, y) => lv.cellAt(x, y) === CORRIDOR;
  const maxSide = LY.roomMax || 4;
  const contact = (x0, y0, x1, y1) => {
    let n = 0;
    for (let x = x0; x <= x1; x++) { if (isCorr(x, y0 - 1)) n++; if (isCorr(x, y1 + 1)) n++; }
    for (let y = y0; y <= y1; y++) { if (isCorr(x0 - 1, y)) n++; if (isCorr(x1 + 1, y)) n++; }
    return n;
  };
  const split = (x0, y0, x1, y1) => {
    const w = x1 - x0 + 1, h = y1 - y0 + 1, area = w * h;
    const here = contact(x0, y0, x1, y1);
    // 整塊一間大廳室
    if (here > 0 && area >= 6 && area <= LY.hallMax && w <= 6 && h <= 6 && rng.chance(LY.hall * 0.7)) { addRoom(x0, y0, x1, y1); return; }
    let best = null;
    const consider = (A, B, along) => {
      const ca = contact(...A) > 0, cb = contact(...B) > 0;
      const tA = Math.min(A[2] - A[0], A[3] - A[1]) + 1, tB = Math.min(B[2] - B[0], B[3] - B[1]) + 1;
      const aA = (A[2] - A[0] + 1) * (A[3] - A[1] + 1), aB = (B[2] - B[0] + 1) * (B[3] - B[1] + 1);
      let s = (ca ? 2 : 0) + (cb ? 2 : 0) + rng.next() * 1.4;
      if (tA === 1 || tB === 1) s -= rng.chance(LY.seg.p1 * 2) ? 0 : 1.3;
      s -= Math.abs(Math.log(aA / aB)) * 0.25;
      if (along === (w >= h ? 'v' : 'h')) s += 0.6; // 切長邊
      if (!best || s > best.s) best = { s, A, B, both: ca && cb };
    };
    for (let k = 1; k < w; k++) consider([x0, y0, x0 + k - 1, y1], [x0 + k, y0, x1, y1], 'v');
    for (let k = 1; k < h; k++) consider([x0, y0, x1, y0 + k - 1], [x0, y0 + k, x1, y1], 'h');
    if (!best) { addRoom(x0, y0, x1, y1); return; }
    if (w <= maxSide && h <= maxSide && area <= 12) {
      // 已經夠小：通常就停在這裡（大小不一）；再切會切出走不到走廊的內室時更傾向不切
      const stop = area <= 2 ? 0.95 : area <= 4 ? 0.7 : area <= 6 ? 0.5 : 0.3;
      if (rng.chance(!best.both && here > 0 ? Math.max(stop, 0.85) : stop)) { addRoom(x0, y0, x1, y1); return; }
    }
    split(...best.A);
    split(...best.B);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!ok(x, y)) continue;
    let x1 = x;
    while (ok(x1 + 1, y)) x1++;
    let y1 = y;
    for (;;) {
      let full = true;
      for (let xx = x; xx <= x1; xx++) if (!ok(xx, y1 + 1)) { full = false; break; }
      if (!full) break;
      y1++;
    }
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) taken[yy * W + xx] = 1;
    split(x, y, x1, y1);
  }
}

function buildLevel(seed, diff, themeKey = 'ward', plan = null) {
  const T = THEMES[themeKey], LY = T.layout;
  // 單層樓：大廳、大門、發電機房、三個保險絲、七張紙條都在這一層
  const P0 = plan || { entry: 'lobby', generator: true, fuses: 3, notes: [0, 1, 2, 3, 4, 5, 6], stairs: [], counts: null };
  const isLobby = P0.entry !== 'landing';
  const rng = new RNG(seed);
  const M = LY.margin;
  // --- 走廊格線：欄 / 列數、寬度（寬走廊 = 2 格）與街區大小都依主題變化
  const nC = rng.int(LY.cols[0], LY.cols[1]), nR = rng.int(LY.rows[0], LY.rows[1]);
  const colW = new Array(nC).fill(1), rowW = new Array(nR).fill(1);
  if (rng.chance(LY.wideRow)) rowW[rng.int(0, nR - 1)] = 2;
  if (rng.chance(LY.wideCol)) colW[rng.int(0, nC - 1)] = 2;
  const c = [M], r = [M];
  for (let i = 0; i < nC - 1; i++) c.push(c[i] + colW[i] + rng.int(LY.blockW[0], LY.blockW[1]));
  for (let j = 0; j < nR - 1; j++) r.push(r[j] + rowW[j] + rng.int(LY.blockH[0], LY.blockH[1]));
  const cEnd = c[nC - 1] + colW[nC - 1] - 1, rEnd = r[nR - 1] + rowW[nR - 1] - 1;
  const W = cEnd + 1 + M, H = rEnd + 1 + M;
  const lv = new Level(seed, W, H);
  lv.theme = themeKey;
  lv.corrCols = c;
  lv.corrRows = r;
  lv.colW = colW;
  lv.rowW = rowW;
  const colOf = new Int8Array(W).fill(-1), rowOf = new Int8Array(H).fill(-1);
  c.forEach((x, i) => { for (let k = 0; k < colW[i]; k++) colOf[x + k] = i; });
  r.forEach((y, j) => { for (let k = 0; k < rowW[j]; k++) rowOf[y + k] = j; });
  lv.colOf = colOf;
  lv.rowOf = rowOf;
  const idx = (x, y) => y * W + x;

  // --- 大廳接在哪一條直走廊（先決定：每一種走廊拓樸都要保證那裡通到最下面一排）
  const lobbyK = nC >= 3 ? (nC === 3 ? 1 : rng.int(1, nC - 2)) : -1;
  const lobbyX = lobbyK >= 0 ? c[lobbyK] + (colW[lobbyK] === 2 ? rng.int(0, 1) : 0) : Math.round((c[0] + cEnd) / 2);

  // --- 走廊拓樸：棋盤格 / 拆掉一部分的棋盤格 / 環狀 / 天井 / H 形 / 魚骨形（見 themes.js）
  const cplan = corridorPlan(rng, LY, nC, nR, lobbyK);
  const { hs, vs } = cplan;
  lv.topo = cplan.topo;

  // --- 外形：L 形缺角或 U 形中庭（整塊挖空，牆外就是夜空）；天井 = 建築正中間挖空
  const hole = new Uint8Array(W * H);
  const dig = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) hole[idx(x, y)] = 1;
  };
  lv.shape = cplan.topo === 'grid' ? 'rect' : cplan.topo;
  if (cplan.topo === 'atrium') {
    // 中央大街區四周留一圈房間（每一邊 0～3 格；0 格 = 走廊直接面對天井的窗）
    const ix0 = c[0] + colW[0], ix1 = c[nC - 1] - 1, iy0 = r[0] + rowW[0], iy1 = r[nR - 1] - 1;
    const band = () => rng.weighted([[0, 0.2], [2, 0.55], [3, 0.25]]);
    let bl = band(), br = band(), bt = band(), bb = band();
    while (ix1 - br - (ix0 + bl) + 1 < 2 && (bl || br)) { if (bl >= br) bl = Math.max(0, bl - 1); else br = Math.max(0, br - 1); }
    while (iy1 - bb - (iy0 + bt) + 1 < 2 && (bt || bb)) { if (bt >= bb) bt = Math.max(0, bt - 1); else bb = Math.max(0, bb - 1); }
    // 天井旁邊只剩一格寬的房間帶太窄，乾脆不要
    if (bl === 1) bl = 0; if (br === 1) br = 0; if (bt === 1) bt = 0; if (bb === 1) bb = 0;
    if (ix1 - br - (ix0 + bl) + 1 >= 2 && iy1 - bb - (iy0 + bt) + 1 >= 2) {
      dig(ix0 + bl, iy0 + bt, ix1 - br, iy1 - bb);
      lv.atrium = { x0: ix0 + bl, y0: iy0 + bt, x1: ix1 - br, y1: iy1 - bb };
    } else lv.shape = 'ring';
  }
  if (nC >= 3 && cplan.topo === 'grid') {
    const u = rng.next();
    if (u < LY.notch) {
      lv.shape = 'notch';
      if (rng.chance(0.5)) {
        dig(c[nC - 2] + colW[nC - 2], 0, W - 1, r[0] + rowW[0] - 1);
        dig(c[nC - 1], 0, W - 1, r[1] - 1);
      } else {
        dig(0, 0, c[1] - 1, r[0] + rowW[0] - 1);
        dig(0, 0, c[0] + colW[0] - 1, r[1] - 1);
      }
    } else if (u < LY.notch + LY.courtyard) {
      lv.shape = 'courtyard';
      const i = nC === 3 ? rng.int(0, 1) : rng.int(1, nC - 3);
      dig(c[i] + colW[i], 0, c[i + 1] - 1, r[1] - 1);
    }
  }

  // --- 走廊
  lv.rooms.push({ id: 0, type: 'corridor', x0: 0, y0: 0, x1: W - 1, y1: H - 1, doors: [], area: 0 });
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!hole[idx(x, y)]) lv.cells[idx(x, y)] = CORRIDOR;
  };
  // 每一段走廊連同兩端的路口一起畫
  for (let j = 0; j < nR; j++) for (let i = 0; i < nC - 1; i++) if (hs[j][i]) paint(c[i], r[j], c[i + 1] + colW[i + 1] - 1, r[j] + rowW[j] - 1);
  for (let i = 0; i < nC; i++) for (let j = 0; j < nR - 1; j++) if (vs[i][j]) paint(c[i], r[j], c[i] + colW[i] - 1, r[j + 1] + rowW[j + 1] - 1);
  // 只有兩欄的樓層：大廳在兩條直走廊中間，最下面一排走廊一定要有
  if (lobbyK < 0) paint(c[0], rEnd, cEnd, rEnd);
  const isCorr = (x, y) => lv.cellAt(x, y) === CORRIDOR;
  if (!isCorr(lobbyX, rEnd)) throw new Error('lobby not on a corridor');
  // --- 死路支線：從外圈走廊往外伸到外牆
  const spurCands = [];
  for (let x = c[0] + 1; x < cEnd; x++) {
    if (colOf[x - 1] >= 0 || colOf[x] >= 0 || colOf[x + 1] >= 0 || !isCorr(x, r[0]) || hole[idx(x, 0)]) continue;
    spurCands.push({ side: 'top', v: x });
  }
  for (let y = r[0] + 1; y < rEnd; y++) {
    if (rowOf[y - 1] >= 0 || rowOf[y] >= 0 || rowOf[y + 1] >= 0) continue;
    if (isCorr(c[0], y) && !hole[idx(0, y)]) spurCands.push({ side: 'left', v: y });
    if (isCorr(cEnd, y) && !hole[idx(W - 1, y)]) spurCands.push({ side: 'right', v: y });
  }
  const spurs = [];
  const wantSpurs = rng.int(LY.spurs[0], LY.spurs[1]);
  for (const s of rng.shuffle(spurCands)) {
    if (spurs.length >= wantSpurs) break;
    if (spurs.some((o) => o.side === s.side && Math.abs(o.v - s.v) < 3)) continue;
    spurs.push(s);
    if (s.side === 'top') for (let y = 0; y < r[0]; y++) lv.cells[idx(s.v, y)] = CORRIDOR;
    else if (s.side === 'left') for (let x = 0; x < c[0]; x++) lv.cells[idx(x, s.v)] = CORRIDOR;
    else for (let x = cEnd + 1; x < W; x++) lv.cells[idx(x, s.v)] = CORRIDOR;
  }
  lv.spurs = spurs;

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
    for (const s of segmentLengths(rng, xb - xa + 1, LY.seg)) { addRoom(x, y0, x + s - 1, y1); x += s; }
  };
  const stripY = (ya, yb, x0, x1) => {
    let y = ya;
    for (const s of segmentLengths(rng, yb - ya + 1, LY.seg)) { addRoom(x0, y, x1, y + s - 1); y += s; }
  };
  const free = (x, y) => lv.inBounds(x, y) && lv.cells[idx(x, y)] === VOID && !hole[idx(x, y)];
  const runs = (a, b, ok) => {
    const out = [];
    let s = -1;
    for (let v = a; v <= b + 1; v++) {
      const good = v <= b && ok(v);
      if (good && s < 0) s = v;
      if (!good && s >= 0) { out.push([s, v - 1]); s = -1; }
    }
    return out;
  };

  // --- 大廳（下方，接在某一條直走廊的正下方）
  const lobbyTop = rEnd + 1;
  // 有大門的那一層是大廳；其他樓層同一個位置是樓梯間（landing）
  const lobby = addRoom(lobbyX - 1, lobbyTop, lobbyX + 1, H - 1, isLobby ? 'lobby' : 'landing');
  lv.lobby = lobby;
  lv.floorIndex = plan ? plan.index : 0;
  lv.stairPlan = P0.stairs;
  lv.stairs = [];
  lv.floorHoles = [];
  lv.ceilHoles = [];
  lv.lobbyX = lobbyX;
  lv.lobbyTop = lobbyTop;
  // 非棋盤格的格局：街區形狀不規則，整層剩下的空地一次切成大小不一的房間
  // （切完之後下面棋盤格用的房間帶 / 街區程式找不到空地，自然不會再動）
  if (cplan.topo !== 'grid') {
    const inside = (x, y) => free(x, y) && ((y >= r[0] && y <= rEnd) || (x >= c[0] && x <= cEnd));
    fillRooms(lv, rng, LY, inside, addRoom);
  }
  // --- 外圍房間帶（被支線、缺角切開）
  for (const [a, b] of runs(c[0], cEnd, (x) => free(x, 0))) stripX(a, b, 0, r[0] - 1);
  for (const [a, b] of runs(c[0], cEnd, (x) => free(x, lobbyTop))) stripX(a, b, lobbyTop, H - 1);
  for (const [a, b] of runs(r[0], rEnd, (y) => free(0, y))) stripY(a, b, 0, c[0] - 1);
  for (const [a, b] of runs(r[0], rEnd, (y) => free(W - 1, y))) stripY(a, b, cEnd + 1, W - 1);
  // --- 內部街區
  const corrRunX = (xa, xb, y) => { for (let x = xa; x <= xb; x++) if (!isCorr(x, y)) return false; return true; };
  const corrRunY = (ya, yb, x) => { for (let y = ya; y <= yb; y++) if (!isCorr(x, y)) return false; return true; };
  for (let i = 0; i < nC - 1; i++) {
    for (let j = 0; j < nR - 1; j++) {
      const x0 = c[i] + colW[i], x1 = c[i + 1] - 1, y0 = r[j] + rowW[j], y1 = r[j + 1] - 1;
      if (!free(x0, y0)) continue;
      const w = x1 - x0 + 1, d = y1 - y0 + 1;
      // 整塊一間大房間（交誼廳、解剖教室……）
      if (w * d <= LY.hallMax && rng.chance(LY.hall)) { addRoom(x0, y0, x1, y1); continue; }
      const top = corrRunX(x0, x1, y0 - 1), bot = corrRunX(x0, x1, y1 + 1);
      const left = corrRunY(y0, y1, x0 - 1), right = corrRunY(y0, y1, x1 + 1);
      const canX = top || bot, canY = left || right;
      const alongX = canX && (!canY || (w >= d ? rng.chance(0.85) : rng.chance(0.3)));
      if (alongX) {
        let x = x0;
        for (const s of segmentLengths(rng, w, LY.seg)) {
          if (!(top && bot) || d < 2 || rng.chance(LY.fullDepth)) addRoom(x, y0, x + s - 1, y1);
          else {
            const half = rng.chance(0.5) ? Math.floor(d / 2) : Math.ceil(d / 2);
            addRoom(x, y0, x + s - 1, y0 + half - 1);
            addRoom(x, y0 + half, x + s - 1, y1);
          }
          x += s;
        }
      } else {
        let y = y0;
        for (const s of segmentLengths(rng, d, LY.seg)) {
          if (!(left && right) || w < 2 || rng.chance(LY.fullDepth)) addRoom(x0, y, x1, y + s - 1);
          else {
            const half = rng.chance(0.5) ? Math.floor(w / 2) : Math.ceil(w / 2);
            addRoom(x0, y, x0 + half - 1, y + s - 1);
            addRoom(x0 + half, y, x1, y + s - 1);
          }
          y += s;
        }
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
  lv.setH(lobbyX, lobbyTop, E.OPEN);
  if (isLobby) {
    lv.setH(lobbyX, H, E.GATE);
    lv.gate = { x: (lobbyX + 0.5) * CELL, z: H * CELL, open: false, angle: 0 };
  } else lv.gate = null;

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

  const inner = [];
  for (const room of lv.rooms) {
    if (room.id === 0 || room === lobby) continue;
    const edges = roomEdges(room).filter((e) => lv.cellAt(e.ox, e.oy) === CORRIDOR);
    if (!edges.length) { inner.push(room); continue; }
    const first = rng.pick(edges);
    addDoor(first);
    if (room.area >= 4 && rng.chance(0.55)) {
      const other = edges.filter((e) => e.side !== first.side);
      if (other.length) addDoor(rng.pick(other));
    }
  }
  // 沒有貼著走廊的房間（中央街區的深處）：從隔壁已經走得到的房間開一扇內門進去，可能一間接一間
  const linked = new Set(lv.rooms.filter((rm) => rm.id > 0 && rm.type !== 'lobby' && !inner.includes(rm)).map((rm) => rm.id));
  while (inner.length) {
    let progress = false;
    for (let i = 0; i < inner.length; i++) {
      const room = inner[i];
      const edges = roomEdges(room).filter((e) => linked.has(lv.cellAt(e.ox, e.oy)));
      if (!edges.length) continue;
      addDoor(rng.pick(edges));
      room.inner = true;
      linked.add(room.id);
      inner.splice(i--, 1);
      progress = true;
    }
    if (!progress) throw new Error('room without access');
  }
  // 房間之間的門（製造繞圈逃跑路線）
  for (const room of lv.rooms) {
    if (room.id === 0 || room === lobby) continue;
    if (!rng.chance(0.22)) continue;
    const edges = roomEdges(room).filter((e) => {
      const o = lv.cellAt(e.ox, e.oy);
      return o > 0 && lv.rooms[o] !== lobby && edgeType(e) === E.WALL;
    });
    if (edges.length) addDoor(rng.pick(edges));
  }

  // --- 窗戶（朝外的牆；地下室沒有窗）
  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    const p = room === lobby ? T.lobbyWindows : T.windows;
    for (const e of roomEdges(room)) {
      if (lv.cellAt(e.ox, e.oy) !== VOID || edgeType(e) !== E.WALL) continue;
      if (room === lobby && !isLobby && e.side === 'S') continue; // 樓梯靠著的那面牆不開窗
      if (p > 0 && rng.chance(p)) setEdge(e, E.WINDOW);
    }
  }
  // 走廊盡頭、中庭邊的走廊窗
  if (T.corrWindows > 0) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isCorr(x, y)) continue;
      for (const e of [{ o: 'h', x, y, ox: x, oy: y - 1 }, { o: 'h', x, y: y + 1, ox: x, oy: y + 1 }, { o: 'v', x, y, ox: x - 1, oy: y }, { o: 'v', x: x + 1, y, ox: x + 1, oy: y }]) {
        if (lv.cellAt(e.ox, e.oy) !== VOID || edgeType(e) !== E.WALL) continue;
        if (rng.chance(T.corrWindows)) setEdge(e, E.WINDOW);
      }
    }
  }

  // --- 走廊路障
  const corridorCells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isCorr(x, y)) corridorCells.push([x, y]);
  const nBarricades = rng.int(...(LY.barricades || [1, 2]));
  for (const [x, y] of rng.shuffle(corridorCells.slice())) {
    if (lv.barricades.length >= nBarricades) break;
    const horiz = isCorr(x - 1, y) || isCorr(x + 1, y), vert = isCorr(x, y - 1) || isCorr(x, y + 1);
    if (horiz && vert) continue; // 路口或寬走廊
    if (Math.abs(x - lobbyX) <= 1 && y >= rEnd - 1) continue; // 大廳附近不要擋
    let touchesDoor = false;
    for (const [dx, dy] of DIRS) {
      const t = lv.edgeBetween(x, y, dx, dy);
      if (t === E.DOOR || t === E.OPEN) touchesDoor = true;
    }
    if (touchesDoor) continue;
    lv.blockedCell[idx(x, y)] = 1;
    const dist = lv.bfs(lobbyX, lobbyTop);
    let ok = true;
    for (let i = 0; i < W * H; i++) if (lv.cells[i] !== VOID && !lv.blockedCell[i] && dist[i] < 0) { ok = false; break; }
    if (!ok) { lv.blockedCell[idx(x, y)] = 0; continue; }
    lv.barricades.push({ x, y, cx: (x + 0.5) * CELL, cz: (y + 0.5) * CELL, horizontal: horiz, rubble: !!LY.rubble });
  }

  // --- 距離與房型
  const dist = lv.bfs(lobbyX, H - 1);
  lv.distFromLobby = dist;
  for (let i = 0; i < W * H; i++) if (lv.cells[i] !== VOID && !lv.blockedCell[i] && dist[i] < 0) throw new Error('unreachable cell');
  const normal = lv.rooms.filter((rm) => rm.id > 0 && rm !== lobby);
  for (const rm of normal) {
    let best = 1e9;
    for (let y = rm.y0; y <= rm.y1; y++) for (let x = rm.x0; x <= rm.x1; x++) best = Math.min(best, dist[idx(x, y)]);
    rm.dist = best;
  }
  const R = T.rooms;
  const byDist = normal.slice().sort((a, b) => b.dist - a.dist);
  let gen = null;
  if (P0.generator) {
    gen = byDist.find((rm) => rm.area >= 2 && rm.area <= 6) || byDist[0];
    gen.type = 'generator';
  }
  lv.generatorRoom = gen;
  if (R.nurse) {
    const nurse = normal.filter((rm) => !rm.type && rm.area >= 2 && rm.area <= 6).sort((a, b) => a.dist - b.dist)[0];
    if (nurse) nurse.type = 'nurse';
  }
  // 樓梯間：有大門的那一層另外挑一間中等距離的房間；其他樓層的樓梯就在大廳位置的樓梯間裡
  lv.stairRoom = null;
  if (P0.stairs.length) {
    if (isLobby) {
      const need = P0.stairs.length > 1 ? 3 : 2;
      const maxD = Math.max(...normal.map((rm) => rm.dist));
      const cands = normal.filter((rm) => !rm.type && rm.area >= need && rm.area <= 6)
        .sort((a, b) => Math.abs(a.dist - maxD * 0.5) - Math.abs(b.dist - maxD * 0.5));
      if (!cands.length) throw new Error('no stairwell room');
      const st = rng.pick(cands.slice(0, 3));
      st.type = 'stairs';
      lv.stairRoom = st;
    } else lv.stairRoom = lobby;
  }
  const big = rng.shuffle(normal.filter((rm) => !rm.type && rm.area >= 4));
  for (const [t, p] of R.specials) if (big.length && rng.chance(p)) big.shift().type = t;
  for (const rm of normal) {
    if (rm.type) continue;
    rm.type = rng.weighted(rm.area >= 4 ? R.big : rm.area >= 2 ? R.mid : R.small);
  }
  // 房間編號
  const num = R.numbered;
  const numbered = normal.filter((rm) => rm.type === num.type).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  let n = num.start;
  for (const rm of numbered) { while (num.skip.includes(n)) n++; rm.label = num.fmt(n++); }
  // 劇情房間（707 病房 / 嬰兒室 / 0713 隔離室……）：離大廳最遠的那一間
  let specialCands = normal.filter((rm) => R.special.types.includes(rm.type));
  if (!specialCands.length) specialCands = normal.filter((rm) => rm !== gen && rm.type !== 'nurse' && rm.type !== 'stairs');
  if (specialCands.length) {
    const special = specialCands.reduce((a, b) => (b.dist > a.dist ? b : a));
    special.label = R.special.label;
    special.special = true;
    special.tag = R.special.tag;
    lv.room707 = special;
  }
  for (const rm of lv.rooms) if (!rm.label) rm.label = R.names[rm.type] || ROOM_NAMES[rm.type];

  // --- 保險絲房間：彼此分散
  const chosen = [];
  const anchors = [[lobby.cx, lobby.cz]];
  if (gen) anchors.push([gen.cx, gen.cz]);
  if (lv.stairRoom && lv.stairRoom !== lobby) anchors.push([lv.stairRoom.cx, lv.stairRoom.cz]);
  const fuseCandidates = normal.filter((rm) => rm !== gen && rm !== lv.stairRoom);
  for (let k = 0; k < P0.fuses; k++) {
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

  // --- 觀察窗（精神科隔離室）與鐵籠護理站：牆上開洞，人過不去
  lv.obs = new Map();
  if (themeKey === 'psych') {
    for (const room of normal) {
      if (room.type !== 'cell' && room.type !== 'nurse') continue;
      const edges = roomEdges(room).filter((e) => lv.cellAt(e.ox, e.oy) === CORRIDOR && edgeType(e) === E.WALL);
      if (room.type === 'nurse') for (const e of edges) lv.obs.set(`${e.o}${e.x},${e.y}`, 'cage');
      else if (edges.length) { const e = rng.pick(edges); lv.obs.set(`${e.o}${e.x},${e.y}`, 'glass'); }
    }
  }

  // --- 家具
  furnish(lv, rng, T);

  // --- 道具
  placeItems(lv, rng, P0.counts || diff || { batteries: 6, film: 3, pills: 3, bottles: 4 }, P0.notes);

  // --- 燈具
  placeLights(lv, rng, T);

  // --- 血跡、字跡、紙張
  placeDecals(lv, rng, T);

  // --- 床上與推床上的屍體（另一個亂數來源，不影響其他生成結果）
  assignCorpses(lv);

  // --- 牆體幾何
  buildWallPieces(lv);

  // 出生點：大廳靠大門處，面向北方（-z）；沒有大廳的樓層就是第一座樓梯的出口
  lv.spawn = isLobby ? { x: (lobbyX + 0.5) * CELL, z: H * CELL - 1.3, yaw: 0 } : { ...lv.stairs[0].arrive };
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
      // 觀察窗 / 鐵籠牆跟窗戶一樣：不放高櫃、不貼貼花
      s.window = s.t === E.WINDOW || (lv.obs && lv.obs.has(s.side === 'N' || s.side === 'S' ? `h${x},${s.side === 'N' ? y : y + 1}` : `v${s.side === 'W' ? x : x + 1},${y}`));
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
  if (room === lv.lobby) {
    entries.push([(lv.lobbyX + 0.5) * CELL, lv.lobbyTop * CELL + 0.6]);
    if (lv.gate) entries.push([lv.gate.x, lv.gate.z - 0.8]);
  }
  for (const [x, z] of entries) {
    const i = Math.floor((x - b.minX) / res), j = Math.floor((z - b.minZ) / res);
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    if (blocked[j * nx + i]) return false; // 門口被堵住
    seeds.push(j * nx + i);
  }
  if (!seeds.length) return true;
  const seen = new Uint8Array(nx * nz);
  // 只從第一個門口開始走：每一個門口都要互相走得到（房間被家具隔成兩半時，穿過房間的路就斷了——
  // 走廊被瓦礫堵住的樓層常常要靠穿過房間繞路）
  const q = [seeds[0]];
  seen[seeds[0]] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], i = k % nx, j = (k / nx) | 0;
    if (i > 0 && !seen[k - 1] && !blocked[k - 1]) { seen[k - 1] = 1; q.push(k - 1); }
    if (i < nx - 1 && !seen[k + 1] && !blocked[k + 1]) { seen[k + 1] = 1; q.push(k + 1); }
    if (j > 0 && !seen[k - nx] && !blocked[k - nx]) { seen[k - nx] = 1; q.push(k - nx); }
    if (j < nz - 1 && !seen[k + nx] && !blocked[k + nx]) { seen[k + nx] = 1; q.push(k + nx); }
  }
  for (const k of seeds) if (!seen[k]) return false;
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
  const ox = (lv.lobbyX + 0.5) * CELL, oz = lv.lobbyTop * CELL;
  lv.blockers.push({ minX: ox - 1.6, maxX: ox + 1.6, minZ: oz - 1.6, maxZ: oz + 1.6, clearance: true });
  if (lv.gate) lv.blockers.push({ minX: ox - 1.9, maxX: ox + 1.9, minZ: lv.H * CELL - 2.4, maxZ: lv.H * CELL, clearance: true });
  // 大廳中央通道保持淨空（最後逃跑的路線）
  lv.blockers.push({ minX: ox - 1.0, maxX: ox + 1.0, minZ: oz, maxZ: lv.H * CELL, clearance: true });
  // 路障
  for (const b of lv.barricades) lv.blockers.push({ ...cellBounds(b.x, b.y), clearance: true });
}

// 走廊上隨手擺放的東西（依主題）
const CORRIDOR_PROPS = {
  ward: [['gurney', 3], ['wheelchair', 2], ['bench', 1.5], ['bin', 1.5], ['chair', 1.5], ['boxes', 1]],
  morgue: [['gurney', 5], ['boxes', 1.5], ['bin', 1], ['wheelchair', 0.5], ['chair', 0.5]],
  pediatric: [['gurney', 1.6], ['wheelchair', 1.4], ['bench', 1.5], ['crib', 1.2], ['chair', 1], ['boxes', 1], ['bin', 0.8]],
  psych: [['wheelchair', 2], ['chair', 2], ['bench', 2], ['gurney', 1.5], ['bin', 1.5]],
};

function furnish(lv, rng, T) {
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
  // 家具局部座標 (lx, lz) → 世界座標（three.js rotation.y 的方向）
  const local = (f, lx, lz) => [f.x + lx * Math.cos(f.rot) + lz * Math.sin(f.rot), f.z - lx * Math.sin(f.rot) + lz * Math.cos(f.rot)];
  // 放在既有家具旁邊的小東西（點滴架、小椅子……）：位置合法才放
  const addNear = (kind, room, x, z, rot, extra = {}) => {
    const f = FURN[kind];
    const box = footprint(x, z, rot, f.w, f.d);
    if (!inside(box, roomBounds(room)) || !P.free(box) || !roomStaysConnected(lv, room, box)) return null;
    return P.add(kind, room, { x, z, rot }, extra);
  };
  // 冷藏櫃：有些抽屜被拉出來，上面躺著蓋白布的屍體或空著
  const openDrawers = (u, room) => {
    u.open = [];
    for (let col = 0; col < 3; col++) {
      if (!rng.chance(0.42)) continue;
      const row = rng.chance(0.55) ? 1 : 0;
      const [x, z] = local(u, (col - 1) * (2.55 / 3), FURN.drawers.d / 2 + 0.06 + FURN.tray.d / 2);
      const tray = addNear('tray', room, x, z, u.rot, { row, trayTop: row ? 0.82 : 0.2, body: rng.chance(0.62), drawers: u });
      if (tray) u.open.push({ col, row });
    }
  };
  const bedSide = (bed, room, bounds) => {
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
      lv.decals.push({ kind: 'curtain', x: bed.x + sx * side * 0.68 + fx * 0.1, z: bed.z + sz * side * 0.68 + fz * 0.1, rot: bed.rot, len: 2.0 });
    }
  };
  const drain = (x, z) => lv.decals.push({ kind: 'drain', x, z, rot: rng.range(0, 6.28), size: rng.range(0.32, 0.42) });
  const toyShelf = (room) => { const s = P.againstWall('shelf', room); if (s) s.toys = true; return s; };
  // 瓦礫堆：正上方的天花板破一個洞，垂下燒焦的骨架與電線
  const rubbleAt = (rb) => { if (rb) lv.decals.push({ kind: 'prop', prop: 'ceilingHole', x: rb.x, z: rb.z, rot: rb.rot }); return rb; };
  const burned = lv.theme === 'burned';
  lv.rocking = [];
  const horse = (room, opts = {}) => {
    const h = P.freeStanding('rockinghorse', room, { margin: 0.45, ...opts });
    if (h) lv.rocking.push(h);
    return h;
  };

  // 樓梯：家具的正面（+z）是樓梯口，玩家從這一側走上去 / 走下去
  const stairsAt = (room, pose, st, clear) => {
    const it = P.add('stairs', room, pose, { dir: st.dir, to: st.to });
    clear.clearance = true;
    lv.blockers.push(clear);
    const [fx, fz] = frontVec(pose.rot);
    const f = FURN.stairs;
    const s = {
      id: lv.stairs.length, dir: st.dir, to: st.to, label: st.label || '', furn: it, room: room.id,
      x: pose.x, z: pose.z, rot: pose.rot, w: f.w, d: f.d,
      use: { x: pose.x + fx * (f.d / 2 + 0.55), z: pose.z + fz * (f.d / 2 + 0.55) },
      arrive: { x: pose.x + fx * (f.d / 2 + 0.95), z: pose.z + fz * (f.d / 2 + 0.95), yaw: pose.rot + Math.PI },
    };
    it.stair = s;
    lv.stairs.push(s);
    // 下樓：地板挖一個洞；上樓：樓梯頂端的天花板開一個洞（往上是黑漆漆的樓梯井）
    const L = (lx, lz) => [pose.x + lx * Math.cos(pose.rot) + lz * Math.sin(pose.rot), pose.z - lx * Math.sin(pose.rot) + lz * Math.cos(pose.rot)];
    const rect = (lx0, lz0, lx1, lz1) => {
      const a = L(lx0, lz0), b = L(lx1, lz1);
      return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) };
    };
    if (st.dir === 'down') lv.floorHoles.push(rect(-f.w / 2 + 0.06, -f.d / 2 + 0.06, f.w / 2 - 0.06, f.d / 2));
    else lv.ceilHoles.push(rect(-f.w / 2 + 0.04, -f.d / 2 + 0.04, f.w / 2 - 0.04, -f.d / 2 + 1.3));
    // 樓梯口上方吊一塊「上樓 9F」的牌子
    const [sx, sz] = L(0, f.d / 2 - 0.05);
    lv.signs.push({ kind: 'roomSign', text: `${st.dir === 'up' ? '上樓' : '下樓'} ${st.label || ''}`.trim(), x: sx, y: 2.62, z: sz, rot: pose.rot });
    return it;
  };
  const placeStairs = (room) => {
    const f = FURN.stairs;
    for (const st of lv.stairPlan) {
      if (room === lv.lobby) {
        // 樓梯間（大廳的位置）：左右兩格靠南牆，樓梯口朝北；中間的走道保持淨空
        const side = lv.stairs.length === 0 ? -1 : 1;
        const x = side < 0 ? (lv.lobbyX - 1) * CELL + HT + f.w / 2 + 0.3 : (lv.lobbyX + 2) * CELL - HT - f.w / 2 - 0.3;
        const pose = { x, z: lv.H * CELL - HT - f.d / 2 - 0.03, rot: Math.PI };
        const box = footprint(pose.x, pose.z, pose.rot, f.w, f.d);
        if (!P.free(box)) throw new Error('no landing stair slot');
        stairsAt(room, pose, st, footprint(pose.x, pose.z - f.d / 2 - 0.75, 0, f.w + 0.4, 1.5));
        continue;
      }
      // 一般房間改成的樓梯間：靠牆、正面要留走得到的空間（不能伸出房間）
      const bounds = roomBounds(room);
      let ok = false;
      for (const slot of rng.shuffle(wallSlots(lv, room).filter((sl) => !sl.window))) {
        const along = (slot.a0 + slot.a1) / 2;
        const pose = slotPose(slot, along, f, 0.03);
        const box = footprint(pose.x, pose.z, pose.rot, f.w, f.d);
        if (!inside(box, bounds) || !P.free(box)) continue;
        const [fx, fz] = frontVec(pose.rot);
        const clear = footprint(pose.x + fx * (f.d / 2 + 0.7), pose.z + fz * (f.d / 2 + 0.7), pose.rot, f.w + 0.3, 1.4);
        if (!inside(clear, bounds) || !P.free(clear)) continue;
        if (!roomStaysConnected(lv, room, box)) continue;
        stairsAt(room, pose, st, clear);
        ok = true;
        break;
      }
      if (!ok) throw new Error('no stair slot');
    }
  };

  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    const t = room.type;
    const bounds = roomBounds(room);
    switch (t) {
      case 'landing': {
        placeStairs(room);
        for (let i = 0; i < 2; i++) P.againstWall('bench', room, { noWindow: false });
        P.againstWall('plant', room);
        if (rng.chance(0.5)) P.againstWall('bin', room);
        if (rng.chance(0.5)) P.freeStanding('wheelchair', room, { margin: 0.6 });
        break;
      }
      case 'stairs': {
        placeStairs(room);
        if (rng.chance(0.6)) P.againstWall('boxes', room);
        if (rng.chance(0.5)) P.againstWall('bin', room);
        if (rng.chance(0.3)) addLocker(room);
        break;
      }
      case 'lobby': {
        P.againstWall('counter', room, { sides: ['E', 'W'], clearance: 0.9 });
        if (lv.theme === 'morgue') {
          // 卸貨區：推床與紙箱
          for (let i = 0; i < 2; i++) { const g = P.againstWall('gurney', room, { gap: 0.1 }); if (g) g.body = rng.chance(0.6); }
          P.againstWall('boxes', room);
          P.againstWall('boxes', room);
        } else {
          for (let i = 0; i < 3; i++) P.againstWall('bench', room, { noWindow: false });
          P.againstWall('plant', room);
          if (lv.theme === 'pediatric') horse(room, { margin: 0.6 });
          else P.againstWall('plant', room);
          P.freeStanding('wheelchair', room, { margin: 0.6 });
        }
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
          bed.variant = burned ? (rng.chance(0.65) ? 2 : 1) : rng.int(0, 3);
          bedSide(bed, room, bounds);
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
        for (let i = 0; i < n; i++) {
          if (lv.theme === 'pediatric' && rng.chance(0.3)) toyShelf(room);
          else P.againstWall('shelf', room);
        }
        for (let i = 0; i < 2; i++) P.againstWall('boxes', room);
        if (lv.theme === 'morgue' && rng.chance(0.6)) P.freeStanding('bodybag', room, { margin: 0.35, axisAligned: true });
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
        if (lv.theme === 'morgue') drain(room.cx + rng.range(-0.5, 0.5), room.cz + rng.range(-0.5, 0.5));
        break;
      }
      case 'operating': {
        const tbl = P.freeStanding('optable', room, { center: true, axisAligned: true, margin: 0.6 });
        if (tbl && lv.theme === 'surgery') {
          // 手術部：雙頭無影燈、床頭的麻醉機與監視器、蓋著綠布的手術台
          tbl.draped = rng.chance(0.6);
          lv.decals.push({ kind: 'prop', prop: 'surgicalLamp2', x: tbl.x, z: tbl.z, rot: tbl.rot + rng.range(-0.4, 0.4) });
          const hs = rng.chance(0.5) ? 1 : -1;
          const [ax, az] = local(tbl, 0, hs * 1.5);
          addNear('anesthesia', room, ax, az, tbl.rot + (hs > 0 ? Math.PI : 0) + rng.range(-0.3, 0.3));
          const [mx, mz] = local(tbl, rng.chance(0.5) ? 0.95 : -0.95, hs * 0.9);
          addNear('monitor', room, mx, mz, rng.range(0, 6.28));
          const [bx, bz] = local(tbl, rng.chance(0.5) ? 0.75 : -0.75, -hs * 0.4);
          addNear('bin', room, bx, bz, 0);
          if (room.area >= 4) P.againstWall('cabinet', room);
        } else if (tbl) lv.decals.push({ kind: 'surgicalLamp', x: tbl.x, z: tbl.z, rot: tbl.rot });
        P.againstWall('trolley', room);
        P.againstWall('trolley', room);
        P.againstWall('cabinet', room);
        if (rng.chance(0.6)) P.againstWall('sink', room);
        if (rng.chance(0.4)) addLocker(room);
        break;
      }
      case 'morgue': {
        if (lv.theme === 'morgue') {
          // 冷藏櫃室：一整面一整面的屍體抽屜
          const nUnits = room.area >= 4 ? 3 : room.area >= 2 ? 2 : 1;
          for (let i = 0; i < nUnits; i++) {
            const u = P.againstWall('drawers', room, { noWindow: true });
            if (!u) break;
            openDrawers(u, room);
          }
          const g = P.againstWall('gurney', room, { noWindow: false, gap: 0.25 });
          if (g) g.body = rng.chance(0.7);
          if (rng.chance(0.4)) addLocker(room);
          if (rng.chance(0.5)) P.againstWall('sink', room);
          drain(room.cx + rng.range(-0.6, 0.6), room.cz + rng.range(-0.6, 0.6));
          break;
        }
        P.againstWall('morgue', room);
        if (rng.chance(0.7)) P.againstWall('morgue', room);
        const g = P.againstWall('gurney', room, { noWindow: false, gap: 0.25 });
        if (g) g.body = true;
        if (rng.chance(0.6)) { const g2 = P.freeStanding('gurney', room, { margin: 0.5 }); if (g2) g2.body = rng.chance(0.7); }
        P.againstWall('sink', room);
        break;
      }
      case 'autopsy': {
        // 解剖室：不鏽鋼解剖台、地上的排水孔、器械推車
        const n = room.area >= 4 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const tb = P.freeStanding('autopsy', room, { axisAligned: true, margin: 0.6, center: n === 1 });
          if (!tb) continue;
          const [dx, dz] = local(tb, 0, 0.75);
          drain(dx, dz);
          lv.decals.push({ kind: 'surgicalLamp', x: tb.x, z: tb.z, rot: tb.rot });
        }
        P.againstWall('trolley', room);
        P.againstWall('sink', room, { noWindow: false });
        P.againstWall('cabinet', room);
        if (rng.chance(0.5)) P.againstWall('trolley', room);
        if (rng.chance(0.35)) addLocker(room);
        break;
      }
      case 'coldstore': {
        // 屍袋冷藏室：天花板吊軌上掛著一排屍袋
        const n = room.area >= 4 ? 3 : 2;
        for (let i = 0; i < n; i++) P.againstWall('bagrail', room, { noWindow: true });
        for (let k = rng.int(1, 2); k > 0; k--) P.freeStanding('bodybag', room, { margin: 0.35, axisAligned: true });
        const g = P.againstWall('gurney', room, { gap: 0.2 });
        if (g) g.body = true;
        if (rng.chance(0.5)) P.againstWall('shelf', room);
        drain(room.cx + rng.range(-0.8, 0.8), room.cz + rng.range(-0.8, 0.8));
        if (rng.chance(0.3)) addLocker(room);
        break;
      }
      case 'kidward': {
        if (rng.chance(0.4)) addLocker(room);
        const nBeds = Math.min(6, Math.max(1, Math.round(room.area * rng.range(0.9, 1.4))));
        for (let i = 0; i < nBeds; i++) {
          const kind = rng.chance(0.45) ? 'crib' : 'kidbed';
          const bed = P.againstWall(kind, room, { gap: 0.04, clearance: 0.75 });
          if (!bed) continue;
          bed.variant = rng.int(0, 3);
          if (kind === 'kidbed' && rng.chance(0.3)) lv.decals.push({ kind: 'curtain', ...(() => { const [fx, fz] = frontVec(bed.rot); const s = rng.chance(0.5) ? 1 : -1; return { x: bed.x + fz * s * 0.62 + fx * 0.1, z: bed.z - fx * s * 0.62 + fz * 0.1 }; })(), rot: bed.rot, len: 1.6 });
        }
        if (rng.chance(0.35)) horse(room);
        if (rng.chance(0.4)) toyShelf(room);
        if (rng.chance(0.5)) P.againstWall('cabinet', room);
        if (rng.chance(0.4)) P.freeStanding('chair', room, { margin: 0.4 });
        break;
      }
      case 'nursery': {
        // 嬰兒室：一排一排的嬰兒床
        const n = Math.min(7, room.area + 2);
        for (let i = 0; i < n; i++) if (!P.againstWall('bassinet', room, { gap: 0.04, clearance: 0.7 })) break;
        if (room.area >= 6) P.freeStanding('bassinet', room, { margin: 0.8, axisAligned: true });
        P.freeStanding('chair', room, { margin: 0.4 });
        if (rng.chance(0.5)) P.againstWall('cabinet', room);
        if (rng.chance(0.4)) P.freeStanding('ivstand', room, { margin: 0.4 });
        if (rng.chance(0.3)) addLocker(room);
        break;
      }
      case 'playroom': {
        // 遊戲室：小桌子、小椅子、搖搖馬和玩具架
        const tb = P.freeStanding('kidtable', room, { margin: 0.8, axisAligned: true, center: room.area < 4 });
        if (tb) {
          for (const [lx, lz] of [[0, 0.62], [0, -0.62], [0.62, 0], [-0.62, 0]]) {
            if (!rng.chance(0.7)) continue;
            const [x, z] = local(tb, lx, lz);
            addNear('kidchair', room, x, z, Math.atan2(lx, lz) + Math.PI + rng.range(-0.4, 0.4));
          }
        }
        horse(room);
        toyShelf(room);
        if (rng.chance(0.6)) toyShelf(room);
        P.againstWall('boxes', room);
        if (rng.chance(0.4)) addLocker(room);
        break;
      }
      case 'cell': {
        // 軟墊隔離室：束縛床（有時候兩張）
        const nb = room.area >= 2 && rng.chance(0.45) ? 2 : 1;
        for (let i = 0; i < nb; i++) {
          const bed = P.againstWall('bed', room, { gap: 0.04 });
          if (!bed) break;
          bed.variant = rng.chance(0.8) ? 0 : 1;
          bed.restraint = true;
        }
        if (rng.chance(0.25)) addLocker(room);
        break;
      }
      case 'therapy': {
        // 電療室：電擊椅、電療機、束縛床
        P.againstWall('ectchair', room, { clearance: 0.5 });
        P.againstWall('ectmachine', room);
        const bed = P.againstWall('bed', room, { gap: 0.04 });
        if (bed) { bed.variant = 0; bed.restraint = true; }
        P.againstWall('cabinet', room);
        if (rng.chance(0.6)) P.againstWall('trolley', room);
        if (rng.chance(0.5)) P.againstWall('sink', room);
        if (rng.chance(0.35)) addLocker(room);
        break;
      }
      case 'dayroom': {
        // 交誼廳：桌椅、長椅、輪椅
        const nt = room.area >= 6 ? 2 : 1;
        for (let i = 0; i < nt; i++) {
          const tb = P.freeStanding('table', room, { margin: 0.9, axisAligned: true });
          if (!tb) continue;
          for (const [lx, lz] of [[-0.35, 0.72], [0.35, 0.72], [-0.35, -0.72], [0.35, -0.72]]) {
            if (!rng.chance(0.6)) continue;
            const [x, z] = local(tb, lx, lz);
            addNear('chair', room, x, z, tb.rot + (lz > 0 ? Math.PI : 0) + rng.range(-0.5, 0.5));
          }
        }
        P.againstWall('bench', room);
        if (rng.chance(0.6)) P.againstWall('bench', room);
        P.againstWall('plant', room);
        if (rng.chance(0.6)) P.freeStanding('wheelchair', room, { margin: 0.5 });
        if (rng.chance(0.5)) P.againstWall('shelf', room);
        if (rng.chance(0.35)) addLocker(room);
        break;
      }
      case 'icu':
      case 'recovery': {
        // 加護病房 / 恢復室：一床一床用隔簾隔開，床頭有監視器或點滴架
        const icu = t === 'icu';
        const nBeds = Math.min(6, Math.max(1, Math.round(room.area * rng.range(icu ? 0.7 : 0.9, icu ? 1.1 : 1.3))));
        for (let i = 0; i < nBeds; i++) {
          const bed = P.againstWall('bed', room, { gap: 0.04, clearance: icu ? 0.6 : 0 });
          if (!bed) break;
          bed.variant = rng.weighted([[0, 0.55], [1, 0.35], [2, 0.1]]);
          const side = rng.chance(0.5) ? 1 : -1;
          const [mx, mz] = local(bed, side * 0.86, -0.62);
          if (!(icu && addNear('monitor', room, mx, mz, bed.rot + rng.range(-0.3, 0.3)))) bedSide(bed, room, bounds);
          if (rng.chance(icu ? 0.8 : 0.45)) {
            const [cx, cz] = local(bed, -side * 0.7, 0.1);
            lv.decals.push({ kind: 'curtain', x: cx, z: cz, rot: bed.rot, len: 2.0 });
          }
        }
        P.againstWall('trolley', room);
        if (rng.chance(0.5)) P.againstWall('cabinet', room);
        if (!icu && rng.chance(0.5)) P.freeStanding('chair', room, { margin: 0.4 });
        if (rng.chance(0.4)) addLocker(room);
        break;
      }
      case 'scrub': {
        // 刷手間：一長排刷手槽、置物櫃、手套與口罩的架子
        if (!P.againstWall('scrubsink', room, { clearance: 0.7, noWindow: false })) P.againstWall('sink', room, { noWindow: false });
        if (room.area >= 3 && rng.chance(0.6)) P.againstWall('scrubsink', room, { clearance: 0.7, noWindow: false });
        if (rng.chance(0.6)) addLocker(room);
        if (rng.chance(0.35)) addLocker(room);
        P.againstWall('shelf', room);
        P.againstWall('bin', room);
        if (rng.chance(0.5)) P.againstWall('boxes', room);
        break;
      }
      case 'sterile': {
        // 無菌器械室：滅菌鍋、器械架、推車
        P.againstWall('autoclave', room, { clearance: 0.8, noWindow: true });
        for (let k = rng.int(2, 3); k > 0; k--) P.againstWall('shelf', room);
        P.againstWall('trolley', room);
        if (rng.chance(0.5)) P.freeStanding('trolley', room, { margin: 0.45, axisAligned: true });
        if (rng.chance(0.5)) P.againstWall('cabinet', room);
        if (rng.chance(0.35)) addLocker(room);
        break;
      }
      case 'collapsed': {
        // 坍塌病房：天花板整片塌下來，地上一堆一堆的瓦礫、斷樑和燒剩的床架
        const n = room.area >= 6 ? 2 : 1;
        for (let k = 0; k < n; k++) rubbleAt(P.freeStanding('rubble', room, { margin: 0.55 }));
        if (room.area >= 2) P.againstWall('beam', room, { gap: 0.05 });
        for (let k = room.area >= 4 ? 2 : 1; k > 0; k--) {
          const bed = P.againstWall('bed', room, { gap: 0.04 });
          if (bed) bed.variant = 2;
        }
        if (rng.chance(0.5)) P.againstWall('boxes', room);
        if (rng.chance(0.3)) addLocker(room);
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
    // 舊院區：很多房間的天花板塌了一角
    if (burned && t !== 'generator' && t !== 'collapsed' && (t === 'lobby' || room.area >= 2) && rng.chance(t === 'lobby' ? 0.7 : 0.25)) rubbleAt(P.freeStanding('rubble', room, { margin: 0.55 }));
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
  // 置物櫃太少（櫃子間距 9 公尺放不下）就放寬間距再補
  for (const [x, y] of rng.shuffle(corrCells.slice())) {
    if (lv.lockers.length >= 6) break;
    if (used.has(x + ',' + y)) continue;
    const slots = wallSlots(lv, corridor, [[x, y]]);
    if (!slots.length) continue;
    if (addLocker(corridor, { slots, bounds: cellBounds(x, y) })) used.add(x + ',' + y);
  }
  const props = T.corridorProps || CORRIDOR_PROPS[lv.theme] || CORRIDOR_PROPS.ward;
  for (const [x, y] of rng.shuffle(corrCells.slice())) {
    if (used.has(x + ',' + y) || !rng.chance(0.33)) continue;
    const slots = wallSlots(lv, corridor, [[x, y]]);
    if (!slots.length) continue;
    const kind = rng.weighted(props);
    const it = P.againstWall(kind, corridor, { slots, bounds: cellBounds(x, y), gap: kind === 'gurney' ? 0.1 : 0.03 });
    if (it) {
      used.add(x + ',' + y);
      if (kind === 'gurney' && rng.chance(T.decor.corridorBodies)) it.body = true;
      if (kind === 'wheelchair' || kind === 'chair') it.rot += rng.range(-0.6, 0.6);
      if (kind === 'crib') it.variant = rng.int(0, 3);
      if (kind === 'rubble' && rng.chance(0.6)) rubbleAt(it);
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

function placeItems(lv, rng, diff, notes = [0, 1, 2, 3, 4, 5, 6]) {
  const has = (n) => notes.includes(n);
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

  // 筆記（多層樓時只放分配到這一層的那幾張）
  const lobby = lv.lobby;
  if (has(0)) {
    const counter = lv.furniture.find((f) => f.room === lobby.id && f.kind === 'counter');
    add('note', () => (counter ? surfacePoint(rng, counter) : spotInRoom(lobby)), { note: 0 });
  }
  const others = lv.rooms.filter((rm) => rm.id > 0 && rm !== lobby);
  if (has(1)) {
    const nurse = lv.rooms.find((rm) => rm.type === 'nurse');
    const nurseRoom = nurse || rng.pick(others);
    add('note', () => spotInRoom(nurseRoom), { note: 1 });
  }
  if (has(2)) {
    const fallback = rng.pick(others);
    add('note', () => spotInCorridor() || spotInRoom(fallback), { note: 2 });
  }
  if (has(3)) {
    const office = rng.shuffle(others.filter((rm) => rm.type === 'office' || rm.type === 'operating'))[0] || rng.pick(others);
    add('note', () => spotInRoom(office), { note: 3 });
  }
  const r707 = (has(4) || has(5)) ? lv.room707 || rng.pick(others) : null;
  if (has(4)) add('note', () => spotInRoom(r707), { note: 4 });
  if (has(5)) add('note', () => spotInRoom(r707), { note: 5 });
  if (has(6) && lv.generatorRoom) add('note', () => spotInRoom(lv.generatorRoom), { note: 6 });

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
function placeLights(lv, rng, T) {
  const L = T.lights;
  const stageOf = () => rng.weighted([[1, 0.17], [2, 0.17], [3, 0.2], [0, L.broken]]); // 0 = 壞掉
  const isCorr = (x, y) => lv.cellAt(x, y) === CORRIDOR;
  for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
    const id = lv.cellAt(x, y);
    if (id === VOID || lv.blockedCell[y * lv.W + x]) continue;
    const room = lv.rooms[id];
    let place = false;
    if (id === CORRIDOR) place = (x + y) % L.corrEvery === 0;
    else if (room.area <= 2) place = x === room.x0 && y === room.y0;
    else place = (x - room.x0) % 2 === 0 && (y - room.y0) % 2 === 0;
    if (!place) continue;
    let fx = (x + 0.5) * CELL, fz = (y + 0.5) * CELL;
    if (id !== CORRIDOR && room.area <= 2) { fx = room.cx; fz = room.cz; }
    let stage = stageOf();
    if (room.type === 'generator') stage = 1;
    if (room.type === 'lobby') stage = 3;
    if (room.type === 'landing' && stage === 0) stage = 1; // 樓梯間至少有一盞會亮
    if (room.type === 'nurse' && stage === 0) stage = 2;
    const mode = stage === 0 ? 'broken' : rng.chance(L.flicker) ? 'flicker' : 'steady';
    // 走廊燈管順著走廊方向
    const horiz = (isCorr(x - 1, y) || isCorr(x + 1, y)) && !(isCorr(x, y - 1) || isCorr(x, y + 1));
    lv.fixtures.push({ x: fx, z: fz, y: WALL_H - 0.04, room: id, stage, mode, rot: id === CORRIDOR ? (horiz ? 0 : Math.PI / 2) : 0, phase: rng.range(0, 100), on: false, level: 0 });
  }
  // 緊急照明（一直亮著，顏色依主題）
  const inter = [];
  for (const y of lv.corrRows) for (const x of lv.corrCols) if (isCorr(x, y) && !lv.blockedCell[y * lv.W + x]) inter.push([x, y]);
  rng.shuffle(inter);
  // 路口太少的格局（環狀、魚骨形）：其他走廊格子補上
  if (inter.length < L.emergencyN) {
    const more = [];
    for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) if (isCorr(x, y) && !lv.blockedCell[y * lv.W + x] && !inter.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) < 3)) more.push([x, y]);
    for (const p of rng.shuffle(more)) {
      if (inter.length >= L.emergencyN) break;
      if (!inter.some(([a, b]) => Math.abs(a - p[0]) + Math.abs(b - p[1]) < 3)) inter.push(p);
    }
  }
  for (const [x, y] of inter.slice(0, L.emergencyN)) {
    lv.emergency.push({ x: (x + 0.5) * CELL + rng.range(-0.8, 0.8), y: WALL_H - 0.25, z: (y + 0.5) * CELL + rng.range(-0.8, 0.8), phase: rng.range(0, 10) });
  }
  // 出口標示（只有大廳那一層）
  if (lv.gate) {
    lv.exitSigns.push({ x: (lv.lobbyX + 0.5) * CELL, y: DOOR_H + 0.35, z: lv.lobbyTop * CELL - HT - 0.05, rot: Math.PI });
    lv.exitSigns.push({ x: (lv.lobbyX + 0.5) * CELL, y: GATE_H + 0.25, z: lv.H * CELL - HT - 0.05, rot: Math.PI });
  }
}

// ---------------------------------------------------------------------------
function placeDecals(lv, rng, T) {
  const D = T.decor;
  // 地板血跡
  const floorCells = [];
  for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) if (lv.cellAt(x, y) !== VOID && !lv.blockedCell[y * lv.W + x]) floorCells.push([x, y]);
  const nBlood = Math.round(floorCells.length * D.blood);
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
  const nPaper = Math.round(floorCells.length * D.paper);
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
    if (wi >= D.writings) break;
    const along = s.a0 + CELL / 2 + rng.range(-0.4, 0.4);
    if (!wallDecalFree(lv, s, along, 1.2)) continue;
    lv.decals.push({ kind: 'writing', text: words[wi++ % words.length], ...wallDecalPose(s, along, rng.range(1.35, 1.75)), size: rng.range(1.3, 1.8) });
  }
  let hp = 0;
  for (const s of wallSlotsClean.slice(D.writings)) {
    if (hp >= D.hands) break;
    const along = s.a0 + rng.range(0.6, CELL - 0.6);
    if (!wallDecalFree(lv, s, along, 0.4)) continue;
    lv.decals.push({ kind: 'hand', ...wallDecalPose(s, along, rng.range(0.9, 1.6)), size: rng.range(0.22, 0.28), rotZ: rng.range(-0.6, 0.6), variant: rng.int(0, 1) });
    hp++;
  }
  // 天花板滲水流下的水痕、牆上抹開的血（照片貼花；沒有照片素材時不畫）。
  // 用另一個亂數來源，不影響後面關卡生成的結果
  const r2 = new RNG((lv.seed ^ 0x1eaf5) >>> 0);
  // 已經佔用的牆面（字跡、手印），新的貼花不要蓋上去
  const spans = lv.decals.filter((d) => d.kind === 'writing' || d.kind === 'hand').map((d) => ({ rot: d.rot, x: d.x, z: d.z, half: d.size / 2 }));
  const clashes = (p, w) => spans.some((q) => Math.abs(q.rot - p.rot) < 0.01 && Math.hypot(q.x - p.x, q.z - p.z) < w / 2 + q.half + 0.15);
  let leaks = 0, smears = 0;
  for (const s of r2.shuffle(wallSlotsClean.slice())) {
    if (leaks >= 18 && smears >= 7) break;
    const leak = leaks < 18 && (smears >= 7 || r2.chance(0.72));
    const w = leak ? r2.range(0.45, 0.8) : r2.range(0.8, 1.3);
    const along = s.a0 + r2.range(w / 2 + 0.15, CELL - w / 2 - 0.15);
    // 被高櫃子擋住就白畫了
    if (!wallDecalFree(lv, s, along, w)) continue;
    if (leak) {
      const h = Math.min(2.6, w * 4);
      const p = wallDecalPose(s, along, WALL_H - h / 2 - 0.02);
      if (clashes(p, w)) continue;
      lv.decals.push({ kind: 'leak', ...p, w, h, flip: r2.chance(0.5) });
      spans.push({ rot: p.rot, x: p.x, z: p.z, half: w / 2 });
      leaks++;
    } else {
      const p = wallDecalPose(s, along, r2.range(0.7, 1.45));
      if (clashes(p, w)) continue;
      lv.decals.push({ kind: 'smear', ...p, w, rotZ: r2.range(-0.2, 0.2), band: r2.int(0, 3) });
      spans.push({ rot: p.rot, x: p.x, z: p.z, half: w / 2 });
      smears++;
    }
  }
  // 主題貼花：蠟筆畫（兒童病房）、地上的排水孔（太平間）、散落的玩具（兒童病房）。
  // 再用另一個亂數來源，不影響上面的結果
  const r3 = new RNG((lv.seed ^ 0x7a11c3) >>> 0);
  if (D.drawings > 0) {
    const kidRoom = (s) => { const id = lv.cellAt(s.x, s.y); return id === 0 || ['kidward', 'playroom', 'nursery', 'lobby', 'nurse'].includes(lv.rooms[id].type); };
    let nd = 0;
    for (const s of r3.shuffle(wallSlotsClean.filter(kidRoom))) {
      if (nd >= D.drawings) break;
      // 一面牆貼一到三張
      for (let k = r3.int(1, 3); k > 0 && nd < D.drawings; k--) {
        const w = r3.range(0.42, 0.56);
        const along = s.a0 + r3.range(w / 2 + 0.2, CELL - w / 2 - 0.2);
        if (!wallDecalFree(lv, s, along, w)) continue;
        const p = wallDecalPose(s, along, r3.range(0.95, 1.55));
        if (clashes(p, w)) continue;
        lv.decals.push({ kind: 'drawing', ...p, w, rotZ: r3.range(-0.12, 0.12), variant: r3.int(0, 5) });
        spans.push({ rot: p.rot, x: p.x, z: p.z, half: w / 2 });
        nd++;
      }
    }
  }
  if (D.drains > 0) {
    for (const [x, y] of floorCells) {
      if (lv.cellAt(x, y) !== CORRIDOR || !r3.chance(D.drains)) continue;
      lv.decals.push({ kind: 'drain', x: (x + r3.range(0.35, 0.65)) * CELL, z: (y + r3.range(0.35, 0.65)) * CELL, rot: r3.range(0, 6.28), size: r3.range(0.3, 0.4) });
    }
  }
  if (D.toys > 0) {
    const nearItem = (p) => lv.items.some((it) => it.y < 0.3 && Math.hypot(it.x - p.x, it.z - p.z) < 0.45);
    for (const room of lv.rooms) {
      const kid = ['kidward', 'playroom', 'nursery'].includes(room.type);
      const n = kid ? D.toys + (room.type === 'playroom' ? 3 : 0) : room.id === 0 ? 6 : room.type === 'lobby' ? 2 : 0;
      for (let k = 0; k < n; k++) {
        const b = room.id === 0 ? (() => { const [x, y] = r3.pick(floorCells.filter(([cx, cy]) => lv.cellAt(cx, cy) === CORRIDOR)); return cellBounds(x, y); })() : roomBounds(room);
        const p = floorPoint(lv, r3, b, 0.3);
        if (!p || nearItem(p)) continue;
        lv.decals.push({ kind: 'toy', x: p.x, z: p.z, rot: r3.range(0, 6.28), variant: r3.int(0, 4), tipped: r3.chance(0.35) });
      }
    }
  }
  placeThemeDecals(lv, T, wallSlotsClean, floorCells);
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

// 手術部與燒毀舊院區的主題裝飾（另一個亂數來源，不影響其他主題的生成結果）：
// 燻黑的牆、地上的焦痕、釘上木板的窗、走廊上的塑膠條門簾、瓦礫上方破掉的天花板
function placeThemeDecals(lv, T, wallSlotsClean, floorCells) {
  const D = T.decor;
  const r4 = new RNG((lv.seed ^ 0x50071e) >>> 0);
  if (D.soot > 0) {
    for (const s of wallSlotsClean) {
      if (!r4.chance(D.soot)) continue;
      const w = r4.range(1.3, 2.6), h = r4.range(2.1, 2.95);
      const along = s.a0 + r4.range(Math.min(CELL / 2, w / 2), Math.max(CELL / 2, CELL - w / 2));
      if (!wallDecalFree(lv, s, along, w * 0.6)) continue;
      lv.decals.push({ kind: 'soot', ...wallDecalPose(s, along, WALL_H - h / 2, HT + 0.006), w, h, flip: r4.chance(0.5), variant: r4.int(0, 1) });
    }
    // 火從門口竄出來：門楣上方一片黑
    for (const d of lv.doors) {
      if (!r4.chance(0.6)) continue;
      const along = (d.o === 'h' ? d.x : d.y) * CELL + CELL / 2, plane = (d.o === 'h' ? d.y : d.x) * CELL;
      for (const side of [-1, 1]) {
        const off = side * (HT + 0.006), w = r4.range(1.6, 2.4), h = WALL_H - DOOR_H - 0.04;
        const y = DOOR_H + 0.02 + h / 2;
        const rot = d.o === 'h' ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        lv.decals.push({ kind: 'soot', x: d.o === 'h' ? along : plane + off, y, z: d.o === 'h' ? plane + off : along, rot, w, h, flip: r4.chance(0.5), variant: 2 });
      }
    }
  }
  if (D.scorch > 0) {
    for (const [x, y] of floorCells) {
      if (!r4.chance(D.scorch)) continue;
      lv.decals.push({ kind: 'scorch', x: (x + r4.range(0.25, 0.75)) * CELL, z: (y + r4.range(0.25, 0.75)) * CELL, rot: r4.range(0, 6.28), size: r4.range(1.4, 2.8), variant: r4.int(0, 1) });
    }
  }
  if (D.boarded > 0) {
    for (let y = 0; y <= lv.H; y++) for (let x = 0; x < lv.W; x++) if (lv.hEdge(x, y) === E.WINDOW && r4.chance(D.boarded)) lv.decals.push({ kind: 'prop', prop: 'boards', ...windowFor(lv, 'h', x, y) });
    for (let y = 0; y < lv.H; y++) for (let x = 0; x <= lv.W; x++) if (lv.vEdge(x, y) === E.WINDOW && r4.chance(D.boarded)) lv.decals.push({ kind: 'prop', prop: 'boards', ...windowFor(lv, 'v', x, y) });
  }
  if (lv.barricades.some((b) => b.rubble)) for (const b of lv.barricades) lv.decals.push({ kind: 'prop', prop: 'ceilingHole', x: b.cx, z: b.cz, rot: r4.range(0, 6.28), big: true });
  if (D.stripCurtains > 0) {
    // 進入無菌區的塑膠條門簾（地上一條紅線）：只掛在兩側都是實牆、沒有家具的直走廊上
    const isCorr = (x, y) => lv.cellAt(x, y) === CORRIDOR && !lv.blockedCell[y * lv.W + x];
    const done = [];
    for (const [x, y] of r4.shuffle(floorCells.slice())) {
      if (done.length >= D.stripCurtains) break;
      if (!isCorr(x, y) || done.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) < 4)) continue;
      const horiz = isCorr(x - 1, y) && isCorr(x + 1, y), vert = isCorr(x, y - 1) && isCorr(x, y + 1);
      if (horiz === vert) continue;
      if (horiz ? (lv.hEdge(x, y) !== E.WALL || lv.hEdge(x, y + 1) !== E.WALL || isCorr(x, y - 1) || isCorr(x, y + 1))
        : (lv.vEdge(x, y) !== E.WALL || lv.vEdge(x + 1, y) !== E.WALL || isCorr(x - 1, y) || isCorr(x + 1, y))) continue;
      const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
      const band = horiz ? { minX: cx - 0.25, maxX: cx + 0.25, minZ: y * CELL, maxZ: (y + 1) * CELL } : { minX: x * CELL, maxX: (x + 1) * CELL, minZ: cz - 0.25, maxZ: cz + 0.25 };
      if (lv.furniture.some((f) => overlaps(f.box, band)) || lv.items.some((it) => overlaps({ minX: it.x, maxX: it.x, minZ: it.z, maxZ: it.z }, band, 0.2))) continue;
      lv.decals.push({ kind: 'prop', prop: 'stripCurtain', x: cx, z: cz, rot: horiz ? Math.PI / 2 : 0 });
      done.push([x, y]);
    }
  }
}

function wallDecalFree(lv, s, along, width) {
  const p = wallDecalPose(s, along, 1.2);
  const box = { minX: p.x - width / 2 - 0.3, maxX: p.x + width / 2 + 0.3, minZ: p.z - width / 2 - 0.3, maxZ: p.z + width / 2 + 0.3 };
  for (const f of lv.furniture) if (FURN[f.kind].tall && overlaps(box, f.box)) return false;
  return true;
}

function wallDecalPose(s, along, y, off = HT + 0.012) {
  switch (s.side) {
    case 'N': return { x: along, y, z: s.wall + off, rot: 0 };
    case 'S': return { x: along, y, z: s.wall - off, rot: Math.PI };
    case 'W': return { x: s.wall + off, y, z: along, rot: Math.PI / 2 };
    default:  return { x: s.wall - off, y, z: along, rot: -Math.PI / 2 };
  }
}

// ---------------------------------------------------------------------------
// 屍體：挑一些病床與推床，決定姿勢、人物、要不要左右翻轉（垂下來的那一側要有空位），再在地上加一灘血
function assignCorpses(lv) {
  const r = new RNG((lv.seed ^ 0xc0a75e) >>> 0);
  const poseNames = Object.keys(CORPSE_POSES);
  // 家具的局部座標（橫向 a、縱向 b）轉成世界座標
  const toWorld = (f, a, b) => {
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    return f.kind === 'gurney' ? [f.x + b * c - a * s, f.z - b * s - a * c] : [f.x + a * c + b * s, f.z - a * s + b * c];
  };
  const roomOf = (x, z) => lv.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
  // 床的某一側（-1 / +1）往外 d 公尺的地方是不是空的
  const sideFree = (f, side, d) => {
    const half = f.kind === 'gurney' ? 0.31 : 0.46;
    const room = roomOf(f.x, f.z);
    for (const dd of [0.2, d * 0.6, d]) for (const b of [-0.6, 0, 0.5]) {
      const [x, z] = toWorld(f, side * (half + dd), b);
      for (const [ox, oz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) if (roomOf(x + ox, z + oz) !== room) return false;
      const box = { minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12 };
      for (const o of lv.furniture) if (o !== f && overlaps(box, o.box)) return false;
      // 門打開時掃過的範圍、床邊的隔簾
      for (const o of lv.blockers) if (o.clearance && overlaps(box, o)) return false;
      for (const c of curtains) if (segDist(x, z, c) < 0.2) return false;
    }
    return true;
  };
  const curtains = lv.decals.filter((d) => d.kind === 'curtain');
  const segDist = (x, z, c) => {
    const dx = Math.sin(c.rot), dz = Math.cos(c.rot);
    const t = Math.max(-c.len / 2, Math.min(c.len / 2, (x - c.x) * dx + (z - c.z) * dz));
    return Math.hypot(x - c.x - dx * t, z - c.z - dz * t);
  };
  // 滑到床外的上半身要擋住玩家（只在不會把房間隔斷時才擺這個姿勢）
  const overhang = (f, side) => {
    const half = f.kind === 'gurney' ? 0.31 : 0.46;
    const pts = [[half, -0.75], [half + 0.85, -0.75], [half, 0.55], [half + 0.85, 0.55]].map(([a, b]) => toWorld(f, side * a, b));
    return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])) };
  };
  const hangOk = (f, side, name) => {
    if (!sideFree(f, side, CORPSE_POSES[name].hang)) return false;
    if (name !== 'halfoff') return true;
    const o = overhang(f, side);
    // 地上已經擺好的道具不能被擋住
    for (const it of lv.items) if (it.y <= 0.01 && overlaps(o, { minX: it.x, maxX: it.x, minZ: it.z, maxZ: it.z }, 0.2)) return false;
    return roomStaysConnected(lv, lv.rooms[f.room], o);
  };
  // 解剖台與拉出來的冷藏抽屜也可以躺人（只用平躺類、不垂到外面的姿勢）
  const flat = (k) => k === 'autopsy' || k === 'tray';
  const cands = lv.furniture.filter((f) => (f.kind === 'bed' && (f.variant || 0) !== 2 && r.chance(0.42)) || (f.kind === 'gurney' && f.body && r.chance(0.75))
    || (f.kind === 'autopsy' && r.chance(0.6)) || (f.kind === 'tray' && f.body && r.chance(0.55)));
  let n = 0;
  for (const f of r.shuffle(cands)) {
    if (n >= (lv.theme === 'morgue' ? 10 : 7)) break;
    const opts = [];
    for (const name of poseNames) {
      const p = CORPSE_POSES[name];
      if (f.kind === 'gurney' && !p.gurney) continue;
      if (flat(f.kind) && (p.hang || !p.gurney)) continue;
      if (!p.hang) { opts.push([name, r.chance(0.5), p.w]); continue; }
      // 預設垂向 -X 側；翻轉後垂向 +X 側
      if (hangOk(f, -1, name)) opts.push([name, false, p.w]);
      else if (hangOk(f, 1, name)) opts.push([name, true, p.w]);
    }
    if (!opts.length) continue;
    const [pose, mirror] = r.weighted(opts.map((o) => [o, o[2]]));
    const avatar = r.pick(CORPSE_POSES[pose].avatars);
    f.corpse = { name: `${avatar}_${pose}`, pose, mirror };
    // 碰撞箱等真的擺出模型時才加上（world.js），模型沒載入就不會有看不見的牆
    if (pose === 'halfoff') f.corpse.overhang = overhang(f, mirror ? 1 : -1);
    n++;
    // 地上的血：垂下來的手或頭底下一灘，其他的有時候從床底滲出來
    const side = mirror ? 1 : -1, half = f.kind === 'gurney' ? 0.31 : 0.46;
    let spot = null, size = r.range(0.6, 1.0);
    if (pose === 'dangle') spot = toWorld(f, side * (half + 0.12), -0.18 + corpseShift(f.corpse.name, f.kind)); // 垂下來的手底下
    else if (pose === 'halfoff') { spot = toWorld(f, side * (half + 0.55), 0.25); size = r.range(1.0, 1.5); }
    else if (r.chance(0.45)) spot = toWorld(f, r.range(-0.2, 0.2), r.range(-0.2, 0.4));
    if (spot) lv.decals.push({ kind: 'blood', x: spot[0], z: spot[1], rot: r.range(0, 6.28), size, variant: r.int(0, 3) });
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
  // 觀察窗 / 鐵籠：牆中間開一個洞（下面是窗台，上面是過梁），洞裡放玻璃或鐵條（world.js）
  lv.obsOpenings = [];
  const obsPieces = (o, a0, a1, plane, kind) => {
    const m = (a0 + a1) / 2;
    const w = kind === 'cage' ? CELL - 0.55 : 1.1, y0 = kind === 'cage' ? 1.0 : 1.15, y1 = kind === 'cage' ? 2.6 : 1.85;
    if (o === 'h') {
      piece(a0 + HT, m - w / 2, 0, WALL_H, plane - HT, plane + HT, { jamb: 'obs' });
      piece(m + w / 2, a1 - HT, 0, WALL_H, plane - HT, plane + HT, { jamb: 'obs' });
      piece(m - w / 2, m + w / 2, 0, y0, plane - HT, plane + HT, { sill: true });
      piece(m - w / 2, m + w / 2, y1, WALL_H, plane - HT, plane + HT, { lintel: true });
    } else {
      piece(plane - HT, plane + HT, 0, WALL_H, a0 + HT, m - w / 2, { jamb: 'obs' });
      piece(plane - HT, plane + HT, 0, WALL_H, m + w / 2, a1 - HT, { jamb: 'obs' });
      piece(plane - HT, plane + HT, 0, y0, m - w / 2, m + w / 2, { sill: true });
      piece(plane - HT, plane + HT, y1, WALL_H, m - w / 2, m + w / 2, { lintel: true });
    }
    lv.obsOpenings.push({ o, kind, x: o === 'h' ? m : plane, z: o === 'h' ? plane : m, w, y0, y1, rot: o === 'h' ? 0 : Math.PI / 2 });
  };
  const obsAt = (o, x, y) => lv.obs && lv.obs.get(`${o}${x},${y}`);
  for (let y = 0; y <= lv.H; y++) for (let x = 0; x < lv.W; x++) {
    const t = lv.hEdge(x, y);
    if (!isWallish(t)) continue;
    const a0 = x * CELL, a1 = a0 + CELL, z = y * CELL;
    if (t === E.WALL && obsAt('h', x, y)) obsPieces('h', a0, a1, z, obsAt('h', x, y));
    else if (t === E.WALL || t === E.WINDOW) {
      piece(a0 + HT, a1 - HT, 0, WALL_H, z - HT, z + HT, { window: t === E.WINDOW, o: 'h', ex: x, ey: y });
      if (t === E.WINDOW) lv.windows.push(windowFor(lv, 'h', x, y));
    } else if (t === E.DOOR) openingPieces('h', a0, a1, z, DOOR_W, DOOR_H, 'door');
    else if (t === E.GATE) openingPieces('h', a0, a1, z, GATE_W, GATE_H, 'gate');
  }
  for (let y = 0; y < lv.H; y++) for (let x = 0; x <= lv.W; x++) {
    const t = lv.vEdge(x, y);
    if (!isWallish(t)) continue;
    const a0 = y * CELL, a1 = a0 + CELL, px = x * CELL;
    if (t === E.WALL && obsAt('v', x, y)) obsPieces('v', a0, a1, px, obsAt('v', x, y));
    else if (t === E.WALL || t === E.WINDOW) {
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

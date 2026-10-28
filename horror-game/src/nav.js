// 碰撞、尋路（A*）與視線判定。純邏輯，可在 Node 測試。
import { CELL, NAV_RES, DOOR_W, GATE_W, GHOST_R } from './config.js';
import { E, VOID, FURN } from './level.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// 碰撞：靜態盒子放進粗網格桶裡，動態物件（門、大門、輪椅）每次查詢時另外檢查
export class Collision {
  constructor(lv) {
    this.lv = lv;
    this.bw = lv.W;
    this.bh = lv.H;
    this.buckets = Array.from({ length: lv.W * lv.H }, () => []);
    this.dynamic = [];
    for (const p of lv.wallPieces) {
      if (p.minY > 2.0) continue; // 門楣在頭頂上方
      this.addStatic(p);
    }
    for (const f of lv.furniture) {
      if (f.kind === 'fusebox') continue;
      this.addStatic({ ...f.box, minY: 0, maxY: FURN[f.kind].h, furn: f });
    }
    for (const b of lv.barricades) {
      const m = 0.1;
      this.addStatic({ minX: b.x * CELL + m, maxX: (b.x + 1) * CELL - m, minZ: b.y * CELL + m, maxZ: (b.y + 1) * CELL - m, minY: 0, maxY: 2 });
    }
  }
  addStatic(box) {
    const x0 = clamp(Math.floor((box.minX - 0.5) / CELL), 0, this.bw - 1);
    const x1 = clamp(Math.floor((box.maxX + 0.5) / CELL), 0, this.bw - 1);
    const z0 = clamp(Math.floor((box.minZ - 0.5) / CELL), 0, this.bh - 1);
    const z1 = clamp(Math.floor((box.maxZ + 0.5) / CELL), 0, this.bh - 1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.buckets[z * this.bw + x].push(box);
  }
  removeStaticFurniture(f) {
    for (const b of this.buckets) {
      const i = b.findIndex((bx) => bx.furn === f);
      if (i >= 0) b.splice(i, 1);
    }
  }
  // 推開一個圓（玩家 / 鬼魂），回傳是否有碰撞
  resolve(pos, r) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const bx = clamp(Math.floor(pos.x / CELL), 0, this.bw - 1);
      const bz = clamp(Math.floor(pos.z / CELL), 0, this.bh - 1);
      const list = this.buckets[bz * this.bw + bx];
      for (let i = 0; i < list.length; i++) if (pushOut(pos, r, list[i])) moved = true;
      for (const d of this.dynamic) {
        const box = d.getBox ? d.getBox() : d.box;
        if (box && pushOut(pos, r, box)) moved = true;
      }
      if (!moved) break;
      hit = true;
    }
    // 不要掉出地圖
    const [cx, cz] = [Math.floor(pos.x / CELL), Math.floor(pos.z / CELL)];
    if (this.lv.cellAt(cx, cz) === VOID && !this.allowOutside) { pos.x = this.lastSafe?.x ?? pos.x; pos.z = this.lastSafe?.z ?? pos.z; }
    else this.lastSafe = { x: pos.x, z: pos.z };
    return hit;
  }
  overlapsStatic(x, z, r) {
    const bx = clamp(Math.floor(x / CELL), 0, this.bw - 1);
    const bz = clamp(Math.floor(z / CELL), 0, this.bh - 1);
    for (const b of this.buckets[bz * this.bw + bx]) {
      const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return this.lv.cellAt(Math.floor(x / CELL), Math.floor(z / CELL)) < 0;
  }
  // 圓與所有靜態 / 動態盒子是否重疊
  overlapsAny(x, z, r) {
    const bx = clamp(Math.floor(x / CELL), 0, this.bw - 1);
    const bz = clamp(Math.floor(z / CELL), 0, this.bh - 1);
    const p = { x, z };
    for (const b of this.buckets[bz * this.bw + bx]) {
      const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    for (const d of this.dynamic) {
      const b = d.getBox ? d.getBox() : d.box;
      if (!b) continue;
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }
}

function pushOut(pos, r, b) {
  const cx = clamp(pos.x, b.minX, b.maxX), cz = clamp(pos.z, b.minZ, b.maxZ);
  const dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const push = r - d + 1e-4;
    pos.x += (dx / d) * push;
    pos.z += (dz / d) * push;
  } else {
    const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bb = b.maxZ - pos.z;
    const m = Math.min(l, rr, t, bb);
    if (m === l) pos.x = b.minX - r - 1e-4;
    else if (m === rr) pos.x = b.maxX + r + 1e-4;
    else if (m === t) pos.z = b.minZ - r - 1e-4;
    else pos.z = b.maxZ + r + 1e-4;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 視線：沿著粗網格走訪，檢查跨越的每一條邊
export function sightClear(lv, ax, az, bx, bz) {
  let cx = Math.floor(ax / CELL), cz = Math.floor(az / CELL);
  const tx = Math.floor(bx / CELL), tz = Math.floor(bz / CELL);
  const dx = bx - ax, dz = bz - az;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
  const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (stepX > 0 ? (cx + 1) * CELL - ax : ax - cx * CELL) / adx : Infinity;
  let tMaxZ = adz > 1e-9 ? (stepZ > 0 ? (cz + 1) * CELL - az : az - cz * CELL) / adz : Infinity;
  for (let guard = 0; guard < 256 && (cx !== tx || cz !== tz); guard++) {
    if (tMaxX < tMaxZ) {
      if (tMaxX > 1) break;
      const ex = stepX > 0 ? cx + 1 : cx;
      const along = az + dz * tMaxX - cz * CELL;
      if (!edgeOpen(lv, 'v', ex, cz, along)) return false;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (tMaxZ > 1) break;
      const ez = stepZ > 0 ? cz + 1 : cz;
      const along = ax + dx * tMaxZ - cx * CELL;
      if (!edgeOpen(lv, 'h', cx, ez, along)) return false;
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (lv.cellAt(cx, cz) === VOID) return false;
  }
  return true;
}

function edgeOpen(lv, o, x, y, along) {
  const t = o === 'h' ? lv.hEdge(x, y) : lv.vEdge(x, y);
  if (t === E.NONE || t === E.OPEN) return true;
  if (t === E.WALL || t === E.WINDOW) return false;
  if (t === E.DOOR) {
    const d = lv.doorAt(o, x, y);
    if (d && Math.abs(d.angle) < 1.0) return false;
    return along > (CELL - DOOR_W) / 2 && along < (CELL + DOOR_W) / 2;
  }
  if (t === E.GATE) {
    if (!lv.gate || !lv.gate.open) return false;
    return along > (CELL - GATE_W) / 2 && along < (CELL + GATE_W) / 2;
  }
  return false;
}

// 水平射線到第一道牆的距離（給手電筒自動曝光用）
export function rayWallDistance(lv, ax, az, dx, dz, maxD = 30) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return maxD;
  dx /= len; dz /= len;
  const bx = ax + dx * maxD, bz = az + dz * maxD;
  let cx = Math.floor(ax / CELL), cz = Math.floor(az / CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const adx = Math.abs(bx - ax), adz = Math.abs(bz - az);
  const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
  const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (stepX > 0 ? (cx + 1) * CELL - ax : ax - cx * CELL) / adx : Infinity;
  let tMaxZ = adz > 1e-9 ? (stepZ > 0 ? (cz + 1) * CELL - az : az - cz * CELL) / adz : Infinity;
  for (let guard = 0; guard < 64; guard++) {
    if (tMaxX < tMaxZ) {
      if (tMaxX > 1) break;
      const ex = stepX > 0 ? cx + 1 : cx;
      if (!edgeOpen(lv, 'v', ex, cz, az + (bz - az) * tMaxX - cz * CELL)) return tMaxX * maxD;
      cx += stepX; tMaxX += tDeltaX;
    } else {
      if (tMaxZ > 1) break;
      const ez = stepZ > 0 ? cz + 1 : cz;
      if (!edgeOpen(lv, 'h', cx, ez, ax + (bx - ax) * tMaxZ - cx * CELL)) return tMaxZ * maxD;
      cz += stepZ; tMaxZ += tDeltaZ;
    }
  }
  return maxD;
}

// 聲音遮蔽：牆壁數（0 = 直達）
export function wallsBetween(lv, ax, az, bx, bz, max = 3) {
  let n = 0;
  let cx = Math.floor(ax / CELL), cz = Math.floor(az / CELL);
  const tx = Math.floor(bx / CELL), tz = Math.floor(bz / CELL);
  const dx = bx - ax, dz = bz - az;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
  const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (stepX > 0 ? (cx + 1) * CELL - ax : ax - cx * CELL) / adx : Infinity;
  let tMaxZ = adz > 1e-9 ? (stepZ > 0 ? (cz + 1) * CELL - az : az - cz * CELL) / adz : Infinity;
  for (let guard = 0; guard < 256 && (cx !== tx || cz !== tz); guard++) {
    if (tMaxX < tMaxZ) {
      if (tMaxX > 1) break;
      const ex = stepX > 0 ? cx + 1 : cx;
      if (!edgeOpen(lv, 'v', ex, cz, az + dz * tMaxX - cz * CELL)) n++;
      cx += stepX; tMaxX += tDeltaX;
    } else {
      if (tMaxZ > 1) break;
      const ez = stepZ > 0 ? cz + 1 : cz;
      if (!edgeOpen(lv, 'h', cx, ez, ax + dx * tMaxZ - cx * CELL)) n++;
      cz += stepZ; tMaxZ += tDeltaZ;
    }
    if (n >= max) return n;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 尋路網格
export class NavGrid {
  constructor(lv, radius, opts = {}) {
    this.lv = lv;
    this.res = NAV_RES;
    this.nw = Math.ceil((lv.W * CELL) / this.res);
    this.nh = Math.ceil((lv.H * CELL) / this.res);
    const n = this.nw * this.nh;
    this.blocked = new Uint8Array(n);
    for (let j = 0; j < this.nh; j++) for (let i = 0; i < this.nw; i++) {
      const x = (i + 0.5) * this.res, z = (j + 0.5) * this.res;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (lv.cellAt(cx, cz) === VOID || lv.blockedCell[cz * lv.W + cx]) this.blocked[j * this.nw + i] = 1;
    }
    const mark = (b, r) => {
      const i0 = clamp(Math.floor((b.minX - r) / this.res), 0, this.nw - 1);
      const i1 = clamp(Math.floor((b.maxX + r) / this.res), 0, this.nw - 1);
      const j0 = clamp(Math.floor((b.minZ - r) / this.res), 0, this.nh - 1);
      const j1 = clamp(Math.floor((b.maxZ + r) / this.res), 0, this.nh - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * this.res, z = (j + 0.5) * this.res;
        const qx = clamp(x, b.minX, b.maxX), qz = clamp(z, b.minZ, b.maxZ);
        if ((x - qx) ** 2 + (z - qz) ** 2 < r * r) this.blocked[j * this.nw + i] = 1;
      }
    };
    for (const p of lv.wallPieces) if (p.minY < 2.0) mark(p, radius);
    if (!opts.ignoreFurniture) {
      for (const f of lv.furniture) {
        if (f.kind === 'fusebox') continue;
        if (opts.ghost && (f.kind === 'chair' || f.kind === 'bin' || f.kind === 'ivstand' || f.kind === 'wheelchair')) continue;
        mark(f.box, radius);
      }
    }
    // 大門外面不能走
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.cur = 1;
    this.heap = new Int32Array(n * 4);
  }
  idx(x, z) {
    const i = clamp(Math.floor(x / this.res), 0, this.nw - 1);
    const j = clamp(Math.floor(z / this.res), 0, this.nh - 1);
    return j * this.nw + i;
  }
  center(k) { return { x: ((k % this.nw) + 0.5) * this.res, z: (Math.floor(k / this.nw) + 0.5) * this.res }; }
  isFree(x, z) { return !this.blocked[this.idx(x, z)]; }
  nearestFree(x, z, maxR = 6) {
    const k0 = this.idx(x, z);
    if (!this.blocked[k0]) return k0;
    const i0 = k0 % this.nw, j0 = Math.floor(k0 / this.nw);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= this.nw || j >= this.nh) continue;
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        const k = j * this.nw + i;
        if (this.blocked[k]) continue;
        const c = this.center(k);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // 從某點可達的所有格子（BFS）
  reachable(x, z) {
    const start = this.nearestFree(x, z);
    const seen = new Uint8Array(this.nw * this.nh);
    if (start < 0) return seen;
    const q = [start];
    seen[start] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi], i = k % this.nw, j = Math.floor(k / this.nw);
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [di, dj] of nb) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= this.nw || nj >= this.nh) continue;
        const nk = nj * this.nw + ni;
        if (seen[nk] || this.blocked[nk]) continue;
        seen[nk] = 1;
        q.push(nk);
      }
    }
    return seen;
  }
  findPath(sx, sz, tx, tz, maxIter = 12000) {
    const s = this.nearestFree(sx, sz), t = this.nearestFree(tx, tz);
    if (s < 0 || t < 0) return null;
    if (s === t) return [{ x: tx, z: tz }];
    const nw = this.nw, nh = this.nh;
    this.cur++;
    if (this.cur > 4e9) { this.stamp.fill(0); this.closedStamp.fill(0); this.cur = 1; }
    const cur = this.cur;
    const ti = t % nw, tj = Math.floor(t / nw);
    const h = (k) => {
      const di = Math.abs((k % nw) - ti), dj = Math.abs(Math.floor(k / nw) - tj);
      return (di + dj) + (Math.SQRT2 - 2) * Math.min(di, dj);
    };
    const heap = this.heap;
    let hn = 0;
    const f = this.f, g = this.g;
    const push = (k) => {
      let i = hn++;
      heap[i] = k;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hn];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hn && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hn && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
      }
      return top;
    };
    this.stamp[s] = cur;
    g[s] = 0;
    f[s] = h(s);
    this.came[s] = -1;
    push(s);
    let iter = 0;
    while (hn > 0 && iter++ < maxIter) {
      const k = pop();
      if (k === t) break;
      if (this.closedStamp[k] === cur) continue;
      this.closedStamp[k] = cur;
      const i = k % nw, j = Math.floor(k / nw);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nw || nj >= nh) continue;
        const nk = nj * nw + ni;
        if (this.blocked[nk]) continue;
        if (di && dj && (this.blocked[j * nw + ni] || this.blocked[nj * nw + i])) continue;
        const ng = g[k] + (di && dj ? Math.SQRT2 : 1);
        if (this.stamp[nk] !== cur || ng < g[nk]) {
          this.stamp[nk] = cur;
          g[nk] = ng;
          f[nk] = ng + h(nk);
          this.came[nk] = k;
          if (hn < heap.length) push(nk);
        }
      }
    }
    if (this.stamp[t] !== cur) return null;
    const raw = [];
    for (let k = t, guard = 0; k !== -1 && guard < 100000; k = this.came[k], guard++) {
      raw.push(k);
      if (k === s) break;
    }
    raw.reverse();
    // 拉直路徑
    const pts = raw.map((k) => this.center(k));
    pts[pts.length - 1] = { x: tx, z: tz };
    const out = [];
    let a = { x: sx, z: sz };
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineFree(a.x, a.z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      a = pts[j];
      i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }
  lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / (this.res * 0.35));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (this.blocked[this.idx(ax + (bx - ax) * t, az + (bz - az) * t)]) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// 關卡驗證：所有道具、置物櫃、配電箱、大門、樓梯都必須走得到（她也要走得到樓梯）
export function validateLevel(lv, playerRadius = 0.3) {
  const nav = new NavGrid(lv, playerRadius);
  const seen = nav.reachable(lv.spawn.x, lv.spawn.z);
  const near = (x, z, r) => {
    const i0 = Math.floor((x - r) / nav.res), i1 = Math.floor((x + r) / nav.res);
    const j0 = Math.floor((z - r) / nav.res), j1 = Math.floor((z + r) / nav.res);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= nav.nw || j >= nav.nh) continue;
      const k = j * nav.nw + i;
      if (!seen[k]) continue;
      const c = nav.center(k);
      if (Math.hypot(c.x - x, c.z - z) <= r) return true;
    }
    return false;
  };
  if (!seen[nav.nearestFree(lv.spawn.x, lv.spawn.z)]) return 'spawn blocked';
  // 互動射線長 2.4m：檯面上的道具水平可以遠一點
  for (const it of lv.items) if (!near(it.x, it.z, it.y > 0.3 ? 1.55 : 1.2)) return `item ${it.kind} unreachable`;
  for (const l of lv.lockers) if (!near(l.exitX, l.exitZ, 0.5)) return `locker ${l.id} blocked`;
  const fb = lv.fusebox;
  if (lv.generatorRoom) {
    if (!fb) return 'no fusebox';
    const fx = fb.x + Math.sin(fb.rot) * 0.8, fz = fb.z + Math.cos(fb.rot) * 0.8;
    if (!near(fx, fz, 0.6)) return 'fusebox unreachable';
  }
  if (lv.gate && !near(lv.gate.x, lv.gate.z - 0.8, 0.6)) return 'gate unreachable';
  const stairs = lv.stairs || [];
  if (stairs.length !== (lv.stairPlan || []).length) return 'stairs missing';
  for (const s of stairs) {
    if (!near(s.use.x, s.use.z, 0.6)) return `stairs ${s.id} unreachable`;
    if (!near(s.arrive.x, s.arrive.z, 0.35)) return `stairs ${s.id} arrival blocked`;
  }
  for (const d of lv.doors) {
    const along = (d.o === 'h' ? d.x : d.y) * CELL + CELL / 2;
    const plane = (d.o === 'h' ? d.y : d.x) * CELL;
    const px = d.o === 'h' ? along : plane, pz = d.o === 'h' ? plane : along;
    if (!near(px, pz, 0.6)) return `door ${d.id} unreachable`;
  }
  // 每個房間至少有一個格子可以到
  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    if (!near(room.cx, room.cz, CELL * 0.75 * Math.max(room.w, room.h))) return `room ${room.id} unreachable`;
  }
  // 鬼魂的尋路網格比較粗：家具擠在一起時她可能進不了房間，這種樓層重新生成
  const gnav = new NavGrid(lv, GHOST_R, { ghost: true });
  const gseen = gnav.reachable(lv.spawn.x, lv.spawn.z);
  for (const room of lv.rooms) {
    if (room.id === 0) continue;
    const k = gnav.nearestFree(room.cx, room.cz);
    if (k < 0 || !gseen[k]) return `room ${room.id} unreachable for ghost`;
  }
  for (const s of stairs) {
    const k = gnav.nearestFree(s.use.x, s.use.z, 2);
    if (k < 0 || !gseen[k]) return `stairs ${s.id} unreachable for ghost`;
  }
  return null;
}


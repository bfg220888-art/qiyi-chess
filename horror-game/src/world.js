// 把關卡資料變成 three.js 場景
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H, WALL_T, DOOR_W, DOOR_H, GATE_W, GATE_H } from './config.js';
import { VOID, FURN, WALL_WRITINGS } from './level.js';
import { PropBuilder, mergeLocal } from './props.js';
import { createMaterials, drawFloorPlan } from './materials.js';
import { makeCorpse, placeCorpse } from './corpses.js';
import { THEMES } from './themes.js';

const HT = WALL_T / 2;
const CHUNK = 6;
const AO_KNOTS = [[0, 0.42], [0.12, 0.62], [0.45, 0.9], [1.2, 1.0], [WALL_H - 0.35, 1.0], [WALL_H, 0.7]];
function aoAt(y) {
  for (let i = 1; i < AO_KNOTS.length; i++) {
    const [y1, v1] = AO_KNOTS[i];
    if (y <= y1) {
      const [y0, v0] = AO_KNOTS[i - 1];
      return v0 + (v1 - v0) * ((y - y0) / Math.max(1e-6, y1 - y0));
    }
  }
  return AO_KNOTS[AO_KNOTS.length - 1][1];
}

class GeoBuilder {
  constructor(withColor = false) { this.p = []; this.n = []; this.u = []; this.c = withColor ? [] : null; this.i = []; }
  // a,b,c,d：逆時針（從正面看）左下、右下、右上、左上
  quad(a, b, c, d, n, uv, col) {
    const base = this.p.length / 3;
    for (const v of [a, b, c, d]) this.p.push(v[0], v[1], v[2]);
    for (let k = 0; k < 4; k++) this.n.push(n[0], n[1], n[2]);
    for (const t of uv) this.u.push(t[0], t[1]);
    if (this.c) for (const v of col) this.c.push(v, v, v);
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.p.length === 0; }
}

// 給地板 / 天花板加上整層的環境遮蔽（牆角、家具底下比較暗）
function applyLevelAO(mat, tex, sizeX, sizeZ, strength) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLevelAO = { value: tex };
    sh.uniforms.uLevelAOScale = { value: new THREE.Vector2(1 / sizeX, 1 / sizeZ) };
    sh.uniforms.uLevelAOStrength = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLevelUv;\nuniform vec2 uLevelAOScale;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLevelUv = (modelMatrix * vec4(transformed, 1.0)).xz * uLevelAOScale;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLevelUv;\nuniform sampler2D uLevelAO;\nuniform float uLevelAOStrength;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, texture2D(uLevelAO, vLevelUv).r, uLevelAOStrength);');
  };
  mat.customProgramCacheKey = () => 'levelAO' + strength;
}

export class World {
  constructor(renderer, scene, lv, tf, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.lv = lv;
    this.tf = tf;
    this.q = quality;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.static = new Map(); // materialKey -> Map(chunkKey -> geos)
    this.interactables = [];
    this.removed = [];
    this.time = 0;
    this.lightningT = 0;
    this.power = 0;
    this.theme = THEMES[lv.theme] || THEMES.ward;
  }

  build() {
    const M = (this.M = createMaterials(this.tf, this.lv.theme));
    this.props = new PropBuilder(M, this.lv.seed ^ 0x5bd1e995);
    this.buildAO();
    this.buildShell();
    this.buildDoors();
    this.buildWindows();
    this.buildObservation();
    this.buildFurniture();
    this.buildFixtures();
    this.buildDecals();
    this.buildGate();
    this.buildLobbyExtras();
    this.flushStatic();
    this.buildItems();
    this.buildDust();
    // 微弱環境光：完全不開燈時也不是純黑（但非常暗）
    this.hemi = new THREE.HemisphereLight(this.theme.look.hemiSky, this.theme.look.hemiGround, 0.04);
    this.scene.add(this.hemi);
  }

  // ---------------------------------------------------------------------
  addStatic(geo, mat, cx, cz, opts = {}) {
    const key = mat.uuid + (opts.noShadow ? ':ns' : '') + (opts.noCast ? ':nc' : '');
    if (!this.static.has(key)) this.static.set(key, { mat, opts, chunks: new Map() });
    const ck = Math.floor(cx / (CELL * CHUNK)) + ',' + Math.floor(cz / (CELL * CHUNK));
    const entry = this.static.get(key);
    if (!entry.chunks.has(ck)) entry.chunks.set(ck, []);
    entry.chunks.get(ck).push(geo);
  }
  // 把一個 Group 的所有 mesh 烘進靜態合併表
  bakeGroup(group, opts = {}) {
    group.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    group.traverse((o) => {
      if (!o.isMesh || o.userData.dynamic) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      if (geo.index === null) return;
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      let mat = o.material;
      let tint = null;
      if (mat.userData.bakeAs) { tint = mat.color; mat = mat.userData.bakeAs; }
      if (mat.vertexColors) {
        const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
        const c = tint || { r: 1, g: 1, b: 1 };
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      o.getWorldPosition(wp);
      this.addStatic(geo, mat, wp.x, wp.z, { noShadow: opts.noShadow || o.userData.noShadow, noCast: opts.noCast });
    });
  }
  flushStatic() {
    for (const { mat, opts, chunks } of this.static.values()) {
      for (const geos of chunks.values()) {
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, mat);
        m.castShadow = !opts.noShadow && !opts.noCast;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        this.root.add(m);
        for (const g of geos) if (g !== merged) g.dispose();
      }
    }
    this.static.clear();
  }

  // ---------------------------------------------------------------------
  buildAO() {
    const lv = this.lv, ppc = 32;
    const w = lv.W * ppc, h = lv.H * ppc;
    const s = ppc / CELL;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#000';
    for (const p of lv.wallPieces) if (p.minY < 1) g.fillRect(p.minX * s - 1, p.minZ * s - 1, (p.maxX - p.minX) * s + 2, (p.maxZ - p.minZ) * s + 2);
    g.fillStyle = 'rgba(0,0,0,0.75)';
    for (const f of lv.furniture) {
      if (f.kind === 'fusebox' || f.kind === 'ivstand' || f.kind === 'chair') continue;
      const b = f.box;
      g.fillRect(b.minX * s, b.minZ * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    }
    for (const b of lv.barricades) g.fillRect(b.x * ppc + 4, b.y * ppc + 4, ppc - 8, ppc - 8);
    // 盒狀模糊（三次 ≈ 高斯）
    const img = g.getImageData(0, 0, w, h);
    let a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4] / 255;
    const blur = (src, r) => {
      const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
          tmp[y * w + x] = acc / (2 * r + 1);
          acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
          out[y * w + x] = acc / (2 * r + 1);
          acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
        }
      }
      return out;
    };
    for (let k = 0; k < 3; k++) a = blur(a, 5);
    for (let i = 0; i < a.length; i++) {
      const v = 0.3 + 0.7 * Math.pow(a[i], 0.8);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    this.aoTex = t;
    const sx = lv.W * CELL, sz = lv.H * CELL;
    for (const m of Object.values(this.M.floors)) applyLevelAO(m, t, sx, sz, 1.0);
    applyLevelAO(this.M.ceiling, t, sx, sz, 0.55);
  }

  // 牆、地板、天花板
  buildShell() {
    const lv = this.lv, M = this.M;
    const wallBuilders = new Map();
    const look = this.theme.look;
    // 牆面材質看「這一面朝向哪個房間」：軟墊隔離室的牆面是軟墊，走廊那一面還是油漆
    const wallKindAt = (x, z) => {
      const id = lv.cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
      const room = id > 0 ? lv.rooms[id] : null;
      return (room && look.wall[room.type]) || look.wall.default;
    };
    const getWB = (cx, cz, kind) => {
      const k = kind + '|' + Math.floor(cx / (CELL * CHUNK)) + ',' + Math.floor(cz / (CELL * CHUNK));
      if (!wallBuilders.has(k)) wallBuilders.set(k, { b: new GeoBuilder(true), x: cx, z: cz, kind });
      return wallBuilders.get(k).b;
    };
    const cuts = (y0, y1) => {
      const ys = [y0];
      for (const [ky] of AO_KNOTS) if (ky > y0 + 1e-3 && ky < y1 - 1e-3) ys.push(ky);
      ys.push(y1);
      return ys;
    };
    const voidAt = (x, z) => lv.cellAt(Math.floor(x / CELL), Math.floor(z / CELL)) === VOID;
    for (const p of lv.wallPieces) {
      const ys = cuts(p.minY, p.maxY);
      const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
      const B = (x, z) => getWB(cx, cz, wallKindAt(x, z));
      const b = B(cx, cz);
      const U = (v) => v / CELL;
      for (let k = 0; k < ys.length - 1; k++) {
        const y0 = ys[k], y1 = ys[k + 1];
        const v0 = y0 / WALL_H, v1 = y1 / WALL_H, a0 = aoAt(y0), a1 = aoAt(y1);
        const col = [a0, a0, a1, a1];
        // +z
        if (!voidAt(cx, p.maxZ + 0.05)) B(cx, p.maxZ + 0.05).quad([p.minX, y0, p.maxZ], [p.maxX, y0, p.maxZ], [p.maxX, y1, p.maxZ], [p.minX, y1, p.maxZ], [0, 0, 1], [[U(p.minX), v0], [U(p.maxX), v0], [U(p.maxX), v1], [U(p.minX), v1]], col);
        // -z
        if (!voidAt(cx, p.minZ - 0.05)) B(cx, p.minZ - 0.05).quad([p.maxX, y0, p.minZ], [p.minX, y0, p.minZ], [p.minX, y1, p.minZ], [p.maxX, y1, p.minZ], [0, 0, -1], [[-U(p.maxX), v0], [-U(p.minX), v0], [-U(p.minX), v1], [-U(p.maxX), v1]], col);
        // +x
        if (!voidAt(p.maxX + 0.05, cz)) B(p.maxX + 0.05, cz).quad([p.maxX, y0, p.maxZ], [p.maxX, y0, p.minZ], [p.maxX, y1, p.minZ], [p.maxX, y1, p.maxZ], [1, 0, 0], [[-U(p.maxZ), v0], [-U(p.minZ), v0], [-U(p.minZ), v1], [-U(p.maxZ), v1]], col);
        // -x
        if (!voidAt(p.minX - 0.05, cz)) B(p.minX - 0.05, cz).quad([p.minX, y0, p.minZ], [p.minX, y0, p.maxZ], [p.minX, y1, p.maxZ], [p.minX, y1, p.minZ], [-1, 0, 0], [[U(p.minZ), v0], [U(p.maxZ), v0], [U(p.maxZ), v1], [U(p.minZ), v1]], col);
      }
      if (p.lintel) {
        const y = p.minY, a = aoAt(y);
        b.quad([p.minX, y, p.minZ], [p.maxX, y, p.minZ], [p.maxX, y, p.maxZ], [p.minX, y, p.maxZ], [0, -1, 0], [[U(p.minX), U(p.minZ)], [U(p.maxX), U(p.minZ)], [U(p.maxX), U(p.maxZ)], [U(p.minX), U(p.maxZ)]], [a, a, a, a]);
      }
      if (p.sill) {
        // 觀察窗的窗台頂面
        const y = p.maxY, a = aoAt(y);
        b.quad([p.minX, y, p.maxZ], [p.maxX, y, p.maxZ], [p.maxX, y, p.minZ], [p.minX, y, p.minZ], [0, 1, 0], [[U(p.minX), U(p.maxZ)], [U(p.maxX), U(p.maxZ)], [U(p.maxX), U(p.minZ)], [U(p.minX), U(p.minZ)]], [a, a, a, a]);
      }
    }
    for (const { b, x, z, kind } of wallBuilders.values()) {
      if (b.empty) continue;
      this.addStatic(b.build(), M.walls[kind] || M.wall, x, z);
    }
    // 地板與天花板
    const floorB = new Map();
    const fb = (mat, cx, cz) => {
      const k = mat.uuid + '|' + Math.floor(cx / (CELL * CHUNK)) + ',' + Math.floor(cz / (CELL * CHUNK));
      if (!floorB.has(k)) floorB.set(k, { b: new GeoBuilder(false), mat, x: cx, z: cz });
      return floorB.get(k).b;
    };
    for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
      const id = lv.cellAt(x, y);
      if (id === VOID) continue;
      const room = lv.rooms[id];
      const fl = look.floor;
      const mat = M.floors[id === 0 ? fl.corridor : (fl[room.type] || fl.default)];
      const x0 = x * CELL, x1 = x0 + CELL, z0 = y * CELL, z1 = z0 + CELL;
      const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
      const U = (v) => v / CELL;
      fb(mat, cx, cz).quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[U(x0), -U(z1)], [U(x1), -U(z1)], [U(x1), -U(z0)], [U(x0), -U(z0)]]);
      fb(M.ceiling, cx, cz).quad([x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], [[U(x0), U(z0)], [U(x1), U(z0)], [U(x1), U(z1)], [U(x0), U(z1)]]);
    }
    for (const { b, mat, x, z } of floorB.values()) this.addStatic(b.build(), mat, x, z, { noCast: true });
  }

  // ---------------------------------------------------------------------
  buildDoors() {
    const lv = this.lv, M = this.M, P = this.props;
    const lw = DOOR_W - 0.04, lh = DOOR_H - 0.03;
    const leaf = new THREE.BoxGeometry(lw, lh, 0.045);
    leaf.translate(lw / 2, lh / 2, 0);
    const handles = [];
    for (const s of [-1, 1]) {
      const hgeo = new THREE.BoxGeometry(0.14, 0.025, 0.025);
      hgeo.translate(lw - 0.14, 1.02, s * 0.06);
      handles.push(hgeo);
      const rose = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10);
      rose.rotateX(Math.PI / 2);
      rose.translate(lw - 0.08, 1.02, s * 0.032);
      handles.push(rose);
    }
    const handleGeo = mergeGeometries(handles.map((g) => { g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }), false);
    const geo = mergeGeometries([leaf, handleGeo], true);
    const n = lv.doors.length;
    this.doorMesh = new THREE.InstancedMesh(geo, [M.door, M.steel], Math.max(1, n));
    this.doorMesh.castShadow = true;
    this.doorMesh.receiveShadow = true;
    this.doorMesh.count = n;
    this.doorMesh.userData.kind = 'door';
    this.root.add(this.doorMesh);
    this.interactables.push(this.doorMesh);
    const frame = new THREE.Group();
    for (const d of lv.doors) {
      const m = (d.o === 'h' ? d.x : d.y) * CELL + CELL / 2;
      const plane = (d.o === 'h' ? d.y : d.x) * CELL;
      const hingeAlong = d.hingeSide < 0 ? m - DOOR_W / 2 + 0.02 : m + DOOR_W / 2 - 0.02;
      if (d.o === 'h') {
        d.hx = hingeAlong; d.hz = plane;
        d.base = d.hingeSide < 0 ? 0 : Math.PI;
        d.cx = m; d.cz = plane;
      } else {
        d.hx = plane; d.hz = hingeAlong;
        d.base = d.hingeSide < 0 ? -Math.PI / 2 : Math.PI / 2;
        d.cx = plane; d.cz = m;
      }
      const tipX = -Math.sin(d.base), tipZ = -Math.cos(d.base);
      const sv = d.o === 'h' ? [0, d.swing] : [d.swing, 0];
      d.openSign = Math.sign(tipX * sv[0] + tipZ * sv[1]) || 1;
      d.dirty = true;
      const closedBox = d.o === 'h'
        ? { minX: m - DOOR_W / 2, maxX: m + DOOR_W / 2, minZ: plane - 0.06, maxZ: plane + 0.06 }
        : { minX: plane - 0.06, maxX: plane + 0.06, minZ: m - DOOR_W / 2, maxZ: m + DOOR_W / 2 };
      d.getBox = () => (Math.abs(d.angle) > 0.28 ? null : closedBox);
      // 門框
      const fw = 0.06, fd = WALL_T + 0.04;
      if (d.o === 'h') {
        P.box(frame, M.paint, fw, DOOR_H, fd, m - DOOR_W / 2 + fw / 2 - 0.01, DOOR_H / 2, plane);
        P.box(frame, M.paint, fw, DOOR_H, fd, m + DOOR_W / 2 - fw / 2 + 0.01, DOOR_H / 2, plane);
        P.box(frame, M.paint, DOOR_W + 0.02, fw, fd, m, DOOR_H - fw / 2 + 0.01, plane);
      } else {
        P.box(frame, M.paint, fd, DOOR_H, fw, plane, DOOR_H / 2, m - DOOR_W / 2 + fw / 2 - 0.01);
        P.box(frame, M.paint, fd, DOOR_H, fw, plane, DOOR_H / 2, m + DOOR_W / 2 - fw / 2 + 0.01);
        P.box(frame, M.paint, fd, fw, DOOR_W + 0.02, plane, DOOR_H - fw / 2 + 0.01, m);
      }
      // 有些門一開始就是開著的
      if (P.rng.chance(0.35)) { d.angle = d.target = P.rng.range(0.6, 1.5); }
    }
    this.bakeGroup(frame);
    this.updateDoorMatrices(true);
  }
  updateDoorMatrices(force = false) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let changed = false;
    for (const d of this.lv.doors) {
      if (!d.dirty && !force) continue;
      q.setFromAxisAngle(up, d.base + d.openSign * d.angle);
      pos.set(d.hx, 0.01, d.hz);
      m4.compose(pos, q, sc);
      this.doorMesh.setMatrixAt(d.id, m4);
      d.dirty = false;
      changed = true;
    }
    if (changed) {
      this.doorMesh.instanceMatrix.needsUpdate = true;
      this.doorMesh.computeBoundingSphere();
    }
  }
  setDoor(d, target, speed = 2.6) {
    d.target = target;
    d.speed = speed;
  }

  // ---------------------------------------------------------------------
  buildWindows() {
    const M = this.M, P = this.props;
    const panes = [];
    const frame = new THREE.Group();
    for (const w of this.lv.windows) {
      const g = new THREE.Group();
      g.position.set(w.x, 0, w.z);
      g.rotation.y = w.rot;
      const pw = 1.6, ph = 1.3, cy = 1.65;
      P.box(g, M.paint, pw + 0.12, 0.08, 0.1, 0, cy - ph / 2 - 0.04, 0.03);
      P.box(g, M.paint, pw + 0.12, 0.06, 0.06, 0, cy + ph / 2 + 0.03, 0.01);
      P.box(g, M.paint, 0.06, ph, 0.06, -pw / 2 - 0.03, cy, 0.01);
      P.box(g, M.paint, 0.06, ph, 0.06, pw / 2 + 0.03, cy, 0.01);
      P.box(g, M.paint, 0.04, ph, 0.04, 0, cy, 0.012);
      frame.add(g);
      const pg = new THREE.PlaneGeometry(pw, ph);
      const pm = new THREE.Mesh(pg);
      pm.position.set(0, cy, 0.002);
      g.add(pm);
      pm.updateMatrixWorld(true);
      g.updateMatrixWorld(true);
      const geo = pg.clone().applyMatrix4(pm.matrixWorld);
      panes.push(geo);
      g.remove(pm);
    }
    this.bakeGroup(frame);
    if (panes.length) {
      const mesh = new THREE.Mesh(mergeGeometries(panes, false), M.window);
      mesh.receiveShadow = false;
      this.root.add(mesh);
      this.windowMesh = mesh;
    }
  }

  // ---------------------------------------------------------------------
  // 精神科：隔離室的觀察窗（鐵絲網玻璃）與鐵籠護理站（鐵條）
  buildObservation() {
    const ops = this.lv.obsOpenings || [];
    if (!ops.length) return;
    const M = this.M, P = this.props;
    const frame = new THREE.Group(), panes = [];
    for (const op of ops) {
      const g = new THREE.Group();
      g.position.set(op.x, 0, op.z);
      g.rotation.y = op.rot;
      const h = op.y1 - op.y0, cy = (op.y0 + op.y1) / 2, d = WALL_T + 0.04;
      if (op.kind === 'glass') {
        for (const s of [-1, 1]) P.box(g, M.paint, 0.06, h + 0.12, d, s * (op.w / 2 + 0.03), cy, 0);
        P.box(g, M.paint, op.w + 0.12, 0.06, d, 0, op.y1 + 0.03, 0);
        P.box(g, M.paint, op.w + 0.12, 0.05, d + 0.08, 0, op.y0 - 0.025, 0);
        const pg = new THREE.PlaneGeometry(op.w, h);
        pg.translate(0, cy, 0);
        const m = new THREE.Mesh(pg);
        g.add(m);
        g.updateMatrixWorld(true);
        panes.push(pg.clone().applyMatrix4(m.matrixWorld));
        g.remove(m);
      } else {
        // 鐵條：每 12 公分一根，上下兩道橫桿
        const n = Math.round(op.w / 0.12);
        for (let k = 0; k <= n; k++) P.tube(g, M.steel, 0.012, [-op.w / 2 + k * op.w / n, op.y0, 0], [-op.w / 2 + k * op.w / n, op.y1, 0], 6);
        for (const y of [op.y0 + 0.06, (op.y0 + op.y1) / 2, op.y1 - 0.06]) P.box(g, M.steel, op.w, 0.04, 0.03, 0, y, 0);
        // 遞藥用的小檯面
        P.box(g, M.wood, op.w, 0.035, d + 0.3, 0, op.y0 + 0.018, 0);
      }
      frame.add(g);
    }
    this.bakeGroup(frame);
    if (panes.length) {
      // 霧面鐵絲網玻璃：半透明，看得到裡面的影子
      const glass = new THREE.MeshStandardMaterial({ color: 0x55605c, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(mergeGeometries(panes, false), glass);
      mesh.renderOrder = 2;
      this.root.add(mesh);
    }
  }

  // ---------------------------------------------------------------------
  buildFurniture() {
    const lv = this.lv, P = this.props;
    this.lockerDoorGeo = (() => {
      const g = new THREE.BoxGeometry(0.57, 1.82, 0.02);
      g.translate(0.285, 0.91 + 0.07, 0);
      return g;
    })();
    this.lockerMesh = new THREE.InstancedMesh(this.lockerDoorGeo, this.M.lockerDoor, Math.max(1, lv.lockers.length));
    this.lockerMesh.count = lv.lockers.length;
    this.lockerMesh.castShadow = true;
    this.lockerMesh.receiveShadow = true;
    this.lockerMesh.userData.kind = 'locker';
    this.root.add(this.lockerMesh);
    this.interactables.push(this.lockerMesh);
    this.dynamicProps = [];
    this.corpseMeshes = [];
    for (const f of lv.furniture) {
      let g = null;
      // 有寫實屍體素材時：推床就不畫原本蓋白布的人形
      const corpse = f.corpse && this.corpses ? makeCorpse(this.corpses, f.corpse.name, f.corpse.mirror) : null;
      f.hideBody = !!corpse;
      if (corpse) {
        placeCorpse(corpse, f);
        // 滑到床外的上半身要擋路（在碰撞與導航建立之前併進家具的範圍）
        const o = f.corpse.overhang;
        if (o) { const b = f.box; f.box = { minX: Math.min(b.minX, o.minX), maxX: Math.max(b.maxX, o.maxX), minZ: Math.min(b.minZ, o.minZ), maxZ: Math.max(b.maxZ, o.maxZ) }; }
        this.root.add(corpse);
        this.corpseMeshes.push(corpse);
      }
      switch (f.kind) {
        case 'bed': g = P.bed(f); break;
        case 'gurney': g = P.gurney(f); break;
        case 'locker': g = P.lockerBody(); break;
        case 'cabinet': g = P.cabinet(); break;
        case 'shelf': g = P.shelf(f); break;
        case 'desk': g = P.desk(); break;
        case 'chair': g = P.chair(); break;
        case 'wheelchair': g = P.wheelchair(); break;
        case 'ivstand': g = P.ivstand(); break;
        case 'sink': g = P.sink(); break;
        case 'counter': g = P.counter(); break;
        case 'bench': g = P.bench(); break;
        case 'morgue': g = P.morgue(); break;
        case 'optable': g = P.optable(f); break;
        case 'trolley': g = P.trolley(); break;
        case 'boxes': g = P.boxes(); break;
        case 'bin': g = P.bin(); break;
        case 'plant': g = P.plant(); break;
        case 'generator': g = P.generator(); break;
        case 'fusebox': g = P.fusebox(); break;
        case 'drawers': g = P.drawers(f); break;
        case 'tray': g = P.tray(f); break;
        case 'autopsy': g = P.autopsy(); break;
        case 'bagrail': g = P.bagrail(); break;
        case 'bodybag': g = P.bodybag(); break;
        case 'crib': g = P.crib(f); break;
        case 'kidbed': g = P.kidbed(f); break;
        case 'bassinet': g = P.bassinet(); break;
        case 'rockinghorse': g = P.rockinghorse(); break;
        case 'kidtable': g = P.kidtable(); break;
        case 'kidchair': g = P.kidchair(); break;
        case 'ectchair': g = P.ectchair(); break;
        case 'ectmachine': g = P.ectmachine(); break;
        case 'table': g = P.table(); break;
        // 其他主題道具（手術部、燒毀的舊院區……）：PropBuilder 裡同名的建構函式
        default: if (typeof P[f.kind] !== 'function') continue; g = P[f.kind](f);
      }
      g.position.set(f.x, 0, f.z);
      g.rotation.y = f.rot;
      if (f.kind === 'fusebox') {
        // 配電箱貼在牆上（家具中心離牆 d/2，往牆面推回去）
        const back = FURN.fusebox.d / 2 - 0.08;
        g.position.x -= Math.sin(f.rot) * back;
        g.position.z -= Math.cos(f.rot) * back;
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.root.add(g);
        this.fusebox = g;
        g.userData.kind = 'fusebox';
        this.interactables.push(g);
        continue;
      }
      if (f.kind === 'rockinghorse' && lv.rocking && lv.rocking[0] === f) {
        // 第一隻搖搖馬自己慢慢搖
        const inner = mergeLocal(g, mergeGeometries);
        inner.position.set(0, 0, 0);
        inner.rotation.set(0, 0, 0);
        inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const outer = new THREE.Group();
        outer.position.set(f.x, 0, f.z);
        outer.rotation.y = f.rot;
        outer.add(inner);
        this.root.add(outer);
        this.rocker = { mesh: inner, f, phase: 0 };
        continue;
      }
      if (f.kind === 'wheelchair' && lv.movable.includes(f)) {
        g = mergeLocal(g, mergeGeometries);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.root.add(g);
        f.mesh = g;
        this.dynamicProps.push(f);
        continue;
      }
      this.bakeGroup(g);
    }
    for (const l of lv.lockers) {
      const f = l.furn;
      const cs = Math.cos(f.rot), sn = Math.sin(f.rot);
      // 鉸鏈在櫃子正面左側（local -0.29, z=+0.27）
      const lx = -0.29, lz = 0.272;
      l.hx = f.x + lx * cs + lz * sn;
      l.hz = f.z - lx * sn + lz * cs;
      l.rot = f.rot;
      l.dirty = true;
    }
    this.updateLockerMatrices(true);
    // 路障
    for (const b of lv.barricades) {
      const g = P.barricade(b);
      g.position.set(b.cx, 0, b.cz);
      this.bakeGroup(g);
    }
  }
  updateLockerMatrices(force = false) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let changed = false;
    for (const l of this.lv.lockers) {
      if (!l.dirty && !force) continue;
      const hidden = l.hideDoor;
      q.setFromAxisAngle(up, l.rot - l.open);
      pos.set(l.hx, 0, l.hz);
      m4.compose(pos, q, new THREE.Vector3(1, hidden ? 0.0001 : 1, 1));
      this.lockerMesh.setMatrixAt(l.id, m4);
      l.dirty = false;
      changed = true;
    }
    if (changed) {
      this.lockerMesh.instanceMatrix.needsUpdate = true;
      this.lockerMesh.computeBoundingSphere();
    }
  }

  // ---------------------------------------------------------------------
  buildFixtures() {
    const lv = this.lv, M = this.M, P = this.props;
    const housing = new THREE.Group();
    for (const f of lv.fixtures) {
      const g = new THREE.Group();
      g.position.set(f.x, WALL_H, f.z);
      g.rotation.y = f.rot;
      P.box(g, M.paintWhite, 1.25, 0.05, 0.3, 0, -0.025, 0);
      P.box(g, M.steel, 1.2, 0.012, 0.012, 0, -0.06, -0.13);
      P.box(g, M.steel, 1.2, 0.012, 0.012, 0, -0.06, 0.13);
      housing.add(g);
    }
    this.bakeGroup(housing, { noShadow: true });
    const tubeGeo = new THREE.CylinderGeometry(0.017, 0.017, 1.16, 8);
    tubeGeo.rotateZ(Math.PI / 2);
    this.tubeMesh = new THREE.InstancedMesh(tubeGeo, M.tube, Math.max(1, lv.fixtures.length * 2));
    this.tubeMesh.count = lv.fixtures.length * 2;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const off = new THREE.Vector3();
    lv.fixtures.forEach((f, i) => {
      q.setFromAxisAngle(up, f.rot);
      for (let k = 0; k < 2; k++) {
        off.set(0, 0, k ? 0.07 : -0.07).applyQuaternion(q);
        m4.compose(new THREE.Vector3(f.x + off.x, WALL_H - 0.075, f.z + off.z), q, new THREE.Vector3(1, 1, 1));
        this.tubeMesh.setMatrixAt(i * 2 + k, m4);
        this.tubeMesh.setColorAt(i * 2 + k, new THREE.Color(0.06, 0.06, 0.06));
      }
      f.level = 0;
      f.shown = -1;
    });
    this.tubeMesh.instanceMatrix.needsUpdate = true;
    this.tubeMesh.instanceColor.needsUpdate = true;
    this.root.add(this.tubeMesh);
    // 緊急燈
    const em = new THREE.Group();
    for (const e of lv.emergency) {
      P.box(em, M.paintWhite, 0.32, 0.12, 0.12, e.x, e.y + 0.1, e.z);
    }
    this.bakeGroup(em, { noShadow: true });
    this.emergencyDomes = [];
    for (const e of lv.emergency) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.emergency.clone());
      dome.material.emissive.set(this.theme.lights.emergency);
      dome.material.color.set(this.theme.lights.emergency).multiplyScalar(0.18);
      dome.rotation.x = Math.PI;
      dome.position.set(e.x, e.y + 0.04, e.z);
      this.root.add(dome);
      this.emergencyDomes.push(dome);
    }
    // 燈光池：只有最近的幾盞燈真的打光
    this.pool = [];
    for (let i = 0; i < this.q.lights; i++) {
      const L = new THREE.SpotLight(this.theme.lights.color, 0, 7.5, 0.95, 0.65, 2);
      L.castShadow = false;
      L.target.position.set(0, -10, 0);
      this.scene.add(L);
      this.scene.add(L.target);
      this.pool.push({ light: L, src: null });
    }
    this.poolTimer = 0;
  }

  setPower(stage) {
    this.power = stage;
    for (const f of this.lv.fixtures) {
      if (f.stage > 0 && f.stage <= stage && !f.on) {
        f.on = true;
        f.warm = 1.4 + Math.random() * 1.2; // 開機時閃爍一下
      }
    }
  }

  fixtureLevel(f, t) {
    if (!f.on) return 0;
    let v = 1;
    if (f.warm > 0) v = Math.random() < 0.5 ? 0.1 : 1;
    else if (f.mode === 'flicker') {
      const p = t * 1.0 + f.phase;
      const n = Math.sin(p * 13.1) * Math.sin(p * 7.3 + 1) * Math.sin(p * 2.1);
      v = n > 0.25 ? (Math.random() < 0.6 ? 0.05 : 0.7) : 1;
    }
    if (this.flickerUntil > t && this.flickerCenter) {
      const d = Math.hypot(f.x - this.flickerCenter.x, f.z - this.flickerCenter.z);
      if (d < this.flickerRadius) v *= Math.random() < 0.55 ? 0.03 : 1;
    }
    if (f.outUntil && f.outUntil > t) v = 0;
    return v;
  }

  // 附近燈光閃爍（鬼魂靠近或事件）
  flickerArea(x, z, r, dur) {
    this.flickerCenter = { x, z };
    this.flickerRadius = r;
    this.flickerUntil = this.time + dur;
  }
  lightsOut(x, z, r, dur) {
    for (const f of this.lv.fixtures) if (Math.hypot(f.x - x, f.z - z) < r) f.outUntil = this.time + dur;
  }

  // 玩家所在位置的環境光量（給理智值用）
  lightAt(x, z) {
    let s = 0;
    for (const f of this.lv.fixtures) {
      if (!f.level) continue;
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 < 36) s += f.level * (1 - Math.sqrt(d2) / 6);
    }
    return Math.min(1, s);
  }

  // ---------------------------------------------------------------------
  buildDecals() {
    const lv = this.lv, M = this.M, P = this.props;
    const sets = { blood: [], drag: [], paper: [], writing: [], hand: [], signs: [], leak: [], smear: [], drawing: [], drain: [], soot: [] };
    const toys = new THREE.Group();
    const leakTex = this.tf.photoDecal('leak'), smearTex = this.tf.photoDecal('smear');
    const plane = (w, h, u0, v0, u1, v1) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      return g;
    };
    let layer = 0;
    const floorDecal = (geo, d) => {
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(d.rot);
      geo.translate(d.x, 0.003 + (layer++ % 20) * 0.0004, d.z);
      return geo;
    };
    const wallDecal = (geo, d) => {
      if (d.rotZ) geo.rotateZ(d.rotZ);
      geo.rotateY(d.rot);
      geo.translate(d.x, d.y, d.z);
      return geo;
    };
    for (const d of lv.decals) {
      if (d.kind === 'blood') {
        const v = d.variant % 4, u0 = (v % 2) * 0.5, v0 = 0.5 - Math.floor(v / 2) * 0.5;
        sets.blood.push(floorDecal(plane(d.size, d.size, u0, v0, u0 + 0.5, v0 + 0.5), d));
      } else if (d.kind === 'drag') {
        sets.drag.push(floorDecal(plane(d.size, d.size / 4, 0, 0, 1, 1), d));
      } else if (d.kind === 'paper') {
        const v = d.variant % 4, u0 = (v % 2) * 0.5, v0 = 0.5 - Math.floor(v / 2) * 0.5;
        sets.paper.push(floorDecal(plane(d.size, d.size, u0, v0, u0 + 0.5, v0 + 0.5), d));
      } else if (d.kind === 'writing') {
        const rows = WALL_WRITINGS.length, r = WALL_WRITINGS.indexOf(d.text);
        const v1 = 1 - r / rows, v0 = 1 - (r + 1) / rows;
        sets.writing.push(wallDecal(plane(d.size, d.size / 4, 0, v0, 1, v1), d));
      } else if (d.kind === 'hand') {
        const u0 = (d.variant % 2) * 0.5;
        sets.hand.push(wallDecal(plane(d.size, d.size, u0, 0, u0 + 0.5, 1), d));
      } else if (d.kind === 'leak') {
        if (leakTex) sets.leak.push(wallDecal(plane(d.w, d.h, d.flip ? 1 : 0, 0, d.flip ? 0 : 1, 1), d));
      } else if (d.kind === 'smear') {
        // 抹痕貼圖裡只有幾條橫帶有痕跡：上下邊界都落在空白列上，才不會切出直線；高度依那一段的比例
        const [v0, v1] = [[0.605, 0.775], [0.412, 0.468], [0.339, 0.408], [0.125, 0.326]][d.band % 4];
        if (smearTex) sets.smear.push(wallDecal(plane(d.w, d.w * (v1 - v0), 0, v0, 1, v1), d));
      } else if (d.kind === 'curtain') {
        const g = P.curtain(d.len);
        g.position.set(d.x, 0, d.z);
        g.rotation.y = d.rot;
        this.bakeGroup(g);
      } else if (d.kind === 'drawing') {
        // 蠟筆畫圖集 3 × 2
        const v = d.variant % 6, u0 = (v % 3) / 3, v1 = 1 - Math.floor(v / 3) / 2;
        sets.drawing.push(wallDecal(plane(d.w, d.w, u0, v1 - 0.5, u0 + 1 / 3, v1), d));
      } else if (d.kind === 'drain') {
        sets.drain.push(floorDecal(plane(d.size, d.size, 0, 0, 1, 1), d));
      } else if (d.kind === 'toy') {
        const t = P.toy(d.variant, d.tipped);
        t.position.set(d.x, 0, d.z);
        t.rotation.y = d.rot;
        toys.add(t);
      } else if (d.kind === 'soot') {
        // 煙燻圖集 2 × 2：0、1 = 牆上的黑煙，2 = 門楣上方，3 = 地上的焦痕
        const v = d.variant % 3, u0 = (v % 2) * 0.5, v0 = 0.5 - Math.floor(v / 2) * 0.5;
        sets.soot.push(wallDecal(plane(d.w, d.h, d.flip ? u0 + 0.5 : u0, v0, d.flip ? u0 : u0 + 0.5, v0 + 0.5), d));
      } else if (d.kind === 'scorch') {
        sets.soot.push(floorDecal(plane(d.size, d.size, 0.5, 0, 1, 0.5), d));
      } else if (d.kind === 'prop') {
        // 不擋路的主題裝飾（無影燈、塑膠條門簾、天花板破洞、窗上的木板……）
        if (typeof P[d.prop] !== 'function') continue;
        const g = P[d.prop](d);
        g.position.set(d.x, 0, d.z);
        g.rotation.y = d.rot || 0;
        this.bakeGroup(g, { noCast: true });
      } else if (d.kind === 'surgicalLamp') {
        const g = P.surgicalLamp();
        g.position.set(d.x, 0, d.z);
        g.rotation.y = d.rot;
        this.bakeGroup(g);
      }
    }
    this.tf.writingAtlas(WALL_WRITINGS);
    M.writing = new THREE.MeshStandardMaterial({ map: this.tf.cache.get('writing').map, roughness: 0.4, metalness: 0, ...M.decalBase });
    // 門牌
    const labels = [...new Set(lv.signs.filter((s) => s.kind === 'roomSign').map((s) => s.text))];
    const atlas = this.tf.signAtlas(labels.length ? labels : ['—']);
    M.sign = new THREE.MeshStandardMaterial({ map: atlas.map, roughness: 0.55, metalness: 0 });
    for (const s of lv.signs) {
      if (s.kind !== 'roomSign') continue;
      const i = labels.indexOf(s.text);
      const col = i % atlas.cols, row = Math.floor(i / atlas.cols);
      const u0 = col / atlas.cols, u1 = (col + 1) / atlas.cols;
      const v1 = 1 - row / atlas.rows, v0 = 1 - (row + 1) / atlas.rows;
      sets.signs.push(wallDecal(plane(0.62, 0.136, u0, v0, u1, v1), s));
    }
    const add = (list, mat, noCast = true) => {
      if (!list.length) return;
      // 依區塊分組
      const byChunk = new Map();
      for (const g of list) {
        g.computeBoundingSphere();
        const c = g.boundingSphere.center;
        const k = Math.floor(c.x / (CELL * CHUNK)) + ',' + Math.floor(c.z / (CELL * CHUNK));
        if (!byChunk.has(k)) byChunk.set(k, []);
        byChunk.get(k).push(g);
      }
      for (const geos of byChunk.values()) {
        const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
        m.receiveShadow = true;
        m.castShadow = !noCast;
        m.renderOrder = 1;
        this.root.add(m);
      }
    };
    add(sets.blood, M.blood);
    add(sets.drag, M.drag);
    add(sets.paper, M.paper);
    add(sets.writing, M.writing);
    add(sets.hand, M.hand);
    add(sets.signs, M.sign);
    if (sets.drawing.length) {
      M.drawing = new THREE.MeshStandardMaterial({ map: this.tf.drawingAtlas().map, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, ...M.decalBase });
      add(sets.drawing, M.drawing);
    }
    if (sets.soot.length) {
      M.soot = new THREE.MeshStandardMaterial({ map: this.tf.sootAtlas().map, roughness: 1, metalness: 0, ...M.decalBase, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      add(sets.soot, M.soot);
    }
    if (sets.drain.length) {
      M.drain = new THREE.MeshStandardMaterial({ map: this.tf.drainTex().map, roughness: 0.5, metalness: 0.4, ...M.decalBase });
      add(sets.drain, M.drain);
    }
    // 玩具全部烘進靠近的區塊（小東西不投影，省陰影）
    if (toys.children.length) this.bakeGroup(toys, { noCast: true });
    if (sets.leak.length) {
      M.leak = new THREE.MeshStandardMaterial({ ...leakTex, color: 0x5a4630, roughness: 0.7, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), ...M.decalBase });
      add(sets.leak, M.leak);
    }
    if (sets.smear.length) {
      M.smear = new THREE.MeshStandardMaterial({ ...smearTex, color: 0x4a0806, roughness: 0.45, metalness: 0, ...M.decalBase });
      add(sets.smear, M.smear);
    }
    // 出口標示
    for (const e of lv.exitSigns) {
      const g = new THREE.Group();
      g.position.set(e.x, e.y, e.z);
      g.rotation.y = e.rot;
      P.box(g, M.plasticWhite, 0.66, 0.26, 0.08, 0, 0, -0.04);
      this.bakeGroup(g, { noShadow: true });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.225), M.exit);
      face.position.set(e.x, e.y, e.z);
      face.rotation.y = e.rot;
      face.translateZ(0.002);
      this.root.add(face);
    }
  }

  // 執行中動態加一塊牆上血字（「回頭就出現」的驚嚇事件）
  addWallWriting(text, x, y, z, rot) {
    const rows = WALL_WRITINGS.length, r = Math.max(0, WALL_WRITINGS.indexOf(text));
    const g = new THREE.PlaneGeometry(1.6, 0.4);
    const uv = g.attributes.uv;
    const v1 = 1 - r / rows, v0 = 1 - (r + 1) / rows;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) ? v1 : v0);
    const m = new THREE.Mesh(g, this.M.writing);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.root.add(m);
    return m;
  }

  // ---------------------------------------------------------------------
  buildGate() {
    const lv = this.lv, M = this.M, P = this.props;
    const gx = lv.gate.x, gz = lv.gate.z;
    const glass = new THREE.MeshStandardMaterial({ color: 0x5a7066, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false });
    this.gateLeaves = [];
    const lw = GATE_W / 2 - 0.02, lh = GATE_H - 0.03;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(gx + side * GATE_W / 2, 0.01, gz);
      pivot.rotation.y = side < 0 ? 0 : Math.PI;
      const leaf = new THREE.Group();
      P.box(leaf, M.steel, 0.06, lh, 0.06, 0.03, lh / 2, 0);
      P.box(leaf, M.steel, 0.06, lh, 0.06, lw - 0.03, lh / 2, 0);
      P.box(leaf, M.steel, lw, 0.06, 0.06, lw / 2, lh - 0.03, 0);
      P.box(leaf, M.steel, lw, 0.2, 0.06, lw / 2, 0.1, 0);
      P.box(leaf, M.steel, 0.4, 0.03, 0.05, lw - 0.25, 1.05, 0.06);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.06, lh - 0.26), glass);
      gl.position.set(lw / 2, (lh - 0.26) / 2 + 0.2, 0);
      leaf.add(gl);
      leaf.traverse((o) => { if (o.isMesh && o !== gl) { o.castShadow = true; o.receiveShadow = true; } });
      pivot.add(leaf);
      this.root.add(pivot);
      this.gateLeaves.push({ pivot, side, base: pivot.rotation.y });
    }
    // 鐵鍊與大鎖
    this.chain = new THREE.Group();
    const link = new THREE.TorusGeometry(0.035, 0.009, 6, 10);
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(link, M.steel);
      const t = k / 13;
      m.position.set(gx - 0.35 + t * 0.7, 1.05 - Math.sin(t * Math.PI) * 0.12, gz - 0.1);
      m.rotation.set(k % 2 ? Math.PI / 2 : 0, 0, Math.PI / 2 + (k % 2 ? 0 : 0.3));
      m.castShadow = true;
      this.chain.add(m);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.035), M.brass);
    lock.position.set(gx, 0.88, gz - 0.12);
    lock.castShadow = true;
    this.chain.add(lock);
    this.root.add(this.chain);
    this.interactables.push(this.chain);
    this.chain.userData.kind = 'gate';
    lv.gate.getBox = () => (lv.gate.open ? null : { minX: gx - GATE_W / 2, maxX: gx + GATE_W / 2, minZ: gz - 0.08, maxZ: gz + 0.08 });
    lv.gate.angle = 0;
    // 大門外：濕柏油地、遠方樹林、路燈與雨
    const grime = this.tf.grime();
    const asphalt = new THREE.MeshStandardMaterial({ map: grime.map, color: 0x2b2e31, roughness: 0.16, metalness: 0 });
    asphalt.map = grime.map.clone();
    asphalt.map.repeat.set(6, 5);
    asphalt.map.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), asphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(gx, -0.01, gz + 7);
    ground.receiveShadow = true;
    this.root.add(ground);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(44, 16), new THREE.MeshBasicMaterial({ map: this.tf.windowTex().map, color: 0xa0b0c0, fog: false }));
    back.position.set(gx, 5, gz + 15);
    back.rotation.y = Math.PI;
    this.root.add(back);
    // 路燈（大門打開時亮起）
    const pole = new THREE.Group();
    P.box(pole, M.paint, 0.12, 4.6, 0.12, gx + 3.2, 2.3, gz + 8.5);
    P.box(pole, M.paint, 0.9, 0.08, 0.1, gx + 2.8, 4.6, gz + 8.5);
    this.bakeGroup(pole);
    this.streetLamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0x110800, fog: false }));
    this.streetLamp.position.set(gx + 2.45, 4.5, gz + 8.5);
    this.root.add(this.streetLamp);
    this.streetLight = new THREE.PointLight(0xffa860, 0, 18, 1.6);
    this.streetLight.position.set(gx + 2.45, 4.3, gz + 8.5);
    this.scene.add(this.streetLight);
    // 雨絲
    const n = 700, pos = new Float32Array(n * 6), off = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = gx + (Math.random() - 0.5) * 16, z = gz + 0.6 + Math.random() * 13, o = Math.random() * 7;
      pos.set([x, 0, z, x - 0.02, 0.35, z], i * 6);
      off[i * 2] = off[i * 2 + 1] = o;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('off', new THREE.BufferAttribute(off, 1));
    this.rainUniforms = { uTime: { value: 0 }, uLit: { value: 0.15 } };
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; attribute float off;
        void main() { vec3 p = position; p.y += mod(off - uTime * 9.0, 7.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uLit; void main() { gl_FragColor = vec4(vec3(0.7, 0.8, 0.9) * uLit, uLit); }`,
    }));
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
  }
  openGate() {
    if (this.streetLight) {
      this.streetLight.intensity = 30;
      this.streetLamp.material.color.setRGB(3, 1.9, 1.0);
      this.rainUniforms.uLit.value = 0.35;
    }
    this.lv.gate.open = true;
    this.lv.gate.target = 1.35;
    this.root.remove(this.chain);
    this.removed.push(this.chain);
    const i = this.interactables.indexOf(this.chain);
    if (i >= 0) this.interactables.splice(i, 1);
  }

  buildLobbyExtras() {
    const lv = this.lv, M = this.M, P = this.props;
    const lobby = lv.lobby;
    // 疏散平面圖（大廳北牆）
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 1024; mapCanvas.height = 768;
    const g = mapCanvas.getContext('2d');
    g.fillStyle = '#d9d4c3'; g.fillRect(0, 0, 1024, 768);
    g.fillStyle = '#7d1c14'; g.fillRect(0, 0, 1024, 86);
    g.fillStyle = '#f2ece0'; g.font = '700 54px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`聖羅莎紀念醫院　${this.theme.board} 疏散平面圖`, 512, 45);
    const scale = Math.min(940 / (lv.W * CELL), 640 / (lv.H * CELL));
    const ox = 512 - lv.W * CELL * scale / 2, oy = 100;
    drawFloorPlan(g, lv, {
      x0: ox, y0: oy, scale, wallColor: '#2a2620', lineWidth: 3, doorColor: '#c0b8a0',
      roomColor: (room) => (room.type === 'lobby' ? '#e9d79a' : room.id === 0 ? '#cfc8b2' : room.type === 'generator' ? '#d7b0a0' : '#e4dfcf'),
      labels: (room) => (room.type === 'generator' ? '發電機房' : room.type === 'lobby' ? room.label : null),
      labelColor: '#3a2a20', labelFont: '700 22px sans-serif',
    });
    // 你在這裡
    g.fillStyle = '#c3261b';
    const sx = ox + lv.spawn.x * scale, sy = oy + lv.spawn.z * scale;
    g.beginPath(); g.arc(sx, sy, 11, 0, 6.29); g.fill();
    g.font = '700 22px sans-serif'; g.fillText('你在這裡', sx, sy - 24);
    // 污漬
    for (let k = 0; k < 30; k++) {
      const x = Math.random() * 1024, y = Math.random() * 768;
      const gr = g.createRadialGradient(x, y, 1, x, y, 20 + Math.random() * 80);
      gr.addColorStop(0, 'rgba(70,50,25,0.3)'); gr.addColorStop(1, 'rgba(70,50,25,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 1024, 768);
    }
    const tex = new THREE.CanvasTexture(mapCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0 });
    // 掛在大廳北牆（開口旁邊那一格）
    const bx = (lv.lobbyX - 1 + 0.5) * CELL, bz = lv.lobbyTop * CELL + HT + 0.015;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.05), boardMat);
    board.position.set(bx, 1.55, bz + 0.03);
    board.receiveShadow = true;
    this.root.add(board);
    const fr = new THREE.Group();
    P.box(fr, M.wood, 1.5, 1.15, 0.04, bx, 1.55, bz + 0.008);
    this.bakeGroup(fr);
    // 電視（雜訊畫面）
    const tvCanvas = document.createElement('canvas');
    tvCanvas.width = 80; tvCanvas.height = 60;
    this.tvCtx = tvCanvas.getContext('2d');
    this.tvTex = new THREE.CanvasTexture(tvCanvas);
    this.tvTex.colorSpace = THREE.SRGBColorSpace;
    M.tvScreen.map = this.tvTex;
    M.tvScreen.color.setRGB(1.2, 1.2, 1.2);
    const tvx = (lv.lobbyX + 1 + 0.5) * CELL, tvz = lv.lobbyTop * CELL + HT + 0.33;
    const tv = mergeLocal(P.tv(), mergeGeometries);
    tv.position.set(tvx, 2.3, tvz);
    tv.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(tv);
    this.tv = tv;
    // 電話
    if (lv.phone) {
      const ph = mergeLocal(P.phone(), mergeGeometries);
      ph.position.set(lv.phone.x, lv.phone.y, lv.phone.z);
      ph.rotation.y = lv.phone.rot + 0.4;
      ph.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.root.add(ph);
      this.phone = ph;
      ph.userData.kind = 'phone';
      this.interactables.push(ph);
    }
    void lobby;
  }

  // ---------------------------------------------------------------------
  buildItems() {
    const P = this.props;
    this.glintMat = new THREE.SpriteMaterial({ map: this.tf.dust().map, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
    for (const it of this.lv.items) {
      const g = mergeLocal(P.pickup(it.kind), mergeGeometries);
      g.position.set(it.x, it.y, it.z);
      g.rotation.y = it.rot;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const glint = new THREE.Sprite(this.glintMat);
      glint.scale.setScalar(it.kind === 'note' ? 0.22 : 0.16);
      glint.position.set(0, 0.06, 0);
      g.add(glint);
      g.userData.kind = 'item';
      g.userData.item = it;
      it.mesh = g;
      this.root.add(g);
      this.interactables.push(g);
    }
  }
  makePickupMesh(kind) {
    const g = mergeLocal(this.props.pickup(kind), mergeGeometries);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  removeItem(it) {
    it.taken = true;
    if (it.mesh) {
      this.root.remove(it.mesh);
      if (!this.removed.includes(it.mesh)) this.removed.push(it.mesh);
      const i = this.interactables.indexOf(it.mesh);
      if (i >= 0) this.interactables.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------
  // 手電筒光束裡飄浮的灰塵
  buildDust() {
    if (!this.q.dust) return;
    const n = 420;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 1] = Math.random() * WALL_H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 9;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustUniforms = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uMap: { value: this.tf.dust().map },
      uFlash: { value: 1 }, uScale: { value: this.renderer.getPixelRatio() * 900 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float seed;
        uniform float uTime; uniform vec3 uCenter; uniform float uScale; uniform float uFlash;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.13 + seed) * 0.4;
          p.y += sin(uTime * 0.07 + seed * 1.7) * 0.25;
          p.z += cos(uTime * 0.11 + seed * 0.7) * 0.4;
          // 以相機為中心環繞
          vec3 rel = mod(p - uCenter + 4.5, 9.0) - 4.5;
          vec4 mv = viewMatrix * vec4(uCenter + rel, 1.0);
          float d = -mv.z;
          vec3 dir = normalize(mv.xyz);
          float cone = smoothstep(0.86, 0.97, dot(dir, vec3(0.0, 0.0, -1.0)));
          vA = cone * uFlash * smoothstep(0.2, 0.8, d) * (1.0 - smoothstep(3.0, 6.5, d)) * (0.5 + 0.5 * sin(seed * 3.0 + uTime));
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * 0.006 / max(d, 0.1);
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vA;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * vA * 0.5;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, a);
        }`,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
  }

  // ---------------------------------------------------------------------
  lightning(strength = 1) {
    this.lightningT = 1;
    this.lightningStrength = strength;
  }

  update(dt, camera, flashOn) {
    const t = (this.time += dt);
    const lv = this.lv;
    // 門
    for (const d of lv.doors) {
      if (Math.abs(d.angle - d.target) > 1e-3) {
        const sp = d.speed || 2.6;
        d.angle += Math.sign(d.target - d.angle) * Math.min(Math.abs(d.target - d.angle), sp * dt);
        d.dirty = true;
      }
    }
    this.updateDoorMatrices();
    for (const l of lv.lockers) {
      if (Math.abs(l.open - l.target) > 1e-3) {
        l.open += Math.sign(l.target - l.open) * Math.min(Math.abs(l.target - l.open), 5 * dt);
        l.dirty = true;
      }
    }
    this.updateLockerMatrices();
    // 大門
    if (lv.gate.open && lv.gate.angle < lv.gate.target) {
      lv.gate.angle = Math.min(lv.gate.target, lv.gate.angle + dt * 0.9);
      for (const L of this.gateLeaves) L.pivot.rotation.y = L.base + (L.side < 0 ? -lv.gate.angle : lv.gate.angle);
    }
    // 燈具
    let colorDirty = false;
    const col = new THREE.Color();
    for (let i = 0; i < lv.fixtures.length; i++) {
      const f = lv.fixtures[i];
      if (f.warm > 0) f.warm -= dt;
      const v = this.fixtureLevel(f, t);
      f.level = v;
      const q = Math.round(v * 20);
      if (q !== f.shown) {
        f.shown = q;
        const b = v > 0 ? 0.25 + v * 2.6 : 0.06;
        const tt = this.theme.lights.tube;
        col.setRGB(b * tt[0], b * tt[1], b * tt[2]);
        this.tubeMesh.setColorAt(i * 2, col);
        this.tubeMesh.setColorAt(i * 2 + 1, col);
        colorDirty = true;
      }
    }
    if (colorDirty) this.tubeMesh.instanceColor.needsUpdate = true;
    // 緊急燈慢慢呼吸
    for (let i = 0; i < lv.emergency.length; i++) {
      const e = lv.emergency[i];
      e.level = 0.55 + 0.45 * Math.sin(t * 1.3 + e.phase);
      this.emergencyDomes[i].material.emissiveIntensity = 1 + e.level * 3;
    }
    // 燈光池分配
    this.poolTimer -= dt;
    const cp = camera.position;
    if (this.poolTimer <= 0) {
      this.poolTimer = 0.25;
      const cands = [];
      for (const f of lv.fixtures) if (f.on) {
        const d = Math.hypot(f.x - cp.x, f.z - cp.z);
        if (d < 24) cands.push({ src: f, d, kind: 'fixture' });
      }
      for (const e of lv.emergency) {
        const d = Math.hypot(e.x - cp.x, e.z - cp.z);
        if (d < 18) cands.push({ src: e, d: d + 2, kind: 'emergency' });
      }
      cands.sort((a, b) => a.d - b.d);
      const want = cands.slice(0, this.pool.length).map((c) => c.src);
      // 保留已經分配好的
      const free = [];
      for (const p of this.pool) {
        if (p.src && want.includes(p.src)) want.splice(want.indexOf(p.src), 1);
        else free.push(p);
      }
      for (const p of free) {
        const src = want.shift() || null;
        p.src = src;
        if (src) {
          const em = src.y !== undefined && src.stage === undefined;
          p.emergency = em;
          p.light.position.set(src.x, (em ? src.y : WALL_H - 0.1), src.z);
          p.light.target.position.set(src.x, 0, src.z);
          p.light.color.set(em ? this.theme.lights.emergency : this.theme.lights.color);
          p.light.angle = em ? 1.2 : 0.95;
          p.light.distance = em ? 6 : 7.5;
        }
      }
    }
    for (const p of this.pool) {
      if (!p.src) { p.light.intensity = 0; p.light.visible = false; continue; }
      p.light.visible = true;
      p.light.intensity = p.emergency ? p.src.level * 1.6 : p.src.level * 9;
    }
    // 窗外：雨水流動、閃電
    if (this.windowMesh) {
      this.M.window.map.offset.y = (t * 0.03) % 1;
      this.lightningT = Math.max(0, this.lightningT - dt * 1.6);
      const flash = this.lightningT > 0 ? (Math.sin(this.lightningT * 40) > -0.2 ? this.lightningT : 0) : 0;
      this.M.window.emissiveIntensity = 0.35 + flash * 6;
      this.hemi.intensity = 0.04 + flash * 0.9 * (this.lightningStrength ?? 1);
    }
    if (this.rain) this.rainUniforms.uTime.value = t;
    // 道具閃光
    this.glintMat.opacity = 0.25 + 0.25 * Math.sin(t * 2.7);
    // 電視雜訊
    if (this.tvCtx && (Math.floor(t * 30) % 2 === 0)) {
      const g = this.tvCtx;
      const img = this.tvImg || (this.tvImg = g.createImageData(80, 60));
      for (let i = 0; i < 80 * 60; i++) {
        const v = Math.random() * 200;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v * 1.05; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.tvTex.needsUpdate = true;
    }
    // 灰塵
    if (this.dust) {
      this.dustUniforms.uTime.value = t;
      this.dustUniforms.uCenter.value.copy(cp);
      this.dustUniforms.uFlash.value += ((flashOn ? 1 : 0) - this.dustUniforms.uFlash.value) * Math.min(1, dt * 8);
    }
    // 自己在搖的搖搖馬
    if (this.rocker) this.rocker.mesh.rotation.x = Math.sin(t * 1.55) * 0.13 * (0.6 + 0.4 * Math.sin(t * 0.21));
    // 可推動的輪椅
    for (const f of this.dynamicProps) {
      if (f.vel) {
        const nx = f.x + f.vel[0] * dt, nz = f.z + f.vel[1] * dt;
        // 撞到牆或家具就停下
        if (this.propBlocked && this.propBlocked(nx, nz)) { f.vel = null; continue; }
        f.x = nx; f.z = nz;
        f.vel[0] *= Math.pow(0.35, dt); f.vel[1] *= Math.pow(0.35, dt);
        if (Math.hypot(f.vel[0], f.vel[1]) < 0.03) f.vel = null;
        f.mesh.position.set(f.x, 0, f.z);
        const hx = (f.box.maxX - f.box.minX) / 2, hz = (f.box.maxZ - f.box.minZ) / 2;
        f.box = { minX: f.x - hx, maxX: f.x + hx, minZ: f.z - hz, maxZ: f.z + hz };
      }
    }
  }
}


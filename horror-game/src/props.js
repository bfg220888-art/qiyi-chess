// 家具與道具模型（全部由基本幾何體組成）。
// 每個建構函式回傳一個 Group：原點在地板上的中心，正面朝 +z（背面靠牆）。
import * as THREE from 'three';
import { RNG } from './rng.js';

// 依面法線做方塊投影 UV，讓貼圖密度和實際尺寸一致
export function projectUV(geo, scale = 1, offU = 0, offV = 0) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (nx >= ny && nx >= nz) { u = z; v = y; }
    else if (ny >= nx && ny >= nz) { u = x; v = z; }
    else { u = x; v = y; }
    uv.setXY(i, u / scale + offU, v / scale + offV);
  }
  uv.needsUpdate = true;
  return geo;
}

// 把一個 Group 裡的 mesh 依材質合併（座標轉成 Group 本地座標），減少動態物件的 draw call
export function mergeLocal(group, mergeFn) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  const keep = [];
  group.traverse((o) => {
    if (!o.isMesh || o === group) return;
    if (o.userData.dynamic || o.userData.keep) { keep.push(o); return; }
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  });
  const out = new THREE.Group();
  out.position.copy(group.position);
  out.rotation.copy(group.rotation);
  out.scale.copy(group.scale);
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(geos.length === 1 ? geos[0] : mergeFn(geos, false), mat);
    out.add(m);
  }
  for (const o of keep) {
    const wm = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    o.matrixAutoUpdate = true;
    wm.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  return out;
}

export class PropBuilder {
  constructor(M, seed = 99) {
    this.M = M; // 材質表
    this.rng = new RNG(seed);
  }
  // ---- 基本形狀
  box(g, mat, w, h, d, x, y, z, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (opts.uv !== false) projectUV(geo, opts.uvScale || 1, this.rng.next(), this.rng.next());
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rz) m.rotation.z = opts.rz;
    g.add(m);
    return m;
  }
  cyl(g, mat, r0, r1, h, x, y, z, opts = {}) {
    const geo = new THREE.CylinderGeometry(r0, r1, h, opts.seg || 10, 1, !!opts.open);
    if (opts.uv !== false) projectUV(geo, opts.uvScale || 1, this.rng.next(), this.rng.next());
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rz) m.rotation.z = opts.rz;
    g.add(m);
    return m;
  }
  // 兩點之間的圓管
  tube(g, mat, r, a, b, seg = 8) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    projectUV(geo, 0.5);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m);
    return m;
  }
  sphere(g, mat, r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 12) {
    const geo = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6 | 0));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  }

  // ---- 家具
  bed(f) {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    const L = 2.0, W = 0.92, z0 = -1.0;
    const legs = [[-W / 2, z0 + 0.06], [W / 2, z0 + 0.06], [-W / 2, z0 + L - 0.06], [W / 2, z0 + L - 0.06]];
    for (const [x, z] of legs) {
      this.tube(g, M.steel, 0.022, [x, 0.08, z], [x, 0.52, z]);
      this.sphere(g, M.rubber, 0.05, x, 0.05, z, 1, 1, 0.5, 8);
    }
    this.box(g, M.steel, 0.04, 0.04, L, -W / 2, 0.47, 0);
    this.box(g, M.steel, 0.04, 0.04, L, W / 2, 0.47, 0);
    // 床頭與床尾
    this.tube(g, M.steel, 0.022, [-W / 2, 0.5, z0 + 0.03], [-W / 2, 1.05, z0 + 0.03]);
    this.tube(g, M.steel, 0.022, [W / 2, 0.5, z0 + 0.03], [W / 2, 1.05, z0 + 0.03]);
    this.tube(g, M.steel, 0.022, [-W / 2, 1.05, z0 + 0.03], [W / 2, 1.05, z0 + 0.03]);
    this.box(g, M.paintWhite, W - 0.05, 0.42, 0.025, 0, 0.8, z0 + 0.03);
    this.box(g, M.paintWhite, W - 0.05, 0.28, 0.025, 0, 0.66, z0 + L - 0.03);
    this.tube(g, M.steel, 0.02, [-W / 2, 0.82, z0 + L - 0.03], [W / 2, 0.82, z0 + L - 0.03]);
    const v = f.variant || 0;
    if (v !== 2) {
      this.box(g, M.mattress, W - 0.06, 0.13, L - 0.08, 0, 0.555, 0);
      // 床單：略大一點並往一邊滑落
      const sheet = this.box(g, M.fabric, W + 0.02, 0.03, L * (v === 1 ? 0.7 : 0.85), (v === 1 ? 0.12 : 0), 0.635, v === 1 ? 0.25 : 0.12, { uvScale: 1.4, ry: v === 1 ? r.range(-0.3, 0.3) : r.range(-0.05, 0.05) });
      sheet.userData.noShadow = false;
      // 床單垂邊
      this.box(g, M.fabric, 0.02, 0.28, L * 0.7, (W + 0.04) / 2, 0.5, 0.1, { uvScale: 1.4, rz: 0.08 });
      if (v !== 1) this.box(g, M.fabric, 0.02, 0.26, L * 0.7, -(W + 0.04) / 2, 0.51, 0.1, { uvScale: 1.4, rz: -0.08 });
      // 枕頭
      const p = this.sphere(g, M.fabric, 0.3, r.range(-0.1, 0.1), 0.68, z0 + 0.32, 0.9, 0.22, 0.55, 10);
      p.rotation.y = r.range(-0.3, 0.3);
    } else {
      // 只剩彈簧床架
      for (let k = 0; k < 9; k++) this.tube(g, M.steel, 0.008, [-W / 2, 0.48, z0 + 0.15 + k * 0.21], [W / 2, 0.48, z0 + 0.15 + k * 0.21], 5);
    }
    return g;
  }

  gurney(f) {
    const { M } = this, g = new THREE.Group();
    // 推床：長邊沿著牆（local x）
    const L = 1.95, W = 0.62;
    for (const [x, z] of [[-L / 2 + 0.08, -W / 2 + 0.05], [L / 2 - 0.08, -W / 2 + 0.05], [-L / 2 + 0.08, W / 2 - 0.05], [L / 2 - 0.08, W / 2 - 0.05]]) {
      this.tube(g, M.steel, 0.02, [x, 0.1, z], [x, 0.78, z]);
      this.sphere(g, M.rubber, 0.055, x, 0.055, z, 0.5, 1, 1, 8);
    }
    this.box(g, M.steel, L, 0.04, W, 0, 0.8, 0);
    this.box(g, M.steel, L * 0.9, 0.02, W * 0.8, 0, 0.3, 0);
    this.box(g, M.mattress, L - 0.05, 0.07, W - 0.06, 0, 0.855, 0);
    if (f.body && !f.hideBody) {
      // 蓋著白布的屍體
      const c = this.sphere(g, M.fabric, 0.5, -0.05, 0.98, 0, 1.05, 0.22, 0.42, 14);
      c.rotation.y = 0.02;
      this.sphere(g, M.fabric, 0.14, -L / 2 + 0.25, 1.0, 0, 1, 0.85, 1.05, 12);
      this.sphere(g, M.fabric, 0.42, 0.5, 0.94, 0, 1.0, 0.16, 0.38, 12);
      this.sphere(g, M.fabric, 0.09, L / 2 - 0.12, 1.0, -0.1, 0.8, 1.4, 0.8, 8);
      this.sphere(g, M.fabric, 0.09, L / 2 - 0.12, 1.0, 0.1, 0.8, 1.4, 0.8, 8);
      // 垂下來的布與一隻手
      this.box(g, M.fabric, L * 0.8, 0.3, 0.02, 0, 0.78, W / 2 + 0.02, { uvScale: 1.4, rx: -0.12 });
      const arm = this.cyl(g, M.skin, 0.03, 0.025, 0.45, -0.1, 0.62, W / 2 + 0.06, { rx: 0.15 });
      arm.rotation.z = 0.05;
    } else if (f.body) {
      // 屍體模型取代了白布：照樣抽掉白布會用到的亂數，後面的道具才會和沒載入模型時一樣
      for (let i = 0; i < 4; i++) this.rng.next();
    }
    return g;
  }

  lockerBody() {
    const { M } = this, g = new THREE.Group();
    const W = 0.6, H = 1.92, D = 0.52, t = 0.02;
    this.box(g, M.paint, W, H, t, 0, H / 2, -D / 2 + t / 2, { uvScale: 1.2 });
    this.box(g, M.paint, t, H, D, -W / 2 + t / 2, H / 2, 0, { uvScale: 1.2 });
    this.box(g, M.paint, t, H, D, W / 2 - t / 2, H / 2, 0, { uvScale: 1.2 });
    this.box(g, M.paint, W, t, D, 0, H - t / 2, 0, { uvScale: 1.2 });
    this.box(g, M.paint, W, t, D, 0, t / 2 + 0.06, 0, { uvScale: 1.2 });
    this.box(g, M.paint, W - 0.04, 0.06, 0.03, 0, 0.03, D / 2 - 0.03);
    this.box(g, M.paint, W - 0.06, 0.015, D - 0.06, 0, H - 0.3, 0, { uvScale: 1.2 });
    return g;
  }

  cabinet() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    const W = 0.98, H = 1.88, D = 0.43;
    this.box(g, M.paintWhite, W, H, D, 0, H / 2, -0.01, { uvScale: 1.0 });
    // 玻璃門
    this.box(g, M.glass, W * 0.44, H * 0.42, 0.01, -W * 0.23, H * 0.72, D / 2 - 0.005);
    this.box(g, M.glass, W * 0.44, H * 0.42, 0.01, W * 0.23, H * 0.72, D / 2 - 0.005);
    this.box(g, M.steel, 0.015, 0.12, 0.03, -0.03, H * 0.6, D / 2 + 0.01);
    this.box(g, M.steel, 0.015, 0.12, 0.03, 0.03, H * 0.6, D / 2 + 0.01);
    this.box(g, M.paintWhite, W * 0.46, H * 0.42, 0.015, -W * 0.235, H * 0.24, D / 2, { uvScale: 1.0 });
    this.box(g, M.paintWhite, W * 0.46, H * 0.42, 0.015, W * 0.235, H * 0.24, D / 2, { uvScale: 1.0 });
    // 櫃頂上的瓶罐
    for (let k = 0; k < r.int(1, 4); k++) {
      this.cyl(g, r.chance(0.5) ? M.bottle : M.glass, 0.035, 0.04, r.range(0.12, 0.22), r.range(-0.4, 0.4), H + 0.08, r.range(-0.12, 0.12), { seg: 8 });
    }
    return g;
  }

  shelf() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    const W = 1.18, H = 1.86, D = 0.42;
    for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) for (const z of [-D / 2 + 0.02, D / 2 - 0.02]) this.box(g, M.paint, 0.035, H, 0.035, x, H / 2, z);
    const levels = [0.12, 0.6, 1.1, 1.62];
    for (const y of levels) {
      this.box(g, M.paint, W, 0.025, D, 0, y, 0, { uvScale: 1.2 });
      // 架上的東西
      let x = -W / 2 + 0.08;
      while (x < W / 2 - 0.15) {
        const kind = r.next();
        if (kind < 0.35) {
          const w = r.range(0.2, 0.38), h = r.range(0.15, 0.32);
          this.box(g, M.cardboard, w, h, r.range(0.25, 0.36), x + w / 2, y + h / 2 + 0.013, r.range(-0.03, 0.03), { ry: r.range(-0.1, 0.1) });
          x += w + 0.04;
        } else if (kind < 0.7) {
          const h = r.range(0.1, 0.24);
          this.cyl(g, r.chance(0.5) ? M.bottle : M.plasticWhite, 0.04, 0.045, h, x + 0.05, y + h / 2 + 0.013, r.range(-0.1, 0.1), { seg: 8 });
          x += 0.12;
        } else x += r.range(0.1, 0.25);
      }
    }
    return g;
  }

  desk() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    const W = 1.38, D = 0.68, H = 0.76;
    this.box(g, M.wood, W, 0.035, D, 0, H - 0.018, 0, { uvScale: 0.8 });
    this.box(g, M.paint, 0.42, H - 0.04, D - 0.04, W / 2 - 0.23, (H - 0.04) / 2, 0);
    for (let k = 0; k < 3; k++) {
      this.box(g, M.paint, 0.38, 0.2, 0.012, W / 2 - 0.23, 0.14 + k * 0.23, D / 2 - 0.012);
      this.box(g, M.steel, 0.12, 0.015, 0.025, W / 2 - 0.23, 0.2 + k * 0.23, D / 2 + 0.005);
    }
    this.box(g, M.paint, 0.03, H - 0.04, D - 0.06, -W / 2 + 0.03, (H - 0.04) / 2, 0);
    this.box(g, M.paint, W - 0.5, 0.3, 0.015, -0.2, H - 0.2, -D / 2 + 0.03);
    // 桌上的東西：舊映像管螢幕或文件
    if (r.chance(0.5)) {
      this.box(g, M.plasticBeige, 0.4, 0.34, 0.38, -0.3, H + 0.19, -0.1);
      this.box(g, M.screen, 0.32, 0.25, 0.01, -0.3, H + 0.2, 0.095);
      this.box(g, M.plasticBeige, 0.44, 0.03, 0.16, -0.25, H + 0.015, 0.2);
    }
    for (let k = 0; k < r.int(1, 4); k++) {
      const p = this.box(g, M.paperMat, 0.21, 0.004, 0.297, r.range(-0.4, 0.5), H + 0.003 + k * 0.004, r.range(-0.15, 0.15), { ry: r.range(-0.6, 0.6) });
      p.userData.noShadow = true;
    }
    return g;
  }

  chair() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.plasticDark, 0.44, 0.04, 0.42, 0, 0.45, 0, { uvScale: 0.6 });
    this.box(g, M.plasticDark, 0.44, 0.36, 0.035, 0, 0.72, -0.2, { rx: -0.1, uvScale: 0.6 });
    for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) this.tube(g, M.steel, 0.012, [x, 0, z], [x, 0.44, z], 6);
    this.tube(g, M.steel, 0.012, [-0.19, 0.44, -0.19], [-0.19, 0.9, -0.24], 6);
    this.tube(g, M.steel, 0.012, [0.19, 0.44, -0.19], [0.19, 0.9, -0.24], 6);
    return g;
  }

  wheelchair() {
    const { M } = this, g = new THREE.Group();
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.018, 6, 22), M.rubber);
      wheel.position.set(s * 0.3, 0.31, -0.1);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.007, 4, 22), M.steel);
      rim.position.set(s * 0.33, 0.31, -0.1);
      rim.rotation.y = Math.PI / 2;
      g.add(rim);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI;
        this.tube(g, M.steel, 0.003, [s * 0.3, 0.31 + Math.cos(a) * 0.28, -0.1 + Math.sin(a) * 0.28], [s * 0.3, 0.31 - Math.cos(a) * 0.28, -0.1 - Math.sin(a) * 0.28], 3);
      }
      this.sphere(g, M.rubber, 0.06, s * 0.22, 0.06, 0.32, 0.4, 1, 1, 8);
      this.tube(g, M.steel, 0.012, [s * 0.22, 0.12, 0.32], [s * 0.22, 0.5, 0.28], 6);
      this.tube(g, M.steel, 0.013, [s * 0.24, 0.5, 0.3], [s * 0.24, 0.5, -0.2], 6);
      this.tube(g, M.steel, 0.013, [s * 0.24, 0.5, -0.2], [s * 0.24, 0.98, -0.3], 6);
      this.tube(g, M.steel, 0.014, [s * 0.24, 0.98, -0.3], [s * 0.24, 0.98, -0.42], 6);
      this.box(g, M.plasticDark, 0.04, 0.03, 0.3, s * 0.25, 0.72, 0.0);
      this.tube(g, M.steel, 0.01, [s * 0.18, 0.5, 0.3], [s * 0.15, 0.12, 0.45], 5);
      this.box(g, M.plasticDark, 0.12, 0.01, 0.1, s * 0.12, 0.12, 0.47);
    }
    this.box(g, M.leather, 0.46, 0.04, 0.42, 0, 0.52, 0.05);
    this.box(g, M.leather, 0.46, 0.4, 0.03, 0, 0.76, -0.25, { rx: -0.12 });
    return g;
  }

  ivstand() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      this.tube(g, M.steel, 0.012, [0, 0.06, 0], [Math.cos(a) * 0.25, 0.04, Math.sin(a) * 0.25], 5);
      this.sphere(g, M.rubber, 0.025, Math.cos(a) * 0.25, 0.025, Math.sin(a) * 0.25, 1, 1, 1, 6);
    }
    this.tube(g, M.steel, 0.012, [0, 0.04, 0], [0, 1.9, 0], 6);
    this.tube(g, M.steel, 0.008, [-0.15, 1.85, 0], [0.15, 1.85, 0], 5);
    if (r.chance(0.7)) {
      this.box(g, M.ivbag, 0.12, 0.2, 0.03, 0.14, 1.68, 0);
      this.tube(g, M.ivbag, 0.004, [0.14, 1.57, 0], [0.18, 0.6, 0.15], 4);
    }
    return g;
  }

  sink() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.porcelain, 0.58, 0.18, 0.45, 0, 0.8, 0.0, { uvScale: 0.8 });
    this.box(g, M.dark, 0.46, 0.02, 0.32, 0, 0.88, 0.03);
    this.tube(g, M.steel, 0.03, [0, 0.4, -0.15], [0, 0.72, -0.15], 6);
    this.tube(g, M.steel, 0.012, [0, 0.9, -0.18], [0, 1.0, -0.18], 6);
    this.tube(g, M.steel, 0.012, [0, 1.0, -0.18], [0, 1.0, -0.06], 6);
    // 鏡子
    this.box(g, M.mirror, 0.5, 0.65, 0.01, 0, 1.45, -0.22);
    this.box(g, M.steel, 0.54, 0.02, 0.02, 0, 1.13, -0.215);
    this.box(g, M.steel, 0.54, 0.02, 0.02, 0, 1.78, -0.215);
    return g;
  }

  counter() {
    const { M } = this, g = new THREE.Group();
    const W = 2.38, D = 0.72, H = 1.05;
    this.box(g, M.paintWhite, W, H - 0.04, D * 0.95, 0, (H - 0.04) / 2, -0.01, { uvScale: 1.2 });
    this.box(g, M.wood, W + 0.04, 0.04, D + 0.05, 0, H - 0.02, 0, { uvScale: 0.8 });
    this.box(g, M.wood, W, 0.12, 0.02, 0, H - 0.1, D / 2 + 0.01, { uvScale: 0.8 });
    for (let k = 0; k < 4; k++) {
      const p = this.box(g, M.paperMat, 0.21, 0.004, 0.297, this.rng.range(-1, 1), H + 0.003, this.rng.range(-0.2, 0.2), { ry: this.rng.range(-0.8, 0.8) });
      p.userData.noShadow = true;
    }
    return g;
  }

  bench() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.steel, 1.95, 0.05, 0.06, 0, 0.32, 0.02);
    for (const x of [-0.85, 0.85]) {
      this.tube(g, M.steel, 0.02, [x, 0, 0.02], [x, 0.32, 0.02], 6);
      this.box(g, M.steel, 0.06, 0.02, 0.45, x, 0.01, 0.02);
    }
    for (let k = 0; k < 4; k++) {
      const x = -0.73 + k * 0.487;
      if (this.rng.chance(0.12)) continue; // 少一張椅子
      this.box(g, M.plasticBlue, 0.44, 0.04, 0.42, x, 0.45, 0.02, { uvScale: 0.6 });
      this.box(g, M.plasticBlue, 0.44, 0.38, 0.035, x, 0.7, -0.2, { rx: -0.12, uvScale: 0.6 });
      this.tube(g, M.steel, 0.012, [x, 0.34, 0.02], [x, 0.44, 0.02], 5);
    }
    return g;
  }

  morgue() {
    const { M } = this, g = new THREE.Group();
    const W = 2.55, H = 1.98, D = 0.78;
    this.box(g, M.steel, W, H, D, 0, H / 2, 0, { uvScale: 1.2 });
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const x = -W / 3 + col * (W / 3), y = 0.38 + row * 0.62;
      this.box(g, M.steel, W / 3 - 0.06, 0.56, 0.03, x, y, D / 2 + 0.012, { uvScale: 0.8 });
      this.box(g, M.dark, 0.18, 0.025, 0.04, x, y + 0.18, D / 2 + 0.04);
      this.box(g, M.paperMat, 0.1, 0.06, 0.004, x - 0.2, y + 0.18, D / 2 + 0.03);
    }
    return g;
  }

  optable() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.steel, 0.5, 0.06, 0.7, 0, 0.03, 0);
    this.cyl(g, M.steel, 0.09, 0.11, 0.8, 0, 0.45, 0, { seg: 12 });
    this.box(g, M.steel, 0.62, 0.06, 1.9, 0, 0.88, 0);
    this.box(g, M.leather, 0.58, 0.05, 1.86, 0, 0.935, 0);
    // 束縛帶
    for (const z of [-0.5, 0.2, 0.7]) this.box(g, M.leatherBrown, 0.66, 0.012, 0.08, 0, 0.965, z);
    return g;
  }

  trolley() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    for (const [x, z] of [[-0.3, -0.18], [0.3, -0.18], [-0.3, 0.18], [0.3, 0.18]]) {
      this.tube(g, M.steel, 0.012, [x, 0.06, z], [x, 0.88, z], 6);
      this.sphere(g, M.rubber, 0.03, x, 0.03, z, 1, 1, 1, 6);
    }
    this.box(g, M.steel, 0.66, 0.015, 0.42, 0, 0.88, 0);
    this.box(g, M.steel, 0.66, 0.015, 0.42, 0, 0.35, 0);
    for (let k = 0; k < r.int(2, 5); k++) this.box(g, M.steel, r.range(0.02, 0.06), 0.008, r.range(0.12, 0.2), r.range(-0.25, 0.25), 0.895, r.range(-0.12, 0.12), { ry: r.range(-1, 1) });
    if (r.chance(0.5)) this.box(g, M.cardboard, 0.3, 0.2, 0.25, 0, 0.46, 0);
    return g;
  }

  boxes() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    let y = 0;
    for (let k = 0; k < r.int(1, 3); k++) {
      const w = r.range(0.45, 0.8), h = r.range(0.25, 0.4), d = r.range(0.35, 0.55);
      this.box(g, M.cardboard, w, h, d, r.range(-0.1, 0.1), y + h / 2, r.range(-0.05, 0.05), { ry: r.range(-0.3, 0.3), uvScale: 0.7 });
      y += h;
      if (y > 0.6) break;
    }
    return g;
  }

  bin() {
    const { M } = this, g = new THREE.Group();
    this.cyl(g, M.paint, 0.17, 0.15, 0.55, 0, 0.275, 0, { seg: 14, uvScale: 0.6 });
    this.cyl(g, M.dark, 0.165, 0.165, 0.01, 0, 0.551, 0, { seg: 14 });
    return g;
  }

  plant() {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    this.cyl(g, M.ceramicPot, 0.2, 0.15, 0.36, 0, 0.18, 0, { seg: 12 });
    this.cyl(g, M.dark, 0.19, 0.19, 0.01, 0, 0.35, 0, { seg: 12 });
    for (let k = 0; k < 7; k++) {
      const a = r.range(0, 6.28), l = r.range(0.4, 0.9);
      this.tube(g, M.deadPlant, 0.008, [0, 0.35, 0], [Math.cos(a) * 0.25, 0.35 + l, Math.sin(a) * 0.25], 4);
    }
    return g;
  }

  generator() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.paintYellow, 2.1, 1.1, 1.0, 0, 0.62, 0, { uvScale: 1.2 });
    this.box(g, M.dark, 2.2, 0.08, 1.06, 0, 0.04, 0);
    this.cyl(g, M.dark, 0.32, 0.32, 0.95, -0.35, 0.62, 0.05, { rz: Math.PI / 2, seg: 14 });
    this.box(g, M.paint, 0.5, 0.45, 0.04, 0.65, 0.85, 0.51);
    for (let k = 0; k < 3; k++) this.cyl(g, M.glass, 0.05, 0.05, 0.02, 0.5 + k * 0.14, 0.95, 0.54, { rx: Math.PI / 2, seg: 10 });
    this.tube(g, M.dark, 0.06, [0.8, 1.17, -0.2], [0.8, 1.6, -0.2]);
    this.tube(g, M.dark, 0.06, [0.8, 1.6, -0.2], [0.8, 1.6, -0.5]);
    this.box(g, M.hazard, 2.11, 0.08, 1.01, 0, 0.2, 0, { uvScale: 0.5 });
    return g;
  }

  // 配電箱（互動，不合併）
  fusebox() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.paint, 0.82, 0.92, 0.16, 0, 1.45, 0.0);
    this.box(g, M.dark, 0.7, 0.62, 0.02, 0, 1.43, 0.08);
    const sockets = [], lamps = [];
    for (let k = 0; k < 3; k++) {
      const x = -0.22 + k * 0.22;
      const s = this.box(g, M.socket, 0.12, 0.3, 0.03, x, 1.42, 0.095);
      sockets.push(s);
      const lampMat = M.lampRed.clone();
      const l = this.sphere(g, lampMat, 0.022, x, 1.68, 0.09, 1, 1, 1, 8);
      lamps.push(l);
    }
    this.box(g, M.hazard, 0.82, 0.06, 0.17, 0, 1.94, 0.0);
    // 標籤
    this.box(g, M.paperMat, 0.3, 0.06, 0.004, 0, 1.2, 0.092);
    // 電線管
    this.tube(g, M.dark, 0.025, [0.3, 1.9, -0.02], [0.3, 3.0, -0.02], 6);
    this.tube(g, M.dark, 0.025, [-0.3, 1.9, -0.02], [-0.3, 3.0, -0.02], 6);
    g.userData.sockets = sockets;
    g.userData.lamps = lamps;
    return g;
  }

  // ---- 裝飾
  curtain(len = 2.0) {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    const h = 1.75, top = 2.35;
    const geo = new THREE.PlaneGeometry(len, h, 24, 6);
    const p = geo.attributes.position;
    const pulled = r.range(0.3, 1.0);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const t = (x / len + 0.5);
      // 拉到一邊時壓縮皺褶
      const nx = (t * pulled - 0.5) * len;
      const fold = Math.sin(t * 24 * pulled + 1.3) * 0.05 + Math.sin(t * 7) * 0.02;
      const hem = (y < -h / 2 + 0.05) ? r.range(-0.04, 0.04) : 0;
      p.setXYZ(i, nx, y + hem, fold);
    }
    geo.computeVertexNormals();
    projectUV(geo, 1.6);
    const m = new THREE.Mesh(geo, M.curtain);
    m.position.set(0, top - h / 2, 0);
    m.rotation.y = Math.PI / 2;
    g.add(m);
    this.tube(g, M.steel, 0.012, [0, top + 0.03, -len / 2], [0, top + 0.03, len / 2], 6);
    this.tube(g, M.steel, 0.008, [0, top + 0.03, 0], [0, 3.0, 0], 4);
    return g;
  }

  surgicalLamp() {
    const { M } = this, g = new THREE.Group();
    this.tube(g, M.steel, 0.03, [0, 3.0, 0], [0, 2.55, 0]);
    this.tube(g, M.steel, 0.025, [0, 2.55, 0], [0.45, 2.35, 0]);
    const head = this.cyl(g, M.paintWhite, 0.38, 0.32, 0.16, 0.45, 2.22, 0, { seg: 20 });
    head.rotation.z = 0.15;
    this.cyl(g, M.lampOff, 0.3, 0.3, 0.01, 0.45, 2.135, 0, { seg: 20 });
    return g;
  }

  barricade(b) {
    const { M } = this, g = new THREE.Group(), r = this.rng;
    // 疊起來的床、椅子和木板
    const bed1 = this.bed({ variant: 2 });
    bed1.rotation.set(0.1, Math.PI / 2 + r.range(-0.2, 0.2), r.range(0.3, 0.5));
    bed1.position.set(r.range(-0.3, 0.3), 0.35, 0);
    g.add(bed1);
    const bed2 = this.bed({ variant: 1 });
    bed2.rotation.set(-0.6, Math.PI / 2 + r.range(-0.3, 0.3), 0.2);
    bed2.position.set(r.range(-0.4, 0.4), 0.5, 0.4);
    g.add(bed2);
    for (let k = 0; k < 3; k++) {
      const c = this.chair();
      c.position.set(r.range(-1, 1), r.range(0.0, 1.0), r.range(-0.6, 0.6));
      c.rotation.set(r.range(-1.5, 1.5), r.range(0, 6), r.range(-1.5, 1.5));
      g.add(c);
    }
    for (let k = 0; k < 5; k++) this.box(g, M.wood, 2.9, 0.18, 0.03, 0, 0.5 + k * 0.35 + r.range(-0.1, 0.1), r.range(-0.6, 0.6), { rz: r.range(-0.25, 0.25), ry: r.range(-0.1, 0.1), uvScale: 0.8 });
    const w = this.wheelchair();
    w.position.set(r.range(-0.8, 0.8), 0, 0.9);
    w.rotation.set(0, r.range(0, 6), 0.4);
    g.add(w);
    // 路障橫向擋住走廊
    g.rotation.y = b.horizontal ? Math.PI / 2 : 0;
    return g;
  }

  tv() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.plasticDark, 0.62, 0.5, 0.45, 0, 0, -0.05);
    this.box(g, M.plasticDark, 0.2, 0.05, 0.35, 0, 0.27, -0.25);
    const screen = this.box(g, M.tvScreen, 0.5, 0.38, 0.01, 0, 0, 0.175, { uv: false });
    screen.userData.dynamic = true;
    return g;
  }

  phone() {
    const { M } = this, g = new THREE.Group();
    this.box(g, M.plasticRed, 0.2, 0.08, 0.22, 0, 0.04, 0);
    this.cyl(g, M.plasticRed, 0.07, 0.08, 0.04, 0, 0.1, 0.02, { seg: 12 });
    const hs = this.box(g, M.plasticRed, 0.22, 0.04, 0.05, 0, 0.14, -0.05);
    hs.userData.handset = true;
    return g;
  }

  // ---- 撿拾道具（不合併，會發光）
  pickup(kind) {
    const { M } = this, g = new THREE.Group();
    switch (kind) {
      case 'fuse':
        this.cyl(g, M.fuseGlass, 0.022, 0.022, 0.1, 0, 0.022, 0, { rz: Math.PI / 2, seg: 10, uv: false });
        this.cyl(g, M.brass, 0.025, 0.025, 0.025, -0.06, 0.022, 0, { rz: Math.PI / 2, seg: 10 });
        this.cyl(g, M.brass, 0.025, 0.025, 0.025, 0.06, 0.022, 0, { rz: Math.PI / 2, seg: 10 });
        this.cyl(g, M.fuseWire, 0.003, 0.003, 0.1, 0, 0.022, 0, { rz: Math.PI / 2, seg: 4, uv: false });
        break;
      case 'battery':
        this.cyl(g, M.batteryBody, 0.017, 0.017, 0.06, 0, 0.017, 0, { rz: Math.PI / 2, seg: 10 });
        this.cyl(g, M.brass, 0.007, 0.007, 0.006, 0.033, 0.017, 0, { rz: Math.PI / 2, seg: 8 });
        this.cyl(g, M.batteryBody, 0.017, 0.017, 0.06, 0.0, 0.017, 0.04, { rz: Math.PI / 2, seg: 10 });
        break;
      case 'film':
        this.box(g, M.filmBox, 0.1, 0.03, 0.07, 0, 0.015, 0);
        break;
      case 'pills':
        this.cyl(g, M.bottle, 0.025, 0.025, 0.08, 0, 0.04, 0, { seg: 10 });
        this.cyl(g, M.plasticWhite, 0.027, 0.027, 0.02, 0, 0.09, 0, { seg: 10 });
        break;
      case 'bottle':
        this.cyl(g, M.bottleGreen, 0.032, 0.034, 0.17, 0, 0.085, 0, { seg: 10, uv: false });
        this.cyl(g, M.bottleGreen, 0.012, 0.03, 0.05, 0, 0.195, 0, { seg: 10, uv: false });
        this.cyl(g, M.bottleGreen, 0.012, 0.012, 0.04, 0, 0.24, 0, { seg: 8, uv: false });
        break;
      case 'note': {
        const p = this.box(g, M.noteMat, 0.21, 0.003, 0.28, 0, 0.002, 0, { uv: false });
        p.rotation.y = 0.2;
        break;
      }
    }
    return g;
  }
}

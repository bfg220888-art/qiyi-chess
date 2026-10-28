// 細節層次（LOD）：載入模型時用 meshoptimizer 把網格簡化成比較少的三角形。
// 只產生新的索引，頂點資料（位置、法線、UV、骨架權重、表情）全部共用，所以幾乎不多佔記憶體，
// 法線也是原本的平滑法線，遠處不會變成一面一面的。WebAssembly 不能用時（例如被內容安全政策擋掉）就不做 LOD。
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

let ok = null;
export function lodReady() {
  if (!ok) ok = MeshoptSimplifier.ready.then(() => true, () => false);
  return ok;
}
// 模組載入時就開始初始化，失敗也不要變成未處理的 Promise 錯誤
lodReady();

const cache = new WeakMap();

// 回傳簡化後的索引（BufferAttribute），失敗或省不了多少時回傳 null。
// ratio：目標三角形比例；error：允許的形狀誤差（相對於模型大小）
export function simplifyIndex(geometry, ratio, error) {
  if (!MeshoptSimplifier.supported) return null;
  let per = cache.get(geometry);
  if (!per) cache.set(geometry, (per = new Map()));
  const key = ratio + ':' + error;
  if (per.has(key)) return per.get(key);
  let out = null;
  try {
    const pos = geometry.attributes.position, idx = geometry.index;
    if (idx && pos) {
      const P = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
      const I = new Uint32Array(idx.count);
      for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i);
      const target = Math.max(3, Math.floor(I.length * ratio / 3) * 3);
      // LockBorder：同一組頂點上的不同部位（頭、身體）交界不能動，否則會裂開
      const [res] = MeshoptSimplifier.simplify(I, P, 3, target, error, ['LockBorder']);
      if (res.length >= 3 && res.length < I.length * 0.85) {
        out = new THREE.BufferAttribute(pos.count < 65536 ? new Uint16Array(res) : res, 1);
      }
    }
  } catch (e) {
    out = null;
  }
  per.set(key, out);
  return out;
}

// 共用頂點資料、只換索引的幾何（同一個原始幾何、同樣參數只做一次，所有實例共用）
const geoCache = new WeakMap();
export function lodGeometry(geometry, ratio, error) {
  let per = geoCache.get(geometry);
  if (!per) geoCache.set(geometry, (per = new Map()));
  const key = ratio + ':' + error;
  if (!per.has(key)) per.set(key, buildLod(geometry, ratio, error));
  return per.get(key);
}
function buildLod(geometry, ratio, error) {
  const index = simplifyIndex(geometry, ratio, error);
  if (!index) return null;
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geometry.attributes)) g.setAttribute(k, a);
  g.setIndex(index);
  g.boundingSphere = geometry.boundingSphere;
  g.boundingBox = geometry.boundingBox;
  if (!g.boundingSphere) { geometry.computeBoundingSphere(); g.boundingSphere = geometry.boundingSphere; }
  return g;
}

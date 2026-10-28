// 病床與推床上的屍體：Microsoft Rocketbox 人物（MIT）擺成各種躺姿後烘成靜態網格（見 tools/corpse/），
// 貼圖重畫成死白的皮膚、屍斑、割傷、解剖切口與沾血的衣服。下載失敗時遊戲照常進行，只是床上沒有屍體。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl, assetBuffer } from './assets.js';
import { corpseShift } from './corpse-poses.js';
import { lodReady, lodGeometry } from './lod.js';

const BASE = 'assets/corpses/';
const PARTS = { m021: ['body', 'head'], f002: ['body', 'head', 'opacity'], m162: ['body', 'head', 'protection'] };

let glbP = null;
const imgP = new Map();
function getGlb() {
  if (!glbP) glbP = assetBuffer(BASE + 'corpses.glb').then((buf) => new GLTFLoader().parseAsync(buf, '')).catch((e) => { glbP = null; throw e; });
  return glbP;
}
function getImage(name) {
  if (!imgP.has(name)) {
    imgP.set(name, new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => { imgP.delete(name); rej(new Error('load ' + name)); };
      img.src = assetUrl(BASE + name);
    }));
  }
  return imgP.get(name);
}
const file = (id, part) => `${id}_${part}.${part === 'opacity' ? 'webp' : 'jpg'}`;

export function prefetchCorpses() {
  getGlb().catch(() => {});
  for (const [id, parts] of Object.entries(PARTS)) for (const p of parts) getImage(file(id, p)).catch(() => {});
}

// 回傳 { meshes: { 'm021_supine': [{ geometry, part }] }, materials: { m021: { body, head } } }
export async function loadCorpses(renderer, quality, timeoutMs = 20000) {
  const work = (async () => {
    const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality.aniso);
    const tex = async (id, part) => {
      const img = await getImage(file(id, part));
      // 高畫質全用 1024；其他畫質臉 1024、身體 512；低畫質再減半
      const limit = quality.propTex >= 1024 ? 1024 : part === 'head' && quality.propTex >= 512 ? 1024 : quality.propTex >= 512 ? 512 : 256;
      let src = img;
      if (img.width > limit) {
        src = document.createElement('canvas');
        src.width = src.height = limit;
        src.getContext('2d').drawImage(img, 0, 0, limit, limit);
      }
      // 烘焙工具輸出的是 FBX 原本的 UV（原點在左下），所以跟一般 three.js 貼圖一樣要上下翻轉
      const t = new THREE.Texture(src);
      t.flipY = true;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      return t;
    };
    const [gltf, lodOk, ...texs] = await Promise.all([getGlb(), lodReady(), ...Object.entries(PARTS).flatMap(([id, parts]) => parts.map((p) => tex(id, p).then((t) => [id, p, t])))]);
    const materials = {};
    for (const [id, part, t] of texs) {
      const m = new THREE.MeshStandardMaterial({ map: t, roughness: part === 'protection' ? 0.85 : 0.72, metalness: 0, name: `corpse_${id}_${part}` });
      if (part === 'opacity') { m.alphaTest = 0.4; m.side = THREE.DoubleSide; }
      (materials[id] || (materials[id] = {}))[part] = m;
    }
    const meshes = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // 多材質的網格會被拆成一個 Group 底下好幾個 Mesh：往上找到名字像「m021_supine」的那一層
      let owner = o;
      while (owner && !/^[mf]\d{3}_[a-z]+$/.test(owner.name)) owner = owner.parent;
      if (!owner) return;
      const part = o.material.name;
      // 細節層次：中距離約 45%、遠處約 18% 的三角形（只換索引，共用頂點）
      const lods = lodOk ? [lodGeometry(o.geometry, 0.45, 0.012), lodGeometry(o.geometry, 0.18, 0.04)] : [];
      (meshes[owner.name] || (meshes[owner.name] = [])).push({ geometry: o.geometry, part, lods });
    });
    return { meshes, materials };
  })();
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('corpse assets timeout')), timeoutMs); });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
  }
}

// 切換細節層次的距離（公尺）
const LOD_DIST = [0, 6.5, 13];

// 做出一具屍體（共用幾何與材質）。mirror：左右翻轉（垂下來的手換到另一側）
// 回傳 THREE.LOD：近處用完整模型，越遠用越簡化的版本（最遠一級不投影，遠處的影子本來就看不出來）
export function makeCorpse(assets, name, mirror) {
  const parts = assets.meshes[name];
  if (!parts) return null;
  const id = name.split('_')[0];
  const levels = Math.min(...parts.map((p) => (p.lods && p.lods.every(Boolean) ? p.lods.length : 0))) + 1;
  const g = new THREE.LOD();
  for (let l = 0; l < levels; l++) {
    const lg = new THREE.Group();
    for (const p of parts) {
      const mat = assets.materials[id] && assets.materials[id][p.part];
      if (!mat) continue;
      const m = new THREE.Mesh(l ? p.lods[l - 1] : p.geometry, mat);
      m.castShadow = p.part !== 'opacity' && l < 2;
      m.receiveShadow = true;
      lg.add(m);
    }
    g.addLevel(lg, LOD_DIST[l], 0.1);
  }
  if (mirror) g.scale.x = -1;
  g.userData.corpse = name;
  return g;
}

// 擺到病床或推床上（沿著床的方向挪一點，讓頭和腳都在床頭板與床尾板之間）
export function placeCorpse(c, f) {
  const gurney = f.kind === 'gurney';
  let shift = corpseShift(c.userData.corpse, f.kind), y = gurney ? 0.895 : 0.64;
  // 解剖台比病床高；冷藏抽屜上的屍體頭還在櫃子裡、腳伸出來
  if (f.kind === 'autopsy') y = 0.955;
  else if (f.kind === 'tray') { y = f.trayTop + 0.01; shift = -0.42; }
  c.position.set(f.x + Math.sin(f.rot) * shift, y, f.z + Math.cos(f.rot) * shift);
  c.rotation.y = f.rot + (gurney ? Math.PI / 2 : 0);
  c.userData.furn = f;
}

// 多人模式裡「其他玩家」的第三人稱模型：Microsoft Rocketbox（MIT）的一男一女（見 tools/players/），
// 穿便服、手裡拿著手電筒的探險者。動作有待機、走、跑、蹲、蹲著走、倒地，依移動速度混合。
// 每個玩家編號有自己的上衣顏色（紅、藍、綠、黃），偶數號是男生、奇數號是女生。
//
// 座標與單位（公尺、弧度）：
// - root 的原點在兩腳之間的地面上，模型面向 root 的 +Z。
// - 跟 player.js 的視角一樣用 yaw（往前 = (-sin yaw, 0, -cos yaw)）的話：root.rotation.y = yaw + Math.PI，
//   或直接呼叫 setTransform(x, y, z, yaw)。
// - lightSocket 掛在手電筒燈頭上，光線方向是它的 +Z。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl, assetBuffer } from './assets.js';

const BASE = 'assets/players/';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 玩家編號 0..3 的上衣顏色與人物（M 男、F 女）
export const SLOT_COLORS = [0xc0302a, 0x2a62c8, 0x2f9a3c, 0xe0b420];
const SLOT_AVATAR = ['M', 'F', 'M', 'F'];
const AVATARS = {
  M: { id: 'm023', parts: ['body', 'head'] },
  F: { id: 'f008', parts: ['body', 'head', 'opacity'] },
};
// 原始動作的步行速度量不到時的預設值（公尺 / 秒）
const DEFAULT_GAIT = { walk: { speed: 1.05, phase: 0 }, run: { speed: 2.75, phase: 0 }, crouchwalk: { speed: 0.6, phase: 0 } };

let glbP = null;
const imgP = new Map();
function getGlb() {
  if (!glbP) glbP = assetBuffer(BASE + 'player.glb').then((buf) => new GLTFLoader().parseAsync(buf, '')).catch((e) => { glbP = null; throw e; });
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
const fileOf = (id, part) => `${id}_${part}.${part === 'opacity' ? 'webp' : part === 'mask' ? 'png' : 'jpg'}`;
const allFiles = () => Object.values(AVATARS).flatMap((a) => [...a.parts, 'mask'].map((p) => fileOf(a.id, p)));

// 進入選單時先開始下載（可選）
export function prefetchPlayers() {
  getGlb().catch(() => {});
  for (const f of allFiles()) getImage(f).catch(() => {});
}

// 載入模型與貼圖；同一個畫質只載一次。任何檔案失敗或逾時都回傳 null（呼叫端可改用簡單的替代模型）。
// 逾時不會中斷下載：檔案繼續在背景下載，下次呼叫就會成功。
const loaded = new Map();
export async function loadPlayerAssets(renderer, quality, timeoutMs = 30000) {
  const key = quality.propTex + ':' + quality.aniso;
  if (!loaded.has(key)) {
    const p = buildAssets(renderer, quality);
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  const work = loaded.get(key);
  let timer;
  const timeout = new Promise((res) => { timer = setTimeout(() => res(null), timeoutMs); });
  try {
    return await Promise.race([work, timeout]);
  } catch (e) {
    console.warn('player assets', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildAssets(renderer, quality) {
  const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality.aniso || 1);
  // 身體貼圖：低畫質 512，其他 1024；頭 512（低畫質 256）
  const bodySize = quality.propTex >= 512 ? 1024 : 512;
  const headSize = quality.propTex >= 512 ? 512 : 256;
  const canvasOf = (img, size) => {
    const c = document.createElement('canvas');
    c.width = c.height = Math.min(size, img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  };
  const texOf = (src, srgb = true) => {
    const t = new THREE.Texture(src);
    // 轉檔時 UV 已經翻成 glTF 的慣例（原點左上），所以不要再上下翻轉
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    return t;
  };
  const [gltf, ...imgs] = await Promise.all([getGlb(), ...allFiles().map((f) => getImage(f))]);
  const img = Object.fromEntries(allFiles().map((f, i) => [f, imgs[i]]));
  const assets = { avatars: {}, bodyMats: new Map(), disposables: [] };
  for (const [key, def] of Object.entries(AVATARS)) {
    const scene = gltf.scene.getObjectByName(key);
    if (!scene) throw new Error('player.glb 缺少人物 ' + key);
    const clips = {};
    for (const c of gltf.animations) if (c.name.startsWith(key + '_')) clips[c.name.slice(key.length + 1)] = c;
    const gait = { ...DEFAULT_GAIT, ...(scene.userData.gait || {}) };
    for (const k of Object.keys(DEFAULT_GAIT)) if (!(gait[k].speed > 0.05)) gait[k] = { ...DEFAULT_GAIT[k], phase: gait[k].phase || 0 };
    const headMat = new THREE.MeshStandardMaterial({ name: 'player_head', map: texOf(canvasOf(img[fileOf(def.id, 'head')], headSize)), roughness: 0.7, metalness: 0 });
    assets.disposables.push(headMat.map, headMat);
    let hairMat = null;
    if (def.parts.includes('opacity')) {
      hairMat = new THREE.MeshStandardMaterial({ name: 'player_hair', map: texOf(canvasOf(img[fileOf(def.id, 'opacity')], 512)), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.65, metalness: 0 });
      assets.disposables.push(hairMat.map, hairMat);
    }
    // 上衣染色用：原始貼圖與遮罩的像素先讀出來，之後每種顏色只做一次
    const base = canvasOf(img[fileOf(def.id, 'body')], bodySize);
    const mask = document.createElement('canvas');
    mask.width = mask.height = base.width;
    mask.getContext('2d').drawImage(img[fileOf(def.id, 'mask')], 0, 0, base.width, base.width);
    assets.avatars[key] = {
      key, scene, clips, gait, headMat, hairMat, base,
      basePx: base.getContext('2d').getImageData(0, 0, base.width, base.height),
      maskPx: mask.getContext('2d').getImageData(0, 0, base.width, base.height),
    };
  }
  assets.texOf = texOf;
  return assets;
}

// 把灰色上衣染成指定顏色：保留布料的明暗與皺褶（亮度 / 平均亮度 × 目標顏色）
function bodyMaterial(assets, av, color) {
  const key = av.key + ':' + color;
  if (assets.bodyMats.has(key)) return assets.bodyMats.get(key);
  const src = av.basePx.data, m = av.maskPx.data;
  const c = document.createElement('canvas');
  c.width = av.basePx.width; c.height = av.basePx.height;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(c.width, c.height);
  const d = out.data;
  // 上衣的平均亮度
  let sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i += 4) if (m[i] > 200) { sum += src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11; cnt++; }
  const mean = cnt ? sum / cnt : 128;
  const tc = new THREE.Color(color);
  const tr = tc.r * 255, tg = tc.g * 255, tb = tc.b * 255;
  for (let i = 0; i < src.length; i += 4) {
    const w = m[i] / 255;
    const r = src[i], g = src[i + 1], b = src[i + 2];
    if (w <= 0.003) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; continue; }
    const k = (r * 0.3 + g * 0.59 + b * 0.11) / mean;
    d[i] = r + (Math.min(255, tr * k) - r) * w;
    d[i + 1] = g + (Math.min(255, tg * k) - g) * w;
    d[i + 2] = b + (Math.min(255, tb * k) - b) * w;
    d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ name: 'player_body', map: assets.texOf(c), roughness: 0.85, metalness: 0 });
  assets.disposables.push(mat.map, mat);
  assets.bodyMats.set(key, mat);
  return mat;
}

// 釋放 loadPlayerAssets 建立的貼圖與材質（所有模型都 dispose 之後才呼叫）
export function disposePlayerAssets(assets) {
  if (!assets) return;
  for (const d of assets.disposables) d.dispose();
  assets.disposables.length = 0;
  assets.bodyMats.clear();
  for (const [k, p] of loaded) p.then((a) => { if (a === assets) loaded.delete(k); }, () => {});
}

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();

// 程序化的手電筒（公尺；+Z 是光線方向，原點在握把中間）
function makeFlashlight() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.6 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.3, metalness: 0.9 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d0, emissiveIntensity: 0, roughness: 0.1, metalness: 0 });
  const tube = new THREE.CylinderGeometry(0.016, 0.016, 0.17, 12);
  tube.rotateX(Math.PI / 2);
  const head = new THREE.CylinderGeometry(0.026, 0.017, 0.05, 14);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, 0.105);
  const rim = new THREE.TorusGeometry(0.025, 0.003, 6, 16);
  rim.translate(0, 0, 0.13);
  const lens = new THREE.CircleGeometry(0.023, 16);
  lens.translate(0, 0, 0.131);
  const cap = new THREE.CylinderGeometry(0.017, 0.017, 0.012, 12);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, -0.09);
  for (const [geo, mat] of [[tube, bodyMat], [head, bodyMat], [rim, rimMat], [lens, lensMat], [cap, rimMat]]) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = mat !== lensMat;
    g.add(m);
  }
  const socket = new THREE.Object3D();
  socket.name = 'lightSocket';
  socket.position.set(0, 0, 0.135);
  g.add(socket);
  return { group: g, socket, lensMat, dispose() { for (const x of [tube, head, rim, lens, cap, bodyMat, rimMat, lensMat]) x.dispose(); } };
}

// 讓骨頭的兩個本地方向（a 主要、b 次要）轉到指定的世界方向，weight 0..1
function alignBone(bone, localA, worldA, localB, worldB, weight, tmp) {
  if (weight <= 0.001) return;
  const bq = bone.getWorldQuaternion(tmp.q1);
  const basis = (a, b, m) => {
    const x = tmp.v1.copy(a).normalize();
    const z = tmp.v2.crossVectors(x, b).normalize();
    const y = tmp.v3.crossVectors(z, x);
    return m.makeBasis(x, y, z);
  };
  const cur = basis(tmp.v4.copy(localA).applyQuaternion(bq), tmp.v5.copy(localB).applyQuaternion(bq), tmp.m1);
  const want = basis(worldA, worldB, tmp.m2);
  const d = tmp.q2.setFromRotationMatrix(want.multiply(cur.transpose()));
  tmp.q3.identity().slerp(d, weight);
  const wq = tmp.q3.multiply(bq);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(tmp.q4).invert().multiply(wq));
  bone.updateMatrixWorld(true);
}
// 只指定一個方向（骨頭指向子關節）
function aimBone(bone, child, worldDir, weight, tmp) {
  if (weight <= 0.001) return;
  const p = bone.getWorldPosition(tmp.v1), c = child.getWorldPosition(tmp.v2);
  const d = tmp.q1.setFromUnitVectors(c.sub(p).normalize(), worldDir);
  tmp.q2.identity().slerp(d, weight);
  const wq = tmp.q2.multiply(bone.getWorldQuaternion(tmp.q3));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(tmp.q4).invert().multiply(wq));
  bone.updateMatrixWorld(true);
}

const LOCO = ['walk', 'run', 'crouchwalk'];

// 建立一個玩家模型。slot = 玩家編號（0..3，超過會循環），決定人物與上衣顏色。
export function makePlayerModel(assets, slot = 0) {
  const s = ((slot % 4) + 4) % 4;
  const av = assets.avatars[SLOT_AVATAR[s]];
  const root = new THREE.Group();
  root.name = 'player' + slot;
  const body = cloneSkinned(av.scene);
  // 模型單位是公分
  body.scale.setScalar(0.01);
  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  root.add(body);
  const bodyMat = bodyMaterial(assets, av, SLOT_COLORS[s]);
  const meshes = [];
  body.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const n = o.material.name;
    o.material = n === 'head' ? av.headMat : n === 'opacity' ? av.hairMat : bodyMat;
    o.castShadow = n !== 'opacity';
    o.receiveShadow = true;
    meshes.push(o);
  });
  const P = av.key + '_Bip01_';
  const bone = (n) => body.getObjectByName(P + n);
  // 視錐剔除用的包圍球：倒地時身體會往前躺到 1.7 公尺外，所以放大一些
  body.updateMatrixWorld(true);
  for (const m of meshes) { m.computeBoundingSphere(); m.boundingSphere.radius *= 2.2; }

  // --- 綁定姿勢下右手的方向：手腕→中指根部（指向）、食指根部→小指根部（橫越手掌）
  const hand = bone('R_Hand'), upper = bone('R_UpperArm'), fore = bone('R_Forearm');
  const tmp = { v1: V(), v2: V(), v3: V(), v4: V(), v5: V(), q1: Q(), q2: Q(), q3: Q(), q4: Q(), m1: new THREE.Matrix4(), m2: new THREE.Matrix4() };
  const handInv = hand.getWorldQuaternion(Q()).invert();
  const fingerDir = bone('R_Finger2').getWorldPosition(V()).sub(hand.getWorldPosition(V())).normalize();
  const across = bone('R_Finger4').getWorldPosition(V()).sub(bone('R_Finger1').getWorldPosition(V())).normalize();
  const fingerLocal = fingerDir.clone().applyQuaternion(handInv);
  const acrossLocal = across.clone().applyQuaternion(handInv);
  // 手指握拳（右手握住手電筒，左手半握）：繞著橫越手掌的軸彎曲。手指沒有動作軌道，設一次就好
  for (const [side, amount] of [['R', 1], ['L', 0.45]]) {
    const ax = bone(side + '_Finger4').getWorldPosition(V()).sub(bone(side + '_Finger1').getWorldPosition(V())).normalize();
    const sign = side === 'L' ? 1 : -1;
    for (const f of [1, 2, 3, 4]) for (const [seg, k] of [['', 0.9], ['1', 1.3], ['2', 0.8]]) {
      const b = bone(`${side}_Finger${f}${seg}`);
      if (!b) continue;
      const wq = Q().setFromAxisAngle(ax, sign * amount * k).multiply(b.getWorldQuaternion(Q()));
      b.quaternion.copy(b.parent.getWorldQuaternion(Q()).invert().multiply(wq));
      b.updateMatrixWorld(true);
    }
    // 拇指往掌心收
    const t0 = bone(side + '_Finger0');
    if (t0) {
      const wq = Q().setFromAxisAngle(fingerDir, sign * amount * 0.5).multiply(t0.getWorldQuaternion(Q()));
      t0.quaternion.copy(t0.parent.getWorldQuaternion(Q()).invert().multiply(wq));
    }
  }
  // --- 手電筒：軸線沿著「小指→食指」方向從虎口伸出，放在掌心
  const light = makeFlashlight();
  const prop = new THREE.Group();
  prop.add(light.group);
  hand.add(prop);
  // hand 底下的座標是公分（父層縮放 0.01），手電筒是公尺做的，所以放大 100 倍
  prop.scale.setScalar(100);
  const beamLocal = acrossLocal.clone().negate();
  prop.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), beamLocal);
  // 握把中心：手腕到中指根部 55% 的位置，再往掌心那側偏一點
  const palmLocal = V().crossVectors(fingerLocal, acrossLocal).normalize();
  const handLen = bone('R_Finger2').position.length();
  prop.position.copy(fingerLocal).multiplyScalar(handLen * 0.6).addScaledVector(palmLocal, -2.2);

  // --- 動作
  const mixer = new THREE.AnimationMixer(body);
  const actions = {};
  for (const [name, clip] of Object.entries(av.clips)) {
    const a = mixer.clipAction(clip);
    if (name === 'dead') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    actions[name] = a;
  }
  for (const n of LOCO) if (actions[n]) actions[n].timeScale = 0;  // 移動動作的時間由步伐相位決定
  const weights = Object.fromEntries(Object.keys(actions).map((k) => [k, k === 'idle' ? 1 : 0]));
  actions.idle.setEffectiveWeight(1);
  actions.idle.time = Math.random() * actions.idle.getClip().duration;
  let phase = Math.random();
  let wasDead = false;
  let armW = 1;
  let t = Math.random() * 10;
  const rq = Q(), up = new THREE.Vector3(0, 1, 0), fwd = V(), dUpper = V(), dFore = V(), dSide = V();

  const model = {
    root,
    slot,
    avatar: av.key,
    color: SLOT_COLORS[s],
    lightSocket: light.socket,
    flashlightOn: false,
    // 大約的眼睛高度（公尺），可以拿來放名牌
    eyeHeight: av.key === 'M' ? 1.68 : 1.58,
    setTransform(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.set(0, yaw + Math.PI, 0);
    },
    headWorldPosition(out = new THREE.Vector3()) {
      return bone('Head').getWorldPosition(out);
    },
    // speed：水平移動速度（公尺 / 秒）；crouch / running / dead：狀態；pitch：視角上下（弧度，往上為正），手電筒會跟著抬高或壓低
    update(dt, { speed = 0, crouch = false, running = false, dead = false, pitch = 0 } = {}) {
      dt = clamp(dt, 0, 0.1);
      t += dt;
      speed = Math.max(0, speed);
      // --- 目標權重
      const target = Object.fromEntries(Object.keys(actions).map((k) => [k, 0]));
      if (dead) target.dead = 1;
      else if (crouch) {
        const k = smooth(0.05, 0.35, speed);
        target.crouch = 1 - k; target.crouchwalk = k;
      } else {
        const moving = smooth(0.05, 0.6, speed);
        const runK = running ? smooth(0.6, 1.8, speed) : smooth(1.9, 3.0, speed);
        target.idle = 1 - moving;
        target.walk = moving * (1 - runK);
        target.run = moving * runK;
      }
      if (dead && !wasDead) { actions.dead.reset(); actions.dead.play(); }
      wasDead = dead;
      const rate = dead ? 6 : 8;
      let sum = 0;
      for (const k in weights) { weights[k] += (target[k] - weights[k]) * Math.min(1, dt * rate); if (weights[k] < 1e-3) weights[k] = 0; sum += weights[k]; }
      // --- 步伐相位：每個循環前進的距離 = 原始速度 × 動作長度，依實際速度推進，腳才不會滑
      const g = av.gait;
      let stride = 0, sw = 0;
      for (const n of LOCO) if (actions[n] && weights[n] > 0) { stride += weights[n] * g[n].speed * actions[n].getClip().duration; sw += weights[n]; }
      if (sw > 0 && speed > 0.02) phase = (phase + dt * speed / (stride / sw)) % 1;
      for (const n of LOCO) if (actions[n]) {
        const d = actions[n].getClip().duration;
        actions[n].time = (((phase + g[n].phase) % 1) * d);
      }
      for (const k in actions) actions[k].setEffectiveWeight(sum > 0 ? weights[k] / sum : (k === 'idle' ? 1 : 0));
      mixer.update(dt);
      body.updateMatrixWorld(true);
      // --- 拿手電筒的右手：上臂往下往前、前臂朝前，燈頭跟著視角上下
      armW += ((dead ? 0 : 1) - armW) * Math.min(1, dt * 5);
      if (armW > 0.01) {
        root.getWorldQuaternion(rq);
        const p = clamp(pitch, -0.9, 0.7);
        const bob = Math.sin(phase * Math.PI * 4) * 0.04 * smooth(0.2, 1.5, speed);
        // 模型面向 +Z、左邊是 +X：右手在 -X 那側
        dUpper.set(-0.18, -0.9, 0.38).normalize().applyQuaternion(rq);
        dFore.set(0.12, Math.sin(p * 0.7) - 0.15 + bob, Math.cos(p * 0.7)).normalize().applyQuaternion(rq);
        fwd.set(0, Math.sin(p) + bob, Math.cos(p)).normalize().applyQuaternion(rq);
        aimBone(upper, fore, dUpper, armW, tmp);
        aimBone(fore, hand, dFore, armW, tmp);
        // 手電筒（小指→食指方向）朝前，手指朝下包住握把
        dSide.copy(up).applyQuaternion(rq).negate();
        alignBone(hand, beamLocal, fwd, fingerLocal, dSide, armW, tmp);
      }
    },
    setFlashlight(on) {
      model.flashlightOn = !!on;
      light.lensMat.emissiveIntensity = on ? 3 : 0;
      light.lensMat.color.setHex(on ? 0xfff6e0 : 0x222222);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
      light.dispose();
      root.removeFromParent();
    },
  };
  model.update(0);
  return model;
}

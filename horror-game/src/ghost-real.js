// 寫實女鬼：以 Microsoft Rocketbox 的護理師模型（MIT 授權）為基礎，
// 貼圖經過處理（死白皮膚、凹陷眼窩、混濁死人眼、血淚、染血制服），
// 用真實動作資料（受傷跛行、踉蹌奔跑、轉頭）驅動，再加上程序化的長髮、抽搐與表情。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl } from './assets.js';

const BASE = 'assets/ghost/';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 模型與畫質無關，只下載一次；貼圖圖檔也只下載一次，依畫質縮成需要的大小。
// 下載逾時不會中斷：這一局先用程序化女鬼，檔案繼續在背景下載給下一局用。
let glbP = null;
const imgP = new Map();
function getGlb() {
  if (!glbP) glbP = new GLTFLoader().loadAsync(assetUrl(BASE + 'ghost.glb')).catch((e) => { glbP = null; throw e; });
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
const headFile = (quality) => (quality.propTex >= 1024 ? 'ghost_head.jpg' : 'ghost_head_1k.jpg');
const OTHER_FILES = ['ghost_head_n.jpg', 'ghost_head_r.jpg', 'ghost_body.jpg', 'ghost_body_n.jpg', 'ghost_lashes.png'];

// 進入選單時就先開始下載
export function prefetchGhost(quality) {
  getGlb().catch(() => {});
  for (const n of [headFile(quality), ...OTHER_FILES]) getImage(n).catch(() => {});
}

// 任何一個檔案失敗或逾時都會丟例外，由呼叫端改用程序化女鬼
export async function loadGhostAssets(renderer, quality, timeoutMs = 30000) {
  const work = (async () => {
    const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality.aniso);
    // 低畫質貼圖縮到 512、中畫質 1024，只有高畫質用 2048 的臉
    const max = quality.propTex >= 1024 ? 2048 : quality.propTex >= 512 ? 1024 : 512;
    const make = async (name, srgb, limit = max) => {
      const img = await getImage(name);
      let src = img;
      if (img.width > limit) {
        src = document.createElement('canvas');
        src.width = Math.round(img.width * limit / img.width);
        src.height = Math.round(img.height * limit / img.width);
        src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
      }
      const t = new THREE.Texture(src);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      return t;
    };
    const [gltf, head, headN, headR, body, bodyN, lashes] = await Promise.all([
      getGlb(), make(headFile(quality), true), make('ghost_head_n.jpg', false, Math.min(max, 1024)), make('ghost_head_r.jpg', false, Math.min(max, 1024)),
      make('ghost_body.jpg', true, Math.min(max, 1024)), make('ghost_body_n.jpg', false, Math.min(max, 1024)), make('ghost_lashes.png', true, 512),
    ]);
    return { gltf, tex: { head, headN, headR, body, bodyN, lashes } };
  })();
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('ghost assets timeout')), timeoutMs); });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
  }
}

export class RealGhostModel {
  constructor(assets, tf) {
    this.isReal = true;
    this.root = new THREE.Group();
    this.uniforms = { uTime: { value: 0 }, uLean: { value: 0 } };
    // 一律複製：原始場景保持乾淨，多個實例（本體、幻影）共用幾何與動作資料
    this.body = cloneSkinned(assets.gltf.scene);
    this.body.scale.setScalar(0.01);
    this.root.add(this.body);
    const T = assets.tex;
    this.headMat = new THREE.MeshStandardMaterial({
      name: 'head', map: T.head, normalMap: T.headN, roughnessMap: T.headR, roughness: 1, metalness: 0,
      emissive: 0x8a96a0, emissiveMap: T.head, emissiveIntensity: 0.035,
    });
    this.bodyMat = new THREE.MeshStandardMaterial({
      name: 'body', map: T.body, normalMap: T.bodyN, roughness: 0.88, metalness: 0,
      emissive: 0x8a96a0, emissiveMap: T.body, emissiveIntensity: 0.03,
    });
    this.lashMat = new THREE.MeshStandardMaterial({ name: 'lash', map: T.lashes, alphaTest: 0.35, transparent: false, side: THREE.DoubleSide, roughness: 0.8 });
    this.meshes = [];
    this.body.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const n = o.material.name;
      o.material = n === 'head' ? this.headMat : n === 'body' ? this.bodyMat : this.lashMat;
      o.castShadow = n !== 'opacity';
      o.receiveShadow = true;
      this.meshes.push(o);
    });
    // 視錐剔除：用綁定姿勢算一次包圍球再放大（動作不會離開太遠），不在畫面裡就不畫、也不算陰影
    this.body.updateMatrixWorld(true);
    for (const m of this.meshes) {
      m.computeBoundingSphere();
      m.boundingSphere.radius *= 1.6;
    }
    this.morphMeshes = this.meshes.filter((m) => m.morphTargetDictionary);
    this.bone = (name) => this.body.getObjectByName(name);
    this.headBone = this.bone('Bip01_Head');
    this.neckBone = this.bone('Bip01_Neck');
    this.eyeBones = [this.bone('Bip01_LEye'), this.bone('Bip01_REye')].filter(Boolean);
    this.spineBones = ['Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_L_UpperArm', 'Bip01_R_UpperArm', 'Bip01_L_Forearm', 'Bip01_R_Forearm'].map(this.bone).filter(Boolean);
    // --- 綁定姿勢的資訊：臉朝哪個方向、頭的位置與大小
    this.root.updateMatrixWorld(true);
    const q = new THREE.Quaternion();
    this.faceLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.headBone.getWorldQuaternion(q).invert());
    this.neckLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.neckBone.getWorldQuaternion(q).invert());
    this.eyeLocal = this.eyeBones.map((b) => new THREE.Vector3(0, 0, 1).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert()));
    const headBox = this.measureHead();
    this.headCenter = headBox.getCenter(new THREE.Vector3());
    this.headSize = headBox.getSize(new THREE.Vector3());
    this.faceHeight = this.headCenter.y;
    this.headCenterLocal = this.headCenter.clone().applyMatrix4(this.headBone.matrixWorld.clone().invert());
    this.buildHair(tf);
    // --- 動作
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = {};
    for (const clip of assets.gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      this.actions[clip.name] = a;
    }
    this.current = null;
    this.idleName = 'look';
    this.idleSwitch = 6;
    this.play('look', 0);
    this.lookTarget = null;
    this.lookWeight = 0;
    this.expr = {};
    this.twitch = 0;
  }

  // 找出主要受頭骨影響的頂點，量出頭的範圍（公尺）
  measureHead() {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const m of this.meshes) {
      if (m.material !== this.headMat) continue;
      const bi = m.skeleton.bones.indexOf(this.headBone);
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      for (let i = 0; i < si.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
        if (w < 0.6) continue;
        m.getVertexPosition(i, v);
        m.localToWorld(v);
        box.expandByPoint(v);
      }
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 1.62, 0.02), new THREE.Vector3(0.16, 0.22, 0.2));
    return box;
  }

  // 長黑髮：幾片圓柱面組成的髮簾，掛在頭骨上，前面兩片可以撥開
  buildHair(tf) {
    this.hairMat = new THREE.MeshStandardMaterial({ map: tf.ghostHair().map, color: 0x070707, roughness: 0.55, metalness: 0.0, alphaTest: 0.4, side: THREE.DoubleSide });
    const uniforms = this.uniforms;
    this.hairMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.uniforms.uLean = uniforms.uLean;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uLean;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float k = clamp(1.0 - uv.y, 0.0, 1.0);
          transformed.x += sin(uTime * 1.7 + position.y * 6.0 + position.z * 4.0) * 0.012 * k;
          transformed.z += cos(uTime * 1.3 + position.y * 5.0 + position.x * 3.0) * 0.014 * k - uLean * k * k * 0.25;`);
    };
    this.hairMat.customProgramCacheKey = () => 'ghostHairReal';
    const hs = this.headSize;
    const r0 = Math.max(hs.x, hs.z) * 0.52;
    const len = 0.72;
    const top = hs.y * 0.44;
    const hair = new THREE.Group();
    // 兩側與後面：從頭頂垂下的長直髮（前方留出臉）。
    // 這部分放在 hang 群組裡，每格依重力重新擺正，所以低頭時頭髮是垂下來的、不會插進身體。
    const hang = new THREE.Group();
    hang.position.set(0, top, -hs.z * 0.02);
    const sheet = (start, arc, rTop, rBot, l, segs = 22) => {
      const g = new THREE.CylinderGeometry(rTop, rBot, l, segs, 12, true, start, arc);
      // 讓髮尾往內收一點、不要太整齊
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), k = (l / 2 - y) / l;
        const a = Math.atan2(p.getX(i), p.getZ(i));
        const wob = 1 + Math.sin(a * 9 + y * 7) * 0.05 * k;
        p.setX(i, p.getX(i) * wob);
        p.setZ(i, p.getZ(i) * wob * (1 - 0.1 * k));
      }
      g.computeVertexNormals();
      g.translate(0, -l / 2, 0);
      const m = new THREE.Mesh(g, this.hairMat);
      m.castShadow = true;
      return m;
    };
    hang.add(sheet(1.0, Math.PI * 2 - 2.0, r0 * 0.98, r0 * 1.32, len));
    hang.add(sheet(1.2, Math.PI * 2 - 2.4, r0 * 0.93, r0 * 1.18, len * 0.9));
    hair.add(hang);
    this.hang = hang;
    // 臉前面幾綹黏在臉上的濕髮
    this.hairL = new THREE.Group();
    this.hairR = new THREE.Group();
    const strand = (x, w, l, tilt) => {
      const g = new THREE.PlaneGeometry(w, l, 2, 10);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), k = (l / 2 - y) / l;
        // 貼著臉的弧度往前彎
        p.setZ(i, r0 * 0.98 + Math.sin(k * Math.PI * 0.9) * hs.z * 0.08 - k * k * 0.02);
        p.setX(i, p.getX(i) + x + Math.sin(k * 5 + x * 30) * 0.008 + tilt * k);
      }
      g.computeVertexNormals();
      g.translate(0, -l / 2 + top * 0.92, 0);
      const m = new THREE.Mesh(g, this.hairMat);
      m.castShadow = true;
      return m;
    };
    this.hairL.add(strand(-0.05, 0.03, 0.62, -0.03), strand(-0.03, 0.016, 0.5, 0.012));
    this.hairR.add(strand(0.046, 0.028, 0.66, 0.03), strand(0.024, 0.013, 0.45, -0.015));
    this.hairInner = strand(0.004, 0.008, 0.36, 0.0);
    hair.add(this.hairL, this.hairR, this.hairInner);
    // 頭頂：蓋住原本的髮型
    this.capMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.7, metalness: 0 });
    // 往後傾：前緣停在髮際線（眼睛上方），後腦勺包到比較低
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.48), this.capMat);
    cap.scale.set(hs.x * 0.57, hs.y * 0.52, hs.z * 0.52);
    cap.position.set(0, hs.y * 0.03, -hs.z * 0.04);
    cap.rotation.x = -0.58;
    cap.castShadow = true;
    hair.add(cap);
    // 從世界座標（綁定姿勢）換算到頭骨座標
    const want = new THREE.Matrix4().makeTranslation(this.headCenter.x, this.headCenter.y, this.headCenter.z - hs.z * 0.04);
    hair.matrixAutoUpdate = false;
    hair.matrix.copy(this.headBone.matrixWorld).invert().multiply(want);
    this.headBone.add(hair);
    this.hair = hair;
  }

  play(name, fade = 0.35) {
    const a = this.actions[name];
    if (!a || this.current === a) return;
    a.reset();
    a.play();
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    this.current = a;
  }

  setMorph(name, v) {
    for (const m of this.morphMeshes) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = v;
    }
  }

  // 讓某根骨頭的「正面」轉向目標（有角度上限與權重）
  aim(bone, localDir, target, maxAngle, weight) {
    if (!bone || weight <= 0.001) return;
    const bq = bone.getWorldQuaternion(this._q1 || (this._q1 = new THREE.Quaternion()));
    const bp = bone.getWorldPosition(this._v1 || (this._v1 = new THREE.Vector3()));
    const cur = (this._v2 || (this._v2 = new THREE.Vector3())).copy(localDir).applyQuaternion(bq);
    const want = (this._v3 || (this._v3 = new THREE.Vector3())).copy(target).sub(bp).normalize();
    const d = (this._q2 || (this._q2 = new THREE.Quaternion())).setFromUnitVectors(cur, want);
    const angle = 2 * Math.acos(clamp(Math.abs(d.w), 0, 1));
    const k = Math.min(1, maxAngle / Math.max(angle, 1e-4)) * weight;
    const id = this._qi || (this._qi = new THREE.Quaternion());
    id.identity().slerp(d, k);
    const world = id.multiply(bq);
    const pq = bone.parent.getWorldQuaternion(this._q3 || (this._q3 = new THREE.Quaternion())).invert();
    bone.quaternion.copy(pq.multiply(world));
    bone.updateMatrixWorld(true);
  }

  pose(state, t, phase, speed) {
    const dt = this.lastT === undefined ? 0 : clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    this.uniforms.uTime.value = t;
    let ts = 1;
    if (state === 'chase') { this.play('run', 0.25); ts = clamp(speed / 3.3, 0.6, 1.5); }
    else if (state === 'kill') { ts = 0.15; }
    else if (state === 'stunned') { this.play('roll', 0.15); ts = 0.05; }
    else if (speed > 0.25) {
      // 閒晃：受傷跛行；搜尋：瘀傷步態；循聲過去查看：踉踉蹌蹌
      this.play(state === 'investigate' ? 'drunk' : state === 'search' ? 'walk2' : 'walk', 0.4);
      ts = clamp(speed / 0.95, 0.45, 1.9);
    }
    else {
      this.idleSwitch -= dt;
      if (this.idleSwitch <= 0) { this.idleName = this.idleName === 'look' ? 'roll' : 'look'; this.idleSwitch = 6 + Math.random() * 5; }
      this.play(this.idleName, 0.6);
    }
    if (this.current) this.current.setEffectiveTimeScale(ts);
    this.mixer.update(dt);
    this.body.updateMatrixWorld(true);
    // --- 程序化疊加
    if (state === 'stunned') {
      // 被閃光打到：全身抽搐
      for (const b of this.spineBones) {
        b.rotateX((Math.random() - 0.5) * 0.35);
        b.rotateZ((Math.random() - 0.5) * 0.35);
      }
      if (this.headBone) { this.headBone.rotateY((Math.random() - 0.5) * 0.7); this.headBone.rotateZ((Math.random() - 0.5) * 0.5); }
      this.body.updateMatrixWorld(true);
    } else if (this.twitch > 0 || Math.random() < 0.004) {
      // 偶爾猛然扭頭
      if (this.twitch <= 0) { this.twitch = 0.1 + Math.random() * 0.12; this.twitchA = (Math.random() - 0.5) * 1.4; }
      this.twitch -= dt;
      if (this.headBone) { this.headBone.rotateOnAxis(this.faceLocal, this.twitchA * 0.6); this.headBone.updateMatrixWorld(true); }
    }
    // 平常頭一直歪向一邊
    const tiltW = state === 'chase' || state === 'stunned' || state === 'kill' ? 0 : 1;
    this.tilt = (this.tilt || 0) + (tiltW * 0.28 - (this.tilt || 0)) * Math.min(1, dt * 1.5);
    // 繞著臉的朝向軸轉＝往側邊歪頭（這副骨架的頭骨 Z 軸是左右軸，直接 rotateZ 會變成點頭）
    if (this.headBone && this.tilt > 0.01) { this.headBone.rotateOnAxis(this.faceLocal, this.tilt); this.headBone.updateMatrixWorld(true); }
    // --- 看向玩家
    const lookW = state === 'stunned' ? 0 : state === 'kill' ? 1 : this.lookTarget ? this.lookWeight : 0;
    if (lookW > 0 && this.lookTarget) {
      this.aim(this.neckBone, this.neckLocal, this.lookTarget, 0.5, lookW * 0.5);
      this.aim(this.headBone, this.faceLocal, this.lookTarget, 0.9, lookW);
      this.eyeBones.forEach((b, i) => this.aim(b, this.eyeLocal[i], this.lookTarget, 0.45, lookW));
    }
    this.settleHair();
    // --- 表情
    const e = this.expr;
    const set = (k, v, rate = 6) => { e[k] = (e[k] || 0) + (v - (e[k] || 0)) * Math.min(1, dt * rate); this.setMorph(k, e[k]); };
    if (state === 'kill') {
      // 嘴張到超出人類極限
      const s = 1.6 + Math.sin(t * 40) * 0.08;
      set('jawOpen', s, 18); set('mouthStretchL', 1.2, 18); set('mouthStretchR', 1.2, 18); set('lowerDownL', 1.2, 18); set('lowerDownR', 1.2, 18);
      set('eyeWideL', 1.3, 18); set('eyeWideR', 1.3, 18); set('browInnerUp', 1, 18); set('noseSneerL', 0.8, 18); set('noseSneerR', 0.8, 18);
      set('blinkL', 0, 18); set('blinkR', 0, 18);
    } else if (state === 'chase') {
      set('jawOpen', 0.75 + Math.sin(t * 9) * 0.15); set('mouthStretchL', 0.7); set('mouthStretchR', 0.7); set('lowerDownL', 0.6); set('lowerDownR', 0.6);
      set('eyeWideL', 1); set('eyeWideR', 1); set('browInnerUp', 0.8); set('noseSneerL', 0.4); set('noseSneerR', 0.4);
      set('blinkL', 0); set('blinkR', 0);
    } else if (state === 'stunned') {
      set('jawOpen', 0.9, 12); set('mouthStretchL', 1, 12); set('mouthStretchR', 1, 12); set('blinkL', 1, 12); set('blinkR', 1, 12);
      set('eyeWideL', 0, 12); set('eyeWideR', 0, 12); set('browInnerUp', 1, 12);
    } else {
      // 平常：嘴微開、往下垂，眼睛半睜
      set('jawOpen', 0.3 + Math.sin(t * 0.7) * 0.06, 2); set('mouthStretchL', 0.15, 2); set('mouthStretchR', 0.15, 2); set('lowerDownL', 0.35, 2); set('lowerDownR', 0.35, 2);
      set('frownL', 0.9, 2); set('frownR', 0.9, 2); set('eyeWideL', 0.7, 2); set('eyeWideR', 0.7, 2); set('browInnerUp', 0.55, 2);
      set('blinkL', 0.15, 2); set('blinkR', 0.15, 2); set('noseSneerL', 0, 2); set('noseSneerR', 0, 2);
    }
    this.uniforms.uLean.value += ((state === 'chase' ? 1 : 0) - this.uniforms.uLean.value) * Math.min(1, dt * 4);
  }

  // 讓垂下的長髮保持朝下：只跟著頭的左右轉向，前後傾只跟一點點
  settleHair() {
    const hq = this.headBone.getWorldQuaternion(this._hq || (this._hq = new THREE.Quaternion()));
    const f = (this._hf || (this._hf = new THREE.Vector3())).copy(this.faceLocal).applyQuaternion(hq);
    const yaw = Math.atan2(f.x, f.z);
    const pitch = clamp(-Math.asin(clamp(f.y, -1, 1)) * 0.25, -0.2, 0.25);
    const want = (this._hw || (this._hw = new THREE.Quaternion())).setFromEuler(this._he ? this._he.set(pitch, yaw, 0, 'YXZ') : (this._he = new THREE.Euler(pitch, yaw, 0, 'YXZ')));
    const parentQ = this.hair.getWorldQuaternion(this._hp || (this._hp = new THREE.Quaternion())).invert();
    this.hang.quaternion.copy(parentQ.multiply(want));
    this.hang.updateMatrixWorld(true);
  }

  revealFace(k) {
    this.hairL.rotation.y = -k * 0.6;
    this.hairR.rotation.y = k * 0.6;
    this.hairInner.visible = k < 0.5;
  }

  // 目前姿勢下臉的中心（世界座標）
  faceWorld(out = new THREE.Vector3()) {
    return out.copy(this.headCenterLocal).applyMatrix4(this.headBone.matrixWorld);
  }

  setEyes(level) {
    // 「眼睛」強度改成整體的微光：在黑暗中隱約看得見蒼白的身影
    const g = 0.025 + level * 0.025;
    this.headMat.emissiveIntensity = g * 1.2;
    this.bodyMat.emissiveIntensity = g;
  }

  setLookTarget(v, weight) {
    this.lookTarget = v;
    this.lookWeight = weight;
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const m of [this.headMat, this.bodyMat, this.lashMat, this.hairMat, this.capMat]) m.dispose();
    this.hair.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

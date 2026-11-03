// 「她」：長髮白衣女鬼的模型、程序動畫與 AI
import * as THREE from 'three';
import { CELL } from './config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sightClear, pushOut, SHUTTER_PASS } from './nav.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

const NET_STATES = new Set(['dormant', 'wander', 'investigate', 'search', 'chase', 'stunned', 'kill']);

export class GhostModel {
  constructor(tf, M) {
    this.root = new THREE.Group();
    this.uniforms = { uTime: { value: 0 }, uLean: { value: 0 } };
    const dressTex = tf.ghostDress();
    this.dressMat = new THREE.MeshStandardMaterial({
      ...dressTex, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      emissive: 0x9aa4ab, emissiveMap: dressTex.map, emissiveIntensity: 0.05,
    });
    this.skinMat = new THREE.MeshStandardMaterial({ map: tf.ghostSkin().map, color: 0xc4cacd, roughness: 0.5, metalness: 0, emissive: 0x6d777c, emissiveIntensity: 0.04 });
    this.faceMat = new THREE.MeshStandardMaterial({ map: tf.ghostFace().map, roughness: 0.5, metalness: 0, emissive: 0x404548, emissiveIntensity: 0.05, emissiveMap: tf.ghostFace().map });
    this.hairMat = new THREE.MeshStandardMaterial({ map: tf.ghostHair().map, color: 0x0b0b0c, roughness: 0.42, metalness: 0.05, alphaTest: 0.45, side: THREE.DoubleSide });
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
    this.hairMat.customProgramCacheKey = () => 'ghostHair';
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyeMat.color.setRGB(0.6, 0.6, 0.6);
    this.build();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const e of this.eyes) e.castShadow = false;
  }

  build() {
    const R = this.root;
    // 洋裝：車床幾何 + 皺褶與破爛下擺
    const prof = [[0.001, 1.47], [0.1, 1.47], [0.16, 1.445], [0.19, 1.39], [0.175, 1.26], [0.15, 1.12], [0.18, 0.96], [0.23, 0.68], [0.28, 0.38], [0.32, 0.14], [0.345, 0.03]];
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(pts, 40);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      const fold = 1 + (0.06 * Math.sin(a * 7 + y * 3) + 0.03 * Math.sin(a * 13 + 2)) * smoothstep(1.15, 0.2, y);
      const nr = r * fold;
      x = Math.cos(a) * nr; z = Math.sin(a) * nr * 0.82;
      if (y < 0.1) y += 0.05 * (0.5 + 0.5 * Math.sin(a * 5 + 1.3)) + 0.04 * (0.5 + 0.5 * Math.sin(a * 11));
      p.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    this.dress = new THREE.Mesh(geo, this.dressMat);
    R.add(this.dress);
    // 上半身樞紐（彎腰）
    this.upper = new THREE.Group();
    this.upper.position.set(0, 1.42, 0);
    R.add(this.upper);
    // 手臂
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.185, -0.03, 0.0);
      this.upper.add(sh);
      const ua = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.27, 4, 8), this.skinMat);
      ua.position.y = -0.16;
      sh.add(ua);
      const el = new THREE.Group();
      el.position.y = -0.32;
      sh.add(el);
      const fa = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.27, 4, 8), this.skinMat);
      fa.position.y = -0.15;
      el.add(fa);
      const wr = new THREE.Group();
      wr.position.y = -0.31;
      el.add(wr);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.022), this.skinMat);
      hand.position.y = -0.045;
      wr.add(hand);
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.085, 2, 5), this.skinMat);
        f.position.set(-0.02 + k * 0.013, -0.13, 0);
        f.rotation.x = 0.15 + k * 0.05;
        wr.add(f);
      }
      const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 2, 5), this.skinMat);
      th.position.set(s * -0.03, -0.07, 0.015);
      th.rotation.z = s * 0.5;
      wr.add(th);
      // 手掌與手指合併成一個 mesh
      const parts = [];
      wr.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(wr.matrixWorld).invert();
      for (const c of [...wr.children]) {
        const g2 = c.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        parts.push(g2);
        wr.remove(c);
      }
      wr.add(new THREE.Mesh(mergeGeometries(parts, false), this.skinMat));
      sh.rotation.z = s * 0.06;
      this.arms.push({ sh, el, wr, s });
    }
    // 脖子與頭
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.02, 0.01);
    this.upper.add(this.neck);
    const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.16, 8), this.skinMat);
    nk.position.y = 0.08;
    this.neck.add(nk);
    this.head = new THREE.Group();
    this.head.position.y = 0.2;
    this.neck.add(this.head);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), this.faceMat);
    hd.scale.set(0.86, 1.12, 0.94);
    this.head.add(hd);
    this.eyes = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), this.eyeMat);
      e.position.set(s * 0.03, 0.022, 0.09);
      this.head.add(e);
      this.eyes.push(e);
    }
    const scalp = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), this.hairMat);
    scalp.scale.set(0.9, 1.1, 0.98);
    scalp.position.y = 0.005;
    this.head.add(scalp);
    // 頭髮：前面兩片（可以撥開）+ 後面一大片
    const hairLen = 0.9;
    const mkHair = (start, len, rTop, rBot) => {
      const g = new THREE.CylinderGeometry(rTop, rBot, hairLen, 18, 10, true, start, len);
      g.translate(0, -hairLen / 2 + 0.02, 0);
      const m = new THREE.Mesh(g, this.hairMat);
      m.scale.z = 1.05;
      return m;
    };
    this.hairBack = mkHair(1.05, Math.PI * 2 - 2.1, 0.108, 0.2);
    this.head.add(this.hairBack);
    this.hairL = new THREE.Group();
    this.hairR = new THREE.Group();
    this.hairL.add(mkHair(-1.08, 1.1, 0.112, 0.16));
    this.hairR.add(mkHair(-0.02, 1.1, 0.112, 0.16));
    this.head.add(this.hairL, this.hairR);
    // 第二層前髮（更亂）
    const inner = mkHair(-0.9, 1.8, 0.104, 0.13);
    inner.scale.set(0.98, 0.92, 1.0);
    this.hairInner = inner;
    this.head.add(inner);
  }

  pose(state, t, phase, speed) {
    this.uniforms.uTime.value = t;
    const A = this.arms;
    const walk = Math.min(1, speed / 1.2);
    let lean = 0.1, headTilt = 0.38, headPitch = 0.12;
    if (state === 'chase' || state === 'kill') {
      lean = 0.35;
      for (const a of A) {
        a.sh.rotation.x = -1.25 + Math.sin(phase * 2 + (a.s > 0 ? 0 : 1.5)) * 0.18;
        a.el.rotation.x = -0.25;
        a.wr.rotation.x = -0.2;
      }
      headTilt = 0.15 + Math.sin(t * 17) * 0.05;
      headPitch = -0.15;
      this.uniforms.uLean.value += (1 - this.uniforms.uLean.value) * 0.1;
    } else if (state === 'stunned') {
      lean = -0.1;
      for (const a of A) {
        a.sh.rotation.x = -2.3 + Math.sin(t * 30) * 0.05;
        a.el.rotation.x = -1.7;
        a.sh.rotation.z = a.s * -0.35;
      }
      headPitch = 0.45 + Math.sin(t * 40) * 0.05;
      headTilt = Math.sin(t * 23) * 0.2;
      this.uniforms.uLean.value *= 0.9;
    } else {
      for (const a of A) {
        a.sh.rotation.x = Math.sin(phase + (a.s > 0 ? 0 : Math.PI)) * 0.12 * walk + 0.08;
        a.el.rotation.x = -0.12;
        a.wr.rotation.x = -0.1;
        a.sh.rotation.z = a.s * 0.06;
      }
      this.uniforms.uLean.value *= 0.95;
    }
    // 抽搐
    if (this.twitchT > 0) {
      this.twitchT -= 1 / 60;
      headTilt += this.twitchA;
    } else if (Math.random() < 0.006) {
      this.twitchT = 0.12 + Math.random() * 0.1;
      this.twitchA = (Math.random() - 0.5) * 1.2;
    }
    this.upper.rotation.x = lean;
    this.neck.rotation.x = headPitch;
    this.head.rotation.z = headTilt;
    this.root.rotation.z = Math.sin(phase) * 0.03 * walk;
    this.dress.scale.y = 1 + Math.sin(phase * 2) * 0.008;
  }

  revealFace(k) {
    // 撥開前髮
    this.hairL.rotation.y = -k * 1.1;
    this.hairR.rotation.y = k * 1.1;
    this.hairInner.visible = k < 0.5;
    this.hairL.position.z = k * 0.03;
    this.hairR.position.z = k * 0.03;
  }

  setEyes(level) {
    this.eyeMat.color.setRGB(level, level * 0.85, level * 0.8);
  }
}

// ---------------------------------------------------------------------------
export class Ghost {
  constructor(game, model) {
    this.game = game;
    this.model = model;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'dormant';
    this.stateT = 0;
    this.path = null;
    this.pathI = 0;
    this.replanT = 0;
    this.phase = 0;
    this.speed = 0;
    // 察覺值（每個目標各一份，0→1）：看得到目標時慢慢累積，滿了才尖叫追上來；看不到就慢慢退掉
    this.aware = new Map();
    this.noticing = false;
    this.lastKnown = null;
    this.lostT = 0;
    this.stepT = 0;
    this.idleT = 0;
    this.stuckT = 0;
    this.lastDist = 0;
    this.farT = 0;
    this.aggression = 1;
    this.enraged = false;
    this.seesPlayer = false;
    this.visibleT = 0;
    this.knowsLocker = null;
    this.emitter = null;
    this.humming = false;
    // 多層樓：她在哪一層（用那一層的地圖、尋路與門）；目標在別層太久就走樓梯過去
    this.floor = 0;
    this.awayT = 0;
    this.travelLink = null;
    model.root.visible = false;
    game.scene.add(model.root);
    this.makeAura();
  }

  // 她靠近時身邊的血紅光暈：身後一張加法混色的光暈貼片 + 一盞照在附近牆面地板上的紅色點光源。
  // 點光源從載入時就一直在場景裡（不掛在她的模型下面、永遠 visible），平常強度 0，只改強度：
  // 燈的數量一變，所有材質的著色器都要重新編譯，會卡住。
  makeAura() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.auraMat = new THREE.SpriteMaterial({ map: tex, color: 0xff1a0c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.aura = new THREE.Sprite(this.auraMat);
    this.aura.scale.set(2.3, 3.3, 1);
    this.aura.position.set(0, 1.05, 0);
    this.aura.renderOrder = 3;
    this.aura.visible = false;
    this.model.root.add(this.aura);
    this.auraLight = new THREE.PointLight(0xff2010, 0, 7.5, 2);
    this.auraLight.castShadow = false;
    this.game.scene.add(this.auraLight);
    this.auraK = 0;     // 0..1：光暈現在的強度（平滑過的）
    this.auraProx = 0;  // 0..1：跟看畫面的人有多近（12 公尺 → 0、2 公尺內 → 1）
  }
  // 每一格更新光暈（房主與其他玩家都跑；其他玩家用房主同步來的狀態與位置）
  updateAura(dt) {
    const g = this.game, L = this.auraLight;
    if (!L) return;
    const st = this.state;
    const active = !this.banished && st !== 'dormant' && this.near && this.model.root.visible;
    const d = Number.isFinite(g.ghostDist) ? g.ghostDist : 99;
    const prox = active ? Math.min(1, Math.max(0, 1 - (d - 2) / 10)) : 0;
    this.auraProx = prox;
    const chase = st === 'chase';
    // 追人的時候比較亮；被閃光定住時幾乎熄掉；抓到人的跳嚇鏡頭裡馬上熄掉（不要把她的臉照成一片平平的紅）
    const kill = st === 'kill' || !!g.dying;
    const want = kill ? 0 : chase ? prox : Math.pow(prox, 0.7) * (st === 'stunned' ? 0.15 : 0.72);
    if (!active) this.auraK = 0;
    else this.auraK += (want - this.auraK) * Math.min(1, dt * (kill ? 10 : want > this.auraK ? 3 : 1.6));
    if (this.auraK < 0.004) {
      this.auraK = 0;
      L.intensity = 0;
      this.auraMat.opacity = 0;
      this.aura.visible = false;
      return;
    }
    // 脈動：平常像呼吸一樣慢慢明暗，追人時跟著急促的心跳用力閃
    const t = g.time || 0;
    const pulse = chase ? 0.72 + 0.28 * Math.pow(0.5 + 0.5 * Math.sin(t * 8.4), 2.2) * 1.9 : 0.86 + 0.14 * Math.sin(t * 2.3);
    const k = this.auraK * pulse;
    L.intensity = k * 11;
    // 燈放在她頭頂稍微靠近鏡頭的地方：照亮她的臉、肩膀、腳邊的地板與兩旁的牆（放在身體裡面會從裡面透出來）
    const cam = g.post && g.post.renderPass.camera;
    let ox = 0, oz = 0;
    if (cam) { const dx = cam.position.x - this.pos.x, dz = cam.position.z - this.pos.z, dl = Math.hypot(dx, dz) || 1; ox = dx / dl * 0.45; oz = dz / dl * 0.45; }
    L.position.set(this.pos.x + ox, 1.75, this.pos.z + oz);
    this.aura.visible = true;
    this.auraMat.opacity = Math.min(0.9, k * 1.05);
    const sc = 1 + 0.1 * (pulse - 0.86);
    this.aura.scale.set(2.3 * sc, 3.3 * sc, 1);
  }

  get diff() { return this.game.diff; }
  // 她對某個玩家的察覺值（多人時只有房主算；其他人用房主送來的、針對自己的那一份，見 game.detectView）
  awareOf(P) { return (P && this.aware.get(P)) || 0; }
  get suspicion() { return this.game.mp && !this.game.mp.isHost ? (this.netAware || 0) : this.awareOf(this.target); }
  set suspicion(v) { if (this.target) this.aware.set(this.target, Math.min(1, Math.max(0, v))); }
  get F() { return this.game.floors[this.floor]; }
  get lv() { return this.F.lv; }
  get nav() { return this.F.ghostNav; }
  get world() { return this.F.world; }
  // 跟看畫面的人在同一層才看得到、聽得到她
  get near() { return this.floor === this.game.floorIdx; }
  // 某個玩家（自己或其他人）在哪一層
  static floorOf(P) { return P && Number.isInteger(P.floor) ? P.floor : 0; }
  // 她發出的聲音：走「她的聲音」匯流排（HRTF 定位、距離、隔牆、設定裡的提示強度）
  sfx(name, opts) { if (this.near) this.game.audio.play(name, { ...opts, her: true }); }

  setFloor(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.game.floors.length || i === this.floor) return;
    this.floor = i;
    this.path = null;
    this.knowsLocker = null;
    this.hearT = 0;
    this.travelLink = null;
    this.investigateTarget = null;
    if (!this.near) { this.stopHum(); this.model.root.visible = false; }
  }

  // 往目標樓層的下一段樓梯（樓層照上下順序排，一次走一段）
  stairToward(to) {
    const fl = this.game.floors, here = fl[this.floor].ord, there = fl[to].ord;
    const step = there > here ? 1 : -1;
    return this.lv.stairs.find((s) => fl[s.to].ord === here + step) || null;
  }
  // 走到樓梯口 → 換到另一層，從那一層對應的樓梯走出來
  takeStairs(link) {
    const g = this.game, from = this.floor;
    this.sfx('ghostStep', { pos: { x: link.x, y: 0.1, z: link.z }, fast: this.state === 'chase' });
    const dest = g.floors[link.to];
    const back = dest.lv.stairs.find((s) => s.to === from) || dest.lv.stairs[0];
    this.setFloor(link.to);
    const k = this.nav.nearestFree(back.arrive.x, back.arrive.z);
    const c = k >= 0 ? this.nav.center(k) : back.arrive;
    this.pos.set(c.x, 0, c.z);
    this.yaw = back.arrive.yaw + Math.PI;
    this.lastKnown = { x: c.x, z: c.z };
    this.stuckT = 0;
    this.sfx('ghostStep', { pos: { x: c.x, y: 0.1, z: c.z }, fast: this.state === 'chase' });
    if (this.near && this.state !== 'dormant') this.sfx('doorCreak', { pos: { x: back.x, y: 1.2, z: back.z }, short: true });
  }
  travel(dt, speed, to) {
    const link = this.stairToward(to);
    if (!link) return;
    if (this.travelLink !== link || !this.path) {
      this.travelLink = link;
      if (!this.goTo(link.use.x, link.use.z)) { this.travelLink = null; this.takeStairs(link); return; }
    }
    const done = this.moveAlong(dt, speed);
    if (done || Math.hypot(link.use.x - this.pos.x, link.use.z - this.pos.z) < 0.6) {
      this.travelLink = null;
      this.takeStairs(link);
    }
  }

  // 儀式完成：她安息了，這一局不會再出現（多人時房主的狀態會同步成一直消失）
  banish() {
    this.banished = true;
    this.enraged = false;
    this.setState('dormant');
    this.dormantUntil = Infinity;
    this.knowsLocker = null;
    this.path = null;
    this.model.root.visible = false;
    this.stopHum();
    this.updateAura(0);
  }

  setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    this.stateT = 0;
    this.path = null;
    // 察覺值：開始追 = 滿；跟丟了退回一半（剛跟丟時再被看到會比較快又被發現）；退開 / 抓到人就歸零
    if (s === 'chase' && this.target) this.aware.set(this.target, 1);
    else if (prev === 'chase' && this.target && (s === 'search' || s === 'wander' || s === 'investigate')) this.aware.set(this.target, Math.min(this.awareOf(this.target), 0.55));
    if (s === 'dormant' || s === 'stunned' || s === 'kill') this.aware.clear();
    this.noticing = false;
    if (s === 'chase') {
      this.stopHum();
      this.lostT = 0;
      this.replanT = 0;
      if (prev !== 'chase' && this.near) {
        this.sfx('shriek', { pos: { x: this.pos.x, y: 1.6, z: this.pos.z } });
        this.game.onChaseStart();
      }
    } else if (prev === 'chase') {
      this.game.onChaseEnd();
    }
    if (s === 'wander' || s === 'search') this.startHum();
    if (s === 'dormant' || s === 'stunned' || s === 'kill') this.stopHum();
  }

  startHum() {
    if (this.humming || this.state === 'dormant' || !this.near) return;
    if (!this.emitter || this.emitter.disposed) this.emitter = this.game.audio.createEmitter({ her: true, reverb: 0.3, pos: { x: this.pos.x, y: 1.6, z: this.pos.z } });
    else this.emitter.setPosition(this.pos.x, 1.6, this.pos.z);
    this.game.audio.startHum(this.emitter);
    this.humming = true;
  }
  stopHum() {
    if (!this.humming) return;
    this.game.audio.stopHum(this.emitter);
    this.humming = false;
  }

  spawnAt(x, z, state = 'wander', floor = this.floor) {
    if (this.banished) return;
    this.setFloor(floor);
    const k = this.nav.nearestFree(x, z);
    const c = k >= 0 ? this.nav.center(k) : { x, z };
    this.pos.set(c.x, 0, c.z);
    this.model.root.visible = this.near;
    this.state = 'none';
    this.setState(state);
  }

  // 找一個離玩家指定距離、看不到玩家的位置
  findSpot(minD, maxD, needHidden = true) {
    const g = this.game, lv = this.lv, nav = this.nav, tg = this.target || g.player, pp = tg.pos;
    // 只挑走得到目標的地方（目標在別層時：走得到樓梯口 / 大廳的地方），不會瞬移進鎖著的房間或關著的鐵捲門後面
    const home = Ghost.floorOf(tg) === this.floor ? pp : (lv.stairs[0] ? lv.stairs[0].use : lv.spawn);
    const want = nav.compAt(home.x, home.z);
    for (let t = 0; t < 80; t++) {
      const x = Math.random() * lv.W * CELL, z = Math.random() * lv.H * CELL;
      if (!nav.isFree(x, z) || (want >= 0 && nav.compAt(x, z) !== want)) continue;
      const d = Math.hypot(x - pp.x, z - pp.z);
      if (d < minD || d > maxD) continue;
      if (needHidden && sightClear(lv, x, z, pp.x, pp.z)) continue;
      // 避開大廳出生點附近
      return { x, z };
    }
    return null;
  }

  teleportNear(minD, maxD) {
    const s = this.findSpot(minD, maxD);
    if (s) { this.pos.set(s.x, 0, s.z); this.path = null; this.failN = 0; return true; }
    return false;
  }

  // 她的尋路網格變了（開了鎖、鐵捲門開或關）：重新規劃路線
  navChanged() {
    this.path = null;
    this.travelLink = null;
  }
  // 關著的鐵捲門：跟玩家一樣被推到她原本那一側（不會卡在裡面、也不會穿過去）
  keepOutOfShutters() {
    for (const sh of this.lv.shutters || []) {
      if (sh.open >= SHUTTER_PASS) continue;
      const b = sh.box;
      if (this.pos.x < b.minX - 0.6 || this.pos.x > b.maxX + 0.6 || this.pos.z < b.minZ - 0.6 || this.pos.z > b.maxZ + 0.6) continue;
      const before = this.pos.x + this.pos.z;
      if (pushOut(this.pos, 0.3, b) && Math.abs(this.pos.x + this.pos.z - before) > 1e-6) this.path = null;
    }
  }

  hearNoise(x, z, radius, kind = '', floor = this.floor) {
    if (this.state === 'dormant' || this.state === 'stunned' || this.state === 'kill' || floor !== this.floor) return;
    // 追逐中只有在看不到玩家時，才會被摔破的瓶子之類的大聲響引開（玩家自己的腳步聲不算）
    if (this.state === 'chase' && (kind !== 'bottle' || this.seesPlayer || this.lostT < 0.3 || this.enraged || this.knowsLocker)) return;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d < radius * this.diff.hearing * this.aggression) {
      this.lastKnown = { x, z };
      if (this.state !== 'investigate') this.setState('investigate');
      this.path = null;
      this.investigateTarget = { x, z };
    }
  }

  // 躲在櫃子裡被聽到了
  heardHiding(locker) {
    if (this.state === 'dormant' || this.state === 'stunned' || this.state === 'kill') return;
    this.knowsLocker = locker;
    this.lastKnown = { x: locker.exitX, z: locker.exitZ };
    this.setState('chase');
  }

  stun() {
    if (this.state === 'dormant' || this.state === 'kill') return false;
    this.setState('stunned');
    this.sfx('ghostScream', { pos: this.pos });
    return true;
  }

  moveAlong(dt, speed) {
    const g = this.game;
    if (!this.path || this.pathI >= this.path.length) return true;
    const wp = this.path[this.pathI];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) { this.pathI++; return this.pathI >= this.path.length; }
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    const targetYaw = Math.atan2(dx, dz);
    this.yaw += angDiff(targetYaw, this.yaw) * Math.min(1, dt * 6);
    // 開門（她所在的那一層）
    for (const door of this.lv.doors) {
      if (door.angle > 0.9) continue;
      // 上鎖的門她不開：直接穿過去（門對玩家來說還是鎖著的）
      if (door.lock >= 0 && !door.unlocked) continue;
      if (Math.abs(door.cx - this.pos.x) < 1.3 && Math.abs(door.cz - this.pos.z) < 1.3) {
        const fast = this.state === 'chase';
        // 已經在開了：只在追逐時把速度加快，不要每格都重播開門聲
        if (door.target >= 1.4) { if (fast && door.speed < 7) this.world.setDoor(door, door.target, 7); continue; }
        this.world.setDoor(door, 1.45, fast ? 7 : 1.4);
        this.sfx(fast ? 'doorBang' : 'doorCreak', { pos: { x: door.cx, y: 1.2, z: door.cz } });
      }
    }
    void g;
    return false;
  }

  goTo(x, z) {
    // 目標在另一個連通區塊（鎖著的房間、關著的鐵捲門另一邊沒有別的路）：不用跑 A* 也知道走不到
    const nav = this.nav, c = nav.base ? nav.compAt(this.pos.x, this.pos.z) : -1;
    const p = c >= 0 && nav.compAt(x, z) !== c ? null : nav.findPath(this.pos.x, this.pos.z, x, z);
    this.path = p;
    this.pathI = 0;
    this.failN = p ? 0 : (this.failN || 0) + 1;
    return !!p;
  }

  update(dt) {
    this.think(dt);
    this.updateAura(dt);
  }

  think(dt) {
    const g = this.game, lv = this.lv;
    // 多人連線：只有房主跑 AI，其他人照房主送來的狀態播放
    if (g.mp && !g.mp.isHost) { this.netUpdate(dt); return; }
    if (this.banished) { this.state = 'dormant'; this.model.root.visible = false; return; }
    const P = g.mp ? g.mpGhostTarget(this) : g.player;
    this.target = P;
    this.stateT += dt;
    const m = this.model;
    if (this.state === 'dormant') { m.root.visible = false; this.awayT = 0; return; }
    m.root.visible = this.near;
    // 目標在別層：看不到、聽不到、抓不到，距離當作很遠
    const pf = Ghost.floorOf(P), same = pf === this.floor;
    this.awayT = same ? 0 : this.awayT + dt;
    const eye = P.pos;
    const dx = eye.x - this.pos.x, dz = eye.z - this.pos.z;
    const dist = same ? Math.hypot(dx, dz) : 99;
    // --- 感知
    let sees = false, lit = false;
    if (same && !P.hiding && this.state !== 'stunned' && this.state !== 'kill') {
      let range = 12 * this.diff.sight * this.aggression;
      lit = this.world.lightAt(eye.x, eye.z) > 0.4;
      if (P.flashOn) range *= 1.45;
      if (P.crouching) range *= 0.62;
      if (lit) range *= 1.2;
      if (this.state === 'chase') range *= 1.5;
      if (dist < range) {
        const toP = Math.atan2(dx, dz);
        const inFov = Math.abs(angDiff(toP, this.yaw)) < (this.state === 'chase' ? Math.PI : 1.25) || dist < 2.6;
        if (inFov && sightClear(lv, this.pos.x, this.pos.z, eye.x, eye.z)) sees = true;
      }
    }
    // 理智歸零時她知道你在哪
    const insane = same && P.sanity <= 0.01 && this.state !== 'stunned' && this.state !== 'kill' && !P.hiding;
    if (insane) sees = sees || dist < 25;
    this.seesPlayer = sees;
    // 察覺：看得到才會累積。越近越快（3 公尺內幾乎馬上），開手電筒、站在燈下、站著（沒蹲）都更快；
    // 她已經起疑（查看聲音、搜索中）時也更快。看不到就慢慢退掉。滿了才尖叫追上來
    let aw = this.awareOf(P);
    if (sees) {
      this.lastKnown = { x: eye.x, z: eye.z };
      this.lostT = 0;
      if (this.state === 'chase') aw = 1;
      else {
        const base = this.diff.notice ?? 1.1;
        let rate = base * Math.min(12, Math.max(0.35, Math.pow(7 / Math.max(0.5, dist), 1.6)));
        if (dist < 3) rate = Math.max(rate, base * 4.5, 3.2);
        if (P.flashOn) rate *= 1.35;
        if (lit) rate *= 1.25;
        if (P.crouching) rate *= 0.6;
        if (this.state === 'investigate' || this.state === 'search') rate *= 1.5;
        if (insane) rate *= 2;
        aw = Math.min(1, aw + dt * rate * this.aggression);
      }
    } else if (this.state !== 'chase') aw = Math.max(0, aw - dt * 0.4);
    if (aw > 0 || this.aware.has(P)) this.aware.set(P, aw);
    // 其他人（多人時她沒在看的人）的察覺值慢慢退掉
    for (const [k, v] of this.aware) if (k !== P) { if (v <= dt * 0.4) this.aware.delete(k); else this.aware.set(k, v - dt * 0.4); }
    // 察覺中（還沒滿）：她停下腳步、轉過來盯著你——這時候躲開她的視線還來得及
    this.noticing = sees && aw > 0.04 && aw < 1 && this.state !== 'chase' && this.state !== 'stunned' && this.state !== 'kill';
    // 玩家躲在櫃子裡：她在附近停下腳步時會側耳傾聽
    this.listening = false;
    if (same && P.hiding && !this.knowsLocker && (this.state === 'search' || this.state === 'investigate' || this.state === 'wander') && dist < 3.4 && this.speed < 0.35) {
      this.listening = true;
      if (!P.holdingBreath) {
        this.hearT = (this.hearT || 0) + dt * (1.15 - dist / 3.4) * 0.9 * this.diff.hearing;
        if (this.hearT > 1) { this.hearT = 0; this.heardHiding(P.hiding); }
      } else this.hearT = Math.max(0, (this.hearT || 0) - dt * 0.5);
    } else this.hearT = Math.max(0, (this.hearT || 0) - dt * 0.3);
    if (sees && aw >= 1 && this.state !== 'chase' && this.state !== 'stunned' && this.state !== 'kill') this.setState('chase');
    if (same && this.enraged && this.state !== 'stunned' && this.state !== 'kill' && this.state !== 'chase' && !P.hiding) {
      this.lastKnown = { x: eye.x, z: eye.z };
      this.setState('chase');
    }

    // 憤怒讓她更快，但速度最多只算到 1.6 倍憤怒（插滿保險絲又放回遺物時，普通難度發狂也不會比全力奔跑快）；感知照樣跟著憤怒變敏銳
    const base = this.diff.ghostSpeed * (0.85 + 0.15 * Math.min(this.aggression, 1.6));
    let speed = 0;
    // 目標在別層：追逐中（或發狂時）馬上跟著走樓梯；閒晃 / 搜索一陣子之後也會換到那一層
    const busy = this.state === 'stunned' || this.state === 'kill';
    const goFloor = !same && !busy && (this.state === 'chase' || this.enraged || this.awayT > (this.state === 'wander' ? 28 : 12) / this.aggression);
    if (goFloor) {
      speed = (this.state === 'chase' || this.enraged ? (this.enraged ? 4.15 : 3.45) : this.state === 'wander' ? 1.15 : 2.0) * base;
      this.travel(dt, speed, pf);
    } else if (this.noticing) {
      // 停下來、慢慢轉向你（看得懂的預警），路線保留，看不到你之後接著走
      speed = 0;
      this.yaw += angDiff(Math.atan2(dx, dz), this.yaw) * Math.min(1, dt * 3);
    } else switch (this.state) {
      case 'wander': {
        speed = 1.15 * base;
        if (!this.path) {
          if (this.idleT > 0) { this.idleT -= dt; speed = 0; break; }
          let target = null;
          if (Math.random() < 0.55 + 0.1 * this.aggression) target = this.findSpot(6, 20, false);
          if (!target || !same) {
            // 隨便挑一間她走得到的房間（還鎖著的、關著的鐵捲門後面的不算）
            const here = this.nav.compAt(this.pos.x, this.pos.z);
            for (let t = 0; t < 8; t++) {
              const room = lv.rooms[1 + Math.floor(Math.random() * (lv.rooms.length - 1))];
              target = { x: room.cx, z: room.cz };
              if (this.nav.compAt(room.cx, room.cz) === here) break;
            }
          }
          if (!this.goTo(target.x, target.z)) this.idleT = 1;
        } else if (this.moveAlong(dt, speed)) {
          this.path = null;
          this.idleT = 1 + Math.random() * 2.5;
        }
        break;
      }
      case 'investigate': {
        speed = 2.0 * base;
        const tgt = this.investigateTarget || this.lastKnown;
        if (!this.path && tgt) this.goTo(tgt.x, tgt.z);
        if (!this.path || this.moveAlong(dt, speed)) { this.setState('search'); this.searchN = 0; }
        if (this.stateT > 20) this.setState('wander');
        break;
      }
      case 'chase': {
        speed = (this.enraged ? 4.15 : 3.45) * base;
        this.replanT -= dt;
        if (!sees) this.lostT += dt;
        // 她以為你在某個櫃子裡，但你已經出來了（或根本沒進去）→ 改追你本人
        if (this.knowsLocker && P.hiding !== this.knowsLocker && !(P.hideAnim && P.hideAnim.entering && P.hideAnim.locker === this.knowsLocker)) {
          this.knowsLocker = null;
          this.path = null;
        }
        // 玩家躲進櫃子的瞬間被看到 → 她會直接過去
        if (P.hiding && this.knowsLocker !== P.hiding) {
          if (this.lostT < 0.6 && dist < 14) this.knowsLocker = P.hiding;
        }
        // 逃亡階段她不會放棄：看不到你一陣子後，她「感覺」得到你大概在哪裡（不然她會站在最後看到你的地方不動）
        if (this.enraged && !sees && same && !P.hiding && this.lostT > 1.5 && this.replanT <= 0) {
          this.lastKnown = { x: P.pos.x + (Math.random() - 0.5) * 3, z: P.pos.z + (Math.random() - 0.5) * 3 };
        }
        const tgt = this.knowsLocker ? { x: this.knowsLocker.exitX, z: this.knowsLocker.exitZ } : (sees ? eye : this.lastKnown);
        if (tgt && (this.replanT <= 0 || !this.path)) {
          this.replanT = 0.35;
          if (sees && dist < 2.2 && !this.knowsLocker) {
            this.path = [{ x: eye.x, z: eye.z }];
            this.pathI = 0;
          } else this.goTo(tgt.x, tgt.z);
        }
        this.moveAlong(dt, speed);
        if (this.knowsLocker) {
          if (P.hiding === this.knowsLocker && Math.hypot(this.knowsLocker.exitX - this.pos.x, this.knowsLocker.exitZ - this.pos.z) < 0.7) {
            this.setState('kill');
            g.onCaught(true, P);
          }
        } else if (dist < 0.85 && !P.hiding) {
          this.setState('kill');
          g.onCaught(false, P);
        } else if ((!this.enraged && this.lostT > (this.diff.giveUp ?? 3.2)) || (P.hiding && !this.knowsLocker)) {
          this.setState('search');
          this.searchN = 0;
        }
        break;
      }
      case 'search': {
        speed = 1.6 * base;
        if (!this.path) {
          if (this.idleT > 0) { this.idleT -= dt; speed = 0; this.yaw += dt * 1.2 * Math.sin(this.stateT); break; }
          const c = this.lastKnown || { x: this.pos.x, z: this.pos.z };
          let ok = false;
          const here = this.nav.compAt(this.pos.x, this.pos.z);
          for (let t = 0; t < 10 && !ok; t++) {
            const x = c.x + (Math.random() - 0.5) * 10, z = c.z + (Math.random() - 0.5) * 10;
            if (this.nav.isFree(x, z) && this.nav.compAt(x, z) === here) ok = this.goTo(x, z);
          }
          this.searchN = (this.searchN || 0) + 1;
          if (!ok) { this.idleT = 1; this.failN = (this.failN || 0) + 2; }
        } else if (this.moveAlong(dt, speed)) {
          this.path = null;
          this.idleT = 1.5 + Math.random() * 2;
        }
        if (this.stateT > (this.diff.search ?? 16)) this.setState('wander');
        break;
      }
      case 'stunned': {
        speed = 0;
        if (this.stateT > 4.2) {
          // 退開：消失到遠處
          if (!this.teleportNear(18, 40)) this.teleportNear(10, 60);
          this.aware.clear();
          this.knowsLocker = null;
          this.state = 'dormant';
          this.dormantUntil = g.time + 7 + Math.random() * 5;
          m.root.visible = false;
          g.onChaseEnd();
        }
        break;
      }
      case 'kill': {
        speed = 0;
        break;
      }
    }
    this.speed += (speed - this.speed) * Math.min(1, dt * 5);
    this.keepOutOfShutters();
    // 一直找不到路（被關著的鐵捲門隔開、目標在她走不到的地方）：換到走得到目標的地方，不會永遠卡住
    if ((this.failN || 0) >= 10 && this.state !== 'kill' && this.state !== 'stunned') {
      this.failN = 0;
      if (!this.teleportNear(12, 40)) this.teleportNear(6, 80);
    }

    // 卡住偵測
    if (this.path && speed > 0) {
      const wp = this.path[Math.min(this.pathI, this.path.length - 1)];
      const d = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
      if (d > this.lastDist - 0.01) this.stuckT += dt; else this.stuckT = 0;
      this.lastDist = d;
      if (this.stuckT > 2.5) {
        this.stuckT = 0;
        this.path = null;
        const k = this.nav.nearestFree(this.pos.x, this.pos.z);
        if (k >= 0) { const c = this.nav.center(k); this.pos.x = c.x; this.pos.z = c.z; }
      }
    }
    // 離玩家太遠太久 → 瞬移到附近（維持壓迫感）
    if (this.state === 'wander' && same && dist > 28) {
      this.farT += dt;
      if (this.farT > 22) { this.farT = 0; this.teleportNear(14, 24); }
    } else this.farT = 0;

    this.dist = dist;
    this.animate(dt, P);
  }

  // 動畫、看人、腳步聲與哼歌位置
  animate(dt, P) {
    const g = this.game, m = this.model, dist = this.dist ?? 99;
    this.phase += dt * (1.5 + this.speed * 2.6);
    const t = g.time;
    let jitterX = 0, jitterZ = 0;
    if (this.state === 'chase' && Math.random() < 0.03) { jitterX = (Math.random() - 0.5) * 0.12; jitterZ = (Math.random() - 0.5) * 0.12; }
    const bob = m.isReal ? 0 : 0.015 + Math.abs(Math.sin(this.phase)) * 0.015;
    m.root.position.set(this.pos.x + jitterX, bob, this.pos.z + jitterZ);
    m.root.rotation.y = this.yaw;
    if (m.isReal) {
      // 平常頭髮半遮著臉，盯上你時撥開
      const rv = this.state === 'chase' ? 1 : this.seesPlayer ? 0.65 : 0.25;
      this.reveal = (this.reveal ?? rv) + (rv - (this.reveal ?? rv)) * Math.min(1, dt * 2);
      m.revealFace(this.reveal);
    }
    // 她察覺到你時，會慢慢把頭轉過來盯著你
    if (m.setLookTarget) {
      // 只有看得到你時才盯著你；看不到就看你最後出現的地方（不會隔著牆或櫃門洩漏她知道你在哪）
      const w = this.seesPlayer ? (this.state === 'chase' ? 1 : dist < 12 ? Math.min(1, 0.35 + this.suspicion) : 0) : this.lastKnown && this.state !== 'wander' ? 0.5 : 0;
      this.lookW = (this.lookW || 0) + (w - (this.lookW || 0)) * Math.min(1, dt * 3);
      const lt = this.lookTgt || (this.lookTgt = new THREE.Vector3());
      if (this.seesPlayer && P && P.camera) lt.copy(P.camera.position);
      else if (this.lastKnown) lt.set(this.lastKnown.x, 1.4, this.lastKnown.z);
      m.setLookTarget(lt, this.lookW);
    }
    m.pose(this.state, t, this.phase, this.speed);
    m.setEyes(this.state === 'chase' ? 1.4 : this.state === 'stunned' ? 0.2 : 0.55);
    if (this.emitter) this.emitter.setPosition(this.pos.x, 1.6, this.pos.z);
    // 哼歌只在同一層聽得到（換樓層時停掉、回到同一層再接上）；音效引擎整個停掉過的話也要重新接上
    if (this.humming && !this.game.audio.hums.has(this.emitter)) this.humming = false;
    if (!this.near && this.humming) this.stopHum();
    else if (this.near && !this.humming && (this.state === 'wander' || this.state === 'search')) this.startHum();
    // 腳步跟著她實際走的距離：走路一步約 0.75 公尺、跑起來步伐變大；一腳重一腳輕，節奏不太規則
    // （多人時其他人也是用房主同步來的位置與速度在這裡播）
    if (this.speed > 0.3 && this.state !== 'dormant') {
      this.stepT -= dt * this.speed;
      if (this.stepT <= 0) {
        this.stepN = (this.stepN || 0) + 1;
        const light = this.stepN % 2 === 0;
        this.stepT = (0.5 + 0.18 * this.speed) * (light ? 0.88 : 1.12) * (0.94 + Math.random() * 0.12);
        this.sfx('ghostStep', { pos: { x: this.pos.x, y: 0.1, z: this.pos.z }, speed: this.speed, light, fast: this.speed > 2.4 });
      }
      this.idleSnd = 1.5 + Math.random() * 2;
    } else if (this.near && (this.state === 'wander' || this.state === 'search' || this.state === 'investigate')) {
      // 站著不動（在聽）：從她的位置傳來很輕的呼吸，偶爾地板吱一聲
      this.idleSnd = (this.idleSnd ?? 2) - dt;
      if (this.idleSnd <= 0) {
        this.idleSnd = 2.6 + Math.random() * 2.4;
        this.sfx('ghostBreath', { pos: { x: this.pos.x, y: 1.55, z: this.pos.z }, creak: Math.random() < 0.25 });
      }
    }
    void g;
  }

  // ---- 多人連線：房主送來的女鬼狀態
  netState() {
    return {
      t: 'gh', fl: this.floor, x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), y: +this.yaw.toFixed(2), s: this.state,
      v: +this.speed.toFixed(2), sp: this.seesPlayer ? 1 : 0, tg: this.targetSlot ?? -1, l: this.listening ? 1 : 0,
      // 她對目前目標（tg）的察覺值（取到 0.05），查看聲音時要去的地方（讓其他人知道是不是自己附近的聲音）
      aw: Math.round(this.awareOf(this.target) * 20) / 20,
      ...(this.state === 'investigate' && this.investigateTarget ? { ix: +this.investigateTarget.x.toFixed(1), iz: +this.investigateTarget.z.toFixed(1) } : {}),
    };
  }
  applyNet(m) {
    if (![m.x, m.z, m.y].every(Number.isFinite) || !NET_STATES.has(m.s)) return;
    if (!Number.isInteger(m.fl) || m.fl < 0 || m.fl >= this.game.floors.length) return;
    const first = !this.net;
    this.net = m;
    // 察覺值與目標：只收 0..1 的有限數字、整數的玩家編號，其他一律不理（保留上一次的值）
    if (typeof m.aw === 'number' && Number.isFinite(m.aw) && m.aw >= 0 && m.aw <= 1) this.netAware = m.aw;
    this.netTarget = Number.isInteger(m.tg) && m.tg >= -1 && m.tg < 16 ? m.tg : -1;
    this.netInvestigate = m.s === 'investigate' && [m.ix, m.iz].every((v) => typeof v === 'number' && Number.isFinite(v)) ? { x: m.ix, z: m.iz } : null;
    // 換樓層：直接跳到新位置
    if (m.fl !== this.floor) { this.setFloor(m.fl); this.pos.set(m.x, 0, m.z); this.yaw = m.y; }
    // 房主那邊瞬間移動（防卡住的傳送）：直接跳過去，不要滑過牆
    const far = Math.hypot(m.x - this.pos.x, m.z - this.pos.z) > 3;
    if (far) { this.pos.set(m.x, 0, m.z); this.yaw = m.y; }
    if (m.s !== this.state) {
      const prev = this.state;
      // 從消失的狀態現身：直接出現在新位置
      if (prev === 'dormant' || first) { this.pos.set(m.x, 0, m.z); this.yaw = m.y; }
      if (m.s === 'stunned') this.sfx('ghostScream', { pos: this.pos });
      this.setState(m.s);
    }
  }
  netUpdate(dt) {
    const g = this.game, m = this.model, n = this.net;
    this.stateT += dt;
    if (!n || this.state === 'dormant') { m.root.visible = false; return; }
    m.root.visible = this.near;
    const k = 1 - Math.exp(-dt * 12);
    this.pos.x += (n.x - this.pos.x) * k;
    this.pos.z += (n.z - this.pos.z) * k;
    this.yaw += angDiff(n.y, this.yaw) * k;
    this.speed += (n.v - this.speed) * k;
    this.seesPlayer = !!n.sp;
    this.listening = !!n.l;
    // 她在看誰：自己就看鏡頭，其他人就看那個人的頭
    const P = this.netTarget === g.mp.mySlot ? g.player : g.remotes.get(this.netTarget) || null;
    this.dist = P && Ghost.floorOf(P) === this.floor ? Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z) : 99;
    this.animate(dt, P);
  }
}

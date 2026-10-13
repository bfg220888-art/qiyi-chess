// 「她」：長髮白衣女鬼的模型、程序動畫與 AI
import * as THREE from 'three';
import { CELL } from './config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sightClear } from './nav.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

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
    this.suspicion = 0;
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
    model.root.visible = false;
    game.scene.add(model.root);
  }

  get diff() { return this.game.diff; }

  setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    this.stateT = 0;
    this.path = null;
    const a = this.game.audio;
    if (s === 'chase') {
      this.stopHum();
      if (prev !== 'chase') {
        a.play('shriek', { pos: this.pos });
        this.game.onChaseStart();
      }
    } else if (prev === 'chase') {
      this.game.onChaseEnd();
    }
    if (s === 'wander' || s === 'search') this.startHum();
    if (s === 'dormant' || s === 'stunned' || s === 'kill') this.stopHum();
  }

  startHum() {
    if (this.humming || this.state === 'dormant') return;
    if (!this.emitter) this.emitter = this.game.audio.createEmitter();
    this.game.audio.startHum(this.emitter);
    this.humming = true;
  }
  stopHum() {
    if (!this.humming) return;
    this.game.audio.stopHum(this.emitter);
    this.humming = false;
  }

  spawnAt(x, z, state = 'wander') {
    const k = this.game.ghostNav.nearestFree(x, z);
    const c = k >= 0 ? this.game.ghostNav.center(k) : { x, z };
    this.pos.set(c.x, 0, c.z);
    this.model.root.visible = true;
    this.state = 'none';
    this.setState(state);
  }

  // 找一個離玩家指定距離、看不到玩家的位置
  findSpot(minD, maxD, needHidden = true) {
    const g = this.game, lv = g.lv, nav = g.ghostNav, pp = g.player.pos;
    for (let t = 0; t < 80; t++) {
      const x = Math.random() * lv.W * CELL, z = Math.random() * lv.H * CELL;
      if (!nav.isFree(x, z)) continue;
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
    if (s) { this.pos.set(s.x, 0, s.z); this.path = null; return true; }
    return false;
  }

  hearNoise(x, z, radius) {
    if (this.state === 'dormant' || this.state === 'stunned' || this.state === 'kill') return;
    // 追逐中只有在看不到玩家時，才會被大聲響（例如摔破的瓶子）引開
    if (this.state === 'chase' && (this.seesPlayer || radius < 15 || this.enraged || this.knowsLocker)) return;
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
    this.game.audio.play('ghostScream', { pos: this.pos });
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
    // 開門
    for (const door of g.lv.doors) {
      if (door.angle > 0.9) continue;
      if (Math.abs(door.cx - this.pos.x) < 1.3 && Math.abs(door.cz - this.pos.z) < 1.3) {
        const fast = this.state === 'chase';
        g.world.setDoor(door, 1.45, fast ? 7 : 1.4);
        g.audio.play(fast ? 'doorBang' : 'doorCreak', { pos: { x: door.cx, y: 1.2, z: door.cz } });
      }
    }
    return false;
  }

  goTo(x, z) {
    const p = this.game.ghostNav.findPath(this.pos.x, this.pos.z, x, z);
    this.path = p;
    this.pathI = 0;
    return !!p;
  }

  update(dt) {
    const g = this.game, P = g.player, lv = g.lv;
    this.stateT += dt;
    const m = this.model;
    if (this.state === 'dormant') { m.root.visible = false; return; }
    m.root.visible = true;
    const eye = P.pos;
    const dx = eye.x - this.pos.x, dz = eye.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    // --- 感知
    let sees = false;
    if (!P.hiding && this.state !== 'stunned' && this.state !== 'kill') {
      let range = 12 * this.diff.sight * this.aggression;
      if (P.flashOn) range *= 1.45;
      if (P.crouching) range *= 0.62;
      if (g.world.lightAt(eye.x, eye.z) > 0.4) range *= 1.2;
      if (this.state === 'chase') range *= 1.5;
      if (dist < range) {
        const toP = Math.atan2(dx, dz);
        const inFov = Math.abs(angDiff(toP, this.yaw)) < (this.state === 'chase' ? Math.PI : 1.25) || dist < 2.6;
        if (inFov && sightClear(lv, this.pos.x, this.pos.z, eye.x, eye.z)) sees = true;
      }
    }
    // 理智歸零時她知道你在哪
    if (P.sanity <= 0.01 && this.state !== 'stunned' && !P.hiding) sees = sees || dist < 25;
    this.seesPlayer = sees;
    if (sees) {
      this.lastKnown = { x: eye.x, z: eye.z };
      this.lostT = 0;
      const rate = (this.state === 'investigate' || this.state === 'search' ? 1.6 : 0.9) * (1 + Math.max(0, 8 - dist) * 0.35) * this.aggression;
      this.suspicion = Math.min(1.2, this.suspicion + dt * rate);
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * 0.25);
    }
    // 玩家躲在櫃子裡：她在附近停下腳步時會側耳傾聽
    this.listening = false;
    if (P.hiding && !this.knowsLocker && (this.state === 'search' || this.state === 'investigate' || this.state === 'wander') && dist < 3.4 && this.speed < 0.35) {
      this.listening = true;
      if (!P.holdingBreath) {
        this.hearT = (this.hearT || 0) + dt * (1.15 - dist / 3.4) * 0.9 * this.diff.hearing;
        if (this.hearT > 1) { this.hearT = 0; this.heardHiding(P.hiding); }
      } else this.hearT = Math.max(0, (this.hearT || 0) - dt * 0.5);
    } else this.hearT = Math.max(0, (this.hearT || 0) - dt * 0.3);
    if (sees && this.suspicion >= 1 && this.state !== 'chase' && this.state !== 'stunned' && this.state !== 'kill') this.setState('chase');
    if (this.enraged && this.state !== 'stunned' && this.state !== 'kill' && this.state !== 'chase' && !P.hiding) {
      this.lastKnown = { x: eye.x, z: eye.z };
      this.setState('chase');
    }

    const base = this.diff.ghostSpeed * (0.85 + 0.15 * this.aggression);
    let speed = 0;
    switch (this.state) {
      case 'wander': {
        speed = 1.15 * base;
        if (!this.path) {
          if (this.idleT > 0) { this.idleT -= dt; speed = 0; break; }
          let target = null;
          if (Math.random() < 0.55 + 0.1 * this.aggression) target = this.findSpot(6, 20, false);
          if (!target) {
            const room = lv.rooms[1 + Math.floor(Math.random() * (lv.rooms.length - 1))];
            target = { x: room.cx, z: room.cz };
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
        // 玩家躲進櫃子的瞬間被看到 → 她會直接過去
        if (P.hiding && this.knowsLocker !== P.hiding) {
          if (this.lostT < 0.6 && dist < 14) this.knowsLocker = P.hiding;
        }
        const tgt = this.knowsLocker ? { x: this.knowsLocker.exitX, z: this.knowsLocker.exitZ } : (sees ? eye : this.lastKnown);
        if (tgt && (this.replanT <= 0 || !this.path)) {
          this.replanT = 0.35;
          if (sees && dist < 2.2 && !this.knowsLocker) this.path = [{ x: eye.x, z: eye.z }], this.pathI = 0;
          else this.goTo(tgt.x, tgt.z);
        }
        this.moveAlong(dt, speed);
        if (this.knowsLocker) {
          if (Math.hypot(this.knowsLocker.exitX - this.pos.x, this.knowsLocker.exitZ - this.pos.z) < 0.7) {
            this.setState('kill');
            g.onCaught(true);
          }
        } else if (dist < 0.85 && !P.hiding) {
          this.setState('kill');
          g.onCaught(false);
        } else if (this.lostT > (this.enraged ? 6 : 3.2) || (P.hiding && !this.knowsLocker)) {
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
          for (let t = 0; t < 10 && !ok; t++) {
            const x = c.x + (Math.random() - 0.5) * 10, z = c.z + (Math.random() - 0.5) * 10;
            if (g.ghostNav.isFree(x, z)) ok = this.goTo(x, z);
          }
          this.searchN = (this.searchN || 0) + 1;
          if (!ok) this.idleT = 1;
        } else if (this.moveAlong(dt, speed)) {
          this.path = null;
          this.idleT = 1.5 + Math.random() * 2;
        }
        if (this.stateT > 16) this.setState('wander');
        break;
      }
      case 'stunned': {
        speed = 0;
        if (this.stateT > 4.2) {
          // 退開：消失到遠處
          if (!this.teleportNear(18, 40)) this.teleportNear(10, 60);
          this.suspicion = 0;
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

    // 卡住偵測
    if (this.path && speed > 0) {
      const wp = this.path[Math.min(this.pathI, this.path.length - 1)];
      const d = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
      if (d > this.lastDist - 0.01) this.stuckT += dt; else this.stuckT = 0;
      this.lastDist = d;
      if (this.stuckT > 2.5) {
        this.stuckT = 0;
        this.path = null;
        const k = g.ghostNav.nearestFree(this.pos.x, this.pos.z);
        if (k >= 0) { const c = g.ghostNav.center(k); this.pos.x = c.x; this.pos.z = c.z; }
      }
    }
    // 離玩家太遠太久 → 瞬移到附近（維持壓迫感）
    if (this.state === 'wander' && dist > 28) {
      this.farT += dt;
      if (this.farT > 22) { this.farT = 0; this.teleportNear(14, 24); }
    } else this.farT = 0;

    // --- 動畫與聲音
    this.phase += dt * (1.5 + this.speed * 2.6);
    const t = g.time;
    let jitterX = 0, jitterZ = 0;
    if (this.state === 'chase' && Math.random() < 0.03) { jitterX = (Math.random() - 0.5) * 0.12; jitterZ = (Math.random() - 0.5) * 0.12; }
    m.root.position.set(this.pos.x + jitterX, 0.015 + Math.abs(Math.sin(this.phase)) * 0.015, this.pos.z + jitterZ);
    m.root.rotation.y = this.yaw;
    m.pose(this.state, t, this.phase, this.speed);
    m.setEyes(this.state === 'chase' ? 1.4 : this.state === 'stunned' ? 0.2 : 0.55);
    if (this.emitter) this.emitter.setPosition(this.pos.x, 1.6, this.pos.z);
    if (this.speed > 0.3) {
      this.stepT -= dt * this.speed;
      if (this.stepT <= 0) {
        this.stepT = 0.62;
        g.audio.play('ghostStep', { pos: { x: this.pos.x, y: 0.1, z: this.pos.z }, fast: this.state === 'chase' });
      }
    }
  }
}

// 玩家：移動、碰撞、晃動、腳步聲、手電筒、相機閃光、躲藏
import * as THREE from 'three';
import { EYE_H, CROUCH_H, PLAYER_R, CELL } from './config.js';
import { sightClear, rayWallDistance } from './nav.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Player {
  constructor(game) {
    this.game = game;
    const lv = game.lv;
    this.pos = new THREE.Vector3(lv.spawn.x, EYE_H, lv.spawn.z);
    this.yaw = lv.spawn.yaw;
    this.pitch = 0;
    this.vel = new THREE.Vector2();
    this.eye = EYE_H;
    this.crouching = false;
    this.stamina = 1;
    this.exhausted = false;
    this.battery = 1;
    this.flashOn = true;
    this.film = game.diff.startFilm;
    this.fuses = 0;
    this.bottles = 0;
    this.breath = 1;
    this.holdingBreath = false;
    this.gaspCooldown = 0;
    this.sanity = 1;
    this.lives = game.diff.lives;
    this.hiding = null;
    this.hideAnim = null;
    this.bobPhase = 0;
    this.stepAcc = 0;
    this.fovKick = 0;
    this.shake = 0;
    this.flashCooldown = 0;
    this.pendingFlash = -1;
    this.locked = false; // 閱讀、過場時鎖住移動
    this.camera = new THREE.PerspectiveCamera(game.input.touchMode ? 74 : 70, innerWidth / innerHeight, 0.05, 70);
    this.camera.rotation.order = 'YXZ';
    // 手電筒
    const q = game.quality;
    const L = new THREE.SpotLight(0xfff1dc, 0, 26, 0.43, 0.5, 2);
    L.castShadow = true;
    L.shadow.mapSize.set(q.shadow, q.shadow);
    L.shadow.camera.near = 0.12;
    L.shadow.camera.far = 26;
    L.shadow.bias = -0.0004;
    L.shadow.normalBias = 0.035;
    L.map = game.tf.flashlightCookie().map;
    this.flash = L;
    this.aim = new THREE.Vector3(0, 0, -1);
    game.scene.add(L, L.target);
    // 相機閃光用的點光源
    this.photo = new THREE.PointLight(0xf4f6ff, 0, 18, 1.6);
    game.scene.add(this.photo);
    this.lightLevel = 1;
    this.flicker = 1;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt, inp) {
    const g = this.game;
    // --- 視角
    if (!this.hideAnim) {
      this.yaw -= inp.look.x;
      this.pitch -= inp.look.y;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
      if (this.hiding) {
        const base = this.hiding.rot + Math.PI;
        let d = this.yaw - base;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw = base + clamp(d, -0.55, 0.55);
        this.pitch = clamp(this.pitch, -0.45, 0.35);
      }
    }
    if (this.hideAnim) { this.updateHideAnim(dt); this.applyCamera(dt, 0); this.updateFlashlight(dt); return; }

    // --- 屏住呼吸（躲藏時）
    this.gaspCooldown = Math.max(0, this.gaspCooldown - dt);
    this.holdingBreath = !!(this.hiding && inp.holdBreath && this.breath > 0 && this.gaspCooldown <= 0);
    if (this.holdingBreath) {
      this.breath = Math.max(0, this.breath - dt / 12);
      if (this.breath <= 0) {
        // 憋不住了，大口喘氣
        this.holdingBreath = false;
        this.gaspCooldown = 2.5;
        g.audio.play('gasp');
        g.makeNoise(this.pos.x, this.pos.z, 9);
        if (g.ghost.state !== 'dormant' && Math.hypot(g.ghost.pos.x - this.pos.x, g.ghost.pos.z - this.pos.z) < 8 && this.hiding) g.ghost.heardHiding(this.hiding);
      }
    } else this.breath = Math.min(1, this.breath + dt / (this.hiding ? 3.5 : 2));

    // --- 移動
    let speed = 0;
    if (!this.hiding && !this.locked) {
      if (inp.crouchToggle) this.crouching = !this.crouching;
      const crouch = this.crouching || inp.crouchHold;
      let mx = inp.mx, my = inp.my;
      const moving = Math.hypot(mx, my) > 0.05;
      let sprint = inp.sprint && moving && my > 0.1 && !crouch && !this.exhausted;
      if (sprint) {
        this.stamina -= dt / (6.5 * (g.diff.label === '簡單' ? 1.3 : 1));
        if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; sprint = false; g.ui.hint('你喘不過氣了……', 2); }
        this.staminaRest = 1.0;
      } else {
        this.staminaRest = Math.max(0, (this.staminaRest || 0) - dt);
        if (this.staminaRest <= 0) this.stamina = Math.min(1, this.stamina + dt / (moving ? 11 : 7));
        if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
      }
      const target = crouch ? 1.25 : sprint ? 4.6 : 2.55;
      this.eye += ((crouch ? CROUCH_H : EYE_H) - this.eye) * Math.min(1, dt * 8);
      this.crouchNow = crouch;
      this.sprinting = sprint;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const wx = (-sy * my + cy * mx) * target, wz = (-cy * my - sy * mx) * target;
      const acc = moving ? 10 : 12;
      this.vel.x += (wx - this.vel.x) * Math.min(1, dt * acc);
      this.vel.y += (wz - this.vel.y) * Math.min(1, dt * acc);
      // 分段移動避免穿牆
      const dx = this.vel.x * dt, dz = this.vel.y * dt;
      const dist = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(dist / 0.1));
      const before = { x: this.pos.x, z: this.pos.z };
      for (let i = 0; i < steps; i++) {
        this.pos.x += dx / steps;
        this.pos.z += dz / steps;
        g.collision.resolve(this.pos, PLAYER_R);
      }
      const realDist = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
      speed = realDist / Math.max(dt, 1e-4);
      // 腳步
      this.bobPhase += realDist * (sprint ? 2.0 : 2.6);
      this.stepAcc += realDist;
      const stride = sprint ? 0.95 : crouch ? 0.55 : 0.72;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const room = g.lv.roomAtWorld(this.pos.x, this.pos.z);
        const surface = room && room.id > 0 && !['office', 'nurse', 'lobby'].includes(room.type) ? 'tile' : 'vinyl';
        g.audio.play('footstep', { run: sprint, crouch, surface });
        g.makeNoise(this.pos.x, this.pos.z, sprint ? 15 : crouch ? 2 : 6.5);
      }
    } else {
      this.vel.set(0, 0);
      this.sprinting = false;
    }
    this.speed = speed;

    // --- 理智
    const lit = g.world.lightAt(this.pos.x, this.pos.z);
    this.ambientLight = lit;
    let ds = 0;
    const dark = (!this.flashOn || this.battery <= 0) && lit < 0.15;
    if (dark) ds -= 0.011;
    if (lit > 0.4) ds += 0.018;
    if (g.ghostOnScreen) ds -= 0.045;
    if (g.ghost.state === 'chase') ds -= 0.015;
    if (this.hiding) ds -= 0.003;
    this.sanity = clamp(this.sanity + ds * dt * (g.diff.label === '惡夢' ? 1.25 : 1), 0, 1);

    // --- 手電筒電池
    if (this.flashOn) {
      this.battery = Math.max(0, this.battery - dt / 230 * g.diff.drain);
      if (this.battery <= 0) {
        this.flashOn = false;
        g.audio.play('flashClick');
        g.ui.hint('手電筒沒電了。找電池。', 3);
      }
    }
    this.flashCooldown = Math.max(0, this.flashCooldown - dt);
    if (this.pendingFlash >= 0) {
      this.pendingFlash -= dt;
      if (this.pendingFlash < 0) this.firePhoto();
    }
    this.photo.intensity *= Math.pow(0.0005, dt);
    if (this.photo.intensity < 0.5) this.photo.intensity = 0;

    this.applyCamera(dt, speed);
    this.updateFlashlight(dt);
  }

  applyCamera(dt, speed) {
    const c = this.camera;
    const bobAmp = this.sprinting ? 0.055 : this.crouchNow ? 0.018 : 0.032;
    const moving = Math.min(1, speed / 2.5);
    const by = Math.sin(this.bobPhase * 2) * bobAmp * moving;
    const bx = Math.cos(this.bobPhase) * bobAmp * 0.6 * moving;
    // 呼吸般的微晃
    const t = this.game.time;
    const idle = Math.sin(t * 1.3) * 0.006;
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sx = (Math.random() - 0.5) * sh * 0.06, syy = (Math.random() - 0.5) * sh * 0.06;
    if (!this.hideAnim) {
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      c.position.set(this.pos.x + r.x * bx, this.eye + by + idle, this.pos.z + r.z * bx);
    }
    c.rotation.set(this.pitch + syy + Math.sin(t * 0.9) * 0.003, this.yaw + sx, Math.cos(this.bobPhase) * 0.006 * moving - (this.game.inputMoveX || 0) * 0.012);
    const wantFov = (this.game.input.touchMode ? 74 : 70) + (this.sprinting ? 6 : 0) + this.fovKick;
    if (Math.abs(c.fov - wantFov) > 0.05) { c.fov += (wantFov - c.fov) * Math.min(1, dt * 5); c.updateProjectionMatrix(); }
    c.updateMatrixWorld();
  }

  updateFlashlight(dt) {
    const g = this.game, c = this.camera, L = this.flash;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    // 手電筒方向稍微落後視線（手持的重量感）
    this.aim.lerp(fwd, 1 - Math.exp(-dt * 13)).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    L.position.copy(c.position).addScaledVector(right, 0.17).addScaledVector(up, -0.17).addScaledVector(fwd, 0.08);
    L.target.position.copy(L.position).addScaledVector(this.aim, 6);
    L.target.updateMatrixWorld();
    // 電量低或鬼魂靠近時閃爍
    let fl = 1;
    const bat = this.battery;
    if (bat < 0.15 && Math.random() < 0.08 * (1 - bat / 0.15) + 0.01) fl = Math.random() * 0.3;
    const gd = g.ghostDist ?? 99;
    if (gd < 9 && g.ghost.state !== 'dormant' && Math.random() < (1 - gd / 9) * 0.35) fl *= Math.random() < 0.5 ? 0.05 : 0.6;
    if (g.eventFlicker > 0 && Math.random() < 0.4) fl *= 0.1;
    this.flicker += (fl - this.flicker) * Math.min(1, dt * 30);
    const on = this.flashOn && bat > 0 && !this.hiding;
    // 簡易自動曝光：照到很近的牆或地板時降低亮度，避免過曝
    const hz = Math.hypot(this.aim.x, this.aim.z);
    let near = rayWallDistance(g.lv, c.position.x, c.position.z, this.aim.x, this.aim.z, 20) / Math.max(0.05, hz);
    if (this.aim.y < -0.05) near = Math.min(near, c.position.y / -this.aim.y);
    if (this.aim.y > 0.05) near = Math.min(near, (3 - c.position.y) / this.aim.y);
    // 光照 ∝ I / d²：讓 I ∝ d² 就能在近距離保持差不多的亮度
    const expo = Math.min(1, Math.max(0.07, (near / 2.6) ** 2));
    this.expo = (this.expo ?? 1) + (expo - (this.expo ?? 1)) * Math.min(1, dt * 6);
    const strength = on ? (0.35 + Math.min(1, bat * 4) * 0.65) * this.flicker : 0;
    L.intensity = strength * 120 * this.expo;
    L.visible = strength > 0.001;
    if (this.photo.intensity > 0) this.photo.position.copy(c.position).addScaledVector(fwd, 0.4);
  }

  toggleFlash() {
    const g = this.game;
    if (this.hiding) { g.ui.hint('躲藏時不能開燈。', 1.5); return; }
    if (this.battery <= 0) { g.audio.play('flashClick'); g.ui.hint('沒電了。', 1.5); return; }
    this.flashOn = !this.flashOn;
    g.audio.play('flashClick');
  }

  takePhoto() {
    const g = this.game;
    if (this.flashCooldown > 0 || this.pendingFlash >= 0) return;
    if (this.hiding) { g.ui.hint('在櫃子裡拍不到東西。', 1.5); return; }
    if (this.film <= 0) { g.audio.play('cameraEmpty'); g.ui.hint('沒有底片了。', 1.5); return; }
    this.film--;
    this.flashCooldown = 2.2;
    this.pendingFlash = 0.3;
    g.audio.play('cameraFlash');
    g.ui.updateHud();
  }

  firePhoto() {
    const g = this.game;
    this.photo.intensity = 900;
    g.post.u.uFlash.value = 1;
    g.makeNoise(this.pos.x, this.pos.z, 10);
    // 閃光擊中她嗎？
    const gh = g.ghost;
    const fwd = this.forward(new THREE.Vector3());
    const tryStun = (x, z, y = 1.5) => {
      const to = new THREE.Vector3(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
      const d = to.length();
      if (d > 11) return false;
      to.normalize();
      if (to.dot(fwd) < Math.cos(0.6)) return false;
      return sightClear(g.lv, this.pos.x, this.pos.z, x, z);
    };
    if (gh.state !== 'dormant' && tryStun(gh.pos.x, gh.pos.z)) {
      if (gh.stun()) {
        g.stats.stuns++;
        g.ui.hint('她被閃光定住了——快跑！', 2.5);
      }
    }
    if (g.director.apparition && g.director.apparition.visible) {
      const a = g.director.apparition.position;
      if (tryStun(a.x, a.z)) g.director.vanishApparition(true);
    }
  }

  // --- 躲藏
  enterLocker(l) {
    const g = this.game;
    if (this.hiding || this.hideAnim) return;
    g.audio.play('lockerOpen', { pos: { x: l.x, y: 1, z: l.z } });
    l.target = 1.7;
    const yaw = l.rot + Math.PI;
    this.hideAnim = {
      t: 0, dur: 0.75, locker: l, entering: true,
      from: { x: this.pos.x, z: this.pos.z, eye: this.eye, yaw: this.yaw, pitch: this.pitch },
      to: { x: l.x + Math.sin(l.rot) * 0.08, z: l.z + Math.cos(l.rot) * 0.08, eye: 1.55, yaw, pitch: 0 },
    };
    // 如果這一刻她正看著你 → 她知道你躲在哪
    if (g.ghost.state === 'chase' && g.ghost.seesPlayer) g.ghost.knowsLocker = l;
    this.vel.set(0, 0);
    this.prevFlash = this.flashOn;
  }
  exitLocker() {
    const g = this.game, l = this.hiding;
    if (!l || this.hideAnim) return;
    g.audio.play('lockerOpen', { pos: { x: l.x, y: 1, z: l.z } });
    l.target = 1.7;
    l.hideDoor = false;
    l.dirty = true;
    this.hideAnim = {
      t: 0, dur: 0.6, locker: l, entering: false,
      from: { x: this.pos.x, z: this.pos.z, eye: this.eye, yaw: this.yaw, pitch: this.pitch },
      to: { x: l.exitX, z: l.exitZ, eye: EYE_H, yaw: this.yaw, pitch: this.pitch },
    };
    g.ui.setHiding(false);
  }
  updateHideAnim(dt) {
    const a = this.hideAnim, g = this.game;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const e = k * k * (3 - 2 * k);
    const lerpAng = (x, y, t) => { let d = y - x; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return x + d * t; };
    this.pos.x = a.from.x + (a.to.x - a.from.x) * e;
    this.pos.z = a.from.z + (a.to.z - a.from.z) * e;
    this.eye = a.from.eye + (a.to.eye - a.from.eye) * e;
    this.yaw = lerpAng(a.from.yaw, a.to.yaw, e);
    this.pitch = a.from.pitch + (a.to.pitch - a.from.pitch) * e;
    this.camera.position.set(this.pos.x, this.eye, this.pos.z);
    if (k >= 1) {
      const l = a.locker;
      this.hideAnim = null;
      l.target = 0;
      g.audio.play('lockerClose', { pos: { x: l.x, y: 1, z: l.z } });
      if (a.entering) {
        this.hiding = l;
        l.hideDoor = true;
        l.dirty = true;
        g.ui.setHiding(true);
        g.stats.hides++;
      } else {
        this.hiding = null;
        g.collision.resolve(this.pos, PLAYER_R);
      }
    }
  }

  // 被抓到但還有命（簡單模式）
  knockBack() {
    this.shake = 1.5;
    this.sanity = Math.max(0.25, this.sanity - 0.3);
  }

  get cellKey() {
    return Math.floor(this.pos.x / CELL) + Math.floor(this.pos.z / CELL) * this.game.lv.W;
  }
}

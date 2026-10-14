// 一局遊戲：把關卡、世界、玩家、鬼魂、導演、聲音和後製串起來
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CELL, GHOST_R, DIFFICULTY, WALL_H } from './config.js';
import { generateLevel, NOTES, E } from './level.js';
import { Collision, NavGrid, validateLevel, sightClear, wallsBetween } from './nav.js';
import { TextureFactory } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Ghost, GhostModel } from './ghost.js';
import { RealGhostModel } from './ghost-real.js';
import { Director } from './events.js';
import { Post } from './post.js';
import { fmtTime } from './ui.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(app, opts) {
    this.app = app;
    this.renderer = app.renderer;
    this.ui = app.ui;
    this.audio = app.audio;
    this.input = app.input;
    this.settings = app.settings;
    this.diffKey = opts.difficulty;
    this.diff = DIFFICULTY[opts.difficulty];
    this.quality = app.quality;
    this.seed = opts.seed >>> 0;
    this.time = 0;
    this.fusesInserted = 0;
    this.phase = 'explore';
    this.paused = false;
    this.dying = null;
    this.over = false;
    this.ghostDist = 99;
    this.eventFlicker = 0;
    this.staticBoost = 0;
    this.damage = 0;
    this.notesRead = new Set();
    this.stats = { stuns: 0, hides: 0, caught: 0, photos: 0 };
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 2.4;
    this.target = null;
    this.mapOpen = false;
    this.projectiles = [];
    this.timers = new Set();
    this.sight = (ax, az, bx, bz) => sightClear(this.lv, ax, az, bx, bz);
  }

  async build(progress) {
    progress(0.05, '正在畫出樓層平面圖……');
    await nextFrame();
    this.lv = generateLevel(this.seed, this.diff, (l) => validateLevel(l));
    this.explored = new Uint8Array(this.lv.W * this.lv.H);
    progress(0.15, '正在弄髒牆壁……');
    await nextFrame();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.055);
    // 極弱的環境反射：讓金屬與濕地板有一點點反光
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envRT = pmrem.fromScene(room, 0.04);
    this.envTex = this.envRT.texture;
    if (room.dispose) room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.035;
    // 外部素材（照片貼圖、寫實女鬼）同時下載；失敗都有程序生成的備援
    const ghostP = this.app.ghostAssets();
    const corpseP = this.app.corpseAssets();
    progress(0.18, '正在下載照片材質……');
    const photos = await this.app.photoAssets();
    this.tf = new TextureFactory(this.renderer, this.quality, this.seed, photos);
    this.tf.wall(); progress(0.25, '正在鋪地磚……'); await nextFrame();
    this.tf.floorVinyl(); this.tf.floorTile(); progress(0.35, '正在掛上天花板……'); await nextFrame();
    this.tf.ceiling(); this.tf.door(); this.tf.lockerDoor(); progress(0.45, '正在搬進病床……'); await nextFrame();
    this.tf.paintedMetal(); this.tf.steel(); this.tf.fabric(); this.tf.wood(); this.tf.grime(); progress(0.55, '正在灑上血跡……'); await nextFrame();
    this.world = new World(this.renderer, this.scene, this.lv, this.tf, this.quality);
    this.world.corpses = await corpseP;
    this.world.build();
    progress(0.7, '她正在醒來……');
    await nextFrame();
    this.collision = new Collision(this.lv);
    for (const d of this.lv.doors) this.collision.dynamic.push(d);
    this.collision.dynamic.push(this.lv.gate);
    for (const f of this.world.dynamicProps) {
      this.collision.removeStaticFurniture(f);
      this.collision.dynamic.push({ getBox: () => f.box });
    }
    this.ghostNav = new NavGrid(this.lv, GHOST_R, { ghost: true });
    this.world.propBlocked = (x, z) => this.collision.overlapsStatic(x, z, 0.4) || this.collision.dynamic.some((d) => { const b = d.getBox ? d.getBox() : null; return b && x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4 && !this.world.dynamicProps.some((f) => f.box === b); });
    this.player = new Player(this);
    // 寫實女鬼模型（下載失敗就用程序化的備援）
    progress(0.72, '她正在醒來……（下載她的模型）');
    this.ghostAssets = await ghostP;
    this.ghost = new Ghost(this, this.makeGhostModel());
    this.director = new Director(this);
    this.post = new Post(this.renderer, this.scene, this.player.camera, this.quality);
    this.audio.occlusionFn = (ax, az, bx, bz) => wallsBetween(this.lv, ax, az, bx, bz, 2);
    this.ui.bindGame(this);
    this.resize();
    progress(0.85, '正在編譯光影……');
    await nextFrame();
    // 預先編譯所有材質，避免第一次看到時卡頓
    this.ghost.model.root.visible = true;
    this.director.apparition.visible = true;
    this.player.flash.intensity = 1;
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.player.camera);
      else this.renderer.compile(this.scene, this.player.camera);
    } catch (e) { /* 舊瀏覽器 */ }
    this.post.render(0);
    // 先建好拍照用的目標與色調映射著色器，第一次按快門才不會頓
    this.post.snapshot(this.scene, this.player.camera, 256, 192).catch(() => {});
    this.ghost.model.root.visible = false;
    this.director.apparition.visible = false;
    progress(1, '');
    this.markExplored(true);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = this.app.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h, pr);
    if (this.player) {
      this.player.camera.aspect = w / h;
      this.player.camera.updateProjectionMatrix();
    }
  }

  start() {
    this.audio.startAmbience();
    this.audio.setRain(0.1);
    this.audio.setMusic('explore');
    this.ui.updateHud();
    // 開場：身後的大門砰一聲關上
    this.later(() => {
      if (this.over) return;
      this.audio.play('doorSlam', { pos: { x: this.lv.gate.x, y: 1.2, z: this.lv.gate.z } });
      this.audio.play('metalClank', { pos: { x: this.lv.gate.x, y: 1, z: this.lv.gate.z } });
      this.player.shake = 0.8;
      this.ui.subtitle('（大門在身後鎖上了）', 3.5);
    }, 1400);
    this.later(() => {
      if (this.over) return;
      this.ui.hint(this.input.touchMode ? '左邊拖曳移動，右邊滑動看四周。看到東西時按「互動」。' : 'WASD 移動・滑鼠看四周・E 互動・F 手電筒・Q 相機閃光', 6);
    }, 4200);
    this.later(() => { if (!this.over) this.ui.subtitle('先看看大廳牆上的平面圖。', 4); }, 11000);
  }

  makeGhostModel() {
    if (this.ghostAssets) {
      try { return new RealGhostModel(this.ghostAssets, this.tf); } catch (e) { console.warn('real ghost failed, using fallback', e); this.ghostAssets = null; }
    }
    return new GhostModel(this.tf, this.world.M);
  }

  // 會在遊戲結束或離開後自動取消的計時器
  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.over || this.disposed || this.app.game !== this) return;
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  // 噪音：會吸引她
  makeNoise(x, z, radius, kind = '') {
    if (radius <= 0 || !this.ghost) return;
    this.ghost.hearNoise(x, z, radius, kind);
  }

  // ---------------------------------------------------------------------
  update(dt, inp) {
    if (this.over) return;
    this.time += dt;
    const P = this.player;
    this.inputMoveX = inp.mx;
    if (this.dying) { this.updateDying(dt); return; }

    // 動作
    inp.crouchToggle = false;
    for (const a of inp.actions) {
      if (this.ui.noteOpen) {
        if (a === 'interact' || a === 'tap' || a === 'confirm' || a === 'pause') { this.ui.closeNote(); P.locked = false; this.input.requestLock(); }
        continue;
      }
      switch (a) {
        case 'interact': case 'tap': this.interact(); break;
        case 'flashlight': P.toggleFlash(); break;
        case 'camera': P.takePhoto(); break;
        case 'throw': this.throwBottle(); break;
        case 'crouch': inp.crouchToggle = true; break;
        case 'map':
          if (this.diff.noMap) { this.ui.hint('惡夢模式沒有地圖。', 1.5); break; }
          this.mapOpen = !this.mapOpen;
          this.ui.toggleMap(this.mapOpen);
          break;
        case 'pause': this.app.pause(); return;
      }
    }
    if (this.ui.noteOpen) P.locked = true;

    P.update(dt, inp);
    this.updateProjectiles(dt);
    this.ghost.update(dt);
    if (this.over || this.dying) return;
    this.director.update(dt);
    this.world.update(dt, P.camera, P.flashOn && P.battery > 0 && !P.hiding);
    // 日光燈電流聲：每 0.25 秒挑一次最近的亮燈，音量每格跟著閃爍
    this.buzzT = (this.buzzT || 0) - dt;
    if (this.buzzT <= 0) {
      this.buzzT = 0.25;
      let best = null, bd = 64;
      for (const f of this.lv.fixtures) {
        if (!f.on) continue;
        const d = (f.x - P.pos.x) ** 2 + (f.z - P.pos.z) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
      this.buzzFix = best;
    }
    this.audio.setBuzz(this.buzzFix, this.buzzFix ? this.buzzFix.level : 0);
    this.updateInteraction();
    this.markExplored(false);
    if (this.mapOpen && Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.ui.drawMap();

    // 她在畫面上嗎？
    const gh = this.ghost;
    this.ghostDist = gh.state === 'dormant' ? 99 : Math.hypot(gh.pos.x - P.pos.x, gh.pos.z - P.pos.z);
    this.ghostOnScreen = false;
    if (gh.state !== 'dormant' && this.ghostDist < 18) {
      const v = new THREE.Vector3(gh.pos.x, 1.55, gh.pos.z).project(P.camera);
      if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 && !P.hiding && sightClear(this.lv, P.pos.x, P.pos.z, gh.pos.x, gh.pos.z)) {
        this.ghostOnScreen = true;
        if (this.time - this.director.lastSighting > 25 && gh.state !== 'chase') {
          this.audio.play('stinger', { vol: 0.8 });
          this.vibrate(80);
          P.shake = Math.max(P.shake, 0.4);
        }
        this.director.lastSighting = this.time;
      }
    }

    // 逃出大門
    if (this.lv.gate.open && P.pos.z > this.lv.gate.z + 0.7) { this.win(); return; }
    // 進入發電機房
    if (!this.seenGenerator) {
      const room = this.lv.roomAtWorld(P.pos.x, P.pos.z);
      if (room && room.type === 'generator') { this.seenGenerator = true; this.ui.subtitle('這裡就是發電機房。配電箱在牆上。', 4); this.ui.updateHud(); }
    }

    // 躲藏時她靠近：提示屏住呼吸
    if (P.hiding && gh.listening && !gh.knowsLocker) {
      if (!this.breathHinted || this.time - this.breathHinted > 10) {
        this.breathHinted = this.time;
        this.ui.hint(this.input.touchMode ? '她就在外面……按住「屏息」不要出聲。' : '她就在外面……按住 空白鍵 屏住呼吸。', 3.5);
      }
    }
    this.updateMood(dt);
    this.ui.updateTimecode(this.time);
    if (P.hiding) this.ui.updateBreath(P.breath, P.holdingBreath);
    else this.ui.updateStamina(P.stamina, P.exhausted);
    this.hudT = (this.hudT || 0) - dt;
    if (this.hudT <= 0) { this.hudT = 0.5; this.ui.updateHud(); }
    this.audio.setListener(P.camera);
  }

  // 氣氛：心跳、雜訊、追逐配樂、畫面濾鏡
  updateMood(dt) {
    const P = this.player, gh = this.ghost, A = this.audio, u = this.post.u;
    const chase = gh.state === 'chase' ? 1 : 0;
    const near = gh.state === 'dormant' ? 0 : Math.max(0, 1 - this.ghostDist / 14);
    const fear = Math.max(chase, near * 0.9, (1 - P.sanity) * 0.55, P.hiding && near > 0.2 ? 0.8 : 0);
    this.fear = (this.fear || 0) + (fear - (this.fear || 0)) * Math.min(1, dt * 2);
    A.setHeartbeat(62 + this.fear * 85, Math.max(0, this.fear - 0.2) * 0.7);
    A.setChase(chase);
    A.setMusicState(Math.max(this.fear, this.phase === 'escape' ? 0.5 : 0), chase, !!P.hiding);
    const st = gh.state === 'dormant' ? 0 : Math.max(0, 1 - this.ghostDist / 10);
    this.staticBoost = Math.max(0, this.staticBoost - dt * 1.5);
    A.setStatic(Math.min(1, st * 0.7 + this.staticBoost));
    A.setTinnitus(Math.max(0, (0.45 - P.sanity) / 0.45));
    const exhaust = P.exhausted ? 1 : Math.max(0, 0.55 - P.stamina) / 0.55;
    A.setBreathing(P.hiding ? (near > 0.2 ? 0.25 : 0.5) : exhaust, !!P.hiding);
    this.eventFlicker = Math.max(0, this.eventFlicker - dt);
    this.damage = Math.max(0, this.damage - dt * 0.4);
    const insane = 1 - P.sanity;
    u.uGrain.value = 0.055 + insane * 0.1 + st * 0.05;
    u.uAberr.value = 0.3 + insane * 1.4 + chase * 0.8 + st * 0.6;
    u.uDistort.value = Math.max(0, 0.55 - P.sanity) * 1.8;
    u.uStatic.value = Math.min(1, st * 0.45 + this.staticBoost * 0.8);
    u.uDesat.value = 0.12 + insane * 0.4;
    u.uRed.value = this.damage;
    u.uVignette.value = 0.72 + (P.hiding ? 0.2 : 0) + chase * 0.1;
    const hbPhase = (this.time * (62 + this.fear * 85) / 60) % 1;
    u.uPulse.value = Math.max(0, this.fear - 0.3) * Math.exp(-hbPhase * 6);
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 2.2);
    this.ui.damage(Math.min(0.85, this.damage));
    // 雨聲：靠近窗戶比較大聲
    this.rainT = (this.rainT || 0) - dt;
    if (this.rainT <= 0) {
      this.rainT = 0.5;
      let dmin = 99;
      for (const w of this.lv.windows) dmin = Math.min(dmin, Math.hypot(w.x - P.pos.x, w.z - P.pos.z));
      A.setRain(0.05 + Math.max(0, 1 - dmin / 9) * 0.18);
    }
  }

  // ---------------------------------------------------------------------
  updateInteraction() {
    const P = this.player;
    if (P.hiding) {
      this.target = { kind: 'exitLocker' };
      this.ui.prompt('離開鐵櫃');
      return;
    }
    if (P.hideAnim) { this.target = null; this.ui.prompt(''); return; }
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), P.camera);
    const hits = this.raycaster.intersectObjects(this.world.interactables, true);
    let target = null;
    for (const h of hits) {
      // 中間不能隔著牆
      const back = h.point.clone().addScaledVector(this.raycaster.ray.direction, -0.18);
      if (!sightClear(this.lv, P.pos.x, P.pos.z, back.x, back.z)) break;
      let o = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      const kind = o.userData.kind;
      if (kind === 'door') {
        const d = this.lv.doors[h.instanceId];
        if (d) target = { kind, door: d, label: d.target > 0.3 ? '關門' : '開門' };
      } else if (kind === 'locker') {
        const l = this.lv.lockers[h.instanceId];
        if (l) target = { kind, locker: l, label: '躲進鐵櫃' };
      } else if (kind === 'item') {
        const it = o.userData.item;
        const names = { fuse: '撿起保險絲', battery: '撿起電池', film: '撿起底片', pills: '撿起鎮定劑', note: '閱讀紙條', bottle: '撿起玻璃瓶' };
        target = { kind, item: it, label: names[it.kind] };
      } else if (kind === 'fusebox') {
        target = { kind, label: P.fuses > 0 ? '插上保險絲' : `配電箱（${this.fusesInserted}/3）` };
      } else if (kind === 'gate') {
        target = { kind, label: '大門' };
      } else if (kind === 'phone') {
        target = { kind, label: this.director.phoneRinging ? '接電話' : '電話' };
      }
      if (target) break;
    }
    this.target = target;
    this.ui.prompt(target ? target.label : '');
  }

  interact() {
    const P = this.player, A = this.audio, t = this.target;
    if (P.hideAnim) return;
    if (P.hiding) { P.exitLocker(); return; }
    if (!t) return;
    switch (t.kind) {
      case 'door': {
        const d = t.door;
        const pos = { x: d.cx, y: 1.2, z: d.cz };
        if (d.target > 0.3) {
          this.world.setDoor(d, 0, 3.2);
          this.later(() => A.play('doorClose', { pos }), 380);
          this.makeNoise(d.cx, d.cz, 5);
        } else {
          this.world.setDoor(d, 1.5, 2.6);
          A.play('doorOpen', { pos });
          this.makeNoise(d.cx, d.cz, 3.5);
        }
        break;
      }
      case 'locker':
        P.enterLocker(t.locker);
        break;
      case 'item':
        this.pickup(t.item);
        break;
      case 'fusebox':
        this.useFusebox();
        break;
      case 'gate':
        if (!this.lv.gate.open) {
          A.play('locked', { pos: { x: this.lv.gate.x, y: 1, z: this.lv.gate.z } });
          this.ui.hint('大門被鐵鍊和電子鎖鎖住了。恢復電力才能打開。', 3);
        }
        break;
      case 'phone':
        this.director.answerPhone();
        break;
    }
  }

  pickup(it) {
    const P = this.player, A = this.audio;
    this.world.removeItem(it);
    switch (it.kind) {
      case 'fuse':
        P.fuses++;
        A.play('fusePickup');
        this.ui.hint(`拿到保險絲（還要插回配電箱，已插 ${this.fusesInserted}/3）`, 3);
        break;
      case 'battery':
        P.battery = Math.min(1, P.battery + 0.55);
        A.play('battery');
        this.ui.hint('換上新電池。', 2);
        break;
      case 'film':
        P.film += 2;
        A.play('pickup');
        this.ui.hint('拿到底片 ×2（Q / 「閃」可以用閃光定住她）', 3);
        break;
      case 'bottle':
        if (P.bottles >= 3) {
          // 拿不下了：放回去
          it.taken = false;
          this.world.root.add(it.mesh);
          this.world.interactables.push(it.mesh);
          this.ui.hint('最多只能帶三個瓶子。', 2);
          return;
        }
        P.bottles++;
        A.play('pickup');
        this.ui.hint(this.input.touchMode ? '玻璃瓶：按「丟」扔出去，摔破的聲音能把她引開。' : '玻璃瓶：按 G（或滑鼠中鍵）扔出去，摔破的聲音能把她引開。', 3.5);
        break;
      case 'pills':
        P.sanity = Math.min(1, P.sanity + 0.45);
        A.play('pills');
        this.ui.hint('吞下鎮定劑，心跳慢了下來。', 2.5);
        break;
      case 'note': {
        A.play('paper');
        this.notesRead.add(it.note);
        this.ui.showNote(NOTES[it.note]);
        this.input.exitLock();
        P.locked = true;
        break;
      }
    }
    this.ui.updateHud();
  }

  // 丟玻璃瓶
  throwBottle() {
    const P = this.player;
    if (P.hiding || P.hideAnim || P.locked) return;
    if (P.bottles <= 0) { this.ui.hint('沒有可以丟的東西。', 1.5); return; }
    P.bottles--;
    const mesh = this.world.makePickupMesh('bottle');
    const cam = P.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const pos = cam.position.clone().addScaledVector(fwd, 0.35).add(new THREE.Vector3(0, -0.12, 0));
    const vel = fwd.clone().multiplyScalar(10).add(new THREE.Vector3(0, 2.4, 0));
    vel.x += P.vel.x; vel.z += P.vel.y;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, pos, vel, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 6, Math.random() * 12) });
    this.audio.play('throwWhoosh');
    this.ui.updateHud();
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 9.8 * dt;
      const nx = p.pos.x + p.vel.x * dt, ny = p.pos.y + p.vel.y * dt, nz = p.pos.z + p.vel.z * dt;
      let hit = null;
      if (!sightClear(this.lv, p.pos.x, p.pos.z, nx, nz)) hit = p.pos.clone();
      else if (ny < 0.05) hit = new THREE.Vector3(nx, 0.05, nz);
      else if (ny < 1.0 && this.collision.overlapsAny(nx, nz, 0.04)) hit = p.pos.clone();
      else if (ny > WALL_H - 0.08) { p.vel.y = -Math.abs(p.vel.y) * 0.3; }
      if (hit || p.life > 4) {
        const at = hit || p.pos;
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        this.audio.play('bottleBreak', { pos: { x: at.x, y: at.y, z: at.z } });
        this.makeNoise(at.x, at.z, 20, 'bottle');
        p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        continue;
      }
      p.life = (p.life || 0) + dt;
      p.pos.set(nx, ny, nz);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
    }
  }

  vibrate(pattern) {
    if (!this.input.touchMode || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* 不支援震動 */ }
  }

  useFusebox() {
    const P = this.player, A = this.audio, W = this.world;
    if (P.fuses <= 0) {
      this.ui.hint(`配電箱上有三個插槽，已經插上 ${this.fusesInserted} 個。`, 2.5);
      return;
    }
    const fb = W.fusebox;
    P.fuses--;
    const i = this.fusesInserted++;
    const pos = fb.getWorldPosition(new THREE.Vector3());
    A.play('fuseInsert', { pos });
    // 插槽裡出現保險絲、燈號轉綠
    const sock = fb.userData.sockets[i];
    const fuse = W.props.pickup('fuse');
    fuse.traverse((o) => { if (o.isSprite) o.visible = false; });
    fuse.rotation.z = Math.PI / 2;
    fuse.position.copy(sock.position).add(new THREE.Vector3(0.02, -0.0, 0.02));
    fb.add(fuse);
    const lamp = fb.userData.lamps[i];
    lamp.material.color.set(0x003300);
    lamp.material.emissive.set(0x30ff60);
    lamp.material.emissiveIntensity = 1.2;
    this.ghost.aggression = 1 + 0.15 * this.fusesInserted;
    this.later(() => {
      if (this.over) return;
      A.play('powerUp');
      W.setPower(this.fusesInserted);
      if (this.fusesInserted === 1) {
        this.ui.subtitle('有些燈亮了。遠處傳來一聲尖叫。', 4);
        this.later(() => {
          const s = this.ghost.findSpot(15, 30, false);
          if (s) A.play('shriek', { pos: { x: s.x, y: 1.6, z: s.z } });
        }, 2500);
      } else if (this.fusesInserted === 2) {
        this.ui.subtitle('只剩最後一個了。她越來越焦躁。', 4);
        this.director.trigger('writing');
      }
    }, 900);
    if (this.fusesInserted >= 3) this.startEscape();
    this.ui.updateHud();
  }

  startEscape() {
    const A = this.audio;
    this.phase = 'escape';
    this.later(() => {
      if (this.over) return;
      A.setAlarm(true);
      this.world.setPower(3);
      for (const f of this.lv.fixtures) if (f.on && Math.random() < 0.4) f.mode = 'flicker';
      this.ui.subtitle('全部的燈都亮了。大門的電子鎖「喀」地一聲打開——', 4);
      A.play('gateOpen', { pos: { x: this.lv.gate.x, y: 1.2, z: this.lv.gate.z } });
      this.world.openGate();
      this.collision.allowOutside = true;
      this.ghost.enraged = true;
      this.ghost.aggression = 1.5;
      this.later(() => {
        if (this.over) return;
        A.play('ghostScream', { pos: this.ghost.state === 'dormant' ? { x: this.player.pos.x + 12, y: 1.6, z: this.player.pos.z } : this.ghost.pos });
        this.ui.hint('往大門跑，不要回頭！', 4);
        if (this.ghost.state === 'dormant') this.ghost.dormantUntil = this.time + 2;
      }, 2500);
      this.ui.updateHud();
    }, 1800);
  }

  // ---------------------------------------------------------------------
  // 被抓
  onChaseStart() {
    this.stats.chases = (this.stats.chases || 0) + 1;
    this.vibrate([60, 40, 120]);
    if (this.stats.chases === 1) this.ui.hint('歌聲停了——她看到你了！跑！躲起來！', 3);
  }
  onChaseEnd() { /* 配樂由 updateMood 自動淡出 */ }

  onCaught(fromLocker) {
    const P = this.player;
    this.stats.caught++;
    this.vibrate([300, 80, 500]);
    if (P.lives > 1) {
      P.lives--;
      // 簡單模式：被抓一次會被甩開
      this.audio.play('jumpscare');
      this.damage = 1.2;
      P.knockBack();
      this.post.u.uFlash.value = 0.4;
      if (P.hiding) { P.hiding.hideDoor = false; P.hiding.dirty = true; P.hiding = null; this.ui.setHiding(false); }
      this.ghost.state = 'dormant';
      this.ghost.model.root.visible = false;
      this.ghost.dormantUntil = this.time + 15;
      this.ghost.knowsLocker = null;
      this.ghost.stopHum();
      this.ui.hint('她抓住了你……你掙脫了。下一次就沒這麼幸運。', 4);
      void fromLocker;
      return;
    }
    this.startDying(fromLocker);
  }

  startDying(fromLocker) {
    const P = this.player, gh = this.ghost;
    // 鏡頭猛然轉向她
    const targetYaw = fromLocker ? P.yaw : Math.atan2(-(gh.pos.x - P.pos.x), -(gh.pos.z - P.pos.z));
    this.dying = { t: 0, fromLocker, yaw0: P.yaw, pitch0: P.pitch, targetYaw };
    this.audio.stopAll();
    this.audio.play('jumpscare');
    P.shake = 2.5;
    if (P.hiding) {
      const l = P.hiding;
      l.hideDoor = false;
      l.target = 1.7;
      l.dirty = true;
      this.ui.setHiding(false);
    }
    this.ghost.model.revealFace(0);
    this.ui.prompt('');
    this.input.exitLock();
  }

  updateDying(dt) {
    const d = this.dying, P = this.player, m = this.ghost.model, cam = P.camera, u = this.post.u;
    d.t += dt;
    this.world.update(dt, cam, false);
    const k = Math.min(1, d.t / 0.18);
    let dy = d.targetYaw - d.yaw0;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    P.yaw = d.yaw0 + dy * k;
    P.pitch = d.pitch0 + (0.04 - d.pitch0) * k;
    // 她的臉貼到鏡頭前（臉的高度對準鏡頭）
    const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const dist = Math.max(0.4, 0.8 - d.t * 0.55);
    m.root.visible = true;
    m.root.position.set(cam.position.x + fwd.x * dist, cam.position.y - (m.faceHeight || 1.6) + Math.sin(d.t * 40) * 0.01, cam.position.z + fwd.z * dist);
    m.root.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    if (m.setLookTarget) m.setLookTarget(cam.position, 1);
    m.pose('kill', this.time, d.t * 10, 0);
    // 寫實模型：依當下的姿勢把臉對準鏡頭正前方
    if (m.faceWorld) {
      m.root.updateMatrixWorld(true);
      const face = m.faceWorld(new THREE.Vector3());
      const want = new THREE.Vector3(cam.position.x + fwd.x * (dist - 0.12), cam.position.y - 0.02, cam.position.z + fwd.z * (dist - 0.12));
      m.root.position.add(want.sub(face));
      m.root.updateMatrixWorld(true);
    }
    m.revealFace(Math.min(1, d.t * 3));
    m.setEyes(1.6);
    m.uniforms.uTime.value = this.time + d.t;
    P.shake = 2;
    P.applyCamera(dt, 0);
    P.flash.intensity = 85 * (Math.random() < 0.5 ? 1 : 0.2);
    u.uRed.value = Math.min(1, d.t * 2);
    u.uAberr.value = 3 + Math.random() * 3;
    u.uStatic.value = 0.6 + Math.random() * 0.4;
    u.uDistort.value = 1;
    u.uFade.value = Math.max(0, (d.t - 1.3) / 0.5);
    if (d.t > 1.9 && !this.over) this.lose();
  }

  lose() {
    this.over = true;
    this.post.u.uFade.value = 1;
    this.audio.stopAll();
    this.audio.setMusic('lose');
    const texts = [
      '你的直播帳號再也沒有更新過。',
      '隔天早上，警衛在走廊盡頭找到你的攝影機。最後一格畫面是一團黑色的頭髮。',
      '她低頭看著你，好像在確認你是不是她的孩子。你不是。',
    ];
    this.ui.showEnd(false, this.statRows(), texts[Math.floor(Math.random() * texts.length)]);
    this.app.onGameOver(false);
  }

  win() {
    if (this.over) return;
    this.over = true;
    this.audio.stopAll();
    this.audio.play('thunder', { near: 0.3 });
    this.audio.setMusic('win');
    this.input.exitLock();
    this.ui.prompt('');
    this.ui.fade(1, 1.6);
    const allNotes = this.notesRead.size === NOTES.length;
    const text = allNotes
      ? '你讀完了所有的紀錄。走出大門時，你聽見身後傳來孩子的笑聲，和一聲很輕的「謝謝」。她終於找到了。'
      : '你逃出了醫院。回家重看錄影時，最後一格畫面裡，她就站在你身後。';
    const best = this.app.recordBest(this.diffKey, this.time);
    const rows = [...this.statRows(), ...(best ? [['新紀錄！', fmtTime(this.time)]] : [])];
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.disposed || this.app.game !== this) return;
      this.ui.showEnd(true, rows, text);
      this.ui.fade(0, 0.8);
      this.app.onGameOver(true);
    }, 1700);
    this.timers.add(id);
  }

  // 相機閃光的那一瞬間另外渲染一張小照片（只在按快門時做一次，不影響平常的效能）
  capturePhoto() {
    const W = 256, H = 192, cam = this.player.camera, P = this.player, D = this.director, am = D.appModel;
    const L = P.photo, li = L ? L.intensity : 0;
    let trick = false;
    try {
      // 照片相機：每次都跟著主相機（位置、視角、跑步時的 FOV）
      const pc = this.photoCam || (this.photoCam = new THREE.PerspectiveCamera());
      cam.updateMatrixWorld();
      pc.fov = cam.fov; pc.near = cam.near; pc.far = cam.far; pc.aspect = W / H;
      pc.updateProjectionMatrix();
      pc.position.setFromMatrixPosition(cam.matrixWorld);
      pc.quaternion.setFromRotationMatrix(cam.matrixWorld);
      pc.updateMatrixWorld();
      // 照片裡有沒有她的臉：在 4:3 的照片框內、沒被牆擋住、而且臉朝著鏡頭
      const v = new THREE.Vector3(), f = new THREE.Vector3(), q = new THREE.Quaternion();
      const inShot = (m, x, z, yaw) => {
        if (!m || !m.root.visible) return 0;
        if (m.faceWorld) m.faceWorld(v); else v.set(x, 1.5, z);
        if (v.distanceTo(pc.position) > 14) return 0;
        if (!sightClear(this.lv, P.pos.x, P.pos.z, v.x, v.z)) return 0;
        if (m.headBone && m.faceLocal) f.copy(m.faceLocal).applyQuaternion(m.headBone.getWorldQuaternion(q));
        else f.set(Math.sin(yaw), 0, Math.cos(yaw));
        const toCam = pc.position.clone().sub(v).normalize();
        const facing = f.dot(toCam) > 0.3;
        v.project(pc);
        if (!(v.z < 1 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9)) return 0;
        return facing ? 2 : 1;
      };
      const gh = this.ghost;
      const shotHer = Math.max(gh.state !== 'dormant' ? inShot(gh.model, gh.pos.x, gh.pos.z, gh.yaw) : 0,
        D.apparition && D.apparition.visible ? inShot(am, D.apparition.position.x, D.apparition.position.z, D.apparition.rotation.y) : 0);
      // 偶爾（一局最多一次）：照片裡出現一個現場根本不存在的她（用水平方向找位置，確定臉會在照片裡才算數）
      if (!shotHer && !this.photoTrick && this.time > 90 && am && !D.apparition.visible && Math.random() < 0.18) {
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
        for (let d = 7; d >= 3.5 && !trick; d -= 0.5) {
          const x = P.pos.x + fx * d, z = P.pos.z + fz * d;
          if (!this.ghostNav.isFree(x, z) || !sightClear(this.lv, P.pos.x, P.pos.z, x, z)) continue;
          am.root.position.set(x, 0, z);
          am.root.rotation.set(0, Math.atan2(P.pos.x - x, P.pos.z - z), 0);
          am.root.visible = true;
          if (am.play) am.play('look', 0);
          if (am.setLookTarget) am.setLookTarget(pc.position, 1);
          am.revealFace(1);
          for (let k = 0; k < 4; k++) am.pose('idle', this.time + k * 0.1, 0, 0);
          am.root.updateMatrixWorld(true);
          if (inShot(am, x, z, am.root.rotation.y) === 2) trick = true;
          else { am.root.visible = false; am.revealFace(0); }
        }
      }
      // 照片的曝光：閃光強度約為遊戲畫面閃白時的 3.5%，近處清楚、遠處暗下去，臉不會過曝
      if (L) L.intensity = li * 0.035;
      const shot = this.post.snapshot(this.scene, pc, W, H);
      if (trick) {
        this.photoTrick = true;
        this.later(() => this.audio.play('stinger', { vol: 0.45 }), 900);
      }
      if (shotHer === 2) this.stats.photos++;
      const empty = ['（什麼也沒拍到）', '走廊空無一人……', '（模糊的一片）'];
      const caption = shotHer === 2 ? '……她在看著鏡頭。' : shotHer === 1 ? '……拍到了一個背影。' : trick ? '照片裡有人。可是那裡明明沒有人。' : empty[Math.floor(Math.random() * empty.length)];
      shot.then((buf) => { if (!this.disposed) this.ui.showPhoto(buf, W, H, caption); }).catch((e) => console.warn('拍照失敗', e && e.message));
    } catch (e) {
      console.warn('拍照失敗', e && e.message);
    } finally {
      // 不管成功與否都要把借用的東西還原
      if (L) L.intensity = li;
      if (trick) { am.root.visible = false; am.revealFace(0); }
    }
  }

  statRows() {
    return [
      ['難度', this.diff.label],
      ['時間', fmtTime(this.time)],
      ['保險絲', `${this.fusesInserted}/3`],
      ['讀過的紀錄', `${this.notesRead.size}/${NOTES.length}`],
      ['用閃光定住她', `${this.stats.stuns} 次`],
      ['拍到她的臉', `${this.stats.photos} 張`],
      ['躲進鐵櫃', `${this.stats.hides} 次`],
      ['被抓到', `${this.stats.caught} 次`],
    ];
  }

  // 地圖探索紀錄：進到房間就記下整個房間
  markExplored(force) {
    const P = this.player, lv = this.lv;
    const x = Math.floor(P.pos.x / CELL), y = Math.floor(P.pos.z / CELL);
    if (!lv.inBounds(x, y)) return;
    const key = x + y * lv.W;
    if (!force && key === this.lastCell) return;
    this.lastCell = key;
    const id = lv.cellAt(x, y);
    if (id > 0) {
      const r = lv.rooms[id];
      for (let yy = r.y0; yy <= r.y1; yy++) for (let xx = r.x0; xx <= r.x1; xx++) this.explored[yy * lv.W + xx] = 1;
    }
    this.explored[key] = 1;
    // 走廊：往四個方向看得到的格子
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let cx = x, cy = y;
      for (let k = 0; k < 4; k++) {
        const t = lv.edgeBetween(cx, cy, dx, dy);
        if (!(t === E.NONE || t === E.OPEN)) break;
        cx += dx; cy += dy;
        if (!lv.inBounds(cx, cy) || lv.cellAt(cx, cy) < 0) break;
        this.explored[cy * lv.W + cx] = 1;
        if (lv.cellAt(cx, cy) !== 0) break;
      }
    }
  }

  render(dt) {
    this.post.render(dt);
  }

  dispose() {
    this.over = true;
    this.disposed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.audio.stopAll();
    this.audio.occlusionFn = null;
    if (this.ui.game === this) this.ui.game = null;
    this.input.exitLock();
    // 已經從場景移除的物件也要釋放
    for (const o of this.world.removed) this.scene.add(o);
    for (const p of this.projectiles) this.scene.add(p.mesh);
    const disposeMat = (m) => {
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    };
    const mats = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
      if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
    for (const m of mats) disposeMat(m);
    for (const v of this.tf.cache.values()) for (const t of Object.values(v)) if (t && t.isTexture) t.dispose();
    if (this.world.aoTex) this.world.aoTex.dispose();
    if (this.envRT) this.envRT.dispose();
    this.ui.hidePhoto();
    this.post.dispose();
    this.renderer.renderLists.dispose();
  }
}


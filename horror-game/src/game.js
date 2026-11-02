// 一局遊戲：把關卡、世界、玩家、鬼魂、導演、聲音和後製串起來
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CELL, GHOST_R, DIFFICULTY, WALL_H } from './config.js';
import { generateHospital, NOTES, E, MAX_FLOORS, KEY_COLORS, RELICS } from './level.js';
import { Collision, NavGrid, validateLevel, sightClear, wallsBetween } from './nav.js';
import { TextureFactory } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Ghost, GhostModel } from './ghost.js';
import { RealGhostModel } from './ghost-real.js';
import { Director } from './events.js';
import { Post } from './post.js';
import { fmtTime } from './ui.js';
import { makeFallbackAvatar, SLOT_CSS } from './mp.js';
import { loadPlayerAssets, makePlayerModel } from './player-model.js';
import { THEMES, resolveTheme, themeTitle } from './themes.js';

// 分頁在背景時 requestAnimationFrame 不會觸發：改用計時器，多人時房主切到背景也能載入完
const nextFrame = () => new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => r())));

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
    // 樓層主題：'random' / 沒給 → 由 seed 決定（多人連線時每個人都會算出同一個）
    this.theme = resolveTheme(opts.theme, this.seed);
    this.themeInfo = THEMES[this.theme];
    this.floorTitle = themeTitle(this.theme);
    // 樓層數：單人預設 1 層（網址 ?floors=N 可以測試多層）；多人依難度 1～3 層
    this.floorCount = Math.max(1, Math.min(MAX_FLOORS, Math.floor(Number(opts.floors)) || 1));
    // 多人開局時的人數（2 人以上才有雙人鐵捲門）：每個人都用房主開始時給的數字生成
    this.startPlayers = opts.mp ? Math.max(1, Math.min(4, Math.floor(Number(opts.players)) || 1)) : 1;
    this.floorIdx = 0;
    this.floors = [];
    this.stairT = null;
    this.visited = new Set([0]);
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
    // 遺物與儀式：放回搖籃的遺物、儀式進行中（演出）、儀式完成（她安息了，不會再出現）
    this.relicsPlaced = new Set();
    this.ritual = null;
    this.ritualDone = false;
    this.stats = { stuns: 0, hides: 0, caught: 0, photos: 0 };
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 2.4;
    this.target = null;
    this.mapOpen = false;
    this.projectiles = [];
    this.timers = new Set();
    this.sight = (ax, az, bx, bz) => sightClear(this.lv, ax, az, bx, bz);
    // 多人連線
    this.mp = opts.mp || null;
    this.remotes = new Map(); // slot → 其他玩家
    this.mpStatus = 0; // 0 還在裡面、1 被抓走、2 逃出去了
    // 多人合作：倒地（{ t: 剩下幾秒 }）、這一局被扶起來過了沒、正在扶誰、正在轉哪一道鐵捲門的把手
    this.downed = null;
    this.reviveUsed = false;
    this.reviving = null;
    this.cranking = null;
    this.mpRevives = new Map(); // 房主：誰正在被誰扶（{ by, start, last }）
    this.mpRevived = new Set(); // 房主：這一局已經被扶起來過的人
    this.shutT = 0;
  }

  async build(progress) {
    progress(0.05, '正在畫出樓層平面圖……');
    await nextFrame();
    // 每一層：關卡、世界（three.js 群組）、碰撞、她的尋路網格、地圖探索紀錄
    const lvs = generateHospital(this.seed, this.diff, (l) => validateLevel(l), this.theme, this.floorCount, { players: this.startPlayers });
    this.floors = lvs.map((lv, i) => ({
      index: i, lv, theme: lv.theme, info: THEMES[lv.theme], title: themeTitle(lv.theme), ord: lv.plan.ord,
      explored: new Uint8Array(lv.W * lv.H), world: null, collision: null, ghostNav: null,
    }));
    this.floorCount = this.floors.length;
    for (const F of this.floors) for (const it of F.lv.items) it.floor = F.index;
    this.ground = this.floors[0];
    this.genFloor = this.floors.find((F) => F.lv.generatorRoom) || this.ground;
    this.altarFloor = this.floors.find((F) => F.lv.altar) || null;
    this.setFloor(0);
    progress(0.15, '正在弄髒牆壁……');
    await nextFrame();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(this.themeInfo.look.fog, this.themeInfo.look.fogDensity);
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
    // 只畫用得到的牆面與地板貼圖（每一層的主題都要）
    const wallTex = { paint: 'wall', tileWall: 'tileWall', wallpaper: 'wallpaper', padded: 'padded', charred: 'charredWall' };
    const floorTex = { vinyl: 'floorVinyl', lobby: 'floorVinyl', tile: 'floorTile', kidFloor: 'kidFloor', padded: 'padded', charred: 'charredFloor' };
    const looks = this.floors.map((F) => F.info.look);
    for (const k of new Set(looks.flatMap((l) => Object.values(l.wall)))) this.tf[wallTex[k]]();
    progress(0.22, '正在鋪地磚……'); await nextFrame();
    for (const k of new Set(looks.flatMap((l) => Object.values(l.floor)))) this.tf[floorTex[k]]();
    progress(0.28, '正在掛上天花板……'); await nextFrame();
    this.tf.ceiling(); this.tf.door(); this.tf.lockerDoor(); progress(0.33, '正在搬進病床……'); await nextFrame();
    this.tf.paintedMetal(); this.tf.steel(); this.tf.fabric(); this.tf.wood(); this.tf.grime(); progress(0.38, '正在灑上血跡……'); await nextFrame();
    const corpses = await corpseP;
    const n = this.floorCount, G = this.ground, GF = this.genFloor;
    const boardNote = n > 1 && GF !== G ? `發電機房在 ${GF.title}（走樓梯${GF.ord > G.ord ? '上樓' : '下樓'}）` : '';
    for (const F of this.floors) {
      const k = F.index;
      progress(0.4 + 0.3 * (k / n), n > 1 ? `正在佈置 ${F.title}……（${k + 1}/${n}）` : '正在灑上血跡……');
      await nextFrame();
      const W = new World(this.renderer, this.scene, F.lv, this.tf, this.quality, { floorIndex: k, boardNote: k === 0 ? boardNote : '' });
      W.corpses = corpses;
      W.build();
      const C = new Collision(F.lv);
      for (const d of F.lv.doors) C.dynamic.push(d);
      // 鐵捲門：拉到八成以上才過得去
      for (const sh of F.lv.shutters || []) C.dynamic.push({ getBox: () => (sh.open < 0.8 ? sh.box : null) });
      if (F.lv.gate) C.dynamic.push(F.lv.gate);
      for (const f of W.dynamicProps) {
        C.removeStaticFurniture(f);
        C.dynamic.push({ getBox: () => f.box });
      }
      W.propBlocked = (x, z) => C.overlapsStatic(x, z, 0.4) || C.dynamic.some((d) => { const b = d.getBox ? d.getBox() : null; return b && x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4 && !W.dynamicProps.some((f) => f.box === b); });
      F.world = W;
      F.collision = C;
      F.ghostNav = new NavGrid(F.lv, GHOST_R, { ghost: true });
    }
    progress(0.7, '她正在醒來……');
    await nextFrame();
    this.setFloor(0);
    this.player = new Player(this);
    if (this.mp) {
      progress(0.71, '正在接上其他玩家……');
      this.playerAssets = await loadPlayerAssets(this.renderer, this.quality, 20000);
      this.mpSetup();
    }
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
    if (this.mp) this.mp.attach(this);
  }

  // =====================================================================
  // 多層樓：切換「目前這一層」。this.lv / world / collision / ghostNav 永遠指向玩家（或觀戰對象）所在的樓層，
  // 只有這一層的 World 會被畫出來
  setFloor(i) {
    const F = this.floors[i];
    if (!F) return;
    this.floorIdx = i;
    this.F = F;
    this.lv = F.lv;
    this.world = F.world;
    this.collision = F.collision;
    this.ghostNav = F.ghostNav;
    this.explored = F.explored;
    this.themeInfo = F.info;
    this.floorTitle = F.title;
    for (const o of this.floors) if (o.world) o.world.root.visible = o === F;
    if (this.scene && this.scene.fog) { this.scene.fog.color.set(F.info.look.fog); this.scene.fog.density = F.info.look.fogDensity; }
    if (this.player) this.player.floor = i;
    if (F.world) F.world.poolTimer = 0;
    this.lastCell = -1;
    this.visited.add(i);
    if (this.ui.game === this) this.ui.setFloor(F.title);
  }

  // 走樓梯：畫面很快地暗下來、樓梯上的腳步聲、換到另一層對應的樓梯口、再亮起來（不到一秒）
  useStairs(s) {
    const P = this.player;
    if (this.stairT || !s || P.hiding || P.hideAnim || this.dying || !this.floors[s.to]) return;
    this.stairT = { t: 0, s, steps: 0, done: false };
    P.locked = true;
    P.vel.set(0, 0);
    this.target = null;
    this.ui.prompt('');
    this.ui.fade(1, 0.25);
    this.makeNoise(s.use.x, s.use.z, 7, 'stairs');
  }
  updateStairs(dt) {
    const st = this.stairT, P = this.player;
    st.t += dt;
    while (st.steps < 5 && st.t >= 0.03 + st.steps * 0.13) { st.steps++; this.audio.play('footstep', { surface: 'tile' }); }
    if (!st.done && st.t >= 0.3) {
      st.done = true;
      this.arriveFloor(st.s);
      this.ui.fade(0, 0.4);
    }
    if (st.t >= 0.72) {
      this.stairT = null;
      if (!this.ui.noteOpen) P.locked = false;
    }
  }
  arriveFloor(s) {
    const from = this.floorIdx, P = this.player, dest = this.floors[s.to];
    const back = dest.lv.stairs.find((x) => x.to === from) || dest.lv.stairs[0];
    this.setFloor(s.to);
    P.pos.x = back.arrive.x; P.pos.z = back.arrive.z;
    P.yaw = back.arrive.yaw; P.pitch = 0;
    P.vel.set(0, 0);
    P.applyCamera(0, 0);
    // 上一層留下的東西：飛到一半的瓶子、幻影、電話鈴
    for (const p of this.projectiles) { this.scene.remove(p.mesh); p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.projectiles.length = 0;
    this.director.vanishApparition(false);
    if (this.director.phoneRinging) { this.director.phoneRinging = false; this.audio.stopPhone(); }
    this.buzzFix = null; this.buzzT = 0; this.rainT = 0;
    this.audio.setBuzz(null, 0);
    this.markExplored(true);
    if (this.mapOpen) this.ui.drawMap();
    this.ui.subtitle(`— ${dest.title} —`, 2.5);
    this.ui.updateHud();
    if (this.mp) this.mp.sendT = 0; // 馬上告訴其他人換樓層了
  }
  // 玩家所在的樓層完整更新；其他樓層只跑門與鐵櫃的動畫
  updateWorlds(dt, cam, flashOn) {
    this.world.update(dt, cam, flashOn);
    for (const F of this.floors) if (F !== this.F) F.world.updateMechanics(dt);
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
    this.ui.showDowned(false);
    this.ui.setHold(0);
    this.audio.startAmbience();
    this.audio.setRain(0.1);
    this.audio.setMusic('explore');
    this.ui.updateHud();
    this.ui.subtitle(`— ${this.floorTitle} —`, 1.3);
    // 開場：身後的大門砰一聲關上
    this.later(() => {
      if (this.over) return;
      this.audio.play('doorSlam', { pos: { x: this.ground.lv.gate.x, y: 1.2, z: this.ground.lv.gate.z } });
      this.audio.play('metalClank', { pos: { x: this.ground.lv.gate.x, y: 1, z: this.ground.lv.gate.z } });
      this.player.shake = 0.8;
      this.ui.subtitle('（大門在身後鎖上了）', 3.5);
    }, 1400);
    this.later(() => {
      if (this.over) return;
      this.ui.hint(this.input.touchMode ? '左邊拖曳移動，右邊滑動看四周。看到東西時按「互動」。' : 'WASD 移動・滑鼠看四周・E 互動・F 手電筒・Q 相機閃光・P 暫停', 6);
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

  // 噪音：會吸引她（只有同一層聽得到）
  makeNoise(x, z, radius, kind = '', floor = this.floorIdx) {
    if (radius <= 0 || !this.ghost) return;
    if (this.mp && !this.mp.isHost) { this.mp.send({ t: 'noise', f: floor, x: +x.toFixed(2), z: +z.toFixed(2), r: radius, k: kind }); return; }
    this.ghost.hearNoise(x, z, radius, kind, floor);
  }

  // ---------------------------------------------------------------------
  update(dt, inp) {
    if (this.over) return;
    this.time += dt;
    const P = this.player;
    this.inputMoveX = inp.mx;
    if (this.dying) { this.updateDying(dt); if (this.mp) { this.mpUpdateRemotes(dt); this.mp.tick(dt); } return; }
    if (this.mp && this.mpStatus !== 0) { this.updateSpectator(dt, inp); return; }

    // 動作
    inp.crouchToggle = false;
    for (const a of inp.actions) {
      if (this.ui.noteOpen) {
        if (a === 'interact' || a === 'tap' || a === 'confirm' || a === 'pause') { this.ui.closeNote(); P.locked = false; this.input.requestLock(); }
        continue;
      }
      switch (a) {
        case 'interact': case 'tap': if (!this.stairT && !this.downed) this.interact(); break;
        case 'flashlight': P.toggleFlash(); break;
        case 'camera': if (!this.downed) P.takePhoto(); break;
        case 'throw': if (!this.downed) this.throwBottle(); break;
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
    // 多人合作：倒地倒數、按住互動（轉鐵捲門的把手、扶起隊友）；轉把手的時候站著不動
    if (this.downed) this.updateDowned(dt);
    if (this.mp) this.updateHolds(dt, inp);
    if (this.cranking) { inp.mx = 0; inp.my = 0; inp.sprint = false; }

    P.update(dt, inp);
    if (this.stairT) this.updateStairs(dt);
    this.updateProjectiles(dt);
    this.ghost.update(dt);
    if (this.over || this.dying) return;
    this.director.update(dt);
    this.updateWorlds(dt, P.camera, P.flashOn && P.battery > 0 && !P.hiding);
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
    if (this.mp) { this.mpUpdateRemotes(dt); if (this.mp.isHost) this.mpHostCoop(dt); this.mp.tick(dt); }
    this.markExplored(false);
    if (this.mapOpen && Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.ui.drawMap();

    // 她在畫面上嗎？（在別層就當作很遠）
    const gh = this.ghost;
    this.ghostDist = gh.state === 'dormant' || gh.floor !== this.floorIdx ? 99 : Math.hypot(gh.pos.x - P.pos.x, gh.pos.z - P.pos.z);
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

    // 逃出大門（大門在第 0 層）
    const gate = this.ground.lv.gate;
    if (this.floorIdx === 0 && gate.open && !this.downed && P.pos.z > gate.z + 0.7) { if (this.mp) this.mpEscaped(); else this.win(); return; }
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
    if (this.ritual) this.updateRitual(dt);
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
    const chase = gh.state === 'chase' && gh.floor === this.floorIdx ? 1 : 0;
    const near = gh.state === 'dormant' ? 0 : Math.max(0, 1 - this.ghostDist / 14);
    const fear = Math.max(chase, near * 0.9, (1 - P.sanity) * 0.55, P.hiding && near > 0.2 ? 0.8 : 0, this.downed ? 0.95 : 0);
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
    u.uRed.value = this.downed ? Math.max(this.damage, 0.62 + 0.08 * Math.sin(this.time * 2.4)) : this.damage;
    u.uVignette.value = 0.72 + (P.hiding ? 0.2 : 0) + chase * 0.1 + (this.downed ? 0.35 : 0);
    if (this.downed) u.uDesat.value = Math.max(u.uDesat.value, 0.55);
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
    if (P.hideAnim || this.stairT || this.downed) { this.target = null; this.ui.prompt(''); return; }
    // 正在轉把手：提示不跟著視線跑
    if (this.cranking) {
      this.target = { kind: 'crank', shutter: this.cranking.s, label: '轉動把手中……一放手鐵捲門就會摔下來' };
      this.ui.prompt(this.target.label);
      return;
    }
    // 倒地的隊友（多人）：站在旁邊就能扶
    const down = this.mp ? this.mpDownedNear() : null;
    if (down) {
      this.target = { kind: 'revive', slot: down.slot, label: `按住扶起 ${this.mp.slotName(down.slot)}` };
      this.ui.prompt(this.target.label);
      return;
    }
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
        if (d && d.lock >= 0 && !d.unlocked) {
          const name = KEY_COLORS[d.lock].name;
          target = { kind: 'locked', door: d, label: P.keys.includes(d.lock) ? `刷${name}門禁卡` : `上鎖了（需要${name}門禁卡）` };
        } else if (d) target = { kind, door: d, label: d.target > 0.3 ? '關門' : '開門' };
      } else if (kind === 'locker') {
        const l = this.lv.lockers[h.instanceId];
        if (l) target = { kind, locker: l, label: '躲進鐵櫃' };
      } else if (kind === 'item') {
        const it = o.userData.item;
        const names = { fuse: '撿起保險絲', battery: '撿起電池', film: '撿起底片', pills: '撿起鎮定劑', note: '閱讀紙條', bottle: '撿起玻璃瓶' };
        const label = it.kind === 'keycard' ? `撿起${KEY_COLORS[it.color].name}門禁卡` : it.kind === 'relic' ? `撿起${RELICS[it.relic].name}` : names[it.kind];
        target = { kind, item: it, label };
      } else if (kind === 'crank') {
        const sh = o.userData.shutter;
        if (sh) target = { kind, shutter: sh, label: sh.jammed ? '鐵捲門的鍊條卡住了（一直開著）' : '按住轉動把手，拉起鐵捲門' };
      } else if (kind === 'altar') {
        const n = this.relicsPlaced.size;
        target = { kind, label: P.relics.length ? `把遺物放進搖籃（${n}/3）` : n >= 3 ? '搖籃' : `搖籃（遺物 ${n}/3）` };
      } else if (kind === 'fusebox') {
        target = { kind, label: P.fuses > 0 ? '插上保險絲' : `配電箱（${this.fusesInserted}/3）` };
      } else if (kind === 'gate') {
        target = { kind, label: '大門' };
      } else if (kind === 'phone') {
        target = { kind, label: this.director.phoneRinging ? '接電話' : '電話' };
      } else if (kind === 'stairs') {
        const st = o.userData.stair, to = st && this.floors[st.to];
        if (to) target = { kind, stair: st, label: `${st.dir === 'up' ? '上樓' : '下樓'}：${to.title}` };
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
      case 'locked': {
        const d = t.door, F = this.F;
        if (P.keys.includes(d.lock)) {
          if (this.mp && !this.mp.isHost) { this.mp.send({ t: 'unlock', f: F.index, i: d.id }); break; }
          if (this.mp) { this.mpHostUnlock(F.index, d.id, this.mp.mySlot); break; }
          this.applyUnlock(F, d, -1);
        } else {
          A.play('doorRattle', { pos: d.readerPos ? { x: d.readerPos.x, y: 1.1, z: d.readerPos.z } : { x: d.cx, y: 1.1, z: d.cz } });
          this.makeNoise(d.cx, d.cz, 3);
          this.ui.hint(`上鎖了（需要${KEY_COLORS[d.lock].name}門禁卡）`, 2.5);
        }
        break;
      }
      case 'locker':
        P.enterLocker(t.locker);
        break;
      case 'item':
        if (this.mp && t.item.kind !== 'note') this.mpRequestPick(t.item);
        else this.pickup(t.item);
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
      case 'stairs':
        this.useStairs(t.stair);
        break;
      case 'altar':
        this.useAltar();
        break;
      case 'crank':
        // 按住才有用（updateHolds）；只按一下的話提醒一下
        if (t.shutter.jammed) this.ui.hint('鍊條卡死了，鐵捲門停在打開的位置。', 2.5);
        else if (!this.cranking) this.ui.hint('要一直按住才拉得起來。一放手，鐵捲門就會整片摔下來——需要有人幫你顧著。', 4);
        break;
      case 'revive':
        break;
    }
  }

  pickup(it) {
    const P = this.player, A = this.audio;
    const W = (this.floors[it.floor] || this.F).world;
    W.removeItem(it);
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
      case 'film': {
        const n = it.n === 3 ? 3 : 2;
        P.film += n;
        A.play('pickup');
        this.ui.hint(`拿到底片 ×${n}（Q / 「閃」可以用閃光定住她）`, 3);
        break;
      }
      case 'relic': {
        if (!P.relics.includes(it.relic)) P.relics.push(it.relic);
        A.play('paper');
        const R = RELICS[it.relic], AF = this.altarFloor, room = AF && AF.lv.room707;
        const where = room ? `${this.floorCount > 1 ? AF.title + '的' : ''}${room.label}` : '劇情房間';
        this.ui.showNote({ title: R.title, body: `${R.body}

（搖籃在${where}。）` });
        this.input.exitLock();
        P.locked = true;
        break;
      }
      case 'keycard': {
        P.keys.push(it.color);
        A.play('pickup');
        const DF = this.floors.find((F) => F.lv.doors.some((d) => d.lock === it.color));
        const where = DF && this.floorCount > 1 && DF !== this.F ? `（門在${DF.title}）` : '';
        this.ui.hint(`拿到${KEY_COLORS[it.color].name}門禁卡。找到同顏色的門，刷卡開鎖${where}。`, 3.5);
        break;
      }
      case 'bottle':
        if (P.bottles >= 3) {
          // 拿不下了：放回去
          it.taken = false;
          W.root.add(it.mesh);
          W.interactables.push(it.mesh);
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
        const note = NOTES[it.note];
        // 多層樓：維修工的紙條寫的是發電機房在哪一層
        if (it.note === 1 && this.floorCount > 1) this.ui.showNote({ ...note, body: note.body.replace('發電機房在這層樓最裡面', `發電機房在${this.genFloor.info.board}最裡面`) });
        else this.ui.showNote(note);
        this.input.exitLock();
        P.locked = true;
        break;
      }
    }
    this.ui.updateHud();
  }

  // 刷卡開鎖（多人時由房主確認後大家一起套用）：讀卡機轉綠、門自己彈開一點，卡片用掉
  applyUnlock(F, d, by) {
    if (!d || d.unlocked) return;
    F.world.unlockDoor(d);
    const P = this.player, mine = !this.mp || by === this.mp.mySlot;
    if (mine) { const k = P.keys.indexOf(d.lock); if (k >= 0) P.keys.splice(k, 1); }
    if (F === this.F) this.audio.play('cardBeep', { pos: d.readerPos ? { x: d.readerPos.x, y: 1.25, z: d.readerPos.z } : { x: d.cx, y: 1.2, z: d.cz } });
    this.mpApplying = true;
    F.world.setDoor(d, 0.35, 1.2);
    this.mpApplying = false;
    const room = F.lv.rooms.find((r) => r.locked === d.lock);
    const name = room ? room.label : '房間';
    if (mine) this.ui.hint(`${KEY_COLORS[d.lock].name}門禁卡刷過了，${name}的門開了。`, 3);
    else if (this.mp) this.ui.hint(`${this.mp.slotName(by)} 打開了${F.title && this.floorCount > 1 ? F.title + '的' : ''}${name}。`, 3);
    this.ui.updateHud();
  }

  // 她的憤怒：每插一個保險絲、每放回一件遺物都更快更敏銳；大門打開後至少 1.5
  updateAggression() {
    const a = 1 + 0.15 * this.fusesInserted + 0.12 * this.relicsPlaced.size;
    this.ghost.aggression = this.phase === 'escape' ? Math.max(1.5, a) : a;
  }

  // 對著搖籃：把身上的遺物全部放回去
  useAltar() {
    const P = this.player;
    if (!P.relics.length) {
      this.ui.hint(this.relicsPlaced.size >= 3 ? '搖籃裡放著三件遺物。' : '搖籃是空的。桌上的小卡片寫著「給我的寶寶」……好像少了什麼。', 3);
      return;
    }
    for (const r of P.relics.slice()) {
      if (this.mp && !this.mp.isHost) this.mp.send({ t: 'relic', r });
      else if (this.mp) this.mpHostRelic(r, this.mp.mySlot);
      else this.applyRelic(r, -1);
    }
  }
  // 一件遺物放回搖籃（多人時房主確認後大家一起套用）：她更生氣——尖叫、燈閃、更快
  applyRelic(r, by) {
    if (!Number.isInteger(r) || r < 0 || r > 2 || this.relicsPlaced.has(r)) return;
    const AF = this.altarFloor;
    if (!AF) return;
    this.relicsPlaced.add(r);
    const P = this.player, A = this.audio, mine = !this.mp || by === this.mp.mySlot;
    if (mine) { const k = P.relics.indexOf(r); if (k >= 0) P.relics.splice(k, 1); }
    AF.world.placeRelic(r);
    const a = AF.lv.altar, here = this.F === AF;
    if (here) A.play('relicPlace', { pos: { x: a.x, y: 0.7, z: a.z } });
    this.updateAggression();
    const gh = this.ghost, n = this.relicsPlaced.size;
    if (n < 3) {
      AF.world.flickerArea(a.x, a.z, 40, 2.2);
      if (!here) this.world.flickerArea(P.pos.x, P.pos.z, 30, 2.2);
      this.later(() => {
        const far = { x: P.pos.x + 10, y: 1.6, z: P.pos.z - 6 };
        A.play('ghostScream', { pos: gh.state !== 'dormant' && gh.floor === this.floorIdx ? gh.pos : far });
      }, 700);
      // 她聽得到：醒著的話會往搖籃那邊找過來（多人時由房主決定）
      if ((!this.mp || this.mp.isHost) && !gh.banished && gh.state !== 'dormant') gh.hearNoise(a.x, a.z, 60, 'relic', AF.index);
      const who = this.mp && !mine ? `${this.mp.slotName(by)} 把${RELICS[r].name}放回了搖籃。` : '';
      this.ui.subtitle(who + (n === 1 ? '燈閃了一下。遠處傳來一聲尖叫——她知道了。' : '她的尖叫越來越近。只差最後一件。'), 4);
    }
    this.ui.updateHud();
    if (n >= 3) this.startRitual();
  }
  // 三件遺物都回到搖籃：音樂盒、低語、她出現在搖籃旁、柔光……然後她就不見了（這一局不會再出現）
  startRitual() {
    if (this.ritual || this.ritualDone) return;
    const AF = this.altarFloor, a = AF.lv.altar, gh = this.ghost, A = this.audio;
    this.ritual = { t: 0, step: 0 };
    this.ritualStarted = true;
    gh.banish();
    A.setChase(0);
    const here = this.F === AF;
    A.play('musicBox', here ? { pos: { x: a.x, y: 0.8, z: a.z }, dur: 9 } : { dur: 9 });
    this.ui.subtitle(here ? '三件遺物都回到了搖籃裡。音樂盒自己轉了起來……' : `三件遺物都回到了${AF.title}的搖籃裡。遠處傳來音樂盒的聲音……`, 5);
    for (const F of this.floors) F.world.flickerArea(this.player.pos.x, this.player.pos.z, 60, 1.5);
  }
  updateRitual(dt) {
    const R = this.ritual, AF = this.altarFloor, a = AF.lv.altar, W = AF.world, D = this.director, am = D.appModel;
    R.t += dt;
    const here = this.F === AF;
    // 柔光：慢慢亮起、最後慢慢熄滅
    const glow = R.t < 2 ? R.t / 2 : R.t < 8.5 ? 1 : Math.max(0, 1 - (R.t - 8.5) / 2);
    W.setAltarGlow(glow * (0.55 + 0.08 * Math.sin(R.t * 3)));
    const fx = Math.sin(a.rot), fz = Math.cos(a.rot);
    if (R.step === 0 && R.t > 1.6) {
      R.step = 1;
      // 她出現在搖籃前，低頭看著搖籃
      if (here && am) {
        const x = a.x + fx * 0.72, z = a.z + fz * 0.72;
        D.vanishApparition(false);
        am.root.position.set(x, 0, z);
        am.root.rotation.set(0, Math.atan2(a.x - x, a.z - z), 0);
        am.root.visible = true;
        if (am.play) am.play('look', 0);
        am.revealFace(0.15);
      }
      this.audio.play('whisper', here ? { pos: { x: a.x, y: 1.4, z: a.z } } : {});
    }
    if (R.step === 1 && here && am && am.root.visible) {
      if (am.setLookTarget) am.setLookTarget(this.ritualLook || (this.ritualLook = new THREE.Vector3(a.x, 0.7, a.z)), 1);
      am.pose('idle', this.time, 0, 0);
    }
    if (R.step === 1 && R.t > 4.5) {
      R.step = 2;
      this.ui.subtitle(here ? '她低頭看著搖籃，很輕很輕地，跟著音樂盒哼了最後一次。' : '那首搖籃曲很輕地響了最後一次。', 5);
    }
    if (R.step === 2 && R.t > 8.5) {
      R.step = 3;
      if (am && am.root.visible) { am.root.visible = false; am.revealFace(0); this.staticBoost = 0.6; this.audio.play('static', { dur: 0.6 }); }
    }
    if (R.t > 10.5) {
      W.setAltarGlow(0);
      this.ritual = null;
      this.ritualDone = true;
      this.ui.subtitle(this.phase === 'escape' ? '她不見了。大門開著——走出去吧。' : '她不見了。歌聲再也沒有響起。插上保險絲，打開大門離開這裡吧。', 6);
      this.ui.updateHud();
    }
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
        if (this.mp) this.mp.send({ t: 'sfx', f: this.floorIdx, n: 'bottleBreak', x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) });
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
    P.fuses--;
    if (this.mp) {
      if (this.mp.isHost) this.mpHostFuse(this.mp.mySlot);
      else this.mp.send({ t: 'fuse' });
      this.ui.updateHud();
      return;
    }
    this.applyFuse(this.fusesInserted++);
  }

  // 插上第 i 個保險絲（多人時由房主決定順序，大家一起套用）
  applyFuse(i) {
    const A = this.audio, W = this.genFloor.world;
    const fb = W.fusebox;
    const pos = fb.getWorldPosition(new THREE.Vector3());
    if (this.floorIdx === this.genFloor.index) A.play('fuseInsert', { pos });
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
    this.updateAggression();
    this.later(() => {
      if (this.over) return;
      A.play('powerUp');
      for (const F of this.floors) F.world.setPower(this.fusesInserted);
      if (this.fusesInserted === 1) {
        this.ui.subtitle('有些燈亮了。遠處傳來一聲尖叫。', 4);
        this.later(() => {
          const s = this.ghost.findSpot(15, 30, false);
          if (s) A.play('shriek', { pos: { x: s.x, y: 1.6, z: s.z } });
        }, 2500);
      } else if (this.fusesInserted === 2) {
        this.ui.subtitle('只剩最後一個了。她越來越焦躁。', 4);
        if (!this.mp || this.mp.isHost) this.director.trigger('writing');
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
      const G = this.ground, gate = G.lv.gate;
      for (const F of this.floors) {
        F.world.setPower(3);
        for (const f of F.lv.fixtures) if (f.on && Math.random() < 0.4) f.mode = 'flicker';
      }
      this.ui.subtitle(this.floorIdx === 0 ? '全部的燈都亮了。大門的電子鎖「喀」地一聲打開——' : `全部的燈都亮了。${G.title}的大門電子鎖「喀」地一聲打開——`, 4);
      if (this.floorIdx === 0) A.play('gateOpen', { pos: { x: gate.x, y: 1.2, z: gate.z } });
      G.world.openGate();
      G.collision.allowOutside = true;
      this.ghost.enraged = !this.ghost.banished;
      this.updateAggression();
      this.later(() => {
        if (this.over) return;
        const gh = this.ghost;
        if (gh.banished) { this.ui.hint(this.floorIdx === 0 ? '大門開了。這一次，沒有人追你。' : `大門開了。回到 ${G.title}，走出去吧。`, 4); return; }
        A.play('ghostScream', { pos: gh.state === 'dormant' || gh.floor !== this.floorIdx ? { x: this.player.pos.x + 12, y: 1.6, z: this.player.pos.z } : gh.pos });
        this.ui.hint(this.floorIdx === 0 ? '往大門跑，不要回頭！' : `回到 ${G.title}，往大門跑，不要回頭！`, 4);
        if (this.ghost.state === 'dormant' && !this.ghost.banished) this.ghost.dormantUntil = this.time + 2;
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

  onCaught(fromLocker, who) {
    const P = this.player;
    if (this.ghost && this.ghost.banished) return;
    // 房主的女鬼抓到別人：通知那個人，她過一下就消失
    if (this.mp && who && who !== P) {
      this.mp.send({ t: 'caught', s: who.slot, lk: fromLocker ? 1 : 0 });
      who.caughtAt = this.time;
      this.mpGhostRetreat(1.6);
      return;
    }
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
      if (!this.mp || this.mp.isHost) {
        this.ghost.state = 'dormant';
        this.ghost.model.root.visible = false;
        this.ghost.dormantUntil = this.time + 15;
        this.ghost.knowsLocker = null;
        this.ghost.stopHum();
      }
      this.ui.hint('她抓住了你……你掙脫了。下一次就沒這麼幸運。', 4);
      void fromLocker;
      return;
    }
    // 多人：還有站著的隊友、這一局還沒被扶過 → 先倒地 30 秒，等人來扶
    if (this.mp && !this.reviveUsed && this.mpTeammateUp()) { this.startDowned(); return; }
    this.startDying(fromLocker);
  }

  // =====================================================================
  // 多人合作：倒地與扶起
  mpTeammateUp() { return [...this.remotes.values()].some((r) => r.a === 0 && r.got && !r.downed && !r.dying); }
  startDowned() {
    const P = this.player;
    this.downed = { t: 30 };
    P.downed = true;
    P.crouching = false;
    this.cranking = null;
    this.reviving = null;
    // 正在鑽進鐵櫃的途中被抓：取消動畫，停在櫃子外面
    if (P.hideAnim) {
      const l = P.hideAnim.locker;
      P.hideAnim = null;
      if (l) { l.target = 0; l.dirty = true; P.pos.x = l.exitX; P.pos.z = l.exitZ; }
    }
    if (P.hiding) {
      const l = P.hiding;
      l.hideDoor = false; l.target = 1.2; l.dirty = true;
      P.hiding = null;
      P.pos.x = l.exitX; P.pos.z = l.exitZ;
      this.ui.setHiding(false);
      this.later(() => { l.target = 0; }, 900);
    }
    this.audio.play('jumpscare');
    this.vibrate([300, 80, 300]);
    this.damage = 1.2;
    P.shake = 1.6;
    this.post.u.uFlash.value = 0.3;
    this.ui.showDowned(true, 30);
    this.ui.hint(this.input.touchMode ? '你倒下了……等隊友站到你旁邊按住「互動」扶你起來。' : '你倒下了……等隊友站到你旁邊按住 E 扶你起來。', 5);
    if (this.mp.isHost) this.mpGhostRetreat(0.4);
    this.mp.sendT = 0;
  }
  updateDowned(dt) {
    const D = this.downed;
    // 她已經安息了：沒有人會再被帶走，自己站起來
    if (this.ghost.banished) { this.mpSelfRevive(); return; }
    D.t -= dt;
    this.ui.showDowned(true, Math.max(0, D.t));
    // 由房主決定什麼時候被帶走（'taken'）；自己這邊的計時只是房主沒回應時的保險
    if (D.t <= -4 || (this.mp.isHost && D.t <= 0)) this.mpTakeDowned();
  }
  // 倒地的人被帶走（30 秒沒人扶、或所有人都倒了）：照原本被抓的流程播完再觀戰
  mpTakeDowned() {
    if (!this.downed) return;
    this.downed = null;
    this.player.downed = false;
    this.ui.showDowned(false);
    this.startDying(true);
  }
  mpSelfRevive() {
    const P = this.player;
    this.downed = null;
    P.downed = false;
    this.damage = 0;
    this.ui.showDowned(false);
    this.ui.hint('她不見了……你撐著牆站了起來。', 4);
    this.mp.sendT = 0;
  }
  mpApplyRevived(s, by) {
    if (!Number.isInteger(s) || !Number.isInteger(by)) return;
    if (this.mp.isHost) this.mpRevived.add(s);
    const P = this.player;
    if (s === this.mp.mySlot) {
      if (!this.downed) return;
      this.downed = null;
      this.reviveUsed = true;
      P.downed = false;
      P.sanity = Math.min(P.sanity, 0.25);
      this.damage = 0;
      this.ui.showDowned(false);
      this.audio.play('gasp');
      this.ui.hint(`${this.mp.slotName(by)} 把你扶了起來。下一次就沒有人救得了你了。`, 4);
      this.mp.sendT = 0;
      return;
    }
    const r = this.remotes.get(s);
    if (r) { r.downed = false; r.revivedAt = this.time; }
    if (by === this.mp.mySlot) { this.reviving = null; this.ui.setHold(0); this.ui.hint(`你把 ${this.mp.slotName(s)} 扶起來了。`, 3); }
    else this.ui.subtitle(`${this.mp.slotName(by)} 把 ${this.mp.slotName(s)} 扶起來了。`, 3);
  }
  // 身邊倒地的隊友（同一層、1.45 公尺內，房主那邊用 1.6 公尺核對）
  mpDownedNear() {
    const P = this.player;
    let best = null, bd = 1.45;
    for (const r of this.remotes.values()) {
      if (!r.downed || r.a !== 0 || r.floor !== this.floorIdx) continue;
      const d = Math.hypot(r.pos.x - P.pos.x, r.pos.z - P.pos.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  // 按住互動：轉把手（鐵捲門）、扶人（每 0.2 秒告訴房主一次「我還在扶」）
  updateHolds(dt, inp) {
    const P = this.player, hold = !!inp.interactHold && this.mpStatus === 0 && !this.dying && !this.downed;
    if (this.cranking) {
      const c = this.cranking.s.crank;
      if (!hold || P.hiding || this.cranking.f !== this.floorIdx || this.cranking.s.jammed || Math.hypot(P.pos.x - c.useX, P.pos.z - c.useZ) > 1.6) this.cranking = null;
    } else if (hold && this.target && this.target.kind === 'crank' && !this.target.shutter.jammed) {
      this.cranking = { s: this.target.shutter, f: this.floorIdx };
      this.mp.sendT = 0;
    }
    if (this.cranking) {
      this.crankT = (this.crankT || 0) - dt;
      if (this.crankT <= 0) { this.crankT = 0.17; const c = this.cranking.s.crank; this.audio.play('crankTick', { pos: { x: c.x, y: 1.1, z: c.z } }); }
    }
    // 扶人用真實時間計時（網路上的訊息與房主的核對也是真實時間；多人時遊戲不會暫停）
    if (hold && this.target && this.target.kind === 'revive') {
      const now = performance.now();
      if (!this.reviving || this.reviving.slot !== this.target.slot) this.reviving = { slot: this.target.slot, start: now, next: 0 };
      const rv = this.reviving;
      rv.t = (now - rv.start) / 1000;
      if (now >= rv.next) {
        rv.next = now + 200;
        if (this.mp.isHost) this.mpHostRevive(rv.slot, this.mp.mySlot);
        else this.mp.send({ t: 'rv', s: rv.slot });
      }
      this.ui.setHold(Math.min(1, rv.t / 3));
    } else if (this.reviving) { this.reviving = null; this.ui.setHold(0); }
  }
  // 房主：有人說「我在扶某某」→ 核對兩個人都在、同一層、距離 1.6 公尺內，連續扶滿 3 秒才算數
  mpHostRevive(target, by) {
    if (!Number.isInteger(target) || target === by || this.mpRevived.has(target)) return;
    const helper = this.mpActor(by);
    if (!helper) return;
    let tx, tz, tf;
    if (target === this.mp.mySlot) {
      if (this.mpStatus !== 0 || !this.downed) return;
      tx = this.player.pos.x; tz = this.player.pos.z; tf = this.floorIdx;
    } else {
      const r = this.remotes.get(target);
      if (!r || r.a !== 0 || !r.downed) return;
      tx = r.tx; tz = r.tz; tf = r.floor;
    }
    if (tf !== helper.floor || Math.hypot(tx - helper.x, tz - helper.z) > 1.6) return;
    const now = performance.now() / 1000;
    let rec = this.mpRevives.get(target);
    if (!rec || rec.by !== by || now - rec.last > 0.6) rec = { by, start: now, last: now };
    rec.last = now;
    this.mpRevives.set(target, rec);
    if (now - rec.start >= 3) {
      this.mpRevives.delete(target);
      this.mp.send({ t: 'revived', s: target, by });
      this.mpApplyRevived(target, by);
    }
  }
  // 房主每格：倒地超過 30 秒的人帶走、全部的人都倒了就一起帶走；決定每一道鐵捲門開或關
  mpHostCoop(dt) {
    const me = this.mp.mySlot, alive = [];
    if (this.ghost.banished) { this.mpHostShutters(dt, [...this.remotes.values()].filter((r) => r.a === 0).length + (this.mpStatus === 0 ? 1 : 0)); return; }
    if (this.mpStatus === 0) alive.push({ slot: me, down: !!this.downed || !!this.dying });
    for (const r of this.remotes.values()) {
      if (r.a !== 0) continue;
      alive.push({ slot: r.slot, down: !!r.downed || !!r.dying, r });
      if (!r.downed) { r.downSince = null; r.takenAt = null; continue; }
      if (r.downSince == null) r.downSince = this.time;
      // 已經被扶過一次的人又倒地：直接帶走（每人每局只能被扶一次）
      if (this.time - r.downSince > 31.5 || this.mpRevived.has(r.slot)) this.mpTake(r);
    }
    if (alive.length && alive.every((p) => p.down)) {
      if (this.downed) this.mpTakeDowned();
      for (const p of alive) if (p.r && p.r.downed) this.mpTake(p.r);
    }
    this.mpHostShutters(dt, alive.length);
  }
  mpSomeoneIn(F, cells) {
    const W = F.lv.W, cell = (x, z) => Math.floor(z / CELL) * W + Math.floor(x / CELL);
    if (this.mpStatus === 0 && this.floorIdx === F.index && cells.has(cell(this.player.pos.x, this.player.pos.z))) return true;
    for (const r of this.remotes.values()) if (r.a === 0 && r.floor === F.index && cells.has(cell(r.tx, r.tz))) return true;
    return false;
  }
  mpTake(r) {
    if (r.takenAt != null && this.time - r.takenAt < 2) return;
    r.takenAt = this.time;
    this.mp.send({ t: 'taken', s: r.slot });
  }
  // 鐵捲門：有人（站著、同一層、在把手前面）按住把手就開，沒有就關；只剩一個人還在裡面時卡在打開的位置
  mpHostShutters(dt, aliveN) {
    const me = this.mp.mySlot, jam = aliveN <= 1;
    let changed = false;
    for (const F of this.floors) {
      for (const sh of F.lv.shutters || []) {
        const c = sh.crank;
        let want = 0;
        const j = sh.jammed || jam;
        // 死路那一側有人（站著或倒地）：門一直開著，免得被關在裡面（把手只在外面）
        const inside = sh.cut && this.mpSomeoneIn(F, sh.cut);
        if (j || inside) want = 1;
        else {
          if (this.cranking && this.cranking.s === sh && this.cranking.f === F.index && this.mpActor(me) && Math.hypot(this.player.pos.x - c.useX, this.player.pos.z - c.useZ) < 1.8) want = 1;
          for (const r of this.remotes.values()) {
            if (r.a !== 0 || r.downed || r.dying || r.ck !== sh.id || r.floor !== F.index) continue;
            if (Math.hypot(r.tx - c.useX, r.tz - c.useZ) < 1.8) want = 1;
          }
        }
        if (want !== sh.target || j !== sh.jammed) {
          this.mp.send({ t: 'shut', f: F.index, i: sh.id, o: want, j: j ? 1 : 0 });
          this.applyShutter(F, sh, want, j);
          changed = true;
        }
      }
    }
    // 每兩秒把全部鐵捲門的狀態再送一次（漏掉訊息也會對齊）
    this.shutT -= dt;
    if (this.shutT <= 0 || changed) {
      this.shutT = 2;
      const l = [];
      for (const F of this.floors) for (const sh of F.lv.shutters || []) l.push([F.index, sh.id, sh.target > 0.5 ? 1 : 0, sh.jammed ? 1 : 0]);
      if (l.length) this.mp.send({ t: 'shuts', l });
    }
  }
  applyShutter(F, sh, o, j) {
    const was = sh.target, wasJ = sh.jammed;
    sh.target = o ? 1 : 0;
    sh.jammed = !!j;
    if (F === this.F) {
      const pos = { x: sh.cx, y: 2.2, z: sh.cz };
      if (sh.target > was) this.audio.play('shutterUp', { pos });
      else if (sh.target < was) {
        this.audio.play('shutterSlam', { pos });
        const d = Math.hypot(this.player.pos.x - sh.cx, this.player.pos.z - sh.cz);
        if (d < 7) this.player.shake = Math.max(this.player.shake, 1 - d / 7);
        if (this.mp.isHost) this.makeNoise(sh.cx, sh.cz, 14, 'slam', F.index); // 她聽得到（只由房主通知她一次）
      }
    }
    if (sh.jammed && !wasJ && !this.jamNoticed) {
      this.jamNoticed = true;
      this.ui.subtitle('只剩一個人還在裡面了。鐵捲門的鍊條卡住，停在打開的位置。', 5);
    }
  }
  // 收到房主的鐵捲門狀態（不可信任的輸入：樓層、索引都要核對）
  mpApplyShutter(f, i, o, j) {
    const F = this.mpFloor(f);
    const sh = F && Number.isInteger(i) && F.lv.shutters ? F.lv.shutters[i] : null;
    if (!sh) return;
    this.applyShutter(F, sh, o === 1 ? 1 : 0, j === 1);
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
    this.updateWorlds(dt, cam, false);
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
    if (d.t > 1.9 && !this.over) { if (this.mp) this.mpDied(); else this.lose(); }
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
    const text = this.ritualStarted
      ? '三件遺物回到了搖籃裡。你走出大門的時候，身後的燈一盞一盞熄滅，最後一盞底下，一個穿護理服的女人抱著孩子，輕輕哼著那首搖籃曲。她終於找到了，也終於可以休息了。'
      : allNotes
      ? '你讀完了所有的紀錄。走出大門時，你聽見身後傳來孩子的笑聲，和一聲很輕的「謝謝」。她終於找到了。'
      : '你逃出了醫院。回家重看錄影時，最後一格畫面裡，她就站在你身後。';
    const best = this.app.recordBest(this.diffKey, this.time);
    const rows = [...this.statRows(), ...(best ? [['新紀錄！', fmtTime(this.time)]] : [])];
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.disposed || this.app.game !== this) return;
      this.ui.showEnd(true, rows, text, this.ritualStarted ? '安息' : '');
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
      const shotHer = Math.max(gh.state !== 'dormant' && gh.floor === this.floorIdx ? inShot(gh.model, gh.pos.x, gh.pos.z, gh.yaw) : 0,
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
      ['放回的遺物', `${this.relicsPlaced.size}/3`],
      ...(this.ritualStarted ? [['結局', '安息']] : []),
      ['用閃光定住她', `${this.stats.stuns} 次`],
      ['拍到她的臉', `${this.stats.photos} 張`],
      ['躲進鐵櫃', `${this.stats.hides} 次`],
      ['被抓到', `${this.stats.caught} 次`],
      ...(this.floorCount > 1 ? [['走過的樓層', `${this.visited.size}/${this.floorCount}`]] : []),
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

  // =====================================================================
  // 多人連線
  mpSetup() {
    const mp = this.mp, P = this.player, lv = this.lv;
    P.slot = mp.mySlot;
    // 出生點依座位往旁邊錯開，免得大家疊在一起
    const off = [0, 0.8, -0.8, 1.6][mp.mySlot] || 0;
    const sx = lv.spawn.x + Math.cos(lv.spawn.yaw) * off, sz = lv.spawn.z - Math.sin(lv.spawn.yaw) * off;
    if (!this.collision.overlapsStatic(sx, sz, 0.35)) { P.pos.x = sx; P.pos.z = sz; P.camera.position.set(sx, P.camera.position.y, sz); }
    for (const p of mp.players) if (p.slot !== mp.mySlot) this.mpAddRemote(p.slot);
    // 門被我開關時告訴其他人（收到別人的門就不再轉送）；每一層各自包一次，訊息帶樓層
    for (const F of this.floors) {
      const W = F.world, setDoor = W.setDoor.bind(W);
      W.setDoor = (d, target, speed = 2.6) => {
        setDoor(d, target, speed);
        if (!this.mpApplying) this.mp.send({ t: 'door', f: F.index, i: F.lv.doors.indexOf(d), tg: target, sp: speed });
      };
    }
  }

  mpAddRemote(slot) {
    if (this.remotes.has(slot)) return;
    let av = null;
    try { if (this.playerAssets) av = makePlayerModel(this.playerAssets, slot); } catch (e) { console.warn('player model', e); }
    if (!av) av = makeFallbackAvatar(slot);
    const lv = this.lv;
    // 手電筒掛在模型手上的燈頭（光線沿 +Z）
    const light = new THREE.SpotLight(0xfff1dc, 0, 18, 0.43, 0.5, 2);
    light.castShadow = false;
    light.target.position.set(0, 0, 1);
    av.lightSocket.add(light, light.target);
    this.scene.add(av.root);
    const r = {
      slot, av, light,
      pos: new THREE.Vector3(lv.spawn.x, 1.6, lv.spawn.z), yaw: lv.spawn.yaw, pitch: 0,
      tx: lv.spawn.x, tz: lv.spawn.z, ty: lv.spawn.yaw, tp: 0, floor: 0,
      camera: { position: new THREE.Vector3(lv.spawn.x, 1.6, lv.spawn.z) },
      flashOn: true, crouching: false, holdingBreath: false, sanity: 1, hiding: null, hideAnim: null,
      speed: 0, a: 0, h: -1, stepT: 0, got: false,
    };
    this.remotes.set(slot, r);
  }

  mpRemoveRemote(slot) {
    const r = this.remotes.get(slot);
    if (!r) return;
    this.scene.remove(r.av.root);
    r.light.dispose();
    r.av.dispose();
    this.remotes.delete(slot);
  }

  mpPlayerLeft(slot) {
    if (this.over) return;
    this.ui.hint(`${this.mp.slotName(slot)} 離開了。`, 3);
  }

  // 要傳給別人的自己的狀態
  mpLocalState() {
    const P = this.player;
    // 觀戰中：只送自己倒下（或逃出）時的位置，不跟著被觀戰的人，也不帶任何動作
    if (this.mpStatus !== 0 && this.specHome) {
      const H = this.specHome;
      return { x: H.x, z: H.z, y: H.y, p: 0, fl: H.fl, f: 0, h: -1, c: 0, v: 0, a: this.mpStatus, hb: 0, sa: 1, b: 0, dn: 0, ck: -1 };
    }
    const h = P.hiding || (P.hideAnim && P.hideAnim.entering ? P.hideAnim.locker : null);
    return {
      x: +P.pos.x.toFixed(2), z: +P.pos.z.toFixed(2), y: +P.yaw.toFixed(2), p: +P.pitch.toFixed(2),
      fl: this.floorIdx, f: P.flashOn && P.battery > 0 ? 1 : 0, h: h ? this.lv.lockers.indexOf(h) : -1,
      c: P.crouchNow || P.crouching ? 1 : 0, v: +(P.speed || 0).toFixed(1), a: this.mpStatus,
      hb: P.holdingBreath ? 1 : 0, sa: +P.sanity.toFixed(2), b: this.dying ? 1 : 0,
      dn: this.downed ? 1 : 0, ck: this.cranking && this.cranking.f === this.floorIdx ? this.cranking.s.id : -1,
    };
  }

  mpApplyState(slot, s) {
    if (slot === this.mp.mySlot || !this.mp.players.some((p) => p.slot === slot)) return;
    if (!this.remotes.has(slot)) this.mpAddRemote(slot);
    const r = this.remotes.get(slot);
    const fl = Number.isInteger(s.fl) && s.fl >= 0 && s.fl < this.floors.length ? s.fl : 0;
    // 換了樓層：直接跳過去，不要從上一層的位置滑過來
    if (fl !== r.floor) { r.floor = fl; r.pos.x = s.x; r.pos.z = s.z; r.yaw = s.y; }
    r.tx = s.x; r.tz = s.z; r.ty = s.y; r.tp = s.p;
    if (!r.got) { r.got = true; r.pos.x = s.x; r.pos.z = s.z; r.yaw = r.ty; }
    r.flashOn = !!s.f; r.crouching = !!s.c; r.holdingBreath = !!s.hb; r.speed = s.v;
    r.sanity = s.sa;
    const h = s.h;
    const lockers = this.floors[r.floor].lv.lockers;
    if (h !== r.h) {
      // 別人進出鐵櫃：櫃門開一下再關上（聲音只有同一層聽得到）
      const l = lockers[h >= 0 ? h : r.h];
      if (l) {
        const here = () => r.floor === this.floorIdx;
        if (here()) this.audio.play('lockerOpen', { pos: { x: l.x, y: 1, z: l.z } });
        l.target = 1.7;
        this.later(() => { l.target = 0; if (here()) this.audio.play('lockerClose', { pos: { x: l.x, y: 1, z: l.z } }); }, 650);
      }
      r.h = h;
    }
    r.hiding = h >= 0 ? lockers[h] || null : null;
    r.dying = !!s.b;
    r.ck = s.ck;
    // 倒地：告訴大家去扶他
    // 剛被扶起來的那一下，路上還有幾個舊的「倒地」狀態：忽略
    let down = !!s.dn && s.a === 0 && !(r.revivedAt != null && this.time - r.revivedAt < 1.5);
    // 房主只承認真的被她抓到的人倒地（剛送出 'caught' 的那幾秒內，或已經倒著的人）
    if (down && this.mp.isHost && !r.downed && !(r.caughtAt != null && this.time - r.caughtAt < 6)) down = false;
    if (down && !r.downed) this.ui.subtitle(`${this.mp.slotName(slot)} 倒下了！快去扶他起來（站到旁邊${this.input.touchMode ? '按住「互動」' : '按住 E'}）`, 4);
    r.downed = down;
    if (s.a !== r.a && r.a === 0) {
      const name = this.mp.slotName(slot);
      if (s.a === 1) this.ui.subtitle(`${name} 被她帶走了。`, 4);
      else if (s.a === 2) this.ui.subtitle(`${name} 逃出去了。`, 4);
      r.a = s.a;
      if (this.mp.isHost) this.mp.dropFuses(slot);
    }
  }

  // 人物的網格顯示 / 隱藏（燈要一直留在場景裡：燈的數量一變，所有材質都得重新編譯，會卡一下）
  mpSetBody(r, v) {
    if (r.bodyShown === v) return;
    r.bodyShown = v;
    if (!r.meshes) { r.meshes = []; r.av.root.traverse((o) => { if (o.isMesh || o.isSprite) r.meshes.push(o); }); }
    for (const m of r.meshes) m.visible = v;
  }

  // 其他玩家的人物、手電筒、腳步聲
  mpUpdateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 12);
    const lerpAng = (x, y, t) => { let d = y - x; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return x + d * t; };
    for (const r of this.remotes.values()) {
      r.pos.x += (r.tx - r.pos.x) * k;
      r.pos.z += (r.tz - r.pos.z) * k;
      r.yaw = lerpAng(r.yaw, r.ty, k);
      r.pitch += (r.tp - r.pitch) * k;
      const eye = r.crouching ? 1.0 : 1.6;
      r.pos.y = eye;
      r.camera.position.set(r.pos.x, eye, r.pos.z);
      // 不在同一層的人：人物、手電筒、腳步聲都不出現（燈還留在場景裡，只是不亮）
      const here = r.floor === this.floorIdx;
      const present = r.a === 0 && !r.hiding && here;
      const root = r.av.root;
      this.mpSetBody(r, present && this.spectate !== r.slot);
      root.position.set(r.pos.x, 0, r.pos.z);
      root.rotation.y = r.yaw + Math.PI;
      if (present) r.av.update(dt, { speed: r.speed, crouch: r.crouching, running: r.speed > 4, dead: !!r.downed, pitch: r.pitch });
      // 手電筒
      const on = r.flashOn && present;
      r.light.intensity = on ? 22 : 0;
      if (r.av.setFlashlight) r.av.setFlashlight(on);
      // 腳步聲
      if (present && r.speed > 0.6) {
        r.stepT -= dt * (r.speed > 4 ? 2.6 : r.crouching ? 1.1 : 1.8);
        if (r.stepT <= 0) {
          r.stepT = 1;
          this.audio.play('footstep', { pos: { x: r.pos.x, y: 0.1, z: r.pos.z }, run: r.speed > 4, crouch: r.crouching });
        }
      }
    }
  }

  ghostNetState() { return this.ghost.netState(); }

  // 房主：女鬼要追誰——追逐中盯住同一個人，否則找最近的（同一層的人優先）
  mpGhostTarget(gh) {
    const list = [];
    if (this.mpStatus === 0 && !this.dying && !this.downed) list.push(this.player);
    for (const r of this.remotes.values()) if (r.a === 0 && r.got && !r.dying && !r.downed) list.push(r);
    if (!list.length) { gh.targetSlot = -1; return gh.target && gh.target !== this.player ? gh.target : this.player; }
    const cur = gh.target && list.includes(gh.target) ? gh.target : null;
    let pick = cur;
    if (!(cur && gh.state === 'chase' && gh.lostT < 2)) {
      let best = 1e9;
      for (const p of list) {
        const d = Math.hypot(p.pos.x - gh.pos.x, p.pos.z - gh.pos.z) + (p === cur ? -2 : 0) + (Ghost.floorOf(p) === gh.floor ? 0 : 1000);
        if (d < best) { best = d; pick = p; }
      }
    }
    if (pick !== gh.target) gh.knowsLocker = null;
    gh.targetSlot = pick === this.player ? this.mp.mySlot : pick.slot;
    return pick;
  }

  // 被追的人消失了（被抓、離開）：女鬼退開一陣子
  mpGhostRetreat(delay) {
    this.later(() => {
      const gh = this.ghost;
      if (this.over || !gh || gh.state === 'dormant') return;
      gh.setState('dormant');
      gh.model.root.visible = false;
      gh.dormantUntil = this.time + 12;
      gh.knowsLocker = null;
      gh.stopHum();
    }, delay * 1000);
  }

  // 收到的樓層索引：一定要是整數而且在範圍內（不可信任的輸入）
  mpFloor(f) { return Number.isInteger(f) && f >= 0 && f < this.floors.length ? this.floors[f] : null; }

  mpApplyDoor(m) {
    const F = this.mpFloor(m.f);
    const d = F && Number.isInteger(m.i) ? F.lv.doors[m.i] : null;
    if (!d || !Number.isFinite(m.tg) || !Number.isFinite(m.sp)) return null;
    // 鎖著的門不能被開（不可信任的輸入）
    if (d.lock >= 0 && !d.unlocked && Math.abs(m.tg) > 0.3) return null;
    m = { t: 'door', f: F.index, i: m.i, tg: Math.max(-1.7, Math.min(1.7, m.tg)), sp: Math.max(0.5, Math.min(12, m.sp)) };
    const was = d.target;
    this.mpApplying = true;
    F.world.setDoor(d, m.tg, m.sp);
    this.mpApplying = false;
    if (F === this.F) {
      const pos = { x: d.cx, y: 1.2, z: d.cz };
      if (m.tg > was) this.audio.play(m.sp >= 7 ? 'doorBang' : 'doorOpen', { pos });
      else if (m.tg < was) this.audio.play(m.sp >= 10 ? 'doorSlam' : 'doorClose', { pos });
    }
    return m;
  }

  // 撿道具：先問房主，房主確定沒人搶先才給
  mpRequestPick(it) {
    if (it.kind === 'bottle' && this.player.bottles >= 3) { this.ui.hint('最多只能帶三個瓶子。', 2); return; }
    if (it.pending) return;
    const F = this.floors[it.floor] || this.F;
    const i = F.lv.items.indexOf(it);
    if (this.mp.isHost) { this.mpHostPick(F.index, i, this.mp.mySlot); return; }
    it.pending = true;
    setTimeout(() => { it.pending = false; }, 2000);
    this.mp.send({ t: 'pick', f: F.index, i });
  }
  mpHostPick(f, i, slot) {
    const F = this.mpFloor(f);
    const it = F && Number.isInteger(i) ? F.lv.items[i] : null;
    if (!it || it.taken) return;
    const r = this.remotes.get(slot);
    if (slot === this.mp.mySlot ? this.mpStatus !== 0 || this.dying || this.downed : !r || r.a !== 0 || r.downed || r.floor !== F.index) return;
    // 要站在道具旁邊才撿得到（不可信任的輸入）
    if (slot !== this.mp.mySlot && Math.hypot(r.tx - it.x, r.tz - it.z) > 4) return;
    // 保險絲、門禁卡、遺物：記下誰帶著（被抓走或離開時放回原處；插保險絲、刷卡、放遺物時核對）
    if (it.kind === 'fuse' || it.kind === 'keycard' || it.kind === 'relic') this.mp.carry(slot, { f: F.index, i, k: it.kind, c: it.color, r: it.relic });
    this.mp.send({ t: 'took', f: F.index, i, by: slot });
    this.mpTook(F.index, i, slot);
  }
  mpTook(f, i, by) {
    const F = this.mpFloor(f);
    const it = F && Number.isInteger(i) ? F.lv.items[i] : null;
    if (!it || it.taken) return;
    if (by === this.mp.mySlot) {
      it.pending = false;
      if (this.mpStatus === 0 && !this.dying) { this.pickup(it); return; }
    }
    F.world.removeItem(it);
    if (it.kind === 'fuse') this.ui.hint(`${this.mp.slotName(by)} 撿到了一個保險絲。`, 2.5);
    else if (it.kind === 'keycard') this.ui.hint(`${this.mp.slotName(by)} 撿到了${KEY_COLORS[it.color].name}門禁卡。`, 2.5);
    else if (it.kind === 'relic') this.ui.hint(`${this.mp.slotName(by)} 撿到了${RELICS[it.relic].name}。`, 2.5);
  }

  // 帶著保險絲的人被抓走或離開：保險絲回到原本的位置（原本那一層）
  mpRespawnItem(f, i) {
    const F = this.mpFloor(f);
    const it = F && Number.isInteger(i) ? F.lv.items[i] : null;
    if (!it || !it.taken || !it.mesh) return;
    const W = F.world;
    it.taken = false;
    it.pending = false;
    W.root.add(it.mesh);
    if (!W.interactables.includes(it.mesh)) W.interactables.push(it.mesh);
    const k = W.removed.indexOf(it.mesh);
    if (k >= 0) W.removed.splice(k, 1);
  }

  // 保險絲：房主統一計數，避免兩人同時插而重複
  mpHostFuse(slot) {
    if (this.fusesInserted >= 3 || !this.mp.useCarried(slot, (e) => e.k === 'fuse')) return;
    const n = this.fusesInserted + 1;
    this.mp.send({ t: 'fuses', n, by: slot });
    this.mpApplyFuse(n, slot);
  }
  mpApplyFuse(n, by) {
    if (!Number.isInteger(n) || n < 1 || n > 3) return;
    while (this.fusesInserted < n) {
      const i = this.fusesInserted++;
      this.applyFuse(i);
    }
    if (by !== this.mp.mySlot) this.ui.hint(`${this.mp.slotName(by)} 插上了保險絲（${n}/3）`, 3);
  }

  // 誰（自己或其他玩家）現在在哪裡、還能不能動手：房主核對刷卡、放遺物、拉鐵捲門、救人時用
  mpActor(slot) {
    if (slot === this.mp.mySlot) {
      if (this.mpStatus !== 0 || this.dying || this.downed) return null;
      return { x: this.player.pos.x, z: this.player.pos.z, floor: this.floorIdx };
    }
    const r = this.remotes.get(slot);
    if (!r || r.a !== 0 || !r.got || r.dying || r.downed) return null;
    return { x: r.tx, z: r.tz, floor: r.floor };
  }
  // 房主：刷卡開鎖。門要真的上鎖、人要在門旁邊、身上真的帶著那個顏色的卡
  mpHostUnlock(f, i, slot) {
    const F = this.mpFloor(f);
    const d = F && Number.isInteger(i) ? F.lv.doors[i] : null;
    if (!d || !(d.lock >= 0) || d.unlocked) return;
    const a = this.mpActor(slot);
    if (!a || a.floor !== F.index || Math.hypot(a.x - d.cx, a.z - d.cz) > 3.2) return;
    if (!this.mp.useCarried(slot, (e) => e.k === 'keycard' && e.c === d.lock)) return;
    this.mp.send({ t: 'unlocked', f: F.index, i, by: slot });
    this.applyUnlock(F, d, slot);
  }
  // 房主：放遺物。人要在搖籃旁邊、身上真的帶著那一件
  mpHostRelic(r, slot) {
    const AF = this.altarFloor;
    if (!AF || !Number.isInteger(r) || r < 0 || r > 2 || this.relicsPlaced.has(r)) return;
    const a = this.mpActor(slot), al = AF.lv.altar;
    if (!a || a.floor !== AF.index || Math.hypot(a.x - al.x, a.z - al.z) > 3) return;
    if (!this.mp.useCarried(slot, (e) => e.k === 'relic' && e.r === r)) return;
    this.mp.send({ t: 'relics', r, by: slot });
    this.applyRelic(r, slot);
  }
  mpApplyRelic(r, by) {
    if (!Number.isInteger(r) || !Number.isInteger(by)) return;
    this.applyRelic(r, by);
  }
  mpApplyUnlock(f, i, by) {
    const F = this.mpFloor(f);
    const d = F && Number.isInteger(i) ? F.lv.doors[i] : null;
    if (!d || !(d.lock >= 0) || !Number.isInteger(by)) return;
    this.applyUnlock(F, d, by);
  }

  // 房主決定的世界事件（牆上的字、熄燈、屍體換姿勢）
  mpApplyEvent(m) {
    const D = this.director, F = this.mpFloor(m.f);
    if (!F) return;
    switch (m.k) {
      case 'write':
        if (typeof m.text === 'string' && [m.x, m.y, m.z, m.rot].every(Number.isFinite)) F.world.addWallWriting(m.text.slice(0, 40), m.x, m.y, m.z, m.rot);
        break;
      case 'lightsOut':
        if ([m.x, m.z, m.r, m.d].every(Number.isFinite)) {
          F.world.lightsOut(m.x, m.z, m.r, m.d);
          if (F === this.F) this.audio.play('distantBang', { pos: { x: m.x, y: 2.5, z: m.z } });
        }
        break;
      case 'corpse':
        if (D.applyCorpseSwap) D.applyCorpseSwap(m.i, m.n, F.index);
        break;
    }
  }

  // 自己被抓走了 → 改成觀戰
  mpDied() {
    if (this.mpStatus !== 0) return;
    this.mpStatus = 1;
    this.mpSpectateBegin('你被她帶走了……');
    if (this.mp.isHost) { this.mp.dropFuses(this.mp.mySlot); this.mpGhostRetreat(0.2); this.mp.checkEnd(); }
  }
  // 自己逃出去了
  mpEscaped() {
    if (this.mpStatus !== 0) return;
    this.mpStatus = 2;
    this.audio.play('thunder', { near: 0.3 });
    this.mpSpectateBegin('你逃出去了。還有人在裡面……');
    if (this.mp.isHost) this.mp.checkEnd();
  }
  mpSpectateBegin(text) {
    const P = this.player;
    this.dying = null;
    this.stairT = null;
    P.locked = false;
    this.ui.fade(0, 0.2);
    P.fuses = 0;
    P.keys = [];
    P.relics = [];
    P.downed = false;
    this.downed = null;
    this.cranking = null;
    this.reviving = null;
    this.ui.showDowned(false);
    this.ui.setHold(0);
    this.post.u.uFade.value = 0;
    this.post.u.uRed.value = 0;
    this.post.u.uDistort.value = 0;
    this.damage = 0;
    this.ghost.model.revealFace(0);
    if (!this.mp.isHost) this.ghost.model.root.visible = false;
    this.audio.startAmbience();
    this.audio.setMusic('explore');
    P.flash.intensity = 0;
    P.flashOn = false;
    if (P.hiding) { P.hiding.hideDoor = false; P.hiding.dirty = true; P.hiding = null; this.ui.setHiding(false); }
    // 記下自己最後的位置：觀戰時送給別人的一直是這個，不會出現在被觀戰者身上
    this.specHome = { x: +P.pos.x.toFixed(2), z: +P.pos.z.toFixed(2), y: +P.yaw.toFixed(2), fl: this.floorIdx };
    this.ui.prompt('');
    this.ui.subtitle(text, 4);
    this.ui.setHiding(false);
    document.getElementById('crosshair').hidden = true;
    document.getElementById('touch').hidden = true;
    this.spectate = -1;
    this.mpCycleSpectate(1);
  }
  // 換觀戰對象：dir = 1 下一位、-1 上一位（只在還在裡面的人之間輪流）
  mpCycleSpectate(dir) {
    const alive = [...this.remotes.values()].filter((r) => r.a === 0).map((r) => r.slot).sort((a, b) => a - b);
    const prev = this.spectate;
    if (!alive.length) this.spectate = -1;
    else {
      const i = alive.indexOf(this.spectate);
      this.spectate = i < 0 ? alive[dir > 0 ? 0 : alive.length - 1] : alive[(i + dir + alive.length) % alive.length];
    }
    if (this.spectate !== prev) this.specLast = null;
    this.mpUpdateSpecBar(true);
  }
  // 觀戰列：正在看誰、在哪一層、在做什麼
  mpUpdateSpecBar(force) {
    const bar = document.getElementById('specBar');
    if (this.mpStatus === 0 || this.over) { bar.hidden = true; return; }
    const r = this.remotes.get(this.spectate);
    const n = [...this.remotes.values()].filter((q) => q.a === 0).length;
    let key;
    if (!r) key = 'none';
    else {
      const F = this.floors && this.floors.length > 1 ? this.floors[r.floor] : null;
      const doing = r.dying ? '被她抓住了！' : r.downed ? '倒在地上，等人來扶' : r.hiding ? '躲在鐵櫃裡' : r.ck >= 0 ? '轉著鐵捲門的把手' : r.speed > 4 ? '正在奔跑' : '';
      key = [r.slot, F ? F.title : '', doing, n].join('|');
    }
    if (!force && key === this.specLast) return;
    this.specLast = key;
    bar.hidden = false;
    const name = document.getElementById('specName'), info = document.getElementById('specInfo'), dot = document.getElementById('specDot');
    const [, floor, doing] = key.split('|');
    if (!r) {
      name.textContent = '沒有人可以觀戰了';
      info.textContent = '等待結算……';
      dot.style.background = 'transparent';
    } else {
      name.textContent = this.mp.slotName(r.slot);
      info.textContent = [floor, doing].filter(Boolean).join('・');
      dot.style.background = SLOT_CSS[r.slot] || '#888';
    }
    document.getElementById('specPrev').disabled = n < 2;
    document.getElementById('specNext').disabled = n < 2;
    document.getElementById('specKeys').textContent = n < 2 ? '' : this.input.touchMode ? '點左右箭頭換人' : 'E / 左鍵：下一位　Q / 右鍵：上一位';
  }

  updateSpectator(dt, inp) {
    const P = this.player;
    // 觀戰的人只能換人看、暫停，其他按鍵一律不處理（不會影響任何人的遊戲）
    for (const a of inp.actions) {
      if (a === 'interact' || a === 'tap' || a === 'specNext') this.mpCycleSpectate(1);
      else if (a === 'camera' || a === 'specPrev') this.mpCycleSpectate(-1);
      else if (a === 'pause') { this.app.pause(); return; }
    }
    let r = this.remotes.get(this.spectate);
    if (!r || r.a !== 0) { this.mpCycleSpectate(1); r = this.remotes.get(this.spectate); }
    this.mpUpdateSpecBar(false);
    if (r) {
      // 從他的眼睛看出去（他在哪一層就看哪一層）；只動自己的鏡頭，自己的角色留在原地
      if (r.floor !== this.floorIdx) { this.setFloor(r.floor); this.markExplored(true); }
      P.sanity = r.sanity;
      const c = P.camera;
      c.position.copy(r.camera.position);
      c.rotation.set(r.pitch, r.yaw, 0);
      c.updateMatrixWorld();
    }
    this.ghost.update(dt);
    if (this.mp.isHost) this.director.update(dt);
    this.updateWorlds(dt, P.camera, false);
    this.mpUpdateRemotes(dt);
    if (this.mp.isHost) this.mpHostCoop(dt);
    this.mp.tick(dt);
    if (this.ritual) this.updateRitual(dt);
    this.ghostDist = r && this.ghost.state !== 'dormant' && this.ghost.floor === this.floorIdx ? Math.hypot(this.ghost.pos.x - r.pos.x, this.ghost.pos.z - r.pos.z) : 99;
    this.updateMood(dt);
    this.audio.setListener(P.camera);
  }

  // 全員結束：顯示每個人的結果
  mpEnd(res) {
    if (this.over) return;
    this.over = true;
    this.audio.stopAll();
    const anyOut = res.some((p) => p.a === 2);
    this.audio.setMusic(anyOut ? 'win' : 'lose');
    this.input.exitLock();
    this.ui.prompt('');
    document.getElementById('specBar').hidden = true;
    const rows = res.map((p) => [(p.n || this.mp.slotName(p.s)) + (p.s === this.mp.mySlot ? '（你）' : ''), p.a === 2 ? '逃出去了' : '被帶走了']);
    rows.push(...this.statRows());
    const text = anyOut && this.ritualStarted
      ? '三件遺物回到了搖籃裡，她終於找到了她的孩子。走出大門時，身後的燈一盞一盞熄滅——這一次，醫院裡再也沒有人哼歌了。'
      : anyOut
      ? (res.every((p) => p.a === 2) ? '所有人都活著走出了大門。身後的燈一盞一盞熄滅。' : '有人逃了出來。被留下的人，再也沒有出來過。')
      : '沒有人走出那扇門。隔天早上，警衛只找到幾台還在錄影的攝影機。';
    this.ui.showEnd(this.mpStatus === 2, rows, text, anyOut && this.ritualStarted ? '安息' : '');
    this.app.onGameOver(this.mpStatus === 2);
  }

  mpHostLost() {
    if (this.over) return;
    this.ui.showDowned(false);
    this.ui.setHold(0);
    document.getElementById('specBar').hidden = true;
    this.over = true;
    this.audio.stopAll();
    this.input.exitLock();
    this.ui.showEnd(false, this.statRows(), '房主斷線了，這一局沒辦法繼續。');
    this.app.onGameOver(false);
  }

  render(dt) {
    this.post.render(dt);
  }

  dispose() {
    this.over = true;
    document.getElementById('specBar').hidden = true;
    this.disposed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.audio.stopAll();
    this.audio.occlusionFn = null;
    if (this.ui.game === this) this.ui.game = null;
    this.input.exitLock();
    // 已經從場景移除的物件也要釋放
    for (const F of this.floors) if (F.world) for (const o of F.world.removed) this.scene.add(o);
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
    for (const F of this.floors) if (F.world && F.world.aoTex) F.world.aoTex.dispose();
    if (this.envRT) this.envRT.dispose();
    this.ui.hidePhoto();
    this.post.dispose();
    this.renderer.renderLists.dispose();
  }
}


// 驚嚇導演：控制節奏、隨機事件、幻覺與鬼魂登場
import * as THREE from 'three';
import { sightClear } from './nav.js';
import { GhostModel } from './ghost.js';
import { WALL_WRITINGS } from './level.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Director {
  constructor(game) {
    this.game = game;
    this.next = 30;
    this.used = new Set();
    this.writings = 0;
    this.lastSighting = -99;
    this.apparition = null;
    this.appT = 0;
    this.fakeRush = null;
    this.phoneRinging = false;
    this.firstPeekDone = false;
    // 幻影（只有外表，不會傷人）
    const m = new GhostModel(game.tf, game.world.M);
    this.appModel = m;
    this.apparition = m.root;
    m.root.visible = false;
    game.scene.add(m.root);
  }

  update(dt) {
    const g = this.game, P = g.player, gh = g.ghost;
    const t = g.time;
    // 第一次讓她現身：先在遠處瞥見
    if (!this.firstPeekDone && t > g.diff.grace - 12 && gh.state === 'dormant' && !gh.dormantUntil) {
      if (this.peek(true)) this.firstPeekDone = true;
    }
    // 鬼魂登場 / 回來
    if (gh.state === 'dormant') {
      const ready = gh.dormantUntil ? t > gh.dormantUntil : (t > g.diff.grace || g.fusesInserted > 0 || P.fuses > 0);
      if (ready && !g.dying) {
        const spot = gh.findSpot(g.phase === 'escape' ? 12 : 18, g.phase === 'escape' ? 24 : 34) || gh.findSpot(10, 60);
        if (spot) {
          gh.spawnAt(spot.x, spot.z, g.phase === 'escape' ? 'chase' : 'wander');
          if (g.phase === 'escape') { gh.lastKnown = { x: P.pos.x, z: P.pos.z }; }
          gh.dormantUntil = 0;
        }
      }
    }
    // 幻影
    if (this.apparition.visible && !this.fakeRush) this.updateApparition(dt);
    if (this.fakeRush) this.updateRush(dt);

    // 隨機事件
    if (g.phase === 'escape') return;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = rnd(20, 42) * (1 - 0.12 * g.fusesInserted) * (P.sanity < 0.35 ? 0.65 : 1);
      if (gh.state === 'chase' || (g.ghostDist < 8 && gh.state !== 'dormant') || P.hiding) { this.next = 8; return; }
      this.randomEvent();
    }
  }

  randomEvent() {
    const g = this.game, P = g.player;
    const low = P.sanity < 0.4;
    const opts = [
      ['flicker', 3], ['distant', 3], ['doorSlam', 2.5], ['steps', 2], ['whisper', low ? 3 : 1.2],
      ['musicBox', 1.2], ['wheelchair', 1.5], ['thunder', 2], ['peek', 1.5], ['writing', this.writings < 3 ? 1.2 : 0],
      ['lightsOut', g.fusesInserted > 0 ? 1.5 : 0], ['breath', low ? 2 : 0.3], ['rush', P.sanity < 0.3 ? 2 : 0],
      ['phone', g.lv.phone && !this.used.has('phone') && g.time > 60 ? 2.5 : 0],
    ];
    let total = 0;
    for (const o of opts) total += o[1];
    let r = Math.random() * total;
    for (const [name, w] of opts) {
      if ((r -= w) <= 0) { this.trigger(name); return; }
    }
  }

  trigger(name) {
    const g = this.game, P = g.player, A = g.audio, lv = g.lv;
    const pp = P.pos;
    switch (name) {
      case 'flicker':
        g.world.flickerArea(pp.x, pp.z, 12, 1.6);
        g.eventFlicker = 0.9;
        A.play('static', { dur: 0.5, vol: 0.6 });
        break;
      case 'distant': {
        const s = g.ghost.findSpot(10, 26, false);
        if (!s) break;
        A.play(Math.random() < 0.4 ? 'metalClank' : Math.random() < 0.5 ? 'distantBang' : 'glass', { pos: { x: s.x, y: 1, z: s.z } });
        g.makeNoise(s.x, s.z, 0); // 只是聲音，不吸引她
        break;
      }
      case 'doorSlam': {
        const cands = lv.doors.filter((d) => d.angle > 0.6 && Math.hypot(d.cx - pp.x, d.cz - pp.z) < 18 && Math.hypot(d.cx - pp.x, d.cz - pp.z) > 4);
        if (!cands.length) { this.trigger('distant'); break; }
        const d = cands[Math.floor(Math.random() * cands.length)];
        g.world.setDoor(d, 0, 10);
        A.play('doorSlam', { pos: { x: d.cx, y: 1.2, z: d.cz } });
        P.shake = Math.max(P.shake, 0.3);
        break;
      }
      case 'steps': {
        // 身後有人跟著走，轉頭什麼都沒有
        const back = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
        A.play('steps', { n: 4, path: (k) => ({ x: pp.x + back.x * (5 - k), y: 0.1, z: pp.z + back.z * (5 - k) }) });
        break;
      }
      case 'whisper':
        if (Math.random() < 0.5) A.play('whisper', { pan: Math.random() < 0.5 ? -0.85 : 0.85, vol: 0.9 });
        else A.play('whisper', { pos: { x: pp.x + rnd(-3, 3), y: 1.6, z: pp.z + rnd(-3, 3) } });
        if (Math.random() < 0.4) g.ui.subtitle(['（……媽媽在這裡……）', '（……你看到我的孩子了嗎……）', '（……別走……）', '（……好冷……）'][Math.floor(Math.random() * 4)], 3);
        break;
      case 'musicBox': {
        const rooms = lv.rooms.filter((r) => r.id > 0 && Math.hypot(r.cx - pp.x, r.cz - pp.z) < 16 && Math.hypot(r.cx - pp.x, r.cz - pp.z) > 6);
        const r = rooms[Math.floor(Math.random() * rooms.length)];
        if (r) A.play('musicBox', { pos: { x: r.cx, y: 1, z: r.cz }, dur: 9 });
        break;
      }
      case 'wheelchair': {
        const w = g.world.dynamicProps.find((f) => Math.hypot(f.x - pp.x, f.z - pp.z) < 14 && Math.hypot(f.x - pp.x, f.z - pp.z) > 3);
        if (!w) { this.trigger('flicker'); break; }
        const a = Math.random() * Math.PI * 2;
        // 檢查推動方向是否淨空
        const tx = w.x + Math.cos(a) * 1.4, tz = w.z + Math.sin(a) * 1.4;
        if (!g.ghostNav.isFree(tx, tz) || Math.hypot(tx - pp.x, tz - pp.z) < 1.5 || !g.sight(w.x, w.z, tx, tz) || g.collision.overlapsStatic(tx, tz, 0.45)) break;
        w.vel = [Math.cos(a) * 1.2, Math.sin(a) * 1.2];
        A.play('wheelchair', { pos: { x: w.x, y: 0.5, z: w.z } });
        break;
      }
      case 'thunder': {
        const nearWin = lv.windows.some((w) => Math.hypot(w.x - pp.x, w.z - pp.z) < 9);
        g.world.lightning(nearWin ? 1 : 0.25);
        g.later(() => A.play('thunder', { near: nearWin ? rnd(0.5, 1) : rnd(0, 0.5) }), rnd(300, 1500));
        break;
      }
      case 'peek':
        this.peek(false);
        break;
      case 'writing':
        this.writeBehind();
        break;
      case 'lightsOut':
        g.world.lightsOut(pp.x, pp.z, 10, 6);
        A.play('static', { dur: 0.4, vol: 0.4 });
        A.play('distantBang', { pos: { x: pp.x + rnd(-6, 6), y: 2.5, z: pp.z + rnd(-6, 6) } });
        break;
      case 'breath': {
        const back = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
        A.play('breathBehind', { pos: { x: pp.x + back.x * 0.6, y: 1.7, z: pp.z + back.z * 0.6 } });
        break;
      }
      case 'rush':
        this.startRush();
        break;
      case 'phone':
        if (lv.phone && g.world.phone) {
          this.used.add('phone');
          this.phoneRinging = true;
          A.startPhone({ x: lv.phone.x, y: 1.1, z: lv.phone.z });
          g.ui.subtitle('（遠處傳來電話鈴聲）', 3);
        }
        break;
    }
  }

  answerPhone() {
    const g = this.game;
    if (!this.phoneRinging) { g.ui.hint('電話線早就斷了。', 2); return; }
    this.phoneRinging = false;
    g.audio.stopPhone();
    g.audio.play('static', { dur: 1.2, vol: 0.5 });
    g.later(() => {
      g.audio.play('whisper', { pan: 0.0, vol: 1.2, dur: 2.6 });
      g.ui.subtitle('「……你也是來找我的孩子的嗎……」', 4);
    }, 1200);
    g.later(() => {
      g.ui.subtitle('「……他在發電機房。」', 3.5);
      g.player.sanity = Math.max(0, g.player.sanity - 0.1);
    }, 5000);
  }

  // 在玩家前方遠處放一個靜止的身影
  peek(first) {
    const g = this.game, P = g.player, lv = g.lv;
    if (this.apparition.visible) return false;
    const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    for (let t = 0; t < 30; t++) {
      const ang = rnd(-0.35, 0.35);
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const d = rnd(first ? 11 : 9, first ? 20 : 17);
      const x = P.pos.x + dir.x * d, z = P.pos.z + dir.z * d;
      if (!g.ghostNav.isFree(x, z)) continue;
      if (!sightClear(lv, P.pos.x, P.pos.z, x, z)) continue;
      this.showApparition(x, z);
      return true;
    }
    return false;
  }
  showApparition(x, z) {
    const g = this.game, P = g.player;
    const a = this.apparition;
    a.position.set(x, 0.01, z);
    a.rotation.y = Math.atan2(P.pos.x - x, P.pos.z - z);
    a.visible = true;
    this.appModel.pose('idle', g.time, 0, 0);
    this.appModel.setEyes(0.8);
    this.appT = 0;
    this.appSeen = 0;
  }
  updateApparition(dt) {
    const g = this.game, P = g.player, a = this.apparition;
    this.appT += dt;
    this.appModel.pose('idle', g.time, 0, 0);
    const d = Math.hypot(a.position.x - P.pos.x, a.position.z - P.pos.z);
    // 被看著（在畫面中央）會累積
    const v = new THREE.Vector3(a.position.x, 1.5, a.position.z).project(P.camera);
    const onScreen = Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.8 && v.z < 1;
    if (onScreen) this.appSeen += dt;
    if (onScreen && this.appSeen > 0.25 && !this.appStinger) {
      this.appStinger = true;
      g.audio.play('stinger', { vol: 0.7 });
      P.sanity = Math.max(0, P.sanity - 0.08);
    }
    if (d < 6 || this.appT > 6 || this.appSeen > 1.6) this.vanishApparition(true);
  }
  vanishApparition(withStatic) {
    this.fakeRush = null; // 被閃光打散的幻覺不會再造成驚嚇
    if (!this.apparition.visible) return;
    this.apparition.visible = false;
    this.appStinger = false;
    if (withStatic) {
      this.game.audio.play('static', { dur: 0.35, vol: 0.7 });
      this.game.staticBoost = 0.8;
    }
  }

  // 幻覺：她從前方衝過來，在面前消失
  startRush() {
    const g = this.game, P = g.player;
    const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const x = P.pos.x + fwd.x * 7, z = P.pos.z + fwd.z * 7;
    if (!g.ghostNav.isFree(x, z) || !sightClear(g.lv, P.pos.x, P.pos.z, x, z) || this.apparition.visible) return;
    this.showApparition(x, z);
    this.fakeRush = { t: 0 };
    g.audio.play('shriek', { pos: { x, y: 1.6, z } });
  }
  updateRush(dt) {
    const g = this.game, P = g.player, a = this.apparition;
    this.fakeRush.t += dt;
    const dx = P.pos.x - a.position.x, dz = P.pos.z - a.position.z;
    const d = Math.hypot(dx, dz);
    a.position.x += (dx / d) * 7.5 * dt;
    a.position.z += (dz / d) * 7.5 * dt;
    a.rotation.y = Math.atan2(dx, dz);
    this.appModel.pose('chase', g.time, g.time * 12, 4);
    if (d < 1.2 || this.fakeRush.t > 2) {
      this.fakeRush = null;
      this.vanishApparition(true);
      g.post.u.uFlash.value = 0.35;
      P.shake = 1;
      P.sanity = Math.max(0, P.sanity - 0.1);
    }
  }

  // 「回頭就出現」的血字
  writeBehind() {
    const g = this.game, P = g.player, lv = g.lv;
    const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const words = WALL_WRITINGS.filter((w) => w !== '707');
    let best = null, bestD = 1e9;
    for (const p of lv.wallPieces) {
      if (p.post || p.lintel || p.minY > 0) continue;
      const lenX = p.maxX - p.minX, lenZ = p.maxZ - p.minZ;
      if (Math.max(lenX, lenZ) < 2.2) continue;
      const alongX = lenX > lenZ;
      const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
      for (const s of [-1, 1]) {
        const nx = alongX ? 0 : s, nz = alongX ? s : 0;
        const fx = cx + nx * (0.1 + 0.012), fz = cz + nz * (0.1 + 0.012);
        const toX = fx - P.pos.x, toZ = fz - P.pos.z;
        const d = Math.hypot(toX, toZ);
        if (d < 2 || d > 7) continue;
        if (toX * nx + toZ * nz > 0) continue; // 面要朝向玩家
        if ((toX * fwd.x + toZ * fwd.z) / d > -0.2) continue; // 要在背後
        if (!sightClear(lv, P.pos.x, P.pos.z, fx + nx * 0.3, fz + nz * 0.3)) continue;
        if (d < bestD) { bestD = d; best = { x: fx, z: fz, rot: Math.atan2(nx, nz) }; }
      }
    }
    if (!best) { this.trigger('whisper'); return; }
    this.writings++;
    g.world.addWallWriting(words[Math.floor(Math.random() * words.length)], best.x, 1.5, best.z, best.rot);
    g.audio.play('whisper', { pos: { x: best.x, y: 1.5, z: best.z }, dur: 1.2 });
  }
}


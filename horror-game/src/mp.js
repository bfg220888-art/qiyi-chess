// 多人連線（最多 4 人）：房主是權威端，負責女鬼 AI、導演的實體事件、道具與保險絲的歸屬；
// 每個人在自己的電腦上移動自己的角色，每秒 15 次把位置傳給房主，房主再轉給其他人。
// 大家用同一組種子、難度、地圖產生一模一樣的醫院，所以門、道具、鐵櫃都用索引對應。
import * as THREE from 'three';
import { Net, normalizeCode, netErrorText } from './net.js';
import { SLOT_COLORS } from './player-model.js';

export const MAX_PLAYERS = 4;
export { SLOT_COLORS } from './player-model.js';
export const SLOT_CSS = ['#d0453e', '#4a7fe0', '#45b052', '#e8c030'];
const SEND_HZ = 15;
const NET_SFX = new Set(['bottleBreak']);
const TAU = Math.PI * 2;
const num = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const wrap = (a) => (Number.isFinite(a) ? (((a % TAU) + TAU * 1.5) % TAU) - Math.PI : 0);
// 從網路收到的玩家狀態：每個欄位都轉成安全範圍內的值（不可信任的輸入）
function cleanState(m) {
  return {
    x: num(m.x, -500, 500), z: num(m.z, -500, 500), y: wrap(m.y), p: num(m.p, -1.6, 1.6),
    f: m.f ? 1 : 0, h: Number.isInteger(m.h) && m.h >= 0 && m.h < 1000 ? m.h : -1,
    c: m.c ? 1 : 0, v: num(m.v, 0, 12), a: m.a === 1 || m.a === 2 ? m.a : 0,
    b: m.b ? 1 : 0, sa: num(m.sa, 0, 1, 1), hb: m.hb ? 1 : 0,
  };
}
const HOST_ACCEPTS = new Set(['st', 'door', 'pick', 'fuse', 'noise', 'stun', 'sfx']);

export class MP {
  constructor(app) {
    this.app = app;
    this.net = null;
    this.players = []; // { slot, id, name, ready }
    this.mySlot = 0;
    this.isHost = false;
    this.inGame = false;
    this.listeners = new Set();
    this.status = '';
    this.results = new Map(); // 中途離開的人的結果（slot → { a, name }）
    this.carried = new Map(); // 房主：slot → 身上的保險絲（道具索引）
  }
  get active() { return !!this.net; }
  get code() { return this.net ? this.net.code : ''; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this); }
  setStatus(s) { this.status = s; this.changed(); }
  slotName(slot) { const p = this.players.find((q) => q.slot === slot); return p ? p.name : `玩家 ${slot + 1}`; }

  // ---------------------------------------------------------------------
  // 大廳
  async create(name) {
    this.leave(true);
    this.net = new Net();
    this.bindNet();
    this.isHost = true;
    this.setStatus('正在建立房間……');
    try {
      await this.net.host();
    } catch (e) {
      this.leave(true);
      this.setStatus(netErrorText(e));
      throw e;
    }
    this.mySlot = 0;
    this.players = [{ slot: 0, id: this.net.peer.id, name, ready: true }];
    this.setStatus('');
  }

  async join(code, name) {
    this.leave(true);
    code = normalizeCode(code);
    if (code.length !== 5) { this.setStatus('房間代碼是 5 個英文字母或數字。'); throw new Error('bad code'); }
    this.net = new Net();
    this.bindNet();
    this.isHost = false;
    this.setStatus('正在連線……');
    try {
      await this.net.join(code);
    } catch (e) {
      this.leave(true);
      this.setStatus(netErrorText(e));
      throw e;
    }
    this.myName = name;
    this.net.broadcast({ t: 'hello', name });
    this.setStatus('已連線，等待房主……');
  }

  leave(silent) {
    clearInterval(this.hbTimer);
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    // 先拿掉 this.net 再關閉：關閉時觸發的「離開」事件就不會又跑一次離開流程
    const net = this.net;
    this.net = null;
    if (net) net.close();
    this.players = [];
    this.results = new Map();
    this.carried = new Map();
    this.inGame = false;
    this.game = null;
    if (!silent) this.setStatus('');
  }

  bindNet() {
    const net = this.net;
    // 心跳：用計時器送，畫面卡頓時連線也不會被誤判為中斷
    clearInterval(this.hbTimer);
    this.hbTimer = setInterval(() => { if (this.net === net) net.broadcast({ t: 'hb' }); }, 2000);
    net.on('msg', (m, from) => { if (this.net === net) this.onMsg(m, from); });
    net.on('leave', (id) => { if (this.net === net) this.onLeave(id); });
    net.on('error', (e) => { if (this.net === net && !this.inGame) this.setStatus(netErrorText(e)); });
  }

  // 房主只傳給已經在名單上的玩家（還沒打招呼的連線收不到遊戲資料）；玩家傳給房主
  bcast(m, except) {
    if (!this.net) return;
    if (!this.isHost) { this.net.broadcast(m); return; }
    for (const p of this.players) if (p.slot !== this.mySlot && p.id !== except) this.net.send(p.id, m);
  }

  lobbyMsg() { return { t: 'lobby', players: this.players.map(({ slot, id, name }) => ({ slot, id, name })), code: this.code }; }
  broadcastLobby() { this.bcast(this.lobbyMsg()); this.changed(); }

  // 房主：開始遊戲
  start(opts) {
    if (!this.isHost) return;
    this.startOpts = opts;
    this.began = false;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    for (const p of this.players) { p.ready = false; p.live = false; }
    this.results = new Map();
    this.carried = new Map();
    this.game = null;
    this.inGame = false;
    this.bcast({ t: 'start', ...opts });
    this.app.startMpGame(opts);
  }

  // 自己載入完成
  localReady() {
    if (this.isHost) {
      this.players[0].ready = true;
      this.checkAllReady();
    } else this.net.broadcast({ t: 'ready' });
  }
  checkAllReady() {
    if (!this.isHost || this.began || !this.startOpts) return;
    if (this.players.every((p) => p.ready)) {
      this.began = true;
      clearTimeout(this.readyTimer);
      this.bcast({ t: 'go' });
      this.app.mpBegin();
    } else if (!this.readyTimer) {
      // 有人卡在載入太久就先開始
      this.readyTimer = setTimeout(() => { this.readyTimer = null; for (const p of this.players) p.ready = true; this.checkAllReady(); }, 90000);
    }
  }

  slotOf(id) { const p = this.players.find((q) => q.id === id); return p ? p.slot : -1; }

  onLeave(id) {
    if (this.isHost) {
      const slot = this.slotOf(id);
      if (slot < 0) return;
      const r = this.game && this.game.remotes.get(slot);
      if (r && r.a) this.results.set(slot, { a: r.a, name: this.slotName(slot) });
      this.dropFuses(slot);
      this.players = this.players.filter((p) => p.id !== id);
      if (this.game) this.game.mpRemoveRemote(slot);
      this.broadcastLobby();
      this.bcast({ t: 'left', s: slot });
      if (this.game) this.game.mpPlayerLeft(slot);
      this.checkAllReady();
      if (this.game) this.checkEnd();
    } else if (id === this.net.hostId) {
      const g = this.game;
      this.leave(true);
      this.setStatus('房主已經離開，連線結束。');
      if (g && !g.over) g.mpHostLost();
    }
  }

  onMsg(m, from) {
    if (!m || typeof m !== 'object') return;
    this.lastMsg = performance.now();
    (this.seen || (this.seen = new Map())).set(from, this.lastMsg);
    const g = this.game;
    if (this.isHost) {
      const slot = this.slotOf(from);
      switch (m.t) {
        case 'hello': {
          if (this.inGame || this.startOpts) { this.net.send(from, { t: 'deny', reason: '遊戲已經開始了。' }); setTimeout(() => this.net && this.net.kick(from), 300); return; }
          if (this.players.some((p) => p.id === from)) { this.broadcastLobby(); return; }
          if (this.players.length >= MAX_PLAYERS) { this.net.send(from, { t: 'deny', reason: '房間已滿（最多 4 人）。' }); setTimeout(() => this.net && this.net.kick(from), 300); return; }
          let s = 1;
          while (this.players.some((p) => p.slot === s)) s++;
          this.players.push({ slot: s, id: from, name: String(m.name || '').slice(0, 12) || `玩家 ${s + 1}`, ready: false });
          this.players.sort((a, b) => a.slot - b.slot);
          this.broadcastLobby();
          return;
        }
        case 'ready': {
          const p = this.players.find((q) => q.id === from);
          if (p) p.ready = true;
          // 已經開始了才載入完：直接讓他開始
          if (p && this.began) this.net.send(from, { t: 'go' });
          this.checkAllReady();
          return;
        }
      }
      if (slot < 0 || !g) return;
      this.onGameMsg(m, slot, from);
    } else {
      switch (m.t) {
        case 'lobby':
          if (!Array.isArray(m.players)) return;
          this.players = m.players.slice(0, MAX_PLAYERS).filter((p) => p && Number.isInteger(p.slot) && p.slot >= 0 && p.slot < MAX_PLAYERS)
            .map((p) => ({ slot: p.slot, id: String(p.id), name: String(p.name || '').slice(0, 12) }));
          this.mySlot = this.slotOf(this.net.peer.id);
          this.setStatus('');
          return;
        case 'deny':
          this.leave(true);
          this.setStatus(m.reason || '無法加入房間。');
          return;
        case 'start':
          this.startOpts = m;
          this.began = false;
          this.game = null;
          this.inGame = false;
          this.app.startMpGame(m);
          return;
        case 'go':
          this.began = true;
          this.hostLive = false;
          this.app.mpBegin();
          return;
      }
      if (!g) return;
      this.onGameMsg(m, -1, from);
    }
  }

  // ---------------------------------------------------------------------
  // 遊戲中
  attach(game) {
    this.game = game;
    this.inGame = true;
    this.sendT = 0;
    this.endSent = false;
    // 載入期間離開的人
    for (const slot of [...game.remotes.keys()]) if (!this.players.some((p) => p.slot === slot)) game.mpRemoveRemote(slot);
  }

  // 房主：誰身上帶著哪些保險絲（被抓走、離開時要放回原處）
  carry(slot, i) {
    const list = this.carried.get(slot) || [];
    list.push(i);
    this.carried.set(slot, list);
  }
  useCarried(slot) {
    const list = this.carried.get(slot);
    if (!list || !list.length) return false;
    list.shift();
    return true;
  }
  dropFuses(slot) {
    const list = this.carried.get(slot);
    if (!this.isHost || !list || !list.length || !this.game) return;
    this.carried.delete(slot);
    for (const i of list) {
      this.bcast({ t: 'respawn', i });
      this.game.mpRespawnItem(i);
    }
    this.game.ui.hint('掉落的保險絲回到原本的地方了。', 3);
  }

  // 房主：所有人都被抓或逃出去了 → 結束
  checkEnd() {
    const g = this.game;
    if (!this.isHost || !g || this.endSent) return;
    const all = [{ slot: this.mySlot, a: g.mpStatus, n: this.slotName(this.mySlot) }];
    for (const p of this.players) {
      if (p.slot === this.mySlot) continue;
      const r = g.remotes.get(p.slot);
      all.push({ slot: p.slot, a: r ? r.a : 0, n: p.name });
    }
    if (all.every((p) => p.a !== 0)) {
      this.endSent = true;
      for (const [slot, v] of this.results) all.push({ slot, a: v.a, n: v.name });
      const res = all.map((p) => ({ s: p.slot, a: p.a, n: p.n }));
      this.bcast({ t: 'end', res });
      setTimeout(() => { if (this.game === g) g.mpEnd(res); }, 600);
    }
  }

  // 每格呼叫：定時送出自己的狀態；房主另外送女鬼與所有人的狀態
  tick(dt) {
    const g = this.game;
    if (!g || !this.net) return;
    // 玩家：遊戲開始後房主 45 秒沒消息就當作斷線（分頁被直接關掉時連線不一定會立刻報告中斷）
    if (!this.isHost && this.began && this.hostLive && performance.now() - this.lastMsg > 45000) {
      this.leave(true);
      this.setStatus('和房主的連線中斷了。');
      if (!g.over) g.mpHostLost();
      return;
    }
    // 房主：遊戲開始後玩家 60 秒沒消息就移出房間
    if (this.isHost && this.began) {
      const now = performance.now();
      for (const p of this.players) {
        if (p.slot === this.mySlot) continue;
        const t = this.seen && this.seen.get(p.id);
        if (t && p.live && now - t > 60000) { this.seen.delete(p.id); this.net.kick(p.id); this.net.conns.delete(p.id); this.onLeave(p.id); break; }
      }
    }
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const st = g.mpLocalState();
    if (this.isHost) {
      const list = [{ s: this.mySlot, ...st }];
      for (const r of g.remotes.values()) if (r.last) list.push({ s: r.slot, ...r.last });
      this.bcast({ t: 'sts', l: list });
      this.bcast(g.ghostNetState());
    } else {
      this.net.broadcast({ t: 'st', ...st });
    }
  }

  send(m) { this.bcast(m); }

  onGameMsg(m, slot, from) {
    const g = this.game;
    // 房主只接受玩家能送的訊息；其餘（女鬼、結果、世界事件）只能由房主發出
    if (this.isHost && !HOST_ACCEPTS.has(m.t)) return;
    switch (m.t) {
      // 玩家狀態
      case 'st':
        if (this.isHost && slot >= 0) {
          const pl = this.players.find((q) => q.slot === slot);
          if (pl) pl.live = true;
          const c = cleanState(m);
          g.mpApplyState(slot, c);
          const r = g.remotes.get(slot);
          if (r) r.last = { ...c, a: r.a };
          if (r && r.a !== 0) this.checkEnd();
        }
        break;
      case 'sts':
        this.hostLive = true;
        if (!Array.isArray(m.l)) break;
        for (const s of m.l.slice(0, MAX_PLAYERS)) if (s && Number.isInteger(s.s) && s.s !== this.mySlot) g.mpApplyState(s.s, cleanState(s));
        break;
      case 'gh':
        if (!this.isHost) g.ghost.applyNet(m);
        break;
      // 門
      case 'door': {
        // 房主把最後套用的狀態傳給所有人（包括送的人），同時開關門時大家才會一致
        const d = g.mpApplyDoor(m);
        if (d && this.isHost) this.bcast(d);
        break;
      }
      // 撿東西：玩家請求 → 房主決定給誰
      case 'pick':
        if (this.isHost) g.mpHostPick(m.i, slot);
        break;
      case 'took':
        g.mpTook(m.i, m.by);
        break;
      case 'respawn':
        g.mpRespawnItem(m.i);
        break;
      // 保險絲
      case 'fuse':
        if (this.isHost) g.mpHostFuse(slot);
        break;
      case 'fuses':
        g.mpApplyFuse(m.n, m.by);
        break;
      // 聲音吸引她、閃光定住她
      case 'noise':
        if (this.isHost && [m.x, m.z, m.r].every(Number.isFinite)) g.makeNoise(m.x, m.z, Math.min(30, m.r), String(m.k || ''));
        break;
      case 'stun':
        if (this.isHost) {
          const r = g.remotes.get(slot), gh = g.ghost;
          // 簡單檢查：閃光的人要在她附近
          if (r && r.a === 0 && Math.hypot(r.pos.x - gh.pos.x, r.pos.z - gh.pos.z) < 13 && gh.stun()) this.net.send(from, { t: 'stunned' });
        }
        break;
      case 'stunned':
        g.stats.stuns++;
        g.ui.hint('她被閃光定住了——快跑！', 2.5);
        break;
      // 被抓
      case 'caught':
        if (!this.isHost && m.s === this.mySlot && g.mpStatus === 0 && !g.dying && !g.over) g.onCaught(!!m.lk, g.player);
        break;
      // 音效、世界事件
      case 'sfx':
        if (!NET_SFX.has(m.n) || ![m.x, m.z].every(Number.isFinite)) return;
        const sfx = { t: 'sfx', n: m.n, x: num(m.x, -500, 500), y: num(m.y, -5, 10, 1), z: num(m.z, -500, 500) };
        g.audio.play(sfx.n, { pos: { x: sfx.x, y: sfx.y, z: sfx.z } });
        if (this.isHost) this.bcast(sfx, from);
        break;
      case 'ev':
        g.mpApplyEvent(m);
        break;
      case 'left':
        if (!Number.isInteger(m.s)) break;
        g.mpRemoveRemote(m.s);
        g.mpPlayerLeft(m.s);
        break;
      case 'end':
        if (Array.isArray(m.res)) g.mpEnd(m.res.slice(0, 8).filter((p) => p && Number.isInteger(p.s)).map((p) => ({ s: p.s, a: p.a === 2 ? 2 : 1, n: String(p.n || '').slice(0, 12) })));
        break;
    }
  }
}

// ---------------------------------------------------------------------
// 其他玩家的人物：有正式模型就用模型，沒有就用簡單的人形
export function makeFallbackAvatar(slot) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: SLOT_COLORS[slot], roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8a888, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), mat);
  body.position.y = 1.15;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.55, 4, 8), dark);
  legs.position.y = 0.48;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
  head.position.y = 1.62;
  root.add(body, legs, head);
  const lightSocket = new THREE.Object3D();
  lightSocket.position.set(0.22, 1.25, 0.25);
  root.add(lightSocket);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let t = 0;
  return {
    root, lightSocket,
    update(dt, { speed = 0, crouch = false, dead = false } = {}) {
      t += dt * (1 + speed * 2);
      body.position.y = (crouch ? 0.85 : 1.15) + Math.abs(Math.sin(t * 3)) * 0.02 * Math.min(1, speed);
      head.position.y = crouch ? 1.3 : 1.62;
      legs.scale.y = crouch ? 0.6 : 1;
      root.rotation.z = dead ? Math.PI / 2 : 0;
    },
    setFlashlight() {},
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); skin.dispose(); dark.dispose(); },
  };
}

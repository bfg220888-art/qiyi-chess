// 多人連線（最多 4 人）：房主是權威端，負責女鬼 AI、導演的實體事件、道具與保險絲的歸屬；
// 每個人在自己的電腦上移動自己的角色，每秒 15 次把位置傳給房主，房主再轉給其他人。
// 大家用同一組種子、難度、地圖產生一模一樣的醫院，所以門、道具、鐵櫃都用索引對應。
import * as THREE from 'three';
import { Net, normalizeCode, netErrorText } from './net.js';

export const MAX_PLAYERS = 4;
export const SLOT_COLORS = [0xd9534f, 0x4a90d9, 0x5cb85c, 0xe8c547];
export const SLOT_CSS = ['#e0645f', '#5aa0e6', '#6cc86c', '#f0d050'];
const SEND_HZ = 15;
const NET_SFX = new Set(['bottleBreak']);
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
    if (this.net) this.net.close();
    this.net = null;
    this.players = [];
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

  lobbyMsg() { return { t: 'lobby', players: this.players.map(({ slot, id, name }) => ({ slot, id, name })), code: this.code }; }
  broadcastLobby() { this.net.broadcast(this.lobbyMsg()); this.changed(); }

  // 房主：開始遊戲
  start(opts) {
    if (!this.isHost) return;
    this.startOpts = opts;
    this.began = false;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    for (const p of this.players) p.ready = false;
    this.net.broadcast({ t: 'start', ...opts });
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
      this.net.broadcast({ t: 'go' });
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
      this.players = this.players.filter((p) => p.id !== id);
      if (this.game) this.game.mpRemoveRemote(slot);
      this.broadcastLobby();
      this.net.broadcast({ t: 'left', s: slot });
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
          if (this.inGame || this.startOpts && this.app.state !== 'menu') { this.net.send(from, { t: 'deny', reason: '遊戲已經開始了。' }); setTimeout(() => this.net && this.net.kick(from), 300); return; }
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
          this.checkAllReady();
          return;
        }
      }
      if (slot < 0 || !g) return;
      this.onGameMsg(m, slot, from);
    } else {
      switch (m.t) {
        case 'lobby':
          this.players = m.players;
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
          this.app.startMpGame(m);
          return;
        case 'go':
          this.began = true;
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
    this.states = new Map(); // slot → 最新狀態（房主收集）
  }

  // 房主：所有人都被抓或逃出去了 → 結束
  checkEnd() {
    const g = this.game;
    if (!this.isHost || !g || this.endSent) return;
    const all = [{ slot: this.mySlot, a: g.mpStatus }];
    for (const r of g.remotes.values()) all.push({ slot: r.slot, a: r.a });
    if (all.length && all.every((p) => p.a !== 0)) {
      this.endSent = true;
      const res = all.map((p) => ({ s: p.slot, a: p.a }));
      this.net.broadcast({ t: 'end', res });
      setTimeout(() => { if (this.game === g) g.mpEnd(res); }, 600);
    }
  }

  // 每格呼叫：定時送出自己的狀態；房主另外送女鬼與所有人的狀態
  tick(dt) {
    const g = this.game;
    if (!g || !this.net) return;
    // 玩家：房主 20 秒沒消息就當作斷線（分頁被直接關掉時連線不一定會立刻報告中斷）
    if (!this.isHost && this.began && performance.now() - (this.lastMsg || performance.now()) > 20000) {
      this.leave(true);
      this.setStatus('和房主的連線中斷了。');
      if (!g.over) g.mpHostLost();
      return;
    }
    // 房主：玩家 30 秒沒消息就移出房間
    if (this.isHost && this.began) {
      const now = performance.now();
      for (const p of this.players) {
        if (p.slot === this.mySlot) continue;
        const t = this.seen && this.seen.get(p.id);
        if (t && now - t > 30000) { this.seen.delete(p.id); this.net.kick(p.id); this.net.conns.delete(p.id); this.onLeave(p.id); break; }
      }
    }
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const st = g.mpLocalState();
    if (this.isHost) {
      const list = [{ s: this.mySlot, ...st }];
      for (const r of g.remotes.values()) if (r.last) list.push({ s: r.slot, ...r.last });
      this.net.broadcast({ t: 'sts', l: list });
      this.net.broadcast(g.ghostNetState());
    } else {
      this.net.broadcast({ t: 'st', ...st });
    }
  }

  send(m) { if (this.net) this.net.broadcast(m); }

  onGameMsg(m, slot, from) {
    const g = this.game;
    // 房主只接受玩家能送的訊息；其餘（女鬼、結果、世界事件）只能由房主發出
    if (this.isHost && !HOST_ACCEPTS.has(m.t)) return;
    switch (m.t) {
      // 玩家狀態
      case 'st':
        if (this.isHost && slot >= 0) {
          g.mpApplyState(slot, m);
          const r = g.remotes.get(slot);
          if (r) r.last = { x: m.x, z: m.z, y: m.y, p: m.p, f: m.f, h: m.h, c: m.c, v: m.v, a: m.a, b: m.b, sa: m.sa, hb: m.hb };
          if (m.a !== 0) this.checkEnd();
        }
        break;
      case 'sts':
        for (const s of m.l) if (s.s !== this.mySlot) g.mpApplyState(s.s, s);
        break;
      case 'gh':
        if (!this.isHost) g.ghost.applyNet(m);
        break;
      // 門
      case 'door':
        g.mpApplyDoor(m);
        if (this.isHost) this.net.broadcast(m, from);
        break;
      // 撿東西：玩家請求 → 房主決定給誰
      case 'pick':
        if (this.isHost) g.mpHostPick(m.i, slot);
        break;
      case 'took':
        g.mpTook(m.i, m.by);
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
        if (this.isHost && g.ghost.stun()) this.net.send(from, { t: 'stunned' });
        break;
      case 'stunned':
        g.stats.stuns++;
        g.ui.hint('她被閃光定住了——快跑！', 2.5);
        break;
      // 被抓
      case 'caught':
        if (!this.isHost && m.s === this.mySlot) g.onCaught(!!m.lk, g.player);
        break;
      // 音效、世界事件
      case 'sfx':
        if (!NET_SFX.has(m.n) || ![m.x, m.z].every(Number.isFinite)) return;
        g.audio.play(m.n, { pos: { x: m.x, y: Number.isFinite(m.y) ? m.y : 1, z: m.z } });
        if (this.isHost) this.net.broadcast(m, from);
        break;
      case 'ev':
        g.mpApplyEvent(m);
        break;
      case 'left':
        g.mpRemoveRemote(m.s);
        g.mpPlayerLeft(m.s);
        break;
      case 'end':
        g.mpEnd(m.res);
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

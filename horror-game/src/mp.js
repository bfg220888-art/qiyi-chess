// 多人連線（最多 4 人）：房主是權威端，負責女鬼 AI、導演的實體事件、道具與保險絲的歸屬；
// 每個人在自己的電腦上移動自己的角色，每秒 15 次把位置傳給房主，房主再轉給其他人。
// 大家用同一組種子、難度、地圖產生一模一樣的醫院，所以門、道具、鐵櫃都用索引對應。
// 多層樓（普通 2 層、惡夢 3 層）：門、道具、事件、音效的訊息另外帶樓層索引 f，玩家與女鬼的狀態帶 fl。
import * as THREE from 'three';
import { Net, normalizeCode, netErrorText } from './net.js';
import { SLOT_COLORS } from './player-model.js';
import { DIFFICULTY, MP_FLOORS } from './config.js';
import { THEMES, RANDOM_THEME } from './themes.js';

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
    fl: Number.isInteger(m.fl) && m.fl >= 0 && m.fl < 8 ? m.fl : 0, // 樓層（遊戲裡再對照實際層數）
    dn: m.dn ? 1 : 0, // 倒地
    ck: Number.isInteger(m.ck) && m.ck >= 0 && m.ck < 16 ? m.ck : -1, // 正在轉哪一道鐵捲門的把手（那一層的索引）
  };
}
// 房間設定（房主在大廳裡隨時可以改，隨大廳訊息送給所有人；開始訊息也帶同一組）：
//   difficulty 難度、theme 地圖（'random' 或樓層主題）、floors 樓層數（0 = 依難度自動，或 1～3）、revive 倒地救援
export const ROOM_DEFAULT = Object.freeze({ difficulty: 'normal', theme: RANDOM_THEME, floors: 0, revive: true });
// 從網路或存檔讀到的房間設定：每一欄都對照允許的值，不合法的那一欄保留 base 原本的值（不可信任的輸入）
export function cleanRoom(o, base = ROOM_DEFAULT) {
  const r = { difficulty: base.difficulty, theme: base.theme, floors: base.floors, revive: base.revive };
  if (!o || typeof o !== 'object') return r;
  if (typeof o.difficulty === 'string' && Object.hasOwn(DIFFICULTY, o.difficulty)) r.difficulty = o.difficulty;
  if (o.theme === RANDOM_THEME || (typeof o.theme === 'string' && Object.hasOwn(THEMES, o.theme))) r.theme = o.theme;
  if ([0, 1, 2, 3].includes(o.floors)) r.floors = o.floors;
  if (typeof o.revive === 'boolean') r.revive = o.revive;
  return r;
}
// 實際的樓層數：房主指定，或依難度（簡單 1、普通 2、惡夢 3）
export const roomFloors = (r) => r.floors || MP_FLOORS[r.difficulty];
const pct = (v) => (Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0);
const HOST_ACCEPTS = new Set(['st', 'door', 'pick', 'fuse', 'noise', 'stun', 'sfx', 'unlock', 'relic', 'rv', 'sync']);

export class MP {
  constructor(app) {
    this.app = app;
    this.net = null;
    this.players = []; // { slot, id, name, ready, prog（載入進度 0～100） }
    this.room = cleanRoom(null); // 房間設定（房主決定，其他人唯讀）
    this.round = 0; // 第幾局（房主每次開始加一；「載入完成」要帶同一個號碼才算數）
    this.kicked = new Set(); // 房主：被移出房間的連線 id（不再接受它的招呼）
    this.mySlot = 0;
    this.isHost = false;
    this.inGame = false;
    this.listeners = new Set();
    this.status = '';
    this.results = new Map(); // 中途離開的人的結果（slot → { a, name }）
    this.carried = new Map(); // 房主：slot → 身上的保險絲、門禁卡、遺物（道具索引）
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
    this.players = [{ slot: 0, id: this.net.peer.id, name, ready: true, prog: 0 }];
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
    this.startOpts = null;
    this.began = false;
    this.kicked = new Set();
    clearTimeout(this.progTimer);
    this.progTimer = null;
    if (!silent) this.setStatus('');
  }

  // 一局結束、回到大廳：清掉這一局的狀態，房間（名單、設定）留著
  endRound() {
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.inGame = false;
    this.game = null;
    this.began = false;
    this.startOpts = null;
    this.results = new Map();
    this.carried = new Map();
    for (const p of this.players) { p.ready = p.slot === this.mySlot; p.prog = 0; p.live = false; }
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

  lobbyMsg() { return { t: 'lobby', players: this.players.map(({ slot, id, name }) => ({ slot, id, name })), code: this.code, room: { ...this.room } }; }
  broadcastLobby() { this.bcast(this.lobbyMsg()); this.changed(); }

  // 房主：在大廳裡改房間設定（一局進行中不能改），馬上送給所有人
  setRoom(patch) {
    if (!this.isHost || !this.net || this.startOpts) return false;
    this.room = cleanRoom(patch, this.room);
    this.broadcastLobby();
    return true;
  }
  // 房主：把一個人移出房間（只在大廳裡）
  kick(slot) {
    if (!this.isHost || !this.net || this.startOpts) return;
    const p = this.players.find((q) => q.slot === slot);
    if (!p || p.slot === this.mySlot) return;
    const id = p.id, net = this.net;
    this.kicked.add(id);
    net.send(id, { t: 'deny', reason: '你被房主移出房間了。' });
    setTimeout(() => { if (this.net === net) net.kick(id); }, 300);
    this.onLeave(id);
  }
  // 房主：用目前的房間設定開始一局（遊戲中呼叫 = 重新開始這一局，新的種子）
  startRound() {
    if (!this.isHost || !this.net) return;
    // np：開局時的人數（2 人以上才有雙人鐵捲門；每個人都用這個數字生成同一棟醫院）；rd：第幾局
    this.start({ ...this.room, seed: (Math.random() * 2 ** 31) | 0, np: this.players.length, rd: ++this.round });
  }
  // 房主：遊戲中把所有人帶回大廳（房間留著，可以改設定再開始）
  backToLobby() {
    if (!this.isHost || !this.net || !this.startOpts) return;
    this.bcast({ t: 'back' });
    this.app.mpBackToLobby('');
  }

  // 房主：開始遊戲
  start(opts) {
    if (!this.isHost) return;
    this.startOpts = opts;
    this.began = false;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    for (const p of this.players) { p.ready = false; p.live = false; p.prog = 0; }
    this.results = new Map();
    this.carried = new Map();
    this.game = null;
    this.inGame = false;
    this.bcast({ t: 'start', ...opts });
    this.app.startMpGame(opts);
  }

  // 自己載入完成
  localReady() {
    const me = this.players.find((p) => p.slot === this.mySlot);
    if (me) { me.ready = true; me.prog = 100; }
    if (this.isHost) {
      this.queueProgress();
      this.checkAllReady();
    } else this.net.broadcast({ t: 'ready', rd: this.round });
    this.changed();
  }
  // 自己的載入進度（0～1）：每多 4% 才送一次，載入畫面上每個人都看得到「載入中 62%」
  localProgress(p) {
    if (!this.net) return;
    const v = pct(p * 100), me = this.players.find((q) => q.slot === this.mySlot);
    if (!me || me.ready || (v < 100 && v - (me.prog || 0) < 4)) return;
    me.prog = v;
    if (this.isHost) this.queueProgress();
    else this.net.broadcast({ t: 'prog', p: v });
    this.changed();
  }
  // 房主：把所有人的載入進度轉給大家（最多每 0.25 秒一次）
  queueProgress() {
    if (!this.isHost || this.progTimer) return;
    this.progTimer = setTimeout(() => {
      this.progTimer = null;
      if (!this.net || !this.startOpts) return;
      this.bcast({ t: 'prog', l: this.players.map((p) => [p.slot, p.ready ? 100 : pct(p.prog), p.ready ? 1 : 0]) });
      this.changed();
    }, 250);
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
      this.setStatus('房主離開了，房間已經關閉。請重新建立或加入房間。');
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
          if (this.kicked.has(from)) return;
          if (this.inGame || this.startOpts) { this.net.send(from, { t: 'deny', reason: '遊戲已經開始了。' }); setTimeout(() => this.net && this.net.kick(from), 300); return; }
          if (this.players.some((p) => p.id === from)) { this.broadcastLobby(); return; }
          if (this.players.length >= MAX_PLAYERS) { this.net.send(from, { t: 'deny', reason: '房間已滿（最多 4 人）。' }); setTimeout(() => this.net && this.net.kick(from), 300); return; }
          let s = 1;
          while (this.players.some((p) => p.slot === s)) s++;
          this.players.push({ slot: s, id: from, name: String(m.name || '').slice(0, 12) || `玩家 ${s + 1}`, ready: false, prog: 0 });
          this.players.sort((a, b) => a.slot - b.slot);
          this.broadcastLobby();
          return;
        }
        case 'prog': {
          // 玩家的載入進度（只在一局開始後、他還沒載入完時有意義）
          const p = this.players.find((q) => q.id === from);
          if (!p || !this.startOpts || p.ready || !Number.isFinite(m.p)) return;
          p.prog = pct(m.p);
          this.queueProgress();
          return;
        }
        case 'ready': {
          const p = this.players.find((q) => q.id === from);
          // 上一局才送出的「載入完成」不算（房主剛按了重新開始）
          if (!p || !this.startOpts || m.rd !== this.round) return;
          p.ready = true;
          p.prog = 100;
          this.queueProgress();
          // 已經開始了才載入完：直接讓他開始，並送上現在的世界狀態（開了的鎖、拿走的道具、保險絲、遺物、門、鐵捲門……）
          if (p && this.began) {
            this.net.send(from, { t: 'go' });
            if (g) this.net.send(from, g.mpSnapshot());
          }
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
            .map((p) => { const old = this.players.find((q) => q.slot === p.slot && q.id === String(p.id)); return { slot: p.slot, id: String(p.id), name: String(p.name || '').slice(0, 12), ready: !!(old && old.ready), prog: old ? old.prog || 0 : 0 }; });
          this.mySlot = this.slotOf(this.net.peer.id);
          // 房間設定：只接受允許的值，其餘欄位維持原樣
          if (Object.hasOwn(m, 'room')) this.room = cleanRoom(m.room, this.room);
          this.setStatus('');
          return;
        case 'deny':
          this.leave(true);
          this.setStatus(typeof m.reason === 'string' && m.reason ? m.reason.slice(0, 60) : '無法加入房間。');
          return;
        case 'start':
          this.startOpts = m;
          this.began = false;
          this.game = null;
          this.inGame = false;
          this.round = Number.isInteger(m.rd) && m.rd >= 0 && m.rd < 1e9 ? m.rd : 0;
          this.room = cleanRoom(m, this.room);
          for (const p of this.players) { p.ready = false; p.prog = 0; }
          this.app.startMpGame(m);
          return;
        // 每個人的載入進度（[位置, 百分比, 是否載入完]）
        case 'prog':
          if (!Array.isArray(m.l)) return;
          for (const e of m.l.slice(0, MAX_PLAYERS)) {
            if (!Array.isArray(e) || !Number.isInteger(e[0])) continue;
            const p = this.players.find((q) => q.slot === e[0]);
            if (!p || p.slot === this.mySlot) continue;
            p.prog = pct(e[1]);
            p.ready = e[2] === 1;
          }
          this.changed();
          return;
        // 房主把所有人帶回大廳（房間還在）
        case 'back':
          if (this.startOpts) this.app.mpBackToLobby('房主把大家帶回大廳了。');
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
    // 玩家：載入完才接上遊戲，這之前房主送的世界事件都收不到 → 跟房主要一份現在的世界狀態
    if (!this.isHost && this.net) this.net.broadcast({ t: 'sync' });
  }

  // 房主：誰身上帶著哪些重要道具（{ f: 樓層, i: 道具索引, k: 種類, c: 門禁卡顏色, r: 遺物 }；被抓走、離開時要放回原處）
  carry(slot, e) {
    const list = this.carried.get(slot) || [];
    list.push(e);
    this.carried.set(slot, list);
  }
  // 用掉一個符合條件的（插保險絲、刷卡、放遺物）；身上沒有就回傳 null（拒絕）
  useCarried(slot, pred = () => true) {
    const list = this.carried.get(slot);
    const k = list ? list.findIndex(pred) : -1;
    if (k < 0) return null;
    return list.splice(k, 1)[0];
  }
  dropFuses(slot) {
    const list = this.carried.get(slot);
    if (!this.isHost || !list || !list.length || !this.game) return;
    this.carried.delete(slot);
    for (const e of list) {
      this.bcast({ t: 'respawn', f: e.f, i: e.i });
      this.game.mpRespawnItem(e.f, e.i);
    }
    const kinds = { fuse: '保險絲', keycard: '門禁卡', relic: '遺物' };
    this.game.ui.hint(`掉落的${[...new Set(list.map((e) => kinds[e.k] || '東西'))].join('、')}回到原本的地方了。`, 3);
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
      // 晚到的人：房主送一份現在的世界狀態（只在玩家這邊套用，每一項都核對）
      case 'sync':
        if (this.isHost && slot >= 0) this.net.send(from, g.mpSnapshot());
        break;
      case 'snap':
        if (!this.isHost) g.mpApplySnapshot(m);
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
        if (this.isHost) g.mpHostPick(m.f, m.i, slot);
        break;
      case 'took':
        g.mpTook(m.f, m.i, m.by);
        break;
      case 'respawn':
        g.mpRespawnItem(m.f, m.i);
        break;
      // 保險絲
      case 'fuse':
        if (this.isHost) g.mpHostFuse(slot);
        break;
      case 'fuses':
        g.mpApplyFuse(m.n, m.by);
        break;
      // 門禁卡：玩家請求刷卡 → 房主核對 → 大家一起開鎖
      case 'unlock':
        if (this.isHost) g.mpHostUnlock(m.f, m.i, slot);
        break;
      case 'unlocked':
        g.mpApplyUnlock(m.f, m.i, m.by);
        break;
      // 遺物：玩家請求放回搖籃 → 房主核對 → 大家一起套用（第三件放回去時每個人都會看到儀式）
      case 'relic':
        if (this.isHost) g.mpHostRelic(m.r, slot);
        break;
      case 'relics':
        g.mpApplyRelic(m.r, m.by);
        break;
      // 倒地與扶起：玩家每 0.2 秒說一次「我在扶某某」→ 房主核對距離、同一層、連續 3 秒 → 大家一起套用
      case 'rv':
        if (this.isHost) g.mpHostRevive(m.s, slot);
        break;
      case 'revived':
        g.mpApplyRevived(m.s, m.by);
        break;
      case 'taken':
        if (m.s === this.mySlot && g.downed) g.mpTakeDowned();
        break;
      // 雙人鐵捲門：只有房主決定開或關
      case 'shut':
        g.mpApplyShutter(m.f, m.i, m.o, m.j);
        break;
      case 'shuts':
        if (Array.isArray(m.l)) for (const e of m.l.slice(0, 16)) if (Array.isArray(e)) g.mpApplyShutter(e[0], e[1], e[2], e[3]);
        break;
      // 聲音吸引她、閃光定住她
      case 'noise':
        if (this.isHost && [m.x, m.z, m.r].every(Number.isFinite) && g.mpFloor(m.f)) g.makeNoise(m.x, m.z, Math.min(30, m.r), String(m.k || ''), m.f);
        break;
      case 'stun':
        if (this.isHost) {
          const r = g.remotes.get(slot), gh = g.ghost;
          // 簡單檢查：閃光的人要在她附近
          if (r && r.a === 0 && r.floor === gh.floor && Math.hypot(r.pos.x - gh.pos.x, r.pos.z - gh.pos.z) < 13 && gh.stun()) this.net.send(from, { t: 'stunned' });
        }
        break;
      case 'stunned':
        g.stats.stuns++;
        g.ui.hint('她被閃光定住了——快跑！', 2.5);
        break;
      // 被抓
      case 'caught':
        if (!this.isHost && m.s === this.mySlot && g.mpStatus === 0 && !g.dying && !g.downed && !g.over) g.onCaught(!!m.lk, g.player);
        break;
      // 音效、世界事件
      case 'sfx':
        if (!NET_SFX.has(m.n) || ![m.x, m.z].every(Number.isFinite) || !g.mpFloor(m.f)) return;
        const sfx = { t: 'sfx', f: m.f, n: m.n, x: num(m.x, -500, 500), y: num(m.y, -5, 10, 1), z: num(m.z, -500, 500) };
        if (sfx.f === g.floorIdx) g.audio.play(sfx.n, { pos: { x: sfx.x, y: sfx.y, z: sfx.z } });
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
  // 倒地爬行用的手臂（平常藏起來）
  const arms = [1, -1].map((sx) => {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), mat);
    a.visible = false;
    a.userData.sx = sx;
    return a;
  });
  root.add(body, legs, head, ...arms);
  const lightSocket = new THREE.Object3D();
  lightSocket.position.set(0.22, 1.25, 0.25);
  root.add(lightSocket);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let t = 0, ct = 0;
  return {
    root, lightSocket,
    update(dt, { speed = 0, crouch = false, dead = false, crawl = false } = {}) {
      t += dt * (1 + speed * 2);
      root.rotation.z = dead ? Math.PI / 2 : 0;
      for (const a of arms) a.visible = crawl;
      this.crawlW = crawl ? 1 : 0;
      if (crawl) {
        // 趴在地上（頭朝前）：雙手往前交替划，不動時停著
        if (speed > 0.05) ct += dt * speed * 6;
        body.rotation.x = legs.rotation.x = Math.PI / 2;
        body.position.set(0, 0.22, 0.05);
        legs.position.set(0, 0.16, -0.6);
        legs.scale.y = 1;
        head.position.set(0, 0.3, 0.55);
        for (const a of arms) {
          const k = 0.5 + 0.5 * Math.sin(ct + (a.userData.sx > 0 ? 0 : Math.PI));
          a.rotation.set(Math.PI / 2 - 0.25, 0, 0);
          a.position.set(a.userData.sx * 0.24, 0.15, 0.45 + 0.25 * k);
        }
        return;
      }
      body.rotation.x = legs.rotation.x = 0;
      body.position.set(0, (crouch ? 0.85 : 1.15) + Math.abs(Math.sin(t * 3)) * 0.02 * Math.min(1, speed), 0);
      legs.position.set(0, 0.48, 0);
      head.position.set(0, crouch ? 1.3 : 1.62, 0);
      legs.scale.y = crouch ? 0.6 : 1;
    },
    setFlashlight() {},
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); skin.dispose(); dark.dispose(); },
  };
}

// 連線層：用 PeerJS（WebRTC 點對點）建立房間。房主的 ID 是「silentward-房間代碼」，
// 其他人用代碼連過去；遊戲資料只在玩家之間傳，PeerJS 的公用伺服器只負責牽線。
// 網址加 ?peer=主機:埠 可以改用自己的配對伺服器（測試時用本機的 peer 伺服器）。
import { Peer } from 'peerjs';

const PREFIX = 'silentward-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export function normalizeCode(s) {
  // NFKC：全形字母與數字（ＡＢ１２）轉成半形
  return String(s || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function peerOptions() {
  // 只有在本機開發 / 測試時才允許改用別的配對伺服器（避免被惡意連結導到別人的伺服器）
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const q = local ? new URLSearchParams(location.search).get('peer') : null;
  if (q) {
    const [host, port] = q.split(':');
    return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0, config: { iceServers: [] } };
  }
  return { debug: 0 };
}

const ERRORS = {
  'peer-unavailable': '找不到這個房間（代碼錯了，或房主已經離開）。',
  'unavailable-id': '房間代碼已被使用。',
  network: '連不上配對伺服器，請檢查網路。',
  'server-error': '配對伺服器出錯，請稍後再試。',
  'browser-incompatible': '這個瀏覽器不支援連線遊玩（WebRTC）。',
  disconnected: '和配對伺服器的連線中斷了。',
  'socket-error': '連不上配對伺服器，請檢查網路。',
  'socket-closed': '和配對伺服器的連線中斷了。',
  'webrtc': '連線建立失敗（可能是網路防火牆擋住了點對點連線）。',
};
export const netErrorText = (e) => ERRORS[e && e.type] || `連線錯誤：${(e && (e.type || e.message)) || e}`;

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map(); // 對方 peer id → DataConnection
    this.handlers = { msg: [], join: [], leave: [], error: [] };
    this.isHost = false;
    this.code = '';
  }
  on(ev, fn) { this.handlers[ev].push(fn); }
  emit(ev, ...a) { for (const fn of this.handlers[ev]) { try { fn(...a); } catch (e) { console.error(e); } } }

  openPeer(id) {
    return new Promise((resolve, reject) => {
      const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      const fail = (e) => { cleanup(); try { p.destroy(); } catch (x) { /* 已關閉 */ } reject(e); };
      const ok = () => { cleanup(); resolve(p); };
      const cleanup = () => { p.off('open', ok); p.off('error', fail); clearTimeout(timer); };
      const timer = setTimeout(() => fail({ type: 'network' }), 15000);
      p.on('open', ok);
      p.on('error', fail);
    });
  }

  attachPeerErrors() {
    this.peer.on('error', (e) => this.emit('error', e));
    const p = this.peer;
    p.on('disconnected', () => {
      // 和配對伺服器斷線不影響已建立的點對點連線；試著重連，讓之後的人還能加入
      // （自己關閉時 PeerJS 也會先觸發這個事件，那時不能重連）
      try { if (this.peer === p && !this.closing && !p.destroyed) p.reconnect(); } catch (e) { /* 忽略 */ }
    });
  }

  // 建立房間（房主）
  async host() {
    this.isHost = true;
    for (let tries = 0; tries < 4; tries++) {
      const code = makeRoomCode();
      try {
        this.peer = await this.openPeer(PREFIX + code);
        this.code = code;
        break;
      } catch (e) {
        if (e.type !== 'unavailable-id' || tries === 3) throw e;
      }
    }
    this.attachPeerErrors();
    this.peer.on('connection', (c) => {
      c.on('open', () => this.addConn(c));
    });
    return this.code;
  }

  // 加入房間
  async join(code) {
    this.isHost = false;
    this.code = normalizeCode(code);
    this.peer = await this.openPeer(null);
    this.attachPeerErrors();
    const c = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject({ type: 'peer-unavailable' }), 15000);
      const onErr = (e) => { clearTimeout(timer); reject(e); };
      this.peer.once('error', onErr);
      c.on('open', () => { clearTimeout(timer); this.peer.off('error', onErr); resolve(); });
      c.on('error', onErr);
    });
    this.addConn(c);
    this.hostId = c.peer;
  }

  addConn(c) {
    this.conns.set(c.peer, c);
    c.on('data', (d) => this.emit('msg', d, c.peer));
    c.on('close', () => { if (this.conns.get(c.peer) === c) { this.conns.delete(c.peer); this.emit('leave', c.peer); } });
    c.on('error', () => { /* close 會跟著觸發 */ });
    this.emit('join', c.peer);
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) { try { c.send(msg); } catch (e) { /* 連線剛斷 */ } }
  }
  // 房主：傳給所有人（可排除一個）；玩家：傳給房主
  broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(msg); } catch (e) { /* 連線剛斷 */ } }
  }
  kick(id) { const c = this.conns.get(id); if (c) c.close(); }

  close() {
    this.closing = true;
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* 已關閉 */ } }
    this.conns.clear();
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* 已關閉 */ } }
    this.peer = null;
  }
}

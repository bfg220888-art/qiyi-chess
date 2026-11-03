// 輸入整合：鍵盤滑鼠（含指標鎖定）、觸控搖桿與按鈕、遊戲手把
export class Input {
  constructor(canvas, touchLayer, settings) {
    this.canvas = canvas;
    this.touchLayer = touchLayer;
    this.settings = settings;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.actions = [];
    this.sprintTouch = false;
    this.crouchToggle = false;
    this.enabled = false;
    this.locked = false;
    this.dragLook = false;
    this.joy = null;
    this.lookTouch = null;
    this.padPrev = [];
    // 只有主要指標是手指時才用觸控模式（觸控筆電仍用滑鼠鍵盤）
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this.onLockChange = null;
    this.ctxKey = null;
    this.bind();
    this.applyTouchLayout();
  }

  // 按鍵配置：慣用手（左手 = 鏡像：搖桿在右、按鈕在左）與按鈕大小，掛在 <html> 的 class 上，
  // 字幕、拍立得等也會跟著讓位
  applyTouchLayout() {
    const S = this.settings, c = document.documentElement.classList;
    c.toggle('touch-ui', this.touchMode);
    c.toggle('th-left', S.touchLayout === 'left');
    for (const k of ['s', 'm', 'l']) c.toggle('th-' + k, (S.touchSize || 'm') === k);
    // 搖桿半徑也跟著按鈕大小
    this.joyR = { s: 50, m: 56, l: 64 }[S.touchSize] || 56;
    const base = document.getElementById('joy');
    if (base) base.style.setProperty('--jr', this.joyR + 'px');
  }
  // 開場的操作提示（依左右手配置）
  touchHelp() {
    const [a, b] = this.settings.touchLayout === 'left' ? ['右', '左'] : ['左', '右'];
    return `${a}邊拖曳移動，${b}邊滑動看四周。看著門、櫃子、物品時會出現大按鈕。`;
  }
  // 搖桿那一側：右手配置在左半邊，左手配置在右半邊
  joySide(x) { return this.settings.touchLayout === 'left' ? x > innerWidth * 0.55 : x < innerWidth * 0.45; }

  bind() {
    const map = {
      KeyE: 'interact', KeyF: 'flashlight', KeyQ: 'camera', KeyM: 'map', Tab: 'map', Escape: 'pause', KeyP: 'pause', KeyC: 'crouch', KeyG: 'throw',
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (map[e.code]) this.push(map[e.code]);
      if (e.code === 'Space' || e.code === 'Enter') this.push('confirm');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.sprintTouch = false; this.breathTouch = false; this.mouseHeld = false; this.interactTouch = false; });

    // 滑鼠
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (!this.locked) {
        this.requestLock();
        this.dragLook = true;
        return;
      }
      if (e.button === 0) { this.push('interact'); this.mouseHeld = true; }
      if (e.button === 2) this.push('camera');
      if (e.button === 1) { e.preventDefault(); this.push('throw'); }
    });
    addEventListener('mouseup', (e) => { this.dragLook = false; if (e.button === 0) this.mouseHeld = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (!this.locked && !this.dragLook) return;
      const mx = Math.max(-250, Math.min(250, e.movementX || 0));
      const my = Math.max(-250, Math.min(250, e.movementY || 0));
      const s = this.settings.mouseSens * 0.0022;
      this.look.x += mx * s;
      this.look.y += my * s;
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.lockFailed = false;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    // 觸控
    const L = this.touchLayer;
    L.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.touchMode) return;
      if (!this.enabled) return;
      const joySide = this.joySide(e.clientX);
      if (joySide && !this.joy) {
        // 浮動搖桿：拇指落在哪裡，搖桿就出現在哪裡
        this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        this.showJoy(true);
      } else if (!joySide && !this.lookTouch) {
        this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), lt: e.timeStamp, v: 0, moved: 0 };
      }
      try { L.setPointerCapture(e.pointerId); } catch (err) { /* 某些瀏覽器不支援 */ }
      e.preventDefault();
    });
    L.addEventListener('pointermove', (e) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy.x = e.clientX; this.joy.y = e.clientY;
        this.updateJoy();
      } else if (this.lookTouch && e.pointerId === this.lookTouch.id) {
        const T = this.lookTouch;
        const dx = e.clientX - T.x, dy = e.clientY - T.y;
        T.x = e.clientX; T.y = e.clientY;
        T.moved += Math.abs(dx) + Math.abs(dy);
        // 手指速度（像素／毫秒，平滑過）決定靈敏度曲線
        const dtm = Math.max(4, Math.min(100, e.timeStamp - T.lt));
        T.lt = e.timeStamp;
        T.v += (Math.hypot(dx, dy) / dtm - T.v) * 0.5;
        const s = this.settings.touchSens * 0.0055 * lookCurve(T.v, !!this.settings.touchAccel);
        this.look.x += dx * s;
        this.look.y += dy * s;
      }
      e.preventDefault();
    });
    const end = (e) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        this.move.x = this.move.y = 0;
        this.joySprint = false;
        this.showJoy(false);
      }
      if (this.lookTouch && e.pointerId === this.lookTouch.id) {
        // 輕點右半邊 = 互動
        if (this.lookTouch.moved < 10 && performance.now() - this.lookTouch.t < 250) this.push('tap');
        this.lookTouch = null;
      }
    };
    L.addEventListener('pointerup', end);
    L.addEventListener('pointercancel', end);
    L.addEventListener('lostpointercapture', end);

    // 觸控按鈕
    for (const btn of document.querySelectorAll('[data-action]')) {
      const act = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 抓住這根手指：按著時滑出按鈕外也不會中斷（按住救人、轉把手）
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 不支援 */ }
        buzz(8);
        if (act === 'sprint') { this.sprintTouch = true; btn.classList.add('on'); return; }
        if (act === 'breath') { this.breathTouch = true; btn.classList.add('on'); return; }
        if (act === 'interact') this.interactTouch = true; // 按住「互動」：救人、轉鐵捲門的把手
        this.push(act);
        btn.classList.add('press');
        setTimeout(() => btn.classList.remove('press'), 140);
      });
      const up = (e) => {
        if (act === 'sprint') { this.sprintTouch = false; btn.classList.remove('on'); }
        if (act === 'breath') { this.breathTouch = false; btn.classList.remove('on'); }
        if (act === 'interact') this.interactTouch = false;
        e.stopPropagation();
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  showJoy(on) {
    const base = document.getElementById('joy');
    if (!base) return;
    base.style.display = on ? 'block' : 'none';
    if (!on) base.classList.remove('run');
    const home = document.getElementById('joyHome');
    if (home && on) home.classList.add('used');
    if (on) {
      base.style.left = this.joy.ox + 'px';
      base.style.top = this.joy.oy + 'px';
      this.updateJoy();
    }
  }
  updateJoy() {
    const R = this.joyR || 56;
    let dx = this.joy.x - this.joy.ox, dy = this.joy.y - this.joy.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // 拇指拉太遠時，原點跟著移動
      this.joy.ox += (dx / d) * (d - R);
      this.joy.oy += (dy / d) * (d - R);
      dx = (dx / d) * R;
      dy = (dy / d) * R;
      const base = document.getElementById('joy');
      base.style.left = this.joy.ox + 'px';
      base.style.top = this.joy.oy + 'px';
    }
    const knob = document.getElementById('joyKnob');
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, Math.hypot(dx, dy) / R);
    const dead = 0.12;
    // 死區之後重新映射到 0..1，方向保持不變
    const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / mag;
    this.move.x = (dx / R) * k;
    this.move.y = (-dy / R) * k;
    // 推到底而且主要是往前：自動奔跑（搖桿外圈變紅、輕震一下）
    const run = mag > 0.96 && -dy > Math.abs(dx);
    if (run && !this.joySprint) buzz(12);
    this.joySprint = run;
    const base = document.getElementById('joy');
    if (base) {
      base.classList.toggle('run', run);
      base.style.setProperty('--mag', mag.toFixed(2));
    }
  }

  // 情境按鈕：看著可以互動的東西時才出現大按鈕，字跟著目標變（躲、上樓、撿起……）；
  // 每格由主迴圈呼叫，沒變就不碰 DOM
  syncTouch(game) {
    if (!this.touchMode) return;
    const btn = document.getElementById('tInteract');
    if (!btn) return;
    const t = game && !game.over ? game.target : null;
    const verb = t ? contextVerb(t) : '';
    const hold = !!t && (t.kind === 'crank' || t.kind === 'revive');
    const label = t && t.label ? String(t.label) : '';
    const key = verb + (hold ? '#' : '') + label;
    if (key === this.ctxKey) return;
    this.ctxKey = key;
    const b = btn.querySelector('b');
    if (b && verb) b.textContent = verb;
    // 小字：大字已經說過的開頭就不重複（「上樓：二樓」→「二樓」）
    const small = btn.querySelector('small');
    if (small && label) {
      small.textContent = label === verb ? '' : label.startsWith(verb + '：') ? label.slice(verb.length + 1) : label;
    }
    btn.classList.toggle('ctx-off', !verb);
    btn.classList.toggle('hold', hold);
    btn.setAttribute('aria-label', verb || '互動');
    if (verb) buzz(6);
  }

  requestLock() {
    if (this.touchMode) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch (e) { this.lockFailed = true; }
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  push(a) { this.actions.push(a); }

  // 每一格畫面取一次
  poll() {
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.sprintTouch || this.joySprint;
    let crouchHold = k.has('ControlLeft') || k.has('ControlRight');
    let holdBreath = k.has('Space') || !!this.breathTouch;
    // 按住互動鍵（E、滑鼠左鍵、觸控「互動」、手把 A）：扶起倒地的隊友、轉鐵捲門的把手
    let interactHold = k.has('KeyE') || !!this.mouseHeld || !!this.interactTouch;
    if (this.joy) { mx = this.move.x; my = this.move.y; }
    // 遊戲手把
    // 在沒有手把權限的 iframe 裡 getGamepads() 會丟例外
    let pads = [];
    if (!this.noPads) {
      try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { this.noPads = true; }
    }
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0);
      if (lx || ly) { mx = lx; my = -ly; }
      const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      const s = this.settings.touchSens * 0.045;
      this.look.x += rx * Math.abs(rx) * s;
      this.look.y += ry * Math.abs(ry) * s;
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const edge = (i, act) => { if (b(i) && !this.padPrev[i]) this.push(act); };
      edge(0, 'interact'); edge(1, 'crouch'); edge(2, 'flashlight'); edge(3, 'camera'); edge(5, 'throw');
      edge(8, 'map'); edge(9, 'pause'); edge(12, 'interact');
      if (b(6) || b(10)) sprint = true;
      if (b(4)) holdBreath = true;
      if (b(0)) interactHold = true;
      this.padPrev = pad.buttons.map((x) => x.pressed);
      break;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const look = { x: this.look.x, y: this.look.y * (this.settings.invertY ? -1 : 1) };
    this.look.x = this.look.y = 0;
    const actions = this.actions;
    this.actions = [];
    return { mx, my, sprint, crouchHold, holdBreath, interactHold, look, actions };
  }

  clear() {
    this.actions = [];
    this.look.x = this.look.y = 0;
    this.keys.clear();
    this.joy = null;
    this.lookTouch = null;
    this.sprintTouch = false;
    this.breathTouch = false;
    this.interactTouch = false;
    this.mouseHeld = false;
    this.joySprint = false;
    this.move.x = this.move.y = 0;
    this.showJoy(false);
    for (const b of document.querySelectorAll('#touch .tb.on')) b.classList.remove('on');
  }
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// 觸控視角曲線：慢慢拖時稍微放慢（好瞄準），一般速度 1 倍；
// 開「視角加速」後快速甩動最多再快 1 倍，轉身不用滑好幾次
export function lookCurve(v, accel) {
  let k = 0.75 + 0.25 * smooth(0.04, 0.45, v);
  if (accel) k *= 1 + smooth(0.7, 2.6, v);
  return k;
}

// 大按鈕上的字：依目標種類
export function contextVerb(t) {
  switch (t.kind) {
    case 'exitLocker': return '出櫃';
    case 'locker': return '躲';
    case 'door': return t.label === '關門' ? '關門' : '開門';
    case 'locked': return String(t.label || '').startsWith('刷') ? '刷卡' : '上鎖';
    case 'item': return t.item && t.item.kind === 'note' ? '閱讀' : '撿起';
    case 'crank': return '轉動';
    case 'revive': return '扶起';
    case 'stairs': return t.stair && t.stair.dir === 'up' ? '上樓' : '下樓';
    case 'altar': return String(t.label || '').startsWith('把') ? '放入' : '搖籃';
    case 'fusebox': return String(t.label || '').startsWith('插') ? '插上' : '查看';
    case 'phone': return String(t.label || '').startsWith('接') ? '接聽' : '電話';
    case 'gate': return '大門';
    default: return '互動';
  }
}

// 輕微觸覺回饋（只在觸控裝置；不支援就算了）
function buzz(ms) {
  if (!navigator.vibrate || !matchMedia('(pointer: coarse)').matches) return;
  try { navigator.vibrate(ms); } catch (e) { /* 不支援震動 */ }
}

// iOS Safari 的怪癖：連點兩下放大、雙指縮放、長按跳出選單／選取文字、整頁橡皮筋回彈
export function installTouchGuards() {
  const field = (el) => !!(el && el.closest && el.closest('input, textarea, select'));
  // 往上找可以捲動的容器（選單、設定面板、紙條），那裡的捲動要留著
  const scrollable = (el) => {
    for (let n = el && el.nodeType === 3 ? el.parentElement : el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return true;
    }
    return false;
  };
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    // 按鈕、選項不擋：連續快速點兩個不同的按鈕（例如「左手」再「大」）時，第二下不能被吃掉。
    // 按鈕上的連點放大已經由 CSS 的 touch-action: manipulation 關掉
    const ctl = e.target && e.target.closest && e.target.closest('button, a, label, [role="button"], [data-action]');
    if (now - lastEnd < 320 && !field(e.target) && !ctl && e.cancelable) e.preventDefault();
    lastEnd = now;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!e.cancelable) return;
    if (e.touches.length > 1 || (!field(e.target) && !scrollable(e.target))) e.preventDefault();
  }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // 房號要能長按選取複製
  document.addEventListener('selectstart', (e) => {
    const el = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
    if (!field(el) && !(el && el.closest && el.closest('.mp-code'))) e.preventDefault();
  });
  const touch = document.getElementById('touch');
  if (touch) touch.addEventListener('contextmenu', (e) => e.preventDefault());
}

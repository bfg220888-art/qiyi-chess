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
    this.touchMode = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    this.onLockChange = null;
    this.bind();
  }

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
    addEventListener('blur', () => { this.keys.clear(); this.sprintTouch = false; this.breathTouch = false; });

    // 滑鼠
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (!this.locked) {
        this.requestLock();
        this.dragLook = true;
        return;
      }
      if (e.button === 0) this.push('interact');
      if (e.button === 2) this.push('camera');
      if (e.button === 1) { e.preventDefault(); this.push('throw'); }
    });
    addEventListener('mouseup', () => { this.dragLook = false; });
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
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    // 觸控
    const L = this.touchLayer;
    L.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.touchMode) return;
      if (!this.enabled) return;
      const left = e.clientX < innerWidth * 0.45;
      if (left && !this.joy) {
        this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        this.showJoy(true);
      } else if (!left && !this.lookTouch) {
        this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      }
      try { L.setPointerCapture(e.pointerId); } catch (err) { /* 某些瀏覽器不支援 */ }
      e.preventDefault();
    });
    L.addEventListener('pointermove', (e) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy.x = e.clientX; this.joy.y = e.clientY;
        this.updateJoy();
      } else if (this.lookTouch && e.pointerId === this.lookTouch.id) {
        const dx = e.clientX - this.lookTouch.x, dy = e.clientY - this.lookTouch.y;
        this.lookTouch.x = e.clientX; this.lookTouch.y = e.clientY;
        this.lookTouch.moved += Math.abs(dx) + Math.abs(dy);
        const s = this.settings.touchSens * 0.0055;
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
        if (act === 'sprint') { this.sprintTouch = true; btn.classList.add('on'); return; }
        if (act === 'breath') { this.breathTouch = true; btn.classList.add('on'); return; }
        this.push(act);
        btn.classList.add('press');
        setTimeout(() => btn.classList.remove('press'), 140);
      });
      const up = (e) => {
        if (act === 'sprint') { this.sprintTouch = false; btn.classList.remove('on'); }
        if (act === 'breath') { this.breathTouch = false; btn.classList.remove('on'); }
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
    if (on) {
      base.style.left = this.joy.ox + 'px';
      base.style.top = this.joy.oy + 'px';
      this.updateJoy();
    }
  }
  updateJoy() {
    const R = 56;
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
    this.joySprint = mag > 0.96 && -dy > Math.abs(dx);
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
      this.padPrev = pad.buttons.map((x) => x.pressed);
      break;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const look = { x: this.look.x, y: this.look.y * (this.settings.invertY ? -1 : 1) };
    this.look.x = this.look.y = 0;
    const actions = this.actions;
    this.actions = [];
    return { mx, my, sprint, crouchHold, holdBreath, look, actions };
  }

  clear() {
    this.actions = [];
    this.look.x = this.look.y = 0;
    this.keys.clear();
    this.joy = null;
    this.lookTouch = null;
    this.sprintTouch = false;
    this.breathTouch = false;
    this.joySprint = false;
    this.move.x = this.move.y = 0;
    this.showJoy(false);
  }
}

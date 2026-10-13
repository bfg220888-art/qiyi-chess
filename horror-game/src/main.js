// 進入點：選單、設定、主迴圈
import * as THREE from 'three';
import { QUALITY, DIFFICULTY } from './config.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { UI, fmtTime } from './ui.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('silentward.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('silentward.' + k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ } },
};

const TIPS = [
  '哼歌聲越大聲，她就越近。戴上耳機能聽出方向。',
  '奔跑的腳步聲很大，她在很遠的地方也聽得到。',
  '躲進鐵櫃之前，先確定她沒有看著你。',
  '相機閃光能讓她僵住幾秒，但底片不多。',
  '有燈的地方能讓你冷靜下來；在黑暗中待太久，你會開始看到不存在的東西。',
  '關上門可以擋住她的視線，但她會打開門。',
  '每插上一個保險絲，就會有更多燈亮起——她也會更生氣。',
];

class App {
  constructor() {
    this.canvas = $('game');
    this.settings = {
      volume: 0.85, brightness: 1.15, mouseSens: 1, touchSens: 1, invertY: false, showFps: false,
      quality: null, difficulty: 'normal',
      ...store.get('settings', {}),
    };
    const touch = matchMedia('(pointer: coarse)').matches;
    if (!this.settings.quality || !QUALITY[this.settings.quality]) {
      const mem = navigator.deviceMemory || 4;
      this.settings.quality = touch ? (mem <= 3 ? 'low' : 'medium') : 'high';
    }
    if (!DIFFICULTY[this.settings.difficulty]) this.settings.difficulty = 'normal';
    this.quality = QUALITY[this.settings.quality];
    this.resScale = 1;
    this.ui = new UI();
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      this.fatal('你的瀏覽器不支援 WebGL，無法執行這個遊戲。請改用新版 Chrome、Safari 或 Edge。');
      return;
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.settings.brightness;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x000000, 1);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.fatal('顯示卡資源不足，畫面中斷了。請重新整理頁面，或在設定裡把畫質調低。'); });
    this.input = new Input(this.canvas, $('touch'), this.settings);
    this.input.onLockChange = (locked) => {
      if (!locked && this.game && !this.paused && !this.game.over && !this.game.dying && !this.ui.noteOpen && !this.input.touchMode && !this.input.lockFailed && !this.allowUnlock) this.pause();
    };
    this.game = null;
    this.paused = false;
    this.state = 'menu';
    this.frameTimes = [];
    this.bindMenu();
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' && !this.paused) this.pause();
        this.audio.suspend();
      } else if (this.state === 'playing' && !this.paused) this.audio.resume();
    });
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    if (location.search.includes('debug')) window.__SW = this;
  }

  fatal(msg) {
    const d = document.createElement('div');
    d.className = 'overlay';
    d.innerHTML = '<div class="panel"><h2>無法執行</h2><p></p></div>';
    d.querySelector('p').textContent = msg;
    document.body.append(d);
  }

  pixelRatio() {
    const q = this.quality;
    return Math.max(0.5, Math.min(devicePixelRatio || 1, q.maxDpr) * q.scale * this.resScale);
  }
  resize() {
    if (this.game) this.game.resize();
    else if (this.renderer) {
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(innerWidth, innerHeight, false);
    }
    this.checkOrientation();
  }
  checkOrientation() {
    if (!this.input || !this.input.touchMode) return;
    const portrait = innerHeight > innerWidth;
    if (portrait && this.state === 'playing' && !this.rotateDismissed) $('rotate').hidden = false;
    if (!portrait) $('rotate').hidden = true;
  }

  saveSettings() { store.set('settings', this.settings); }

  bindMenu() {
    const click = () => this.audio.play('uiClick');
    for (const b of document.querySelectorAll('.btn, .seg button')) {
      b.addEventListener('pointerenter', () => this.audio.play('uiHover'));
      b.addEventListener('click', click);
    }
    // 難度
    const seg = $('diffSeg');
    const setDiff = (k) => {
      this.settings.difficulty = k;
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.diff === k));
      $('diffDesc').textContent = DIFFICULTY[k].desc;
      const best = store.get('best', {})[k];
      $('bestTime').textContent = best ? `最佳紀錄（${DIFFICULTY[k].label}）：${fmtTime(best)}` : '';
      this.saveSettings();
    };
    for (const b of seg.querySelectorAll('button')) b.addEventListener('click', () => setDiff(b.dataset.diff));
    setDiff(this.settings.difficulty);
    $('btnStart').addEventListener('click', () => this.startGame());
    $('btnHelp').addEventListener('click', () => this.openPanel('help', 'menu'));
    $('btnSettings').addEventListener('click', () => this.openPanel('settings', 'menu'));
    $('btnHelpBack').addEventListener('click', () => this.closePanel('help'));
    $('btnSettingsBack').addEventListener('click', () => this.closePanel('settings'));
    $('btnResume').addEventListener('click', () => this.resume());
    $('btnPauseSettings').addEventListener('click', () => this.openPanel('settings', 'pause'));
    $('btnPauseHelp').addEventListener('click', () => this.openPanel('help', 'pause'));
    $('btnQuit').addEventListener('click', () => this.toMenu());
    $('btnRetry').addEventListener('click', () => this.startGame(this.game ? this.game.seed : undefined, true));
    $('btnNew').addEventListener('click', () => this.startGame(undefined, true));
    $('btnMenu').addEventListener('click', () => this.toMenu());
    $('btnRotateOk').addEventListener('click', () => { this.rotateDismissed = true; $('rotate').hidden = true; });
    $('note').addEventListener('pointerdown', () => { if (this.game) this.input.push('interact'); });
    $('mapView').addEventListener('pointerdown', () => { if (this.game) this.input.push('map'); });
    // 設定
    const qs = $('qualitySeg');
    const setQ = (k) => {
      this.settings.quality = k;
      for (const b of qs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === k);
      this.saveSettings();
      $('qualityNote').textContent = this.game ? '變更畫質會在下一局生效。' : `目前：${QUALITY[k].label}`;
    };
    for (const b of qs.querySelectorAll('button')) b.addEventListener('click', () => setQ(b.dataset.q));
    setQ(this.settings.quality);
    const bindRange = (id, key, fn) => {
      const el = $(id);
      el.value = this.settings[key];
      el.addEventListener('input', () => { this.settings[key] = parseFloat(el.value); if (fn) fn(); this.saveSettings(); });
    };
    bindRange('sBright', 'brightness', () => { this.renderer.toneMappingExposure = this.settings.brightness; });
    bindRange('sVolume', 'volume', () => this.audio.setVolume(this.settings.volume));
    bindRange('sMouse', 'mouseSens');
    bindRange('sTouch', 'touchSens');
    const bindCheck = (id, key, fn) => {
      const el = $(id);
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => { this.settings[key] = el.checked; if (fn) fn(); this.saveSettings(); });
    };
    bindCheck('sInvert', 'invertY');
    bindCheck('sFps', 'showFps', () => this.ui.setFps(this.settings.showFps && this.state === 'playing'));
    // 鍵盤操作選單
    addEventListener('keydown', (e) => {
      if (this.state === 'menu' && !$('menu').hidden && (e.code === 'Enter') && $('help').hidden && $('settings').hidden) this.startGame();
      if (this.paused && e.code === 'Escape' && $('settings').hidden && $('help').hidden) this.resume();
    });
  }

  openPanel(id, from) {
    this.panelFrom = from;
    $(id).hidden = false;
    if (from === 'pause') $('pause').hidden = true;
  }
  closePanel(id) {
    $(id).hidden = true;
    if (this.panelFrom === 'pause') $('pause').hidden = false;
  }

  async startGame(seed, skipIntro = false) {
    if (this.busy) return;
    this.busy = true;
    await this.audio.resume();
    if (this.game) { this.game.dispose(); this.game = null; }
    this.quality = QUALITY[this.settings.quality];
    this.resScale = 1;
    ['menu', 'end', 'pause', 'help', 'settings'].forEach((id) => { $(id).hidden = true; });
    this.ui.fade(0, 0.01);
    $('loading').hidden = false;
    $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    const touch = this.input.touchMode;
    if (touch) {
      try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* 不支援全螢幕 */ }
      try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* 不支援鎖定方向 */ }
    }
    const game = new Game(this, { difficulty: this.settings.difficulty, seed: seed ?? (Math.random() * 2 ** 31) | 0 });
    try {
      await game.build((p, msg) => {
        $('loadBar').style.width = (p * 100).toFixed(0) + '%';
        if (msg) document.querySelector('.load-title').textContent = msg;
      });
    } catch (e) {
      console.error(e);
      this.busy = false;
      $('loading').hidden = true;
      this.fatal('生成醫院時發生錯誤：' + (e && e.message ? e.message : e));
      return;
    }
    this.game = game;
    $('loading').hidden = true;
    const begin = () => {
      this.state = 'playing';
      this.paused = false;
      $('hud').hidden = false;
      $('touch').hidden = !touch;
      $('crosshair').hidden = touch;
      this.ui.setFps(this.settings.showFps);
      this.input.enabled = true;
      this.input.clear();
      if (!touch) this.input.requestLock();
      this.checkOrientation();
      game.start();
      this.busy = false;
    };
    this.state = 'intro';
    if (skipIntro || store.get('introSeen', false) && seed !== undefined) begin();
    else {
      this.ui.typeIntro([
        '1999 年 8 月，聖羅莎紀念醫院在一連串失蹤事件後封院。',
        '二十年後，你帶著攝影機獨自走進七樓，想拍下傳說中「哼歌的女人」。',
        '直播訊號在踏進大廳的那一刻中斷。',
        '身後的大門，鎖上了。',
      ], () => { store.set('introSeen', true); begin(); });
    }
  }

  pause() {
    if (!this.game || this.state !== 'playing' || this.paused) return;
    this.paused = true;
    this.allowUnlock = true;
    this.input.exitLock();
    this.allowUnlock = false;
    this.audio.suspend();
    $('pause').hidden = false;
    this.input.enabled = false;
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    $('pause').hidden = true;
    $('settings').hidden = true;
    $('help').hidden = true;
    this.audio.resume();
    this.input.enabled = true;
    this.input.clear();
    this.last = performance.now();
    if (!this.input.touchMode) this.input.requestLock();
  }
  toMenu() {
    if (this.game) { this.game.dispose(); this.game = null; }
    this.paused = false;
    this.state = 'menu';
    this.input.enabled = false;
    ['pause', 'end', 'hud', 'touch', 'settings', 'help', 'note', 'mapView', 'hideOverlay', 'rotate'].forEach((id) => { $(id).hidden = true; });
    this.ui.fade(0, 0.01);
    this.ui.damage(0);
    this.ui.setFps(false);
    $('menu').hidden = false;
    // 更新最佳紀錄顯示
    const k = this.settings.difficulty;
    const best = store.get('best', {})[k];
    $('bestTime').textContent = best ? `最佳紀錄（${DIFFICULTY[k].label}）：${fmtTime(best)}` : '';
  }
  onGameOver() {
    this.state = 'over';
    this.input.enabled = false;
    $('touch').hidden = true;
    $('hud').hidden = true;
    $('hideOverlay').hidden = true;
    $('mapView').hidden = true;
    $('note').hidden = true;
  }
  recordBest(k, t) {
    const best = store.get('best', {});
    if (!best[k] || t < best[k]) { best[k] = t; store.set('best', best); return true; }
    return false;
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    this.ui.update(dt);
    const g = this.game;
    if (!g) return;
    if (this.state === 'playing' && !this.paused) {
      const inp = this.input.poll();
      g.update(dt, inp);
      g.render(dt);
      this.adaptResolution(dt);
    } else if (this.state === 'over' || this.state === 'intro') {
      // 結束畫面背後仍顯示最後一格
    }
  }

  // 動態解析度：掉幀就降低渲染解析度
  adaptResolution(dt) {
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (this.settings.showFps) this.ui.setFps(true, `${(1 / avg).toFixed(0)} FPS・${this.quality.label}・${(this.pixelRatio()).toFixed(2)}x`);
    let changed = false;
    if (avg > 1 / 40 && this.resScale > 0.6) { this.resScale = Math.max(0.6, this.resScale - 0.1); changed = true; }
    else if (avg < 1 / 58 && this.resScale < 1) { this.resScale = Math.min(1, this.resScale + 0.05); changed = true; }
    if (changed && this.game) this.game.resize();
  }
}

new App();

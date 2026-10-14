// 進入點：選單、設定、主迴圈
import * as THREE from 'three';
import { QUALITY, DIFFICULTY } from './config.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { UI, fmtTime } from './ui.js';
import { Game } from './game.js';
import { loadGhostAssets, prefetchGhost } from './ghost-real.js';
import { loadPhotos, prefetchPhotos } from './textures.js';
import { loadCorpses, prefetchCorpses } from './corpses.js';

const $ = (id) => document.getElementById(id);
const store = {
  // 讀回來的資料要檢查型別：壞掉或被改過的存檔不能讓遊戲開不起來
  get(k, d) {
    try {
      const v = localStorage.getItem('silentward.' + k);
      if (v === null) return d;
      const x = JSON.parse(v);
      return x === null || typeof x !== typeof d || Array.isArray(x) !== Array.isArray(d) ? d : x;
    } catch (e) { return d; }
  },
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
    const defaults = {
      volume: 0.85, brightness: 1.15, mouseSens: 1, touchSens: 1, invertY: false, showFps: false,
      quality: null, difficulty: 'normal', fpsCap: 60,
    };
    this.settings = { ...defaults, ...store.get('settings', {}) };
    const clampNum = (k, a, b) => { const v = Number(this.settings[k]); this.settings[k] = Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : defaults[k]; };
    clampNum('volume', 0, 1); clampNum('brightness', 0.6, 2); clampNum('mouseSens', 0.2, 3); clampNum('touchSens', 0.2, 3);
    this.settings.invertY = this.settings.invertY === true;
    this.settings.showFps = this.settings.showFps === true;
    if (![0, 30, 60].includes(this.settings.fpsCap)) this.settings.fpsCap = 60;
    const touch = matchMedia('(pointer: coarse)').matches;
    // 舊版會把電腦預設成「高」畫質（4 倍取樣 + 高解析度），筆電容易發燙；沒手動選過的改回「中」
    if ((this.settings.cfgVer || 1) < 2 && this.settings.quality === 'high' && !this.settings.qualityChosen) this.settings.quality = null;
    this.settings.cfgVer = 2;
    if (!this.settings.quality || !QUALITY[this.settings.quality]) {
      const mem = navigator.deviceMemory || 4;
      this.settings.quality = touch && mem <= 3 ? 'low' : 'medium';
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
    this.lastRender = 0;
    this.ghostTries = 0;
    this.corpseTries = 0;
    this.photoTries = 0;
    this.bindMenu();
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' && !this.paused) this.pause();
        this.audio.suspend();
      } else if (!(this.state === 'playing' && this.paused)) this.audio.resume();
    });
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    if (location.search.includes('debug')) window.__SW = this;
    setTimeout(() => this.prefetchAssets(), 400);
  }

  // 寫實女鬼的素材只下載一次；失敗就回傳 null（遊戲改用程序化女鬼），下一局再試
  // 外部素材：第一局最多等 25 秒；之後如果還沒下載完，只等幾秒就先用程序生成的版本，
  // 下載會在背景繼續，給下一局用
  async ghostAssets() {
    const wait = this.ghostTries++ ? 4000 : 25000;
    try {
      return await loadGhostAssets(this.renderer, this.quality, wait);
    } catch (e) {
      console.warn('寫實女鬼素材還沒準備好，先用程序化模型：', e && e.message);
      return null;
    }
  }

  async corpseAssets() {
    const wait = this.corpseTries++ ? 3000 : 20000;
    try {
      return await loadCorpses(this.renderer, this.quality, wait);
    } catch (e) {
      console.warn('屍體素材還沒準備好，這一局先不放：', e && e.message);
      return null;
    }
  }

  async photoAssets() {
    const wait = this.photoTries++ ? 3000 : 20000;
    try {
      return await loadPhotos(undefined, wait);
    } catch (e) {
      console.warn('照片貼圖還沒準備好，先用程序貼圖：', e && e.message);
      return null;
    }
  }

  prefetchAssets() {
    try {
      prefetchGhost(this.quality);
      prefetchPhotos();
      prefetchCorpses();
    } catch (e) { /* 預先下載失敗沒關係，開局時會再試 */ }
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
    if (portrait && this.state === 'playing' && !this.rotateDismissed && $('rotate').hidden) {
      $('rotate').hidden = false;
      this.pause();
    }
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
    // 手機上點紙張本身可以捲動閱讀；點紙張外面或「關閉」才關掉
    $('note').addEventListener('pointerdown', (e) => {
      if (!this.game) return;
      const onPaper = e.target.closest && e.target.closest('.paper');
      if (e.pointerType === 'mouse' || !onPaper || e.target.id === 'noteClose') this.input.push('interact');
    });
    $('mapView').addEventListener('pointerdown', () => { if (this.game) this.input.push('map'); });
    // 設定
    const qs = $('qualitySeg');
    const setQ = (k) => {
      this.settings.quality = k;
      for (const b of qs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === k);
      this.saveSettings();
      $('qualityNote').textContent = this.game ? '變更畫質會在下一局生效。' : `目前：${QUALITY[k].label}`;
    };
    for (const b of qs.querySelectorAll('button')) b.addEventListener('click', () => { this.settings.qualityChosen = true; setQ(b.dataset.q); });
    setQ(this.settings.quality);
    const fs = $('fpsSeg');
    const setFps = (v) => {
      this.settings.fpsCap = v;
      this.vsyncN = 0;
      for (const b of fs.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.fps) === v);
      this.frameTimes.length = 0;
      this.saveSettings();
    };
    for (const b of fs.querySelectorAll('button')) b.addEventListener('click', () => setFps(Number(b.dataset.fps)));
    setFps(this.settings.fpsCap);
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
    ['menu', 'end', 'pause', 'help', 'settings', 'note', 'mapView', 'hideOverlay'].forEach((id) => { $(id).hidden = true; });
    this.ui.setHiding(false);
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
      this.audio.resume();
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
    if (skipIntro || store.get('introSeen', false)) begin();
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
    if (!this.input.touchMode) {
      this.input.requestLock();
      // 用 Esc 繼續時瀏覽器不允許立刻鎖定滑鼠：提示玩家點一下
      setTimeout(() => { if (this.state === 'playing' && !this.paused && !this.input.locked) this.ui.hint('點一下畫面恢復滑鼠視角', 3); }, 500);
    }
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
    this.ui.setHiding(false);
    this.audio.resume();
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
    // 螢幕更新間隔：畫得慢的那格會跨過好幾次更新，先除以跨過的次數再平均，
    // 估計值就不會被拉高；量到明顯更短的間隔時直接採用（例如剛換到高更新率螢幕）
    const raw = now - (this.lastRaf || now);
    this.lastRaf = now;
    if (raw > 3 && raw < 100) {
      if (!this.vsync || raw < this.vsync * 0.7) this.vsync = raw;
      else this.vsync += (raw / Math.max(1, Math.round(raw / this.vsync)) - this.vsync) * 0.05;
    }
    // 更新率上限：每 N 次螢幕更新畫一次，144 / 90 Hz 螢幕也維持穩定間隔；
    // 剛好卡在一半時（90 Hz 配 60）選比較省電的那邊。再加時間保護，兩次繪製至少隔 N 格
    const cap = this.settings.fpsCap;
    if (cap > 0 && this.state === 'playing' && this.vsync) {
      this.vsyncN = Math.max(1, Math.round(1000 / cap / this.vsync + 0.05));
      if (now - this.lastRender < this.vsyncN * this.vsync - this.vsync / 2) return;
      this.lastRender = now;
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) return;
    const frameDt = Math.min(dt, 0.25);
    dt = Math.min(dt, 0.05);
    this.ui.update(dt);
    const g = this.game;
    if (!g) return;
    if (this.state === 'playing' && !this.paused) {
      const inp = this.input.poll();
      g.update(dt, inp);
      g.render(dt);
      this.adaptResolution(frameDt);
    } else if (this.state === 'over' || this.state === 'intro') {
      // 結束畫面背後仍顯示最後一格
    }
  }

  // 動態解析度：掉幀就降低渲染解析度
  adaptResolution(dt) {
    // 目標是實際做得到的更新率（例如 90 Hz 螢幕配 60 上限 → 45），偶爾一格卡頓不算太重
    const target = this.settings.fpsCap && this.vsyncN && this.vsync ? 1000 / (this.vsyncN * this.vsync) : 60;
    const ft = this.frameTimes;
    ft.push(Math.min(dt, 2 / target));
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (this.settings.showFps) this.ui.setFps(true, `${(1 / avg).toFixed(0)} FPS・${this.quality.label}・${(this.pixelRatio()).toFixed(2)}x`);
    let changed = false;
    if (avg > 1.45 / target && this.resScale > 0.6) { this.resScale = Math.max(0.6, this.resScale - 0.1); changed = true; }
    else if (avg < 1.08 / target && this.resScale < 1) { this.resScale = Math.min(1, this.resScale + 0.05); changed = true; }
    if (changed && this.game) this.game.resize();
  }
}

new App();

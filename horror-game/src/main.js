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
import { MP, SLOT_CSS, MAX_PLAYERS } from './mp.js';
import { THEMES, RANDOM_THEME, resolveTheme, themeTitle } from './themes.js';

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
      volume: 0.85, music: 0.8, brightness: 1.15, mouseSens: 1, touchSens: 1, invertY: false, showFps: false,
      quality: null, difficulty: 'normal', fpsCap: 60, aa: true, theme: RANDOM_THEME,
    };
    this.settings = { ...defaults, ...store.get('settings', {}) };
    const clampNum = (k, a, b) => { const v = Number(this.settings[k]); this.settings[k] = Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : defaults[k]; };
    clampNum('volume', 0, 1); clampNum('music', 0, 1); clampNum('brightness', 0.6, 2); clampNum('mouseSens', 0.2, 3); clampNum('touchSens', 0.2, 3);
    this.settings.invertY = this.settings.invertY === true;
    this.settings.showFps = this.settings.showFps === true;
    this.settings.aa = this.settings.aa !== false;
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
    if (this.settings.theme !== RANDOM_THEME && !Object.hasOwn(THEMES, String(this.settings.theme))) this.settings.theme = RANDOM_THEME;
    this.quality = this.qualityPreset();
    this.resScale = 1;
    this.ui = new UI();
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    this.audio.musicVolume = this.settings.music;
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
    this.mp = new MP(this);
    addEventListener('pagehide', () => { if (this.mp.active) this.mp.leave(true); });
    this.bindMenu();
    this.bindLobby();
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' && !this.paused) this.pause();
        if (this.game && this.game.mp) this.startBackgroundTick();
        else this.audio.suspend();
      } else {
        this.stopBackgroundTick();
        if (!(this.state === 'playing' && this.paused) || (this.game && this.game.mp)) this.audio.resume();
      }
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

  // 畫質預設加上玩家的抗鋸齒選項（Post 依此決定 FXAA / 多重取樣）
  qualityPreset() {
    return { ...QUALITY[this.settings.quality], aa: this.settings.aa };
  }

  pixelRatio() {
    const q = this.quality;
    return Math.max(0.55, Math.min(devicePixelRatio || 1, q.maxDpr) * q.scale * this.resScale);
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
    // 地圖（樓層主題）
    const tseg = $('themeSeg');
    const setTheme = (k) => {
      this.settings.theme = k;
      for (const b of tseg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.theme === k));
      $('themeDesc').textContent = k === RANDOM_THEME ? '每一局隨機挑一層樓。' : `${themeTitle(k)}：${THEMES[k].desc}`;
      this.saveSettings();
    };
    for (const b of tseg.querySelectorAll('button')) b.addEventListener('click', () => setTheme(b.dataset.theme));
    setTheme(this.settings.theme);
    $('btnStart').addEventListener('click', () => this.startGame());
    $('btnHelp').addEventListener('click', () => this.openPanel('help', 'menu'));
    $('btnSettings').addEventListener('click', () => this.openPanel('settings', 'menu'));
    $('btnHelpBack').addEventListener('click', () => this.closePanel('help'));
    $('btnSettingsBack').addEventListener('click', () => this.closePanel('settings'));
    $('btnResume').addEventListener('click', () => this.resume());
    $('btnPauseSettings').addEventListener('click', () => this.openPanel('settings', 'pause'));
    $('btnPauseHelp').addEventListener('click', () => this.openPanel('help', 'pause'));
    $('btnQuit').addEventListener('click', () => this.toMenu());
    $('btnRetry').addEventListener('click', () => this.startGame(this.game ? this.game.seed : undefined, true, this.game ? this.game.theme : undefined));
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
    bindRange('sMusic', 'music', () => this.audio.setMusicVolume(this.settings.music));
    // 瀏覽器要等玩家第一次點擊或按鍵才能出聲：一碰到選單就開始放音樂盒
    const wake = () => {
      if (this.state !== 'menu') return;
      this.audio.resume().then(() => { if (this.state === 'menu') this.audio.setMusic('menu'); });
    };
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    bindRange('sMouse', 'mouseSens');
    bindRange('sTouch', 'touchSens');
    const bindCheck = (id, key, fn) => {
      const el = $(id);
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => { this.settings[key] = el.checked; if (fn) fn(); this.saveSettings(); });
    };
    bindCheck('sInvert', 'invertY');
    bindCheck('sAA', 'aa', () => { if (this.game && this.game.post) this.game.post.setAA(this.settings.aa); });
    bindCheck('sFps', 'showFps', () => this.ui.setFps(this.settings.showFps && this.state === 'playing'));
    // 鍵盤操作選單
    addEventListener('keydown', (e) => {
      if (this.state === 'menu' && !$('menu').hidden && (e.code === 'Enter') && $('help').hidden && $('settings').hidden && $('mpPanel').hidden) this.startGame();
      if (this.paused && e.code === 'Escape' && $('settings').hidden && $('help').hidden) this.resume();
    });
  }

  // ---------------------------------------------------------------------
  // 多人連線大廳
  bindLobby() {
    const mp = this.mp;
    const name = $('mpName');
    name.value = store.get('mpName', '');
    const getName = () => {
      const n = name.value.trim().slice(0, 12);
      store.set('mpName', n);
      return n || '無名氏';
    };
    const busy = (b) => { for (const id of ['btnMpCreate', 'btnMpJoin']) $(id).disabled = b; };
    $('btnMp').addEventListener('click', () => { $('mpPanel').hidden = false; this.renderLobby(); });
    $('btnMpBack').addEventListener('click', () => { $('mpPanel').hidden = true; });
    $('btnMpCreate').addEventListener('click', async () => {
      busy(true);
      try { await mp.create(getName()); } catch (e) { /* 狀態列已顯示原因 */ }
      busy(false);
      this.renderLobby();
    });
    const join = async () => {
      busy(true);
      try { await mp.join($('mpCode').value, getName()); } catch (e) { /* 狀態列已顯示原因 */ }
      busy(false);
      this.renderLobby();
    };
    $('btnMpJoin').addEventListener('click', join);
    $('mpCode').addEventListener('keydown', (e) => { if (e.code === 'Enter') { e.stopPropagation(); join(); } });
    $('btnMpLeave').addEventListener('click', () => { mp.leave(); this.renderLobby(); });
    // 等待其他玩家時可以放棄、離開房間
    $('loadCancel').addEventListener('click', () => { mp.leave(); this.busy = false; this.state = 'menu'; this.toMenu(); this.renderLobby(); });
    $('btnMpStart').addEventListener('click', () => {
      if (!mp.isHost || this.busy) return;
      mp.start({ difficulty: this.settings.difficulty, seed: (Math.random() * 2 ** 31) | 0, theme: this.settings.theme || null });
    });
    mp.onChange(() => this.renderLobby());
  }

  renderLobby() {
    const mp = this.mp;
    const inRoom = mp.active && (mp.isHost || mp.players.length > 0);
    $('mpSetup').hidden = mp.active;
    $('mpRoom').hidden = !inRoom;
    $('mpStatus').textContent = mp.status;
    $('btnMpBack').hidden = false;
    if (!inRoom) return;
    $('mpCodeShow').textContent = mp.code;
    const ul = $('mpList');
    ul.textContent = '';
    for (const p of mp.players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = SLOT_CSS[p.slot] || '#888';
      const nm = document.createElement('span');
      nm.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = (p.slot === 0 ? '房主' : '') + (p.slot === mp.mySlot ? '（你）' : '');
      li.append(dot, nm, tag);
      ul.append(li);
    }
    $('btnMpStart').hidden = !mp.isHost;
    $('mpRoomInfo').textContent = mp.isHost
      ? `${mp.players.length}/${MAX_PLAYERS} 人・難度：${DIFFICULTY[this.settings.difficulty].label}・地圖：${this.settings.theme === RANDOM_THEME ? '隨機' : themeTitle(this.settings.theme)}（在主選單切換）`
      : '等待房主開始遊戲……';
  }

  // 房主按下開始（或收到房主的開始訊息）
  startMpGame(opts) {
    const diff = Object.hasOwn(DIFFICULTY, opts.difficulty) ? opts.difficulty : 'normal';
    const seed = Number.isInteger(opts.seed) ? opts.seed : 1;
    if (this.state === 'playing' || this.state === 'intro' || this.state === 'over') this.disposeGame();
    this.mpGo = false;
    this.startGame(seed, true, typeof opts.theme === 'string' ? opts.theme : RANDOM_THEME, { difficulty: diff });
  }
  mpBegin() {
    this.mpGo = true;
    if (this.pendingBegin) { const b = this.pendingBegin; this.pendingBegin = null; b(); }
  }
  disposeGame() {
    if (this.game) { this.game.dispose(); this.game = null; }
    this.stopBackgroundTick();
  }

  // 多人時分頁切到背景也要繼續跑（女鬼在房主那邊），只是不畫畫面
  startBackgroundTick() {
    if (this.bgTimer) return;
    let last = performance.now();
    this.bgTimer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const g = this.game;
      if (g && g.mp && this.state === 'playing') g.update(dt, this.emptyInput());
    }, 50);
  }
  stopBackgroundTick() {
    if (this.bgTimer) clearInterval(this.bgTimer);
    this.bgTimer = null;
    this.last = performance.now();
  }
  emptyInput() { return { mx: 0, my: 0, sprint: false, crouchHold: false, holdBreath: false, look: { x: 0, y: 0 }, actions: [] }; }

  openPanel(id, from) {
    this.panelFrom = from;
    $(id).hidden = false;
    if (from === 'pause') $('pause').hidden = true;
  }
  closePanel(id) {
    $(id).hidden = true;
    if (this.panelFrom === 'pause') $('pause').hidden = false;
  }

  // theme：不給就用設定裡選的地圖（'random' = 由 seed 決定）。「再試一次」會傳入上一局的主題
  async startGame(seed, skipIntro = false, theme = undefined, mpOpts = null) {
    if (this.busy) return;
    this.busy = true;
    await this.audio.resume();
    this.disposeGame();
    if (!mpOpts && this.mp.active) this.mp.leave();
    this.quality = this.qualityPreset();
    this.resScale = 1;
    ['menu', 'mpPanel', 'end', 'pause', 'help', 'settings', 'note', 'mapView', 'hideOverlay'].forEach((id) => { $(id).hidden = true; });
    this.ui.setHiding(false);
    this.ui.fade(0, 0.01);
    $('loading').hidden = false;
    $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    seed = seed ?? (Math.random() * 2 ** 31) | 0;
    theme = resolveTheme(theme ?? this.settings.theme, seed >>> 0);
    $('loadFloor').textContent = themeTitle(theme);
    const touch = this.input.touchMode;
    if (touch) {
      try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* 不支援全螢幕 */ }
      try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* 不支援鎖定方向 */ }
    }
    const game = new Game(this, {
      difficulty: mpOpts ? mpOpts.difficulty : this.settings.difficulty,
      seed, theme,
      mp: mpOpts ? this.mp : null,
    });
    try {
      await game.build((p, msg) => {
        $('loadBar').style.width = (p * 100).toFixed(0) + '%';
        if (msg) document.querySelector('.load-title').textContent = msg;
      });
    } catch (e) {
      console.error(e);
      this.busy = false;
      $('loading').hidden = true;
      if (mpOpts) this.mp.leave();
      this.fatal('生成醫院時發生錯誤：' + (e && e.message ? e.message : e));
      return;
    }
    this.game = game;
    $('loading').hidden = true;
    const begin = () => {
      if (this.game !== game) return;
      $('loading').hidden = true;
      $('loadCancel').hidden = true;
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
    if (mpOpts) {
      // 多人：等所有人都載入完才一起開始
      if (this.mp.game !== game || !this.mp.active) { this.busy = false; this.toMenu(); return; }
      this.busy = false;
      if (this.mpGo) begin();
      else {
        this.pendingBegin = () => { this.busy = true; begin(); };
        $('loading').hidden = false;
        $('loadCancel').hidden = false;
        $('loadBar').style.width = '100%';
        document.querySelector('.load-title').textContent = '等待其他玩家載入……';
        this.mp.localReady();
      }
      return;
    }
    if (skipIntro || store.get('introSeen', false)) begin();
    else {
      this.ui.typeIntro([
        '1999 年 8 月，聖羅莎紀念醫院在一連串失蹤事件後封院。',
        game.themeInfo.intro,
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
    if (!this.game.mp) this.audio.suspend();
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
    // 遊戲還沒結束就離開 = 退出房間（房主離開則整局結束）
    if (this.mp.active && this.game && this.game.mp && !this.game.over) this.mp.leave();
    this.disposeGame();
    this.pendingBegin = null;
    if (this.mp.active) {
      // 留在房間裡，回到大廳可以再玩一局
      this.mp.inGame = false;
      this.mp.game = null;
      this.mp.began = false;
      this.mp.startOpts = null;
      for (const p of this.mp.players) p.ready = p.slot === this.mp.mySlot;
      $('mpPanel').hidden = false;
      this.renderLobby();
    }
    this.paused = false;
    this.state = 'menu';
    this.input.enabled = false;
    ['loading', 'pause', 'end', 'hud', 'touch', 'settings', 'help', 'note', 'mapView', 'hideOverlay', 'rotate'].forEach((id) => { $(id).hidden = true; });
    this.ui.fade(0, 0.01);
    this.ui.damage(0);
    this.ui.setFps(false);
    this.ui.setHiding(false);
    this.audio.resume().then(() => { if (this.state === 'menu') this.audio.setMusic('menu'); });
    $('menu').hidden = false;
    // 更新最佳紀錄顯示
    const k = this.settings.difficulty;
    const best = store.get('best', {})[k];
    $('bestTime').textContent = best ? `最佳紀錄（${DIFFICULTY[k].label}）：${fmtTime(best)}` : '';
  }
  onGameOver() {
    this.state = 'over';
    this.paused = false;
    $('pause').hidden = true;
    $('loadCancel').hidden = true;
    const mpg = !!(this.game && this.game.mp);
    $('btnRetry').hidden = mpg;
    $('btnNew').hidden = mpg;
    $('btnMenu').textContent = mpg ? '回到大廳' : '主選單';
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
    if (this.state === 'playing' && (!this.paused || g.mp)) {
      // 多人時暫停選單打開也不能停下（別人還在玩），只是不接受操作
      const inp = this.paused ? this.emptyInput() : this.input.poll();
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
    // 不要一下子降太多：解析度太低畫面會糊成一片。偶爾一段慢不算，連續兩段慢（或非常慢）才降，每次降 0.08，最低 0.7
    let changed = false;
    this.slowRuns = avg > 1.45 / target ? (this.slowRuns || 0) + 1 : 0;
    if ((this.slowRuns >= 2 || avg > 1.9 / target) && this.resScale > 0.7) { this.resScale = Math.max(0.7, this.resScale - 0.08); this.slowRuns = 0; changed = true; }
    else if (avg < 1.08 / target && this.resScale < 1) { this.resScale = Math.min(1, this.resScale + 0.04); changed = true; }
    if (changed && this.game) this.game.resize();
  }
}

new App();

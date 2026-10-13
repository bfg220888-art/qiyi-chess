// 音效引擎（Web Audio）：實錄音效（CC0 / CC BY，見 CREDITS.md）＋即時合成。
// 音檔載入失敗或還沒載完時，每個聲音都會退回合成版本。
// 含 HRTF 3D 定位、牆壁遮蔽（悶音）、卷積殘響。
import { assetUrl } from './assets.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// assets/sfx/ 裡的檔案；結尾是數字的會分成一組，播放時隨機挑一個
const SFX_FILES = [
  'step0', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7',
  'door_open0', 'door_open1', 'door_close0', 'door_close1', 'creak0', 'creak1', 'creak2', 'door_creak', 'door_slam',
  'latch', 'click', 'locker', 'scream0', 'scream1', 'heart_lub', 'heart_dub', 'rain', 'thunder_near', 'thunder_far',
  'glass', 'glass_hit0', 'glass_hit1', 'glass_hit2', 'shutter', 'paper0', 'paper1', 'pills', 'squeak',
  'metal0', 'metal1', 'metal2', 'metal3', 'metal4', 'bang', 'metal_reverb', 'phone', 'woosh',
];

// 原創搖籃曲旋律（MIDI 音高，-1 = 休止）
const LULLABY = [
  [57, 0.7], [60, 0.7], [59, 0.7], [57, 1.1], [52, 1.2], [-1, 0.6],
  [57, 0.6], [59, 0.6], [60, 0.7], [62, 0.7], [60, 1.0], [59, 1.2], [-1, 0.7],
  [55, 0.6], [57, 0.6], [59, 0.7], [60, 0.8], [59, 0.6], [57, 0.6], [56, 1.0], [57, 1.8], [-1, 2.2],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.85;
    this.emitters = new Set();
    this.occlusionFn = null;
    this.listener = { x: 0, y: 0, z: 0 };
    this.hb = { bpm: 0, vol: 0, next: 0 };
    this.breath = { level: 0, next: 0, hiding: false };
    this.hums = new Map();
    this.chase = { level: 0, next: 0, beat: 0 };
    this.drips = { next: 0 };
    this.phone = null;
    this.alarmOn = false;
    this.buf = {};
    this.groups = {};
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp).connect(c.destination);
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.makeIR(2.8, 2.6);
    this.revOut = c.createGain();
    this.revOut.gain.value = 0.55;
    this.reverb.connect(this.revOut).connect(this.master);
    this.revSend = c.createGain();
    this.revSend.connect(this.reverb);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.connect(this.master);
    this.amb = c.createGain();
    this.amb.gain.value = 0;
    this.amb.connect(this.master);
    // 雜訊緩衝
    const len = c.sampleRate * 3;
    this.white = c.createBuffer(1, len, c.sampleRate);
    this.pink = c.createBuffer(1, len, c.sampleRate);
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), p = this.pink.getChannelData(0), br = this.brown.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
      last = (last + 0.02 * x) / 1.02;
      br[i] = last * 3.5;
    }
    this.tick = this.tick.bind(this);
    this.timer = setInterval(this.tick, 50);
    this.loadSamples();
  }

  // ---- 實錄音效
  loadSamples(base = 'assets/sfx/') {
    if (!this.ctx || this.samplesLoading) return this.samplesLoading;
    const c = this.ctx;
    const decode = (ab) => new Promise((res, rej) => {
      const p = c.decodeAudioData(ab, res, rej);
      if (p && p.catch) p.catch(rej);
    });
    this.samplesLoading = Promise.all(SFX_FILES.map(async (n) => {
      try {
        const r = await fetch(assetUrl(base + n + '.mp3'));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.buf[n] = await decode(await r.arrayBuffer());
      } catch (e) { /* 這個聲音就用合成的 */ }
    })).then(() => {
      if (this.buf.rain) this.buf.rain = this.makeLoop(this.buf.rain, 1.5);
      const groups = {};
      for (const n of Object.keys(this.buf)) {
        const k = n.replace(/\d+$/, '');
        (groups[k] || (groups[k] = [])).push(this.buf[n]);
      }
      this.groups = groups;
      this.useSampledRain();
      const n = Object.keys(this.buf).length;
      if (n < SFX_FILES.length) console.warn(`音檔載入 ${n}/${SFX_FILES.length}，其餘用合成音`);
    });
    return this.samplesLoading;
  }
  has(name) { return !!(this.groups[name] && this.groups[name].length); }
  // 去掉編碼器補的頭尾靜音，再把結尾交叉淡入開頭，做成無縫循環
  makeLoop(b, xf) {
    const c = this.ctx, ch = b.numberOfChannels, sr = b.sampleRate;
    const d0 = b.getChannelData(0);
    let a = 0, z = d0.length - 1;
    while (a < d0.length && Math.abs(d0[a]) < 1e-4) a++;
    while (z > a && Math.abs(d0[z]) < 1e-4) z--;
    const X = Math.floor(xf * sr), len = z - a + 1 - X;
    if (len < sr) return b;
    const out = c.createBuffer(ch, len, sr);
    for (let k = 0; k < ch; k++) {
      const src = b.getChannelData(k), dst = out.getChannelData(k);
      for (let i = 0; i < len; i++) dst[i] = src[a + i];
      for (let i = 0; i < X; i++) {
        const w = i / X;
        dst[i] = src[a + i] * Math.sqrt(w) + src[a + len + i] * Math.sqrt(1 - w);
      }
    }
    return out;
  }
  // 播一段音檔；name 可以是組名（隨機挑一個）或 AudioBuffer
  sample(dest, name, t, { rate = 1, gain = 1, offset = 0, dur, fade = 0.06 } = {}) {
    const b = typeof name === 'string' ? (this.has(name) ? pick(this.groups[name]) : null) : name;
    if (!b) return 0;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    const len = Math.max(0.02, Math.min(dur ?? Infinity, b.duration - offset));
    if (dur !== undefined) {
      // 從中間截一段：淡入淡出避免爆音
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, len / 4));
      g.gain.setValueAtTime(gain, t + Math.max(0, len / rate - fade));
      g.gain.linearRampToValueAtTime(0, t + len / rate);
    }
    s.start(t, offset, len);
    s.onended = () => { try { g.disconnect(); } catch (e) { /* 已斷開 */ } };
    return len / rate;
  }
  // 雨聲換成錄音（悶在建築物裡的雨）
  useSampledRain() {
    if (!this.ambStarted || !this.buf.rain || this.rainSample || !this.rainGain) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.buf.rain;
    s.loop = true;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8, t + 2);
    s.connect(g).connect(this.rainGain);
    s.start(t, rnd(0, this.buf.rain.duration));
    this.rainSample = s;
    if (this.rainNoise) {
      this.rainNoiseGain.gain.setTargetAtTime(0, t, 0.6);
      const n = this.rainNoise;
      setTimeout(() => { try { n.stop(); n.disconnect(); } catch (e) { /* 已停止 */ } }, 4000);
      this.rainNoise = null;
    }
  }

  async resume() {
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      // iOS 解鎖：播一段無聲
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch (e) { /* 使用者沒互動前無法啟動，稍後再試 */ }
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  makeIR(dur, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate;
        const k = 0.15 + 0.8 * (t / dur);
        lp = lp + (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * Math.exp(-t * decay) * 0.6;
      }
      for (let r = 0; r < 8; r++) {
        const i = Math.floor(c.sampleRate * rnd(0.008, 0.07));
        d[i] += rnd(-0.7, 0.7);
      }
    }
    return buf;
  }
  makeCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ---------------------------------------------------------------------
  setListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = camera.position;
    this.listener = { x: p.x, y: p.y, z: p.z };
    const f = { x: 0, y: 0, z: -1 }, u = { x: 0, y: 1, z: 0 };
    const e = camera.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    u.x = e[4]; u.y = e[5]; u.z = e[6];
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    // 牆壁遮蔽（每秒約 12 次就夠了，不用每格算）
    if (this.occlusionFn && !(t - this.occlT < 0.08)) {
      this.occlT = t;
      for (const em of this.emitters) {
        const walls = this.occlusionFn(p.x, p.z, em.pos.x, em.pos.z);
        if (walls !== em.walls) {
          em.walls = walls;
          const cut = walls === 0 ? 18000 : walls === 1 ? 1100 : 450;
          const g = walls === 0 ? 1 : walls === 1 ? 0.6 : 0.32;
          em.filter.frequency.setTargetAtTime(cut, t, 0.08);
          em.occl.gain.setTargetAtTime(g, t, 0.08);
        }
      }
    }
  }

  createEmitter(opts = {}) {
    const c = this.ctx;
    if (!c) return { setPosition() {}, input: null, dispose() {}, pos: { x: 0, y: 0, z: 0 } };
    const input = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 18000;
    const occl = c.createGain();
    const panner = c.createPanner();
    panner.panningModel = opts.hrtf === false ? 'equalpower' : 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = opts.ref || 1.3;
    panner.maxDistance = 80;
    panner.rolloffFactor = opts.rolloff || 1.25;
    const send = c.createGain();
    send.gain.value = opts.reverb ?? 0.35;
    input.connect(filter).connect(occl).connect(panner);
    panner.connect(this.sfx);
    panner.connect(send).connect(this.revSend);
    const em = {
      input, filter, occl, panner, pos: { x: 0, y: 0, z: 0 }, walls: -1,
      setPosition: (x, y, z) => {
        em.pos.x = x; em.pos.y = y; em.pos.z = z;
        const t = c.currentTime;
        if (panner.positionX) {
          panner.positionX.setTargetAtTime(x, t, 0.03); panner.positionY.setTargetAtTime(y, t, 0.03); panner.positionZ.setTargetAtTime(z, t, 0.03);
        } else panner.setPosition(x, y, z);
      },
      dispose: () => {
        this.emitters.delete(em);
        try { input.disconnect(); panner.disconnect(); send.disconnect(); } catch (e) { /* 已斷開 */ }
      },
    };
    if (opts.pos) {
      em.pos = { ...opts.pos };
      if (panner.positionX) { panner.positionX.value = opts.pos.x; panner.positionY.value = opts.pos.y ?? 1; panner.positionZ.value = opts.pos.z; }
      else panner.setPosition(opts.pos.x, opts.pos.y ?? 1, opts.pos.z);
      if (this.occlusionFn) {
        const walls = this.occlusionFn(this.listener.x, this.listener.z, opts.pos.x, opts.pos.z);
        em.walls = walls;
        filter.frequency.value = walls === 0 ? 18000 : walls === 1 ? 1100 : 450;
        occl.gain.value = walls === 0 ? 1 : walls === 1 ? 0.6 : 0.32;
      }
    }
    this.emitters.add(em);
    return em;
  }

  // 一次性聲音的輸出點：有座標就 3D 定位，否則直接進混音
  out(opts, dur, reverb = 0.3) {
    const c = this.ctx;
    if (opts && opts.pos) {
      const em = this.createEmitter({ pos: { x: opts.pos.x, y: opts.pos.y ?? 1.2, z: opts.pos.z }, hrtf: !!opts.hrtf, reverb: opts.reverb ?? reverb + 0.15, ref: opts.ref });
      setTimeout(() => em.dispose(), (dur + 1.5) * 1000);
      return em.input;
    }
    const g = c.createGain();
    const send = c.createGain();
    send.gain.value = reverb;
    if (opts && opts.pan !== undefined && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = opts.pan;
      g.connect(p);
      p.connect(this.sfx);
      p.connect(send).connect(this.revSend);
    } else {
      g.connect(this.sfx);
      g.connect(send).connect(this.revSend);
    }
    setTimeout(() => { try { g.disconnect(); send.disconnect(); } catch (e) { /* 已斷開 */ } }, (dur + 3) * 1000);
    return g;
  }

  // ---- 合成積木
  noise(type = 'white') {
    const s = this.ctx.createBufferSource();
    s.buffer = type === 'pink' ? this.pink : type === 'brown' ? this.brown : this.white;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = s.buffer.duration;
    return s;
  }
  startNoise(s, t, dur) {
    s.start(t, rnd(0, 2));
    s.stop(t + dur + 0.05);
  }
  filt(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  env(t, a, d, peak, curve = 'exp') {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    else g.gain.linearRampToValueAtTime(0, t + a + d);
    return g;
  }
  osc(type, f, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }
  burst(dest, t, { type = 'white', ftype = 'bandpass', f = 1000, q = 1, a = 0.002, d = 0.1, peak = 0.3 }) {
    const n = this.noise(type);
    const fl = this.filt(ftype, f, q);
    const e = this.env(t, a, d, peak);
    n.connect(fl).connect(e).connect(dest);
    this.startNoise(n, t, a + d);
  }
  thump(dest, t, f0, f1, d, peak) {
    const o = this.osc('sine', f0, t, d);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + d);
    const e = this.env(t, 0.004, d, peak);
    o.connect(e).connect(dest);
  }
  ring(dest, t, modes, dur, peak) {
    // 金屬共鳴：幾個不和諧的正弦泛音各自指數衰減（模態合成）
    for (const [f, q, g] of modes) {
      const d = dur * Math.min(1.6, q / 40) * rnd(0.8, 1.2);
      const o = this.osc('sine', f * rnd(0.98, 1.02), t, d);
      o.connect(this.env(t, 0.001, d, peak * g * 0.35)).connect(dest);
    }
    this.burst(dest, t, { f: modes[0][0] * 2, q: 2, a: 0.001, d: 0.02, peak: peak * 0.3 });
  }

  // ---------------------------------------------------------------------
  play(name, opts = {}) {
    if (!this.ready) return;
    const fn = this['s_' + name];
    if (fn) {
      try { fn.call(this, opts, this.ctx.currentTime + 0.005); } catch (e) { console.warn('sound', name, e); }
    }
  }

  s_footstep(o, t) {
    const run = o.run, crouch = o.crouch;
    const base = run ? 0.55 : crouch ? 0.1 : 0.28;
    if (this.has('step')) {
      const out = this.out(null, 0.5, run ? 0.22 : 0.16);
      const tile = o.surface === 'tile';
      this.sample(out, 'step', t, { rate: rnd(0.93, 1.07) * (tile ? 1.1 : 1) * (run ? 1.06 : crouch ? 0.94 : 1), gain: base * 1.5 });
      if (Math.random() < 0.12) this.burst(out, t + 0.02, { ftype: 'highpass', f: 5000, d: 0.06, peak: base * 0.12 }); // 踩到碎玻璃 / 紙
      return;
    }
    const out = this.out(null, 0.3, run ? 0.22 : 0.16);
    const tile = o.surface === 'tile';
    this.burst(out, t, { f: rnd(380, 560) * (run ? 1.25 : 1) * (tile ? 1.3 : 1), q: 1.1, d: 0.07, peak: base });
    this.burst(out, t, { ftype: 'highpass', f: tile ? 3200 : 2400, q: 0.7, a: 0.001, d: 0.025, peak: base * (tile ? 0.7 : 0.45) });
    this.thump(out, t, 90, 45, 0.07, base * 0.9);
    this.burst(out, t + rnd(0.05, 0.08), { f: rnd(600, 900), q: 1.2, d: 0.04, peak: base * 0.35 });
    if (Math.random() < 0.18) this.burst(out, t + 0.02, { ftype: 'highpass', f: 5000, d: 0.06, peak: base * 0.15 }); // 踩到碎玻璃 / 紙
  }
  s_ghostStep(o, t) {
    const out = this.out(o, 0.8, 0.4);
    const pk = o.fast ? 0.75 : 0.45;
    if (this.has('step')) {
      // 她的腳步：比較重、比較悶，偶爾拖著腳
      const lp = this.filt('lowpass', o.fast ? 2600 : 1500, 0.7);
      lp.connect(out);
      this.sample(lp, 'step', t, { rate: rnd(0.78, 0.86), gain: pk * 1.7 });
      if (!o.fast && Math.random() < 0.5) this.burst(out, t + 0.05, { f: 1600, q: 0.7, a: 0.08, d: 0.3, peak: 0.06 });
      return;
    }
    this.burst(out, t, { ftype: 'lowpass', f: 900, q: 0.8, a: 0.001, d: 0.06, peak: pk });
    this.thump(out, t, 70, 40, 0.09, pk * 0.8);
    if (!o.fast) this.burst(out, t + 0.04, { f: 1800, q: 0.7, a: 0.08, d: 0.3, peak: 0.08 });
  }
  s_doorCreak(o, t) {
    const dur = o.short ? 0.6 : rnd(1.1, 1.7);
    const out = this.out(o, dur + 0.3, 0.4);
    if (this.buf.door_creak) {
      const B = this.buf.door_creak;
      this.sample(out, B, t, { rate: rnd(0.85, 1.05), gain: 0.6, offset: rnd(0, Math.max(0, B.duration - dur - 0.1)), dur, fade: 0.25 });
      return;
    }
    this.creak(out, t, dur, 0.55);
  }
  creak(dest, t, dur, vol) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * dur);
    const buf = c.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let ph = 0, f = rnd(16, 28), amp = 0.5;
    for (let i = 0; i < n; i++) {
      const tt = i / n;
      f += (rnd(-1, 1) * 0.9 + (rnd(14, 34) - f) * 0.0006);
      amp += (Math.random() - 0.5) * 0.02;
      amp = Math.min(1, Math.max(0.15, amp));
      ph += Math.max(6, f * (1 + 0.5 * Math.sin(tt * 9))) / sr;
      if (ph >= 1) {
        ph -= 1;
        const a = amp * rnd(0.5, 1) * Math.sin(Math.PI * tt);
        for (let k = 0; k < 48 && i + k < n; k++) d[i + k] += a * Math.exp(-k / 7) * (k % 2 ? -1 : 1);
      }
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    for (const [f0, q, gg] of [[620, 14, 1], [1380, 16, 0.75], [2900, 12, 0.35], [240, 6, 0.5]]) {
      const b = this.filt('bandpass', f0 * rnd(0.9, 1.1), q);
      const bg = c.createGain();
      bg.gain.value = gg * 3;
      src.connect(b).connect(bg).connect(g);
    }
    g.connect(dest);
    src.start(t);
  }
  s_doorBang(o, t) {
    const out = this.out(o, 1.6, 0.5);
    if (this.buf.door_slam) {
      this.sample(out, this.buf.door_slam, t + 0.08, { rate: rnd(0.85, 0.95), gain: 0.9 });
      if (this.has('creak')) this.sample(out, 'creak', t, { rate: 1.2, gain: 0.35 });
      this.thump(out, t + 0.12, 75, 40, 0.3, 0.5);
      return;
    }
    this.creak(out, t, 0.35, 0.4);
    this.thump(out, t + 0.12, 75, 40, 0.3, 0.9);
    this.burst(out, t + 0.12, { ftype: 'lowpass', f: 1400, d: 0.2, peak: 0.6 });
    this.ring(out, t + 0.12, [[2400, 25, 0.3], [1650, 30, 0.25]], 0.6, 0.6);
  }
  s_doorOpen(o, t) {
    const out = this.out(o, 2, 0.35);
    if (this.has('door_open')) {
      this.sample(out, 'door_open', t, { rate: rnd(0.92, 1.06), gain: 0.5 });
      if (this.has('creak') && Math.random() < 0.55) this.sample(out, 'creak', t + 0.08, { rate: rnd(0.8, 1.0), gain: 0.32 });
      return;
    }
    this.burst(out, t, { ftype: 'highpass', f: 2800, a: 0.001, d: 0.02, peak: 0.35 });
    this.thump(out, t, 140, 90, 0.06, 0.2);
    if (Math.random() < 0.6) this.creak(out, t + 0.05, rnd(0.4, 0.8), 0.32);
  }
  s_doorClose(o, t) {
    const out = this.out(o, 1.2, 0.35);
    if (this.has('door_close')) {
      this.sample(out, 'door_close', t, { rate: rnd(0.92, 1.06), gain: 0.6 });
      return;
    }
    this.thump(out, t, 110, 50, 0.14, 0.6);
    this.burst(out, t, { ftype: 'lowpass', f: 1600, d: 0.08, peak: 0.35 });
    this.burst(out, t + 0.01, { ftype: 'highpass', f: 3000, a: 0.001, d: 0.02, peak: 0.3 });
  }
  s_doorSlam(o, t) {
    const out = this.out(o, 2, 0.7);
    if (this.buf.door_slam) {
      this.sample(out, this.buf.door_slam, t, { rate: rnd(0.9, 1.0), gain: 1.0 });
      this.thump(out, t, 60, 30, 0.6, 0.6);
      return;
    }
    this.thump(out, t, 60, 30, 0.6, 1.0);
    this.burst(out, t, { ftype: 'lowpass', f: 1800, d: 0.25, peak: 0.9 });
    this.ring(out, t, [[1850, 30, 0.4], [2700, 40, 0.3], [930, 25, 0.3]], 1, 0.8);
  }
  s_locked(o, t) {
    const out = this.out(o, 1, 0.3);
    if (this.buf.latch) {
      // 轉不動的門把喀喀響
      for (let k = 0; k < 3; k++) this.sample(out, this.buf.latch, t + k * 0.11 + rnd(0, 0.02), { rate: rnd(1.0, 1.2), gain: 0.4 - k * 0.07 });
      return;
    }
    for (let k = 0; k < 3; k++) this.burst(out, t + k * 0.09, { f: 1500, q: 4, a: 0.002, d: 0.05, peak: 0.35 });
  }
  s_lockerOpen(o, t) {
    const out = this.out(o, 1.6, 0.35);
    if (this.buf.latch && this.buf.locker) {
      this.sample(out, this.buf.latch, t, { rate: rnd(0.9, 1.05), gain: 0.5 });
      this.sample(out, this.buf.locker, t + 0.06, { rate: rnd(1.1, 1.2), gain: 0.35, offset: 0.35, dur: 0.9, fade: 0.3 });
      const sq = this.osc('sine', 2300, t + 0.05, 0.25);
      sq.frequency.linearRampToValueAtTime(1700, t + 0.28);
      sq.connect(this.env(t + 0.05, 0.03, 0.2, 0.03)).connect(out);
      return;
    }
    this.burst(out, t, { f: 1300, q: 3, d: 0.12, peak: 0.4 });
    this.ring(out, t, [[760, 40, 0.5], [1850, 50, 0.35], [2950, 60, 0.2]], 0.8, 0.5);
    const sq = this.osc('sine', 2300, t + 0.02, 0.2);
    sq.frequency.linearRampToValueAtTime(1700, t + 0.2);
    sq.connect(this.env(t + 0.02, 0.02, 0.15, 0.05)).connect(out);
  }
  s_lockerClose(o, t) {
    const out = this.out(o, 1.8, 0.35);
    if (this.buf.locker) {
      this.sample(out, this.buf.locker, t, { rate: rnd(0.95, 1.05), gain: 0.65 });
      return;
    }
    this.thump(out, t, 120, 60, 0.1, 0.5);
    this.burst(out, t, { f: 1100, q: 2, d: 0.1, peak: 0.45 });
    this.ring(out, t, [[700, 35, 0.6], [1720, 45, 0.4]], 0.8, 0.55);
  }
  s_pickup(o, t) {
    const out = this.out(null, 1, 0.25);
    this.burst(out, t, { f: 3000, q: 0.8, d: 0.12, peak: 0.12 });
    for (const [f, d] of [[1046, 0.6], [1568, 0.5]]) this.osc('sine', f, t + 0.05, d).connect(this.env(t + 0.05, 0.005, d, 0.06)).connect(out);
  }
  s_fusePickup(o, t) {
    const out = this.out(null, 1.5, 0.35);
    this.burst(out, t, { f: 2500, q: 0.8, d: 0.12, peak: 0.12 });
    for (const [f, d, dt] of [[523, 1.0, 0], [784, 0.9, 0.08], [1046, 0.8, 0.16]]) this.osc('triangle', f, t + dt, d).connect(this.env(t + dt, 0.005, d, 0.07)).connect(out);
  }
  s_paper(o, t) {
    const out = this.out(null, 2, 0.15);
    if (this.has('paper')) { this.sample(out, 'paper', t, { rate: rnd(0.95, 1.1), gain: 0.5 }); return; }
    const n = this.noise('white');
    const f = this.filt('bandpass', 4200, 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 14; k++) g.gain.setValueAtTime(rnd(0, 0.22), t + k * 0.025);
    g.gain.setValueAtTime(0, t + 0.36);
    n.connect(f).connect(g).connect(out);
    this.startNoise(n, t, 0.4);
  }
  s_pills(o, t) {
    const out = this.out(null, 1.3, 0.15);
    if (this.buf.pills) { this.sample(out, this.buf.pills, t, { rate: rnd(0.95, 1.1), gain: 0.45 }); return; }
    for (let k = 0; k < 12; k++) this.burst(out, t + rnd(0, 0.35), { ftype: 'highpass', f: 5000, a: 0.001, d: 0.01, peak: 0.2 });
  }
  s_battery(o, t) {
    const out = this.out(null, 0.5, 0.15);
    this.burst(out, t, { ftype: 'highpass', f: 3500, a: 0.001, d: 0.015, peak: 0.35 });
    this.burst(out, t + 0.12, { ftype: 'highpass', f: 2500, a: 0.001, d: 0.02, peak: 0.4 });
  }
  s_flashClick(o, t) {
    const out = this.out(null, 0.3, 0.08);
    this.burst(out, t, { ftype: 'highpass', f: 4000, a: 0.0005, d: 0.008, peak: 0.35 });
    this.burst(out, t + 0.035, { ftype: 'highpass', f: 3000, a: 0.0005, d: 0.01, peak: 0.25 });
  }
  s_cameraFlash(o, t) {
    const out = this.out(null, 1.6, 0.2);
    const w = this.osc('sine', 1800, t, 0.3);
    w.frequency.exponentialRampToValueAtTime(7000, t + 0.28);
    w.connect(this.env(t, 0.25, 0.04, 0.035, 'lin')).connect(out);
    if (this.buf.shutter) {
      this.sample(out, this.buf.shutter, t + 0.27, { gain: 0.55 });
    } else {
      this.burst(out, t + 0.3, { f: 3000, q: 1, a: 0.001, d: 0.03, peak: 0.5 });
      this.burst(out, t + 0.36, { f: 2200, q: 1, a: 0.001, d: 0.03, peak: 0.4 });
    }
    this.burst(out, t + 0.3, { ftype: 'lowpass', f: 700, d: 0.1, peak: 0.4 });
  }
  s_throwWhoosh(o, t) {
    const out = this.out(null, 0.5, 0.1);
    const n = this.noise('white');
    const bp = this.filt('bandpass', 600, 1.5);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.2);
    n.connect(bp).connect(this.env(t, 0.08, 0.15, 0.18, 'lin')).connect(out);
    this.startNoise(n, t, 0.3);
  }
  s_bottleBreak(o, t) {
    this.s_glass({ ...o, ref: 2.5 }, t);
    const out = this.out(o, 1, 0.6);
    if (this.has('glass_hit')) { this.sample(out, 'glass_hit', t, { rate: rnd(0.9, 1.1), gain: 0.6 }); return; }
    this.burst(out, t, { ftype: 'highpass', f: 1800, a: 0.001, d: 0.2, peak: 0.7 });
    this.thump(out, t, 160, 80, 0.06, 0.4);
  }
  s_gasp(o, t) {
    const out = this.out(null, 1.5, 0.2);
    this.burst(out, t, { type: 'pink', f: 1400, q: 0.8, a: 0.05, d: 0.35, peak: 0.55 });
    this.burst(out, t + 0.45, { type: 'pink', f: 800, q: 0.8, a: 0.03, d: 0.5, peak: 0.45 });
    this.burst(out, t + 1.0, { type: 'pink', f: 1200, q: 0.8, a: 0.05, d: 0.25, peak: 0.35 });
  }
  s_cameraEmpty(o, t) {
    const out = this.out(null, 0.3, 0.1);
    this.burst(out, t, { f: 2000, q: 2, a: 0.001, d: 0.02, peak: 0.25 });
  }
  voiceScream(dest, t, freqs, dur, peak, chop = 0) {
    const c = this.ctx;
    const mix = c.createGain();
    const shaper = c.createWaveShaper();
    shaper.curve = this.makeCurve(60);
    const bp = this.filt('bandpass', 1400, 0.9);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    e.gain.setValueAtTime(peak, t + dur * 0.7);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mix.connect(shaper).connect(bp).connect(e).connect(dest);
    const lfo = this.osc('sine', rnd(9, 13), t, dur);
    const lg = c.createGain();
    lg.gain.value = 30;
    lfo.connect(lg);
    for (const f of freqs) {
      const o = this.osc('sawtooth', f, t, dur);
      o.frequency.linearRampToValueAtTime(f * 1.18, t + dur * 0.2);
      o.frequency.linearRampToValueAtTime(f * 0.72, t + dur);
      lg.connect(o.frequency);
      const g = c.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(mix);
    }
    this.burst(dest, t, { ftype: 'highpass', f: 1800, a: 0.03, d: dur, peak: peak * 0.3 });
    if (chop) {
      const sq = this.osc('square', chop, t, dur);
      const sg = c.createGain();
      sg.gain.value = 0.5;
      sq.connect(sg).connect(e.gain);
    }
  }
  s_shriek(o, t) {
    const out = this.out({ ...o, hrtf: true, ref: 3 }, 2.8, 0.5);
    if (this.buf.scream0) { this.sample(out, this.buf.scream0, t, { rate: rnd(0.95, 1.05), gain: 0.75 }); return; }
    this.voiceScream(out, t, [620, 830, 1040], 0.95, 0.7);
  }
  s_ghostScream(o, t) {
    const out = this.out({ ...o, hrtf: true, ref: 3 }, 3.6, 0.5);
    if (this.buf.scream1) {
      // 錄音放慢一點，再疊一層斷續的合成尖叫，聽起來不像活人
      this.sample(out, this.buf.scream1, t, { rate: rnd(0.8, 0.86), gain: 0.8 });
      this.voiceScream(out, t, [380, 470, 565], 1.6, 0.25, 17);
      return;
    }
    this.voiceScream(out, t, [380, 470, 565], 1.6, 0.8, 17);
  }
  s_jumpscare(o, t) {
    const out = this.out(null, 3.5, 0.35);
    if (this.buf.scream1) {
      this.sample(out, this.buf.scream1, t, { rate: 1.04, gain: 1.0 });
      this.voiceScream(out, t, [700, 880, 1180, 1500], 1.4, 0.35, 23);
    } else this.voiceScream(out, t, [700, 880, 1180, 1500], 1.4, 1.0, 23);
    this.thump(out, t, 55, 28, 1.2, 1.0);
    this.burst(out, t, { type: 'white', ftype: 'bandpass', f: 2500, q: 0.6, a: 0.005, d: 0.8, peak: 0.6 });
    this.s_stinger({ vol: 0.8 }, t);
  }
  s_stinger(o, t) {
    const out = this.out(null, 4, 0.6);
    if (this.buf.woosh) this.sample(out, this.buf.woosh, t, { rate: 0.9, gain: 0.5 * (o.vol || 1) });
    const c = this.ctx;
    const lp = this.filt('lowpass', 7000, 0.7);
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(350, t + 2.6);
    const e = this.env(t, 0.006, 2.8, 0.22 * (o.vol || 1));
    lp.connect(e).connect(out);
    for (const f of [55, 58.27, 82.41, 116.54, 233.08, 246.94, 466.16]) {
      const os = this.osc('sawtooth', f * rnd(0.995, 1.005), t, 3);
      const g = c.createGain();
      g.gain.value = 0.3;
      os.connect(g).connect(lp);
    }
    this.burst(out, t, { f: 2200, q: 0.6, a: 0.002, d: 0.6, peak: 0.25 * (o.vol || 1) });
    this.thump(out, t, 48, 30, 1.6, 0.7 * (o.vol || 1));
  }
  s_whisper(o, t) {
    const dur = o.dur || rnd(1.4, 2.6);
    const out = this.out(o.pos ? { ...o, hrtf: true } : o, dur, 0.35);
    const c = this.ctx;
    const n = this.noise('white');
    const hp = this.filt('highpass', 900, 0.7);
    const f1 = this.filt('bandpass', 700, 6), f2 = this.filt('bandpass', 1400, 8);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, t);
    const vowels = [[700, 1220], [300, 2300], [420, 820], [520, 1700], [360, 1950], [600, 1000]];
    let tt = t;
    while (tt < t + dur) {
      const [a, b] = pick(vowels);
      f1.frequency.setValueAtTime(a, tt); f2.frequency.setValueAtTime(b, tt);
      const sy = rnd(0.08, 0.2);
      amp.gain.setValueAtTime(0.0, tt);
      amp.gain.linearRampToValueAtTime(rnd(0.25, 0.6) * (o.vol || 1), tt + 0.025);
      amp.gain.linearRampToValueAtTime(0.02, tt + sy);
      if (Math.random() < 0.25) this.burst(out, tt, { ftype: 'highpass', f: 5000, a: 0.02, d: 0.12, peak: 0.05 * (o.vol || 1) });
      tt += sy + (Math.random() < 0.2 ? rnd(0.1, 0.3) : 0);
    }
    amp.gain.linearRampToValueAtTime(0, t + dur);
    const g1 = c.createGain(), g2 = c.createGain();
    g1.gain.value = 1.4; g2.gain.value = 1.0;
    n.connect(hp);
    hp.connect(f1).connect(g1).connect(amp);
    hp.connect(f2).connect(g2).connect(amp);
    amp.connect(out);
    this.startNoise(n, t, dur);
  }
  s_thunder(o, t) {
    const near = o.near ?? Math.random();
    const B = near > 0.55 ? this.buf.thunder_near : this.buf.thunder_far;
    if (B) {
      const out = this.out(null, B.duration + 1, 0.6);
      // 隔著牆聽：高頻悶掉一些
      const lp = this.filt('lowpass', 1800 + near * 3000, 0.5);
      lp.connect(out);
      this.sample(lp, B, t + (1 - near) * 0.8, { rate: rnd(0.9, 1.05), gain: 0.35 + near * 0.45 });
      return;
    }
    const out = this.out(null, 6, 0.6);
    const c = this.ctx;
    const n = this.noise('brown');
    const lp = this.filt('lowpass', 900, 0.5);
    lp.frequency.setValueAtTime(near > 0.5 ? 1800 : 700, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + 4.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let tt = t + (1 - near) * 1.2;
    g.gain.exponentialRampToValueAtTime(0.4 + near * 0.5, tt + 0.08);
    for (let k = 0; k < 30; k++) { tt += rnd(0.08, 0.2); g.gain.linearRampToValueAtTime(rnd(0.1, 0.6) * (1 - k / 32) * (0.5 + near), tt); }
    g.gain.linearRampToValueAtTime(0, tt + 0.6);
    n.connect(lp).connect(g).connect(out);
    this.startNoise(n, t, tt - t + 0.7);
    if (near > 0.6) this.burst(out, t, { ftype: 'highpass', f: 1200, a: 0.002, d: 0.3, peak: 0.25 });
  }
  s_distantBang(o, t) {
    const out = this.out(o, 3.5, 0.8);
    if (this.buf.bang) { this.sample(out, this.buf.bang, t, { rate: rnd(0.85, 1.0), gain: 0.7 }); return; }
    this.thump(out, t, 50, 30, 0.8, 0.8);
    this.burst(out, t, { ftype: 'lowpass', f: 500, d: 0.6, peak: 0.6 });
  }
  s_metalClank(o, t) {
    const out = this.out(o, 5, 0.7);
    if (this.buf.metal_reverb) {
      if (this.has('metal')) this.sample(out, 'metal', t, { rate: rnd(0.8, 1.0), gain: 0.5 });
      this.sample(out, this.buf.metal_reverb, t, { rate: rnd(0.9, 1.1), gain: 0.6 });
      return;
    }
    this.burst(out, t, { f: 1200, q: 1, a: 0.001, d: 0.05, peak: 0.4 });
    this.ring(out, t, [[520, 30, 0.6], [1340, 45, 0.45], [2210, 40, 0.35], [3600, 60, 0.2]], 2, 0.9);
  }
  s_glass(o, t) {
    const out = this.out(o, 2, 0.5);
    if (this.buf.glass) { this.sample(out, this.buf.glass, t, { rate: rnd(0.9, 1.12), gain: 0.75 }); return; }
    this.burst(out, t, { ftype: 'highpass', f: 2500, a: 0.001, d: 0.12, peak: 0.5 });
    for (let k = 0; k < 14; k++) {
      const tt = t + rnd(0, 0.5), f = rnd(3000, 7800), d = rnd(0.04, 0.2);
      this.osc('sine', f, tt, d).connect(this.env(tt, 0.001, d, rnd(0.03, 0.09))).connect(out);
    }
  }
  s_static(o, t) {
    const dur = o.dur || rnd(0.25, 0.7);
    const out = this.out(null, dur, 0.05);
    const n = this.noise('white');
    const bp = this.filt('bandpass', 2600, 0.5);
    const g = this.ctx.createGain();
    for (let tt = 0; tt < dur; tt += 0.03) g.gain.setValueAtTime(Math.random() < 0.7 ? rnd(0.05, 0.25) * (o.vol || 1) : 0, t + tt);
    g.gain.setValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(out);
    this.startNoise(n, t, dur);
  }
  s_fuseInsert(o, t) {
    const out = this.out(o, 2, 0.4);
    if (this.buf.latch) this.sample(out, this.buf.latch, t, { rate: 0.8, gain: 0.7 });
    else {
      this.thump(out, t, 130, 60, 0.12, 0.6);
      this.ring(out, t, [[880, 30, 0.4], [2100, 40, 0.3]], 0.8, 0.5);
    }
    const z = this.osc('sawtooth', 1400, t + 0.25, 0.4);
    z.frequency.exponentialRampToValueAtTime(70, t + 0.6);
    z.connect(this.filt('bandpass', 900, 1)).connect(this.env(t + 0.25, 0.005, 0.35, 0.25)).connect(out);
    for (let k = 0; k < 10; k++) this.burst(out, t + 0.25 + rnd(0, 0.35), { ftype: 'highpass', f: 3000, a: 0.001, d: 0.012, peak: 0.25 });
  }
  s_powerUp(o, t) {
    const out = this.out(null, 4, 0.5);
    const s = this.osc('sine', 35, t, 2.5);
    s.frequency.exponentialRampToValueAtTime(60, t + 1.5);
    s.connect(this.env(t, 0.6, 1.8, 0.6)).connect(out);
    this.burst(out, t, { type: 'brown', ftype: 'lowpass', f: 300, a: 0.4, d: 1.5, peak: 0.5 });
    for (let k = 0; k < 6; k++) {
      const tt = t + 0.6 + k * rnd(0.12, 0.3);
      this.burst(out, tt, { ftype: 'highpass', f: 3500, a: 0.001, d: 0.02, peak: 0.25 });
      this.osc('sine', rnd(2800, 3400), tt, 0.15).connect(this.env(tt, 0.002, 0.12, 0.04)).connect(out);
    }
  }
  s_gateOpen(o, t) {
    const out = this.out(o, 4, 0.5);
    this.burst(out, t, { ftype: 'highpass', f: 2000, a: 0.001, d: 0.08, peak: 0.5 });
    this.thump(out, t, 90, 40, 0.3, 0.8);
    const m = this.osc('sawtooth', 70, t + 0.3, 2.2);
    m.frequency.linearRampToValueAtTime(120, t + 2.4);
    m.connect(this.filt('lowpass', 500, 1)).connect(this.env(t + 0.3, 0.3, 1.9, 0.18, 'lin')).connect(out);
    this.creak(out, t + 0.4, 1.8, 0.35);
  }
  s_heartOnce(o, t) {
    const out = this.out(null, 1, 0.05);
    this.thump(out, t, 60, 36, 0.16, o.vol || 0.6);
    this.thump(out, t + 0.22, 55, 34, 0.14, (o.vol || 0.6) * 0.7);
  }
  s_uiClick(o, t) {
    const out = this.out(null, 0.3, 0.2);
    this.osc('sine', 660, t, 0.08).connect(this.env(t, 0.002, 0.08, 0.06)).connect(out);
    this.burst(out, t, { ftype: 'highpass', f: 3000, a: 0.001, d: 0.01, peak: 0.08 });
  }
  s_uiHover(o, t) {
    const out = this.out(null, 0.2, 0.2);
    this.osc('sine', 880, t, 0.04).connect(this.env(t, 0.002, 0.04, 0.02)).connect(out);
  }
  s_wheelchair(o, t) {
    const out = this.out({ ...o, hrtf: true }, 4, 0.4);
    if (this.buf.squeak) {
      this.sample(out, this.buf.squeak, t, { rate: rnd(0.9, 1.05), gain: 0.55 });
      this.burst(out, t, { type: 'brown', ftype: 'lowpass', f: 350, a: 0.3, d: 2.4, peak: 0.4 });
      return;
    }
    this.burst(out, t, { type: 'brown', ftype: 'lowpass', f: 350, a: 0.2, d: 1.6, peak: 0.6 });
    for (let k = 0; k < 5; k++) {
      const tt = t + 0.1 + k * 0.33;
      const s = this.osc('sine', rnd(1700, 2100), tt, 0.12);
      s.frequency.linearRampToValueAtTime(rnd(1500, 1900), tt + 0.12);
      s.connect(this.env(tt, 0.02, 0.1, 0.05)).connect(out);
    }
  }
  s_musicBox(o, t) {
    const out = this.out({ ...o, hrtf: true }, 12, 0.5);
    let tt = t;
    for (const [m, d] of LULLABY) {
      if (tt > t + (o.dur || 10)) break;
      if (m > 0) {
        const f = mtof(m + 24) * (1 + rnd(-0.006, 0.006));
        this.osc('sine', f, tt, 1.2).connect(this.env(tt, 0.002, 1.1, 0.12)).connect(out);
        this.osc('sine', f * 3.01, tt, 0.4).connect(this.env(tt, 0.002, 0.35, 0.03)).connect(out);
      }
      tt += d * 0.75 * (1 + (tt - t) * 0.03); // 越來越慢，像發條快轉完
    }
  }
  s_breathBehind(o, t) {
    const out = this.out({ ...o, hrtf: true, ref: 0.6 }, 3, 0.15);
    for (let k = 0; k < 2; k++) {
      const tt = t + k * 1.3;
      this.burst(out, tt, { f: 900, q: 0.8, a: 0.5, d: 0.25, peak: 0.25 });
      this.burst(out, tt + 0.6, { f: 550, q: 0.8, a: 0.05, d: 0.55, peak: 0.3 });
    }
  }
  s_steps(o, t) {
    // 有人在身後走路（幻聽事件）
    for (let k = 0; k < (o.n || 4); k++) {
      const p = o.path ? o.path(k) : o.pos;
      this.s_ghostStep({ pos: p }, t + k * 0.55);
    }
  }
  s_alarmChirp(o, t) {
    const out = this.out(null, 0.6, 0.4);
    this.osc('square', 880, t, 0.25).connect(this.filt('bandpass', 1500, 1)).connect(this.env(t, 0.01, 0.25, 0.08)).connect(out);
  }

  // ---------------------------------------------------------------------
  // 持續聲音
  startAmbience() {
    if (!this.ctx) return;
    if (this.ambStarted) { this.amb.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5); return; }
    this.ambStarted = true;
    const c = this.ctx, t = c.currentTime;
    // 房間底噪
    const room = this.noise('brown');
    const rl = this.filt('lowpass', 170, 0.7);
    const rg = c.createGain();
    rg.gain.value = 0.13;
    room.connect(rl).connect(rg).connect(this.amb);
    room.start(t);
    // 低頻嗡鳴
    this.drone = c.createGain();
    this.drone.gain.value = 0.05;
    for (const f of [41.2, 61.7, 62.15]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(this.drone);
      o.start(t);
    }
    const dl = c.createOscillator();
    dl.frequency.value = 0.05;
    const dlg = c.createGain();
    dlg.gain.value = 0.025;
    dl.connect(dlg).connect(this.drone.gain);
    dl.start(t);
    this.drone.connect(this.amb);
    // 雨聲（建築物裡，悶悶的）
    this.rainGain = c.createGain();
    this.rainGain.gain.value = 0.11;
    this.rainGain.connect(this.amb);
    const rain = this.noise('pink');
    const rh = this.filt('highpass', 400, 0.5), rlp = this.filt('lowpass', 2600, 0.5);
    this.rainNoiseGain = c.createGain();
    rain.connect(rh).connect(rlp).connect(this.rainNoiseGain).connect(this.rainGain);
    rain.start(t);
    this.rainNoise = rain;
    this.useSampledRain();
    // 風聲
    const wind = this.noise('white');
    const wb = this.filt('bandpass', 450, 7);
    const wl = c.createOscillator();
    wl.frequency.value = 0.06;
    const wlg = c.createGain();
    wlg.gain.value = 200;
    wl.connect(wlg).connect(wb.frequency);
    wl.start(t);
    const wg = c.createGain();
    wg.gain.value = 0.05;
    wind.connect(wb).connect(wg).connect(this.amb);
    wind.start(t);
    // 耳鳴（理智低時）
    this.tinn = c.createGain();
    this.tinn.gain.value = 0;
    const to = c.createOscillator();
    to.frequency.value = 3950;
    to.connect(this.tinn).connect(this.amb);
    to.start(t);
    // 鬼魂靠近時的收音機雜訊
    const st = this.noise('white');
    const sb = this.filt('bandpass', 3200, 0.6);
    this.staticGain = c.createGain();
    this.staticGain.gain.value = 0;
    st.connect(sb).connect(this.staticGain).connect(this.amb);
    st.start(t);
    // 追逐配樂底層
    this.chaseGain = c.createGain();
    this.chaseGain.gain.value = 0;
    this.chaseGain.connect(this.music);
    const trem = c.createGain();
    const tl = c.createOscillator();
    tl.frequency.value = 9;
    const tlg = c.createGain();
    tlg.gain.value = 0.5;
    tl.connect(tlg).connect(trem.gain);
    tl.start(t);
    trem.gain.value = 0.5;
    const lp = this.filt('lowpass', 800, 1);
    for (const f of [73.42, 77.78, 110, 116.54]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = rnd(-8, 8);
      const g = c.createGain();
      g.gain.value = 0.09;
      o.connect(g).connect(lp);
      o.start(t);
    }
    lp.connect(trem).connect(this.chaseGain);
    this.amb.gain.setTargetAtTime(1, t, 1.5);
  }

  // 參數變化很小就不排新的自動化事件（每格呼叫，避免時間軸塞爆）
  changed(key, v, eps = 0.004) {
    this.last = this.last || {};
    if (this.last[key] !== undefined && Math.abs(this.last[key] - v) < eps) return false;
    this.last[key] = v;
    return true;
  }
  setRain(v) { if (this.rainGain && this.changed('rain', v)) this.rainGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); }
  setTinnitus(v) { if (this.tinn && this.changed('tinn', v)) this.tinn.gain.setTargetAtTime(v * 0.012, this.ctx.currentTime, 0.4); }
  setStatic(v) { if (this.staticGain && this.changed('static', v)) this.staticGain.gain.setTargetAtTime(v * 0.08, this.ctx.currentTime, 0.15); }
  setHeartbeat(bpm, vol) { this.hb.bpm = bpm; this.hb.vol = vol; }
  setBreathing(level, hiding = false) { this.breath.level = level; this.breath.hiding = hiding; }
  setChase(level) {
    this.chase.level = level;
    if (this.chaseGain && this.changed('chase', level)) this.chaseGain.gain.setTargetAtTime(level * 0.55, this.ctx.currentTime, level > 0.5 ? 0.3 : 1.2);
  }
  setAlarm(on) { this.alarmOn = on; }

  startHum(em) {
    if (!this.ctx || !em || !em.input) return;
    if (this.hums.has(em)) return;
    this.hums.set(em, { i: Math.floor(Math.random() * LULLABY.length), next: this.ctx.currentTime + 0.3, drift: 0 });
  }
  stopHum(em) { this.hums.delete(em); }

  humNote(em, m, t, d, drift) {
    const c = this.ctx;
    const f = mtof(m) * Math.pow(2, drift / 1200);
    const vib = c.createOscillator();
    vib.frequency.value = rnd(4.5, 5.8);
    const vg = c.createGain();
    vg.gain.value = f * 0.012;
    vib.connect(vg);
    vib.start(t);
    vib.stop(t + d + 0.4);
    const mix = c.createGain();
    mix.gain.value = 0.5;
    for (const [type, det, g] of [['triangle', 0, 0.8], ['sawtooth', -9, 0.18]]) {
      const o = this.osc(type, f, t, d + 0.35);
      o.detune.value = det;
      vg.connect(o.frequency);
      if (Math.random() < 0.25) o.frequency.linearRampToValueAtTime(f * 0.94, t + d + 0.3); // 尾音往下滑
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og).connect(mix);
    }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.16);
    env.gain.setValueAtTime(0.45, t + d);
    env.gain.linearRampToValueAtTime(0.0001, t + d + 0.3);
    const sum = c.createGain();
    for (const [ff, q, g] of [[380, 5, 1.0], [880, 7, 0.55], [2600, 9, 0.2]]) {
      const b = this.filt('bandpass', ff, q);
      const bg = c.createGain();
      bg.gain.value = g * 2.2;
      mix.connect(b).connect(bg).connect(sum);
    }
    sum.connect(env).connect(em.input);
  }

  // 排程器：心跳、呼吸、哼歌、追逐鼓點、滴水
  tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime, ahead = now + 0.2;
    // 心跳
    if (this.hb.bpm > 0 && this.hb.vol > 0.01) {
      if (this.hb.next < now) this.hb.next = now + 0.05;
      while (this.hb.next < ahead) {
        const t = this.hb.next, v = this.hb.vol;
        const out = this.out(null, 1, 0.02);
        const lp = this.filt('lowpass', 160, 0.7);
        lp.connect(out);
        if (this.buf.heart_lub && this.buf.heart_dub) {
          const gap = 60 / this.hb.bpm * 0.32;
          this.sample(out, this.buf.heart_lub, t, { gain: v * 1.3 });
          this.sample(out, this.buf.heart_dub, t + Math.min(gap, 0.3), { gain: v * 0.9 });
          this.thump(lp, t, 60, 36, 0.12, v * 0.35);
        } else {
          this.thump(lp, t, 62, 36, 0.15, v);
          this.thump(lp, t + 60 / this.hb.bpm * 0.32, 56, 34, 0.13, v * 0.65);
        }
        this.hb.next += 60 / this.hb.bpm;
      }
    }
    // 呼吸
    if (this.breath.level > 0.05) {
      if (this.breath.next < now) this.breath.next = now + 0.05;
      while (this.breath.next < ahead) {
        const t = this.breath.next, L = this.breath.level, hid = this.breath.hiding;
        const out = this.out(null, 2, 0.08);
        const ins = hid ? 0.9 : 0.55 - L * 0.25, exh = hid ? 1.1 : 0.45 - L * 0.15;
        this.burst(out, t, { type: 'pink', f: 1300, q: 0.9, a: ins * 0.7, d: ins * 0.3, peak: 0.07 + L * 0.15 * (hid ? 0.3 : 1) });
        this.burst(out, t + ins + 0.05, { type: 'pink', f: 720, q: 0.8, a: 0.06, d: exh, peak: 0.08 + L * 0.18 * (hid ? 0.3 : 1) });
        this.breath.next += ins + exh + (hid ? 1.4 : 0.25 + (1 - L) * 0.8);
      }
    }
    // 哼歌
    for (const [em, st] of this.hums) {
      while (st.next < ahead) {
        const [m, d] = LULLABY[st.i % LULLABY.length];
        if (m > 0) this.humNote(em, m, st.next, d * 0.95, st.drift + rnd(-12, 12));
        st.next += d;
        st.i++;
        if (st.i % LULLABY.length === 0) st.drift = rnd(-40, 10);
      }
    }
    // 追逐鼓點
    if (this.chase.level > 0.05 && this.chaseGain) {
      if (this.chase.next < now) this.chase.next = now + 0.05;
      const beat = 60 / 138;
      while (this.chase.next < ahead) {
        const t = this.chase.next, b = this.chase.beat++ % 8;
        const lv = this.chase.level;
        const g = c.createGain();
        g.gain.value = lv;
        g.connect(this.music);
        if (b % 2 === 0) this.thump(g, t, 58, 32, 0.3, 0.75);
        if (b === 3 || b === 7) this.thump(g, t, 58, 32, 0.25, 0.45);
        if (b === 0 || b === 5) {
          const lp = this.filt('lowpass', 2200, 0.8);
          const e = this.env(t, 0.004, 0.32, 0.11);
          lp.connect(e).connect(g);
          for (const f of [146.8, 155.6, 220, 233.1]) this.osc('sawtooth', f, t, 0.4).connect(lp);
        }
        if (b === 6 && Math.random() < 0.4) {
          const s = this.osc('sine', 1760, t, 0.9);
          const v = this.osc('sine', 14, t, 0.9);
          const vg = c.createGain();
          vg.gain.value = 40;
          v.connect(vg).connect(s.frequency);
          s.connect(this.env(t, 0.2, 0.7, 0.025)).connect(g);
        }
        setTimeout(() => { try { g.disconnect(); } catch (e) { /* 已斷開 */ } }, 3000);
        this.chase.next += beat;
      }
    }
    // 漏水滴答
    if (this.ambStarted) {
      if (this.drips.next < now) this.drips.next = now + rnd(0.8, 4);
      if (this.drips.next < ahead) {
        const t = this.drips.next;
        const out = this.out({ pan: rnd(-0.8, 0.8) }, 0.5, 0.5);
        const f = rnd(1400, 3200);
        const o = this.osc('sine', f, t, 0.06);
        o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.05);
        o.connect(this.env(t, 0.001, 0.05, rnd(0.02, 0.05))).connect(out);
        this.drips.next = t + rnd(0.6, 5);
      }
      // 警報
      if (this.alarmOn) {
        if (!this.alarmNext || this.alarmNext < now) this.alarmNext = now + 0.05;
        if (this.alarmNext < ahead) {
          const t = this.alarmNext;
          const out = this.out(null, 1, 0.5);
          const o = this.osc('sawtooth', 650, t, 0.9);
          o.frequency.linearRampToValueAtTime(900, t + 0.45);
          o.frequency.linearRampToValueAtTime(650, t + 0.9);
          o.connect(this.filt('bandpass', 1000, 1.5)).connect(this.env(t, 0.02, 0.85, 0.07, 'lin')).connect(out);
          this.alarmNext = t + 1.0;
        }
      }
      // 電話鈴
      if (this.phone) {
        const ph = this.phone;
        if (ph.next < now) ph.next = now + 0.05;
        if (ph.next < ahead) {
          const t = ph.next;
          if (this.buf.phone) {
            const out = this.out({ pos: ph.pos, hrtf: true, ref: 2 }, 4, 0.4);
            this.sample(out, this.buf.phone, t, { gain: 0.5 });
            ph.next = t + 4.6;
          } else {
            const out = this.out({ pos: ph.pos, hrtf: true, ref: 2 }, 2.5, 0.4);
            const am = this.osc('square', 20, t, 1.6);
            const amg = c.createGain();
            amg.gain.value = 0.5;
            const g = c.createGain();
            g.gain.value = 0.5;
            am.connect(amg).connect(g.gain);
            for (const f of [440, 480]) this.osc('sine', f, t, 1.6).connect(g);
            g.connect(this.env(t, 0.01, 1.6, 0.25, 'lin')).connect(out);
            ph.next = t + 4;
          }
        }
      }
    }
  }

  startPhone(pos) { this.phone = { pos, next: 0 }; }
  stopPhone() { this.phone = null; }

  stopAll() {
    this.hums.clear();
    this.setHeartbeat(0, 0);
    this.setBreathing(0);
    this.setChase(0);
    this.setStatic(0);
    this.setTinnitus(0);
    this.alarmOn = false;
    this.phone = null;
    this.last = {};
    if (this.amb) this.amb.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    for (const em of [...this.emitters]) em.dispose();
  }
}

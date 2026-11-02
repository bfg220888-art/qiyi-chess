// 配樂：用真實樂器錄音（VSCO 2 社群版，CC0，見 CREDITS.md）即時編排、隨情境變化。
// 主題是布拉姆斯〈搖籃曲〉：選單是音樂盒（鐘琴）配輕輕的鋼琴分解和弦，發條快轉完時越走越慢、
// 偶爾走音或少一個齒；醫院裡只有很遠的地方偶爾傳來一兩小節，中間是稀疏的鋼琴與低音弦樂；
// 她靠近時大提琴與小提琴的顫弓慢慢浮上來，被追時加上低音鋼琴重擊；躲在櫃子裡時音樂幾乎消失；
// 逃出去時是鋼琴版的搖籃曲，被抓到時音樂盒停在半句。只排程取樣播放，CPU 負擔很小。
import { assetBuffer } from './assets.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 搖籃曲：布拉姆斯〈搖籃曲〉（Wiegenlied, Op. 49 No. 4，1868 年，公有領域）。3/4 拍，降 E 大調（原調）。
// 音符是照原曲旋律自己寫進來的（MIDI 音高、拍數），女鬼哼的、音樂盒放的、結局的鋼琴都是這一首。
const KEY = 3; // 以 C 大調寫，整首往上移到降 E
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72;
// 每小節：[旋律 [音高, 拍數]…], 和弦。最後一小節結尾的兩個八分音符是回到第一小節的弱起拍
const BARS = [
  [[[G4, 2], [E4, 0.5], [E4, 0.5]], 'I'],
  [[[G4, 2], [E4, 0.5], [G4, 0.5]], 'I'],
  [[[C5, 1], [B4, 1.5], [A4, 0.5]], 'V'],
  [[[A4, 1], [G4, 1], [D4, 0.5], [E4, 0.5]], 'V'],
  [[[F4, 1], [D4, 1], [D4, 0.5], [E4, 0.5]], 'V'],
  [[[F4, 2], [D4, 0.5], [F4, 0.5]], 'V'],
  [[[B4, 0.5], [A4, 0.5], [G4, 1], [B4, 1]], 'V'],
  [[[C5, 2], [C4, 0.5], [C4, 0.5]], 'I'],
  [[[C5, 2], [A4, 0.5], [F4, 0.5]], 'IV'],
  [[[G4, 2], [E4, 0.5], [C4, 0.5]], 'I'],
  [[[F4, 1], [G4, 1], [A4, 1]], 'IV'],
  [[[G4, 2], [C4, 0.5], [C4, 0.5]], 'I'],
  [[[C5, 2], [A4, 0.5], [F4, 0.5]], 'IV'],
  [[[G4, 2], [E4, 0.5], [C4, 0.5]], 'I'],
  [[[F4, 0.5], [E4, 0.5], [D4, 1], [G4, 1]], 'V'],
  [[[C4, 2], [E4, 0.5], [E4, 0.5]], 'I'],
];
// 伴奏（C 大調寫法，播放時加 KEY）：低音＋中音區的和弦音
const CHORDS = {
  I: { bass: 36, mid: [55, 60, 64] },
  V: { bass: 31, mid: [53, 59, 62] },
  IV: { bass: 29, mid: [57, 60, 65] },
};
// 攤平成音符表：m 音高（已移調）、d 拍數、bar 第幾小節、at 小節內第幾拍
export const LULLABY = [];
BARS.forEach(([notes, ch], bar) => {
  let at = 0;
  for (const [m, d] of notes) { LULLABY.push({ m: m + KEY, d, bar, at, ch }); at += d; }
});
// 從弱起拍開始（最後一小節的兩個八分音符）
export const LULLABY_START = LULLABY.length - 2;
export const LULLABY_BEAT = 60 / 66; // 每拍秒數（約 66 bpm）
export const lullabyChord = (ch) => ({ bass: CHORDS[ch].bass + KEY, mid: CHORDS[ch].mid.map((m) => m + KEY) });
// 某一小節開頭的音符索引（含前一小節的弱起拍）
export function phraseStart(bar) {
  let i = LULLABY.findIndex((n) => n.bar === bar && n.at === 0);
  const prev = (i - 1 + LULLABY.length) % LULLABY.length;
  if (LULLABY[prev].at >= 2) i = prev;
  const prev2 = (i - 1 + LULLABY.length) % LULLABY.length;
  if (LULLABY[prev2].at >= 2 && LULLABY[prev2].bar === LULLABY[i].bar) i = prev2;
  return i;
}

// 樂器取樣：檔名前綴 → 每個檔的音高（MIDI）。鐘琴的錄音本身偏高一點點
const BANK = {
  pno: [25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93], // 直立鋼琴（輕）
  pnof: [25, 29, 33], // 直立鋼琴低音（重）
  vc: [36, 40, 43, 47, 50, 57], // 大提琴長音
  vct: [40, 47, 53, 57], // 大提琴顫弓
  cb: [28, 34], // 低音提琴長音
  vnt: [66, 76, 83], // 小提琴顫弓
  glk: [79.08, 84.12, 91.12, 96.15, 103.16, 108.24], // 鐘琴（當音樂盒）
};

// 探索時的和聲進行（C 小調，降 E 大調的關係小調：Cm – A♭ – Fm – G）：大提琴兩個音＋低音提琴根音，鋼琴琶音用的和弦音
const PROG = [
  { pad: [48, 55], root: 36, arp: [60, 67, 72, 75] },
  { pad: [44, 51], root: 32, arp: [56, 63, 67, 72] },
  { pad: [41, 48], root: 29, arp: [53, 60, 65, 68] },
  { pad: [43, 50], root: 31, arp: [55, 62, 67, 71] },
];

export class Score {
  constructor(engine) {
    this.A = engine;
    const c = (this.ctx = engine.ctx);
    this.bank = {};
    this.mode = 'off';
    this.tension = 0;
    this.chase = 0;
    this.hiding = false;
    this.live = new Set();
    this.tremLv = 0;
    this.tremNext = 0;
    // 混音：鋼琴、弦樂長音、音樂盒會在躲藏時壓低；顫弓和重擊不壓
    this.bus = c.createGain();
    this.bus.connect(engine.music);
    this.send = c.createGain(); // 殘響（共用遊戲的殘響，音量跟著音樂音量走）
    this.send.gain.value = 0.6 * engine.musicVolume;
    this.send.connect(engine.revSend);
    this.bus.connect(this.send);
    this.soft = c.createGain();
    this.soft.connect(this.bus);
    const layer = (dest, gain, lp) => {
      const g = c.createGain();
      g.gain.value = gain;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.Q.value = 0.5;
      g.connect(f).connect(dest);
      return g;
    };
    this.keys = layer(this.soft, 1, 3600); // 悶悶的，像隔著牆從別的房間傳來
    this.pad = layer(this.soft, 1, 2200);
    this.box = layer(this.soft, 1, 5000);
    this.far = layer(this.soft, 0.8, 1500); // 很遠的音樂盒：只剩低頻、殘響多
    this.farSend = c.createGain();
    this.farSend.gain.value = 1.4;
    this.far.connect(this.farSend).connect(engine.revSend);
    this.herNear = 0;
    this.trem = layer(this.bus, 0, 6000);
    this.hits = layer(this.bus, 1, 4000);
  }

  // 取樣用 24 kHz 解碼：音色差不多，記憶體省一半（手機比較不會因為記憶體不足重新載入）
  load(base = 'assets/music/') {
    if (this.loading) return this.loading;
    let dc = this.ctx;
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (OAC) dc = new OAC(1, 1, 24000);
    } catch (e) { /* 用主要的音訊環境解碼 */ }
    const decode = (ab) => new Promise((res, rej) => {
      const p = dc.decodeAudioData(ab, res, rej);
      if (p && p.catch) p.catch(rej);
    });
    const jobs = [];
    for (const [inst, notes] of Object.entries(BANK)) {
      for (const m of notes) {
        jobs.push((async () => {
          try {
            const b = await decode(await assetBuffer(`${base}${inst}${Math.round(m)}.mp3`));
            (this.bank[inst] || (this.bank[inst] = [])).push({ m, b });
          } catch (e) { /* 少一個音就用相鄰的音變調 */ }
        })());
      }
    }
    this.loading = Promise.all(jobs).then(() => {
      const n = Object.values(this.bank).reduce((a, l) => a + l.length, 0);
      const all = Object.values(BANK).reduce((a, l) => a + l.length, 0);
      if (n < all) console.warn(`配樂取樣載入 ${n}/${all}`);
    });
    return this.loading;
  }
  has(inst) { return !!(this.bank[inst] && this.bank[inst].length); }

  // 挑最接近的取樣
  near(inst, m) {
    const list = this.bank[inst];
    if (!list || !list.length) return null;
    let best = list[0];
    for (const s of list) if (Math.abs(s.m - m) < Math.abs(best.m - m)) best = s;
    return { b: best.b, rate: Math.pow(2, (m - best.m) / 12) };
  }

  // 播一個音。dur 是想要的長度（會被取樣長度限制），回傳實際長度
  play(inst, m, t, { vel = 0.4, dest = this.keys, dur, att = 0.005, rel = 0.8, offset = 0, pan = 0 } = {}) {
    const s = this.near(inst, m);
    if (!s) return 0;
    const c = this.ctx;
    offset = Math.min(offset, s.b.duration * 0.5);
    const avail = (s.b.duration - offset) / s.rate;
    const len = Math.max(0.05, Math.min(dur ?? avail, avail));
    const src = c.createBufferSource();
    src.buffer = s.b;
    src.playbackRate.value = s.rate;
    const g = c.createGain();
    g.gain.value = 0;
    att = Math.min(att, len * 0.5);
    rel = Math.min(rel, len - att);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + att);
    g.gain.setValueAtTime(vel, t + len - rel);
    g.gain.linearRampToValueAtTime(0, t + len);
    src.connect(g);
    let tail = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(dest);
    src.start(t, offset, len * s.rate);
    const v = { src, g, tail, t };
    this.live.add(v);
    src.onended = () => {
      this.live.delete(v);
      try { g.disconnect(); tail.disconnect(); } catch (e) { /* 已斷開 */ }
    };
    return len;
  }

  // 長音：取樣不夠長就接下一段（從不同位置開始、互相交叉淡入），像持續拉弓
  hold(inst, m, t, dur, { vel = 0.25, dest = this.pad, att = 2, rel = 2.5, xf = 1.6 } = {}) {
    const s = this.near(inst, m);
    if (!s) return;
    const end = t + dur;
    let at = t, first = true;
    for (let k = 0; k < 8 && at < end - 0.5; k++) {
      const offset = first ? rnd(0.15, 0.5) : rnd(0.6, 1.3);
      const seg = Math.min(end - at, (s.b.duration - offset) / s.rate);
      const last = at + seg >= end - 0.01;
      const len = this.play(inst, m, at, { vel, dest, dur: seg, offset, att: first ? att : xf, rel: last ? rel : xf });
      if (!len || last) return;
      first = false;
      at += Math.max(len - xf, 0.5);
    }
  }

  // 停掉所有排定與正在響的音（淡出）
  stop(fade = 0.8) {
    const c = this.ctx, now = c.currentTime;
    const dead = [...this.live];
    this.live.clear();
    for (const v of dead) {
      try {
        // 還沒開始的音直接取消
        if (v.t > now) { v.src.stop(now); continue; }
        // 停在目前的音量再淡出（直接取消正在進行的漸變會跳回前一個值而爆音）
        const p = v.g.gain;
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
        p.setTargetAtTime(0, now, fade / 4);
        v.src.stop(now + fade);
      } catch (e) { /* 已停止 */ }
    }
    // 還沒開始就被停掉的音，有些瀏覽器不會觸發 ended：自己斷開
    if (dead.length) setTimeout(() => { for (const v of dead) try { v.g.disconnect(); v.tail.disconnect(); } catch (e) { /* 已斷開 */ } }, fade * 1000 + 300);
    this.mode = 'off';
    this.tremLv = 0;
    this.trem.gain.cancelScheduledValues(now);
    this.trem.gain.setTargetAtTime(0, now, fade / 4);
    // 在櫃子裡被抓到時也要把壓低的音量放回來，結局的音樂才不會悶掉
    this.hiding = false;
    this.soft.gain.cancelScheduledValues(now);
    this.soft.gain.setTargetAtTime(1, now, 0.3);
    this.last = {};
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    if (prev !== 'off') this.stop(prev === 'menu' ? 2.5 : 1.2);
    this.mode = mode;
    const now = this.ctx.currentTime;
    if (mode === 'menu') this.menu = { i: LULLABY_START, next: now + 0.6, slow: 1, pitch: 0, loop: 0, wob: 0 };
    else if (mode === 'explore') this.ex = { on: false, until: now + rnd(8, 14), padNext: 0, phraseNext: 0, ci: 0, chord: PROG[0] };
    else if (mode === 'win') this.playWin(now + 1.2);
    else if (mode === 'lose') this.playLose(now + 0.4);
  }

  // 每格從遊戲傳進來：tension 0~1（她多近、理智多低），chase 0/1，是否躲在櫃子裡
  setState(tension, chase, hiding) {
    this.tension = tension;
    this.chase = chase;
    if (hiding !== this.hiding) {
      this.hiding = hiding;
      this.soft.gain.setTargetAtTime(hiding ? 0.22 : 1, this.ctx.currentTime, hiding ? 0.6 : 2);
    }
  }
  setVolume(v) {
    this.send.gain.setTargetAtTime(0.6 * v, this.ctx.currentTime, 0.05);
    this.farSend.gain.setTargetAtTime(1.4 * v, this.ctx.currentTime, 0.05);
  }
  // 她在附近、聽得到她的聲音時（0~1）：不放搖籃曲片段，免得跟她的哼歌混在一起
  setHerNear(v) { this.herNear = v; }

  // 由音效引擎的排程器呼叫（約每 50 毫秒）
  tick(now) {
    const ahead = now + 0.3;
    if (this.mode === 'menu') this.menuTick(now, ahead);
    else if (this.mode === 'explore') { this.exploreTick(now, ahead); this.tremTick(now, ahead); }
  }

  // ---- 選單：發條音樂盒
  // 鐘琴放旋律（高兩個八度），鋼琴很輕的低音＋兩下和弦音，大提琴偶爾墊一個長音。
  // 發條：速度會微微晃動，第二遍越走越慢、整體音高往下沉，最後停住、上發條的喀喀聲，再重來
  menuTick(now, ahead) {
    const M = this.menu;
    if (!this.has('glk')) return;
    if (M.next < now) M.next = now + 0.05;
    while (M.next < ahead) {
      const t = M.next, n = LULLABY[M.i];
      M.wob += 0.9;
      const beat = LULLABY_BEAT * M.slow * (1 + 0.035 * Math.sin(M.wob) + rnd(-0.015, 0.015));
      if (Math.random() > 0.015) { // 偶爾少一個齒
        let m = n.m + 24 + M.pitch + rnd(-0.06, 0.06);
        const r = Math.random();
        if (r < 0.05) m += pick([-0.35, 0.4]); // 齒片彎了：走音
        else if (r < 0.07 && M.loop > 0) m += pick([-1, 1]); // 錯一個音
        this.play('glk', m, t, { vel: rnd(0.5, 0.62) * (n.at === 0 ? 1 : 0.85), dest: this.box, rel: 0.7, pan: rnd(-0.1, 0.1) });
      }
      if (n.at === 0) {
        const ch = lullabyChord(n.ch);
        const b3 = 3 * beat;
        this.play('pno', ch.bass + 12 + M.pitch, t, { vel: 0.2, rel: 1.5, dur: b3 + 0.5 });
        for (const k of [1, 2]) for (const m of ch.mid.slice(1)) this.play('pno', m + M.pitch, t + k * beat, { vel: 0.1, rel: 0.6, dur: beat * 0.95 });
        if (n.bar % 4 === 0 && this.has('vc')) this.hold('vc', ch.bass + 12, t, b3 * 2, { vel: 0.08, att: 1.2, rel: 2 });
      }
      M.i = (M.i + 1) % LULLABY.length;
      M.next += n.d * beat;
      if (M.loop % 2 === 1) {
        // 第二遍：發條快轉完了
        M.slow *= 1 + 0.004 + (n.bar >= 12 ? 0.02 : 0);
        M.pitch -= n.bar >= 12 ? 0.012 : 0.003;
      }
      if (M.i === LULLABY_START) {
        M.loop++;
        if (M.loop % 2 === 0) {
          // 停住、上發條、重來
          const w = M.next + 1.5;
          for (let k = 0; k < 9; k++) this.wind(w + k * 0.16 + rnd(0, 0.03));
          M.next = w + 9 * 0.16 + rnd(1.5, 3);
          M.slow = 1;
          M.pitch = 0;
        }
      }
    }
  }
  // 上發條的一聲喀
  wind(t) {
    const A = this.A, c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.5;
    g.connect(this.box);
    A.burst(g, t, { f: rnd(2600, 3200), q: 5, a: 0.0005, d: 0.018, peak: 0.25 });
    A.burst(g, t + 0.004, { f: rnd(900, 1100), q: 3, a: 0.0005, d: 0.03, peak: 0.12 });
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* 已斷開 */ } }, (t - c.currentTime + 1) * 1000);
  }

  // ---- 探索：一段一段的音樂，中間留白
  exploreTick(now, ahead) {
    const S = this.ex;
    if (now > S.until) {
      S.on = !S.on;
      S.until = now + (S.on ? rnd(55, 110) : rnd(20, 45));
    }
    const on = (S.on || this.tension > 0.45) && this.chase < 0.5;
    if (!on) return;
    if (S.padNext < ahead) {
      const t = Math.max(S.padNext, now + 0.05);
      S.padNext = t + this.padChord(t);
    }
    if (S.phraseNext < ahead) {
      const t = Math.max(S.phraseNext, now + 0.05);
      S.phraseNext = t + this.phrase(t) + rnd(3, 9) * (1 - this.tension * 0.4);
    }
  }

  padChord(t) {
    const S = this.ex, T = this.tension;
    const ch = (S.chord = PROG[S.ci++ % PROG.length]);
    const dur = rnd(8, 11);
    const sour = T > 0.35 && Math.random() < T; // 緊張時第二個音換成小二度或三全音，聽起來不對勁
    const notes = sour ? [ch.pad[0], ch.pad[0] + pick([1, 6])] : ch.pad;
    for (const n of notes) this.hold('vc', n, t + rnd(0, 0.5), dur, { vel: 0.2 + T * 0.08 });
    this.hold('cb', ch.root, t, dur, { vel: 0.3, att: 3, rel: 3 });
    return dur - 2.5;
  }

  // 鋼琴片段，回傳長度
  phrase(t) {
    const T = this.tension, r = Math.random();
    const pan = rnd(-0.35, 0.35);
    if (r < 0.45 - T * 0.3 && this.herNear < 0.05) {
      // 很遠的地方，音樂盒放了一兩小節搖籃曲（她在附近時不放，免得聽不出哪個才是她）
      const bar = pick([0, 0, 4, 8, 12]), bars = Math.random() < 0.6 ? 2 : 4;
      const box = this.has('glk') && Math.random() < 0.7;
      const L = LULLABY.length;
      let i = phraseStart(bar), tt = t, beat = LULLABY_BEAT * rnd(1.15, 1.35);
      for (let k = 0; k < 24; k++) {
        const n = LULLABY[i % L];
        if (k > 0 && n.at === 0 && (n.bar - bar + 16) % 16 >= bars) break;
        let m = n.m + (box ? 24 : 12);
        if (Math.random() < 0.06 + T * 0.2) m += pick([-1, 1, -0.4]);
        this.play(box ? 'glk' : 'pno', m, tt, { vel: (box ? 0.42 : 0.34) * (1 - k * 0.02), dest: this.far, rel: 1, pan });
        tt += n.d * beat;
        beat *= 1.01; // 發條鬆了
        i++;
      }
      return tt - t + 2;
    }
    if (r < 0.65) {
      // 高音的一滴，有時候旁邊再滴一個半音
      const m = pick([76, 81, 84, 88]);
      this.play('pno', m, t, { vel: rnd(0.26, 0.34), rel: 1, pan });
      if (Math.random() < 0.5 + T * 0.3) this.play('pno', m + pick([-1, 1]), t + rnd(0.4, 0.9), { vel: 0.2, rel: 1, pan: -pan });
      return 3;
    }
    if (r < 0.85 - T * 0.15) {
      // 現在和弦的慢琶音
      const notes = Math.random() < 0.5 ? this.ex.chord.arp : [...this.ex.chord.arp].reverse();
      const gap = rnd(0.32, 0.55);
      notes.forEach((m, k) => this.play('pno', m, t + k * gap, { vel: 0.27 - k * 0.03, rel: 1.4, pan }));
      return gap * notes.length + 2;
    }
    // 低音區輕輕壓下去的一團不和諧音
    const base = pick([29, 33, 34]);
    for (const n of [base, base + 1, base + 6]) this.play('pno', n, t + rnd(0, 0.03), { vel: 0.3, rel: 2 });
    return 4;
  }

  // ---- 緊張：顫弓隨她的距離浮上來
  tremTick(now, ahead) {
    const target = Math.max(this.chase, Math.min(1, Math.max(0, (this.tension - 0.3) / 0.55)));
    this.tremLv += (target - this.tremLv) * (target > this.tremLv ? 0.08 : 0.02);
    if (this.changed('trem', this.tremLv)) this.trem.gain.setTargetAtTime(this.tremLv * 0.9, now, 0.3);
    if (this.tremLv < 0.02 || this.tremNext >= ahead) return;
    const t = Math.max(this.tremNext, now + 0.05), L = this.tremLv;
    const o = { dest: this.trem, dur: 5.5, att: 1.2, rel: 1.4 };
    // 大提琴：C 與降 D 磨在一起
    let len = this.play('vct', 48, t, { ...o, vel: 0.3, offset: rnd(0.3, 1), pan: -0.3 });
    this.play('vct', 49, t + 0.2, { ...o, vel: 0.24, offset: rnd(0.3, 1), pan: 0.3 });
    if (L > 0.45) {
      // 很高的小提琴
      this.play('vnt', 79, t, { ...o, vel: 0.15 * L, offset: rnd(0.3, 1), pan: 0.4 });
      this.play('vnt', 80, t + 0.3, { ...o, vel: 0.12 * L, offset: rnd(0.3, 1), pan: -0.4 });
    }
    if (this.chase > 0.5) {
      // 被追：再加低音的三全音
      this.play('vct', 43, t, { ...o, vel: 0.3, offset: rnd(0.3, 1) });
      this.play('vct', 54, t, { ...o, vel: 0.22, offset: rnd(0.3, 1) });
    }
    if (!len) len = 5;
    this.tremNext = t + len - 1.4;
  }

  // 追逐鼓點的重拍：低音鋼琴重擊（由音效引擎的追逐排程呼叫）
  chaseHit(t, beat, lv) {
    if (this.mode !== 'explore' || !this.has('pnof')) return;
    if (beat === 0) {
      this.play('pnof', 33, t, { vel: 0.55 * lv, dest: this.hits, rel: 1.5, dur: 3 });
      this.play('pnof', 21, t, { vel: 0.45 * lv, dest: this.hits, rel: 1.5, dur: 3 });
    } else if (beat === 5) {
      this.play('pnof', 34, t, { vel: 0.35 * lv, dest: this.hits, rel: 1, dur: 2 });
    }
  }

  // ---- 結局
  playWin(t0) {
    // 鋼琴版的搖籃曲後半段（「Morgen früh…」），音樂盒在高八度輕輕跟著，最後停在降 E 大調（終於安息）
    const beat = LULLABY_BEAT * 1.1;
    let i = phraseStart(8), t = t0;
    this.hold('vc', 39, t0, 26, { vel: 0.1, att: 4, rel: 6 });
    for (let k = 0; k < 40; k++) {
      const n = LULLABY[i % LULLABY.length];
      if (k > 0 && n.bar === 15 && n.at >= 2) break; // 不唱回頭的弱起拍
      const last = n.bar === 15 && n.at === 0;
      const dur = last ? 6 : n.d * beat + 0.4;
      this.play('pno', n.m + 12, t, { vel: 0.46, rel: 1.5, dur });
      if (this.has('glk') && n.at === 0) this.play('glk', n.m + 24, t, { vel: 0.18, dest: this.box, rel: 1 });
      if (n.at === 0) {
        const ch = lullabyChord(n.ch);
        this.play('pno', ch.bass, t, { vel: 0.22, rel: 2, dur: last ? 6 : 3 * beat + 0.5 });
        if (!last) for (const kk of [1, 2]) for (const m of ch.mid) this.play('pno', m, t + kk * beat, { vel: 0.09, rel: 0.7, dur: beat });
        else for (const [kk, m] of [51, 58, 63, 67, 70].entries()) this.play('pno', m, t + kk * 0.12, { vel: 0.22, rel: 3, dur: 6 });
      }
      if (last) { this.hold('vc', 51, t, 8, { vel: 0.1, att: 1, rel: 5 }); break; }
      t += n.d * beat * (n.bar >= 14 ? 1.15 : 1); // 最後兩小節放慢
      i++;
    }
  }
  playLose(t0) {
    // 低音一團重擊；接著音樂盒從頭放搖籃曲，越走越慢、越來越走音，停在半句沒唱完
    for (const n of [25, 29, 30]) this.play('pnof', n, t0, { vel: 0.45, dest: this.hits, rel: 2.5, dur: 4 });
    this.hold('cb', 34, t0 + 1, 14, { vel: 0.24, att: 3, rel: 5 });
    this.hold('vc', 46, t0 + 2, 12, { vel: 0.08, att: 4, rel: 5 });
    if (!this.has('glk')) return;
    let i = LULLABY_START, t = t0 + 2.2, beat = LULLABY_BEAT * 0.95, pitch = 0;
    for (let k = 0; k < 10; k++) {
      const n = LULLABY[i % LULLABY.length];
      this.play('glk', n.m + 24 + pitch + rnd(-0.08, 0.08), t, { vel: 0.5 - k * 0.025, dest: this.box, rel: 0.8 });
      t += n.d * beat;
      beat *= 1.13;
      pitch -= 0.07;
      i++;
    }
  }

  changed(key, v, eps = 0.01) {
    this.last = this.last || {};
    if (this.last[key] !== undefined && Math.abs(this.last[key] - v) < eps) return false;
    this.last[key] = v;
    return true;
  }
}

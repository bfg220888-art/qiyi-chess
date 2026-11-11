// DOM 介面：HUD、提示、筆記、地圖、結束畫面
import { drawFloorPlan } from './materials.js';
import { CELL } from './config.js';
import { KEY_COLORS } from './level.js';
import { paintPaper } from './paper.js';
import { DOCS, DOC_LINES, DOC_TYPES, docTree } from './docs.js';

const $ = (id) => document.getElementById(id);
// 紙條裡「用血寫的」字：人名、病歷號、房號、警告。每張紙條最後一段（括號附註除外）也整段用血寫
const BLOOD_WORDS = ['不要回頭', '快跑', '0713', '707', '林○蓮', '老陳', '「她」', '被困在裡面了', '千萬別讓她看到你躲進去', '嬰兒於入院當天死亡', '再也沒有出來過', '蓮的寶寶', '我在這裡呀', '為什麼她看不到我？'];
const BLOOD_RE = new RegExp(BLOOD_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
function bloodSpan(text, line) {
  const s = document.createElement('span');
  s.className = line ? 'blood-ink blood-line' : 'blood-ink';
  s.textContent = text;
  return s;
}
// 把紙條內文拆成文字與「血字」（只用 textContent，不碰 innerHTML）
export function noteFragment(body) {
  const frag = document.createDocumentFragment();
  const paras = String(body).split('\n\n');
  let last = -1;
  for (let i = paras.length - 1; i >= 0; i--) if (paras[i].trim() && !/^[（(]/.test(paras[i].trim())) { last = i; break; }
  paras.forEach((p, i) => {
    if (i) frag.appendChild(document.createTextNode('\n\n'));
    if (i === last) {
      // 「背面寫著：」這種引言照一般的字寫，冒號後面才是血字
      const k = p.indexOf('：\n');
      if (k >= 0) frag.appendChild(document.createTextNode(p.slice(0, k + 2)));
      frag.appendChild(bloodSpan(k >= 0 ? p.slice(k + 2) : p, true));
      return;
    }
    let at = 0;
    for (const m of p.matchAll(BLOOD_RE)) {
      if (m.index > at) frag.appendChild(document.createTextNode(p.slice(at, m.index)));
      frag.appendChild(bloodSpan(m[0], false));
      at = m.index + m[0].length;
    }
    if (at < p.length) frag.appendChild(document.createTextNode(p.slice(at)));
  });
  return frag;
}

// 文件的虛擬節點樹（src/docs.js 的 docTree）→ DOM（只用 textContent / createElement，不碰 innerHTML）
export function buildDocNode(n) {
  const el = document.createElement(n.t || 'div');
  if (n.c) el.className = n.c;
  if (n.f) el.classList.add('f-' + n.f);
  if (n.d) for (const [k, v] of Object.entries(n.d)) { if (k === 'w') el.style.setProperty('--w', v); else el.dataset[k] = v; }
  const kid = el.classList.contains('kid');
  let i = 0;
  for (const k of n.k) {
    if (k == null) continue;
    if (typeof k !== 'string') { el.appendChild(buildDocNode(k)); continue; }
    if (!kid) { el.appendChild(document.createTextNode(k)); continue; }
    // 小孩寫的字：每個字大小、角度、高低都不太一樣
    for (const ch of k) {
      if (ch === '\n') { el.appendChild(document.createElement('br')); continue; }
      const s = document.createElement('span');
      s.className = 'kc'; s.textContent = ch; i++;
      s.style.transform = `translateY(${((i * 7) % 5) - 2}px) rotate(${((i * 37) % 17) - 8}deg) scale(${0.9 + ((i * 13) % 5) * 0.06})`;
      el.appendChild(s);
    }
  }
  return el;
}

// 文件顯示在一張 .paper 上：類型決定紙張的 class（寬度、字型、墨水顏色）與 canvas 畫的紙
function fillPaper(paper, titleEl, bodyEl, doc, opts = {}) {
  paper.className = 'paper doc-paper p-' + doc.type;
  titleEl.textContent = doc.title;
  titleEl.hidden = true;
  paper.setAttribute('aria-label', doc.title);
  bodyEl.replaceChildren(buildDocNode(docTree(doc, opts)));
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));

function paintInto(paper, c, spec, body) {
  if (!c) return;
  let ok = false;
  try { ok = paintPaper(paper, c, spec, [...body.querySelectorAll('.blood-ink')]); } catch (e) { /* 畫不出來就只剩 CSS 的紙色 */ }
  paper.classList.toggle('painted', !!ok);
}

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), objective: $('objective'), timecode: $('timecode'), batFill: $('batFill'), film: $('filmCount'), fuse: $('fuseCount'),
      prompt: $('prompt'), hint: $('hint'), subtitle: $('subtitle'), stamina: $('stamina'), crosshair: $('crosshair'),
      hide: $('hideOverlay'), damage: $('damage'), fade: $('fade'), note: $('note'), noteTitle: $('noteTitle'), noteBody: $('noteBody'),
      map: $('mapView'), mapCanvas: $('mapCanvas'), tInteract: $('tInteract'), tInteractLabel: $('tInteractLabel'), touch: $('touch'),
      fps: $('fps'), bottles: $('bottleCount'), bottleStat: $('bottleStat'), tThrow: $('tThrow'), tBreath: $('tBreath'),
      polaroid: $('polaroid'),
      detect: $('detect'), detEye: $('detEye'), detEar: $('detEar'), detText: $('detText'), detArrow: $('detArrow'), alertPulse: $('alertPulse'),
    };
    this.clock = 0;          // 察覺提示用的時鐘（遊戲時間，由 game.updateDetect 設定）
    this.detMsg = null;      // 目前顯示的察覺訊息 { text, kind, pri, until }
    this.detShown = new Map(); // 每一種訊息上一次出現的時間（防洗版）
    this.detLevel = 0;
    // 暫停選單裡的「檔案」按鈕（用程式加在「操作說明」後面）
    const help = $('btnPauseHelp');
    if (help && !$('btnPauseJournal')) {
      const b = document.createElement('button');
      b.id = 'btnPauseJournal'; b.type = 'button'; b.className = 'btn ghost'; b.textContent = '檔案';
      b.addEventListener('click', () => { if (this.game) this.game.openJournal(true); });
      help.after(b);
    }
    this.hintT = 0;
    this.subT = 0;
    this.game = null;
    this.lastPrompt = '';
  }
  bindGame(game) {
    this.game = game;
    this.setFloor(game.floorTitle || '');
  }
  // HUD 右上角的樓層名稱（走樓梯換層時更新）
  setFloor(text) {
    const t = $('floorTag');
    if (t) t.textContent = text;
  }

  show(id) { $(id).hidden = false; }
  hide(id) { $(id).hidden = true; }

  hint(text, dur = 3) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    this.hintT = dur;
  }
  subtitle(text, dur = 4) {
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.add('show');
    this.subT = dur;
  }
  prompt(label, keyLabel = 'E') {
    if (label === this.lastPrompt) return;
    this.lastPrompt = label;
    const touch = this.game && this.game.input.touchMode;
    if (label) {
      this.el.prompt.innerHTML = touch ? '' : `<kbd>${keyLabel}</kbd>${label}`;
      this.el.prompt.classList.toggle('show', !touch);
      this.el.crosshair.classList.add('active');
      this.el.tInteractLabel.textContent = label;
      this.el.tInteract.classList.add('ready');
    } else {
      this.el.prompt.classList.remove('show');
      this.el.crosshair.classList.remove('active');
      this.el.tInteractLabel.textContent = '';
      this.el.tInteract.classList.remove('ready');
    }
  }
  // 按住互動的進度（0 = 隱藏）
  setHold(v) {
    const el = $('holdRing');
    if (!el) return;
    const k = v > 0 ? v.toFixed(2) : '';
    if (k === this.lastHold) return;
    this.lastHold = k;
    el.hidden = !k;
    if (k) el.style.setProperty('--p', k);
  }
  // 倒地：剩下幾秒（倒數條的長度依難度：簡單 40、普通 30、惡夢 25 秒）
  showDowned(on, t = 0) {
    const el = $('downed');
    if (!el) return;
    if (!on) { el.hidden = true; this.lastDown = ''; return; }
    el.hidden = false;
    const sec = Math.max(0, Math.ceil(t));
    const key = String(sec);
    if (key === this.lastDown) return;
    this.lastDown = key;
    const touch = this.game && this.game.input.touchMode;
    $('downText').textContent = `${sec} 秒內要有隊友站到你旁邊${touch ? '按住「互動」' : '按住 E'}扶你起來`;
    const total = (this.game && this.game.diff.downed) || 30;
    $('downBar').style.width = `${Math.min(100, (t / total) * 100).toFixed(1)}%`;
  }
  setHiding(on) {
    this.el.hide.hidden = !on;
    this.el.touch.classList.toggle('hiding', on);
    this.updateHud();
  }
  damage(v) {
    // 每格都會呼叫：數值沒變就不碰 DOM，省下樣式重算
    const k = v.toFixed(3);
    if (k !== this.lastDamage) { this.lastDamage = k; this.el.damage.style.opacity = k; }
  }
  setBar(v) {
    const w = (v * 100).toFixed(1) + '%';
    if (w !== this.lastBar) { this.lastBar = w; this.el.stamina.firstElementChild.style.width = w; }
  }
  fade(v, dur = 1.2) {
    this.el.fade.style.transitionDuration = dur + 's';
    this.el.fade.style.opacity = String(v);
  }

  // ---- 察覺提示（上方中央的眼睛 / 耳朵與短訊息、準心旁的方向箭頭）
  // 短訊息：同一句 8 秒內不重複；「發現你了」顯示中不會被其他訊息蓋掉，其他的新訊息蓋掉舊的
  detectMsg(text, kind = 'ear', dur = 3) {
    const pri = { alert: 3, warn: 2, lost: 2, ear: 1 }[kind] || 1;
    const last = this.detShown.get(text);
    if (last !== undefined && this.clock >= last && this.clock - last < 8) return false;
    const cur = this.detMsg;
    if (cur && cur.until > this.clock && cur.pri >= 3 && cur.pri > pri) return false;
    this.detShown.set(text, this.clock);
    this.detMsg = { text, kind, pri, until: this.clock + dur };
    return true;
  }
  endDetectMsg(kind) { if (this.detMsg && this.detMsg.kind === kind) this.detMsg = null; }
  // 被發現：畫面邊緣紅一下
  alertPulse() {
    const el = this.el.alertPulse;
    if (!el) return;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }
  // d = null 隱藏；{ level 0..1, chase, arrow: { a 弧度（0 = 正前方、順時針為正）, k 透明度 } | null }
  setDetect(d) {
    const E = this.el;
    if (!E.detect) return;
    if (!d) {
      this.detMsg = null;
      this.detLevel = 0;
      if (this.lastDet !== '') { this.lastDet = ''; E.detect.hidden = true; E.detArrow.hidden = true; }
      return;
    }
    // 眼睛睜開得很快、閉上得慢一點（看得出她剛剛差點發現你）
    const k = d.level > this.detLevel ? 0.35 : d.level <= 0 ? 0.15 : 0.08;
    this.detLevel += (d.level - this.detLevel) * k;
    if (d.level <= 0 && this.detLevel < 0.01) this.detLevel = 0;
    const msg = this.detMsg && this.detMsg.until > this.clock ? this.detMsg : null;
    const lvl = this.detLevel;
    // 聽到聲音 / 在附近找你：耳朵；她同時也盯著你（察覺值還高）就兩個都顯示
    const ear = !!msg && msg.kind === 'ear';
    const eye = ear ? lvl > 0.3 || d.chase : lvl > 0.01 || d.chase || !!msg;
    const show = eye || ear || !!msg;
    // 顏色：骨白 → 琥珀 → 紅
    const c = d.chase ? [226, 22, 14] : ear && lvl < 0.5 ? [236, 162, 46] : lvl < 0.5 ? mix([230, 224, 211], [236, 162, 46], lvl / 0.5) : mix([236, 162, 46], [214, 28, 18], (lvl - 0.5) / 0.5);
    const col = `rgb(${c.map((v) => Math.round(v)).join(',')})`;
    const open = d.chase ? 1 : msg && msg.kind === 'lost' && lvl < 0.15 ? 0.15 : 0.12 + lvl * 0.88;
    const key = show ? `${eye ? 1 : 0}${ear ? 1 : 0}|${open.toFixed(2)}|${col}|${msg ? msg.text : ''}|${d.chase ? 1 : 0}` : '';
    if (key !== this.lastDetKey) {
      this.lastDetKey = key;
      E.detect.hidden = !show;
      if (show) {
        E.detect.style.setProperty('--dc', col);
        E.detEye.parentNode.style.display = eye ? '' : 'none';
        E.detEar.style.display = ear ? '' : 'none';
        E.detEye.style.transform = `scaleY(${open.toFixed(2)})`;
        E.detText.textContent = msg ? msg.text : '';
        E.detect.classList.toggle('chase', !!d.chase);
        E.detect.classList.toggle('alert', !!msg && msg.kind === 'alert');
        E.detect.dataset.level = lvl.toFixed(2);
        // 紅光與血絲：察覺值過半才開始出現，追你時全滿
        E.detect.style.setProperty('--dl', (d.chase ? 1 : Math.max(0, (lvl - 0.45) / 0.55)).toFixed(2));
      }
    }
    this.lastDet = 'on';
    const a = d.arrow;
    E.detArrow.hidden = !a;
    if (a) {
      E.detArrow.style.transform = `rotate(${a.a.toFixed(3)}rad)`;
      E.detArrow.style.opacity = (a.k * (0.45 + 0.55 * Math.max(lvl, d.chase ? 1 : 0.35))).toFixed(2);
      E.detArrow.style.setProperty('--dc', col);
    }
  }

  update(dt) {
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.el.hint.classList.remove('show'); }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el.subtitle.classList.remove('show'); }
  }

  updateHud() {
    const g = this.game;
    if (!g) return;
    const P = g.player;
    const bat = Math.max(0, P.battery);
    this.el.batFill.setAttribute('width', String(22 * bat));
    this.el.batFill.parentNode.parentNode.classList.toggle('low', bat < 0.2);
    this.el.film.textContent = String(P.film);
    this.el.bottles.textContent = String(P.bottles);
    this.el.bottleStat.hidden = P.bottles <= 0;
    if (this.el.tThrow) this.el.tThrow.hidden = P.bottles <= 0 || !!P.hiding;
    if (this.el.tBreath) this.el.tBreath.hidden = !P.hiding;
    this.el.fuse.textContent = `${g.fusesInserted}/3${P.fuses ? ` +${P.fuses}` : ''}`;
    // 門禁卡：每一張畫一個小卡片（顏色有變才重畫）
    const keys = P.keys.join();
    if (keys !== this.lastKeys) {
      this.lastKeys = keys;
      const box = $('keyCards');
      box.textContent = '';
      for (const c of P.keys) {
        const k = document.createElement('i');
        k.className = 'key-card';
        k.style.setProperty('--kc', KEY_COLORS[c].css);
        k.title = KEY_COLORS[c].name + '門禁卡';
        box.append(k);
      }
      $('keyStat').hidden = !P.keys.length;
    }
    // 遺物：放回搖籃的數量＋身上帶著的
    const placed = g.relicsPlaced ? g.relicsPlaced.size : 0;
    $('relicCount').textContent = `${placed}/3${P.relics.length ? ` +${P.relics.length}` : ''}`;
    $('relicStat').hidden = !placed && !P.relics.length;
    let obj;
    if (g.phase === 'escape') obj = g.ghost && g.ghost.banished ? '大門開了。走出去吧。' : '大門開了。快逃！';
    else if (P.fuses > 0) obj = `把保險絲插回發電機房的配電箱（已插 ${g.fusesInserted}/3）`;
    else obj = `找到保險絲（已插 ${g.fusesInserted}/3）`;
    if (g.phase !== 'escape' && !g.seenGenerator && g.fusesInserted === 0 && P.fuses === 0) obj += '\n發電機房的位置在大廳的平面圖上';
    if (P.relics.length && g.altarFloor && g.altarFloor.lv.room707) obj += `\n把遺物放回${g.floors.length > 1 ? g.altarFloor.title + '的' : ''}${g.altarFloor.lv.room707.label}的搖籃（${placed}/3）`;
    this.el.objective.textContent = obj;
    this.el.objective.style.whiteSpace = 'pre-line';
  }

  updateTimecode(t) {
    const s = Math.floor(t);
    if (s === this.lastSec) return;
    this.lastSec = s;
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.el.timecode.textContent = `${hh}:${mm}:${ss}`;
  }

  updateBreath(b, holding) {
    this.el.stamina.classList.add('breath');
    this.el.stamina.classList.toggle('show', holding || b < 0.98);
    this.el.stamina.classList.toggle('ex', b < 0.25);
    this.setBar(b);
  }

  updateStamina(st, exhausted) {
    this.el.stamina.classList.remove('breath');
    this.el.stamina.classList.toggle('show', st < 0.98);
    this.el.stamina.classList.toggle('ex', exhausted);
    this.setBar(st);
  }

  // 閃光拍下的照片（像素來自 render target，由下往上排）：加上暖色、暗角、顆粒與日期戳記
  showPhoto(px, W, H, caption) {
    const el = this.el.polaroid;
    if (!el) return;
    const cv = el.firstElementChild, g = cv.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i = src + x * 4, o = dst + x * 4;
        const dx = x / W - 0.5, dy = y / H - 0.5;
        const vig = 1 - Math.min(0.75, (dx * dx + dy * dy) * 1.9);
        const n = (Math.random() - 0.5) * 26;
        d[o] = Math.min(255, px[i] * 1.08 * vig + 10 + n);
        d[o + 1] = Math.min(255, px[i + 1] * 1.0 * vig + 6 + n);
        d[o + 2] = Math.min(255, px[i + 2] * 0.86 * vig + n);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 老相機的橘色日期戳記
    g.font = 'bold 13px monospace';
    g.fillStyle = 'rgba(255,140,40,0.9)';
    g.textAlign = 'right';
    g.fillText("'99 8 13", W - 8, H - 9);
    el.lastElementChild.textContent = caption;
    el.classList.add('show');
    clearTimeout(this.photoTimer);
    this.photoTimer = setTimeout(() => el.classList.remove('show'), 4500);
  }
  hidePhoto() {
    clearTimeout(this.photoTimer);
    if (this.el.polaroid) this.el.polaroid.classList.remove('show');
  }

  // 一份文件（src/docs.js 的 DOCS[i]）。opts.rep：改寫文字；opts.burned：在燒毀的舊院區撿到的（紙的角燒掉了）
  showDoc(i, opts = {}) {
    const E = this.el, doc = DOCS[i];
    if (!doc) return;
    const paper = E.noteTitle.parentNode;
    fillPaper(paper, E.noteTitle, E.noteBody, doc, opts);
    this.openPaper({ key: doc.id, type: doc.type, burned: !!opts.burned });
  }
  showNote(note) {
    const E = this.el;
    E.noteTitle.parentNode.className = 'paper p-relic';
    E.noteTitle.hidden = false;
    E.noteTitle.parentNode.removeAttribute('aria-label');
    E.noteTitle.textContent = note.title;
    E.noteBody.replaceChildren(noteFragment(note.body));
    E.note.hidden = false;
    E.note.scrollTop = 0;
    const paper = E.noteTitle.parentNode;
    paper.scrollTop = 0;
    this.openPaper({ key: note.title, type: 'relic' }, true);
  }
  openPaper(spec, shown = false) {
    const E = this.el, paper = E.noteTitle.parentNode;
    if (!shown) { E.note.hidden = false; E.note.scrollTop = 0; paper.scrollTop = 0; }
    this.noteSpec = spec;
    this.paintNote();
    // 毛筆字型如果剛好還在載入，載好之後字的位置會變：再畫一次（血字底下的滴痕要對準）
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => this.paintNote());
    if (!this.noteResize) {
      this.noteResize = () => { if (!E.note.hidden) this.paintNote(); };
      addEventListener('resize', this.noteResize);
    }
  }
  // 紙張與血跡（src/paper.js）：照紙張目前的大小重畫
  paintNote() {
    const E = this.el, paper = E.noteTitle.parentNode, c = paper.querySelector('canvas.paper-bg');
    if (!c || E.note.hidden) return;
    paintInto(paper, c, this.noteSpec || { key: '', type: 'relic' }, E.noteBody);
  }

  // ---- 檔案（找到的文件，依故事線分組）。data = { run: 這一局的文件 index, found: Set, collected: Set（跨局，文件 id） }
  // 在檔案裡點一份文件，就在同一個畫面裡重讀（不經過遊戲的輸入迴圈，暫停中也能用）
  openJournal(data, onClose) {
    const J = $('journal');
    if (!J) return;
    this.journalClose = onClose || null;
    this.journalData = data;
    const list = $('journalList');
    const runN = data.run.length, foundN = data.run.filter((i) => data.found.has(i)).length;
    $('journalCount').textContent = `這一局 ${foundN}/${runN}・已收集 ${data.collected.size}/${DOCS.length}`;
    list.replaceChildren();
    for (const line of DOC_LINES) {
      const ids = DOCS.map((d, i) => i).filter((i) => DOCS[i].line === line.key);
      const sec = document.createElement('section');
      sec.className = 'j-line';
      const h = document.createElement('h3');
      const got = ids.filter((i) => data.collected.has(DOCS[i].id) || data.found.has(i)).length;
      h.textContent = `${line.name}`;
      const cnt = document.createElement('span'); cnt.className = 'j-n'; cnt.textContent = `${got}/${ids.length}`;
      h.appendChild(cnt);
      sec.appendChild(h);
      for (const i of ids) {
        const d = DOCS[i], inRun = data.run.includes(i), found = data.found.has(i), old = !found && data.collected.has(d.id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'j-item' + (found ? ' found' : old ? ' old' : inRun ? ' missing' : ' absent');
        const t = document.createElement('span'); t.className = 'j-t';
        t.textContent = found || old ? d.title : '？？？';
        const k = document.createElement('span'); k.className = 'j-k';
        k.textContent = found ? DOC_TYPES[d.type].name : old ? '之前找到的' : inRun ? '還在這棟醫院裡' : '這一局沒有';
        b.append(t, k);
        if (found || old) b.addEventListener('click', () => this.journalRead(i)); else b.disabled = true;
        sec.appendChild(b);
      }
      list.appendChild(sec);
    }
    $('journalReader').hidden = true;
    $('journalIndex').hidden = false;
    J.hidden = false;
    if (!this.journalBound) {
      this.journalBound = true;
      $('journalClose').addEventListener('click', () => this.closeJournal());
      $('journalBack').addEventListener('click', () => { $('journalReader').hidden = true; $('journalIndex').hidden = false; });
      J.addEventListener('pointerdown', (e) => { if (e.target === J) this.closeJournal(); });
      addEventListener('resize', () => { if (!J.hidden && !$('journalReader').hidden) this.paintJournal(); });
      // J / Esc / E 關掉檔案（重讀文件時先回到清單）；在捕獲階段攔下來，不讓遊戲或暫停選單也收到這個按鍵
      addEventListener('keydown', (e) => {
        if (J.hidden || e.repeat || !['KeyJ', 'Escape', 'KeyE', 'KeyP', 'Tab'].includes(e.code)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (!$('journalReader').hidden && e.code !== 'KeyJ') { $('journalReader').hidden = true; $('journalIndex').hidden = false; } else this.closeJournal();
      }, true);
    }
  }
  journalRead(i) {
    const doc = DOCS[i], paper = $('journalPaper');
    if (!doc || !paper) return;
    fillPaper(paper, paper.querySelector('h2'), $('journalBody'), doc, (this.journalData && this.journalData.opts && this.journalData.opts(i)) || {});
    this.journalSpec = { key: doc.id, type: doc.type };
    $('journalIndex').hidden = true;
    $('journalReader').hidden = false;
    paper.scrollTop = 0;
    this.paintJournal();
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => this.paintJournal());
  }
  paintJournal() {
    const paper = $('journalPaper');
    if (paper) paintInto(paper, paper.querySelector('canvas.paper-bg'), this.journalSpec, $('journalBody'));
  }
  // silent：遊戲結束時直接關掉，不呼叫關閉後的回呼
  closeJournal(silent = false) {
    const J = $('journal');
    if (!J || J.hidden) return;
    J.hidden = true;
    const f = this.journalClose;
    this.journalClose = null;
    if (f && !silent) f();
  }
  get journalOpen() { const J = $('journal'); return !!J && !J.hidden; }
  closeNote() { this.el.note.hidden = true; }
  get noteOpen() { return !this.el.note.hidden; }

  // 地圖：只畫玩家走過的格子
  drawMap() {
    const g = this.game, lv = g.lv, c = this.el.mapCanvas, ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    // 紙張紋理只畫一次
    if (!this.paperBg || this.paperBg.width !== W || this.paperBg.height !== H) {
      const pc = document.createElement('canvas');
      pc.width = W; pc.height = H;
      const pg = pc.getContext('2d');
      pg.fillStyle = '#d6cdb3';
      pg.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        const x = (i * 97) % W, y = (i * 211) % H;
        const gr = pg.createRadialGradient(x, y, 1, x, y, 60 + (i % 5) * 20);
        gr.addColorStop(0, 'rgba(90,70,40,0.12)'); gr.addColorStop(1, 'rgba(90,70,40,0)');
        pg.fillStyle = gr; pg.fillRect(0, 0, W, H);
      }
      this.paperBg = pc;
    }
    ctx.drawImage(this.paperBg, 0, 0);
    const scale = Math.min((W - 60) / (lv.W * CELL), (H - 90) / (lv.H * CELL));
    const ox = W / 2 - (lv.W * CELL * scale) / 2, oy = 60;
    ctx.fillStyle = '#2b2419';
    ctx.font = '700 26px "Noto Serif TC", serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(g.themeInfo && g.themeInfo.board) || '七樓'}（手繪）`, W / 2, 38);
    // 多層樓：左上角列出每一層（由上往下），目前這一層畫框
    if (g.floors && g.floors.length > 1) {
      const list = g.floors.slice().sort((a, b) => b.ord - a.ord);
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = '700 15px "Noto Sans TC", sans-serif';
      list.forEach((F, k) => {
        const y = 24 + k * 22;
        const cur = F.index === g.floorIdx;
        ctx.fillStyle = cur ? '#7a1a10' : 'rgba(43,36,25,0.55)';
        ctx.fillText(`${cur ? '▶ ' : '　'}${F.title}${F === g.genFloor ? '（發電機）' : ''}${F.index === 0 ? '（大門）' : ''}`, 14, y);
      });
      ctx.restore();
    }
    drawFloorPlan(ctx, lv, {
      x0: ox, y0: oy, scale, explored: g.explored, wallColor: '#241d14', lineWidth: 3, doorColor: '#8a7a5a',
      roomColor: (room) => (room.type === 'generator' ? 'rgba(160,60,40,0.25)' : room.type === 'lobby' ? 'rgba(200,170,90,0.35)' : 'rgba(255,255,255,0.18)'),
      labels: (room) => (room.type === 'generator' ? '發電機' : room.type === 'lobby' ? '大廳' : room.type === 'landing' || room.type === 'stairs' ? null : room.special ? (room.tag || '707') : null),
      labelColor: '#3a2416', labelFont: '700 18px "Noto Sans TC", sans-serif',
    });
    // 上鎖的門：走過旁邊才畫，用門禁卡的顏色（開了之後變成空心）
    for (const d of lv.doors) {
      if (!(d.lock >= 0)) continue;
      const [ax, ay] = d.o === 'h' ? [d.x, d.y - 1] : [d.x - 1, d.y];
      if (!g.explored[d.y * lv.W + d.x] && !(lv.inBounds(ax, ay) && g.explored[ay * lv.W + ax])) continue;
      const cx = ox + (d.cx ?? 0) * scale, cz = oy + (d.cz ?? 0) * scale;
      ctx.save();
      ctx.translate(cx, cz);
      if (d.o === 'v') ctx.rotate(Math.PI / 2);
      ctx.fillStyle = KEY_COLORS[d.lock].css;
      ctx.strokeStyle = '#241d14';
      ctx.lineWidth = 2;
      if (d.unlocked) { ctx.strokeStyle = KEY_COLORS[d.lock].css; ctx.strokeRect(-9, -4, 18, 8); }
      else { ctx.fillRect(-9, -4, 18, 8); ctx.strokeRect(-9, -4, 18, 8); }
      ctx.restore();
    }
    // 已經插上的保險絲 / 撿到的東西不顯示；只標示玩家
    const px = ox + g.player.pos.x * scale, pz = oy + g.player.pos.z * scale;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-g.player.yaw);
    ctx.fillStyle = '#b3160c';
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 大門
    ctx.fillStyle = '#2b2419';
    ctx.font = '700 16px "Noto Sans TC", sans-serif';
    if (lv.gate) ctx.fillText('大門', ox + lv.gate.x * scale, oy + lv.gate.z * scale + 22);
    // 樓梯：走過的地方才畫（長方形 + 箭頭 + 通往的樓層）
    for (const s of lv.stairs || []) {
      const cx = Math.floor(s.x / CELL), cy = Math.floor(s.z / CELL);
      if (!g.explored[cy * lv.W + cx]) continue;
      const to = g.floors && g.floors[s.to];
      ctx.save();
      ctx.translate(ox + s.x * scale, oy + s.z * scale);
      ctx.rotate(-s.rot);
      const w = s.w * scale, d = s.d * scale;
      ctx.strokeStyle = '#2b2419'; ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      ctx.beginPath();
      for (let k = 1; k < 6; k++) { const z = -d / 2 + (d * k) / 6; ctx.moveTo(-w / 2, z); ctx.lineTo(w / 2, z); }
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#7a1a10';
      ctx.font = '700 15px "Noto Sans TC", sans-serif';
      ctx.fillText(`${s.dir === 'up' ? '▲ 上樓' : '▼ 下樓'}${to ? ' ' + to.info.floor : ''}`, ox + s.x * scale, oy + s.z * scale - Math.max(s.w, s.d) * scale * 0.5 - 8);
    }
  }
  toggleMap(on) {
    this.el.map.hidden = !on;
    if (on) this.drawMap();
  }
  get mapOpen() { return !this.el.map.hidden; }

  // 開場打字效果
  typeIntro(lines, done) {
    const box = $('introText');
    box.textContent = '';
    this.show('intro');
    let i = 0, j = 0, cancelled = false;
    const full = lines.join('\n');
    const step = () => {
      if (cancelled) return;
      if (i >= full.length) return;
      box.textContent = full.slice(0, ++i);
      j = setTimeout(step, full[i - 1] === '\n' ? 420 : 55);
    };
    step();
    const finish = () => {
      if (cancelled) return;
      if (i < full.length) { i = full.length; box.textContent = full; clearTimeout(j); return; }
      cancelled = true;
      $('intro').removeEventListener('pointerdown', finish);
      removeEventListener('keydown', finish);
      this.hide('intro');
      done();
    };
    setTimeout(() => {
      $('intro').addEventListener('pointerdown', finish);
      addEventListener('keydown', finish);
    }, 300);
  }

  showEnd(win, stats, text, title = '') {
    $('endTitle').textContent = title || (win ? '你逃出來了' : '她找到你了');
    $('endTitle').style.color = win ? 'var(--ink)' : 'var(--rec)';
    $('endText').textContent = text;
    const dl = $('endStats');
    dl.innerHTML = '';
    for (const [k, v] of stats) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    this.show('end');
  }

  setFps(on, text) {
    this.el.fps.hidden = !on;
    if (on && text) this.el.fps.textContent = text;
  }
}

export function fmtTime(t) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

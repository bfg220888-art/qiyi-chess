// DOM 介面：HUD、提示、筆記、地圖、結束畫面
import { drawFloorPlan } from './materials.js';
import { CELL } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), objective: $('objective'), timecode: $('timecode'), batFill: $('batFill'), film: $('filmCount'), fuse: $('fuseCount'),
      prompt: $('prompt'), hint: $('hint'), subtitle: $('subtitle'), stamina: $('stamina'), crosshair: $('crosshair'),
      hide: $('hideOverlay'), damage: $('damage'), fade: $('fade'), note: $('note'), noteTitle: $('noteTitle'), noteBody: $('noteBody'),
      map: $('mapView'), mapCanvas: $('mapCanvas'), tInteract: $('tInteract'), tInteractLabel: $('tInteractLabel'), touch: $('touch'),
      fps: $('fps'), bottles: $('bottleCount'), bottleStat: $('bottleStat'), tThrow: $('tThrow'), tBreath: $('tBreath'),
    };
    this.hintT = 0;
    this.subT = 0;
    this.game = null;
    this.lastPrompt = '';
  }
  bindGame(game) { this.game = game; }

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
  setHiding(on) {
    this.el.hide.hidden = !on;
    this.el.touch.classList.toggle('hiding', on);
    this.updateHud();
  }
  damage(v) { this.el.damage.style.opacity = String(v); }
  fade(v, dur = 1.2) {
    this.el.fade.style.transitionDuration = dur + 's';
    this.el.fade.style.opacity = String(v);
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
    let obj;
    if (g.phase === 'escape') obj = '大門開了。快逃！';
    else if (P.fuses > 0) obj = `把保險絲插回發電機房的配電箱（已插 ${g.fusesInserted}/3）`;
    else obj = `找到保險絲（已插 ${g.fusesInserted}/3）`;
    if (g.phase !== 'escape' && !g.seenGenerator && g.fusesInserted === 0 && P.fuses === 0) obj += '\n發電機房的位置在大廳的平面圖上';
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
    this.el.stamina.firstElementChild.style.width = (b * 100).toFixed(1) + '%';
  }

  updateStamina(st, exhausted) {
    this.el.stamina.classList.remove('breath');
    this.el.stamina.classList.toggle('show', st < 0.98);
    this.el.stamina.classList.toggle('ex', exhausted);
    this.el.stamina.firstElementChild.style.width = (st * 100).toFixed(1) + '%';
  }

  showNote(note) {
    this.el.noteTitle.textContent = note.title;
    this.el.noteBody.textContent = note.body;
    this.el.note.hidden = false;
    this.el.note.scrollTop = 0;
  }
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
    ctx.fillText('七樓（手繪）', W / 2, 38);
    drawFloorPlan(ctx, lv, {
      x0: ox, y0: oy, scale, explored: g.explored, wallColor: '#241d14', lineWidth: 3, doorColor: '#8a7a5a',
      roomColor: (room) => (room.type === 'generator' ? 'rgba(160,60,40,0.25)' : room.type === 'lobby' ? 'rgba(200,170,90,0.35)' : 'rgba(255,255,255,0.18)'),
      labels: (room) => (room.type === 'generator' ? '發電機' : room.type === 'lobby' ? '大廳' : room.special ? '707' : null),
      labelColor: '#3a2416', labelFont: '700 18px "Noto Sans TC", sans-serif',
    });
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
    ctx.fillText('大門', ox + lv.gate.x * scale, oy + lv.gate.z * scale + 22);
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

  showEnd(win, stats, text) {
    $('endTitle').textContent = win ? '你逃出來了' : '她找到你了';
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

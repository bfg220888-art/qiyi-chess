// 程序化貼圖：全部用 Canvas 即時繪製（顏色 / 法線 / 粗糙度），不需要任何外部圖檔。
import * as THREE from 'three';
import { RNG } from './rng.js';

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// 可無縫重複的值雜訊（用 canvas 放大做雙線性插值，速度快）
function noiseLayer(w, h, cx, cy, rng) {
  const pw = cx + 3, ph = cy + 3;
  const small = mk(pw, ph);
  const sctx = ctx2d(small);
  const id = sctx.createImageData(pw, ph);
  const base = new Float32Array(cx * cy);
  for (let i = 0; i < base.length; i++) base[i] = rng.next();
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
    const v = base[((j - 1 + cy * 4) % cy) * cx + ((i - 1 + cx * 4) % cx)] * 255;
    const o = (j * pw + i) * 4;
    id.data[o] = id.data[o + 1] = id.data[o + 2] = v;
    id.data[o + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);
  const big = mk(w, h);
  const bctx = ctx2d(big);
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  const sx = w / cx, sy = h / cy;
  bctx.drawImage(small, -sx, -sy, pw * sx, ph * sy);
  const d = bctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

function fbm(w, h, rng, octaves = [[4, 0.5], [8, 0.25], [16, 0.13], [32, 0.07], [64, 0.05]], aspect = 1) {
  const out = new Float32Array(w * h);
  let total = 0;
  for (const [cells, amp] of octaves) {
    const cx = Math.max(1, Math.round(cells * aspect)), cy = Math.max(1, Math.round(cells));
    const l = noiseLayer(w, h, Math.min(cx, w), Math.min(cy, h), rng);
    for (let i = 0; i < out.length; i++) out[i] += l[i] * amp;
    total += amp;
  }
  // 正規化到 0..1
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < out.length; i++) { const v = out[i] / total; out[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = 1 / Math.max(1e-6, mx - mn);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}

function readGray(canvas) {
  const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

function normalFromHeight(hgt, w, h, strength, wrap = true) {
  const c = mk(w, h);
  const g = ctx2d(c);
  const id = g.createImageData(w, h);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
    return hgt[y * w + x];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    // OpenGL 法線：v 軸朝上 = 圖片列往上
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const o = (y * w + x) * 4;
    id.data[o] = (nx * 0.5 + 0.5) * 255;
    id.data[o + 1] = (ny * 0.5 + 0.5) * 255;
    id.data[o + 2] = (nz * 0.5 + 0.5) * 255;
    id.data[o + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

function grayCanvas(vals, w, h) {
  const c = mk(w, h);
  const g = ctx2d(c);
  const id = g.createImageData(w, h);
  for (let i = 0; i < vals.length; i++) {
    const v = clamp01(vals[i]) * 255;
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const css = (r, g, b, a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

// 畫在可環繞的位置（左右各補一次，確保無縫）
function wrapDraw(w, fn) {
  fn(0);
  fn(-w);
  fn(w);
}

export class TextureFactory {
  constructor(renderer, quality, seed = 1234) {
    this.renderer = renderer;
    this.q = quality;
    this.rng = new RNG(seed);
    this.maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    this.cache = new Map();
  }
  tex(canvas, { srgb = false, repeat = true, aniso = true, flipY = true } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso ? Math.min(this.maxAniso, this.q.aniso) : 1;
    t.flipY = flipY;
    t.needsUpdate = true;
    return t;
  }
  set(name, color, hgt, rough, w, h, strength, opts = {}) {
    const out = {
      map: this.tex(color, { srgb: true, ...opts }),
      normalMap: this.tex(normalFromHeight(hgt, w, h, strength, opts.repeat !== false), opts),
      roughnessMap: this.tex(grayCanvas(rough, w, h), opts),
    };
    this.cache.set(name, out);
    return out;
  }
  get(name, fn) {
    if (!this.cache.has(name)) fn.call(this);
    return this.cache.get(name);
  }

  // ---------------------------------------------------------------------
  // 醫院牆：上半部斑駁油漆、下半部磁磚護牆板
  wall() {
    return this.get('wall', () => {
      const S = this.q.tex, rng = this.rng;
      const ppm = S / 3;
      const c = mk(S, S), g = ctx2d(c);
      const hc = mk(S, S), hg = ctx2d(hc);
      const rc = mk(S, S), rg = ctx2d(rc);
      const yRail = S - 1.12 * ppm, yRail2 = S - 1.18 * ppm, ySkirt = S - 0.12 * ppm;
      // 上半部油漆
      g.fillStyle = '#b4b6a5'; g.fillRect(0, 0, S, yRail2);
      hg.fillStyle = '#8c8c8c'; hg.fillRect(0, 0, S, S);
      rg.fillStyle = '#d8d8d8'; rg.fillRect(0, 0, S, S);
      // 磁磚
      const ts = 0.15 * ppm;
      const nTiles = Math.round(S / ts);
      const tsx = S / nTiles;
      const grout = Math.max(2, S / 340);
      g.fillStyle = '#4b5049'; g.fillRect(0, yRail, S, ySkirt - yRail);
      hg.fillStyle = '#404040'; hg.fillRect(0, yRail, S, ySkirt - yRail);
      rg.fillStyle = '#c8c8c8'; rg.fillRect(0, yRail, S, ySkirt - yRail);
      for (let row = 0; ; row++) {
        const y1 = ySkirt - row * ts, y0 = Math.max(yRail, y1 - ts);
        if (y1 <= yRail) break;
        for (let i = 0; i < nTiles; i++) {
          const x0 = i * tsx;
          const missing = rng.chance(0.012);
          const v = rng.range(-0.04, 0.04);
          if (missing) {
            g.fillStyle = '#3d3a33';
            hg.fillStyle = '#202020';
            rg.fillStyle = '#f0f0f0';
          } else {
            g.fillStyle = css(0.62 + v, 0.72 + v, 0.65 + v);
            hg.fillStyle = '#c4c4c4';
            rg.fillStyle = css(0.2 + rng.range(0, 0.1), 0.2, 0.2);
          }
          g.fillRect(x0 + grout / 2, y0 + grout / 2, tsx - grout, (y1 - y0) - grout);
          hg.fillRect(x0 + grout / 2, y0 + grout / 2, tsx - grout, (y1 - y0) - grout);
          rg.fillRect(x0 + grout / 2, y0 + grout / 2, tsx - grout, (y1 - y0) - grout);
          if (!missing && rng.chance(0.05)) {
            // 裂痕
            g.strokeStyle = 'rgba(40,40,35,0.8)'; hg.strokeStyle = '#303030';
            g.lineWidth = hg.lineWidth = Math.max(1, S / 700);
            let px = x0 + rng.range(0, tsx), py = y0;
            g.beginPath(); hg.beginPath(); g.moveTo(px, py); hg.moveTo(px, py);
            while (py < y1) { px += rng.range(-tsx * 0.25, tsx * 0.25); py += rng.range(ts * 0.1, ts * 0.3); g.lineTo(px, py); hg.lineTo(px, py); }
            g.stroke(); hg.stroke();
          }
        }
      }
      // 腰線
      g.fillStyle = '#3f4b42'; g.fillRect(0, yRail2, S, yRail - yRail2);
      hg.fillStyle = '#e0e0e0'; hg.fillRect(0, yRail2, S, yRail - yRail2);
      rg.fillStyle = '#707070'; rg.fillRect(0, yRail2, S, yRail - yRail2);
      // 踢腳板
      g.fillStyle = '#2f2e2a'; g.fillRect(0, ySkirt, S, S - ySkirt);
      hg.fillStyle = '#b0b0b0'; hg.fillRect(0, ySkirt, S, S - ySkirt);
      rg.fillStyle = '#909090'; rg.fillRect(0, ySkirt, S, S - ySkirt);
      // 水漬（從天花板往下流）
      for (let k = 0; k < 9; k++) {
        const x = rng.range(0, S), w = rng.range(S * 0.01, S * 0.06), len = rng.range(0.15, 0.8) * yRail;
        wrapDraw(S, (o) => {
          const gr = g.createLinearGradient(0, 0, 0, len);
          gr.addColorStop(0, 'rgba(88,70,40,0.45)');
          gr.addColorStop(0.7, 'rgba(88,70,40,0.18)');
          gr.addColorStop(1, 'rgba(88,70,40,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.ellipse(x + o, 0, w, len, 0, 0, Math.PI);
          g.fill();
        });
      }
      // 剝落油漆
      const peel = fbm(S, S, rng, [[12, 0.5], [36, 0.3], [108, 0.2]]);
      const peelMask = fbm(S, S, rng, [[3, 0.7], [8, 0.3]]);
      const cd = g.getImageData(0, 0, S, S), hd = hg.getImageData(0, 0, S, S), rd = rg.getImageData(0, 0, S, S);
      const dirt = fbm(S, S, rng, [[3, 0.4], [9, 0.3], [27, 0.2], [81, 0.1]]);
      const fine = fbm(S, S, rng, [[128, 0.6], [256, 0.4]]);
      const mold = fbm(S, S, rng, [[8, 0.5], [24, 0.3], [64, 0.2]]);
      for (let y = 0; y < S; y++) {
        const yy = y / S;
        const upper = y < yRail2;
        for (let x = 0; x < S; x++) {
          const i = y * S + x, o = i * 4;
          let r = cd.data[o] / 255, gg = cd.data[o + 1] / 255, b = cd.data[o + 2] / 255;
          let hh = hd.data[o] / 255, ro = rd.data[o] / 255;
          const dn = dirt[i], fn = fine[i];
          if (upper) {
            // 剝落油漆：只出現在某些區域，邊緣有一圈陰影
            const p = peel[i] * (0.55 + peelMask[i] * 0.6);
            const peelT = 0.74;
            if (p > peelT - 0.025) {
              const e = smooth(peelT, peelT + 0.015, p);
              const rim = 1 - Math.abs(p - peelT) / 0.025;
              r = r * (1 - e) + 0.6 * e; gg = gg * (1 - e) + 0.58 * e; b = b * (1 - e) + 0.52 * e;
              if (rim > 0) { r *= 1 - rim * 0.35; gg *= 1 - rim * 0.35; b *= 1 - rim * 0.35; }
              hh = 0.55 - 0.1 * e + (rim > 0 ? rim * 0.12 : 0);
              ro = 0.95;
            }
            // 天花板附近的黴菌
            const m = mold[i] * (1.0 - yy * 3.2);
            if (m > 0.5) { const e = smooth(0.5, 0.65, m); r *= 1 - 0.45 * e; gg *= 1 - 0.4 * e; b *= 1 - 0.42 * e; ro = Math.max(ro, 0.95); }
            // 越接近腰線越髒
            const grime = smooth(0.35, 0.62, yy) * 0.25;
            r *= 1 - grime; gg *= 1 - grime; b *= 1 - grime * 0.9;
          }
          const k = 0.8 + dn * 0.32 + (fn - 0.5) * 0.08;
          r *= k; gg *= k; b *= k * 0.98;
          hh += (fn - 0.5) * 0.04;
          ro = clamp01(ro + (dn - 0.5) * 0.12);
          cd.data[o] = clamp01(r) * 255; cd.data[o + 1] = clamp01(gg) * 255; cd.data[o + 2] = clamp01(b) * 255;
          hd.data[o] = hd.data[o + 1] = hd.data[o + 2] = clamp01(hh) * 255;
          rd.data[o] = rd.data[o + 1] = rd.data[o + 2] = ro * 255;
        }
      }
      g.putImageData(cd, 0, 0); hg.putImageData(hd, 0, 0); rg.putImageData(rd, 0, 0);
      this.set('wall', c, readGray(hc), readGray(rc), S, S, S / 256 * 2.2);
    });
  }

  // 走廊地板：VCT 方塊地磚，有磨損、刮痕與積水
  floorVinyl() {
    return this.get('floorVinyl', () => {
      const S = this.q.tex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const n = 6, ts = S / n, seam = Math.max(1.5, S / 600);
      const hgt = new Float32Array(S * S).fill(0.6);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const dark = (i + j) % 2 === 1;
        const v = rng.range(-0.025, 0.025);
        g.fillStyle = dark ? css(0.31 + v, 0.35 + v, 0.32 + v) : css(0.55 + v, 0.53 + v, 0.46 + v);
        g.fillRect(i * ts, j * ts, ts, ts);
        // 斑點
        for (let k = 0; k < ts * ts / 140; k++) {
          const s = rng.range(0.5, 2.2) * S / 1024;
          g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,240,0.13)' : 'rgba(0,0,0,0.13)';
          g.fillRect(i * ts + rng.range(0, ts), j * ts + rng.range(0, ts), s, s);
        }
      }
      g.fillStyle = 'rgba(20,20,18,0.85)';
      for (let i = 0; i <= n; i++) {
        g.fillRect(i * ts - seam / 2, 0, seam, S);
        g.fillRect(0, i * ts - seam / 2, S, seam);
      }
      // 鞋跟刮痕
      g.lineCap = 'round';
      for (let k = 0; k < 60; k++) {
        const x = rng.range(0, S), y = rng.range(0, S), l = rng.range(8, 40) * S / 1024, a = rng.range(0, 6.28);
        g.strokeStyle = `rgba(10,10,10,${rng.range(0.15, 0.4)})`;
        g.lineWidth = rng.range(1, 3) * S / 1024;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rng.range(-4, 4), y + Math.sin(a) * l * 0.5 + rng.range(-4, 4), x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      const cd = g.getImageData(0, 0, S, S);
      const dirt = fbm(S, S, rng, [[3, 0.35], [8, 0.3], [20, 0.2], [60, 0.15]]);
      const wet = fbm(S, S, rng, [[4, 0.6], [12, 0.3], [40, 0.1]]);
      const fine = fbm(S, S, rng, [[200, 1]]);
      const rough = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const o = i * 4;
        const x = i % S, y = (i / S) | 0;
        const onSeam = Math.min(x % ts, ts - (x % ts), y % ts, ts - (y % ts)) < seam;
        const dn = dirt[i];
        let k = 0.72 + dn * 0.42;
        let ro = 0.42 + (1 - dn) * 0.25 + (fine[i] - 0.5) * 0.1;
        const w = smooth(0.66, 0.72, wet[i]);
        k *= 1 - w * 0.35;
        ro = ro * (1 - w) + 0.04 * w;
        if (onSeam) { ro = 0.9; hgt[i] = 0.25; }
        else hgt[i] = 0.6 + (fine[i] - 0.5) * 0.05;
        cd.data[o] = clamp01(cd.data[o] / 255 * k) * 255;
        cd.data[o + 1] = clamp01(cd.data[o + 1] / 255 * k) * 255;
        cd.data[o + 2] = clamp01(cd.data[o + 2] / 255 * k * 0.97) * 255;
        rough[i] = ro;
      }
      g.putImageData(cd, 0, 0);
      this.set('floorVinyl', c, hgt, rough, S, S, S / 256 * 1.6);
    });
  }

  // 房間地板：小方磁磚
  floorTile() {
    return this.get('floorTile', () => {
      const S = this.q.tex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const n = 15, ts = S / n, gw = Math.max(2, S / 330);
      g.fillStyle = '#4a4740'; g.fillRect(0, 0, S, S);
      const hc = mk(S, S), hg = ctx2d(hc);
      hg.fillStyle = '#202020'; hg.fillRect(0, 0, S, S);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const v = rng.range(-0.035, 0.03);
        g.fillStyle = css(0.74 + v, 0.73 + v, 0.69 + v);
        g.fillRect(i * ts + gw / 2, j * ts + gw / 2, ts - gw, ts - gw);
        hg.fillStyle = '#c8c8c8';
        hg.fillRect(i * ts + gw / 2, j * ts + gw / 2, ts - gw, ts - gw);
      }
      // 鏽斑與污漬圈
      for (let k = 0; k < 7; k++) {
        const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(20, 110) * S / 1024;
        wrapDraw(S, (o) => {
          const gr = g.createRadialGradient(x + o, y, r * 0.2, x + o, y, r);
          gr.addColorStop(0, 'rgba(95,70,40,0.0)');
          gr.addColorStop(0.75, 'rgba(95,70,40,0.25)');
          gr.addColorStop(0.85, 'rgba(70,50,30,0.35)');
          gr.addColorStop(1, 'rgba(95,70,40,0)');
          g.fillStyle = gr;
          g.beginPath(); g.arc(x + o, y, r, 0, 6.29); g.fill();
        });
      }
      const cd = g.getImageData(0, 0, S, S);
      const hgt = readGray(hc);
      const dirt = fbm(S, S, rng, [[3, 0.35], [9, 0.3], [27, 0.2], [80, 0.15]]);
      const wet = fbm(S, S, rng, [[5, 0.6], [15, 0.4]]);
      const rough = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const o = i * 4;
        const isGrout = hgt[i] < 0.5;
        const dn = dirt[i];
        let k = 0.66 + dn * 0.45;
        const w = smooth(0.68, 0.74, wet[i]);
        k *= 1 - w * 0.25;
        rough[i] = isGrout ? 0.92 : (0.16 + (1 - dn) * 0.35) * (1 - w) + 0.04 * w;
        cd.data[o] = clamp01(cd.data[o] / 255 * k) * 255;
        cd.data[o + 1] = clamp01(cd.data[o + 1] / 255 * k) * 255;
        cd.data[o + 2] = clamp01(cd.data[o + 2] / 255 * k * 0.96) * 255;
      }
      g.putImageData(cd, 0, 0);
      this.set('floorTile', c, hgt, rough, S, S, S / 256 * 1.4);
    });
  }

  // 天花板：礦纖板 + T 型鋁架，水漬與缺板
  ceiling() {
    return this.get('ceiling', () => {
      const S = this.q.tex / 2, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const n = 5, ts = S / n, bar = Math.max(2, S / 120);
      const hc = mk(S, S), hg = ctx2d(hc);
      g.fillStyle = '#8e8d87'; g.fillRect(0, 0, S, S);
      hg.fillStyle = '#e0e0e0'; hg.fillRect(0, 0, S, S);
      const missing = rng.int(0, 2);
      const miss = new Set();
      for (let k = 0; k < missing; k++) miss.add(rng.int(0, n * n - 1));
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i * ts + bar / 2, y = j * ts + bar / 2, s = ts - bar;
        if (miss.has(j * n + i)) {
          g.fillStyle = '#070707'; g.fillRect(x, y, s, s);
          hg.fillStyle = '#000'; hg.fillRect(x, y, s, s);
          continue;
        }
        const v = rng.range(-0.04, 0.02);
        g.fillStyle = css(0.71 + v, 0.7 + v, 0.65 + v);
        g.fillRect(x, y, s, s);
        hg.fillStyle = '#909090'; hg.fillRect(x, y, s, s);
        for (let k = 0; k < s * s / 50; k++) {
          g.fillStyle = `rgba(40,38,32,${rng.range(0.15, 0.4)})`;
          g.fillRect(x + rng.range(0, s), y + rng.range(0, s), 1.2, 1.2);
        }
        if (rng.chance(0.18)) {
          const cx = x + rng.range(0.2, 0.8) * s, cy = y + rng.range(0.2, 0.8) * s;
          for (let r = rng.range(0.2, 0.45) * s; r > 4; r *= 0.72) {
            g.strokeStyle = `rgba(110,80,40,${rng.range(0.2, 0.4)})`;
            g.lineWidth = rng.range(1, 3);
            g.beginPath(); g.arc(cx, cy, r, 0, 6.29); g.stroke();
            g.fillStyle = 'rgba(120,95,55,0.10)'; g.fill();
          }
        }
      }
      const cd = g.getImageData(0, 0, S, S);
      const hgt = readGray(hc);
      const dirt = fbm(S, S, rng, [[3, 0.5], [9, 0.3], [27, 0.2]]);
      const rough = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const o = i * 4, k = 0.75 + dirt[i] * 0.35;
        const isBar = hgt[i] > 0.85;
        rough[i] = isBar ? 0.45 : 0.95;
        cd.data[o] = clamp01(cd.data[o] / 255 * k) * 255;
        cd.data[o + 1] = clamp01(cd.data[o + 1] / 255 * k) * 255;
        cd.data[o + 2] = clamp01(cd.data[o + 2] / 255 * k) * 255;
      }
      g.putImageData(cd, 0, 0);
      this.set('ceiling', c, hgt, rough, S, S, S / 256 * 2.0);
    });
  }

  // 病房門：掉漆鐵門、踢腳板、鐵絲網玻璃窗
  door() {
    return this.get('door', () => {
      const W = this.q.propTex, H = W * 2, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      const hc = mk(W, H), hg = ctx2d(hc);
      const rc = mk(W, H), rg = ctx2d(rc);
      const ppm = W / 1.2;
      g.fillStyle = '#5f7a80'; g.fillRect(0, 0, W, H);
      hg.fillStyle = '#909090'; hg.fillRect(0, 0, W, H);
      rg.fillStyle = '#8c8c8c'; rg.fillRect(0, 0, W, H);
      // 門框邊條
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = W / 80;
      g.strokeRect(W * 0.06, H * 0.035, W * 0.88, H * 0.93);
      hg.strokeStyle = '#b0b0b0'; hg.lineWidth = W / 80; hg.strokeRect(W * 0.06, H * 0.035, W * 0.88, H * 0.93);
      // 窗戶
      const wx = W * 0.34, wy = H * 0.14, ww = W * 0.32, wh = H * 0.24;
      g.fillStyle = '#2c3133'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
      hg.fillStyle = '#e0e0e0'; hg.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
      const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      gr.addColorStop(0, '#0d1316'); gr.addColorStop(0.45, '#1b2428'); gr.addColorStop(0.5, '#0a0e10'); gr.addColorStop(1, '#050708');
      g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
      hg.fillStyle = '#7a7a7a'; hg.fillRect(wx, wy, ww, wh);
      rg.fillStyle = '#0c0c0c'; rg.fillRect(wx, wy, ww, wh);
      g.strokeStyle = 'rgba(160,170,170,0.18)'; g.lineWidth = 1;
      for (let k = -wh; k < ww + wh; k += W / 40) {
        g.beginPath(); g.moveTo(wx + k, wy); g.lineTo(wx + k + wh, wy + wh); g.stroke();
        g.beginPath(); g.moveTo(wx + k + wh, wy); g.lineTo(wx + k, wy + wh); g.stroke();
      }
      // 踢腳板（金屬）
      const ky = H - 0.25 * ppm;
      g.fillStyle = '#7d8080'; g.fillRect(W * 0.04, ky, W * 0.92, H - ky - H * 0.01);
      rg.fillStyle = '#5a5a5a'; rg.fillRect(W * 0.04, ky, W * 0.92, H - ky - H * 0.01);
      hg.fillStyle = '#c0c0c0'; hg.fillRect(W * 0.04, ky, W * 0.92, H - ky - H * 0.01);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(30,30,30,${rng.range(0.1, 0.4)})`;
        g.lineWidth = 1;
        const x = rng.range(W * 0.05, W * 0.95), y = rng.range(ky, H);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-20, 20), y + rng.range(-3, 3)); g.stroke();
      }
      // 推板周圍的手垢
      const hx = W * 0.85, hy = H * 0.5;
      const sg = g.createRadialGradient(hx, hy, 2, hx, hy, W * 0.22);
      sg.addColorStop(0, 'rgba(25,20,15,0.45)'); sg.addColorStop(1, 'rgba(25,20,15,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
      const cd = g.getImageData(0, 0, W, H), hd = hg.getImageData(0, 0, W, H), rd = rg.getImageData(0, 0, W, H);
      const chips = fbm(W, H, rng, [[6, 0.5], [18, 0.3], [54, 0.2]], 0.5);
      const dirt = fbm(W, H, rng, [[3, 0.5], [10, 0.3], [40, 0.2]], 0.5);
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const y = (i / W) | 0;
        const inWin = (i % W) > wx - 6 && (i % W) < wx + ww + 6 && y > wy - 6 && y < wy + wh + 6;
        let r = cd.data[o] / 255, gg = cd.data[o + 1] / 255, b = cd.data[o + 2] / 255;
        let hh = hd.data[o] / 255, ro = rd.data[o] / 255;
        if (!inWin && y < ky) {
          const ch = chips[i];
          if (ch > 0.72) {
            const rust = ch > 0.8;
            r = rust ? 0.36 : 0.52; gg = rust ? 0.22 : 0.5; b = rust ? 0.14 : 0.45;
            hh -= 0.15; ro = 0.95;
          }
        }
        const k = 0.75 + dirt[i] * 0.35 - smooth(0.8, 1, y / H) * 0.25;
        cd.data[o] = clamp01(r * k) * 255; cd.data[o + 1] = clamp01(gg * k) * 255; cd.data[o + 2] = clamp01(b * k) * 255;
        hd.data[o] = hd.data[o + 1] = hd.data[o + 2] = clamp01(hh) * 255;
        rd.data[o] = rd.data[o + 1] = rd.data[o + 2] = clamp01(ro) * 255;
      }
      g.putImageData(cd, 0, 0); hg.putImageData(hd, 0, 0); rg.putImageData(rd, 0, 0);
      this.set('door', c, readGray(hc), readGray(rc), W, H, W / 256 * 2.0, { repeat: false });
    });
  }

  // 置物櫃門：通風百葉
  lockerDoor() {
    return this.get('lockerDoor', () => {
      const W = this.q.propTex / 2, H = W * 4, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      const hc = mk(W, H), hg = ctx2d(hc);
      g.fillStyle = '#56615a'; g.fillRect(0, 0, W, H);
      hg.fillStyle = '#909090'; hg.fillRect(0, 0, W, H);
      const vent = (y0) => {
        for (let k = 0; k < 6; k++) {
          const y = y0 + k * H * 0.022;
          g.fillStyle = '#0a0b0a'; g.fillRect(W * 0.2, y, W * 0.6, H * 0.009);
          g.fillStyle = 'rgba(200,210,200,0.25)'; g.fillRect(W * 0.2, y + H * 0.009, W * 0.6, H * 0.003);
          hg.fillStyle = '#202020'; hg.fillRect(W * 0.2, y, W * 0.6, H * 0.009);
          hg.fillStyle = '#e0e0e0'; hg.fillRect(W * 0.2, y + H * 0.009, W * 0.6, H * 0.004);
        }
      };
      vent(H * 0.05); vent(H * 0.82);
      // 名牌
      g.fillStyle = '#c9c5b3'; g.fillRect(W * 0.3, H * 0.25, W * 0.4, H * 0.03);
      g.fillStyle = '#222'; g.font = `bold ${Math.round(H * 0.022)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(rng.int(1, 48)).padStart(2, '0'), W * 0.5, H * 0.266);
      // 把手凹槽
      g.fillStyle = '#1b1d1b'; g.fillRect(W * 0.78, H * 0.45, W * 0.1, H * 0.08);
      hg.fillStyle = '#303030'; hg.fillRect(W * 0.78, H * 0.45, W * 0.1, H * 0.08);
      const cd = g.getImageData(0, 0, W, H);
      const scratch = fbm(W, H, rng, [[8, 0.5], [32, 0.5]], 0.25);
      const dirt = fbm(W, H, rng, [[3, 0.6], [12, 0.4]], 0.25);
      const rough = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const rust = scratch[i] > 0.78;
        const k = 0.72 + dirt[i] * 0.4;
        if (rust) { cd.data[o] = 95; cd.data[o + 1] = 60; cd.data[o + 2] = 38; }
        cd.data[o] *= k; cd.data[o + 1] *= k; cd.data[o + 2] *= k;
        rough[i] = rust ? 0.95 : 0.45 + (1 - dirt[i]) * 0.3;
      }
      g.putImageData(cd, 0, 0);
      this.set('lockerDoor', c, readGray(hc), rough, W, H, W / 128 * 1.8, { repeat: false });
    });
  }

  // 一般塗漆金屬（櫃子、發電機……用材質顏色染色）
  paintedMetal() {
    return this.get('paintedMetal', () => {
      const S = this.q.propTex, rng = this.rng;
      const chips = fbm(S, S, rng, [[6, 0.5], [18, 0.3], [60, 0.2]]);
      const dirt = fbm(S, S, rng, [[3, 0.5], [10, 0.3], [40, 0.2]]);
      const fine = fbm(S, S, rng, [[160, 1]]);
      const c = mk(S, S), g = ctx2d(c);
      const id = g.createImageData(S, S);
      const hgt = new Float32Array(S * S), rough = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const o = i * 4;
        const chip = chips[i] > 0.76;
        const rust = chips[i] > 0.83;
        let v = 0.82 + dirt[i] * 0.25 + (fine[i] - 0.5) * 0.05;
        let r = v, gg = v, b = v;
        if (chip) { r = 0.55; gg = 0.52; b = 0.48; }
        if (rust) { r = 0.42; gg = 0.24; b = 0.14; }
        id.data[o] = clamp01(r) * 255; id.data[o + 1] = clamp01(gg) * 255; id.data[o + 2] = clamp01(b) * 255; id.data[o + 3] = 255;
        hgt[i] = chip ? 0.4 : 0.6 + (fine[i] - 0.5) * 0.04;
        rough[i] = rust ? 0.95 : chip ? 0.7 : 0.38 + (1 - dirt[i]) * 0.35;
      }
      // 刮痕
      g.putImageData(id, 0, 0);
      g.lineCap = 'round';
      for (let k = 0; k < 50; k++) {
        const x = rng.range(0, S), y = rng.range(0, S), a = rng.range(0, 6.28), l = rng.range(10, 80) * S / 1024;
        g.strokeStyle = `rgba(230,230,220,${rng.range(0.08, 0.25)})`;
        g.lineWidth = rng.range(0.6, 1.5);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      this.set('paintedMetal', c, hgt, rough, S, S, S / 256 * 1.2);
    });
  }

  // 不鏽鋼 / 鍍鉻（拉絲）
  steel() {
    return this.get('steel', () => {
      const S = this.q.propTex / 2, rng = this.rng;
      const brushed = fbm(S, S, rng, [[2, 0.2], [64, 0.4], [256, 0.4]], 0.06);
      const smudge = fbm(S, S, rng, [[3, 0.5], [9, 0.5]]);
      const c = mk(S, S), g = ctx2d(c);
      const id = g.createImageData(S, S);
      const rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const v = 0.6 + brushed[i] * 0.25 - smudge[i] * 0.15;
        id.data[i * 4] = v * 255; id.data[i * 4 + 1] = v * 255; id.data[i * 4 + 2] = v * 1.03 * 255; id.data[i * 4 + 3] = 255;
        rough[i] = 0.22 + smudge[i] * 0.35 + brushed[i] * 0.1;
        hgt[i] = brushed[i] * 0.1;
      }
      g.putImageData(id, 0, 0);
      this.set('steel', c, hgt, rough, S, S, 1.0);
    });
  }

  // 布料（床單、窗簾）：髒污與血跡
  fabric() {
    return this.get('fabric', () => {
      const S = this.q.propTex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const weave = fbm(S, S, rng, [[256, 1]]);
      const dirt = fbm(S, S, rng, [[3, 0.4], [8, 0.3], [24, 0.3]]);
      const folds = fbm(S, S, rng, [[2, 0.4], [6, 0.6]], 0.3);
      const id = g.createImageData(S, S);
      const rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const x = i % S, y = (i / S) | 0;
        const wv = ((x % 4 < 2) !== (y % 4 < 2) ? 0.03 : -0.03) + (weave[i] - 0.5) * 0.08;
        let v = 0.8 + wv - (1 - dirt[i]) * 0.22 - folds[i] * 0.12;
        let r = v * 0.98, gg = v * 0.96, b = v * 0.9;
        const yellow = smooth(0.7, 0.85, dirt[i]);
        r = r * (1 - yellow * 0.2); gg = gg * (1 - yellow * 0.25); b = b * (1 - yellow * 0.5);
        id.data[i * 4] = clamp01(r) * 255; id.data[i * 4 + 1] = clamp01(gg) * 255; id.data[i * 4 + 2] = clamp01(b) * 255; id.data[i * 4 + 3] = 255;
        rough[i] = 0.92;
        hgt[i] = wv * 3 + folds[i] * 0.5;
      }
      g.putImageData(id, 0, 0);
      // 舊血跡
      for (let k = 0; k < 3; k++) splatter(g, rng, rng.range(0, S), rng.range(0, S), rng.range(S * 0.04, S * 0.12), 'rgba(80,12,10,', 0.55);
      this.set('fabric', c, hgt, rough, S, S, S / 256 * 0.8);
    });
  }

  // 木紋（書桌）
  wood() {
    return this.get('wood', () => {
      const S = this.q.propTex / 2, rng = this.rng;
      const grain = fbm(S, S, rng, [[2, 0.3], [8, 0.4], [32, 0.3]], 0.08);
      const dirt = fbm(S, S, rng, [[3, 0.6], [12, 0.4]]);
      const c = mk(S, S), g = ctx2d(c);
      const id = g.createImageData(S, S);
      const rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const ring = 0.5 + 0.5 * Math.sin(grain[i] * 40);
        const v = 0.75 + ring * 0.2 - (1 - dirt[i]) * 0.2;
        id.data[i * 4] = clamp01(0.47 * v) * 255; id.data[i * 4 + 1] = clamp01(0.33 * v) * 255; id.data[i * 4 + 2] = clamp01(0.21 * v) * 255; id.data[i * 4 + 3] = 255;
        rough[i] = 0.55 + ring * 0.15;
        hgt[i] = ring * 0.2;
      }
      g.putImageData(id, 0, 0);
      this.set('wood', c, hgt, rough, S, S, 1.0);
    });
  }

  // 通用髒污灰階（塑膠、橡膠用顏色染色）
  grime() {
    return this.get('grime', () => {
      const S = this.q.propTex / 2, rng = this.rng;
      const dirt = fbm(S, S, rng, [[3, 0.4], [9, 0.3], [27, 0.2], [81, 0.1]]);
      const c = mk(S, S), g = ctx2d(c);
      const id = g.createImageData(S, S);
      const rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const v = 0.7 + dirt[i] * 0.3;
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v * 255; id.data[i * 4 + 3] = 255;
        rough[i] = 0.5 + (1 - dirt[i]) * 0.4;
        hgt[i] = dirt[i] * 0.1;
      }
      g.putImageData(id, 0, 0);
      this.set('grime', c, hgt, rough, S, S, 1.0);
    });
  }

  // ---------------------------------------------------------------------
  // 透明貼花（血跡、字跡、手印、紙張）——圖集
  bloodAtlas() {
    return this.get('blood', () => {
      const S = this.q.propTex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      g.clearRect(0, 0, S, S);
      const h = S / 2;
      for (let v = 0; v < 4; v++) {
        const ox = (v % 2) * h, oy = Math.floor(v / 2) * h;
        g.save();
        g.beginPath(); g.rect(ox, oy, h, h); g.clip();
        if (v === 3) {
          // 腳印
          for (let k = 0; k < 4; k++) footprint(g, ox + h * 0.5 + (k % 2 ? 1 : -1) * h * 0.1, oy + h * (0.85 - k * 0.22), h * 0.1, rng);
        } else {
          splatter(g, rng, ox + h / 2, oy + h / 2, h * (0.18 + v * 0.05), 'rgba(70,4,4,', 0.92, v === 1);
        }
        g.restore();
      }
      this.cache.set('blood', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  dragAtlas() {
    return this.get('drag', () => {
      const W = this.q.propTex, H = W / 4, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      for (let k = 0; k < 26; k++) {
        const y = H * 0.5 + rng.range(-H * 0.22, H * 0.22);
        g.strokeStyle = `rgba(${rng.int(60, 90)},6,5,${rng.range(0.08, 0.3)})`;
        g.lineWidth = rng.range(2, H * 0.12);
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(W * rng.range(0.02, 0.15), y);
        g.bezierCurveTo(W * 0.35, y + rng.range(-10, 10), W * 0.65, y + rng.range(-10, 10), W * rng.range(0.75, 0.98), y + rng.range(-12, 12));
        g.stroke();
      }
      splatter(g, rng, W * 0.08, H * 0.5, H * 0.35, 'rgba(70,4,4,', 0.9);
      this.cache.set('drag', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  writingAtlas(texts) {
    return this.get('writing', () => {
      const W = 1024, rowH = 256, H = rowH * texts.length, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      texts.forEach((t, i) => {
        const y0 = i * rowH;
        const fs = Math.min(190, (W * 0.9) / Math.max(1, t.length));
        g.font = `900 ${fs}px "Noto Serif TC","Songti TC","PMingLiU",serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        // 粗糙筆觸：疊幾層抖動
        for (let k = 0; k < 6; k++) {
          g.fillStyle = `rgba(${rng.int(70, 110)},5,4,${0.18 + k * 0.06})`;
          g.save();
          g.translate(W / 2 + rng.range(-4, 4), y0 + rowH * 0.42 + rng.range(-4, 4));
          g.rotate(rng.range(-0.04, 0.04));
          g.fillText(t, 0, 0);
          g.restore();
        }
        // 滴流
        const tw = Math.min(W * 0.9, g.measureText(t).width);
        for (let k = 0; k < 10 + t.length * 3; k++) {
          const x = W / 2 + rng.range(-tw / 2, tw / 2), y = y0 + rowH * 0.42 + rng.range(0, fs * 0.3);
          const l = rng.range(10, rowH * 0.5);
          g.strokeStyle = `rgba(80,4,4,${rng.range(0.4, 0.85)})`;
          g.lineWidth = rng.range(2, 6);
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-2, 2), Math.min(y0 + rowH - 6, y + l)); g.stroke();
        }
      });
      this.cache.set('writing', { map: this.tex(c, { srgb: true, repeat: false }), rows: texts.length });
    });
  }

  handAtlas() {
    return this.get('hand', () => {
      const S = this.q.propTex / 2, rng = this.rng;
      const c = mk(S * 2, S), g = ctx2d(c);
      for (let v = 0; v < 2; v++) {
        const cx = S * v + S / 2, cy = S * 0.62;
        g.fillStyle = 'rgba(85,5,5,0.85)';
        g.beginPath(); g.ellipse(cx, cy, S * 0.19, S * 0.22, 0, 0, 6.29); g.fill();
        const fingers = [[-0.17, -0.3, 0.05, 0.16, -0.25], [-0.07, -0.42, 0.05, 0.2, -0.08], [0.04, -0.44, 0.05, 0.21, 0.02], [0.14, -0.38, 0.045, 0.18, 0.15], [0.25, -0.05, 0.05, 0.14, 0.9]];
        for (const [fx, fy, rw, rh, a] of fingers) {
          g.beginPath(); g.ellipse(cx + fx * S, cy + fy * S, rw * S, rh * S, a, 0, 6.29); g.fill();
        }
        // 往下的拖痕
        if (v === 1) {
          for (let k = 0; k < 4; k++) {
            g.strokeStyle = 'rgba(80,5,5,0.5)'; g.lineWidth = S * 0.04; g.lineCap = 'round';
            g.beginPath(); g.moveTo(cx + (k - 1.5) * S * 0.09, cy - S * 0.2); g.lineTo(cx + (k - 1.5) * S * 0.09 + rng.range(-5, 5), S * 0.98); g.stroke();
          }
        }
        g.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.7)})`; g.fillRect(S * v + rng.range(0, S), rng.range(0, S), 2, 2); }
        g.globalCompositeOperation = 'source-over';
      }
      this.cache.set('hand', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  paperAtlas() {
    return this.get('paper', () => {
      const S = this.q.propTex / 2, rng = this.rng;
      const c = mk(S * 2, S * 2), g = ctx2d(c);
      for (let v = 0; v < 4; v++) {
        const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
        const tone = rng.range(0.75, 0.88);
        g.fillStyle = css(tone, tone * 0.97, tone * 0.86);
        const m = S * 0.08;
        g.fillRect(ox + m, oy + m * 0.5, S - 2 * m, S - m);
        g.strokeStyle = 'rgba(60,60,80,0.45)'; g.lineWidth = 1.2;
        for (let y = oy + m * 1.6; y < oy + S - m; y += S * 0.045) {
          const len = rng.range(0.3, 0.8) * (S - 3 * m);
          g.beginPath(); g.moveTo(ox + m * 1.4, y);
          for (let x = 0; x < len; x += 6) g.lineTo(ox + m * 1.4 + x, y + rng.range(-1.5, 1.5));
          g.stroke();
        }
        // 皺摺陰影
        const gr = g.createLinearGradient(ox, oy, ox + S, oy + S);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.18)'); gr.addColorStop(0.52, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.05)');
        g.fillStyle = gr; g.fillRect(ox + m, oy + m * 0.5, S - 2 * m, S - m);
        if (v === 2) splatter(g, rng, ox + S * 0.7, oy + S * 0.7, S * 0.12, 'rgba(80,6,5,', 0.8);
      }
      this.cache.set('paper', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  // 窗外：雨夜
  windowTex() {
    return this.get('window', () => {
      const W = 256, H = 256, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#0d1a2a'); gr.addColorStop(0.6, '#08111b'); gr.addColorStop(1, '#030507');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // 樹影
      g.fillStyle = '#010203';
      for (let k = 0; k < 18; k++) {
        const x = rng.range(-20, W + 20), y = rng.range(H * 0.45, H * 0.9), r = rng.range(20, 60);
        g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
      }
      g.fillRect(0, H * 0.75, W, H * 0.25);
      // 遠方路燈
      const lg = g.createRadialGradient(W * 0.7, H * 0.55, 0, W * 0.7, H * 0.55, 30);
      lg.addColorStop(0, 'rgba(255,190,120,0.55)'); lg.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
      // 雨滴與水痕
      for (let k = 0; k < 220; k++) {
        const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(0.6, 2.2);
        g.fillStyle = `rgba(150,180,210,${rng.range(0.15, 0.4)})`;
        g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
      }
      for (let k = 0; k < 40; k++) {
        const x = rng.range(0, W), y = rng.range(0, H * 0.7);
        g.strokeStyle = `rgba(140,170,200,${rng.range(0.08, 0.2)})`; g.lineWidth = rng.range(0.6, 1.4);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-3, 3), y + rng.range(20, 80)); g.stroke();
      }
      this.cache.set('window', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  exitSign() {
    return this.get('exit', () => {
      const W = 512, H = 192;
      const c = mk(W, H), g = ctx2d(c);
      g.fillStyle = '#0c7a3e'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8fff0';
      g.font = '900 86px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('安全門', 175, 78);
      g.font = '700 46px sans-serif';
      g.fillText('EXIT', 210, 150);
      // 跑步小人
      g.strokeStyle = '#e8fff0'; g.lineWidth = 16; g.lineCap = 'round';
      g.beginPath(); g.arc(95, 40, 16, 0, 6.29); g.fillStyle = '#e8fff0'; g.fill();
      g.beginPath(); g.moveTo(88, 62); g.lineTo(75, 115); g.lineTo(110, 150); g.moveTo(75, 115); g.lineTo(45, 165);
      g.moveTo(85, 75); g.lineTo(120, 95); g.moveTo(85, 75); g.lineTo(55, 92); g.stroke();
      g.fillRect(130, 150, 24, 8);
      this.cache.set('exit', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  signAtlas(labels) {
    return this.get('signs', () => {
      const cols = 2, rowsN = Math.ceil(labels.length / cols);
      const CW = 512, CH = 112;
      const c = mk(CW * cols, CH * Math.max(1, rowsN));
      const g = ctx2d(c);
      const rng = this.rng;
      labels.forEach((t, i) => {
        const x = (i % cols) * CW, y = Math.floor(i / cols) * CH;
        g.fillStyle = '#d7d6cc'; g.fillRect(x + 4, y + 4, CW - 8, CH - 8);
        g.fillStyle = '#1d3f6e'; g.fillRect(x + 4, y + 4, 18, CH - 8);
        g.fillStyle = '#18233a';
        g.font = '700 58px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(t, x + CW / 2 + 8, y + CH / 2 + 2);
        // 污漬
        for (let k = 0; k < 6; k++) {
          const gx = x + rng.range(0, CW), gy = y + rng.range(0, CH);
          const gr = g.createRadialGradient(gx, gy, 1, gx, gy, rng.range(10, 60));
          gr.addColorStop(0, 'rgba(60,45,25,0.35)'); gr.addColorStop(1, 'rgba(60,45,25,0)');
          g.fillStyle = gr; g.fillRect(x, y, CW, CH);
        }
      });
      this.cache.set('signs', { map: this.tex(c, { srgb: true, repeat: false }), cols, rows: Math.max(1, rowsN) });
    });
  }

  // 手電筒投射圖案（中心亮斑 + 外圈 + 鏡片髒污）
  flashlightCookie() {
    return this.get('cookie', () => {
      const S = 256, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const id = g.createImageData(S, S);
      const smudge = fbm(S, S, rng, [[4, 0.6], [12, 0.4]]);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
        const r = Math.hypot(dx, dy);
        let v = 0.18 + 0.82 * (1 - smooth(0.0, 0.5, r));
        v += 0.22 * Math.exp(-((r - 0.42) ** 2) / 0.003);
        v -= 0.1 * Math.exp(-((r - 0.6) ** 2) / 0.004);
        v *= 1 - smooth(0.82, 1.0, r);
        v *= 0.88 + smudge[y * S + x] * 0.12;
        const o = (y * S + x) * 4;
        id.data[o] = clamp01(v) * 255; id.data[o + 1] = clamp01(v * 0.97) * 255; id.data[o + 2] = clamp01(v * 0.9) * 255; id.data[o + 3] = 255;
      }
      g.putImageData(id, 0, 0);
      this.cache.set('cookie', { map: this.tex(c, { srgb: true, repeat: false, aniso: false }) });
    });
  }

  dust() {
    return this.get('dust', () => {
      const S = 64;
      const c = mk(S, S), g = ctx2d(c);
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      this.cache.set('dust', { map: this.tex(c, { repeat: false, aniso: false }) });
    });
  }

  // ---------------------------------------------------------------------
  // 鬼魂
  ghostDress() {
    return this.get('ghostDress', () => {
      const S = this.q.propTex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const folds = fbm(S, S, rng, [[3, 0.3], [12, 0.5], [40, 0.2]], 0.35);
      const dirt = fbm(S, S, rng, [[3, 0.4], [9, 0.3], [27, 0.3]]);
      const id = g.createImageData(S, S);
      const rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const y = ((i / S) | 0) / S;
        let v = 0.78 - folds[i] * 0.22 - (1 - dirt[i]) * 0.15;
        const hem = smooth(0.7, 1.0, y);
        v *= 1 - hem * 0.55;
        id.data[i * 4] = clamp01(v * 0.97) * 255; id.data[i * 4 + 1] = clamp01(v * 0.97) * 255; id.data[i * 4 + 2] = clamp01(v * 0.93) * 255; id.data[i * 4 + 3] = 255;
        rough[i] = 0.9;
        hgt[i] = folds[i];
      }
      g.putImageData(id, 0, 0);
      // 胸前與裙擺的血
      splatter(g, rng, S * 0.25, S * 0.35, S * 0.09, 'rgba(60,4,4,', 0.85, true);
      splatter(g, rng, S * 0.3, S * 0.75, S * 0.12, 'rgba(55,4,4,', 0.75, true);
      splatter(g, rng, S * 0.8, S * 0.6, S * 0.07, 'rgba(60,4,4,', 0.6);
      this.set('ghostDress', c, hgt, rough, S, S, S / 256 * 1.5);
    });
  }

  ghostSkin() {
    return this.get('ghostSkin', () => {
      const S = this.q.propTex / 2, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const blot = fbm(S, S, rng, [[4, 0.5], [12, 0.3], [40, 0.2]]);
      const id = g.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        const v = 0.62 + blot[i] * 0.18;
        const bruise = smooth(0.75, 0.9, blot[i]);
        id.data[i * 4] = clamp01(v * 0.92 - bruise * 0.2) * 255;
        id.data[i * 4 + 1] = clamp01(v * 0.95 - bruise * 0.25) * 255;
        id.data[i * 4 + 2] = clamp01(v * 1.0 - bruise * 0.1) * 255;
        id.data[i * 4 + 3] = 255;
      }
      g.putImageData(id, 0, 0);
      // 青色血管
      for (let k = 0; k < 25; k++) {
        let x = rng.range(0, S), y = rng.range(0, S);
        g.strokeStyle = `rgba(40,50,90,${rng.range(0.15, 0.35)})`; g.lineWidth = rng.range(0.6, 1.6);
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 12; s++) { x += rng.range(-8, 8); y += rng.range(2, 9); g.lineTo(x, y); }
        g.stroke();
      }
      this.cache.set('ghostSkin', { map: this.tex(c, { srgb: true }) });
    });
  }

  ghostHair() {
    return this.get('ghostHair', () => {
      const W = 256, H = 512, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      g.clearRect(0, 0, W, H);
      g.lineCap = 'round';
      for (let k = 0; k < 520; k++) {
        const x = rng.range(-4, W + 4);
        const len = H * rng.range(0.55, 1.0);
        const shade = rng.range(0.0, 0.07);
        g.strokeStyle = css(shade, shade * 0.95, shade * 1.1, rng.range(0.75, 1));
        g.lineWidth = rng.range(1.0, 3.2);
        g.beginPath();
        g.moveTo(x, 0);
        let px = x;
        for (let y = 0; y < len; y += 24) { px += rng.range(-1.6, 1.6); g.lineTo(px, y); }
        g.stroke();
      }
      // 頂端完整覆蓋
      g.fillStyle = '#040404'; g.fillRect(0, 0, W, H * 0.08);
      this.cache.set('ghostHair', { map: this.tex(c, { srgb: true, repeat: true }) });
    });
  }

  ghostFace() {
    return this.get('ghostFace', () => {
      const W = 512, H = 256, rng = this.rng;
      const c = mk(W, H), g = ctx2d(c);
      g.fillStyle = '#9fa6a9'; g.fillRect(0, 0, W, H);
      const cx = W * 0.25, cy = H * 0.52;
      const skin = g.createRadialGradient(cx, cy, 5, cx, cy, W * 0.18);
      skin.addColorStop(0, '#c8cfd1'); skin.addColorStop(1, '#8b9295');
      g.fillStyle = skin; g.fillRect(0, 0, W, H);
      // 凹陷的黑眼窩
      for (const s of [-1, 1]) {
        const ex = cx + s * W * 0.042, ey = cy - H * 0.08;
        const eg = g.createRadialGradient(ex, ey, 1, ex, ey, W * 0.045);
        eg.addColorStop(0, 'rgba(0,0,0,1)'); eg.addColorStop(0.55, 'rgba(10,0,0,0.95)'); eg.addColorStop(0.8, 'rgba(70,10,10,0.5)'); eg.addColorStop(1, 'rgba(60,40,40,0)');
        g.fillStyle = eg; g.beginPath(); g.ellipse(ex, ey, W * 0.045, H * 0.075, 0, 0, 6.29); g.fill();
        // 針尖般的瞳孔反光
        g.fillStyle = 'rgba(255,240,230,0.9)'; g.beginPath(); g.arc(ex + s * 2, ey - 2, 1.6, 0, 6.29); g.fill();
        // 血淚
        g.strokeStyle = 'rgba(40,0,0,0.85)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(ex, ey + H * 0.05); g.lineTo(ex + rng.range(-3, 3), ey + H * 0.3); g.stroke();
      }
      // 張大的嘴
      const mg = g.createRadialGradient(cx, cy + H * 0.2, 2, cx, cy + H * 0.2, W * 0.05);
      mg.addColorStop(0, '#000'); mg.addColorStop(0.7, '#0a0000'); mg.addColorStop(1, 'rgba(40,10,10,0.9)');
      g.fillStyle = mg; g.beginPath(); g.ellipse(cx, cy + H * 0.2, W * 0.032, H * 0.13, 0, 0, 6.29); g.fill();
      // 鼻影
      g.fillStyle = 'rgba(40,45,50,0.4)'; g.beginPath(); g.ellipse(cx, cy + H * 0.03, W * 0.012, H * 0.02, 0, 0, 6.29); g.fill();
      // 血管與污漬
      for (let k = 0; k < 30; k++) {
        let x = cx + rng.range(-W * 0.12, W * 0.12), y = rng.range(0, H);
        g.strokeStyle = `rgba(30,35,70,${rng.range(0.1, 0.3)})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 8; s++) { x += rng.range(-6, 6); y += rng.range(-6, 6); g.lineTo(x, y); }
        g.stroke();
      }
      this.cache.set('ghostFace', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }
}

// ---------------------------------------------------------------------------
function splatter(g, rng, x, y, r, rgbaPrefix, alpha, drips = false) {
  g.fillStyle = rgbaPrefix + alpha + ')';
  // 主體：很多重疊的圓
  for (let k = 0; k < 26; k++) {
    const a = rng.range(0, 6.28), d = rng.range(0, r * 0.6);
    g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rng.range(r * 0.15, r * 0.5), 0, 6.29); g.fill();
  }
  // 噴濺小點
  for (let k = 0; k < 60; k++) {
    const a = rng.range(0, 6.28), d = rng.range(r * 0.6, r * 1.9);
    g.fillStyle = rgbaPrefix + (alpha * rng.range(0.5, 1)) + ')';
    g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rng.range(r * 0.015, r * 0.08), 0, 6.29); g.fill();
  }
  // 放射狀拖尾
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, 6.28), d = rng.range(r * 0.8, r * 1.5);
    g.strokeStyle = rgbaPrefix + alpha * 0.8 + ')';
    g.lineWidth = rng.range(r * 0.03, r * 0.08); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4); g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); g.stroke();
  }
  if (drips) {
    for (let k = 0; k < 7; k++) {
      const dx = x + rng.range(-r * 0.6, r * 0.6);
      g.strokeStyle = rgbaPrefix + alpha + ')'; g.lineWidth = rng.range(r * 0.05, r * 0.1);
      g.beginPath(); g.moveTo(dx, y); g.lineTo(dx + rng.range(-2, 2), y + rng.range(r * 0.8, r * 2.5)); g.stroke();
    }
  }
}

function footprint(g, x, y, s, rng) {
  g.fillStyle = `rgba(70,5,5,${rng.range(0.5, 0.8)})`;
  g.beginPath(); g.ellipse(x, y, s * 0.42, s * 0.75, 0, 0, 6.29); g.fill();
  g.beginPath(); g.ellipse(x, y + s * 1.05, s * 0.35, s * 0.4, 0, 0, 6.29); g.fill();
  for (let t = 0; t < 5; t++) { g.beginPath(); g.arc(x - s * 0.35 + t * s * 0.18, y - s * 0.95 + Math.abs(t - 1) * s * 0.06, s * 0.09, 0, 6.29); g.fill(); }
}

export { fbm, noiseLayer, hex };

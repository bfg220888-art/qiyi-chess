// 貼圖：用 Canvas 即時繪製（顏色 / 法線 / 粗糙度）。
// 有載入照片掃描素材（CC0，見 CREDITS.md）時，牆面、地板、金屬、木頭、布料會以照片為底，
// 再疊上程序生成的水漬、黴菌、髒污；照片載入失敗時整套退回純程序貼圖。
import * as THREE from 'three';
import { RNG } from './rng.js';
import { assetUrl } from './assets.js';

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

// 把照片的法線疊到程序法線上（whiteout 混合）；mask 是每個像素的照片權重
function blendNormals(canvas, pn, mask, scale) {
  const g = ctx2d(canvas);
  const id = g.getImageData(0, 0, canvas.width, canvas.height), d = id.data;
  const n = canvas.width * canvas.height;
  for (let i = 0; i < n; i++) {
    const m = mask ? mask[i] : 1;
    if (m <= 0) continue;
    const o = i * 4;
    const ax = d[o] / 127.5 - 1, ay = d[o + 1] / 127.5 - 1, az = d[o + 2] / 127.5 - 1;
    const bx = (pn[o] / 127.5 - 1) * m * scale, by = (pn[o + 1] / 127.5 - 1) * m * scale;
    const bz = 1 + (pn[o + 2] / 127.5 - 2) * m;
    const x = ax + bx, y = ay + by, z = az * Math.max(0.05, bz);
    const l = Math.hypot(x, y, z) || 1;
    d[o] = (x / l * 0.5 + 0.5) * 255; d[o + 1] = (y / l * 0.5 + 0.5) * 255; d[o + 2] = (z / l * 0.5 + 0.5) * 255;
  }
  g.putImageData(id, 0, 0);
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

// 照片素材：{ 名稱: { c: 顏色, n: 法線, arm: AO/粗糙/金屬 } }
const PHOTO_FILES = {
  paint: ['c', 'n', 'arm'], tiles: ['c', 'arm'], lino: ['c', 'n', 'arm'], metal: ['c', 'n', 'arm'],
  wood: ['c', 'n', 'r'], fabric: ['c'], leak: ['c', 'o', 'n'], smear: ['o'],
};
const photoImg = new Map();
function getPhoto(url) {
  if (!photoImg.has(url)) {
    photoImg.set(url, new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => { photoImg.delete(url); rej(new Error('load ' + url)); };
      img.src = assetUrl(url);
    }));
  }
  return photoImg.get(url);
}
const photoUrls = (base) => Object.entries(PHOTO_FILES).flatMap(([name, kinds]) => kinds.map((k) => [name, k, `${base}${name}_${k}.webp`]));
export function prefetchPhotos(base = 'assets/tex/') {
  for (const [, , url] of photoUrls(base)) getPhoto(url).catch(() => {});
}
// 下載逾時不會取消下載：這一局先用程序貼圖，檔案下載完留給下一局
export async function loadPhotos(base = 'assets/tex/', timeoutMs = 20000) {
  const out = {};
  for (const name of Object.keys(PHOTO_FILES)) out[name] = {};
  const all = Promise.all(photoUrls(base).map(([name, k, url]) => getPhoto(url).then((img) => { out[name][k] = img; })));
  all.catch(() => {});
  let timer;
  await Promise.race([all, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })]).finally(() => clearTimeout(timer));
  // file:// 之類的環境畫布會被污染、讀不到像素：那就不用照片
  const c = mk(4, 4), g = ctx2d(c);
  g.drawImage(out.paint.c, 0, 0, 4, 4);
  g.getImageData(0, 0, 1, 1);
  return out;
}

export class TextureFactory {
  constructor(renderer, quality, seed = 1234, photos = null) {
    this.renderer = renderer;
    this.q = quality;
    this.rng = new RNG(seed);
    this.maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    this.cache = new Map();
    this.photos = photos;
  }
  ph(name) { return this.photos && this.photos[name]; }
  // 照片貼花：直接用圖片當貼圖（不經過畫布）
  photoDecal(name) {
    const P = this.ph(name);
    if (!P) return null;
    return this.get('decal_' + name, () => {
      const t = (img, srgb) => {
        if (!img) return null;
        const x = new THREE.Texture(img);
        x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        x.anisotropy = Math.min(this.maxAniso, this.q.aniso);
        x.needsUpdate = true;
        return x;
      };
      const out = { map: t(P.c, true), alphaMap: t(P.o, false), normalMap: t(P.n, false) };
      for (const k of Object.keys(out)) if (!out[k]) delete out[k];
      this.cache.set('decal_' + name, out);
    });
  }
  // 把照片平鋪進畫布的一個區域；fromBottom 讓磁磚列對齊區域底邊
  tilePhoto(g, img, x, y, w, h, pw, phh = pw, fromBottom = false) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const y0 = fromBottom ? y + h - Math.ceil(h / phh) * phh : y;
    for (let yy = y0; yy < y + h; yy += phh) for (let xx = x; xx < x + w; xx += pw) g.drawImage(img, xx, yy, pw, phh);
    g.restore();
  }
  // 依版面把照片畫好後回傳像素；fill 是沒有照片處的底色。
  // blur > 1 時先縮小再放大，只留下大塊的明暗（例如磁磚照片的髒污，去掉跟程序磁縫對不齊的照片磁縫）
  photoPixels(W, H, layers, fill, blur = 1) {
    const c = mk(W, H), g = ctx2d(c);
    g.fillStyle = fill; g.fillRect(0, 0, W, H);
    for (const L of layers) this.tilePhoto(g, L.img, L.x || 0, L.y || 0, L.w ?? W, L.h ?? H, L.pw ?? W, L.phh ?? L.pw ?? H, L.fromBottom);
    if (blur > 1) {
      // 每次縮一半（各瀏覽器的縮圖品質不一，一次縮很多倍會有雜訊）
      let src = c, w = W, h = H;
      while (w > W / blur * 1.01 && w > 2 && h > 2) {
        const nw = Math.max(1, Math.round(w / 2)), nh = Math.max(1, Math.round(h / 2));
        const sm = mk(nw, nh), sg = ctx2d(sm);
        sg.imageSmoothingEnabled = true;
        sg.drawImage(src, 0, 0, nw, nh);
        src = sm; w = nw; h = nh;
      }
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, W, H);
    }
    return g.getImageData(0, 0, W, H).data;
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
    const nc = normalFromHeight(hgt, w, h, strength, opts.repeat !== false);
    if (opts.photoN) blendNormals(nc, opts.photoN, opts.photoMask, opts.photoNScale ?? 1);
    const out = {
      map: this.tex(color, { srgb: true, ...opts }),
      normalMap: this.tex(nc, opts),
      roughnessMap: this.tex(grayCanvas(rough, w, h), opts),
    };
    this.cache.set(name, out);
    return out;
  }
  get(name, fn) {
    if (!this.cache.has(name)) {
      try {
        fn.call(this);
      } catch (e) {
        // 照片處理出錯（例如畫布被污染）：關掉照片，整個重畫成程序貼圖
        if (!this.photos) throw e;
        console.warn('照片貼圖失敗，改用程序貼圖：', e && e.message);
        this.photos = null;
        this.cache.delete(name);
        fn.call(this);
      }
    }
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
      const P = this.ph('paint') && this.ph('tiles') ? [this.ph('paint'), this.ph('tiles')] : null;
      // 上半部油漆
      g.fillStyle = '#b4b6a5'; g.fillRect(0, 0, S, yRail2);
      hg.fillStyle = '#8c8c8c'; hg.fillRect(0, 0, S, S);
      rg.fillStyle = '#d8d8d8'; rg.fillRect(0, 0, S, S);
      // 照片：上半部剝落油漆（1.5 公尺一個循環）；下半部保留程序畫的亮面磁磚，只疊上照片磁磚的髒污與表面起伏
      let photoArm = null, photoN = null, photoMask = null, tileC = null;
      if (P) {
        const tileLay = (img) => ({ img, x: 0, y: yRail, w: S, h: ySkirt - yRail, pw: S / 2, fromBottom: true });
        this.tilePhoto(g, P[0].c, 0, 0, S, yRail2, S / 2);
        photoArm = this.photoPixels(S, S, [{ img: P[0].arm, x: 0, y: 0, w: S, h: yRail2, pw: S / 2 }], 'rgb(255,200,0)');
        photoN = this.photoPixels(S, S, [{ img: P[0].n, x: 0, y: 0, w: S, h: yRail2, pw: S / 2 }], 'rgb(128,128,255)');
        tileC = this.photoPixels(S, S, [tileLay(P[1].c)], '#737373', 24);
        photoMask = new Float32Array(S * S);
        for (let y = 0; y < S; y++) {
          if (y < yRail2) photoMask.fill(1, y * S, y * S + S);
          else if (y >= yRail && y < ySkirt) photoMask.fill(0.001, y * S, y * S + S);
        }
      }
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
          if (photoMask && photoMask[i] > 0) {
            // 照片區：用照片的粗糙度與 AO，高度保持平整（細節交給照片法線）
            const ao = 0.45 + 0.55 * photoArm[o] / 255;
            if (upper) {
              // 油漆調成偏灰的舊醫院綠，提亮到跟原本的牆差不多
              const l = (r + gg + b) / 3;
              r = (r * 0.65 + l * 0.35) * 1.62 * ao; gg = (gg * 0.65 + l * 0.35) * 1.55 * ao; b = (b * 0.65 + l * 0.35) * 1.5 * ao;
              const m = mold[i] * (1.0 - yy * 3.2);
              if (m > 0.5) { const e = smooth(0.5, 0.65, m); r *= 1 - 0.45 * e; gg *= 1 - 0.4 * e; b *= 1 - 0.42 * e; }
              const grime = smooth(0.35, 0.62, yy) * 0.22;
              r *= 1 - grime; gg *= 1 - grime; b *= 1 - grime * 0.9;
              hh = 0.5;
              ro = clamp01(0.25 + photoArm[o + 1] / 255 * 0.75);
            } else {
              // 磁磚：照片的明暗當髒污，磁縫與亮面保留程序版
              const gf = Math.min(1.2, Math.max(0.6, (tileC[o] + tileC[o + 1] + tileC[o + 2]) / 336));
              r *= gf; gg *= gf; b *= gf;
              ro = clamp01(ro + (1.05 - gf) * 0.5);
            }
          } else if (upper) {
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
      this.set('wall', c, readGray(hc), readGray(rc), S, S, S / 256 * 2.2, { photoN, photoMask });
    });
  }

  // 走廊地板：VCT 方塊地磚，有磨損、刮痕與積水
  floorVinyl() {
    return this.get('floorVinyl', () => {
      const S = this.q.tex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const n = 6, ts = S / n, seam = Math.max(1.5, S / 600);
      const hgt = new Float32Array(S * S).fill(0.6);
      // 照片：舊塑膠地磚（八角形花紋），3 公尺一個循環
      const P = this.ph('lino');
      let arm = null, photoN = null;
      if (P) {
        this.tilePhoto(g, P.c, 0, 0, S, S, S);
        arm = this.photoPixels(S, S, [{ img: P.arm }], '#fff');
        photoN = this.photoPixels(S, S, [{ img: P.n }], '#8080ff');
      }
      for (let j = 0; j < n && !P; j++) for (let i = 0; i < n; i++) {
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
      for (let i = 0; i <= n && !P; i++) {
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
        const onSeam = !P && Math.min(x % ts, ts - (x % ts), y % ts, ts - (y % ts)) < seam;
        const dn = dirt[i];
        let k = 0.72 + dn * 0.42;
        let ro = 0.42 + (1 - dn) * 0.25 + (fine[i] - 0.5) * 0.1;
        if (P) {
          k *= (0.55 + 0.45 * arm[o] / 255) * 1.05;
          ro = 0.2 + arm[o + 1] / 255 * 0.6 + (1 - dn) * 0.12;
          // 顏色退一點飽和
          const l = (cd.data[o] + cd.data[o + 1] + cd.data[o + 2]) / 3;
          cd.data[o] = cd.data[o] * 0.75 + l * 0.25; cd.data[o + 1] = cd.data[o + 1] * 0.75 + l * 0.25; cd.data[o + 2] = cd.data[o + 2] * 0.75 + l * 0.25;
        }
        // 積水：顏色變深、邊緣漸變，粗糙度不要低到像鏡子——環境反射在斜角會把它照成一塊塊刺眼的白斑，遠處還會閃爍
        const w = smooth(0.62, 0.76, wet[i]);
        k *= 1 - w * 0.42;
        ro = ro * (1 - w) + 0.34 * w;
        if (onSeam) { ro = 0.9; hgt[i] = 0.25; }
        else hgt[i] = 0.6 + (fine[i] - 0.5) * 0.05 * (1 - w);
        cd.data[o] = clamp01(cd.data[o] / 255 * k) * 255;
        cd.data[o + 1] = clamp01(cd.data[o + 1] / 255 * k) * 255;
        cd.data[o + 2] = clamp01(cd.data[o + 2] / 255 * k * 0.97) * 255;
        rough[i] = ro;
      }
      g.putImageData(cd, 0, 0);
      this.set('floorVinyl', c, hgt, rough, S, S, S / 256 * 1.6, { photoN });
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
      // 照片：髒磁磚的明暗與表面起伏疊在程序磁磚上（磁縫與亮面保留程序版）
      const P = this.ph('tiles');
      let arm = null, photoN = null, pc = null;
      if (P) {
        pc = this.photoPixels(S, S, [{ img: P.c, pw: S / 2 }], '#737373', 24);
        arm = this.photoPixels(S, S, [{ img: P.arm, pw: S / 2 }], '#fff', 24);
      }
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
        const w = smooth(0.64, 0.78, wet[i]);
        k *= 1 - w * 0.35;
        rough[i] = isGrout ? 0.92 : (0.22 + (1 - dn) * 0.32) * (1 - w) + 0.32 * w;
        if (P) {
          k *= Math.min(1.2, Math.max(0.6, (pc[o] + pc[o + 1] + pc[o + 2]) / 336)) * (0.75 + 0.25 * arm[o] / 255);
          if (!isGrout) rough[i] = Math.max(0.18, clamp01(rough[i] + (arm[o + 1] / 255 - 0.85) * 0.5));
        }
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
      // 照片：生鏽鐵板的明暗與鏽斑疊在門的漆色上
      const P = this.ph('metal');
      const pc = P && this.photoPixels(W, H, [{ img: P.c, pw: W }], '#ccc');
      const arm = P && this.photoPixels(W, H, [{ img: P.arm, pw: W }], '#fff');
      const photoN = P && this.photoPixels(W, H, [{ img: P.n, pw: W }], '#8080ff');
      const photoMask = P && new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const y = (i / W) | 0;
        const inWin = (i % W) > wx - 6 && (i % W) < wx + ww + 6 && y > wy - 6 && y < wy + wh + 6;
        let r = cd.data[o] / 255, gg = cd.data[o + 1] / 255, b = cd.data[o + 2] / 255;
        let hh = hd.data[o] / 255, ro = rd.data[o] / 255;
        if (P && !inWin) {
          photoMask[i] = 1;
          const r0 = pc[o] / 255, g0 = pc[o + 1] / 255, b0 = pc[o + 2] / 255;
          const f = Math.min(1.45, (r0 * 0.3 + g0 * 0.55 + b0 * 0.15) * 1.8) * (0.65 + 0.35 * arm[o] / 255);
          const rusty = y < ky ? smooth(0.06, 0.2, r0 - b0) * 0.8 : 0;
          r = r * f * (1 - rusty) + r0 * 0.75 * rusty; gg = gg * f * (1 - rusty) + g0 * 0.75 * rusty; b = b * f * (1 - rusty) + b0 * 0.75 * rusty;
          ro = clamp01(0.3 + arm[o + 1] / 255 * 0.65);
        } else if (!inWin && y < ky) {
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
      this.set('door', c, readGray(hc), readGray(rc), W, H, W / 256 * 2.0, { repeat: false, photoN, photoMask });
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
      const P = this.ph('metal');
      const pc = P && this.photoPixels(W, H, [{ img: P.c, pw: W }], '#ccc');
      const arm = P && this.photoPixels(W, H, [{ img: P.arm, pw: W }], '#fff');
      const photoN = P && this.photoPixels(W, H, [{ img: P.n, pw: W }], '#8080ff');
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const k = 0.72 + dirt[i] * 0.4;
        if (P) {
          const r0 = pc[o] / 255, g0 = pc[o + 1] / 255, b0 = pc[o + 2] / 255;
          const f = Math.min(1.45, (r0 * 0.3 + g0 * 0.55 + b0 * 0.15) * 1.8) * (0.65 + 0.35 * arm[o] / 255);
          const rusty = smooth(0.06, 0.2, r0 - b0) * 0.7;
          for (let ch = 0; ch < 3; ch++) cd.data[o + ch] = clamp01(cd.data[o + ch] / 255 * f * (1 - rusty) * k + pc[o + ch] / 255 * 0.75 * rusty) * 255;
          rough[i] = clamp01(0.3 + arm[o + 1] / 255 * 0.6);
          continue;
        }
        const rust = scratch[i] > 0.78;
        if (rust) { cd.data[o] = 95; cd.data[o + 1] = 60; cd.data[o + 2] = 38; }
        cd.data[o] *= k; cd.data[o + 1] *= k; cd.data[o + 2] *= k;
        rough[i] = rust ? 0.95 : 0.45 + (1 - dirt[i]) * 0.3;
      }
      g.putImageData(cd, 0, 0);
      this.set('lockerDoor', c, readGray(hc), rough, W, H, W / 128 * 1.8, { repeat: false, photoN, photoNScale: 0.7 });
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
      // 照片：生鏽的塗漆鐵板。漆面轉成灰階（讓材質顏色去染色），鏽保留原色
      const P = this.ph('metal');
      const pc = P && this.photoPixels(S, S, [{ img: P.c }], '#ccc');
      const arm = P && this.photoPixels(S, S, [{ img: P.arm }], '#fff');
      const photoN = P && this.photoPixels(S, S, [{ img: P.n }], '#8080ff');
      for (let i = 0; i < S * S; i++) {
        const o = i * 4;
        if (P) {
          const r0 = pc[o] / 255, g0 = pc[o + 1] / 255, b0 = pc[o + 2] / 255;
          const l = r0 * 0.3 + g0 * 0.55 + b0 * 0.15;
          const rusty = smooth(0.04, 0.16, r0 - b0);
          const ao = 0.6 + 0.4 * arm[o] / 255;
          const v = Math.min(1, l * 1.25) * (0.85 + dirt[i] * 0.2);
          id.data[o] = clamp01((v * (1 - rusty) + r0 * rusty) * ao) * 255;
          id.data[o + 1] = clamp01((v * (1 - rusty) + g0 * rusty) * ao) * 255;
          id.data[o + 2] = clamp01((v * (1 - rusty) + b0 * rusty) * ao) * 255;
          id.data[o + 3] = 255;
          hgt[i] = 0.5;
          rough[i] = clamp01(0.2 + arm[o + 1] / 255 * 0.8);
          continue;
        }
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
      this.set('paintedMetal', c, hgt, rough, S, S, S / 256 * 1.2, { photoN });
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
      // 照片：亞麻布紋，取明暗當織紋
      const P = this.ph('fabric');
      const pc = P && this.photoPixels(S, S, [{ img: P.c, pw: S / 2 }], '#888');
      const weave = fbm(S, S, rng, [[256, 1]]);
      const dirt = fbm(S, S, rng, [[3, 0.4], [8, 0.3], [24, 0.3]]);
      const folds = fbm(S, S, rng, [[2, 0.4], [6, 0.6]], 0.3);
      const id = g.createImageData(S, S);
      const rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const x = i % S, y = (i / S) | 0;
        const wv = pc ? ((pc[i * 4] + pc[i * 4 + 1] + pc[i * 4 + 2]) / 765 - 0.45) * 0.35 : ((x % 4 < 2) !== (y % 4 < 2) ? 0.03 : -0.03) + (weave[i] - 0.5) * 0.08;
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
      const P = this.ph('wood');
      if (P) {
        // 照片：磨損的舊木板
        const c = mk(S, S), g = ctx2d(c);
        this.tilePhoto(g, P.c, 0, 0, S, S, S);
        const cd = g.getImageData(0, 0, S, S);
        const rgh = this.photoPixels(S, S, [{ img: P.r }], '#999');
        const photoN = this.photoPixels(S, S, [{ img: P.n }], '#8080ff');
        const dirt = fbm(S, S, rng, [[3, 0.6], [12, 0.4]]);
        const rough = new Float32Array(S * S), hgt = new Float32Array(S * S).fill(0.5);
        for (let i = 0; i < S * S; i++) {
          const o = i * 4, k = 0.62 + dirt[i] * 0.25;
          // 偏暗、偏冷一點，看起來比較舊
          cd.data[o] *= k * 0.92; cd.data[o + 1] *= k * 0.9; cd.data[o + 2] *= k * 0.92;
          rough[i] = clamp01(rgh[o] / 255 * 0.9 + 0.08);
        }
        g.putImageData(cd, 0, 0);
        this.set('wood', c, hgt, rough, S, S, 1.0, { photoN });
        return;
      }
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
  // 樓層主題的牆面與地板

  // 地下太平間：整面到頂的小方磁磚（上淺下深兩色）、生鏽水痕、發黑的磁縫
  tileWall() {
    return this.get('tileWall', () => {
      const S = this.q.tex, rng = this.rng;
      const ppm = S / 3;
      const c = mk(S, S), g = ctx2d(c);
      const hc = mk(S, S), hg = ctx2d(hc);
      const n = 20, ts = S / n, grout = Math.max(2, S / 300);
      const yBand = S - 1.25 * ppm, ySkirt = S - 0.1 * ppm;
      g.fillStyle = '#3c4440'; g.fillRect(0, 0, S, S);
      hg.fillStyle = '#383838'; hg.fillRect(0, 0, S, S);
      const P = this.ph('tiles');
      const pc = P && this.photoPixels(S, S, [{ img: P.c, pw: S / 2 }], '#737373', 24);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const y0 = j * ts;
        const low = y0 >= yBand - 1;
        const v = rng.range(-0.035, 0.03);
        const missing = rng.chance(0.008);
        if (missing) { g.fillStyle = '#2a2b27'; hg.fillStyle = '#1c1c1c'; }
        else {
          g.fillStyle = low ? css(0.36 + v, 0.5 + v, 0.48 + v) : css(0.74 + v, 0.8 + v, 0.78 + v);
          hg.fillStyle = '#c8c8c8';
        }
        g.fillRect(i * ts + grout / 2, y0 + grout / 2, ts - grout, ts - grout);
        hg.fillRect(i * ts + grout / 2, y0 + grout / 2, ts - grout, ts - grout);
      }
      // 腰帶的一排深色磁磚與踢腳
      g.fillStyle = '#26302d'; g.fillRect(0, yBand - ts * 0.18, S, ts * 0.18);
      g.fillStyle = '#1e2220'; g.fillRect(0, ySkirt, S, S - ySkirt);
      hg.fillStyle = '#b0b0b0'; hg.fillRect(0, ySkirt, S, S - ySkirt);
      // 鏽水從天花板流下來
      for (let k = 0; k < 14; k++) {
        const x = rng.range(0, S), w = rng.range(S * 0.004, S * 0.02), len = rng.range(0.2, 0.9) * S;
        wrapDraw(S, (o) => {
          const gr = g.createLinearGradient(0, 0, 0, len);
          gr.addColorStop(0, 'rgba(110,60,25,0.55)'); gr.addColorStop(0.6, 'rgba(100,55,25,0.25)'); gr.addColorStop(1, 'rgba(100,55,25,0)');
          g.fillStyle = gr;
          g.fillRect(x + o - w / 2, 0, w, len);
        });
      }
      const cd = g.getImageData(0, 0, S, S);
      const hgt = readGray(hc);
      const dirt = fbm(S, S, rng, [[3, 0.35], [9, 0.3], [27, 0.2], [80, 0.15]]);
      const mold = fbm(S, S, rng, [[6, 0.5], [18, 0.3], [54, 0.2]]);
      const rough = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const o = i * 4, y = (i / S) | 0, yy = y / S;
        const isGrout = hgt[i] < 0.5;
        let k = 0.62 + dirt[i] * 0.45;
        // 下半部越接近地板越髒，磁縫發黑
        k *= 1 - smooth(0.6, 1.0, yy) * 0.3;
        if (isGrout) k *= 0.55;
        if (pc) k *= Math.min(1.2, Math.max(0.6, (pc[o] + pc[o + 1] + pc[o + 2]) / 336));
        let r = cd.data[o] / 255 * k, gg = cd.data[o + 1] / 255 * k, b = cd.data[o + 2] / 255 * k;
        const m = mold[i] * (0.6 + yy * 0.6);
        if (m > 0.62) { const e = smooth(0.62, 0.78, m); r *= 1 - 0.5 * e; gg *= 1 - 0.42 * e; b *= 1 - 0.45 * e; }
        cd.data[o] = clamp01(r) * 255; cd.data[o + 1] = clamp01(gg) * 255; cd.data[o + 2] = clamp01(b) * 255;
        rough[i] = isGrout ? 0.95 : 0.14 + (1 - dirt[i]) * 0.35;
      }
      g.putImageData(cd, 0, 0);
      this.set('tileWall', c, hgt, rough, S, S, S / 256 * 1.5);
    });
  }

  // 兒童病房：粉彩條紋壁紙（星星、小鴨、氣球），大片剝落露出灰泥；下半部漆成奶油色的護牆板
  wallpaper() {
    return this.get('wallpaper', () => {
      const S = this.q.tex, rng = this.rng;
      const ppm = S / 3;
      const c = mk(S, S), g = ctx2d(c);
      const yRail = S - 1.0 * ppm, yRail2 = S - 1.08 * ppm, ySkirt = S - 0.12 * ppm;
      // 條紋
      const stripe = S / 16;
      for (let i = 0; i < 16; i++) {
        g.fillStyle = i % 2 ? '#e3b9b9' : '#cde0cf';
        g.fillRect(i * stripe, 0, stripe, yRail2);
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 16; i++) g.fillRect(i * stripe + stripe * 0.46, 0, stripe * 0.08, yRail2);
      // 圖案
      const motif = (x, y, k) => {
        if (k === 0) {
          // 星星
          g.fillStyle = '#e9c66b';
          g.beginPath();
          for (let p = 0; p < 10; p++) { const a = p * Math.PI / 5 - Math.PI / 2, rr = p % 2 ? S * 0.008 : S * 0.019; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
          g.fill();
        } else if (k === 1) {
          // 小鴨
          g.fillStyle = '#efd35a';
          g.beginPath(); g.ellipse(x, y, S * 0.02, S * 0.013, 0, 0, 6.29); g.fill();
          g.beginPath(); g.arc(x + S * 0.015, y - S * 0.014, S * 0.009, 0, 6.29); g.fill();
          g.fillStyle = '#d8743a'; g.fillRect(x + S * 0.022, y - S * 0.016, S * 0.008, S * 0.004);
        } else {
          // 氣球
          g.strokeStyle = 'rgba(90,80,70,0.6)'; g.lineWidth = Math.max(1, S / 900);
          g.beginPath(); g.moveTo(x, y + S * 0.02); g.quadraticCurveTo(x + S * 0.008, y + S * 0.04, x, y + S * 0.06); g.stroke();
          g.fillStyle = ['#8fb3d9', '#e08b8b', '#a8d08d'][rng.int(0, 2)];
          g.beginPath(); g.ellipse(x, y, S * 0.014, S * 0.019, 0, 0, 6.29); g.fill();
        }
      };
      for (let row = 0; row * S * 0.09 < yRail2 - S * 0.04; row++) for (let i = 0; i < 8; i++) {
        motif(i * S / 8 + (row % 2 ? S / 16 : 0) + S / 32, S * 0.05 + row * S * 0.09, (row + i) % 3);
      }
      // 護牆板與腰線（彩色邊條）
      g.fillStyle = '#d9cfb0'; g.fillRect(0, yRail, S, ySkirt - yRail);
      g.fillStyle = 'rgba(120,100,70,0.25)';
      for (let i = 0; i < 12; i++) g.fillRect(i * S / 12, yRail, Math.max(1, S / 500), ySkirt - yRail);
      const band = ['#d98c8c', '#e6c36a', '#8fbf8f', '#87a9d6'];
      for (let i = 0; i < 24; i++) { g.fillStyle = band[i % 4]; g.fillRect(i * S / 24, yRail2, S / 24, yRail - yRail2); }
      g.fillStyle = '#6d5a48'; g.fillRect(0, ySkirt, S, S - ySkirt);
      // 水漬
      for (let k = 0; k < 8; k++) {
        const x = rng.range(0, S), w = rng.range(S * 0.02, S * 0.07), len = rng.range(0.15, 0.7) * yRail;
        wrapDraw(S, (o) => {
          const gr = g.createLinearGradient(0, 0, 0, len);
          gr.addColorStop(0, 'rgba(95,72,40,0.5)'); gr.addColorStop(0.7, 'rgba(95,72,40,0.2)'); gr.addColorStop(1, 'rgba(95,72,40,0)');
          g.fillStyle = gr;
          g.beginPath(); g.ellipse(x + o, 0, w, len, 0, 0, Math.PI); g.fill();
        });
      }
      const cd = g.getImageData(0, 0, S, S);
      const peel = fbm(S, S, rng, [[5, 0.45], [14, 0.3], [40, 0.25]]);
      const peelMask = fbm(S, S, rng, [[2, 0.6], [6, 0.4]]);
      const dirt = fbm(S, S, rng, [[3, 0.4], [9, 0.3], [27, 0.2], [81, 0.1]]);
      const mold = fbm(S, S, rng, [[8, 0.5], [24, 0.3], [64, 0.2]]);
      const hgt = new Float32Array(S * S).fill(0.5), rough = new Float32Array(S * S);
      for (let y = 0; y < S; y++) {
        const yy = y / S, upper = y < yRail2;
        for (let x = 0; x < S; x++) {
          const i = y * S + x, o = i * 4;
          let r = cd.data[o] / 255, gg = cd.data[o + 1] / 255, b = cd.data[o + 2] / 255, ro = 0.85;
          if (upper) {
            // 剝落：露出灰泥，邊緣翹起有一圈亮邊與陰影
            const p = peel[i] * (0.5 + peelMask[i] * 0.7);
            const T = 0.7;
            if (p > T - 0.02) {
              const e = smooth(T, T + 0.012, p), rim = 1 - Math.abs(p - T) / 0.02;
              const pl = 0.55 + dirt[i] * 0.1;
              r = r * (1 - e) + pl * e; gg = gg * (1 - e) + pl * 0.97 * e; b = b * (1 - e) + pl * 0.9 * e;
              if (rim > 0 && p < T) { r = r + rim * 0.12; gg = gg + rim * 0.12; b = b + rim * 0.1; }
              if (rim > 0 && p >= T) { r *= 1 - rim * 0.4; gg *= 1 - rim * 0.4; b *= 1 - rim * 0.4; }
              hgt[i] = 0.5 - e * 0.12 + (rim > 0 && p < T ? rim * 0.15 : 0);
              ro = 0.95;
            }
            const m = mold[i] * (1.0 - yy * 2.6);
            if (m > 0.48) { const e = smooth(0.48, 0.62, m); r *= 1 - 0.5 * e; gg *= 1 - 0.45 * e; b *= 1 - 0.45 * e; }
            // 褪色
            const l = (r + gg + b) / 3;
            r = r * 0.8 + l * 0.2; gg = gg * 0.8 + l * 0.2; b = b * 0.8 + l * 0.2;
          } else {
            ro = 0.6;
            hgt[i] = y < yRail ? 0.7 : 0.5;
          }
          const k = 0.72 + dirt[i] * 0.34 - smooth(0.5, 0.75, yy) * 0.12;
          cd.data[o] = clamp01(r * k) * 255; cd.data[o + 1] = clamp01(gg * k) * 255; cd.data[o + 2] = clamp01(b * k * 0.97) * 255;
          rough[i] = ro;
        }
      }
      g.putImageData(cd, 0, 0);
      this.set('wallpaper', c, hgt, rough, S, S, S / 256 * 2.0);
    });
  }

  // 精神科隔離室：鈕扣軟墊（牆與地板共用），發黃、污漬、抓痕
  padded() {
    return this.get('padded', () => {
      const S = this.q.tex, rng = this.rng;
      const n = 6, cs = S / n;
      const c = mk(S, S), g = ctx2d(c);
      const hgt = new Float32Array(S * S), rough = new Float32Array(S * S);
      const dirt = fbm(S, S, rng, [[3, 0.4], [8, 0.3], [24, 0.2], [72, 0.1]]);
      const stain = fbm(S, S, rng, [[4, 0.6], [12, 0.4]]);
      const fine = fbm(S, S, rng, [[160, 1]]);
      const id = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x, o = i * 4;
        // 菱形格：轉 45 度的方格，每格中間鼓起
        const u = (x + y) / cs, v = (x - y + S) / cs;
        const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
        const d = Math.max(Math.abs(fu), Math.abs(fv));
        const bump = Math.cos(Math.min(1, d * 2) * Math.PI / 2);
        const seam = smooth(0.44, 0.5, d);
        const button = Math.hypot(fu - 0.5 * Math.sign(fu), fv - 0.5 * Math.sign(fv)) < 0.07;
        hgt[i] = bump * 0.8 - seam * 0.2 + (fine[i] - 0.5) * 0.03;
        let l = 0.78 * (0.75 + 0.25 * bump) - seam * 0.18;
        if (button) l *= 0.55;
        let r = l * 0.97, gg = l * 0.93, b = l * 0.8;
        const st = smooth(0.62, 0.8, stain[i]);
        r *= 1 - st * 0.35; gg *= 1 - st * 0.4; b *= 1 - st * 0.55;
        const k = 0.75 + dirt[i] * 0.3;
        id.data[o] = clamp01(r * k) * 255; id.data[o + 1] = clamp01(gg * k) * 255; id.data[o + 2] = clamp01(b * k) * 255; id.data[o + 3] = 255;
        rough[i] = 0.55 + seam * 0.3 + st * 0.1;
      }
      g.putImageData(id, 0, 0);
      // 指甲抓痕與乾掉的血
      for (let k = 0; k < 7; k++) {
        const x = rng.range(0, S), y = rng.range(S * 0.3, S * 0.8);
        for (let f = 0; f < 4; f++) {
          g.strokeStyle = `rgba(${rng.int(60, 100)},40,30,${rng.range(0.3, 0.6)})`;
          g.lineWidth = Math.max(1, S / 600);
          g.beginPath(); g.moveTo(x + f * S * 0.012, y); g.lineTo(x + f * S * 0.012 + rng.range(-8, 8), y + rng.range(S * 0.05, S * 0.15)); g.stroke();
        }
      }
      for (let k = 0; k < 3; k++) splatter(g, rng, rng.range(0, S), rng.range(S * 0.4, S), rng.range(S * 0.02, S * 0.05), 'rgba(80,14,10,', 0.6);
      this.set('padded', c, hgt, rough, S, S, S / 256 * 3.0);
    });
  }

  // 兒童病房地板：粉彩方格塑膠地磚
  kidFloor() {
    return this.get('kidFloor', () => {
      const S = this.q.tex, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const n = 8, ts = S / n, seam = Math.max(1.5, S / 600);
      const cols = [[0.62, 0.72, 0.8], [0.84, 0.8, 0.68], [0.82, 0.66, 0.66], [0.66, 0.78, 0.66]];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const [r, gg, b] = cols[(i + j * 3) % 4], v = rng.range(-0.03, 0.03);
        g.fillStyle = css(r + v, gg + v, b + v);
        g.fillRect(i * ts, j * ts, ts, ts);
        for (let k = 0; k < ts * ts / 160; k++) {
          g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,250,0.14)' : 'rgba(0,0,0,0.1)';
          g.fillRect(i * ts + rng.range(0, ts), j * ts + rng.range(0, ts), 1.5 * S / 1024, 1.5 * S / 1024);
        }
      }
      g.fillStyle = 'rgba(20,20,18,0.7)';
      for (let i = 0; i <= n; i++) { g.fillRect(i * ts - seam / 2, 0, seam, S); g.fillRect(0, i * ts - seam / 2, S, seam); }
      g.lineCap = 'round';
      for (let k = 0; k < 50; k++) {
        const x = rng.range(0, S), y = rng.range(0, S), l = rng.range(8, 40) * S / 1024, a = rng.range(0, 6.28);
        g.strokeStyle = `rgba(10,10,10,${rng.range(0.12, 0.35)})`; g.lineWidth = rng.range(1, 3) * S / 1024;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      const cd = g.getImageData(0, 0, S, S);
      const dirt = fbm(S, S, rng, [[3, 0.35], [8, 0.3], [20, 0.2], [60, 0.15]]);
      const wet = fbm(S, S, rng, [[4, 0.6], [12, 0.3], [40, 0.1]]);
      const hgt = new Float32Array(S * S), rough = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        const o = i * 4, x = i % S, y = (i / S) | 0;
        const onSeam = Math.min(x % ts, ts - (x % ts), y % ts, ts - (y % ts)) < seam;
        let k = 0.66 + dirt[i] * 0.42;
        const w = smooth(0.66, 0.72, wet[i]);
        k *= 1 - w * 0.3;
        cd.data[o] = clamp01(cd.data[o] / 255 * k) * 255; cd.data[o + 1] = clamp01(cd.data[o + 1] / 255 * k) * 255; cd.data[o + 2] = clamp01(cd.data[o + 2] / 255 * k * 0.97) * 255;
        rough[i] = onSeam ? 0.9 : (0.4 + (1 - dirt[i]) * 0.25) * (1 - w) + 0.05 * w;
        hgt[i] = onSeam ? 0.25 : 0.6;
      }
      g.putImageData(cd, 0, 0);
      this.set('kidFloor', c, hgt, rough, S, S, S / 256 * 1.4);
    });
  }

  // 孩子的蠟筆畫（3 × 2 圖集）：長頭髮的白衣女人、牽手、房子、黑色漩渦、病床、「她在找我」
  drawingAtlas() {
    return this.get('drawings', () => {
      const S = Math.min(512, this.q.propTex), rng = this.rng;
      const c = mk(S * 3, S * 2), g = ctx2d(c);
      const crayon = (pts, color, w = 4, passes = 3) => {
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (let p = 0; p < passes; p++) {
          g.strokeStyle = color; g.globalAlpha = 0.45 + rng.range(0, 0.3); g.lineWidth = w * rng.range(0.6, 1.1) * S / 512;
          g.beginPath();
          pts.forEach(([x, y], i) => { const jx = x + rng.range(-2, 2) * S / 512, jy = y + rng.range(-2, 2) * S / 512; if (i) g.lineTo(jx, jy); else g.moveTo(jx, jy); });
          g.stroke();
        }
        g.globalAlpha = 1;
      };
      const scribble = (x0, y0, x1, y1, color, density = 30) => {
        const pts = [];
        for (let k = 0; k < density; k++) pts.push([rng.range(x0, x1), rng.range(y0, y1)]);
        crayon(pts, color, 6, 2);
      };
      const person = (ox, oy, s, dress, hair, longHair, noFace) => {
        g.fillStyle = dress; g.globalAlpha = 0.7;
        g.beginPath(); g.moveTo(ox, oy - s * 0.35); g.lineTo(ox - s * 0.28, oy + s * 0.45); g.lineTo(ox + s * 0.28, oy + s * 0.45); g.closePath(); g.fill();
        g.globalAlpha = 1;
        crayon([[ox, oy - s * 0.35], [ox - s * 0.28, oy + s * 0.45], [ox + s * 0.28, oy + s * 0.45], [ox, oy - s * 0.35]], '#444', 3, 2);
        crayon([[ox - s * 0.1, oy + s * 0.45], [ox - s * 0.12, oy + s * 0.75]], '#333', 4, 2);
        crayon([[ox + s * 0.1, oy + s * 0.45], [ox + s * 0.12, oy + s * 0.75]], '#333', 4, 2);
        g.strokeStyle = '#333'; g.lineWidth = 3 * S / 512; g.beginPath(); g.arc(ox, oy - s * 0.52, s * 0.17, 0, 6.29); g.stroke();
        if (longHair) for (let k = -4; k <= 4; k++) crayon([[ox + k * s * 0.04, oy - s * 0.68], [ox + k * s * 0.07, oy - s * 0.1 + Math.abs(k) * s * 0.02]], hair, 4, 2);
        else scribble(ox - s * 0.15, oy - s * 0.72, ox + s * 0.15, oy - s * 0.6, hair, 12);
        if (!noFace) {
          g.fillStyle = '#222'; g.fillRect(ox - s * 0.07, oy - s * 0.56, s * 0.03, s * 0.03); g.fillRect(ox + s * 0.04, oy - s * 0.56, s * 0.03, s * 0.03);
          crayon([[ox - s * 0.05, oy - s * 0.45], [ox, oy - s * 0.42], [ox + s * 0.05, oy - s * 0.45]], '#a33', 3, 1);
        }
      };
      const text = (t, x, y, size, color) => {
        g.font = `700 ${size}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
        for (let k = 0; k < 2; k++) { g.globalAlpha = 0.6; g.save(); g.translate(x + rng.range(-2, 2), y + rng.range(-2, 2)); g.rotate(rng.range(-0.08, 0.08)); g.fillText(t, 0, 0); g.restore(); }
        g.globalAlpha = 1;
      };
      for (let v = 0; v < 6; v++) {
        const ox = (v % 3) * S, oy = Math.floor(v / 3) * S;
        g.save();
        g.beginPath(); g.rect(ox, oy, S, S); g.clip();
        // 紙張（有點黃、角落捲起）與膠帶
        const tone = rng.range(0.82, 0.92);
        g.fillStyle = css(tone, tone * 0.97, tone * 0.88);
        g.fillRect(ox + S * 0.04, oy + S * 0.06, S * 0.92, S * 0.88);
        g.fillStyle = 'rgba(230,220,170,0.55)';
        g.fillRect(ox + S * 0.4, oy + S * 0.02, S * 0.2, S * 0.08);
        const cx = ox + S / 2, cy = oy + S / 2, s = S * 0.42;
        if (v === 0) {
          // 長頭髮的白衣女人牽著小孩
          person(cx - s * 0.35, cy, s, '#f4f4f0', '#111', true, true);
          person(cx + s * 0.4, cy + s * 0.25, s * 0.55, '#7aa0d8', '#6b4b2a', false, false);
          crayon([[cx - s * 0.1, cy], [cx + s * 0.25, cy + s * 0.2]], '#333', 4, 2);
          text('媽媽', cx, oy + S * 0.15, S * 0.1, '#c33');
        } else if (v === 1) {
          // 房子和太陽
          crayon([[cx - s * 0.5, cy + s * 0.6], [cx - s * 0.5, cy], [cx, cy - s * 0.45], [cx + s * 0.5, cy], [cx + s * 0.5, cy + s * 0.6], [cx - s * 0.5, cy + s * 0.6]], '#a0522d', 5, 3);
          scribble(cx - s * 0.12, cy + s * 0.2, cx + s * 0.12, cy + s * 0.58, '#6b3a1f', 14);
          scribble(ox + S * 0.1, oy + S * 0.1, ox + S * 0.26, oy + S * 0.24, '#e8b51c', 24);
          for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; crayon([[ox + S * 0.18 + Math.cos(a) * S * 0.1, oy + S * 0.17 + Math.sin(a) * S * 0.1], [ox + S * 0.18 + Math.cos(a) * S * 0.15, oy + S * 0.17 + Math.sin(a) * S * 0.15]], '#e8b51c', 4, 1); }
          crayon([[ox + S * 0.08, oy + S * 0.86], [ox + S * 0.92, oy + S * 0.86]], '#3a8a3a', 7, 3);
          text('我想回家', cx, oy + S * 0.93, S * 0.07, '#335');
        } else if (v === 2) {
          // 整張塗黑，中間一個白色的人
          for (let k = 0; k < 6; k++) scribble(ox + S * 0.08, oy + S * 0.1, ox + S * 0.92, oy + S * 0.9, '#111', 60);
          person(cx, cy + s * 0.1, s * 0.8, '#ddd', '#000', true, true);
        } else if (v === 3) {
          // 紅色漩渦
          const pts = [];
          for (let a = 0; a < 26; a += 0.2) pts.push([cx + Math.cos(a) * a * S * 0.016, cy + Math.sin(a) * a * S * 0.016]);
          crayon(pts, '#b01515', 5, 2);
          text('不要哭', cx, oy + S * 0.88, S * 0.08, '#222');
        } else if (v === 4) {
          // 病床上的小孩，床邊站著一個很高的女人
          crayon([[cx - s * 0.7, cy + s * 0.3], [cx + s * 0.2, cy + s * 0.3]], '#555', 6, 3);
          crayon([[cx - s * 0.7, cy + s * 0.3], [cx - s * 0.7, cy + s * 0.7]], '#555', 5, 2);
          crayon([[cx + s * 0.2, cy + s * 0.3], [cx + s * 0.2, cy + s * 0.7]], '#555', 5, 2);
          g.strokeStyle = '#333'; g.lineWidth = 3 * S / 512; g.beginPath(); g.arc(cx - s * 0.5, cy + s * 0.16, s * 0.12, 0, 6.29); g.stroke();
          scribble(cx - s * 0.35, cy + s * 0.12, cx + s * 0.15, cy + s * 0.28, '#7aa0d8', 18);
          person(cx + s * 0.55, cy - s * 0.15, s * 1.25, '#f0f0ec', '#111', true, true);
        } else {
          // 沒有臉的護士和字
          person(cx, cy + s * 0.05, s, '#f4f4f0', '#111', true, true);
          scribble(cx - s * 0.12, cy - s * 0.62, cx + s * 0.12, cy - s * 0.42, '#111', 20);
          text('她在找我', cx, oy + S * 0.14, S * 0.09, '#c22');
        }
        // 舊污漬
        const gr = g.createRadialGradient(ox + rng.range(0, S), oy + rng.range(0, S), 2, ox + S / 2, oy + S / 2, S * 0.7);
        gr.addColorStop(0, 'rgba(110,85,40,0.25)'); gr.addColorStop(1, 'rgba(110,85,40,0)');
        g.fillStyle = gr; g.fillRect(ox + S * 0.04, oy + S * 0.06, S * 0.92, S * 0.88);
        g.restore();
      }
      this.cache.set('drawings', { map: this.tex(c, { srgb: true, repeat: false }) });
    });
  }

  // 地上的排水孔（透明貼花）：圓形鐵蓋、鏽圈
  drainTex() {
    return this.get('drain', () => {
      const S = 256, rng = this.rng;
      const c = mk(S, S), g = ctx2d(c);
      const cx = S / 2, cy = S / 2;
      const halo = g.createRadialGradient(cx, cy, S * 0.2, cx, cy, S * 0.5);
      halo.addColorStop(0, 'rgba(70,40,20,0.75)'); halo.addColorStop(0.6, 'rgba(60,35,18,0.3)'); halo.addColorStop(1, 'rgba(60,35,18,0)');
      g.fillStyle = halo; g.fillRect(0, 0, S, S);
      g.fillStyle = '#4a4744'; g.beginPath(); g.arc(cx, cy, S * 0.26, 0, 6.29); g.fill();
      g.strokeStyle = '#2a2826'; g.lineWidth = S * 0.02; g.beginPath(); g.arc(cx, cy, S * 0.25, 0, 6.29); g.stroke();
      g.fillStyle = '#050505';
      for (let k = -3; k <= 3; k++) g.fillRect(cx + k * S * 0.06 - S * 0.015, cy - Math.sqrt(Math.max(0, (S * 0.21) ** 2 - (k * S * 0.06) ** 2)), S * 0.03, 2 * Math.sqrt(Math.max(0, (S * 0.21) ** 2 - (k * S * 0.06) ** 2)));
      for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(120,60,25,${rng.range(0.2, 0.5)})`; g.fillRect(cx + rng.range(-S * 0.25, S * 0.25), cy + rng.range(-S * 0.25, S * 0.25), rng.range(2, 8), rng.range(2, 8)); }
      this.cache.set('drain', { map: this.tex(c, { srgb: true, repeat: false }) });
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
        // 中心亮斑放寬、壓低（近距離照白牆不會整團過曝），外圈的亮環也柔一點；
        // 邊緣在貼圖範圍內就完全淡出，投射範圍的方形邊界才不會露出來
        let v = 0.2 + 0.62 * (1 - smooth(0.0, 0.62, r));
        v += 0.12 * Math.exp(-((r - 0.44) ** 2) / 0.006);
        v -= 0.06 * Math.exp(-((r - 0.62) ** 2) / 0.006);
        v *= 1 - smooth(0.7, 0.93, r);
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
        // 靠近兩側邊緣的髮絲比較短、比較稀：髮簾的側邊才不會是一條筆直的切邊（遠處看起來像一塊黑板）
        const edge = Math.min(1, Math.min(x, W - x) / (W * 0.16));
        if (edge < 1 && rng.chance(0.35 * (1 - edge))) continue;
        const len = H * rng.range(0.55, 1.0) * (0.45 + 0.55 * Math.max(0, edge));
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
      g.fillStyle = '#040404'; g.fillRect(W * 0.1, 0, W * 0.8, H * 0.08);
      // 兩側的頂端收成斜角，不要露出方形的角
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.1, 0); g.lineTo(W * 0.1, H * 0.08); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(W, 0); g.lineTo(W * 0.9, 0); g.lineTo(W * 0.9, H * 0.08); g.closePath(); g.fill();
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

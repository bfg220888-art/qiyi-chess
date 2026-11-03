// 紙條的紙張：全部用 canvas 程序畫（不用任何圖片）——泛黃的醫院表單、水漬與霉斑、
// 邊緣的噴濺與往下流的血、沾血的手印與指紋，還有「用血寫的字」底下往下滴的痕跡。
// 同一張紙條（同一個標題）每次打開都長得一樣。
import { RNG } from './rng.js';

const hashStr = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const BLOOD = [92, 8, 5];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// 一滴血：圓形、外圈比較深（乾掉時血會往邊緣跑）
function drop(g, x, y, r, a = 0.85) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba([110, 12, 8], a * 0.75));
  gr.addColorStop(0.75, rgba(BLOOD, a));
  gr.addColorStop(1, rgba([60, 3, 2], 0));
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

// 噴濺：一團主要的血跡，周圍一圈大小不一、往外拉長的小血點
function splatter(g, rng, x, y, R, k = 1) {
  g.save();
  g.fillStyle = rgba(BLOOD, 0.8 * k);
  g.beginPath();
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, r = R * (0.55 + rng.next() * 0.45);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath(); g.fill();
  drop(g, x, y, R * 0.9, 0.7 * k);
  for (let i = 0; i < 70; i++) {
    const a = rng.next() * Math.PI * 2, d = R * (0.9 + Math.pow(rng.next(), 1.8) * 3.6);
    const r = Math.max(0.6, R * 0.16 * Math.pow(rng.next(), 1.6) * (1.4 - d / (R * 5)));
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    // 遠一點的血點是被甩出去的：往外拉長
    g.save(); g.translate(px, py); g.rotate(a); g.scale(1 + d / R * 0.35, 1);
    drop(g, 0, 0, r, 0.9 * k);
    g.restore();
  }
  g.restore();
}

// 往下流的血：一條漸細的血痕，末端一顆圓圓的血珠
function drip(g, rng, x, y, len, w, k = 1) {
  g.save();
  const gr = g.createLinearGradient(0, y, 0, y + len);
  gr.addColorStop(0, rgba(BLOOD, 0.85 * k));
  gr.addColorStop(1, rgba([70, 4, 3], 0.95 * k));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x - w, y);
  const wob = rng.range(-1.5, 1.5);
  g.bezierCurveTo(x - w * 0.6, y + len * 0.4, x - w * 0.35 + wob, y + len * 0.8, x - w * 0.3 + wob, y + len);
  g.lineTo(x + w * 0.3 + wob, y + len);
  g.bezierCurveTo(x + w * 0.35 + wob, y + len * 0.8, x + w * 0.6, y + len * 0.4, x + w, y);
  g.closePath(); g.fill();
  drop(g, x + wob, y + len, w * 0.75, 0.95 * k);
  g.restore();
}

// 指腹的紋路：一圈一圈斷斷續續的弧線
function fingerprint(g, rng, x, y, s, rot, k = 1) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.strokeStyle = rgba([80, 6, 4], 0.55 * k);
  g.lineWidth = Math.max(0.8, s * 0.055);
  for (let r = s * 0.12; r < s; r += s * 0.12) {
    let a = rng.range(0, 1);
    while (a < Math.PI * 2) {
      const seg = rng.range(0.6, 1.8);
      g.beginPath(); g.ellipse(0, 0, r * 0.72, r, 0, a, Math.min(Math.PI * 2, a + seg)); g.stroke();
      a += seg + rng.range(0.15, 0.5);
    }
  }
  g.restore();
}

// 沾血的手印：手掌 + 五根漸細的手指，再用很多小洞「蓋」得不均勻（掌紋、沒沾到的地方），像真的壓上去
function finger(g, x0, y0, a, len, w0, w1) {
  const dx = Math.sin(a), dy = -Math.cos(a), nx = -dy, ny = dx;
  const x1 = x0 + dx * len, y1 = y0 + dy * len;
  g.beginPath();
  g.moveTo(x0 + nx * w0, y0 + ny * w0);
  g.lineTo(x1 + nx * w1, y1 + ny * w1);
  g.arc(x1, y1, w1, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
  g.lineTo(x0 - nx * w0, y0 - ny * w0);
  g.closePath(); g.fill();
  return [x1, y1];
}
function handprint(g, rng, x, y, s, rot, k = 1) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.fillStyle = rgba([96, 8, 5], 0.62 * k);
  // 手掌（掌根比較寬、往手指那邊稍微收窄）
  g.beginPath();
  g.moveTo(-0.3 * s, -0.05 * s);
  g.bezierCurveTo(-0.36 * s, 0.22 * s, -0.24 * s, 0.46 * s, 0.0, 0.48 * s);
  g.bezierCurveTo(0.26 * s, 0.48 * s, 0.36 * s, 0.24 * s, 0.32 * s, -0.06 * s);
  g.bezierCurveTo(0.2 * s, -0.16 * s, -0.2 * s, -0.16 * s, -0.3 * s, -0.05 * s);
  g.fill();
  // 手指：[根部 x, y, 角度, 長度, 根部半寬, 指尖半寬]（最後一根是往旁邊張開的大拇指）
  const F = [[-0.24, -0.08, -0.2, 0.42, 0.075, 0.06], [-0.08, -0.13, -0.06, 0.5, 0.08, 0.065], [0.08, -0.13, 0.05, 0.52, 0.08, 0.065], [0.23, -0.08, 0.18, 0.42, 0.07, 0.058], [0.3, 0.2, 1.05, 0.34, 0.1, 0.075]];
  for (const [fx, fy, a, len, w0, w1] of F) {
    g.fillStyle = rgba([96, 8, 5], 0.62 * k);
    const aa = a + rng.range(-0.06, 0.06);
    const [ex, ey] = finger(g, fx * s, fy * s, aa, len * s, w0 * s, w1 * s);
    // 指腹壓得比較重：深一點
    drop(g, ex - Math.sin(aa) * w1 * s * 0.6, ey + Math.cos(aa) * w1 * s * 0.6, w1 * s * 1.25, 0.5 * k);
    // 指節的摺痕
    g.save(); g.globalCompositeOperation = 'destination-out'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = Math.max(1, s * 0.012);
    for (const t of [0.38, 0.68]) {
      const cx = fx * s + Math.sin(aa) * len * s * t, cy = fy * s - Math.cos(aa) * len * s * t;
      g.beginPath(); g.moveTo(cx - Math.cos(aa) * w0 * s * 0.8, cy - Math.sin(aa) * w0 * s * 0.8); g.lineTo(cx + Math.cos(aa) * w0 * s * 0.8, cy + Math.sin(aa) * w0 * s * 0.8); g.stroke();
    }
    g.restore();
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1100; i++) {
    const px = rng.range(-0.6, 0.6) * s, py = rng.range(-0.7, 0.55) * s, r = rng.range(0.3, 1.7) * (s / 120);
    g.fillStyle = `rgba(0,0,0,${rng.range(0.12, 0.6)})`;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }
  // 掌紋
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = Math.max(1, s * 0.016);
  g.beginPath(); g.moveTo(-0.27 * s, 0.02 * s); g.quadraticCurveTo(0.0, 0.08 * s, 0.28 * s, -0.02 * s); g.stroke();
  g.beginPath(); g.moveTo(-0.26 * s, 0.1 * s); g.quadraticCurveTo(-0.02 * s, 0.14 * s, 0.12 * s, 0.3 * s); g.stroke();
  g.beginPath(); g.moveTo(0.2 * s, 0.1 * s); g.quadraticCurveTo(0.06 * s, 0.26 * s, 0.04 * s, 0.44 * s); g.stroke();
  g.restore();
}

// 拖過去的血痕：好幾條平行的細紋，兩端淡掉
function smear(g, rng, x0, y0, x1, y1, w, k = 1) {
  g.save();
  const len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
  g.translate(x0, y0); g.rotate(a);
  for (let i = 0; i < 26; i++) {
    const off = rng.range(-w / 2, w / 2), s0 = rng.range(0, len * 0.25), s1 = rng.range(len * 0.6, len);
    const gr = g.createLinearGradient(s0, 0, s1, 0);
    const al = rng.range(0.08, 0.3) * k;
    gr.addColorStop(0, rgba(BLOOD, 0)); gr.addColorStop(0.15, rgba(BLOOD, al)); gr.addColorStop(1, rgba(BLOOD, 0));
    g.strokeStyle = gr; g.lineWidth = rng.range(1, w * 0.22);
    g.beginPath(); g.moveTo(s0, off); g.lineTo(s1, off + rng.range(-2, 2)); g.stroke();
  }
  g.restore();
}

// 畫整張紙。paper = .paper 元素、canvas = 裡面的 <canvas>；blood = 「用血寫的字」的元素（在它們底下畫滴下來的血）
export function paintPaper(paper, canvas, key, blood = []) {
  // 先把舊的畫布縮成 0，量到的捲動高度才是內容本身的高度
  canvas.style.width = '0px'; canvas.style.height = '0px';
  const W = paper.clientWidth, H = Math.max(paper.scrollHeight, paper.clientHeight);
  if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  let g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rng = new RNG(hashStr(key));
  // ---- 紙：泛黃、邊緣比較深、纖維與霉斑
  g.fillStyle = '#dcd1b4';
  g.fillRect(0, 0, W, H);
  const edge = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  edge.addColorStop(0, 'rgba(120,90,40,0)'); edge.addColorStop(1, 'rgba(105,72,30,0.42)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    // 水漬：淡淡的一片，邊緣比較深、形狀不規則
    const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(40, 110);
    g.save(); g.translate(x, y); g.rotate(rng.range(0, Math.PI)); g.scale(1, rng.range(0.55, 0.9));
    const gr = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r);
    gr.addColorStop(0, 'rgba(140,100,45,0.025)'); gr.addColorStop(0.9, 'rgba(120,80,30,0.065)'); gr.addColorStop(1, 'rgba(120,80,30,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(0.6, 3.2);
    g.fillStyle = `rgba(${rng.int(90, 130)},${rng.int(60, 80)},30,${rng.range(0.15, 0.4)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(80,60,30,0.07)'; g.lineWidth = 0.6;
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), a = rng.range(0, Math.PI), l = rng.range(3, 12);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // 醫院表單：表頭、橫線、左邊的紅色邊線
  g.fillStyle = 'rgba(60,70,110,0.45)';
  g.font = '700 10px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText('聖羅莎紀念醫院　ST. ROSA MEMORIAL HOSPITAL', W - 16, 10);
  g.fillRect(16, 25, W - 32, 1);
  g.fillStyle = 'rgba(60,70,110,0.16)';
  for (let y = 64; y < H - 8; y += 32) g.fillRect(0, y, W, 1);
  g.fillStyle = 'rgba(170,40,40,0.28)';
  g.fillRect(22, 0, 1, H);
  // 摺痕
  g.fillStyle = 'rgba(255,255,240,0.18)'; g.fillRect(0, H * 0.5, W, 1);
  g.fillStyle = 'rgba(70,50,20,0.1)'; g.fillRect(0, H * 0.5 + 1, W, 1);

  // ---- 血：先畫在另一張透明的圖層上（手印的「沒沾到的地方」要挖洞，不能挖到紙），
  // 最後用 multiply 疊到紙上，像被紙吸進去
  const paperG = g;
  const layer = document.createElement('canvas');
  layer.width = canvas.width; layer.height = canvas.height;
  g = layer.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 上緣往下流的血（集中在一側）
  const side = rng.chance(0.5) ? 1 : 0;
  const x0 = side ? W * rng.range(0.55, 0.7) : W * rng.range(0.05, 0.15);
  g.fillStyle = rgba(BLOOD, 0.85);
  g.beginPath(); g.moveTo(x0 - 10, 0);
  for (let x = x0 - 10; x <= x0 + W * 0.32; x += 8) g.lineTo(x, rng.range(2, 8));
  g.lineTo(x0 + W * 0.32, 0); g.closePath(); g.fill();
  const nd = rng.int(6, 9);
  for (let i = 0; i < nd; i++) drip(g, rng, x0 + rng.range(-4, W * 0.31), rng.range(2, 5), rng.range(10, 30) * (rng.chance(0.3) ? 2.6 : 1), rng.range(1.6, 3.6));
  // 角落的噴濺
  splatter(g, rng, side ? rng.range(18, 50) : W - rng.range(18, 50), rng.range(H * 0.08, H * 0.22), rng.range(9, 15), 0.9);
  splatter(g, rng, side ? W - rng.range(10, 40) : rng.range(10, 40), H - rng.range(60, H * 0.35), rng.range(5, 9), 0.75);
  // 沾血的手印（從下方角落壓上來、一半在紙外）與指紋
  // 手印：有人抓過這張紙——右下方一個淡淡的手印，手掌靠紙邊、手指往左上伸進來（淡到不會蓋掉字）
  const hs = Math.min(175, W * 0.38);
  handprint(g, rng, W - hs * 0.34, H - hs * 0.4, hs, -0.6 + rng.range(-0.2, 0.2), 0.8);
  // 手掌往下拖出去的血痕
  smear(g, rng, W - hs * 0.4, H - hs * 0.2, W - hs * 0.1, H + 10, hs * 0.5, 0.8);
  for (let i = 0; i < 3; i++) {
    const fx = side ? W - rng.range(14, 34) : rng.range(14, 34), fy = rng.range(H * 0.3, H * 0.7) + i * 22;
    fingerprint(g, rng, fx, fy, rng.range(9, 13), rng.range(-0.6, 0.6), 0.9);
  }
  smear(g, rng, side ? W * 0.98 : W * 0.02, H * rng.range(0.55, 0.75), side ? W * 0.72 : W * 0.28, H * rng.range(0.7, 0.9), 26, 0.9);

  // ---- 用血寫的字：底下暈開一點，再往下滴幾道
  const pr = paper.getBoundingClientRect();
  for (const el of blood) {
    for (const r of el.getClientRects()) {
      if (r.width < 4) continue;
      const x = r.left - pr.left + paper.scrollLeft, y = r.top - pr.top + paper.scrollTop;
      // 暈開：橢圓形、邊緣淡掉（不要看得出方框）
      g.save();
      g.translate(x + r.width / 2, y + r.height * 0.55);
      g.scale((r.width / 2 + 10) / 10, (r.height * 0.6) / 10);
      const halo = g.createRadialGradient(0, 0, 0, 0, 0, 10);
      halo.addColorStop(0, rgba(BLOOD, 0.09)); halo.addColorStop(0.7, rgba(BLOOD, 0.05)); halo.addColorStop(1, rgba(BLOOD, 0));
      g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill();
      g.restore();
      const n = Math.max(1, Math.round(r.width / 70));
      for (let i = 0; i < n; i++) {
        if (!rng.chance(0.8)) continue;
        drip(g, rng, x + rng.range(0.1, 0.9) * r.width, y + r.height * 0.78, rng.range(5, 18) * (rng.chance(0.25) ? 2 : 1), rng.range(1, 1.8), 0.8);
      }
    }
  }
  paperG.save();
  paperG.setTransform(1, 0, 0, 1, 0, 0);
  paperG.globalCompositeOperation = 'multiply';
  paperG.drawImage(layer, 0, 0);
  paperG.restore();
}

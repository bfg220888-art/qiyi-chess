// 文件（紙條）的紙：全部用 canvas 程序畫（不用任何圖片）。每一種文件類型有自己的紙——紙色、印刷、外形
// （打孔、撕邊、鋸齒切口、圓角）、用過的痕跡（摺痕、膠帶、迴紋針、釘書針、咖啡杯印、水漬、油污）、
// 印章、網點照片、蠟筆畫；血只留給該有血的那幾份。文字本身是 DOM（src/ui.js 依 src/docs.js 排版），
// 這裡量它們的位置，把印章、劃掉的線、血字底下的滴痕畫在對的地方。
// 同一份文件每次打開都長得一樣（亂數種子 = 類型 + 文件 id）。
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
function fingerprint(g, rng, x, y, s, rot, k = 1, col = [80, 6, 4]) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.strokeStyle = rgba(col, 0.55 * k);
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

// ---------------------------------------------------------------------------
// 紙張上的其他東西：摺痕、咖啡杯印、水漬、膠帶、迴紋針、釘書針、打孔、油污

// 手畫的線：沿路抖一點（劃掉的字、紅筆圈起來的字、表格線）
function wobble(g, rng, x0, y0, x1, y1, amp = 1.2) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 14));
  g.beginPath(); g.moveTo(x0, y0);
  for (let i = 1; i <= n; i++) { const t = i / n; g.lineTo(x0 + (x1 - x0) * t + rng.range(-amp, amp), y0 + (y1 - y0) * t + rng.range(-amp, amp)); }
  g.stroke();
}
// 不規則的一團（水漬、燒痕、撕掉的角）：回傳路徑上的點
function blobPath(g, rng, x, y, r, n = 22, rough = 0.3) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (1 - rough + rng.next() * rough * 2) * (i === n ? 1 : 1);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}
function fold(g, W, y, x0 = 0, x1 = W, vertical = false, H = 0) {
  g.save();
  if (vertical) {
    const sh = g.createLinearGradient(y - 14, 0, y + 14, 0);
    sh.addColorStop(0, 'rgba(60,45,20,0)'); sh.addColorStop(0.48, 'rgba(60,45,20,0.10)'); sh.addColorStop(0.5, 'rgba(255,255,245,0.35)'); sh.addColorStop(0.56, 'rgba(60,45,20,0.05)'); sh.addColorStop(1, 'rgba(60,45,20,0)');
    g.fillStyle = sh; g.fillRect(y - 14, 0, 28, H);
  } else {
    const sh = g.createLinearGradient(0, y - 14, 0, y + 14);
    sh.addColorStop(0, 'rgba(60,45,20,0)'); sh.addColorStop(0.48, 'rgba(60,45,20,0.10)'); sh.addColorStop(0.5, 'rgba(255,255,245,0.35)'); sh.addColorStop(0.56, 'rgba(60,45,20,0.05)'); sh.addColorStop(1, 'rgba(60,45,20,0)');
    g.fillStyle = sh; g.fillRect(x0, y - 14, x1 - x0, 28);
  }
  g.restore();
}
function coffeeRing(g, rng, x, y, r) {
  g.save();
  for (let i = 0; i < 90; i++) {
    const a0 = rng.range(0, Math.PI * 2), len = rng.range(0.2, 0.9);
    g.strokeStyle = `rgba(110,70,25,${rng.range(0.05, 0.2)})`; g.lineWidth = rng.range(1, 3.2);
    g.beginPath(); g.ellipse(x, y, r + rng.range(-1.5, 1.5), (r + rng.range(-1.5, 1.5)) * 0.96, 0.2, a0, a0 + len); g.stroke();
  }
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(120,80,30,0.03)'); gr.addColorStop(1, 'rgba(120,80,30,0.07)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.restore();
}
// 水漬：平滑、不規則的一圈，裡面很淡、邊緣（乾掉時水往外推的那一圈）比較深
function waterStain(g, rng, x, y, r, tint = [120, 85, 35]) {
  g.save();
  const n = 9, pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2), rr = r * rng.range(0.75, 1.15); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * rng.range(0.7, 0.9)]); }
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(p[0], p[1], mx, my);
  }
  g.closePath();
  g.fillStyle = rgba(tint, 0.045); g.fill();
  g.strokeStyle = rgba(tint, 0.1); g.lineWidth = 4; g.stroke();
  g.strokeStyle = rgba(tint, 0.16); g.lineWidth = 1.1; g.stroke();
  g.restore();
}
function tape(g, rng, x, y, w, h, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = 'rgba(222,200,130,0.5)';
  g.beginPath(); g.moveTo(-w / 2, -h / 2);
  for (let yy = -h / 2; yy <= h / 2; yy += 3) g.lineTo(-w / 2 + (((yy / 3) | 0) % 2 ? 2.5 : 0), yy);
  g.lineTo(w / 2, h / 2);
  for (let yy = h / 2; yy >= -h / 2; yy -= 3) g.lineTo(w / 2 - (((yy / 3) | 0) % 2 ? 2.5 : 0), yy);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,250,220,0.25)'; g.fillRect(-w / 2 + 4, -h / 2 + 2, w - 8, h * 0.3);
  g.strokeStyle = 'rgba(120,95,40,0.25)'; g.lineWidth = 0.8; g.strokeRect(-w / 2 + 1, -h / 2, w - 2, h);
  g.restore();
}
function staple(g, x, y, rot = 0.1) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.strokeStyle = 'rgba(40,30,20,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-9, 1.5); g.lineTo(9, 1.5); g.stroke();
  g.strokeStyle = '#8d9096'; g.lineWidth = 2; g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-8, -0.6); g.lineTo(8, -0.6); g.stroke();
  // 生鏽
  g.fillStyle = 'rgba(140,70,20,0.25)'; g.beginPath(); g.ellipse(0, 2, 13, 5, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}
function paperclip(g, x, y, rot = 0.15, s = 1) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  const wire = () => {
    g.beginPath();
    g.moveTo(-5, -4); g.lineTo(-5, 34); g.arc(1, 34, 6, Math.PI, 0, true); g.lineTo(7, -10); g.arc(-1, -10, 8, 0, Math.PI, true); g.lineTo(-9, 28);
    g.stroke();
  };
  g.strokeStyle = 'rgba(30,20,10,0.3)'; g.lineWidth = 3.4; g.save(); g.translate(1.5, 2); wire(); g.restore();
  g.strokeStyle = '#9a9ea6'; g.lineWidth = 2.4; wire();
  g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 0.8; g.save(); g.translate(-0.6, 0); wire(); g.restore();
  g.fillStyle = 'rgba(140,70,20,0.16)'; g.fillRect(-12, -18, 24, 60);
  g.restore();
}
function grime(g, rng, W, H, n, color = [40, 35, 30]) {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(8, 28);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, rng.range(0.05, 0.14))); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}
// 揉過的紙：很多條方向不一的淡摺痕
function crumple(g, rng, W, H, n = 14) {
  g.save();
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), a = rng.range(0, Math.PI), l = rng.range(60, 220);
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    g.strokeStyle = 'rgba(255,255,250,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke();
    g.strokeStyle = 'rgba(50,40,25,0.13)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + 1, y + 1.4); g.lineTo(x + dx + 1, y + dy + 1.4); g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// 蠟筆：同一條線來回塗好幾次、有粗有細，之後整層再挖小洞（蠟沒塗到紙紋凹下去的地方）
function crayon(g, rng, pts, color, w = 5, passes = 3) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    g.strokeStyle = rgba(color, rng.range(0.35, 0.6)); g.lineWidth = w * rng.range(0.6, 1.1);
    g.beginPath();
    pts.forEach(([x, y], i) => { const px = x + rng.range(-1.6, 1.6), py = y + rng.range(-1.6, 1.6); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.stroke();
  }
  g.restore();
}
// 塗滿一個區域：一條一條斜線
function crayonFill(g, rng, x, y, w, h, color, inside = null, step = 5) {
  for (let d = -h; d < w; d += step) {
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.1) {
      const px = x + d + t * h * 0.9, py = y + h - t * h;
      if (px < x || px > x + w) continue;
      if (inside && !inside(px, py)) { if (pts.length > 1) crayon(g, rng, pts.splice(0), color, 4, 1); else pts.length = 0; continue; }
      pts.push([px, py]);
    }
    if (pts.length > 1) crayon(g, rng, pts, color, 4, 1);
  }
}
const circlePts = (x, y, rx, ry = rx, n = 16, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => [x + Math.cos(a0 + (a1 - a0) * i / n) * rx, y + Math.sin(a0 + (a1 - a0) * i / n) * ry]);
// 孩子的畫：醫院、月亮、長頭髮的白衣女人——她牽著的那個小孩畫得很淡，幾乎看不到
function kidDrawing(g, rng, r) {
  const { x, y, w, h } = r, gy = y + h * 0.86;
  const K = [30, 28, 34], RED = [190, 40, 30], YEL = [226, 178, 40], BLU = [50, 80, 160], GRN = [70, 120, 60];
  crayonFill(g, rng, x + 4, gy, w - 8, h * 0.12, GRN, null, 7);
  // 醫院
  const bx = x + w * 0.06, bw = w * 0.34, by = y + h * 0.2, bh = gy - by;
  crayon(g, rng, [[bx, gy], [bx, by], [bx + bw, by], [bx + bw, gy]], BLU, 5);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const wx = bx + bw * (0.14 + j * 0.3), wy = by + bh * (0.12 + i * 0.24), ws = bw * 0.16;
    const lit = i === 0 && j === 2;
    if (lit) crayonFill(g, rng, wx, wy, ws, ws, YEL, null, 3);
    crayon(g, rng, [[wx, wy], [wx + ws, wy], [wx + ws, wy + ws], [wx, wy + ws], [wx, wy]], lit ? YEL : K, 3, 2);
  }
  crayon(g, rng, [[bx + bw * 0.5, by - h * 0.1], [bx + bw * 0.5, by - h * 0.01]], RED, 5);
  crayon(g, rng, [[bx + bw * 0.38, by - h * 0.055], [bx + bw * 0.62, by - h * 0.055]], RED, 5);
  crayon(g, rng, [[bx + bw * 0.4, gy], [bx + bw * 0.4, gy - bh * 0.2], [bx + bw * 0.6, gy - bh * 0.2], [bx + bw * 0.6, gy]], K, 4);
  // 月亮與星星
  crayon(g, rng, circlePts(x + w * 0.86, y + h * 0.16, h * 0.08, h * 0.08, 14, 0.9, 5.2), YEL, 6);
  for (const [sx, sy] of [[0.6, 0.1], [0.72, 0.24], [0.5, 0.2]]) { const px = x + w * sx, py = y + h * sy; crayon(g, rng, [[px - 5, py], [px + 5, py]], YEL, 3, 2); crayon(g, rng, [[px, py - 5], [px, py + 5]], YEL, 3, 2); }
  // 媽媽：白衣服（只有輪廓）、長長的黑頭髮蓋住臉
  const mx = x + w * 0.64, hy = y + h * 0.36, hr = h * 0.07;
  crayon(g, rng, circlePts(mx, hy, hr), K, 4);
  for (let i = -4; i <= 4; i++) crayon(g, rng, [[mx + i * hr * 0.26, hy - hr], [mx + i * hr * 0.34 + rng.range(-2, 2), hy + hr * 2.6 + Math.abs(i) * 3]], K, 5, 2);
  crayon(g, rng, [[mx, hy + hr], [mx - w * 0.085, gy - 4], [mx + w * 0.085, gy - 4], [mx, hy + hr]], K, 4);
  crayon(g, rng, [[mx - w * 0.02, gy - 4], [mx - w * 0.02, gy + 8]], K, 4, 2);
  crayon(g, rng, [[mx + w * 0.02, gy - 4], [mx + w * 0.02, gy + 8]], K, 4, 2);
  // 伸出去的手
  const hx = mx + w * 0.13, hhy = hy + hr * 3.4;
  crayon(g, rng, [[mx + w * 0.03, hy + hr * 2.2], [hx, hhy]], K, 4, 2);
  crayon(g, rng, [[mx - w * 0.03, hy + hr * 2.2], [mx - w * 0.1, hhy]], K, 4, 2);
  // 小孩：淡淡的黃色，牽著她的手
  const cx = mx + w * 0.2, cy = gy - h * 0.2;
  const faint = (pts, ww = 3) => { g.save(); g.globalAlpha = 0.5; crayon(g, rng, pts, YEL, ww, 2); g.restore(); };
  faint(circlePts(cx, cy, hr * 0.7));
  faint([[cx, cy + hr * 0.7], [cx, gy - 8]]);
  faint([[cx, cy + hr * 1.2], [hx, hhy]]);
  faint([[cx, cy + hr * 1.2], [cx + w * 0.05, cy + hr * 2.2]]);
  faint([[cx, gy - 8], [cx - w * 0.025, gy + 4]]);
  faint([[cx, gy - 8], [cx + w * 0.025, gy + 4]]);
  // 蠟沒吃進紙紋的地方
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h / 26; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.7)})`; g.fillRect(x + rng.range(0, w), y + rng.range(0, h), rng.range(0.6, 1.8), rng.range(0.6, 1.8)); }
  g.restore();
}

// ---------------------------------------------------------------------------
// 印章：外框 + 字，印泥不均勻（挖小洞）、有一邊比較淡。畫在「墨水層」上
function stampMark(g, rng, r, shape, color, rot, family, text) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, col = color === 'blue' ? [40, 60, 150] : [186, 28, 22];
  const lines = text.split('\n');
  g.save(); g.translate(cx, cy); g.rotate(rot * Math.PI / 180);
  g.strokeStyle = rgba(col, 0.82); g.fillStyle = rgba(col, 0.82);
  let fs = Math.min(r.h / lines.length * 0.72, 30);
  if (shape === 'seal') {
    const s = Math.max(r.w, r.h) * 0.98; fs = s / (lines.length + 0.5);
    g.lineWidth = Math.max(2.5, s * 0.045); g.strokeRect(-s / 2, -s / 2, s, s);
    g.font = `700 ${fs}px ${family}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => { const chars = [...ln]; chars.forEach((ch, k) => g.fillText(ch, (k - (chars.length - 1) / 2) * (s / (chars.length + 0.4)), (i - (lines.length - 1) / 2) * fs * 1.02)); });
  } else {
    const w = r.w + 8, h = r.h + 4;
    g.lineWidth = 3;
    if (shape === 'round') { g.beginPath(); g.ellipse(0, 0, w / 2 + 6, h / 2 + 8, 0, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1; g.beginPath(); g.ellipse(0, 0, w / 2 + 1, h / 2 + 3, 0, 0, Math.PI * 2); g.stroke(); } else g.strokeRect(-w / 2, -h / 2, w, h);
    g.font = `700 ${fs}px ${family}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => g.fillText(ln, 0, (i - (lines.length - 1) / 2) * fs * 1.2 + 1));
  }
  // 印泥不均勻
  g.globalCompositeOperation = 'destination-out';
  const R = Math.max(r.w, r.h);
  for (let i = 0; i < R * 14; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.15, 0.8)})`; g.beginPath(); g.arc(rng.range(-R * 0.7, R * 0.7), rng.range(-R * 0.6, R * 0.6), rng.range(0.4, 1.5), 0, Math.PI * 2); g.fill(); }
  const side = g.createLinearGradient(-R * 0.6, 0, R * 0.6, 0);
  side.addColorStop(0, `rgba(0,0,0,${rng.range(0.25, 0.55)})`); side.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.fillStyle = side; g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();
}

// 網點照片（剪報）：lum(u, v) 回傳 0（黑）～1（白）
function halftone(g, r, lum, step = 3.2, ink = 'rgba(25,22,18,0.9)') {
  g.save(); g.fillStyle = ink;
  for (let j = 0; j * step < r.h; j++) for (let i = 0; i * step < r.w; i++) {
    const px = r.x + i * step + (j % 2 ? step / 2 : 0), py = r.y + j * step;
    const d = (1 - lum((px - r.x) / r.w, (py - r.y) / r.h)) * step * 0.72;
    if (d > 0.25) { g.beginPath(); g.arc(px, py, d, 0, Math.PI * 2); g.fill(); }
  }
  g.strokeStyle = 'rgba(25,22,18,0.6)'; g.lineWidth = 1; g.strokeRect(r.x, r.y, r.w, r.h);
  g.restore();
}
// 醫院大門：天空、建築、一格一格的窗、門上交叉的封條
const lumHospital = (u, v) => {
  if (v > 0.86) return 0.34 + 0.1 * Math.sin(u * 40);
  if (u > 0.12 && u < 0.88 && v > 0.2) {
    if (u > 0.42 && u < 0.58 && v > 0.56) { const a = Math.abs((u - 0.42) / 0.16 - (v - 0.56) / 0.3), b = Math.abs((u - 0.42) / 0.16 + (v - 0.56) / 0.3 - 1); return a < 0.09 || b < 0.09 ? 0.95 : 0.08; }
    const wx = (u * 9) % 1, wy = ((v - 0.2) * 7) % 1;
    return wx > 0.3 && wx < 0.75 && wy > 0.25 && wy < 0.7 && v < 0.8 ? 0.1 : 0.52;
  }
  return 0.86 - v * 0.3;
};
// 一個人的上半身（尋人啟事）：連帽外套、臉的地方印壞了
const lumPortrait = (u, v) => {
  const dx = (u - 0.5) / 0.2, dy = (v - 0.36) / 0.24;
  if (dx * dx + dy * dy < 1) return 0.62 + 0.25 * Math.sin(v * 90) * 0.4 - (dy > 0.2 ? 0.1 : 0);
  const hx = (u - 0.5) / 0.27, hy = (v - 0.34) / 0.32;
  if (hx * hx + hy * hy < 1) return 0.2;
  if (v > 0.6 && Math.abs(u - 0.5) < 0.2 + (v - 0.6) * 0.75) return 0.26;
  return 0.8 - 0.12 * v;
};

// ---------------------------------------------------------------------------
// 每一種文件的紙：stock 紙色、age 泛黃程度、shape 外形、print(c) 印上去的東西、wear(c) 用過的痕跡、
// blood 血量（0 沒有、1 幾滴、2 一些、3 整張都是）。每一種都不一樣。
const INK = { green: 'rgba(47,93,70,', red: 'rgba(170,45,45,', blue: 'rgba(60,80,150,', black: 'rgba(30,30,34,', brown: 'rgba(96,52,30,' };
const TYPES = {
  // 遺物說明：原本那張沾滿血的醫院表單
  relic: { stock: '#dcd1b4', age: 0.9, blood: 3, print(c) {
    const { g, W, H } = c;
    g.fillStyle = 'rgba(60,70,110,0.45)'; g.font = '700 10px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif'; g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillText('聖羅莎紀念醫院　ST. ROSA MEMORIAL HOSPITAL', W - 16, 10); g.fillRect(16, 25, W - 32, 1);
    g.fillStyle = 'rgba(60,70,110,0.16)'; for (let y = 64; y < H - 8; y += 32) g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgba(170,40,40,0.28)'; g.fillRect(22, 0, 1, H);
  }, wear(c) { fold(c.g, c.W, c.H * 0.5); } },
  // 交班單：淡綠色的表單紙、左邊兩個活頁孔
  handover: { stock: '#e3e9d9', age: 0.45, blood: 1, shape: { holes: 'left' }, wear(c) { fold(c.g, c.W, c.H * 0.52); grime(c.g, c.rng, c.W, c.H, 5); } },
  // 老陳的便條：電機行送的便條紙，上緣從膠條撕下來、藍色橫線、黑手指印、一段膠帶
  memo: { stock: '#f0e4ad', age: 0.5, shape: { tornTop: 9 }, print(c) { c.ruled(INK.blue + '0.3)'); }, wear(c) {
    const { g, rng, W, H } = c;
    tape(g, rng, W * 0.5, 14, 86, 26, rng.range(-0.08, 0.08));
    for (let i = 0; i < 3; i++) fingerprint(g, rng, rng.range(W * 0.72, W - 26), H * rng.range(0.55, 0.9), rng.range(12, 16), rng.range(-0.8, 0.8), 0.75, [34, 30, 28]);
    grime(g, rng, W, H, 9, [30, 26, 22]);
  } },
  // 日曆紙背面：很薄，正面的大紅字透過來（CSS 的 .d-ghost），上緣是撕下來的齒孔
  calendar: { stock: '#ebe5d4', age: 0.6, shape: { perfTop: true }, wear(c) { crumple(c.g, c.rng, c.W, c.H, 6); waterStain(c.g, c.rng, c.W * 0.8, c.H * 0.86, 46); } },
  // 電療紀錄：白色表單、左上角釘書針、右下的水漬
  ect: { stock: '#eceeea', age: 0.35, wear(c) { staple(c.g, 30, 22, -0.5); waterStain(c.g, c.rng, c.W * 0.14, c.H * 0.9, 58, [90, 90, 70]); fold(c.g, c.W, c.H * 0.5); } },
  // 病歷首頁：牛皮紙色的卡紙、上緣兩個裝訂孔、沾血的手印
  chart: { stock: '#e7d6a9', age: 0.7, blood: 2, shape: { holes: 'top' }, wear(c) { grime(c.g, c.rng, c.W, c.H, 8); } },
  // 蠟筆畫：圖畫紙、四角的膠帶、對摺過
  crayon: { stock: '#f1eee4', age: 0.3, wear(c) {
    const { g, rng, W, H } = c;
    fold(g, W, W * 0.5, 0, 0, true, H);
    for (const [x, y, a] of [[18, 16, -0.7], [W - 18, 16, 0.7], [18, H - 16, 0.7], [W - 18, H - 16, -0.7]]) tape(g, rng, x, y, 54, 20, a + rng.range(-0.1, 0.1));
  } },
  // 錄音逐字稿：打字紙、釘書針，整張都是血
  transcript: { stock: '#e6e3da', age: 0.6, blood: 3, wear(c) { staple(c.g, c.W - 34, 20, 0.2); fold(c.g, c.W, c.H * 0.34); fold(c.g, c.W, c.H * 0.67); } },
  // 護理紀錄：粉紅色的表單、摺成四摺、被水（眼淚）滴過
  nursing: { stock: '#f2e2df', age: 0.5, wear(c) {
    const { g, rng, W, H } = c;
    fold(g, W, H * 0.5); fold(g, W, W * 0.5, 0, 0, true, H);
    for (let i = 0; i < 5; i++) waterStain(g, rng, rng.range(W * 0.2, W * 0.9), rng.range(H * 0.45, H * 0.95), rng.range(9, 18), [130, 90, 90]);
  } },
  // 床頭卡：粉紅色的小卡片、圓角、上面的繩孔、被撕成兩半又用膠帶黏回去
  cribcard: { stock: '#f3c6d1', age: 0.4, shape: { round: 16, hole: true }, print(c) {
    const { g, W, H } = c; g.strokeStyle = 'rgba(122,39,64,0.55)'; g.lineWidth = 2.5; g.strokeRect(10, 10, W - 20, H - 20); g.lineWidth = 1; g.strokeRect(15, 15, W - 30, H - 30);
  }, wear(c) {
    const { g, rng, W, H } = c;
    // 撕痕：一條斜的鋸齒線，兩邊顏色差一點
    g.save(); g.strokeStyle = 'rgba(255,245,245,0.9)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(W * 0.6, 0);
    const pts = []; for (let t = 0; t <= 1.001; t += 0.05) pts.push([W * (0.6 - t * 0.28) + rng.range(-5, 5), H * t]);
    for (const [px, py] of pts) g.lineTo(px, py); g.stroke();
    g.strokeStyle = 'rgba(90,30,45,0.35)'; g.lineWidth = 1; g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + 1.5, py) : g.moveTo(px + 1.5, py))); g.stroke(); g.restore();
    tape(g, rng, W * 0.53, H * 0.25, 30, 88, 1.25); tape(g, rng, W * 0.39, H * 0.75, 30, 88, 1.3);
  } },
  // 信箋：醫院用箋、紅色橫線、摺成三摺、淚痕
  letter: { stock: '#f3edda', age: 0.4, print(c) { c.ruled(INK.red + '0.32)'); const { g, W, H } = c; g.strokeStyle = INK.red + '0.4)'; g.lineWidth = 1; g.strokeRect(14, 14, W - 28, H - 28); }, wear(c) {
    const { g, rng, W, H } = c;
    fold(g, W, H * 0.33); fold(g, W, H * 0.66);
    for (let i = 0; i < 4; i++) waterStain(g, rng, rng.range(W * 0.2, W * 0.85), rng.range(H * 0.3, H * 0.9), rng.range(8, 14), [70, 80, 120]);
  } },
  // 巡邏紀錄表：泛黃的表格、板夾的鏽痕、咖啡杯印
  patrol: { stock: '#dbcba2', age: 0.75, blood: 1, wear(c) {
    const { g, rng, W, H } = c;
    g.fillStyle = 'rgba(120,60,20,0.2)'; g.fillRect(W * 0.36, 0, W * 0.28, 12); g.fillStyle = 'rgba(120,60,20,0.12)'; g.fillRect(W * 0.34, 0, W * 0.32, 18);
    coffeeRing(g, rng, W * 0.78, H * 0.2, Math.min(44, W * 0.11));
    // 最後一格寫到一半，筆被拖走
    const last = c.rects('.d-tr:last-child .d-td:last-child')[0];
    if (last) { g.strokeStyle = 'rgba(17,17,17,0.75)'; g.lineWidth = 1.4; g.beginPath(); const x0 = last.x + Math.min(last.w * 0.6, 92), y0 = last.y + last.h * 0.6; g.moveTo(x0, y0); g.bezierCurveTo(x0 + 30, y0 + 4, x0 + 50, y0 + 30, W - 24, y0 + 70 + rng.range(0, 20)); g.stroke(); }
  } },
  // 藥袋：白色紙袋、紅色印刷的框、揉過、沾血的手印
  medbag: { stock: '#f4f1e9', age: 0.35, blood: 2, shape: { zigTop: 5 }, print(c) {
    const { g, W, H } = c; g.strokeStyle = INK.red + '0.6)'; g.lineWidth = 3; g.strokeRect(12, 16, W - 24, H - 28);
    // 袋底的摺邊
    g.fillStyle = 'rgba(80,60,40,0.08)'; g.fillRect(0, H - 14, W, 14);
  }, wear(c) { crumple(c.g, c.rng, c.W, c.H, 22); } },
  // 相片背面：相紙、斜斜的浮水印、四角的雙面膠殘膠
  photoback: { stock: '#e9e8e2', age: 0.3, print(c) {
    const { g, W, H } = c;
    g.save(); g.rotate(-0.5); g.fillStyle = 'rgba(120,125,135,0.2)'; g.font = '700 11px Arial, Helvetica, sans-serif';
    for (let y = 0; y < H * 2; y += 34) for (let x = -H; x < W; x += 120) g.fillText('COLOR PAPER', x + ((y / 34) % 2) * 60, y);
    g.restore();
  }, wear(c) {
    const { g, rng, W, H } = c;
    for (const [x, y] of [[26, 24], [W - 26, 24], [26, H - 24], [W - 26, H - 24]]) { g.fillStyle = 'rgba(160,135,70,0.3)'; g.fillRect(x - 16, y - 10, 32, 20); g.fillStyle = 'rgba(90,70,30,0.12)'; for (let i = 0; i < 20; i++) g.fillRect(x - 16 + rng.range(0, 30), y - 10 + rng.range(0, 18), 2, 2); }
    // 相紙微微捲起來：左右兩邊比較暗
    const sh = g.createLinearGradient(0, 0, W, 0); sh.addColorStop(0, 'rgba(40,40,50,0.16)'); sh.addColorStop(0.12, 'rgba(40,40,50,0)'); sh.addColorStop(0.88, 'rgba(40,40,50,0)'); sh.addColorStop(1, 'rgba(40,40,50,0.16)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
  } },
  // 公文：影印過的白紙（影印機的黑邊與雜點）、迴紋針
  official: { stock: '#eeeeea', age: 0.2, print(c) {
    const { g, rng, W, H } = c;
    const ed = g.createLinearGradient(0, 0, 26, 0); ed.addColorStop(0, 'rgba(20,20,20,0.32)'); ed.addColorStop(1, 'rgba(20,20,20,0)'); g.fillStyle = ed; g.fillRect(0, 0, 26, H);
    g.fillStyle = 'rgba(20,20,20,0.5)'; for (let i = 0; i < 160; i++) g.fillRect(rng.range(0, W), rng.range(0, H), rng.range(0.5, 1.4), rng.range(0.5, 1.4));
    const hd = c.rects('.d-hd')[0];
    if (hd) { g.fillStyle = 'rgba(160,30,30,0.7)'; g.fillRect(hd.x, hd.y + hd.h + 3, hd.w, 2); g.fillRect(hd.x, hd.y + hd.h + 7, hd.w, 0.8); }
  }, wear(c) { paperclip(c.g, 40, 6, 0.12, 1.1); } },
  // 事故報告：複寫紙第二聯——淡藍色的薄紙、複寫的藍紫色污痕、揉過（被丟掉又撿回來）
  incident: { stock: '#ccdae8', age: 0.25, print(c) {
    const { g, rng, W, H } = c;
    for (let i = 0; i < 26; i++) { const x = rng.range(0, W), y = rng.range(0, H); g.strokeStyle = `rgba(60,50,140,${rng.range(0.04, 0.12)})`; g.lineWidth = rng.range(1, 6); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-40, 40), y + rng.range(-6, 6)); g.stroke(); }
    grime(g, rng, W, H, 10, [60, 50, 140]);
  }, wear(c) { crumple(c.g, c.rng, c.W, c.H, 26); } },
  // 維修申請單：黃色的三聯單、上緣撕下來的齒孔、機油
  workorder: { stock: '#ead682', age: 0.55, shape: { perfTop: true }, wear(c) {
    const { g, rng, W, H } = c;
    for (let i = 0; i < 4; i++) { const x = rng.range(20, W - 20), y = rng.range(H * 0.3, H - 20); waterStain(g, rng, x, y, rng.range(10, 26), [50, 40, 20]); }
    for (let i = 0; i < 2; i++) fingerprint(g, rng, rng.range(24, 60), H * rng.range(0.5, 0.9), 14, rng.range(-0.8, 0.8), 0.8, [34, 30, 28]);
    fold(g, W, H * 0.5);
  } },
  // 剪報：發黃的新聞紙、剪刀剪得歪歪的、背面的字透過來
  clipping: { stock: '#d9cca6', age: 0.95, shape: { cut: true }, print(c) {
    const { g, rng, W, H } = c;
    g.fillStyle = 'rgba(60,45,25,0.07)';
    for (let y = 30; y < H - 10; y += 9) { let x = 12; while (x < W - 12) { const l = rng.range(6, 40); if (rng.chance(0.8)) g.fillRect(x, y, l, 3); x += l + rng.range(3, 8); } }
  }, wear(c) { fold(c.g, c.W, c.H * 0.55); } },
  // 尋人啟事：噴墨印表機印的白紙——橫向的噴頭條紋、被雨淋過往下暈開的墨、四角的膠帶
  flyer: { stock: '#f8f8f6', age: 0.08, print(c) {
    const { g, rng, W, H } = c;
    g.fillStyle = 'rgba(255,255,255,0.5)'; for (let y = rng.range(0, 12); y < H; y += rng.range(9, 26)) g.fillRect(0, y, W, rng.range(0.6, 1.6));
    for (let i = 0; i < 14; i++) { const x = rng.range(20, W - 20), y = rng.range(40, H * 0.8), l = rng.range(30, 120); const gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(40,60,120,0.12)'); gr.addColorStop(1, 'rgba(40,60,120,0)'); g.fillStyle = gr; g.fillRect(x, y, rng.range(3, 10), l); }
  }, wear(c) {
    const { g, rng, W, H } = c;
    for (const [x, y, a] of [[20, 16, -0.75], [W - 20, 16, 0.75], [20, H - 16, 0.75], [W - 20, H - 16, -0.75]]) tape(g, rng, x, y, 60, 22, a);
    waterStain(g, rng, W * 0.3, H * 0.7, 70, [90, 100, 110]); crumple(g, rng, W, H, 5);
  } },
  // 筆記本內頁：方格紙、左邊從線圈撕下來、鉛筆的灰、髒手印
  notebook: { stock: '#eceeea', age: 0.2, blood: 1, shape: { spiral: true }, print(c) {
    const { g, W, H } = c; g.fillStyle = 'rgba(70,110,170,0.2)';
    for (let x = 30; x < W; x += 16) g.fillRect(x, 0, 1, H);
    for (let y = 10; y < H; y += 16) g.fillRect(0, y, W, 1);
  }, wear(c) { grime(c.g, c.rng, c.W, c.H, 14); fingerprint(c.g, c.rng, c.W - 40, c.H * 0.8, 15, 0.4, 0.6, [50, 45, 40]); } },
  // 收據：窄窄的感熱紙、上下是鋸齒切口、兩側的粉紅色「快用完了」警示條、字褪色
  receipt: { stock: '#f0ede6', age: 0.15, shape: { zigTop: 4, zigBottom: 4 }, print(c) {
    const { g, W, H } = c; g.fillStyle = 'rgba(214,90,120,0.28)'; g.fillRect(0, 0, 5, H); g.fillRect(W - 5, 0, 5, H);
    const fade = g.createLinearGradient(0, 0, W, 0); fade.addColorStop(0, 'rgba(240,237,230,0)'); fade.addColorStop(1, 'rgba(240,237,230,0)');
    g.fillStyle = fade; g.fillRect(0, 0, W, H);
  }, wear(c) { const { g, W, H } = c; for (let i = 1; i < 5; i++) fold(g, W, H * i / 5); crumple(g, c.rng, W, H, 5); } },
};
export const PAPER_TYPES = Object.keys(TYPES);

// 紙的外形：打孔、撕邊、鋸齒切口、圓角……直接把紙挖掉（露出後面的黑底）
function cutShape(g, rng, W, H, shape) {
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  const hole = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  if (shape.holes === 'left') { hole(18, H * 0.28, 6.5); hole(18, H * 0.72, 6.5); }
  if (shape.holes === 'top') { hole(W * 0.38, 16, 6.5); hole(W * 0.62, 16, 6.5); }
  if (shape.hole) hole(W / 2, 22, 6);
  if (shape.tornTop) { g.beginPath(); g.moveTo(0, 0); for (let x = 0; x <= W; x += 5) g.lineTo(x, rng.range(1, shape.tornTop)); g.lineTo(W, 0); g.closePath(); g.fill(); }
  if (shape.perfTop) for (let x = 4; x < W; x += 9) hole(x, 0, 3.2);
  for (const [k, y0, dir] of [['zigTop', 0, 1], ['zigBottom', H, -1]]) {
    if (!shape[k]) continue;
    g.beginPath(); g.moveTo(0, y0);
    for (let x = 0, i = 0; x <= W + 6; x += 6, i++) g.lineTo(x, y0 + (i % 2 ? shape[k] : 0) * dir);
    g.lineTo(W, y0); g.closePath(); g.fill();
  }
  if (shape.round) {
    const r = shape.round;
    for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]]) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * sx, cy); g.arc(cx + r * sx, cy + r * sy, r, sy > 0 ? -Math.PI / 2 : Math.PI / 2, sx > 0 ? Math.PI : 0, sx * sy > 0); g.lineTo(cx, cy); g.fill(); }
  }
  if (shape.cut) {
    // 剪刀剪的：四邊各削掉一條細長的三角形
    const a = rng.range(3, 9), b = rng.range(3, 10), c2 = rng.range(2, 8), d = rng.range(3, 9);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, a); g.lineTo(W * 0.45, 2); g.lineTo(0, a * 0.4); g.fill();
    g.beginPath(); g.moveTo(W, 0); g.lineTo(W, H); g.lineTo(W - b, H); g.lineTo(W - 2, H * 0.4); g.fill();
    g.beginPath(); g.moveTo(0, H); g.lineTo(W, H); g.lineTo(W, H - c2); g.lineTo(W * 0.6, H - 1.5); g.lineTo(0, H - c2 * 1.4); g.fill();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(d, 0); g.lineTo(1.5, H * 0.55); g.lineTo(d * 0.7, H); g.lineTo(0, H); g.fill();
  }
  if (shape.spiral) {
    // 從線圈筆記本撕下來：左邊一排被扯破的孔
    g.beginPath(); g.moveTo(0, 0);
    for (let y = 0; y <= H; y += 4) g.lineTo(rng.range(1, 5), y);
    g.lineTo(0, H); g.closePath(); g.fill();
    for (let y = 16; y < H - 8; y += 16) { g.beginPath(); g.moveTo(0, y - 4); g.lineTo(rng.range(9, 14), y - 3.5); g.arc(11, y, 3.6, -Math.PI / 2, Math.PI / 2); g.lineTo(0, y + rng.range(2, 5)); g.fill(); }
  }
  g.restore();
}

// 燒毀的舊院區：紙的一角燒掉了，旁邊一圈焦黃
function scorch(g, rng, W, H) {
  const corners = rng.shuffle([[W, H], [0, H], [W, 0], [0, 0]]).slice(0, 2);
  for (const [cx, cy] of corners) {
    const R = Math.min(W, H) * rng.range(0.22, 0.34);
    const gr = g.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
    gr.addColorStop(0, 'rgba(20,12,6,0.95)'); gr.addColorStop(0.35, 'rgba(60,32,10,0.7)'); gr.addColorStop(0.7, 'rgba(120,75,25,0.3)'); gr.addColorStop(1, 'rgba(120,75,25,0)');
    g.fillStyle = gr; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; blobPath(g, rng, cx, cy, R * 0.42, 20, 0.35); g.fill(); g.restore();
  }
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(30,18,8,${rng.range(0.2, 0.6)})`; g.beginPath(); g.arc(rng.range(0, W), rng.range(0, H), rng.range(0.6, 2.2), 0, Math.PI * 2); g.fill(); }
}

// 畫整張紙。paper = .paper 元素、canvas = 裡面的 <canvas>；
// spec = { key（決定亂數：同一份文件每次打開都長得一樣）, type（文件類型）, burned（在燒毀的舊院區撿到的） }
export function paintPaper(paper, canvas, spec, blood = []) {
  if (typeof spec === 'string') spec = { key: spec, type: 'relic' };
  const T = TYPES[spec.type] || TYPES.relic;
  // 先把舊的畫布縮成 0，量到的高度才是內容本身的高度；紙只畫到底下那行操作說明之前
  canvas.style.width = '0px'; canvas.style.height = '0px';
  const foot = paper.querySelector('.paper-foot');
  const W = paper.clientWidth, H = foot ? foot.offsetTop : Math.max(paper.scrollHeight, paper.clientHeight);
  if (!W || !H) return false;
  // 紙有一點旋轉：量字的位置之前先轉正（同一個同步流程裡轉回去，畫面不會閃）
  const tf = paper.style.transform;
  paper.style.transform = 'none';
  try { return paintBody(paper, canvas, spec, blood, T, W, H); } finally { paper.style.transform = tf; }
}
function paintBody(paper, canvas, spec, blood, T, W, H) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rng = new RNG(hashStr(spec.type + ':' + spec.key));
  const pr = paper.getBoundingClientRect();
  const rel = (r, el) => ({ x: r.left - pr.left + paper.scrollLeft, y: r.top - pr.top + paper.scrollTop, w: r.width, h: r.height, el });
  const c = {
    g, W, H, rng,
    rects: (sel) => [...paper.querySelectorAll(sel)].map((el) => rel(el.getBoundingClientRect(), el)).filter((r) => r.w > 0 && r.h > 0),
    // 橫線：對齊內文每一行的底（.doc 的 line-height）
    // 橫線：量每一行字真正的底（不同字型混在同一行時行高會不一樣），每一行底下一條，空白的地方照平均行距補滿
    ruled(color) {
      const bottoms = [];
      for (const el of paper.querySelectorAll('.doc .d-p')) {
        const range = document.createRange(); range.selectNodeContents(el);
        for (const r of range.getClientRects()) { if (r.height < 4) continue; const b = rel(r).y + r.height - 3; if (!bottoms.some((v) => Math.abs(v - b) < r.height * 0.5)) bottoms.push(b); }
      }
      bottoms.sort((a, b) => a - b);
      const gaps = bottoms.slice(1).map((b, i) => b - bottoms[i]).filter((d) => d > 12).sort((a, b) => a - b);
      const lh = gaps.length ? gaps[gaps.length >> 1] : 30;
      const ys = [];
      if (!bottoms.length) for (let y = 40; y < H - 12; y += lh) ys.push(y);
      else {
        for (let y = bottoms[0] - lh; y > 24; y -= lh) ys.push(y);
        bottoms.forEach((b, i) => { ys.push(b); const nx = bottoms[i + 1]; if (nx) for (let y = b + lh; y < nx - lh * 0.6; y += lh) ys.push(y); });
        for (let y = bottoms[bottoms.length - 1] + lh; y < H - 12; y += lh) ys.push(y);
      }
      g.fillStyle = color;
      for (const y of ys) g.fillRect(0, Math.round(y), W, 1);
    },
  };
  // ---- 紙：底色、泛黃的邊、纖維、霉斑
  g.fillStyle = T.stock; g.fillRect(0, 0, W, H);
  const age = T.age == null ? 0.5 : T.age;
  const edge = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  edge.addColorStop(0, 'rgba(120,90,40,0)'); edge.addColorStop(1, `rgba(105,72,30,${0.1 + age * 0.34})`);
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  for (let i = 0; i < Math.round(age * 5); i++) waterStain(g, rng, rng.range(0, W), rng.range(0, H), rng.range(30, 90), [125, 88, 36]);
  for (let i = 0; i < age * 70; i++) {
    g.fillStyle = `rgba(${rng.int(90, 130)},${rng.int(60, 80)},30,${rng.range(0.12, 0.36)})`;
    g.beginPath(); g.arc(rng.range(0, W), rng.range(0, H), rng.range(0.6, 2.8), 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(80,60,30,0.06)'; g.lineWidth = 0.6;
  for (let i = 0; i < W * H / 900; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), a = rng.range(0, Math.PI), l = rng.range(3, 12);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  if (T.print) { g.save(); T.print(c); g.restore(); }

  // ---- 墨水層：印章、網點照片、蠟筆畫、手畫的線（要挖小洞的東西不能挖到紙）；之後用 multiply 疊上去
  const layer = () => { const l = document.createElement('canvas'); l.width = canvas.width; l.height = canvas.height; const lg = l.getContext('2d'); lg.setTransform(dpr, 0, 0, dpr, 0, 0); return [l, lg]; };
  const stamp = (l) => { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'multiply'; g.drawImage(l, 0, 0); g.restore(); };
  const [inkL, ig] = layer();
  for (const r of c.rects('.d-photo')) {
    const cap = r.el.querySelector('.d-cap'), ch = cap ? cap.getBoundingClientRect().height + 4 : 0;
    const box = { x: r.x, y: r.y, w: r.w, h: r.h - ch };
    if (spec.type === 'flyer') {
      halftone(ig, box, lumPortrait, 2.4, 'rgba(40,44,60,0.85)');
      ig.fillStyle = 'rgba(248,248,246,0.75)'; for (let y = box.y + rng.range(0, 8); y < box.y + box.h; y += rng.range(5, 16)) ig.fillRect(box.x, y, box.w, rng.range(0.8, 2.4));
    } else halftone(ig, box, lumHospital);
  }
  for (const r of c.rects('.d-draw')) kidDrawing(ig, rng, r);
  for (const r of c.rects('.d-stamp')) {
    const [shape, color, rot] = (r.el.dataset.stamp || 'rect|red|0').split('|');
    stampMark(ig, rng, r, shape, color, Number(rot) + rng.range(-1.5, 1.5), getComputedStyle(r.el).fontFamily, r.el.textContent);
  }
  // 劃掉的字：再多劃一兩道；紅筆圈起來 / 畫底線的字
  for (const el of paper.querySelectorAll('.d-x, .d-em')) {
    const em = el.classList.contains('d-em'), ink = em ? 'rgba(178,34,28,0.8)' : getComputedStyle(el).color;
    const rs = [...el.getClientRects()].map((r) => rel(r)).filter((r) => r.w > 3);
    ig.strokeStyle = ink; ig.lineWidth = em ? 1.7 : 1.3;
    for (const r of rs) {
      if (!em) { wobble(ig, rng, r.x - 2, r.y + r.h * 0.5, r.x + r.w + 3, r.y + r.h * 0.56, 1.6); if (rng.chance(0.6)) wobble(ig, rng, r.x - 1, r.y + r.h * 0.62, r.x + r.w + 2, r.y + r.h * 0.44, 1.6); } else if (rs.length === 1 && r.w < 130) {
        ig.beginPath(); ig.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + 7, r.h / 2 + 2, rng.range(-0.05, 0.05), 0.3, Math.PI * 2 + 0.75); ig.stroke();
      } else { wobble(ig, rng, r.x - 2, r.y + r.h - 3, r.x + r.w + 2, r.y + r.h - 2, 1); wobble(ig, rng, r.x, r.y + r.h, r.x + r.w - 4, r.y + r.h + 1, 1); }
    }
  }
  stamp(inkL);
  if (T.wear) { g.save(); T.wear(c); g.restore(); }

  // ---- 血：畫在另一張透明的圖層上（手印「沒沾到的地方」要挖洞），最後用 multiply 疊到紙上，像被紙吸進去
  const level = T.blood || 0;
  if (level > 0 || blood.length) {
    const [bl, b] = layer();
    const side = rng.chance(0.5) ? 1 : 0;
    if (level >= 3) {
      // 上緣往下流的血（集中在一側）
      const x0 = side ? W * rng.range(0.55, 0.7) : W * rng.range(0.05, 0.15);
      b.fillStyle = rgba(BLOOD, 0.85);
      b.beginPath(); b.moveTo(x0 - 10, 0);
      for (let x = x0 - 10; x <= x0 + W * 0.32; x += 8) b.lineTo(x, rng.range(2, 8));
      b.lineTo(x0 + W * 0.32, 0); b.closePath(); b.fill();
      const nd = rng.int(6, 9);
      for (let i = 0; i < nd; i++) drip(b, rng, x0 + rng.range(-4, W * 0.31), rng.range(2, 5), rng.range(10, 30) * (rng.chance(0.3) ? 2.6 : 1), rng.range(1.6, 3.6));
      splatter(b, rng, side ? rng.range(18, 50) : W - rng.range(18, 50), rng.range(H * 0.08, H * 0.22), rng.range(9, 15), 0.9);
      smear(b, rng, side ? W * 0.98 : W * 0.02, H * rng.range(0.55, 0.75), side ? W * 0.72 : W * 0.28, H * rng.range(0.7, 0.9), 26, 0.9);
    }
    if (level >= 2) {
      // 有人抓過這張紙：右下方一個淡淡的手印，手掌靠紙邊、手指往左上伸進來（淡到不會蓋掉字）
      const hs = Math.min(175, W * 0.38);
      handprint(b, rng, W - hs * 0.34, H - hs * 0.4, hs, -0.6 + rng.range(-0.2, 0.2), 0.8);
      smear(b, rng, W - hs * 0.4, H - hs * 0.2, W - hs * 0.1, H + 10, hs * 0.5, 0.8);
      for (let i = 0; i < 3; i++) fingerprint(b, rng, side ? W - rng.range(14, 34) : rng.range(14, 34), rng.range(H * 0.3, H * 0.7) + i * 22, rng.range(9, 13), rng.range(-0.6, 0.6), 0.9);
    }
    if (level >= 1) {
      splatter(b, rng, side ? W - rng.range(10, 40) : rng.range(10, 40), H - rng.range(60, H * 0.35), rng.range(4, 8) * (level >= 2 ? 1.2 : 1), 0.75);
      if (level === 1) fingerprint(b, rng, W - rng.range(20, 44), H * rng.range(0.4, 0.8), 11, rng.range(-0.6, 0.6), 0.8);
    }
    // 用血寫的字：底下暈開一點，再往下滴幾道
    for (const el of blood) {
      for (const cr of el.getClientRects()) {
        if (cr.width < 4) continue;
        const r = rel(cr);
        b.save();
        b.translate(r.x + r.w / 2, r.y + r.h * 0.55);
        b.scale((r.w / 2 + 10) / 10, (r.h * 0.6) / 10);
        const halo = b.createRadialGradient(0, 0, 0, 0, 0, 10);
        halo.addColorStop(0, rgba(BLOOD, 0.09)); halo.addColorStop(0.7, rgba(BLOOD, 0.05)); halo.addColorStop(1, rgba(BLOOD, 0));
        b.fillStyle = halo; b.beginPath(); b.arc(0, 0, 10, 0, Math.PI * 2); b.fill();
        b.restore();
        const n = Math.max(1, Math.round(r.w / 70));
        for (let i = 0; i < n; i++) {
          if (!rng.chance(0.8)) continue;
          drip(b, rng, r.x + rng.range(0.1, 0.9) * r.w, r.y + r.h * 0.78, rng.range(5, 18) * (rng.chance(0.25) ? 2 : 1), rng.range(1, 1.8), 0.8);
        }
      }
    }
    stamp(bl);
  }
  if (spec.burned) scorch(g, rng, W, H);
  if (T.shape) cutShape(g, rng, W, H, T.shape);
  return true;
}

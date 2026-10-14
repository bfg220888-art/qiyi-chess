# 把 Rocketbox 人物貼圖處理成屍體：死白的皮膚、屍斑、瘀傷、割傷、解剖切口、口鼻流血、沾血的衣服。
# 用法：python3 corpse_tex.py <Rocketbox Avatars 資料夾> <部位圖資料夾(uv-*.png)> <輸出資料夾>
import os, sys, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

AV, UVD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
S = 1024
SRC = {
    'm021': ('Professions/Sports_Male_01', ['body', 'head']),
    'f002': ('Adults/Female_Adult_02', ['body', 'head', 'opacity']),
    'm162': ('Professions/Medical_Male_04', ['body', 'head', 'protection']),
}

def load(path, mode='RGB'):
    return np.asarray(Image.open(path).convert(mode).resize((S, S), Image.LANCZOS)).astype(np.float32) / 255.0

def blur(a, r):
    return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0

def noise(rng, scale, octaves=4):
    out = np.zeros((S, S), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        n = max(2, int(scale * 2 ** o))
        small = rng.random((n, n)).astype(np.float32)
        out += amp * np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)).astype(np.float32) / 255.0
        tot += amp; amp *= 0.5
    return out / tot

def lum(c):
    return c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11

def skin_mask(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    m = (r > g) & (g > b * 0.9) & (sat > 0.12) & (sat < 0.8) & (mx > 0.18) & ((r - b) > 0.06)
    # 稍微擴張，連 UV 接縫外的填充色也一起處理，渲染時接縫才不會透出原本的膚色
    m = np.asarray(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))).astype(np.float32) / 255.0
    return blur(m, 2)

def paint(layer_rgb, layer_a, mask, color, alpha):
    # 把一層顏色以 alpha 疊上去
    a = mask[..., None] * alpha
    return layer_rgb * (1 - a) + np.array(color, np.float32) * a

def draw_mask(fn):
    im = Image.new('L', (S, S), 0); d = ImageDraw.Draw(im); fn(d)
    return np.asarray(im).astype(np.float32) / 255.0

def corpse_skin(c, sm, rng, back=None):
    # 失血後的死白：去飽和、偏灰綠，暗部偏紫
    L = lum(c)
    pale = np.stack([0.66 * L + 0.2, 0.68 * L + 0.2, 0.64 * L + 0.21], -1)
    pale = pale * (0.9 + 0.12 * noise(rng, 6)[..., None])
    out = c * (1 - sm[..., None] * 0.85) + pale * sm[..., None] * 0.85
    # 細微的大理石紋（皮下血管）
    veins = noise(rng, 90, 2)
    v = np.clip((veins - 0.7) * 5, 0, 1) * 0.18 * sm
    out = paint(out, None, v, (0.38, 0.4, 0.55), 1.0)
    # 屍斑：背面（著床的那一側）大片紫紅
    if back is not None:
        lv = np.clip(blur(back, 18) * (0.6 + 0.6 * noise(rng, 10)), 0, 1) * sm
        out = paint(out, None, lv, (0.45, 0.2, 0.32), 0.45)
    return out

def bruises(out, sm, rng, n, region=None):
    for _ in range(n):
        ys, xs = np.nonzero((sm > 0.5) if region is None else (region & (sm > 0.5)))
        if len(xs) == 0: return out
        k = rng.integers(len(xs)); x, y = xs[k], ys[k]
        r = rng.uniform(14, 40)
        m = draw_mask(lambda d: d.ellipse([x - r, y - r * rng.uniform(0.6, 1.2), x + r, y + r * rng.uniform(0.6, 1.2)], fill=255))
        m = blur(m, r * 0.45) * (0.6 + 0.6 * noise(rng, 30))
        out = paint(out, None, np.clip(m, 0, 1) * sm, (0.3, 0.16, 0.3), 0.75)
        out = paint(out, None, np.clip(blur(m, r * 0.5) - m, 0, 1) * sm * 2, (0.45, 0.48, 0.25), 0.35)
    return out

def cut(out, pts, width, rng, blood=1.0):
    # 傷口：紅腫的邊、深紅的裂口、往下流的血
    edge = draw_mask(lambda d: d.line(pts, fill=255, width=int(width * 3.5), joint='curve'))
    core = draw_mask(lambda d: d.line(pts, fill=255, width=max(1, int(width)), joint='curve'))
    out = paint(out, None, blur(edge, width * 1.5), (0.62, 0.3, 0.32), 0.55)
    out = paint(out, None, blur(core, 0.8), (0.18, 0.01, 0.02), 0.95)
    if blood > 0:
        drips = draw_mask(lambda d: [d.line([(x + rng.uniform(-2, 2), y), (x + rng.uniform(-6, 6), y + rng.uniform(15, 70))], fill=255, width=max(1, int(width * 0.7))) for (x, y) in pts[::max(1, len(pts) // 4)]])
        out = paint(out, None, blur(drips, 1.2), (0.25, 0.02, 0.02), 0.85 * blood)
    return out

def splatter(out, cx, cy, r, rng, color=(0.28, 0.03, 0.03), alpha=0.85, mask=None):
    def f(d):
        # 不規則的主血塊（幾個重疊的橢圓）＋往外噴的小血點
        for _ in range(4):
            ox, oy = rng.uniform(-r * 0.5, r * 0.5), rng.uniform(-r * 0.5, r * 0.5)
            rx, ry = r * rng.uniform(0.4, 0.9), r * rng.uniform(0.3, 0.8)
            d.ellipse([cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry], fill=255)
        for _ in range(int(r * 2)):
            a = rng.uniform(0, 6.28); rr = r * rng.uniform(0.9, 2.4); s = rng.uniform(0.6, max(0.8, r * 0.22))
            x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            d.ellipse([x - s, y - s, x + s, y + s], fill=255)
    m = blur(draw_mask(f), 1.5) * (0.7 + 0.5 * noise(rng, 20))
    if mask is not None: m = m * mask
    return paint(out, None, np.clip(m, 0, 1), color, alpha)

def soak(out, region, rng, amount, mask=None):
    # 布料吸飽了血：大片不規則、邊緣比較深
    n = noise(rng, 4) * 0.6 + noise(rng, 16) * 0.4
    base = region.astype(np.float32) if region.dtype == bool else region
    m = np.clip((n - (1 - amount)) * 5, 0, 1) * base
    if mask is not None: m = m * mask
    rim = np.clip(blur(m, 3) - blur(m, 10), 0, 1) * 3
    out = paint(out, None, m, (0.26, 0.04, 0.035), 0.82)
    return paint(out, None, np.clip(rim, 0, 1), (0.14, 0.02, 0.02), 0.6)

def grime(out, rng, k=0.25):
    n = noise(rng, 8)
    return out * (1 - k + k * n[..., None]) * np.array([1.0, 0.97, 0.9], np.float32)

def regions(uvpath):
    u = np.asarray(Image.open(uvpath).convert('RGB').resize((S, S), Image.NEAREST))
    return u[..., 0].astype(np.int32), u[..., 1].astype(np.int32), u[..., 2] > 0

import json
def maps3d(aid, part):
    # 每個貼圖像素在綁定姿勢下的 3D 位置（公分）與法線
    a = np.asarray(Image.open(f'{UVD}/uvpos-{aid}-{aid}_{part}.png').convert('RGB').resize((S, S), Image.NEAREST)).astype(np.float32) / 255.0
    n = np.asarray(Image.open(f'{UVD}/uvnrm-{aid}-{aid}_{part}.png').convert('RGB').resize((S, S), Image.NEAREST)).astype(np.float32) / 255.0 * 2 - 1
    cov = a.sum(-1) > 0
    # 8 位元的位置有 0.5 公分的階梯：在 UV 島內做加權模糊，讓位置變平滑（傷口線條才不會斷斷續續）
    c = cov.astype(np.float32)
    def box(x, r):
        # 用累加和做的方框模糊（做三次接近高斯）
        for axis in (0, 1):
            cs = np.cumsum(np.pad(x, [(r + 1, r) if k == axis else (0, 0) for k in (0, 1)], mode='edge'), axis=axis)
            x = (np.take(cs, range(2 * r + 1, cs.shape[axis]), axis=axis) - np.take(cs, range(0, cs.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
        return x
    def img(x):
        for _ in range(3): x = box(x, 2)
        return x
    def smooth(ch):
        num = img(ch * c); den = img(c)
        return np.where(den > 1e-3, num / np.maximum(den, 1e-3), ch)
    a = np.stack([smooth(a[..., k]) for k in range(3)], -1)
    pos = np.stack([a[..., 0] * 140 - 70, a[..., 1] * 185, a[..., 2] * 50 - 25], -1)
    return pos, n, cov

def dist_polyline(px, py, pts):
    # 平面上每個像素到折線的距離（公分）與沿線的位置（公分）
    best = np.full(px.shape, 1e9, np.float32); along = np.zeros(px.shape, np.float32); acc = 0.0
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        dx, dy = x1 - x0, y1 - y0; L2 = dx * dx + dy * dy; L = math.sqrt(L2)
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1)
        d = np.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
        m = d < best
        best = np.where(m, d, best); along = np.where(m, acc + t * L, along)
        acc += L
    return best, along

def wound3d(out, d, mask, w=0.35):
    # d：每個像素到傷口中線的距離（公分）。平滑過渡，不會有鋸齒
    edge = np.clip(1 - d / (w * 3.5), 0, 1) ** 1.5 * mask
    core = np.clip(1 - d / w, 0, 1) * mask
    crust = np.clip(1 - d / (w * 1.8), 0, 1) * mask
    out = paint(out, None, blur(edge, 1.5), (0.58, 0.28, 0.33), 0.6)       # 紅腫發紫的邊
    out = paint(out, None, crust, (0.3, 0.05, 0.05), 0.85)                   # 乾掉的血痂
    out = paint(out, None, core, (0.1, 0.0, 0.01), 0.95)                     # 裂開的深處
    return out

def bones(aid):
    return json.load(open(f'{UVD}/bones-{aid}.json'))

def process_body(aid, rng):
    sub, parts = SRC[aid]
    tex = f'{AV}/{sub}/Textures/{aid}_body_color.tga'
    c = load(tex)
    code, face, cover = regions(f'{UVD}/uv-{aid}-{aid}_body.png')
    sm = skin_mask(c)
    # 屍斑只在軀幹與大腿的背面（手臂在綁定姿勢的「背面」其實是外側，不該變紫）
    back = ((face == 0) & cover & np.isin(code, [10, 20, 30, 40, 130, 160])).astype(np.float32)
    out = corpse_skin(c, sm, rng, back)
    cloth = cover & (sm < 0.3)
    out = grime(out, rng, 0.3)
    out = bruises(out, sm, rng, 10)
    # 手腕的割痕（內側，跟前臂垂直的幾道）
    pos, nrm, cov3 = maps3d(aid, 'body')
    B = bones(aid)
    for side in ('L', 'R'):
        h = np.array(B[side + '_Hand']); f = np.array(B[side + '_Forearm'])
        axis = (h - f) / np.linalg.norm(h - f)
        rel = pos - h
        t = (rel * axis).sum(-1)                       # 沿前臂的距離（負的是往手肘）
        radial = np.linalg.norm(rel - t[..., None] * axis, axis=-1)
        inner = (nrm[..., 0] * (-1 if side == 'L' else 1)) > -0.1
        msk = ((radial < 4.6) & inner & cov3 & (sm > 0.3)).astype(np.float32)
        msk = blur(msk, 1.5)
        for k in range(rng.integers(2, 4)):
            off = -3.5 - k * 1.6 + rng.uniform(-0.3, 0.3)
            out = wound3d(out, np.abs(t - off), msk, 0.33)
        drip = (t > -9) & (t < -2) & (radial < 4.8) & inner & cov3 & (noise(rng, 60, 2) > 0.62)
        out = paint(out, None, blur(drip.astype(np.float32), 1.2), (0.24, 0.02, 0.02), 0.8)
    if aid == 'm021':
        # 胸前的 Y 字解剖切口與粗糙的縫線（用 3D 位置畫，肩膀→胸骨→肚臍下）
        front = (nrm[..., 2] > 0.25) & cov3
        nk = B['Neck'][1]; pel = B['Pelvis'][1]
        ster_y = nk - 22; bot_y = pel + 6
        pts = [(15, nk - 8), (0, ster_y), (-15, nk - 8)]
        d1, a1 = dist_polyline(pos[..., 0], pos[..., 1], pts)
        d2, a2 = dist_polyline(pos[..., 0], pos[..., 1], [(0, ster_y), (0, bot_y)])
        d = np.minimum(d1, d2)
        fm = blur(front.astype(np.float32), 1.5)
        out = wound3d(out, d, fm, 0.4)
        # 縫線：沿切口每 1.8 公分一針，橫跨切口 ±1.2 公分的黑線
        along = np.where(d1 < d2, a1, a2 + 100)
        ph = np.abs(((along + 0.9) % 1.8) - 0.9)
        st = np.clip(1 - ph / 0.16, 0, 1) * np.clip(1 - d / 1.3, 0, 1) * fm
        out = paint(out, None, st, (0.05, 0.04, 0.05), 0.95)
    # 隨機的割傷與血跡（皮膚上）
    ys, xs = np.nonzero((sm > 0.6) & (code != 90) & (code != 120))
    for _ in range(6):
        k = rng.integers(len(xs)); x, y = xs[k], ys[k]
        a = rng.uniform(0, 6.28); L = rng.uniform(15, 45)
        pts = [(x + math.cos(a) * L * t + rng.uniform(-3, 3), y + math.sin(a) * L * t + rng.uniform(-3, 3)) for t in np.linspace(-1, 1, 6)]
        out = cut(out, pts, rng.uniform(1.5, 3), rng, 0.7)
    for _ in range(4 if aid == 'm021' else 8):
        k = rng.integers(len(xs)); out = splatter(out, xs[k], ys[k], rng.uniform(3, 8), rng, mask=cover.astype(np.float32))
    if aid == 'm162':
        # 肚子上的幾個刺傷，血把手術服整片染黑
        front = (nrm[..., 2] > 0.3) & cov3
        for (x, y) in [(4, B['Spine1'][1] - 2), (-6, B['Spine'][1] + 3), (2, B['Spine2'][1] - 9)]:
            d = np.hypot(pos[..., 0] - x, pos[..., 1] - y)
            out = paint(out, None, blur(((d < 1.2) & front).astype(np.float32), 1), (0.08, 0.0, 0.01), 0.95)
            out = paint(out, None, blur(((d < 9) & front).astype(np.float32), 6) * (0.6 + 0.4 * noise(rng, 20)), (0.22, 0.02, 0.02), 0.8)
    # 衣服：泡過血、髒污
    out = soak(out, cloth, rng, 0.62 if aid != 'm021' else 0.3)
    # 胸腹前面大片噴濺
    ys, xs = np.nonzero(np.isin(code, [20, 30, 40]) & (face == 255))
    for _ in range(4 if len(xs) and aid != 'm021' else 0):
        k = rng.integers(len(xs)); out = splatter(out, xs[k], ys[k], rng.uniform(8, 16), rng, mask=cover.astype(np.float32))
    out = grime(out, rng, 0.15)
    return out

def process_head(aid, rng):
    sub, parts = SRC[aid]
    c = load(f'{AV}/{sub}/Textures/{aid}_head_color.tga')
    code, face, cover = regions(f'{UVD}/uv-{aid}-{aid}_head.png')
    sm = skin_mask(c)
    out = corpse_skin(c, sm, rng)
    P = lambda x, y: (x * S, y * S)
    # 凹陷發黑的眼窩
    for ex in (0.415, 0.562):
        m = draw_mask(lambda d: d.ellipse([ex * S - 46, 0.278 * S - 30, ex * S + 46, 0.278 * S + 34], fill=255))
        out = paint(out, None, blur(m, 16), (0.2, 0.1, 0.16), 0.75)
    # 發紫的嘴唇
    m = draw_mask(lambda d: d.ellipse([0.495 * S - 48, 0.405 * S - 16, 0.495 * S + 48, 0.405 * S + 18], fill=255))
    lips = blur(m, 6) * np.clip((c[..., 0] - c[..., 2]) * 3, 0, 1)
    out = paint(out, None, lips, (0.32, 0.22, 0.33), 0.75)
    # 口鼻流出的血，往下巴、脖子流
    for (x0, y0, n, w) in [(0.475, 0.425, 3, 3.5), (0.52, 0.43, 2, 3), (0.483, 0.36, 2, 2.5), (0.503, 0.36, 1, 2.2)]:
        for _ in range(n):
            x, y = x0 * S + rng.uniform(-6, 6), y0 * S
            pts = [(x, y)]
            for k in range(8):
                x += rng.uniform(-3, 3); y += rng.uniform(10, 26); pts.append((x, y))
            m = draw_mask(lambda d: d.line(pts, fill=255, width=int(w)))
            out = paint(out, None, blur(m, 1.0), (0.22, 0.01, 0.015), 0.9)
    # 脖子上一圈勒痕（頭部貼圖包含脖子）
    pos, nrm, cov3 = maps3d(aid, 'head')
    nk = bones(aid)['Neck'][1]
    band = np.abs(pos[..., 1] - (nk + 3)) < 1.2
    out = paint(out, None, blur((band & cov3).astype(np.float32), 2) * (0.6 + 0.5 * noise(rng, 30)), (0.32, 0.12, 0.22), 0.7)
    # 太陽穴的傷口與瘀青
    out = bruises(out, sm, rng, 4)
    out = splatter(out, 0.33 * S, 0.2 * S, 22, rng, alpha=0.8)
    out = cut(out, [P(0.3, 0.17), P(0.33, 0.21), P(0.35, 0.26)], 3, rng)
    # 混濁的眼球
    eye = np.zeros((S, S), np.float32); eye[int(0.82 * S):, int(0.18 * S):int(0.36 * S)] = 1
    L = lum(out)
    cloudy = np.stack([L * 0.7 + 0.3, L * 0.72 + 0.29, L * 0.7 + 0.28], -1)
    out = out * (1 - eye[..., None] * 0.75) + cloudy * eye[..., None] * 0.75
    # 嘴巴裡面更暗、帶血
    mouth = np.zeros((S, S), np.float32); mouth[int(0.6 * S):int(0.95 * S), :int(0.17 * S)] = 1
    out = out * (1 - mouth[..., None] * 0.5) + np.array([0.18, 0.02, 0.03]) * mouth[..., None] * 0.5
    # 跟身體一樣的髒污量，脖子接縫兩邊的膚色才會一致
    out = grime(out, rng, 0.3)
    out = grime(out, rng, 0.15)
    return out

def save(a, path, q=82):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(path, quality=q, optimize=True)
    print(path, os.path.getsize(path))

for aid, (sub, parts) in SRC.items():
    rng = np.random.default_rng(abs(hash(aid)) % 2 ** 31 if False else sum(map(ord, aid)) * 7919)
    save(process_body(aid, rng), f'{OUT}/{aid}_body.jpg')
    save(process_head(aid, rng), f'{OUT}/{aid}_head.jpg')
    if 'protection' in parts:
        c = load(f'{AV}/{sub}/Textures/{aid}_protection_color.tga')
        code, face, cover = regions(f'{UVD}/uv-{aid}-{aid}_protection.png')
        c = grime(c, rng, 0.3)
        c = soak(c, cover, rng, 0.35)
        for _ in range(10): c = splatter(c, rng.uniform(0, S), rng.uniform(0, S * 0.75), rng.uniform(6, 18), rng)
        save(c, f'{OUT}/{aid}_protection.jpg')
    if 'opacity' in parts:
        im = Image.open(f'{AV}/{sub}/Textures/{aid}_opacity_color.tga').convert('RGBA').resize((512, 512), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32) / 255.0
        rgb = a[..., :3] * 0.55  # 頭髮變暗、髒
        out = np.concatenate([rgb, a[..., 3:]], -1)
        p = f'{OUT}/{aid}_opacity.webp'
        Image.fromarray((out * 255).astype(np.uint8)).save(p, 'WEBP', quality=85, method=6); print(p, os.path.getsize(p))

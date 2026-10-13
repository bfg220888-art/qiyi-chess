# 把 Rocketbox 護理師貼圖處理成女鬼：死白發青的皮膚、凹陷發黑的眼窩、
# 混濁的死人眼、發紫的嘴唇、血管、血淚；制服泛黃並沾滿血跡。
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
import random, math, sys, os
random.seed(707)
np.random.seed(707)
# 用法：python3 horror_tex.py <Medical_Female_01/Textures 資料夾> <輸出資料夾>
SRC = os.path.join(sys.argv[1], '') if len(sys.argv) > 1 else './Textures/'
OUT = os.path.join(sys.argv[2], '') if len(sys.argv) > 2 else './out/'
os.makedirs(OUT, exist_ok=True)

def load(n):
    return np.asarray(Image.open(SRC + n + '.tga').convert('RGB')).astype(np.float32) / 255.0

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def radial(H, W, cx, cy, rx, ry):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    return np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)

def blur(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0

def noise(H, W, scale, octaves=4):
    out = np.zeros((H, W), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale * (2 ** o)))
        small = np.random.rand(s, s).astype(np.float32)
        big = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32) / 255
        out += big * amp
        tot += amp
        amp *= 0.5
    return out / tot

def skin_mask(img):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    lum = img.mean(axis=2)
    mx, mn = img.max(axis=2), img.min(axis=2)
    sat = (mx - mn) / (mx + 1e-4)
    # 膚色：偏紅黃、不會太暗（頭髮）
    m = smooth(0.07, 0.2, lum) * smooth(0.06, 0.16, sat) * (r > g * 0.98) * (g >= b * 0.8)
    return m.astype(np.float32)

def deathly(img, mask, amount=1.0):
    lum = (img * np.array([0.3, 0.59, 0.11])).sum(axis=2, keepdims=True)
    # 保留照片的明暗與毛孔：亮度只做溫和的提升與對比
    pale = 0.07 + lum * 1.08
    grey = np.concatenate([pale * 0.88, pale * 0.93, pale * 0.98], axis=2)
    out = img * 0.22 + grey * 0.78
    m = mask[..., None] * amount
    return img * (1 - m) + out * m

def draw_veins(H, W, region, n, color, width=(1, 3), seed=1):
    rnd = random.Random(seed)
    layer = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = region
    for _ in range(n):
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        ang = rnd.uniform(0, math.tau)
        w = rnd.uniform(*width)
        pts = [(x, y)]
        for s in range(rnd.randint(8, 22)):
            ang += rnd.uniform(-0.55, 0.55)
            step = rnd.uniform(6, 16) * (W / 2048)
            x += math.cos(ang) * step
            y += math.sin(ang) * step
            pts.append((x, y))
            if rnd.random() < 0.18:
                bx, by, ba = x, y, ang + rnd.choice([-1, 1]) * rnd.uniform(0.5, 1.1)
                bp = [(bx, by)]
                for k in range(rnd.randint(3, 8)):
                    ba += rnd.uniform(-0.5, 0.5)
                    bx += math.cos(ba) * step * 0.8
                    by += math.sin(ba) * step * 0.8
                    bp.append((bx, by))
                d.line(bp, fill=int(150 * rnd.uniform(0.5, 1)), width=max(1, int(w * 0.6)))
        d.line(pts, fill=int(200 * rnd.uniform(0.6, 1)), width=int(w))
    a = np.asarray(layer.filter(ImageFilter.GaussianBlur(1.2 * W / 2048))).astype(np.float32) / 255
    return a

def blood_streaks(H, W, starts, length, width, seed=3):
    rnd = random.Random(seed)
    layer = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(layer)
    for (sx, sy) in starts:
        for k in range(rnd.randint(2, 4)):
            x, y = sx + rnd.uniform(-12, 12), sy
            w = rnd.uniform(*width)
            L = rnd.uniform(*length)
            pts = [(x, y)]
            yy = y
            while yy < y + L:
                yy += rnd.uniform(6, 14)
                x += rnd.uniform(-3, 3)
                pts.append((x, yy))
            d.line(pts, fill=int(255 * rnd.uniform(0.45, 0.9)), width=max(1, int(w)))
            if rnd.random() < 0.3:
                d.ellipse((x - w * 0.5, yy - w * 0.4, x + w * 0.5, yy + w * 0.7), fill=int(200 * rnd.uniform(0.5, 1)))
    return np.asarray(layer.filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255

# ---------------------------------------------------------------------------
# 頭部
head = load('f152_head_color')
H, W = head.shape[:2]
skin = skin_mask(head)
skin = np.maximum(skin, 0)
out = deathly(head, blur(skin, 3), 1.0)
# 斑駁：屍斑與髒污
mott = noise(H, W, 14, 4)
blot = smooth(0.7, 0.82, mott) * skin
out = out * (1 - blot[..., None] * np.array([0.14, 0.18, 0.1]))
# 眼窩凹陷：兩眼周圍暗紫黑
for (cx, cy) in [(866, 576), (1164, 576)]:
    d = radial(H, W, cx, cy, 135, 95)
    dark = (1 - smooth(0.2, 1.25, d)) ** 1.3 * 0.88
    tint = np.array([0.16, 0.12, 0.13])
    out = out * (1 - dark[..., None]) + tint * dark[..., None] * (0.5 + out.mean(axis=2, keepdims=True))
    # 下眼瞼的紅腫
    d2 = radial(H, W, cx, cy + 38, 70, 22)
    red = (1 - smooth(0.4, 1.0, d2)) * 0.3
    out = out * (1 - red[..., None]) + np.array([0.35, 0.05, 0.06]) * red[..., None]
# 嘴唇：發紫發黑
dl = radial(H, W, 1024, 832, 105, 40)
lip = (1 - smooth(0.45, 1.0, dl)) * 0.85
out = out * (1 - lip[..., None]) + np.array([0.22, 0.14, 0.22]) * lip[..., None]
# 血管（太陽穴、額頭、臉頰、脖子）
veins = np.zeros((H, W), np.float32)
for i, reg in enumerate([(600, 330, 780, 620), (1250, 330, 1440, 620), (820, 260, 1230, 420), (650, 700, 860, 980), (1180, 700, 1400, 980), (760, 1050, 1290, 1420)]):
    veins = np.maximum(veins, draw_veins(H, W, reg, 4, None, (2, 4), seed=10 + i))
veins = blur(veins, 3.5) * blur(skin, 4)
vl = out.mean(axis=2, keepdims=True)
out = out * (1 - veins[..., None] * 0.42) + np.array([0.3, 0.36, 0.5]) * vl * veins[..., None] * 0.42
# 血淚與嘴角流血
bl = blood_streaks(H, W, [(852, 612), (1158, 612)], (120, 330), (2.5, 5), seed=5)
bl = np.maximum(bl, blood_streaks(H, W, [(950, 852), (1100, 852)], (70, 200), (3, 6), seed=7))
bl = blur(bl, 1.5)
out = out * (1 - bl[..., None] * 0.85) + np.array([0.19, 0.03, 0.025]) * bl[..., None] * 0.85
# 頭髮：接近黑色（只動頭皮上暗、低飽和的區域）
lumh = head.mean(axis=2)
hair = (1 - skin) * smooth(0.02, 0.06, lumh) * (1 - smooth(0.25, 0.4, lumh))
hair[1200:, :] *= 0  # 下方是眼球、口腔與髮髻貼圖
out = out * (1 - hair[..., None] * 0.55)
# 眼球：混濁的灰白色死人眼，細小的瞳孔，充血的鞏膜
ex, ey = 541, 1909
de = radial(H, W, ex, ey, 1, 1)
eyeball = de < 118
iris = de < 40
cloud = np.clip(1 - de / 40, 0, 1)
ev = out.copy()
lum = ev.mean(axis=2, keepdims=True)
# 鞏膜偏黃灰
scl = np.concatenate([lum * 0.95 + 0.04, lum * 0.9 + 0.03, lum * 0.78], axis=2)
ev = np.where(eyeball[..., None], scl, ev)
# 虹膜被白翳覆蓋
milky = np.array([0.80, 0.82, 0.84])
irisc = milky * (0.75 + 0.25 * noise(H, W, 40, 2)[..., None])
ev = np.where(iris[..., None], irisc * (0.92 - 0.25 * cloud[..., None] * 0.2), ev)
pupil = de < 7
ev = np.where(pupil[..., None], np.array([0.12, 0.12, 0.13]), ev)
eveins = draw_veins(H, W, (ex - 110, ey - 110, ex + 110, ey + 110), 16, None, (1, 2.5), seed=99) * (eyeball & ~iris)
ev = ev * (1 - eveins[..., None] * 0.7) + np.array([0.55, 0.05, 0.05]) * eveins[..., None] * 0.7
out = ev
# 口腔：牙齒發黃發灰、牙齦發黑
mr = out[1250:1900, 0:330]
ml = mr.mean(axis=2, keepdims=True)
teeth = smooth(0.45, 0.6, ml[..., 0])[..., None]
mr2 = mr * 0.35 * (1 - teeth) + teeth * np.concatenate([ml * 0.75, ml * 0.68, ml * 0.5], axis=2)
out[1250:1900, 0:330] = mr2
out = np.clip(out, 0, 1)
Image.fromarray((out * 255).astype(np.uint8)).save(OUT + 'ghost_head.jpg', quality=88)
Image.fromarray((out * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(OUT + 'ghost_head_1k.jpg', quality=88)

# 頭部法線與粗糙度
n = Image.open(SRC + 'f152_head_normal.tga').convert('RGB').resize((1024, 1024), Image.LANCZOS)
n.save(OUT + 'ghost_head_n.jpg', quality=92)
spec = load('f152_head_specular').mean(axis=2)
rough = np.clip(0.78 - spec * 0.55, 0.25, 0.95)
# 眼球與嘴唇比較濕亮
rough = np.where(eyeball, 0.12, rough)
Image.fromarray((rough * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(OUT + 'ghost_head_r.jpg', quality=90)

# ---------------------------------------------------------------------------
# 身體：手臂皮膚死白、制服泛黃髒污、大片血跡
body = load('f152_body_color')
H, W = body.shape[:2]
skinb = skin_mask(body)
outb = deathly(body, blur(skinb, 3), 1.0)
# 手腕瘀青
for (cx, cy) in [(300, 360), (1748, 360), (130, 820), (1918, 820)]:
    d = radial(H, W, cx, cy, 160, 120)
    br = (1 - smooth(0.2, 1.0, d)) * 0.45 * skinb
    outb = outb * (1 - br[..., None]) + np.array([0.26, 0.18, 0.3]) * br[..., None]
cloth = (1 - blur(skinb, 2)) * (body.mean(axis=2) > 0.12)
lum = outb.mean(axis=2, keepdims=True)
yellow = np.concatenate([lum * 0.93, lum * 0.91, lum * 0.84], axis=2)
dirt = noise(H, W, 5, 5)
grime = smooth(0.35, 0.8, dirt)[..., None] * 0.45
c2 = yellow * (1 - grime) + np.array([0.28, 0.24, 0.17]) * grime
outb = outb * (1 - cloth[..., None]) + c2 * cloth[..., None]
# 大片血跡（胸前、下襬、袖口、褲子）
blood = np.zeros((H, W), np.float32)
rnd = random.Random(13)
for (cx, cy, r) in [(1030, 760, 200), (880, 1350, 240), (1180, 1500, 190), (300, 1500, 220), (1750, 1650, 200), (1060, 1100, 150), (560, 830, 120), (1490, 830, 120)]:
    d = radial(H, W, cx, cy, r, r * rnd.uniform(0.7, 1.3))
    shape = (1 - smooth(0.4, 1.0, d + (noise(H, W, 18, 3) - 0.5) * 0.9))
    blood = np.maximum(blood, shape)
drips = blood_streaks(H, W, [(rnd.uniform(800, 1250), rnd.uniform(800, 1300)) for _ in range(10)], (150, 420), (8, 18), seed=21)
blood = np.maximum(blood, drips)
blood *= cloth
old = noise(H, W, 30, 2)
bc = np.array([0.28, 0.03, 0.025]) * (0.65 + 0.5 * old[..., None])
outb = outb * (1 - blood[..., None] * 0.9) + bc * blood[..., None] * 0.9
outb = np.clip(outb, 0, 1)
Image.fromarray((outb * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(OUT + 'ghost_body.jpg', quality=86)
Image.open(SRC + 'f152_body_normal.tga').convert('RGB').resize((1024, 1024), Image.LANCZOS).save(OUT + 'ghost_body_n.jpg', quality=90)
# 睫毛（透明貼圖）
op = Image.open(SRC + 'f152_opacity_color.tga').convert('RGBA').resize((512, 512), Image.LANCZOS)
op.save(OUT + 'ghost_lashes.png', optimize=True)
print('done')

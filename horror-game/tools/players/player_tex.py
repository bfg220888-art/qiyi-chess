#!/usr/bin/env python3
"""把 Rocketbox 的 TGA 貼圖轉成遊戲用的小檔案，並產生上衣染色用的遮罩。

用法：python3 player_tex.py <rocketbox/Assets/Avatars/Adults> <輸出資料夾> [預覽資料夾]

輸出（每個人物）：
  <id>_body.jpg     身體 1024（衣服、手、鞋）
  <id>_head.jpg     頭 512
  <id>_mask.png     256 灰階：上衣的位置（遊戲依玩家編號把上衣染成不同顏色）
  f008_opacity.webp 女生的髮絲（含透明度）512
需要 numpy 與 Pillow。
"""
import sys
import os
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1]
OUT = sys.argv[2]
PREV = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)

AVATARS = {
    # id: (資料夾, 不要染色的矩形區域（0..1 的貼圖座標，左上原點）)
    'm023': ('Male_Adult_18', [
        (0.0, 0.0, 0.30, 0.42), (0.70, 0.0, 1.0, 0.42),  # 黑長褲
        (0.0, 0.84, 0.27, 1.0), (0.73, 0.84, 1.0, 1.0),  # 手
        (0.27, 0.875, 0.73, 1.0),                        # 鞋
        (0.24, 0.72, 0.297, 0.86), (0.703, 0.72, 0.76, 0.86),  # 鞋底
    ]),
    'f008': ('Female_Adult_08', [
        (0.0, 0.0, 0.33, 1.0), (0.67, 0.0, 1.0, 1.0),    # 手臂、手、鞋、牛仔褲
        (0.33, 0.76, 0.67, 1.0),                         # 手錶
        (0.33, 0.0, 0.67, 0.012),                        # 最上緣的皮帶
    ]),
}


def load(path):
    return Image.open(path)


def drop_small(img, min_area):
    """去掉面積太小的區塊（例如鞋底）：逐一用油漆桶標記連通區域再計算面積。"""
    from PIL import ImageDraw
    img = img.copy()
    a = np.asarray(img)
    while True:
        ys, xs = np.nonzero(a == 255)
        if len(ys) == 0:
            break
        ImageDraw.floodfill(img, (int(xs[0]), int(ys[0])), 128)
        a = np.asarray(img)
        area = int((a == 128).sum())
        ImageDraw.floodfill(img, (int(xs[0]), int(ys[0])), 254 if area >= min_area else 0)
        a = np.asarray(img)
    return img.point(lambda v: 255 if v == 254 else 0)


def garment_mask(rgb, exclude):
    a = np.asarray(rgb.convert('RGB'), dtype=np.float32) / 255.0
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    # 灰色布料：彩度低、不是全黑也不是全白
    m = (sat < 0.2) & (mx > 0.16) & (mx < 0.92)
    h, w = m.shape
    for x0, y0, x1, y1 in exclude:
        m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = False
    img = Image.fromarray((m * 255).astype(np.uint8), 'L').resize((512, 512), Image.BILINEAR).point(lambda v: 255 if v > 127 else 0)
    # 開運算去掉細線（鞋底的白邊、鞋帶），閉運算補洞，再縮小、柔化邊緣
    img = img.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    img = img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    img = drop_small(img, 3000)
    img = img.resize((256, 256), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.7))
    return img


for aid, (folder, exclude) in AVATARS.items():
    tex = os.path.join(SRC, folder, 'Textures')
    body = load(os.path.join(tex, f'{aid}_body_color.tga')).convert('RGB')
    head = load(os.path.join(tex, f'{aid}_head_color.tga')).convert('RGB')
    body.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, f'{aid}_body.jpg'), quality=80, optimize=True, progressive=True)
    head.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'{aid}_head.jpg'), quality=82, optimize=True, progressive=True)
    mask = garment_mask(body, exclude)
    mask.save(os.path.join(OUT, f'{aid}_mask.png'), optimize=True)
    if PREV:
        os.makedirs(PREV, exist_ok=True)
        small = body.resize((512, 512))
        tint = Image.new('RGB', (512, 512), (255, 0, 0))
        Image.composite(tint, small, mask.resize((512, 512)).point(lambda v: v * 0.6)).save(os.path.join(PREV, f'{aid}_maskprev.png'))
    op = os.path.join(tex, f'{aid}_opacity_color.tga')
    if os.path.exists(op):
        o = load(op).convert('RGBA').resize((512, 512), Image.LANCZOS)
        o.save(os.path.join(OUT, f'{aid}_opacity.webp'), quality=80, method=6)

for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))

#!/usr/bin/env python3
# 紙條與察覺提示用的毛筆字型子集（SIL OFL 1.1 的 Google Fonts 字型）。
# 只留下 tools/fonts/charset.mjs 列出的字（紙條、遺物、樓層 / 房間名稱、牆上的字、察覺提示），輸出成 woff2：
#   assets/fonts/brush-boku.woff2   主要：Yuji Boku（粗獷的毛筆字；日文字型，大部分繁體字都有）
#   assets/fonts/brush-msz.woff2    Yuji Boku 沒有的字（她、你、跑、躲……）：Ma Shan Zheng（毛筆楷書）
#   assets/fonts/brush-wk.woff2     兩個都沒有的繁體字（說、產、絕、辦……）：LXGW WenKai TC Bold（楷書）
# 並產生 src/brush-ranges.js（每個檔案負責哪些字，給 FontFace 的 unicodeRange 用）。
#
# 需要：pip install fonttools brotli；Node（讀字集）。原始字型從 Google Fonts 下載：
#   https://fonts.google.com/specimen/Yuji+Boku
#   https://fonts.google.com/specimen/Ma+Shan+Zheng
#   https://fonts.google.com/specimen/LXGW+WenKai+TC（Bold）
# 用法（在 horror-game/ 底下）：
#   python3 tools/fonts/subset.py YujiBoku-Regular.ttf MaShanZheng-Regular.ttf LXGWWenKaiTC-Bold.ttf
# 改了紙條的文字之後重跑這一行；tests/font.test.mjs 會檢查有沒有字沒涵蓋到。
import os
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'fonts')
NAMES = ['boku', 'msz', 'wk']
DIGITS = '0123456789'


def main():
    if len(sys.argv) != 4:
        print(__doc__ or '用法：subset.py <Yuji Boku> <Ma Shan Zheng> <LXGW WenKai TC Bold>')
        sys.exit(2)
    chars = subprocess.run(['node', os.path.join(ROOT, 'tools/fonts/charset.mjs'), '--raw'], check=True, capture_output=True, cwd=ROOT).stdout.decode('utf-8')
    todo = [c for c in dict.fromkeys(chars) if c not in ' 　\n']
    os.makedirs(OUT, exist_ok=True)
    ranges = {}
    for name, src in zip(NAMES, sys.argv[1:]):
        cmap = TTFont(src, lazy=True).getBestCmap()
        # 數字用 Ma Shan Zheng 的（Yuji Boku 的數字太細，跟毛筆字擺在一起不搭）
        skip = DIGITS if name == 'boku' else ''
        mine = [c for c in todo if ord(c) in cmap and c not in skip]
        todo = [c for c in todo if c not in mine]
        # 空白也放進主要字型（不然空白會用到下一個字型的寬度）
        text = ''.join(mine) + (' 　' if name == 'boku' else '')
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.hinting = False
        opts.desubroutinize = True
        opts.layout_features = ['kern', 'palt', 'vert']
        opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        opts.notdef_outline = False
        font = subset.load_font(src, opts)
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        out = os.path.join(OUT, f'brush-{name}.woff2')
        subset.save_font(font, out, opts)
        ranges[name] = sorted({ord(c) for c in text})
        print(f'{name}: {len(text)} 字 → {os.path.getsize(out) / 1024:.1f} KB')
    if todo:
        print('三個字型都沒有的字：', ''.join(todo))
        sys.exit(1)
    lines = ['// 由 tools/fonts/subset.py 產生，不要手動修改。毛筆字型每個子集檔案負責的字（FontFace 的 unicodeRange）',
             'export const BRUSH_RANGES = {']
    for name in NAMES:
        lines.append(f"  {name}: '{','.join('U+%X' % u for u in ranges[name])}',")
    lines.append('};')
    with open(os.path.join(ROOT, 'src', 'brush-ranges.js'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()

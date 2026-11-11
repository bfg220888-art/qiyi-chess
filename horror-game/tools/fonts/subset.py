#!/usr/bin/env python3
# 文件（紙條）與察覺提示用的字型子集（全部是 SIL OFL 1.1 的 Google Fonts 字型）。
# 只留下 tools/fonts/charset.mjs 列出的字，輸出成 woff2：
#   毛筆 SWBrush（用血寫的字、遺物說明、牆上的字、察覺提示）
#     assets/fonts/brush-boku.woff2   主要：Yuji Boku（粗獷的毛筆字；日文字型，大部分繁體字都有）
#     assets/fonts/brush-msz.woff2    Yuji Boku 沒有的字（她、你、跑、躲……）：Ma Shan Zheng（毛筆楷書）
#     assets/fonts/brush-wk.woff2     兩個都沒有的繁體字（說、產、絕、辦……）：LXGW WenKai TC Bold（楷書）
#   手寫 SWPen（文件裡手寫的部分）
#     assets/fonts/pen-iansui.woff2   Iansui 芫荽（台灣教育部標準字形的手寫體）
#   鉛字 SWPrint（表單、公文、剪報、印章；手寫字型沒有的字也放這裡）
#     assets/fonts/print-serif.woff2  Noto Serif TC（可變字型，先取子集再固定在字重 600）
# 並產生 src/brush-ranges.js（每個檔案負責哪些字，給 FontFace 的 unicodeRange 用）。
#
# 需要：pip install fonttools brotli；Node（讀字集）。原始字型從 Google Fonts 下載
# （fonts.google.com 的各字型頁面，或 google/fonts 儲存庫的 ofl/ 底下）：
#   Yuji Boku、Ma Shan Zheng、LXGW WenKai TC（Bold）、Iansui、Noto Serif TC
# 用法（在 horror-game/ 底下）：
#   python3 tools/fonts/subset.py YujiBoku-Regular.ttf MaShanZheng-Regular.ttf LXGWWenKaiTC-Bold.ttf Iansui-Regular.ttf "NotoSerifTC[wght].ttf"
# 改了文件的文字之後重跑這一行；tests/font.test.mjs 會檢查有沒有字沒涵蓋到。
import os
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'fonts')
DIGITS = '0123456789'
PRINT_WEIGHT = 600


def charset(name):
    raw = subprocess.run(['node', os.path.join(ROOT, 'tools/fonts/charset.mjs'), '--raw', name], check=True, capture_output=True, cwd=ROOT).stdout.decode('utf-8')
    return [c for c in dict.fromkeys(raw) if c not in ' 　\n']


def write(src, text, out, weight=None):
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
    if weight is not None and 'fvar' in font:
        font = instancer.instantiateVariableFont(font, {'wght': weight})
    subset.save_font(font, out, opts)
    print(f'{os.path.basename(out)}: {len(text)} 字 → {os.path.getsize(out) / 1024:.1f} KB')


def chain(todo, names, srcs, first_skip=''):
    """照順序把字分給每個字型（前面的字型有就用前面的）；回傳 ({檔名: (來源, 字)}, 沒有任何字型有的字)"""
    ranges = {}
    for i, (name, src) in enumerate(zip(names, srcs)):
        cmap = TTFont(src, lazy=True).getBestCmap()
        skip = first_skip if i == 0 else ''
        mine = [c for c in todo if ord(c) in cmap and c not in skip]
        todo = [c for c in todo if c not in mine]
        # 空白也放進主要字型（不然空白會用到下一個字型的寬度）
        text = ''.join(mine) + (' 　' if i == 0 else '')
        ranges[name] = (src, text)
    return ranges, todo


def main():
    if len(sys.argv) != 6:
        print('用法：subset.py <Yuji Boku> <Ma Shan Zheng> <LXGW WenKai TC Bold> <Iansui> <Noto Serif TC>')
        sys.exit(2)
    boku, msz, wk, iansui, serif = sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    # 毛筆：數字用 Ma Shan Zheng 的（Yuji Boku 的數字太細，跟毛筆字擺在一起不搭）
    brush, left = chain(charset('brush'), ['boku', 'msz', 'wk'], [boku, msz, wk], DIGITS)
    if left:
        print('三個毛筆字型都沒有的字：', ''.join(left))
        sys.exit(1)
    # 手寫：Iansui 沒有的字交給鉛字
    pen, pen_left = chain(charset('pen'), ['iansui'], [iansui])
    prt, left = chain(list(dict.fromkeys(charset('print') + pen_left)), ['serif'], [serif])
    if left:
        print('手寫與鉛字字型都沒有的字：', ''.join(left))
        sys.exit(1)
    if pen_left:
        print('Iansui 沒有、改用鉛字的字：', ''.join(pen_left))
    out = {}
    for prefix, group, weight in [('brush', brush, None), ('pen', pen, None), ('print', prt, PRINT_WEIGHT)]:
        out[prefix] = {}
        for name, (src, text) in group.items():
            write(src, text, os.path.join(OUT, f'{prefix}-{name}.woff2'), weight)
            out[prefix][name] = sorted({ord(c) for c in text})
    lines = ['// 由 tools/fonts/subset.py 產生，不要手動修改。每個字型子集檔案負責的字（FontFace 的 unicodeRange）']
    for prefix in ['brush', 'pen', 'print']:
        lines.append(f'export const {prefix.upper()}_RANGES = {{')
        for name, us in out[prefix].items():
            lines.append(f"  {name}: '{','.join('U+%X' % u for u in us)}',")
        lines.append('};')
    with open(os.path.join(ROOT, 'src', 'brush-ranges.js'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()

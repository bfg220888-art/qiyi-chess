// 文件與毛筆字型子集的涵蓋測試：畫面上用到的每一個字都必須在對應的字型子集裡（不然會退回系統字型，混在一起很難看）：
//   SWBrush 毛筆（assets/fonts/brush-*.woff2）：文件上的血字、遺物說明（含填進去的樓層 / 房間名稱）、牆上的血字、察覺提示
//   SWPen   手寫（pen-*.woff2，沒有的字由 SWPrint 補）：文件裡手寫的部分（含老陳紙條裡換成樓層名稱的那一句）
//   SWPrint 鉛字（print-*.woff2）：文件裡印刷的部分、印章
// 失敗時：重跑 tools/fonts/subset.py（說明在檔案開頭）。
//   node tests/font.test.mjs
import { readFileSync, statSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELICS, WALL_WRITINGS, generateHospital } from '../src/level.js';
import { DOCS, docTree, treeChars } from '../src/docs.js';
import { THEMES, THEME_KEYS, themeTitle } from '../src/themes.js';
import { DIFFICULTY } from '../src/config.js';
import { BRUSH_RANGES, PEN_RANGES, PRINT_RANGES } from '../src/brush-ranges.js';
import { brushChars, penChars, printChars, BRUSH_STRINGS } from '../tools/fonts/charset.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const assert = (c, msg) => { if (!c) { fails++; console.log('✗', msg); } };

// ---- 讀 WOFF2 的 cmap（Unicode → 字形）：表格目錄 + 一整段 brotli 壓縮的表格資料
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function woff2Cmap(buf) {
  assert(buf.toString('latin1', 0, 4) === 'wOF2', 'woff2 signature');
  const numTables = buf.readUInt16BE(12);
  let p = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error('bad UIntBase128'); };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++];
    const tag = (flags & 0x3f) === 63 ? buf.toString('latin1', p, (p += 4)) : KNOWN[flags & 0x3f];
    const ver = flags >> 6;
    const orig = base128();
    // glyf / loca：版本 0 = 有轉換；其他表格：版本 0 = 沒轉換
    const transformed = (tag === 'glyf' || tag === 'loca') ? ver === 0 : ver !== 0;
    const len = transformed ? base128() : orig;
    tables.push({ tag, len });
  }
  const comp = buf.readUInt32BE(20);
  const data = brotliDecompressSync(buf.subarray(p, p + comp));
  let off = 0;
  for (const t of tables) { t.off = off; off += t.len; }
  const cm = tables.find((t) => t.tag === 'cmap');
  const c = data.subarray(cm.off, cm.off + cm.len);
  const set = new Set();
  const n = c.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const so = c.readUInt32BE(4 + i * 8 + 4), fmt = c.readUInt16BE(so);
    if (fmt === 4) {
      const segX2 = c.readUInt16BE(so + 6), ends = so + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ro = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = c.readUInt16BE(ends + s * 2), start = c.readUInt16BE(starts + s * 2), delta = c.readInt16BE(deltas + s * 2), rOff = c.readUInt16BE(ro + s * 2);
        for (let u = start; u <= end && u !== 0xffff; u++) {
          const gid = rOff ? c.readUInt16BE(ro + s * 2 + rOff + (u - start) * 2) : (u + delta) & 0xffff;
          if (gid) set.add(u);
        }
      }
    } else if (fmt === 12) {
      const groups = c.readUInt32BE(so + 12);
      for (let gI = 0; gI < groups; gI++) {
        const g0 = so + 16 + gI * 12, start = c.readUInt32BE(g0), end = c.readUInt32BE(g0 + 4), sg = c.readUInt32BE(g0 + 8);
        for (let u = start; u <= end; u++) if (sg + (u - start)) set.add(u);
      }
    }
  }
  return set;
}

let total = 0;
const sizes = [];
// 一套字型（同一個字型名稱的幾個子集檔案）實際涵蓋的字
function family(prefix, RANGES) {
  const covered = new Set();
  for (const name of Object.keys(RANGES)) {
    const f = path.join(root, `assets/fonts/${prefix}-${name}.woff2`);
    const buf = readFileSync(f);
    const size = statSync(f).size;
    total += size;
    sizes.push(`${prefix}-${name} ${(size / 1024).toFixed(1)} KB`);
    const cmap = woff2Cmap(buf);
    // unicodeRange 跟字型裡真正有的字要一致（不然瀏覽器會去用一個沒有那個字的檔案）
    const range = RANGES[name].split(',').map((r) => parseInt(r.slice(2), 16));
    const missing = range.filter((u) => !cmap.has(u) && u !== 0x20 && u !== 0x3000);
    assert(missing.length === 0, `${prefix}-${name}: unicodeRange 裡有字型沒有的字 ${missing.map((u) => String.fromCodePoint(u)).join('')}`);
    for (const u of range) if (cmap.has(u)) covered.add(u);
  }
  return covered;
}
const brush = family('brush', BRUSH_RANGES), pen = family('pen', PEN_RANGES), print = family('print', PRINT_RANGES);
const missingIn = (s, ...sets) => [...new Set([...s].filter((ch) => !/[\n 　]/.test(ch) && !sets.some((c) => c.has(ch.codePointAt(0)))))].join('');

// 1. 字集本身（tools/fonts/charset.mjs）
let m = missingIn(brushChars().join(''), brush);
assert(!m, `毛筆字集裡有字型沒有的字：${m}（重跑 tools/fonts/subset.py）`);
m = missingIn(penChars().join(''), pen, print);
assert(!m, `手寫字集裡有字型沒有的字：${m}`);
m = missingIn(printChars().join(''), print);
assert(!m, `鉛字字集裡有字型沒有的字：${m}`);

// 2. 實際顯示出來的文件：每一份文件照 ui.js 的組法（docTree）分成三套字型；老陳的紙條把每一種樓層的門牌換進去
const used = { pen: new Set(), print: new Set(), brush: new Set(), sys: new Set() };
for (const d of DOCS) treeChars(docTree(d), 'sys', used);
for (const k of THEME_KEYS) {
  const board = THEMES[k].board;
  treeChars(docTree(DOCS.find((d) => d.id === 'memo'), { rep: (x) => x.replace('發電機房在這層樓最裡面', `發電機房在${board}最裡面`) }), 'sys', used);
}
m = missingIn([...used.pen].join(''), pen, print);
assert(!m, `文件的手寫部分用到字型沒有的字：${m}`);
m = missingIn([...used.print].join(''), print);
assert(!m, `文件的印刷部分用到字型沒有的字：${m}`);
const shown = [...used.brush];
let hospitals = 0;
for (let seed = 1; seed <= 18; seed++) {
  for (const count of [1, 3]) {
    const theme = THEME_KEYS[seed % THEME_KEYS.length];
    const fl = generateHospital(seed * 7919, DIFFICULTY.normal, null, theme, count);
    hospitals++;
    const AF = fl.find((l) => l.plan.altar) || fl[0];
    const room = AF.room707;
    const where = room ? `${count > 1 ? themeTitle(AF.theme) + '的' : ''}${room.label}` : '劇情房間';
    for (const R of RELICS) shown.push(R.title, `${R.body}\n\n（搖籃在${where}。）`);
    for (const l of fl) for (const rm of l.rooms) shown.push(rm.label || '');
  }
}
shown.push(...WALL_WRITINGS, ...BRUSH_STRINGS);
m = missingIn(shown.join(''), brush);
assert(!m, `血字 / 遺物 / 房間名稱用到毛筆字型沒有的字：${m}（把字串加進 tools/fonts/charset.mjs 再重跑 tools/fonts/subset.py）`);

// 3. game.js 裡用毛筆字顯示的字串跟 charset.mjs 的 BRUSH_STRINGS 一致；ui.js / docs.js 的老陳紙條替換字串一致
const gameSrc = readFileSync(path.join(root, 'src/game.js'), 'utf8');
for (const s of ['她發現你了！', '她跟丟了', '她在追 ', '她聽到聲音了', '她在附近找你', '（搖籃在', '劇情房間', "replace('發電機房在這層樓最裡面', `發電機房在"]) assert(gameSrc.includes(s), `game.js 裡找不到「${s}」——改了提示文字就要一起改 tools/fonts/charset.mjs 與這個測試`);
assert(JSON.stringify(DOCS.find((d) => d.id === 'memo').blocks).includes('發電機房在這層樓最裡面'), '老陳的紙條還有「發電機房在這層樓最裡面」');

// 4. 大小：全部的子集加起來 600 KB 以內
assert(total < 600 * 1024, `子集總大小 ${(total / 1024).toFixed(0)} KB 應該小於 600 KB`);
console.log(`fonts: ${sizes.join(', ')}; total ${(total / 1024).toFixed(1)} KB; covered brush ${brush.size}, pen ${pen.size}, print ${print.size}; checked ${hospitals} hospitals`);
if (fails) { console.log(`${fails} 個失敗`); process.exit(1); }
console.log('✓ font coverage');

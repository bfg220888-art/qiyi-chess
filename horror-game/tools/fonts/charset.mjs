// 字型子集要涵蓋的字，分三套：
//   brush 毛筆（SWBrush）：文件上用血寫的字、遺物說明、會被填進遺物說明的樓層 / 房間名稱、牆上的血字、察覺提示
//   pen   手寫（SWPen）  ：文件裡手寫的部分（含老陳紙條裡會換成樓層名稱的那一句）
//   print 鉛字（SWPrint）：文件裡印刷 / 打字的部分、印章
// 由 tools/fonts/subset.py（產生字型）與 tests/font.test.mjs（檢查涵蓋）共用。
//   node tools/fonts/charset.mjs               印出三套字集
//   node tools/fonts/charset.mjs --raw brush   只印那一套的字（給 subset.py 用）
import { RELICS, WALL_WRITINGS, ROOM_NAMES, KEY_COLORS } from '../../src/level.js';
import { DOCS, docTree, treeChars } from '../../src/docs.js';
import { THEMES } from '../../src/themes.js';

// 程式裡直接寫出來、會用毛筆字顯示的字串（game.js 的察覺提示、拿到遺物時的附註、樓梯門牌）
// 改了 game.js 裡的這些字串，tests/font.test.mjs 會提醒你也要改這裡
export const BRUSH_STRINGS = [
  '她發現你了！', '她跟丟了', '她在追 ', '她聽到聲音了', '她在附近找你',
  '（搖籃在', '的', '劇情房間', '。）', '上樓', '下樓', '發電機房在', '最裡面',
];

// 一定要有的符號：數字、英文字母（樓層代號）、常用的全形標點
const BASE = '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:;!?-—…·・「」『』（）、。，：；！？～○×%/+#()　';

// fmt 函式（房間編號的格式，例如 `${n} 病房`）取樣板字串裡的字
function walk(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') { const m = String(v).match(/`([^`]*)`/); if (m) out.push(m[1].replace(/\$\{[^}]*\}/g, '')); }
  else if (Array.isArray(v)) for (const x of v) walk(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], out);
}

export function brushStrings() {
  const out = [BASE, ...BRUSH_STRINGS, ...WALL_WRITINGS, ...Object.values(ROOM_NAMES), ...KEY_COLORS.map((c) => c.name)];
  for (const r of RELICS) out.push(r.name, r.title, r.body);
  // THEMES 裡會被填進紙條的欄位（樓層名稱、門牌、房間名稱），不含整段介紹文字
  for (const t of Object.values(THEMES)) {
    out.push(t.name, t.floor, t.short, t.board);
    if (t.rooms) walk([t.rooms.numbered, t.rooms.special, t.rooms.names], out);
    walk(t.locked, out);
  }
  return out;
}

// 文件（src/docs.js）每一種字型用到的字
export function docChars() {
  const out = { pen: new Set(), print: new Set(), brush: new Set(), sys: new Set() };
  for (const d of DOCS) treeChars(docTree(d), 'sys', out);
  return out;
}

const sorted = (set) => [...set].filter((ch) => ch !== '\n').sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
export function brushChars() {
  const set = new Set(docChars().brush);
  for (const s of brushStrings()) for (const ch of s) set.add(ch);
  return sorted(set);
}
export function penChars() {
  const set = new Set(docChars().pen);
  // 老陳的紙條：多層樓時「這層樓」會換成發電機房那一層的門牌
  for (const t of Object.values(THEMES)) for (const ch of t.board) set.add(ch);
  for (const ch of BASE) set.add(ch);
  return sorted(set);
}
export function printChars() {
  const set = new Set(docChars().print);
  for (const ch of BASE) set.add(ch);
  return sorted(set);
}
export const fontChars = () => ({ brush: brushChars(), pen: penChars(), print: printChars() });

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = fontChars();
  const k = process.argv.indexOf('--raw');
  if (k >= 0) process.stdout.write((all[process.argv[k + 1] || 'brush'] || []).join(''));
  else for (const [name, c] of Object.entries(all)) { console.log(name, c.length, 'chars'); console.log(c.join('')); }
}

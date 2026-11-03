// 毛筆字型子集要涵蓋的字：所有紙條、遺物說明、會被填進紙條的樓層 / 房間名稱、牆上的血字、察覺提示的短訊息。
// 由 tools/fonts/subset.py（產生字型）與 tests/font.test.mjs（檢查涵蓋）共用。
//   node tools/fonts/charset.mjs          印出字集
//   node tools/fonts/charset.mjs --raw    只印字（給 pyftsubset --text-file 用）
import { NOTES, RELICS, WALL_WRITINGS, ROOM_NAMES, KEY_COLORS } from '../../src/level.js';
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
  for (const n of NOTES) out.push(n.title, n.body);
  for (const r of RELICS) out.push(r.name, r.title, r.body);
  // THEMES 裡會被填進紙條的欄位（樓層名稱、門牌、房間名稱），不含整段介紹文字
  for (const t of Object.values(THEMES)) {
    out.push(t.name, t.floor, t.short, t.board);
    if (t.rooms) walk([t.rooms.numbered, t.rooms.special, t.rooms.names], out);
    walk(t.locked, out);
  }
  return out;
}

export function brushChars() {
  const set = new Set();
  for (const s of brushStrings()) for (const ch of s) if (ch !== '\n') set.add(ch);
  return [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = brushChars();
  if (process.argv.includes('--raw')) process.stdout.write(c.join(''));
  else { console.log(c.length, 'chars'); console.log(c.join('')); }
}

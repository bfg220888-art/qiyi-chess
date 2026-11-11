// 文件與察覺提示的字型：三套各自的字型名稱，每個子集檔案只負責自己的字（unicodeRange），瀏覽器會逐字挑檔案。
//   SWBrush 毛筆（用血寫的字、遺物說明、察覺提示）、SWPen 手寫、SWPrint 鉛字（表單、公文、剪報、印章）
// 子集由 tools/fonts/subset.py 產生；字型沒載入或某個字不在子集裡（例如玩家名字）
// 就照 CSS 的 font-family 往後退到一般的明體 / 黑體，不會變成方塊。
import { assetBuffer } from './assets.js';
import { BRUSH_RANGES, PEN_RANGES, PRINT_RANGES } from './brush-ranges.js';

export const BRUSH_FAMILY = 'SWBrush';
export const DOC_FONTS = [['SWBrush', 'brush', BRUSH_RANGES], ['SWPen', 'pen', PEN_RANGES], ['SWPrint', 'print', PRINT_RANGES]];
let loading = null;

export function loadBrushFont() {
  if (loading) return loading;
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return (loading = Promise.resolve(false));
  const jobs = [];
  for (const [family, prefix, ranges] of DOC_FONTS) {
    for (const [name, unicodeRange] of Object.entries(ranges)) {
      jobs.push((async () => {
        const buf = await assetBuffer(`assets/fonts/${prefix}-${name}.woff2`);
        const face = new FontFace(family, buf, { unicodeRange, display: 'swap' });
        await face.load();
        document.fonts.add(face);
        return true;
      })());
    }
  }
  loading = Promise.all(jobs).then(() => true).catch((e) => { console.warn('文件字型載入失敗，改用一般字型', e && e.message); return false; });
  return loading;
}

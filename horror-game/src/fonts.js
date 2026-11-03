// 毛筆字型（紙條、察覺提示）：三個子集檔案用同一個字型名稱 SWBrush，各自只負責自己的字（unicodeRange），
// 瀏覽器會逐字挑檔案。子集由 tools/fonts/subset.py 產生；字型沒載入或某個字不在子集裡（例如玩家名字）
// 就照 CSS 的 font-family 往後退到一般的明體 / 黑體，不會變成方塊。
import { assetBuffer } from './assets.js';
import { BRUSH_RANGES } from './brush-ranges.js';

export const BRUSH_FAMILY = 'SWBrush';
let loading = null;

export function loadBrushFont() {
  if (loading) return loading;
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return (loading = Promise.resolve(false));
  loading = Promise.all(Object.entries(BRUSH_RANGES).map(async ([name, unicodeRange]) => {
    const buf = await assetBuffer(`assets/fonts/brush-${name}.woff2`);
    const face = new FontFace(BRUSH_FAMILY, buf, { unicodeRange, display: 'swap' });
    await face.load();
    document.fonts.add(face);
    return true;
  })).then(() => true).catch((e) => { console.warn('毛筆字型載入失敗，改用一般字型', e && e.message); return false; });
  return loading;
}

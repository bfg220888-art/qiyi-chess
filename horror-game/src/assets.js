// 外部素材的網址：一般部署時是 dist/assets/ 底下的相對路徑；
// 單一檔案版本（artifact.html）會把素材內嵌成 data: 網址放在 window.__SW_ASSETS。
export function assetUrl(path) {
  const m = typeof window !== 'undefined' && window.__SW_ASSETS;
  return (m && Object.prototype.hasOwnProperty.call(m, path) && m[path]) || path;
}

// 讀成 ArrayBuffer。內嵌的 data: 網址直接用 atob 解碼，不經過 fetch
// （有些主機的內容安全政策會擋掉 fetch data: 網址）
export async function assetBuffer(path) {
  const url = assetUrl(path);
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.arrayBuffer();
}

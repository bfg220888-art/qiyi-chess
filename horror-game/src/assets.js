// 外部素材的網址：一般部署時是 dist/assets/ 底下的相對路徑；
// 單一檔案版本（artifact.html）會把素材內嵌成 data: 網址放在 window.__SW_ASSETS。
export function assetUrl(path) {
  const m = typeof window !== 'undefined' && window.__SW_ASSETS;
  return (m && Object.prototype.hasOwnProperty.call(m, path) && m[path]) || path;
}

// 打包成單一 HTML 檔（所有 JS / CSS 內嵌），外部素材複製到 dist/assets/。
// 部署時 index.html 與 assets/ 放在一起；素材缺少時遊戲會自動改用程序生成的版本。
//   node scripts/build.mjs          產生 dist/index.html 與 dist/artifact.html
//   node scripts/build.mjs --serve  監看檔案變更並在 http://localhost:8080 提供預覽
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, cp, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const dist = path.join(root, 'dist');

async function assemble(js) {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const cssSrc = await readFile(path.join(root, 'src/style.css'), 'utf8');
  const css = (await esbuild.transform(cssSrc, { loader: 'css', minify: !serve })).code;
  const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const linkTag = '<link rel="stylesheet" href="./src/style.css">';
  const scriptTag = '<script type="module" src="./src/main.js"></script>';
  if (!html.includes(linkTag) || !html.includes(scriptTag)) throw new Error('index.html 缺少預期的 link / script 標籤');
  const out = html
    .replace(linkTag, () => `<style>${css}</style>`)
    .replace(scriptTag, () => `<script type="module">${safeJs}</script>`);
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'index.html'), out);
  // 外部素材（寫實女鬼、照片貼圖、音效）與授權說明
  if (existsSync(path.join(root, 'assets'))) await cp(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
  else console.warn('找不到 assets/，遊戲會全部使用程序生成的素材');
  if (existsSync(path.join(root, 'CREDITS.md'))) await copyFile(path.join(root, 'CREDITS.md'), path.join(dist, 'CREDITS.md'));
  const threeLicense = path.join(root, 'node_modules/three/LICENSE');
  if (existsSync(threeLicense)) await copyFile(threeLicense, path.join(dist, 'LICENSE-three.txt'));
  // Artifact 版本：只保留 <head> 與 <body> 的內容（外層骨架由平台提供），
  // 而且只能是單一檔案，所以把素材內嵌成 data: 網址（遊戲透過 assetUrl() 讀取）
  const head = out.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset="utf-8">\s*/, '');
  const body = out.match(/<body>([\s\S]*?)<\/body>/)[1];
  const embedded = await embedAssets();
  await writeFile(path.join(dist, 'artifact.html'), head.trim() + '\n' + body.trim() + '\n' + embedded + await licenseNotices());
  return out.length;
}

const MIME = { '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
async function embedAssets() {
  const dir = path.join(root, 'assets');
  if (!existsSync(dir)) return '';
  const map = {};
  for (const sub of await readdir(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    for (const f of await readdir(path.join(dir, sub.name))) {
      const mime = MIME[path.extname(f).toLowerCase()];
      if (!mime) continue;
      const data = await readFile(path.join(dir, sub.name, f));
      map[`assets/${sub.name}/${f}`] = `data:${mime};base64,${data.toString('base64')}`;
    }
  }
  // 跳脫 < 避免 JSON 內容提早結束 <script>
  return `<script>window.__SW_ASSETS=${JSON.stringify(map).replace(/</g, '\\u003c')};</script>\n`;
}

// 單一檔案版本沒有附帶授權檔，把 MIT 授權全文放進 HTML 註解
async function licenseNotices() {
  const parts = [];
  for (const [name, file] of [['three.js', 'node_modules/three/LICENSE'], ['Microsoft Rocketbox（女鬼與屍體模型）', 'assets/ghost/LICENSE-Rocketbox.md']]) {
    const f = path.join(root, file);
    if (existsSync(f)) parts.push(`${name}\n\n${(await readFile(f, 'utf8')).replace(/-(?=-)/g, '- ')}`);
  }
  return parts.length ? `<!--\n${parts.join('\n\n----\n\n')}\n-->\n` : '';
}

const options = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: !serve,
  write: false,
  legalComments: 'eof',
  logLevel: 'warning',
};

if (serve) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{
      name: 'html',
      setup(b) {
        b.onEnd(async (r) => {
          if (r.errors.length) return;
          const size = await assemble(r.outputFiles[0].text);
          console.log(`rebuilt dist/index.html (${(size / 1024).toFixed(0)} KB)`);
        });
      },
    }],
    outfile: path.join(dist, 'bundle.js'),
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 8080, host: '0.0.0.0' });
  console.log(`serving http://localhost:${port}/`);
} else {
  const r = await esbuild.build({ ...options, outfile: path.join(dist, 'bundle.js') });
  const size = await assemble(r.outputFiles[0].text);
  console.log(`dist/index.html ${(size / 1024).toFixed(0)} KB`);
}

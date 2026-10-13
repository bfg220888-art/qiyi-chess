// 打包成單一 HTML 檔（所有 JS / CSS 內嵌），可以直接丟到任何靜態主機或用手機打開。
//   node scripts/build.mjs          產生 dist/index.html 與 dist/artifact.html
//   node scripts/build.mjs --serve  監看檔案變更並在 http://localhost:8080 提供預覽
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
  // Artifact 版本：只保留 <head> 與 <body> 的內容（外層骨架由平台提供）
  const head = out.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset="utf-8">\s*/, '');
  const body = out.match(/<body>([\s\S]*?)<\/body>/)[1];
  await writeFile(path.join(dist, 'artifact.html'), head.trim() + '\n' + body.trim() + '\n');
  return out.length;
}

const options = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: !serve,
  write: false,
  legalComments: 'none',
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

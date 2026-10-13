// 測試用的小型靜態伺服器
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function serveDir(dir, port = 0) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  const rootDir = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    let file;
    try {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      if (!p || p.endsWith('/')) p += 'index.html';
      file = path.resolve(rootDir, '.' + path.posix.normalize('/' + p));
    } catch {
      res.writeHead(400); res.end(); return;
    }
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

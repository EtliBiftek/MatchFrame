'use strict';

/*
 * Geliştirme önizleme sunucusu (Electron gerekmez).
 *
 *   npm run preview   →   http://localhost:5173/dev/preview.html
 *
 * Amaç: sol panel ekranlarını (Analysis / Aim / Utility) gerçek bir .dem
 * dosyası olmadan, fixture veriyle tarayıcıda denemek.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requested = decodeURIComponent(url.pathname);
  const relative = requested.replace(/^\/+/, '');
  const target = path.resolve(ROOT, relative || 'dev/preview.html');

  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(target, (error, buffer) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Bulunamadı: ${relative}`);
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(buffer);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`MatchFrame geliştirme önizlemesi: http://localhost:${PORT}/dev/preview.html`);
});

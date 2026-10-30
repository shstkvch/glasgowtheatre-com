const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { renderShowPreview } = require('./build-preview.cjs');
const { parseEvent, londonDay, summarise } = require('../../functions/_lib/track-core');
const previewEvents = [];

const site = path.resolve(__dirname, '../..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const local = new Set(['/index.html', '/sponsored.css', '/sponsored.js', '/sponsor-core.js', '/snapshot.json']);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/track' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 512) req.destroy(); });
    req.on('end', () => {
      const row = parseEvent(body);
      if (row) {
        // Only local, anonymous test events; bounded to the current session.
        previewEvents.push(row);
        if (previewEvents.length > 1000) previewEvents.shift();
      }
      res.writeHead(row ? 204 : 400); res.end();
    });
    return;
  }
  if (pathname === '/preview-clicks') {
    const counts = new Map();
    for (const row of previewEvents) {
      const key = JSON.stringify([row.day, row.show, row.kind, row.surface]);
      if (!counts.has(key)) counts.set(key, { day: row.day, show_id: row.show, kind: row.kind, surface: row.surface, title: row.title, venue_id: row.venue, n: 0 });
      counts.get(key).n++;
    }
    const rows = [...counts.values()];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ previewOnly: true, ...summarise({ daily: rows, totals: rows, surfaceDaily: rows, surfaceTotals: rows, today: londonDay() }) }));
    return;
  }
  let base;
  let relative;
  if (pathname === '/' || local.has(pathname) || pathname.startsWith('/assets/')) {
    base = __dirname;
    relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  } else if (/^\/shows\/[a-z0-9-]+\.html$/.test(pathname)) {
    base = path.join(site, 'dist'); relative = pathname.slice(1);
  } else if (/^\/(css|fonts|js|images)\//.test(pathname)) {
    base = path.join(site, 'src'); relative = pathname.slice(1);
  } else if (pathname === '/favicon.svg') {
    base = path.join(site, 'dist'); relative = 'favicon.svg';
  } else { res.writeHead(404); res.end('Not found'); return; }
  const file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(pathname.startsWith('/shows/') ? renderShowPreview(data.toString('utf8')) : data);
  });
});
server.listen(Number(process.env.PORT || 4188), '127.0.0.1', () => console.log(`Sponsored Show preview: http://127.0.0.1:${server.address().port}/`));

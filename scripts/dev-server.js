// Local dev server (no Vercel account needed). Run from the project root:  node scripts/dev-server.js
require('./load-env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const handler = require('../api/jobs.js');
const logoHandler = require('../api/logo');

const root = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/jobs') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
    return handler(req, res);
  }
  if (url.pathname === '/api/logo') {
    return logoHandler(req, res); // 2. เพิ่ม Route /api/logo
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}`));

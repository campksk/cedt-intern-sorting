// Self-hosted server (Raspberry Pi / any Linux box). Run from the project root:  node scripts/server.js
// Binds to 127.0.0.1 by default: put Cloudflare Tunnel (or a reverse proxy) in front of it.
require('./load-env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jobsHandler = require('../api/jobs.js');
const logoHandler = require('../api/logo');

const root = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
};

// Same policy as vercel.json (Vercel headers do not apply when self-hosting).
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// --- tiny per-IP rate limiter (fixed window, in memory) ---
const LIMITS = { '/api/logo': 300, '/api/jobs': 60 }; // requests per minute per IP
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000).unref();
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const viaLocalProxy = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  // Forwarded headers are only trusted when the connection comes from a proxy on this machine
  // (cloudflared, tailscaled, Caddy...). Direct connections from elsewhere are keyed by their own address.
  if (!viaLocalProxy) return remote;
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf);
  const xff = req.headers['x-forwarded-for'];
  // Use the LAST entry: that is the one our own proxy appended, so a client cannot spoof it.
  if (xff) return String(xff).split(',').pop().trim() || remote;
  return remote;
}
function limited(req, pathname) {
  const max = LIMITS[pathname];
  if (!max) return false;
  const key = `${pathname}|${clientIp(req)}`;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  return n > max;
}

http.createServer((req, res) => {
  for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Method not allowed'); }

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.statusCode = 400; return res.end('Bad request'); }

  if (url.pathname === '/healthz') { res.setHeader('Content-Type', 'text/plain'); return res.end('ok'); }

  if (url.pathname === '/api/jobs' || url.pathname === '/api/logo') {
    if (limited(req, url.pathname)) {
      res.statusCode = 429; res.setHeader('Retry-After', '60'); return res.end('Too many requests');
    }
    req.query = Object.fromEntries(url.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
    res.send = (b) => res.end(b);
    return (url.pathname === '/api/jobs' ? jobsHandler : logoHandler)(req, res);
  }

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; return res.end('Bad request'); }
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const ext = path.extname(file);
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', ext === '.js' || ext === '.css' || ext === '.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=86400');
  fs.createReadStream(file).pipe(res);
}).listen(port, host, () => console.log(`listening on http://${host}:${port}`));

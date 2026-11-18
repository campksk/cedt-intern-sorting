// Public read-only data API for a Raspberry Pi (or any always-on box). Run from the project root:
//   node scripts/pi-server.js        (or: npm run pi)
//
//   GET /api/jobs[?semester=<id>]   same JSON as the Vercel function, served from data refreshed in the background
//   GET /logos/<file>               logos downloaded by the publisher
//   GET /healthz
//
// Visitors never trigger a login, an upstream request or an outbound fetch: a background job refreshes the
// data every REFRESH_HOURS. The deployed website (see scripts/build-static.js) reads from this server.
require('./load-env');
process.env.LIVE_SOURCE = 'file';
process.env.BROWSER_MAX_AGE_SEC = process.env.BROWSER_MAX_AGE_SEC || '300';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const jobsHandler = require('../api/jobs.js');
const { refresh, readLive, LOGO_DIR, LOGO_FILE_RE } = require('../lib/publisher');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const REFRESH_MS = (Number(process.env.REFRESH_HOURS) || 6) * 3600 * 1000;
const RETRY_MS = 30 * 60 * 1000; // after a failed refresh
const RESP_CACHE_MS = 60 * 1000;
const ORIGINS = (process.env.WEB_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon' };

// ---------- background refresh ----------
let refreshing = false;
async function runRefresh() {
  if (refreshing) return;
  refreshing = true;
  let next = RETRY_MS;
  try {
    await refresh();
    next = REFRESH_MS;
  } catch (err) {
    console.error('[pi] refresh failed:', err.message, `(retrying in ${RETRY_MS / 60000} min)`);
  } finally {
    refreshing = false;
    setTimeout(runRefresh, next + Math.floor(Math.random() * 60000));
  }
}
function scheduleFirstRefresh() {
  const live = readLive();
  const age = live?.at ? Date.now() - live.at : Infinity;
  if (age >= REFRESH_MS) return void runRefresh();
  console.log(`[pi] data is ${Math.round(age / 60000)} min old; next refresh in ${Math.round((REFRESH_MS - age) / 60000)} min`);
  setTimeout(runRefresh, REFRESH_MS - age);
}

// ---------- rate limit (fixed window, per IP) ----------
const LIMITS = { '/api/jobs': 120, logos: 600 }; // requests per minute per IP
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000).unref();
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const viaLocalProxy = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!viaLocalProxy) return remote; // forwarded headers are only trusted from a proxy on this machine
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf);
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',').pop().trim() || remote; // last entry = added by our own proxy
  return remote;
}
function limited(req, bucket) {
  const key = `${bucket}|${clientIp(req)}`;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  return n > LIMITS[bucket];
}

// ---------- /api/jobs with a small response cache (gzip + ETag) ----------
const respCache = new Map(); // semester -> Promise<entry>
function runJobs(semester) {
  return new Promise((resolve) => {
    const headers = {};
    const fake = {
      setHeader: (k, v) => { headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(b) {
        const body = Buffer.from(JSON.stringify(b));
        resolve({
          at: Date.now(), code: this.code || 200, headers, body, gz: zlib.gzipSync(body),
          etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
        });
      },
    };
    Promise.resolve(jobsHandler({ query: semester ? { semester } : {} }, fake)).catch(() =>
      resolve({ at: Date.now(), code: 500, headers: {}, body: Buffer.from('{"error":"Failed to load openings"}'), gz: null, etag: null }));
  });
}
async function serveJobs(req, res, url) {
  const semester = (url.searchParams.get('semester') || '').slice(0, 64);
  let p = respCache.get(semester);
  let entry = p && (await p);
  if (!entry || Date.now() - entry.at > RESP_CACHE_MS || entry.code !== 200) {
    if (respCache.size > 50) respCache.clear();
    p = runJobs(semester);
    respCache.set(semester, p);
    entry = await p;
  }
  res.statusCode = entry.code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(entry.headers)) res.setHeader(k, v);
  if (entry.etag) {
    res.setHeader('ETag', entry.etag);
    if (req.headers['if-none-match'] === entry.etag) { res.statusCode = 304; return res.end(); }
  }
  const gz = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const out = gz ? entry.gz : entry.body;
  if (gz) res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', out.length);
  res.end(req.method === 'HEAD' ? undefined : out);
}

function serveLogo(req, res, name) {
  const file = path.join(LOGO_DIR, name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', IMG_TYPES[name.split('.')[1]]);
    res.setHeader('Content-Length', st.size);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // file name = hash of the source URL
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin, Accept-Encoding');
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'X-Data-Source, ETag');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, If-None-Match');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Method not allowed'); }

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.statusCode = 400; return res.end('Bad request'); }

  try {
    if (url.pathname === '/healthz') {
      const live = readLive();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ ok: true, liveAt: live?.at ? new Date(live.at).toISOString() : null }));
    }
    if (url.pathname === '/api/jobs') {
      if (limited(req, '/api/jobs')) { res.statusCode = 429; res.setHeader('Retry-After', '60'); return res.end('Too many requests'); }
      return await serveJobs(req, res, url);
    }
    const m = url.pathname.match(/^\/logos\/([^/]+)$/);
    if (m && LOGO_FILE_RE.test(m[1])) {
      if (limited(req, 'logos')) { res.statusCode = 429; res.setHeader('Retry-After', '60'); return res.end('Too many requests'); }
      return serveLogo(req, res, m[1]);
    }
    res.statusCode = 404;
    res.end('Not found');
  } catch (err) {
    console.error('[pi] request failed:', err.message);
    if (!res.headersSent) { res.statusCode = 500; res.end('Server error'); } else res.destroy();
  }
}).listen(port, host, () => {
  console.log(`[pi] data API on http://${host}:${port}  (CORS origins: ${ORIGINS.join(', ') || 'none'})`);
  scheduleFirstRefresh();
});

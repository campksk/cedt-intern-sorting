const dns = require('dns').promises;
const net = require('net');
const { refreshCookie } = require('../lib/auth');

const INTERNAL_ORIGIN = 'https://cedtintern.cp.eng.chula.ac.th';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_BYTES = 48 * 1024 * 1024; // total size of cached images
const cache = new Map(); // targetUrl -> { at, type, buffer }  (insertion order = oldest first)
let cacheBytes = 0;
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) { cache.delete(key); cacheBytes -= e.buffer.length; return null; }
  return e;
}
function cacheSet(key, type, buffer) {
  if (cache.has(key)) cacheBytes -= cache.get(key).buffer.length;
  cache.set(key, { at: Date.now(), type, buffer });
  cacheBytes += buffer.length;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).buffer.length;
    cache.delete(oldest);
  }
}
// SVG is excluded on purpose: it can carry script.
const ALLOWED_TYPES = /^image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon)$/i;

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (typeof res.status === 'function') return res.status(status).send(body);
  res.writeHead(status);
  res.end(body);
}

const blocked = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['64:ff9b::', 96], ['2002::', 16], // NAT64 / 6to4 can embed private IPv4 addresses
]) blocked.addSubnet(addr, bits, 'ipv6');

/** True for loopback, private, link-local (incl. cloud metadata), CGNAT, multicast and reserved addresses.
 *  BlockList also matches IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 ranges. */
function isPrivateIp(ip) {
  const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
  return blocked.check(ip, family);
}

/** Throws unless the URL is https on a public host. */
async function assertPublicHttps(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== 'https:') throw Object.assign(new Error('Invalid protocol'), { status: 403 });
  if (u.username || u.password) throw Object.assign(new Error('Credentials in URL'), { status: 403 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('Blocked address'), { status: 403 });
    return u;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('Blocked address'), { status: 403 });
  }
  return u;
}

/** Fetch with manual redirects (each hop re-validated), timeout and size cap. */
async function fetchImage(startUrl, cookie) {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicHttps(current);
    // The session cookie only ever goes to the CEDT origin itself.
    const headers = cookie && u.origin === INTERNAL_ORIGIN ? { cookie } : {};
    const r = await fetch(u, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), u).toString();
      continue;
    }
    return r;
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}

async function readCapped(r) {
  const declared = Number(r.headers.get('content-length'));
  if (declared > MAX_BYTES) throw Object.assign(new Error('Too large'), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const c of r.body) {
    size += c.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/**
 * Resolve, fetch and validate one logo (SSRF-guarded; see assertPublicHttps / fetchImage).
 * Used by the /api/logo handler and by the Pi publisher.
 * @returns {Promise<{type: string, buffer: Buffer}>}  Throws errors that may carry a .status.
 */
async function loadLogo(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw Object.assign(new Error('Missing or invalid url parameter'), { status: 400 });
  }
  let targetUrl;
  try {
    targetUrl = /^https?:\/\//i.test(rawUrl)
      ? new URL(rawUrl).toString()
      : new URL(rawUrl, `${INTERNAL_ORIGIN}/`).toString();
  } catch {
    throw Object.assign(new Error('Invalid url'), { status: 400 });
  }
  const isInternal = new URL(targetUrl).origin === INTERNAL_ORIGIN;
  const cookie = () => (isInternal ? process.env.UPSTREAM_COOKIE : undefined);

  const cached = cacheGet(targetUrl);
  if (cached) return { type: cached.type, buffer: cached.buffer };

  let imgRes = await fetchImage(targetUrl, cookie());

  // Auto-refresh cookie and retry once if session expired (401, 403, or 409)
  if (isInternal && [401, 403, 409].includes(imgRes.status) && process.env.MCV_USERNAME) {
    await refreshCookie();
    imgRes = await fetchImage(targetUrl, cookie());
  }

  if (!imgRes.ok) throw Object.assign(new Error('Failed to fetch logo'), { status: 502 });

  const type = (imgRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.test(type)) throw Object.assign(new Error('Not an allowed image type'), { status: 415 });

  const buffer = await readCapped(imgRes);
  cacheSet(targetUrl, type, buffer);
  return { type, buffer };
}

module.exports = async (req, res) => {
  // Support both Vercel (req.query) and native Node http server (req.url)
  const rawUrl = req.query?.url ?? new URL(req.url, 'http://localhost').searchParams.get('url');
  try {
    const { type, buffer } = await loadLogo(rawUrl);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200');
    return send(res, 200, buffer, type);
  } catch (err) {
    if (!err.status) console.error('[Logo Proxy] Error:', err.message);
    return send(res, err.status || 502, err.status ? err.message : 'Error proxying image');
  }
};

module.exports.isPrivateIp = isPrivateIp;
module.exports.loadLogo = loadLogo;

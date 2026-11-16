const { refreshCookie } = require('../lib/auth');

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  if (typeof res.status === 'function') {
    res.setHeader('Content-Type', contentType);
    return res.status(status).send(body);
  }
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

module.exports = async (req, res) => {
  // Support both Vercel (req.query) and native Node http server (req.url)
  const rawUrl = req.query?.url ?? new URL(req.url, 'http://localhost').searchParams.get('url');

  if (!rawUrl) {
    return send(res, 400, 'Missing url parameter');
  }

  const isInternal = !rawUrl.startsWith('http') || rawUrl.startsWith('https://cedtintern.cp.eng.chula.ac.th/');
  const targetUrl = rawUrl.startsWith('http')
    ? rawUrl
    : `https://cedtintern.cp.eng.chula.ac.th${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

  if (!targetUrl.startsWith('https://')) {
    return send(res, 403, 'Invalid protocol');
  }

  const fetchImage = async () => {
    const headers = {};
    if (isInternal && process.env.UPSTREAM_COOKIE) {
      headers.cookie = process.env.UPSTREAM_COOKIE;
    }
    return fetch(targetUrl, { headers });
  };

  try {
    let imgRes = await fetchImage();

    // Auto-refresh cookie and retry once if session expired (401, 403, or 409)
    if (isInternal && (imgRes.status === 401 || imgRes.status === 403 || imgRes.status === 409) && process.env.MCV_USERNAME) {
      await refreshCookie();
      imgRes = await fetchImage();
    }

    if (!imgRes.ok) {
      return send(res, imgRes.status, `Failed to fetch logo: ${imgRes.status}`);
    }

    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    return send(res, 200, buffer, contentType);
  } catch (err) {
    console.error('[Logo Proxy] Error:', err);
    return send(res, 500, 'Error proxying image');
  }
};
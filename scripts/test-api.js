// Self-contained tests (no internet): archives, live semester, pagination, fallbacks. Run: npm test
const http = require('http');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const SAMPLE = JSON.parse(fs.readFileSync('data/2025-2.json', 'utf8')).items; // 228 items
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

function mock({ pageParam = 'page', sizeParam = 'limit', ignorePaging = false, defaultSize = 100, status = 200 } = {}) {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits++;
    if (status !== 200) { res.writeHead(status); return res.end('{}'); }
    const q = new URL(req.url, 'http://x').searchParams;
    const size = Number(q.get(sizeParam)) || defaultSize;
    const page = ignorePaging ? 1 : Number(q.get(pageParam)) || 1;
    const items = SAMPLE.slice((page - 1) * size, page * size);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items, meta: { totalItem: SAMPLE.length, itemCount: items.length, itemsPerPage: size, totalPage: Math.ceil(SAMPLE.length / size), currentPage: page } }));
  });
  return new Promise((r) => server.listen(0, () => r({ server, state, url: `http://127.0.0.1:${server.address().port}/api/openings` })));
}

function freshHandler() {
  for (const k of Object.keys(require.cache)) if (/[\\/](api[\\/]jobs|lib[\\/]upstream)\.js$/.test(k)) delete require.cache[k];
  return require('../api/jobs.js');
}
const call = (handler, query = {}) => new Promise((resolve) => {
  const headers = {};
  handler({ query }, { setHeader: (k, v) => (headers[k] = v), status() { return this; }, json: (body) => resolve({ headers, body }) });
});

(async () => {
  const quiet = console.error; console.error = () => {}; // expected upstream failures are noisy
  for (const k of ['UPSTREAM_URL', 'UPSTREAM_TOKEN', 'UPSTREAM_COOKIE', 'UPSTREAM_PAGE_PARAM']) delete process.env[k];

  // 1. no upstream configured: archives only
  let { body } = await call(freshHandler(), {});
  check('no live configured: default archive 2025-2', body.semester === '2025-2' && body.source === 'archive' && body.count === 228);
  check('no live configured: no "live" option', !body.semesters.some((s) => s.id === 'live'), body.semesters.map((s) => s.id).join(','));
  check('archive list newest first', body.semesters[0].id === '2025-2' && body.semesters[1].id === '2025-1');
  ({ body } = await call(freshHandler(), { semester: '2025-1' }));
  check('archive 2025-1', body.semester === '2025-1' && body.count === 191);
  ({ body } = await call(freshHandler(), { semester: 'live' }));
  check('?semester=live without UPSTREAM_URL -> default archive', body.semester === '2025-2');

  // 2. live with pagination (param "page", 100 per page => 3 requests)
  let m = await mock();
  process.env.UPSTREAM_URL = m.url;
  let r = await call(freshHandler(), {});
  check('live default when configured', r.body.semester === 'live' && r.body.source === 'live' && r.body.semesters[0].id === 'live');
  check('live: all 228 items across pages', r.body.count === 228, `hits=${m.state.hits}`);
  check('live: no duplicate ids', new Set(r.body.items.map((i) => i.id)).size === 228);
  check('live: CDN cache set', /s-maxage=3600/.test(r.headers['Cache-Control']));
  ({ body } = await call(freshHandler(), { semester: '2025-1' }));
  check('archive still selectable when live configured', body.semester === '2025-1' && body.source === 'archive' && body.semesters[0].id === 'live');
  m.server.close();

  // 3. API paginates with a different param name -> auto-detected
  m = await mock({ pageParam: 'currentPage' });
  process.env.UPSTREAM_URL = m.url;
  r = await call(freshHandler(), { semester: 'live' });
  check('auto-detect page param "currentPage"', r.body.count === 228 && r.body.source === 'live', `hits=${m.state.hits}`);
  m.server.close();

  // 4. explicit UPSTREAM_PAGE_PARAM
  m = await mock({ pageParam: 'p' });
  process.env.UPSTREAM_URL = m.url; process.env.UPSTREAM_PAGE_PARAM = 'p';
  r = await call(freshHandler(), { semester: 'live' });
  check('UPSTREAM_PAGE_PARAM=p', r.body.count === 228);
  delete process.env.UPSTREAM_PAGE_PARAM;
  m.server.close();

  // 5. page size in URL => single request
  m = await mock();
  process.env.UPSTREAM_URL = `${m.url}?limit=1000`;
  r = await call(freshHandler(), { semester: 'live' });
  check('?limit=1000 -> one request, 228 items', r.body.count === 228 && m.state.hits === 1, `hits=${m.state.hits}`);
  m.server.close();

  // 6. URL already has other params (uses & correctly)
  m = await mock();
  process.env.UPSTREAM_URL = `${m.url}?foo=bar`;
  r = await call(freshHandler(), { semester: 'live' });
  check('URL with existing query string', r.body.count === 228);
  m.server.close();

  // 7. upstream ignores paging => error + fallback to archive (never silently partial)
  m = await mock({ ignorePaging: true });
  process.env.UPSTREAM_URL = m.url;
  r = await call(freshHandler(), { semester: 'live' });
  check('paging ignored: falls back to archive', r.body.fallback?.id === '2025-2' && r.body.count === 228 && r.body.source === 'archive');
  check('paging ignored: clear error message', /no page parameter worked/.test(r.body.upstreamError || ''), r.body.upstreamError);
  check('fallback cached briefly only', /s-maxage=120/.test(r.headers['Cache-Control']));
  m.server.close();

  // 8. 401 => fallback with hint
  m = await mock({ status: 401 });
  process.env.UPSTREAM_URL = m.url;
  r = await call(freshHandler(), { semester: 'live' });
  check('401: fallback + login hint', r.body.fallback && /HTTP 401.*login/.test(r.body.upstreamError), r.body.upstreamError);
  m.server.close();

  // 9. last good copy survives later outage (TTL 0 forces refetch)
  m = await mock();
  process.env.UPSTREAM_URL = m.url; process.env.CACHE_TTL_SEC = '0.001';
  const h = freshHandler();
  await call(h, { semester: 'live' });
  m.server.close();
  await new Promise((x) => setTimeout(x, 20));
  r = await call(h, { semester: 'live' });
  check('upstream down after success: stale copy', r.body.source === 'stale' && r.body.count === 228 && !r.body.fallback, r.body.upstreamError);

  console.error = quiet;
  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  process.exit(failed ? 1 : 0);
})();

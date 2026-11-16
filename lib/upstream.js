/**
 * Fetch the live openings list from the upstream API, following pagination.
 *
 * Env: UPSTREAM_URL (required), UPSTREAM_TOKEN, UPSTREAM_COOKIE,
 *      UPSTREAM_PAGE_PARAM (optional: name of the page-number query param; auto-detected if unset)
 */
const PAGE_PARAM_CANDIDATES = ['page', 'currentPage', 'pageNo', 'pageNumber'];
const MAX_PAGES = 50;
let knownPageParam = null; // remembered once a param is proven to work

const keyOf = (r) => `${r.openingId}-${r.sessionId}`;

function extractItems(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.fullContent?.items)) return json.fullContent.items;
  throw new Error('Unexpected upstream shape (no items array)');
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => !seen.has(keyOf(r)) && seen.add(keyOf(r)));
}

async function getJson(url) {
  const headers = { accept: 'application/json' };
  if (process.env.UPSTREAM_TOKEN) headers.authorization = `Bearer ${process.env.UPSTREAM_TOKEN}`;
  if (process.env.UPSTREAM_COOKIE) headers.cookie = process.env.UPSTREAM_COOKIE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ' — likely needs login / a valid UPSTREAM_TOKEN or UPSTREAM_COOKIE' : '';
      throw new Error(`upstream HTTP ${res.status}${hint}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<{items: object[], meta: object}>} all pages merged */
async function fetchLive() {
  const base = process.env.UPSTREAM_URL;
  if (!base) throw new Error('UPSTREAM_URL is not set');

  const first = await getJson(base);
  const items = extractItems(first);
  const total = Number(first?.meta?.totalItem) || items.length;
  const meta = { ...(first.meta || {}), totalItem: total, itemCount: total, itemsPerPage: total, totalPage: 1, currentPage: 1 };
  if (items.length >= total) return { items, meta };

  const pages = Number(first.meta?.totalPage) || Math.ceil(total / Math.max(items.length, 1));
  if (pages > MAX_PAGES) throw new Error(`upstream has ${pages} pages (limit ${MAX_PAGES})`);

  const candidates = knownPageParam
    ? [knownPageParam]
    : process.env.UPSTREAM_PAGE_PARAM ? [process.env.UPSTREAM_PAGE_PARAM] : PAGE_PARAM_CANDIDATES;
  let lastError = null;
  for (const name of candidates) {
    const urlFor = (n) => { const u = new URL(base); u.searchParams.set(name, String(n)); return u.toString(); };
    try {
      const second = extractItems(await getJson(urlFor(2)));
      if (!second.length || keyOf(second[0]) === keyOf(items[0])) continue; // param ignored -> try next name
      const rest = await Promise.all(Array.from({ length: Math.max(pages - 2, 0) }, (_, i) => getJson(urlFor(i + 3)).then(extractItems)));
      const all = dedupe([...items, ...second, ...rest.flat()]);
      if (all.length < total) throw new Error(`retrieved ${all.length} of ${total} items`);
      knownPageParam = name;
      return { items: all, meta };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `upstream has ${total} items but returned ${items.length}; no page parameter worked (tried ${candidates.join(', ')})` +
      (lastError ? `: ${lastError.message}` : '') +
      '. Set UPSTREAM_PAGE_PARAM, or add a page-size param (e.g. limit=1000) to UPSTREAM_URL'
  );
}

module.exports = { fetchLive, extractItems };

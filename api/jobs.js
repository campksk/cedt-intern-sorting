/**
 * GET /api/jobs?semester=<id>
 *
 * Semesters:
 *   - "live"  : current data from the upstream API (only offered when UPSTREAM_URL is set)
 *   - others  : archived snapshots listed in data/semesters.json, one JSON file each
 *
 * Live data is fetched (all pages) by lib/upstream.js, normalized here, and cached in memory
 * plus the Vercel CDN. If live fetching fails we serve the last good copy, else the default
 * archive (and say so in the response).
 *
 * Env vars (see .env.example): UPSTREAM_URL, UPSTREAM_TOKEN, UPSTREAM_COOKIE,
 * UPSTREAM_PAGE_PARAM, CACHE_TTL_SEC (default 3600)
 */
const fs = require('fs');
const path = require('path');
const { fetchLive, extractItems } = require('../lib/upstream');

const DATA_DIR = path.join(process.cwd(), 'data');
const TTL = Number(process.env.CACHE_TTL_SEC) || 3600;
const WORKDAYS_PER_MONTH = 22;
const LIVE = { id: 'live', label: 'Live', live: true };
const mem = new Map(); // "live" -> { at, items }; "archive:<id>" -> { items }

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const UNIT = { 'บาท/วัน': 'day', 'บาท/เดือน': 'month', 'บาท (เหมาจ่าย)': 'lump', 'ไม่มีค่าตอบแทน': 'none' };

function normalize(raw) {
  const label = raw.compensationType?.compensationType || '';
  const amount = Number(raw.compensationAmount) > 0 ? Number(raw.compensationAmount) : null;
  const unit = UNIT[label] || (amount ? 'other' : 'none');
  // Comparable per-day figure. Lump-sum pay depends on duration, so it is not comparable.
  let perDay = null;
  if (amount && unit === 'day') perDay = amount;
  else if (amount && unit === 'month') perDay = Math.round(amount / WORKDAYS_PER_MONTH);

  const seen = new Set();
  const tags = (raw.tags || [])
    .map((t) => String(t.tagName || '').trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));

  const rawLogo = raw.company?.logoUrl || '';
  const logo = rawLogo ? `/api/logo?url=${encodeURIComponent(rawLogo)}` : '';

  const quota = Number(raw.quota) || 0;
  return {
    id: `${raw.openingId}-${raw.sessionId}`,
    openingId: raw.openingId,
    sessionId: raw.sessionId,
    title: String(raw.title || '').trim(),
    company: {
      id: raw.company?.companyId ?? null,
      th: String(raw.company?.companyNameTh || '').trim(),
      en: String(raw.company?.companyNameEn || '').trim(),
      logo,
      website: raw.company?.website || '',
    },
    quota,
    coop: !!raw.openForCooperativeInternship,
    pay: { amount, unit, label },
    perDay,
    mode: raw.workingCondition || '',
    tags,
    office: String(raw.officeName || '').trim(),
    address: htmlToText(raw.officeAddressLine1),
    transit: htmlToText(raw.officeAddressLine2),
    desc: htmlToText(raw.description),
    req: htmlToText(raw.requirements),
    contact: raw.openingDetailContactChannel || raw.recruitmentContactChannel || '',
    open: raw.isAcceptingApplication !== false && quota > 0,
    interest: Number(raw.inStudentDraftCount) || 0,
  };
}

const prepare = (rawItems) => rawItems.filter((r) => r.isPublished !== false).map(normalize);

/** Archived semesters from data/semesters.json (oldest -> newest); entries whose file is missing are skipped. */
function readArchives() {
  let cfg = [];
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'semesters.json'), 'utf8'));
  } catch (err) {
    console.error('[jobs] cannot read data/semesters.json:', err.message);
  }
  return cfg
    .filter((s) => s && s.id)
    .map((s) => ({ ...s, file: path.basename(s.file || `${s.id}.json`) }))
    .filter((s) => fs.existsSync(path.join(DATA_DIR, s.file)));
}

function loadArchive(sem) {
  const key = `archive:${sem.id}`;
  if (!mem.has(key)) {
    const json = JSON.parse(fs.readFileSync(path.join(DATA_DIR, sem.file), 'utf8'));
    mem.set(key, { items: prepare(extractItems(json)) });
  }
  return mem.get(key).items;
}

async function loadLive() {
  const hit = mem.get('live');
  if (hit && Date.now() - hit.at < TTL * 1000) return { ...hit, source: 'live' };
  try {
    const { items } = await fetchLive();
    const entry = { at: Date.now(), items: prepare(items) };
    mem.set('live', entry);
    return { ...entry, source: 'live' };
  } catch (err) {
    console.error('[jobs] live fetch failed:', err);
    if (hit) return { ...hit, source: 'stale', upstreamError: err.message }; // last good copy
    return { source: 'failed', upstreamError: err.message };
  }
}

module.exports = async (req, res) => {
  try {
    const archives = readArchives();
    const liveOn = !!process.env.UPSTREAM_URL;
    const fallbackArchive = archives.find((a) => a.isDefault) || archives[archives.length - 1];
    const wanted = req.query?.semester;
    const selected =
      wanted === 'live' && liveOn ? 'live'
      : archives.some((a) => a.id === wanted) ? wanted
      : liveOn ? 'live'
      : fallbackArchive?.id;
    if (!selected) throw new Error('No semesters available (data/semesters.json is empty and UPSTREAM_URL is not set)');

    const semesters = [
      ...(liveOn ? [LIVE] : []),
      ...[...archives].reverse().map(({ id, label }) => ({ id, label: label || id })), // newest first
    ];

    let items, at = null, source = 'archive', upstreamError = null, fallback = null;
    if (selected === 'live') {
      const r = await loadLive();
      ({ at = null, source, upstreamError = null } = r);
      if (r.source === 'failed') {
        if (!fallbackArchive) throw new Error(r.upstreamError);
        items = loadArchive(fallbackArchive);
        source = 'archive';
        fallback = { id: fallbackArchive.id, label: fallbackArchive.label || fallbackArchive.id };
      } else items = r.items;
    } else {
      items = loadArchive(archives.find((a) => a.id === selected));
    }

    // Live data is CDN-cached for TTL; archives are static per deployment; fallback/stale retry soon.
    const maxAge = source === 'live' ? TTL : source === 'archive' && !fallback ? 86400 : 120;
    res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=86400`);
    res.setHeader('X-Data-Source', fallback ? 'fallback' : source);
    res.status(200).json({
      semester: selected,
      semesters,
      source, // live | stale | archive
      fallback, // set when live failed and an archive is shown instead
      fetchedAt: at ? new Date(at).toISOString() : null,
      upstreamError,
      count: items.length,
      items,
    });
  } catch (err) {
    console.error('[jobs] fatal:', err);
    res.status(500).json({ error: 'Failed to load openings' });
  }
};
/**
 * Raspberry Pi publisher: log in (via lib/upstream -> lib/auth), fetch the live openings, download the
 * company logos, and write everything to LIVE_DIR so the public API can serve it without ever touching
 * the upstream (or the logo hosts) while handling a visitor's request.
 *
 *   LIVE_DIR/live.json                { at, items: <raw upstream items>, logos: { <logoUrl>: <file> } }
 *   LIVE_DIR/logos/<hash>.<ext>       pre-downloaded logos
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchLive, extractItems } = require('./upstream');
const { loadLogo } = require('../api/logo');

const LIVE_DIR = process.env.LIVE_DIR || path.join(process.cwd(), 'data-live');
const LOGO_DIR = path.join(LIVE_DIR, 'logos');
const LIVE_FILE = path.join(LIVE_DIR, 'live.json');
const LOGO_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // re-download a logo after a week
const CONCURRENCY = 4;
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
};
const LOGO_FILE_RE = /^[a-f0-9]{16}\.(png|jpg|gif|webp|avif|ico)$/;

/** Logo URLs used by the archived semesters in data/ (so old semesters get pre-downloaded logos too). */
function archiveLogoUrls() {
  const dir = path.join(process.cwd(), 'data');
  const out = new Set();
  let cfg = [];
  try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'semesters.json'), 'utf8')); } catch { return []; }
  for (const sem of cfg) {
    if (!sem || !sem.id) continue;
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, path.basename(sem.file || `${sem.id}.json`)), 'utf8'));
      for (const r of extractItems(json)) if (r.isPublished !== false && r.company?.logoUrl) out.add(r.company.logoUrl);
    } catch { /* missing or unreadable archive: skip */ }
  }
  return [...out];
}

const hashOf = (url) => crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readLive() {
  try { return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')); } catch { return null; }
}

async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]);
  }));
}

async function refresh({ log = console.log } = {}) {
  const { items } = await fetchLive();
  const published = items.filter((r) => r.isPublished !== false);
  if (!published.length) throw new Error('upstream returned no published items; keeping the previous data');

  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const onDisk = new Map(); // hash -> { file, mtimeMs }
  for (const file of fs.readdirSync(LOGO_DIR)) {
    if (!LOGO_FILE_RE.test(file)) continue;
    onDisk.set(file.split('.')[0], { file, mtimeMs: fs.statSync(path.join(LOGO_DIR, file)).mtimeMs });
  }

  const urls = [...new Set([...published.map((r) => r.company?.logoUrl).filter(Boolean), ...archiveLogoUrls()])];
  const logos = {};
  let downloaded = 0, reused = 0, failed = 0;
  await pool(urls, CONCURRENCY, async (url) => {
    const h = hashOf(url);
    const have = onDisk.get(h);
    if (have && Date.now() - have.mtimeMs < LOGO_MAX_AGE_MS) { logos[url] = have.file; reused++; return; }
    try {
      const { type, buffer } = await loadLogo(url);
      const ext = EXT[type];
      if (!ext) throw new Error(`unsupported type ${type}`);
      const file = `${h}.${ext}`;
      atomicWrite(path.join(LOGO_DIR, file), buffer);
      if (have && have.file !== file) fs.rmSync(path.join(LOGO_DIR, have.file), { force: true });
      logos[url] = file;
      downloaded++;
    } catch (err) {
      failed++;
      if (have) logos[url] = have.file; // keep the older copy rather than losing the logo
    }
  });

  const keep = new Set(Object.values(logos));
  for (const { file } of onDisk.values()) if (!keep.has(file)) fs.rmSync(path.join(LOGO_DIR, file), { force: true });

  atomicWrite(LIVE_FILE, JSON.stringify({ at: Date.now(), items: published, logos }));
  log(`[publisher] ${published.length} items; logos: ${downloaded} new, ${reused} reused, ${failed} failed`);
  return { items: published.length, downloaded, reused, failed };
}

module.exports = { refresh, readLive, LIVE_DIR, LOGO_DIR, LIVE_FILE, LOGO_FILE_RE };

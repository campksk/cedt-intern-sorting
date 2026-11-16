// Save the current live data as an archived semester:
//   node scripts/snapshot.js <id> [label]      e.g.  node scripts/snapshot.js 2026-1 "2026/1"
// Reads UPSTREAM_URL / UPSTREAM_TOKEN / UPSTREAM_COOKIE from .env, fetches ALL pages, writes
// data/<id>.json and adds/updates the entry in data/semesters.json. Commit both files.
require('./load-env');
const fs = require('fs');
const path = require('path');
const { fetchLive } = require('../lib/upstream');

(async () => {
  const [id, labelArg] = process.argv.slice(2);
  if (!id || !/^[\w.-]+$/.test(id)) return console.error('usage: node scripts/snapshot.js <id> [label]   (id: letters, digits, - _ .)');
  const dir = path.join(__dirname, '..', 'data');
  const { items, meta } = await fetchLive();
  if (!items.length) throw new Error('no items in response; refusing to write an empty snapshot');
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ items, meta }));

  const cfgPath = path.join(dir, 'semesters.json');
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : [];
  const entry = cfg.find((s) => s.id === id);
  const label = labelArg || entry?.label || id.replace('-', '/');
  if (entry) Object.assign(entry, { label, file: `${id}.json` });
  else cfg.push({ id, label, file: `${id}.json` });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`saved data/${id}.json (${items.length} items) and updated data/semesters.json`);
})().catch((e) => { console.error(e.message); process.exit(1); });

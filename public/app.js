(() => {
  'use strict';

  const SITE = 'https://cedtintern.cp.eng.chula.ac.th';
  const CACHE_PREFIX = 'cedt:v2:';
  const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
  const collator = new Intl.Collator('th');
  const $ = (id) => document.getElementById(id);

  // ---------- tiny DOM helper (everything is inserted as text => no XSS from scraped data) ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------- state ----------
  const state = {
    sem: null, semesters: [], items: [], meta: null, fromCache: false,
    q: '', sort: '', modes: new Set(), tags: new Set(),
    openOnly: true, paidOnly: false, coop: false,
  };
  const tagNames = new Map(); // lowercase key -> display name

  // ---------- sorting ----------
  const cmpNum = (a, b, dir) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : dir * (a - b)); // unknown always last
  const ratio = (it) => (it.quota > 0 ? it.interest / it.quota : null);
  const SORTS = {
    relevance: { label: 'ตรงกับคำค้นมากที่สุด', cmp: (a, b) => b._score - a._score },
    'pay-desc': { label: 'ค่าตอบแทนสูง → ต่ำ', cmp: (a, b) => cmpNum(a.perDay, b.perDay, -1) },
    'pay-asc': { label: 'ค่าตอบแทนต่ำ → สูง', cmp: (a, b) => cmpNum(a.perDay, b.perDay, 1) },
    'quota-desc': { label: 'จำนวนรับมาก → น้อย', cmp: (a, b) => b.quota - a.quota },
    'quota-asc': { label: 'จำนวนรับน้อย → มาก', cmp: (a, b) => a.quota - b.quota },
    'comp-asc': { label: 'คนแย่งน้อยที่สุด (สนใจ ÷ อัตรา)', cmp: (a, b) => cmpNum(ratio(a), ratio(b), 1) },
    'interest-desc': { label: 'ยอดนิยม (คนสนใจมากสุด)', cmp: (a, b) => b.interest - a.interest },
    'company-asc': { label: 'บริษัท ก → ฮ', cmp: (a, b) => collator.compare(a._coName, b._coName) },
    'company-desc': { label: 'บริษัท ฮ → ก', cmp: (a, b) => collator.compare(b._coName, a._coName) },
    'title-asc': { label: 'ชื่อตำแหน่ง ก → ฮ', cmp: (a, b) => collator.compare(a.title, b.title) },
    new: { label: 'ประกาศใหม่ล่าสุด', cmp: (a, b) => b.openingId - a.openingId },
  };
  const DEFAULT_SORT = 'pay-desc';

  // ---------- search ----------
  const tokenize = (q) => q.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean);
  function prep(it) {
    it._coName = it.company.th || it.company.en || '';
    it._title = it.title.toLowerCase();
    it._co = `${it.company.th} ${it.company.en}`.toLowerCase();
    it._tags = it.tags.join(' ').toLowerCase();
    it._tagKeys = it.tags.map((t) => t.toLowerCase());
    it._office = `${it.office} ${it.address}`.toLowerCase();
    it._desc = `${it.desc} ${it.req}`.toLowerCase();
    it.tags.forEach((t) => !tagNames.has(t.toLowerCase()) && tagNames.set(t.toLowerCase(), t));
    return it;
  }
  // every word must match somewhere; weight by where it matched. 0 = no match.
  function score(it, toks) {
    let total = 0;
    for (const t of toks) {
      let s = 0;
      if (it._title.includes(t)) s += 5;
      if (it._co.includes(t)) s += 4;
      if (it._tags.includes(t)) s += 3;
      if (it._office.includes(t)) s += 1;
      if (it._desc.includes(t)) s += 1;
      if (!s) return 0;
      total += s;
    }
    return total;
  }
  function hl(text, toks) {
    if (!toks.length || !text) return text;
    const parts = text.split(new RegExp(`(${toks.map(esc).join('|')})`, 'i'));
    return parts.map((p, i) => (i % 2 ? el('mark', {}, p) : p));
  }

  // ---------- filtering ----------
  const modeKey = (it) => it.mode || '_none';
  function baseMatches(it, toks) {
    if (state.openOnly && !it.open) return false;
    if (state.paidOnly && !it.pay.amount) return false;
    if (state.coop && !it.coop) return false;
    if (state.modes.size && !state.modes.has(modeKey(it))) return false;
    if (toks.length) {
      it._score = score(it, toks);
      if (!it._score) return false;
    } else it._score = 0;
    return true;
  }
  const tagMatches = (it) => !state.tags.size || [...state.tags].some((k) => it._tagKeys.includes(k)); // any-of

  // ---------- rendering ----------
  function update() {
    const toks = tokenize(state.q);
    const base = state.items.filter((it) => baseMatches(it, toks));
    const result = base.filter(tagMatches);

    const sortKey = effectiveSort(toks.length > 0);
    const cmp = SORTS[sortKey].cmp;
    result.sort((a, b) => cmp(a, b) || collator.compare(a._coName, b._coName) || collator.compare(a.title, b.title));

    renderSort(sortKey, toks.length > 0);
    renderModes();
    renderTagList(base);
    renderSelectedTags();
    renderList(result, toks);
    $('count').textContent = `แสดง ${result.length} จาก ${state.items.length} ตำแหน่ง`;
    $('reset').hidden = !isFiltered();
    syncUrl();
  }

  function effectiveSort(hasQuery) {
    if (state.sort && SORTS[state.sort] && !(state.sort === 'relevance' && !hasQuery)) return state.sort;
    return hasQuery ? 'relevance' : DEFAULT_SORT;
  }
  function renderSort(active, hasQuery) {
    const sel = $('sort');
    if (!sel.options.length) {
      for (const [k, v] of Object.entries(SORTS)) sel.append(el('option', { value: k }, v.label));
      sel.title = 'ค่าตอบแทนแปลงเป็นต่อวัน (เงินเดือน ÷ 22 วัน) ส่วนเหมาจ่ายและไม่ระบุจะอยู่ท้ายสุด';
    }
    sel.querySelector('option[value=relevance]').disabled = !hasQuery;
    sel.value = active;
  }
  function renderModes() {
    const box = $('modes');
    const modes = [...new Set(state.items.map(modeKey))].sort();
    box.replaceChildren(
      ...modes.map((m) =>
        el('button', {
          type: 'button', 'aria-pressed': String(state.modes.has(m)),
          onclick: () => { toggle(state.modes, m); update(); },
        }, m === '_none' ? 'ไม่ระบุ' : m)
      )
    );
  }
  function renderTagList(base) {
    const counts = new Map();
    for (const it of base) for (const k of it._tagKeys) counts.set(k, (counts.get(k) || 0) + 1);
    const f = $('tagq').value.trim().toLowerCase();
    let list = [...counts].filter(([k]) => !f || k.includes(f));
    list.sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
    const total = list.length;
    list = list.slice(0, f ? 200 : 40);
    $('tagList').replaceChildren(
      ...list.map(([k, n]) =>
        el('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.tags.has(k)), onclick: () => { toggle(state.tags, k); update(); } },
          tagNames.get(k) || k, el('small', {}, n))
      ),
      total > list.length ? el('span', { class: 'stat' }, `…และอีก ${total - list.length} แท็ก พิมพ์ค้นหาเพื่อดูเพิ่ม`) : null
    );
    $('tagCount').textContent = state.tags.size ? ` (${state.tags.size})` : '';
  }
  function renderSelectedTags() {
    $('selectedTags').replaceChildren(
      ...[...state.tags].map((k) =>
        el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', title: 'เอาออก', onclick: () => { state.tags.delete(k); update(); } },
          `${tagNames.get(k) || k}  ✕`)
      )
    );
  }

  function logo(it) {
    const initial = (it._coName.replace(/^(บริษัท|บจก\.?|ธนาคาร)\s*/, '')[0] || '?').toUpperCase();
    const fallback = () => el('div', { class: 'logo', 'aria-hidden': 'true' }, initial);
    const raw = it.company.logo || '';
    const src = raw.startsWith('/api/logo?') ? raw : safeUrl(raw);
    if (!src) return fallback();
    const img = el('img', { class: 'logo', src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    return img;
  }
  function payNode(it) {
    const { amount, label } = it.pay;
    if (!amount) return el('span', { class: 'pay none' }, label || 'ไม่ระบุค่าตอบแทน');
    return el('span', { class: 'pay' }, amount.toLocaleString('th-TH'), el('small', {}, label || 'บาท'));
  }
  function crowdPill(it) {
    const r = ratio(it);
    if (r == null) return null;
    const cls = r <= 1 ? 'ok' : r >= 5 ? 'warn' : '';
    return el('span', { class: `pill ${cls}`, title: 'นับจากจำนวนคนที่เพิ่มตำแหน่งนี้ไว้ในร่างของตน (ฟิลด์ inStudentDraftCount) หารด้วยจำนวนที่รับ ใช้เป็นตัวชี้วัดคร่าว ๆ เท่านั้น' },
      `${it.interest} คนสนใจ · ${r.toFixed(r < 10 ? 1 : 0)} ต่อ 1 อัตรา`);
  }

  function card(it, toks) {
    const tags = it.tags.slice(0, 5).map((t) => {
      const k = t.toLowerCase();
      return el('button', { type: 'button', class: `tag${state.tags.has(k) ? ' on' : ''}`, title: `กรองแท็ก: ${t}`, onclick: () => { toggle(state.tags, k); update(); } }, hl(t, toks));
    });
    return el('article', { class: `card${it.open ? '' : ' closed'}` },
      el('div', { class: 'head' },
        logo(it),
        el('div', {},
          el('button', { type: 'button', class: 'card-title', onclick: () => openDialog(it) }, hl(it.title, toks)),
          el('div', { class: 'company', title: it.company.en }, hl(it._coName || 'ไม่ระบุบริษัท', toks)),
          it.office ? el('div', { class: 'office' }, '📍 ', hl(it.office, toks)) : null
        )
      ),
      el('div', { class: 'meta' },
        it.mode ? el('span', { class: 'pill' }, it.mode) : null,
        it.coop ? el('span', { class: 'pill acc' }, 'สหกิจ') : null,
        !it.open ? el('span', { class: 'pill warn' }, 'ปิดรับ / ไม่มีอัตรา') : null,
        crowdPill(it)
      ),
      tags.length ? el('div', { class: 'tags' }, tags, it.tags.length > 5 ? el('span', { class: 'stat' }, `+${it.tags.length - 5}`) : null) : null,
      el('div', { class: 'foot' }, payNode(it), el('span', { class: 'stat' }, `รับ ${it.quota} อัตรา`))
    );
  }
  function renderList(result, toks) {
    const list = $('list');
    if (!result.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('p', {}, 'ไม่พบตำแหน่งที่ตรงกับเงื่อนไข'), el('button', { type: 'button', class: 'btn', onclick: resetFilters }, 'ล้างตัวกรอง')));
      return;
    }
    list.replaceChildren(...result.map((it) => card(it, toks)));
  }

  // ---------- detail dialog ----------
  function section(title, text) {
    return text ? el('div', {}, el('h3', {}, title), el('div', { class: 'text' }, text)) : null;
  }
  function openDialog(it) {
    const dlg = $('dlg');
    const mapsQ = encodeURIComponent((it.address.split('\n')[0] || it.office || it._coName).trim());
    const links = [
      el('a', { class: 'btn primary', href: `${SITE}/opening/${it.openingId}/session/${it.sessionId}`, target: '_blank', rel: 'noopener' }, 'เปิดในเว็บ CEDT'),
      it.company.id != null ? el('a', { class: 'btn', href: `${SITE}/company/profile/${it.company.id}`, target: '_blank', rel: 'noopener' }, 'โปรไฟล์บริษัท') : null,
      safeUrl(it.company.website) ? el('a', { class: 'btn', href: it.company.website, target: '_blank', rel: 'noopener noreferrer' }, 'เว็บไซต์บริษัท') : null,
      safeUrl(it.contact) ? el('a', { class: 'btn', href: it.contact, target: '_blank', rel: 'noopener noreferrer' }, 'ช่องทางติดต่อ') : null,
      it.office || it.address ? el('a', { class: 'btn', href: `https://www.google.com/maps/search/?api=1&query=${mapsQ}`, target: '_blank', rel: 'noopener' }, 'ดูแผนที่') : null,
    ];
    dlg.replaceChildren(
      el('div', { class: 'dlg-body' },
        el('div', {}, el('h2', {}, it.title), el('div', { class: 'company' }, it._coName, it.company.en && it.company.en !== it._coName ? ` · ${it.company.en}` : '')),
        el('div', { class: 'meta' },
          it.mode ? el('span', { class: 'pill' }, it.mode) : null,
          it.coop ? el('span', { class: 'pill acc' }, 'สหกิจ') : null,
          el('span', { class: 'pill' }, `รับ ${it.quota} อัตรา`),
          crowdPill(it)
        ),
        el('div', {}, payNode(it)),
        it.tags.length ? el('div', { class: 'tags' }, it.tags.map((t) => el('span', { class: 'tag' }, t))) : null,
        section('รายละเอียดงาน', it.desc),
        section('คุณสมบัติ', it.req),
        section('สถานที่', [it.office, it.address, it.transit].filter(Boolean).join('\n')),
        el('div', { class: 'actions' }, links, el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'ปิด'))
      )
    );
    dlg.showModal();
  }

  // ---------- helpers: state <-> url ----------
  function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
  const isFiltered = () => !!(state.q || state.modes.size || state.tags.size || state.paidOnly || state.coop || !state.openOnly || (state.sort && state.sort !== 'relevance'));
  function resetFilters() {
    Object.assign(state, { q: '', sort: '', openOnly: true, paidOnly: false, coop: false });
    state.modes.clear(); state.tags.clear();
    $('q').value = ''; $('tagq').value = '';
    syncControls(); update();
  }
  function syncControls() {
    $('q').value = state.q; $('openOnly').checked = state.openOnly; $('paidOnly').checked = state.paidOnly; $('coop').checked = state.coop;
  }
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.sem) p.set('sem', state.sem);
    if (state.q) p.set('q', state.q);
    if (state.sort) p.set('sort', state.sort);
    if (state.modes.size) p.set('mode', [...state.modes].join(','));
    if (state.tags.size) p.set('tag', [...state.tags].join(','));
    if (!state.openOnly) p.set('open', '0');
    if (state.paidOnly) p.set('paid', '1');
    if (state.coop) p.set('coop', '1');
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.sem = p.get('sem');
    state.q = p.get('q') || '';
    state.sort = p.get('sort') || '';
    (p.get('mode') || '').split(',').filter(Boolean).forEach((m) => state.modes.add(m));
    (p.get('tag') || '').split(',').filter(Boolean).forEach((t) => state.tags.add(t));
    state.openOnly = p.get('open') !== '0';
    state.paidOnly = p.get('paid') === '1';
    state.coop = p.get('coop') === '1';
  }

  // ---------- data loading (stale-while-revalidate with localStorage) ----------
  const cacheGet = (key) => {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_PREFIX + key));
      return v && Date.now() - v.savedAt < CACHE_MAX_AGE ? v.data : null;
    } catch { return null; }
  };
  const cacheSet = (key, data) => {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* quota/private mode */ }
  };

  function apply(data, fromCache) {
    state.semesters = data.semesters;
    state.sem = data.semester;
    state.meta = data;
    state.fromCache = fromCache;
    tagNames.clear();
    state.items = data.items.map(prep);
    const sel = $('sem');
    sel.replaceChildren(...data.semesters.map((s) => el('option', { value: s.id }, s.label)));
    sel.value = data.semester;
    renderStatus();
    update();
  }
  const fmt = (iso) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  function renderStatus(note) {
    const m = state.meta;
    const s = $('status');
    if (!m) { s.textContent = note || 'โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง'; return; }
    const label = (m.semesters.find((x) => x.id === m.semester) || {}).label || m.semester;
    const parts = [];
    if (m.fallback) parts.push(`ดึงข้อมูลสดไม่สำเร็จ แสดงข้อมูลเก็บถาวรรอบ ${m.fallback.label} แทน`);
    else if (m.source === 'live') parts.push(`ข้อมูลสด · อัปเดตล่าสุด ${fmt(m.fetchedAt)}`);
    else if (m.source === 'stale') parts.push(`ดึงข้อมูลสดใหม่ไม่สำเร็จ ใช้ข้อมูลที่ดึงไว้เมื่อ ${fmt(m.fetchedAt)}`);
    else parts.push(`ข้อมูลเก็บถาวรรอบ ${label}`);
    if (m.upstreamError) parts.push(`(${m.upstreamError})`);
    if (note) parts.push(`· ${note}`);
    else if (state.fromCache) parts.push('· กำลังตรวจสอบข้อมูลใหม่…');
    s.textContent = parts.join(' ');
  }

  async function load(sem) {
    const key = sem || 'default';
    const cached = cacheGet(key);
    if (cached) apply(cached, true);
    else $('list').replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'skeleton' })));
    try {
      const res = await fetch(`/api/jobs${sem ? `?semester=${encodeURIComponent(sem)}` : ''}`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.fallback && cached) { // keep the better cached copy instead of replacing it with an archive
        state.meta = { ...state.meta, upstreamError: data.upstreamError };
        state.fromCache = false;
        renderStatus('ดึงข้อมูลสดใหม่ไม่สำเร็จ ใช้ข้อมูลที่แคชไว้ในเครื่อง');
        return;
      }
      if (!data.fallback) { cacheSet(data.semester, data); if (!sem) cacheSet('default', data); }
      apply(data, false);
    } catch (err) {
      console.error(err);
      renderStatus(state.meta ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ แสดงข้อมูลจากแคชในเครื่อง' : null);
    }
  }

  // ---------- wire up ----------
  function init() {
    readUrl();
    syncControls();
    let timer;
    $('q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value; update(); }, 120);
    });
    $('q').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('q').value) { $('q').value = ''; state.q = ''; update(); }
    });
    $('sort').addEventListener('change', (e) => { state.sort = e.target.value; update(); });
    $('sem').addEventListener('change', (e) => { state.tags.clear(); load(e.target.value); });
    for (const id of ['openOnly', 'paidOnly', 'coop']) $(id).addEventListener('change', (e) => { state[id] = e.target.checked; update(); });
    $('tagq').addEventListener('input', () => { if (state.items.length) update(); });
    $('reset').addEventListener('click', resetFilters);
    $('dlg').addEventListener('click', (e) => { if (e.target === $('dlg')) $('dlg').close(); });
    document.addEventListener('click', (e) => { const tb = $('tagbox'); if (tb.open && !tb.contains(e.target)) tb.open = false; });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
    });
    load(state.sem);
  }
  init();
})();
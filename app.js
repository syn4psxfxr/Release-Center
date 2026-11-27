/* Copilot Release Center — static site for GitHub Pages.
 * Data lives in /data/*.json and is refreshed by a GitHub Action (scripts/fetch-data.mjs).
 * The refresh button reloads that data and queries the Message Center feed live
 * (mc.merill.net allows CORS; the official Roadmap API does not, so it is only refreshed by the Action).
 */
(() => {
  'use strict';

  const MC_RSS = 'https://mc.merill.net/rss.xml';
  const COPILOT_CATS = ['Microsoft Copilot (Microsoft 365)', 'Microsoft 365 Copilot Chat', 'Microsoft 365 Copilot'];
  const NON_M365 = /power platform|copilot studio|dynamics|github copilot|security copilot/i;
  const PAGE = 25;
  const DAY = 864e5;
  const STATUS_CLS = { 'Launched': 'st-launched', 'Rolling out': 'st-rolling', 'In development': 'st-dev', 'Cancelled': 'st-cancel' };

  // ---------- per-browser storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('crc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('crc:' + k, JSON.stringify(v)); } catch { /* unavailable */ } },
  };
  let baseline = store.get('baseline', null);
  // New-item dots only for updates that arrive after your first visit
  if (!baseline) { baseline = Date.now(); store.set('baseline', baseline); }
  const readSet = new Set(store.get('read', []));
  const saveRead = () => store.set('read', [...readSet].slice(-5000));

  // ---------- state ----------
  const S = { roadmap: [], mc: [], meta: {}, tab: 'all', shown: PAGE, liveAt: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtShort = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const month = (s) => (s || '').replace(/\s*CY/, ' ');
  // Drop the repetitive product prefix ("Microsoft Copilot (Microsoft 365): ...") for a cleaner list
  const cleanTitle = (t) => (t || '').replace(/^\s*(Microsoft\s+Copilot\s*\(Microsoft 365\)|Microsoft 365 Copilot( Chat)?|M365 Copilot|Microsoft Copilot)\s*[:|-]\s*/i, '').replace(/^./, (c) => c.toUpperCase());

  const normRoadmap = (x) => ({
    src: 'rm', id: x.id, key: `rm:${x.id}:${x.modified}`, title: x.title, description: x.description, url: x.url,
    status: x.status, groups: x.products, date: x.modified, ga: x.gaDate, preview: x.previewDate,
  });
  const normMc = (x) => ({
    src: 'mc', id: x.id, key: `mc:${x.id}`, title: x.title, description: x.description, url: x.url,
    status: null, groups: x.categories, date: x.published,
  });
  const allItems = () => [...S.roadmap.map(normRoadmap), ...S.mc.map(normMc)];
  const items = () => S.tab === 'roadmap' ? S.roadmap.map(normRoadmap) : S.tab === 'mc' ? S.mc.map(normMc) : allItems();
  const isNew = (it) => new Date(it.date).getTime() > baseline && !readSet.has(it.key);

  // ---------- data ----------
  async function loadJson(path) {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function loadData() {
    const [rm, mc, meta] = await Promise.all([loadJson('data/roadmap.json'), loadJson('data/messagecenter.json'), loadJson('data/meta.json').catch(() => ({}))]);
    S.roadmap = rm; S.meta = meta;
    const live = S.mc.filter((m) => m.live && !mc.some((x) => x.id === m.id));
    S.mc = [...live, ...mc];
  }

  async function liveMessageCenter() {
    const r = await fetch(MC_RSS, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
    const known = new Set(S.mc.map((m) => m.id));
    for (const el of doc.querySelectorAll('item')) {
      const t = (q) => el.querySelector(q)?.textContent?.trim() || '';
      const full = t('title'); const m = full.match(/^(MC\d+):\s*(.*)$/);
      const cats = [...el.querySelectorAll('category')].map((c) => c.textContent.trim()).filter((c) => c !== 'Message Center');
      const msg = { id: m ? m[1] : t('guid'), title: m ? m[2] : full, description: t('description'), categories: cats, published: new Date(t('pubDate')).toISOString(), url: t('link'), live: true };
      const copilot = cats.some((c) => COPILOT_CATS.includes(c)) ||
        (/\bcopilot\b/i.test(msg.title) && !NON_M365.test(msg.title) && !cats.some((c) => /power platform|power bi|dynamics|dataverse/i.test(c)));
      if (copilot && !known.has(msg.id)) { S.mc.push(msg); known.add(msg.id); }
    }
    S.mc.sort((a, b) => b.published.localeCompare(a.published));
    S.liveAt = Date.now();
  }

  // ---------- UI ----------
  function toast(msg, err) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function renderSummary() {
    const since = Date.now() - 30 * DAY;
    const mc30 = S.mc.filter((x) => new Date(x.published) >= since).length;
    const rolling = S.roadmap.filter((x) => x.status === 'Rolling out').length;
    const dev = S.roadmap.filter((x) => x.status === 'In development').length;
    const stats = [
      { v: mc30, l: 'Announcements, last 30 days', go: { tab: 'mc', period: '30' } },
      { v: rolling, l: 'Rolling out now', go: { tab: 'roadmap', status: 'Rolling out', period: '0' } },
      { v: dev, l: 'In development', go: { tab: 'roadmap', status: 'In development', period: '0' } },
    ];
    $('summary').innerHTML = stats.map((s, i) => `<button class="stat" type="button" data-stat="${i}"><span class="v">${s.v.toLocaleString('en-US')}</span><span class="l">${s.l}</span></button>`).join('');
    $('summary').querySelectorAll('[data-stat]').forEach((b) => b.onclick = () => {
      const g = stats[b.dataset.stat].go;
      setTab(g.tab);
      $('fStatus').value = g.status || ''; $('fPeriod').value = g.period; $('fProduct').value = ''; $('q').value = '';
      render(); $('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function setupFilters() {
    const all = items();
    const st = $('fStatus'); const prev = st.value;
    const statuses = ['Rolling out', 'In development', 'Launched', 'Cancelled'].filter((s) => all.some((i) => i.status === s));
    st.innerHTML = `<option value="">All statuses</option>` + statuses.map((s) => `<option>${esc(s)}</option>`).join('');
    st.value = statuses.includes(prev) ? prev : '';
    st.hidden = S.tab === 'mc';

    const fp = $('fProduct'); const pv = fp.value;
    const cnt = {}; all.forEach((i) => (i.groups || []).forEach((g) => { cnt[g] = (cnt[g] || 0) + 1; }));
    const groups = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    fp.innerHTML = `<option value="">All products</option>` + groups.map((g) => `<option>${esc(g)}</option>`).join('');
    fp.value = groups.includes(pv) ? pv : '';
  }

  function filtered() {
    const q = $('q').value.trim().toLowerCase();
    const st = $('fStatus').value, pr = $('fProduct').value, days = Number($('fPeriod').value);
    const since = days ? Date.now() - days * DAY : 0;
    return items()
      .filter((i) =>
        (!q || `${i.id} ${i.title} ${i.description}`.toLowerCase().includes(q)) &&
        (!st || S.tab === 'mc' || i.status === st) &&
        (!pr || (i.groups || []).includes(pr)) &&
        (!since || new Date(i.date).getTime() >= since))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function groupLabel(d) {
    const days = (Date.now() - new Date(d).getTime()) / DAY;
    if (days < 7) return 'This week';
    if (days < 14) return 'Last week';
    return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function item(i) {
    const tag = i.status
      ? `<span class="tag ${STATUS_CLS[i.status] || ''}">${esc(i.status)}</span>`
      : `<span class="tag">${S.tab === 'mc' ? fmtShort(i.date) : 'Announcement'}</span>`;
    const meta = [
      `<span>${i.src === 'rm' ? 'Roadmap' : 'Message Center'} ${esc(i.id)}</span>`,
      `<span>${i.src === 'rm' ? 'Updated' : 'Published'} ${fmtDate(i.date)}</span>`,
      i.preview ? `<span>Preview ${esc(month(i.preview))}</span>` : '',
      i.ga ? `<span>GA ${esc(month(i.ga))}</span>` : '',
      `<span><a href="${esc(i.url)}" target="_blank" rel="noopener">Open source ↗</a></span>`,
    ].join('');
    return `<div class="item" data-key="${esc(i.key)}">
      <button class="row" type="button" aria-expanded="false">
        <span class="t">${isNew(i) ? '<span class="dot" title="New"></span>' : ''}${esc(cleanTitle(i.title))}</span>${tag}
      </button>
      <div class="detail" hidden>${i.description ? `<p>${esc(i.description)}</p>` : ''}<div class="meta">${meta}</div></div>
    </div>`;
  }

  function render() {
    const list = filtered();
    const shown = list.slice(0, S.shown);
    let html = '', last = '';
    for (const i of shown) {
      const g = groupLabel(i.date);
      if (g !== last) { html += `<h2 class="group">${g}</h2>`; last = g; }
      html += item(i);
    }
    $('list').innerHTML = html || `<div class="empty">Nothing here with these filters.<br><button class="text-btn" type="button" data-clear>Reset filters</button></div>`;
    $('btnMore').hidden = list.length <= shown.length;
    $('btnMore').textContent = `Show more (${(list.length - shown.length).toLocaleString('en-US')})`;
    const active = [$('fStatus').value, $('fProduct').value, $('fPeriod').value !== '30' ? 1 : ''].filter(Boolean).length;
    $('filterCount').textContent = active ? `· ${active}` : '';
  }

  function renderHeader() {
    const r = S.meta?.lastRun;
    const t = S.liveAt && (!r || S.liveAt > new Date(r)) ? S.liveAt : r;
    $('lastUpdate').textContent = t ? `Updated ${new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  }

  function setTab(tab) {
    S.tab = tab; S.shown = PAGE;
    document.querySelectorAll('.seg button').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    setupFilters();
  }

  function resetFilters() {
    $('q').value = ''; $('fStatus').value = ''; $('fProduct').value = ''; $('fPeriod').value = '30';
    S.shown = PAGE; render();
  }

  function refreshAll() { renderHeader(); renderSummary(); setupFilters(); render(); }

  async function check() {
    const b = $('btnCheck'); b.disabled = true; b.classList.add('spin');
    const before = S.roadmap.length + S.mc.length;
    let err = false;
    try { await loadData(); } catch { err = true; }
    try { await liveMessageCenter(); } catch { err = true; }
    const found = S.roadmap.length + S.mc.length - before;
    refreshAll(); b.disabled = false; b.classList.remove('spin');
    toast(found > 0 ? `${found} new ${found === 1 ? 'update' : 'updates'} found.` : err ? 'Could not reach one of the sources. Try again later.' : 'You are up to date.', err && found <= 0);
  }

  function setupWorkflowLink() {
    const h = location.hostname;
    if (!h.endsWith('.github.io')) return;
    const owner = h.replace('.github.io', '');
    const seg = location.pathname.split('/').filter(Boolean)[0];
    const repo = seg && !seg.includes('.') ? seg : h;
    $('wfLink').innerHTML = ` · <a href="https://github.com/${esc(owner)}/${esc(repo)}/actions/workflows/update-data.yml" target="_blank" rel="noopener">run now</a>`;
  }

  // ---------- theme ----------
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store.get('theme', null));
  $('btnTheme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; applyTheme(next); store.set('theme', next);
  };

  // ---------- events ----------
  document.querySelectorAll('.seg button').forEach((t) => t.onclick = () => { setTab(t.dataset.tab); render(); });
  ['q', 'fStatus', 'fProduct', 'fPeriod'].forEach((id) => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => { S.shown = PAGE; render(); }));
  $('btnFilters').onclick = () => { const f = $('filters'); f.hidden = !f.hidden; $('btnFilters').setAttribute('aria-expanded', String(!f.hidden)); };
  $('btnReset').onclick = resetFilters;
  $('btnMore').onclick = () => { S.shown += PAGE; render(); };
  $('btnCheck').onclick = check;
  $('list').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { resetFilters(); return; }
    const row = e.target.closest('.row'); if (!row) return;
    const it = row.parentElement, d = it.querySelector('.detail');
    d.hidden = !d.hidden; row.setAttribute('aria-expanded', String(!d.hidden));
    if (!readSet.has(it.dataset.key)) { readSet.add(it.dataset.key); saveRead(); row.querySelector('.dot')?.remove(); }
  });

  // ---------- start ----------
  setupWorkflowLink();
  loadData().then(refreshAll).catch((e) => { toast(`Could not load data (${e.message}).`, true); refreshAll(); });
})();

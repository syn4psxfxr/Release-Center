/* Copilot Release Center — static site for GitHub Pages.
 * Data lives in /data/*.json and is refreshed by a GitHub Action (scripts/fetch-data.mjs).
 * "Check for updates" reloads that data and queries the Message Center feed live
 * (mc.merill.net allows CORS; the official Roadmap API does not, so it is only refreshed by the Action).
 */
(() => {
  'use strict';

  const MC_RSS = 'https://mc.merill.net/rss.xml';
  const COPILOT_CATS = ['Microsoft Copilot (Microsoft 365)', 'Microsoft 365 Copilot Chat', 'Microsoft 365 Copilot'];
  const NON_M365 = /power platform|copilot studio|dynamics|github copilot|security copilot/i;
  const PAGE = 30;
  const DAY = 864e5;

  const STATUS_CLS = { 'Launched': 'st-launched', 'Rolling out': 'st-rolling', 'In development': 'st-dev', 'Cancelled': 'st-cancel' };
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  // ---------- per-browser storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('crc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('crc:' + k, JSON.stringify(v)); } catch { /* unavailable */ } },
  };
  let baseline = store.get('baseline', null);
  if (!baseline) { baseline = Date.now() - 14 * DAY; store.set('baseline', baseline); }
  const readSet = new Set(store.get('read', []));
  const saveRead = () => store.set('read', [...readSet].slice(-5000));

  // ---------- state ----------
  const S = { roadmap: [], mc: [], meta: {}, tab: 'all', shown: PAGE, liveAt: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const fmtDateTime = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const shortMonth = (s) => (s || '').replace(/\s*CY/, ' ').replace(/^(\w{3})\w*/, '$1');
  const gaKey = (s) => { const m = (s || '').match(/(\w+)\s+CY(\d{4})/); const i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1; return i < 0 ? 1e9 : Number(m[2]) * 12 + i; };

  const normRoadmap = (x) => ({
    src: 'rm', id: x.id, key: `rm:${x.id}:${x.modified}`, title: x.title, description: x.description, url: x.url,
    status: x.status, groups: x.products, date: x.modified, ga: x.gaDate,
    isUpdate: x.modified && x.created && x.modified.slice(0, 10) !== x.created.slice(0, 10),
  });
  const normMc = (x) => ({
    src: 'mc', id: x.id, key: `mc:${x.id}`, title: x.title, description: x.description, url: x.url,
    status: null, groups: x.categories, date: x.published,
  });
  const items = () => {
    if (S.tab === 'roadmap') return S.roadmap.map(normRoadmap);
    if (S.tab === 'mc') return S.mc.map(normMc);
    return [...S.roadmap.map(normRoadmap), ...S.mc.map(normMc)];
  };
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
    let added = 0;
    for (const el of doc.querySelectorAll('item')) {
      const t = (q) => el.querySelector(q)?.textContent?.trim() || '';
      const full = t('title'); const m = full.match(/^(MC\d+):\s*(.*)$/);
      const cats = [...el.querySelectorAll('category')].map((c) => c.textContent.trim()).filter((c) => c !== 'Message Center');
      const msg = { id: m ? m[1] : t('guid'), title: m ? m[2] : full, description: t('description'), categories: cats, published: new Date(t('pubDate')).toISOString(), url: t('link'), live: true };
      const copilot = cats.some((c) => COPILOT_CATS.includes(c)) ||
        (/\bcopilot\b/i.test(msg.title) && !NON_M365.test(msg.title) && !cats.some((c) => /power platform|power bi|dynamics|dataverse/i.test(c)));
      if (copilot && !known.has(msg.id)) { S.mc.push(msg); known.add(msg.id); added++; }
    }
    S.mc.sort((a, b) => b.published.localeCompare(a.published));
    S.liveAt = Date.now();
    return added;
  }

  // ---------- UI ----------
  function toast(msg, err) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 6000);
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
    const st = $('fStatus').value, pr = $('fProduct').value, days = Number($('fPeriod').value), onlyNew = $('fUnread').checked;
    const since = days ? Date.now() - days * DAY : 0;
    return items()
      .filter((i) =>
        (!q || `${i.id} ${i.title} ${i.description}`.toLowerCase().includes(q)) &&
        (!st || S.tab === 'mc' || i.status === st) &&
        (!pr || (i.groups || []).includes(pr)) &&
        (!since || new Date(i.date).getTime() >= since) &&
        (!onlyNew || isNew(i)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function row(i) {
    const sep = '<span class="sep">·</span>';
    const meta = [
      i.src === 'rm' ? 'Roadmap' : 'Message Center',
      esc(i.id),
      i.status ? `<span class="${STATUS_CLS[i.status] || ''}">${esc(i.status)}</span>` : '',
      i.src === 'rm' ? `${i.isUpdate ? 'Updated' : 'Added'} ${fmtDate(i.date)}` : fmtDate(i.date),
      i.ga ? `GA ${esc(shortMonth(i.ga))}` : '',
    ].filter(Boolean).join(sep);
    return `<article class="item" data-key="${esc(i.key)}">
      <h3>${isNew(i) ? '<span class="dot" title="New"></span>' : ''}<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <div class="meta">${meta}</div>
      ${i.description ? `<p class="desc" title="Click to expand">${esc(i.description)}</p>` : ''}
    </article>`;
  }

  function render() {
    const list = filtered();
    const shown = list.slice(0, S.shown);
    $('resultInfo').textContent = `${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'update' : 'updates'}`;
    $('list').innerHTML = shown.length ? shown.map(row).join('') : `<div class="empty">No updates match these filters.</div>`;
    $('btnMore').hidden = list.length <= shown.length;
    const n = [...S.roadmap.map(normRoadmap), ...S.mc.map(normMc)].filter(isNew).length;
    $('unreadLabel').textContent = n ? `New only (${n})` : 'New only';
    $('cRoadmap').textContent = S.roadmap.length;
    $('cMc').textContent = S.mc.length;
  }

  function renderHeader() {
    const r = S.meta?.lastRun;
    const failed = Object.values(S.meta?.sources || {}).some((s) => !s.ok);
    $('lastUpdate').textContent = r ? `Updated ${fmtDateTime(S.liveAt && S.liveAt > new Date(r) ? S.liveAt : r)}${failed ? ' · last sync had errors' : ''}` : '';
  }

  function setTab(tab) {
    S.tab = tab; S.shown = PAGE;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    setupFilters();
  }

  function refreshAll() { renderHeader(); setupFilters(); render(); }

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
    $('wfLink').innerHTML = ` · <a href="https://github.com/${esc(owner)}/${esc(repo)}/actions/workflows/update-data.yml" target="_blank" rel="noopener">run it now</a>`;
  }

  // ---------- theme ----------
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store.get('theme', null));
  $('btnTheme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; applyTheme(next); store.set('theme', next);
  };

  // ---------- events ----------
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { setTab(t.dataset.tab); render(); });
  ['q', 'fStatus', 'fProduct', 'fPeriod', 'fUnread'].forEach((id) => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => { S.shown = PAGE; render(); }));
  $('btnMore').onclick = () => { S.shown += PAGE; render(); };
  $('btnCheck').onclick = check;
  $('btnMarkAll').onclick = () => { items().forEach((i) => readSet.add(i.key)); saveRead(); render(); };
  $('list').addEventListener('click', (e) => {
    const item = e.target.closest('.item'); if (!item) return;
    if (e.target.closest('.desc')) item.classList.toggle('open');
    if (e.target.closest('a, .desc') && !readSet.has(item.dataset.key)) {
      readSet.add(item.dataset.key); saveRead();
      item.querySelector('.dot')?.remove();
      const n = [...S.roadmap.map(normRoadmap), ...S.mc.map(normMc)].filter(isNew).length;
      $('unreadLabel').textContent = n ? `New only (${n})` : 'New only';
    }
  });

  // ---------- start ----------
  setupWorkflowLink();
  loadData().then(refreshAll).catch((e) => { toast(`Could not load data (${e.message}).`, true); refreshAll(); });
})();

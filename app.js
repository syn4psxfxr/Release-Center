/* Copilot Release Center — static site for GitHub Pages.
 * Data lives in /data/*.json and is refreshed every 6 hours by a GitHub Action (scripts/fetch-data.mjs).
 * The refresh button reloads that data and checks the Message Center RSS feed live for brand-new posts.
 */
(() => {
  'use strict';

  const MC_RSS = 'https://mc.merill.net/rss.xml';
  const COPILOT_CATS = ['Microsoft Copilot (Microsoft 365)', 'Microsoft 365 Copilot Chat', 'Microsoft 365 Copilot'];
  const NON_M365 = /power platform|power automate|power apps|power pages|copilot studio|dynamics|github copilot|security copilot|power bi|dataverse|fabric/i;
  const PAGE = 40;
  const DAY = 864e5;
  const ADMIN_DAYS = 90;       // "Admin Center" tab window
  const URGENT_RECENT_DAYS = 30; // undated urgent posts stay listed this long
  const NO_DATE_DAYS = 45;     // undated Message Center posts stay in "Upcoming" this long
  const STATUS_CLS = { 'Launched': 'st-launched', 'Rolling out': 'st-rolling', 'In development': 'st-dev', 'Cancelled': 'st-cancel' };

  const THEMES = [
    ['action', 'Action needed'],
    ['frontier', 'Frontier'],
    ['cowork', 'Cowork'],
    ['agents', 'Agents'],
    ['models', 'AI models'],
    ['admin', 'Admin & governance'],
    ['retirement', 'Retirements'],
  ];
  const THEME_RE = {
    frontier: /\bfrontier\b/i, cowork: /\bcowork\b/i,
    agents: /\bagents?\b|autopilot|researcher|analyst agent|facilitator/i,
    models: /\bgpt[- ]?\d|claude|\bmodels?\b|anthropic|openai/i,
    admin: /\badmins?\b|admin center|polic(y|ies)|governance|controls?\b|settings?\b|licens|billing|credits|compliance|purview|data boundary|retention|audit|security|permissions?/i,
    retirement: /retir|deprecat|end of support|no longer (be )?(available|supported)|sunset/i,
  };

  // ---------- per-browser storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('crc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('crc:' + k, JSON.stringify(v)); } catch { /* unavailable */ } },
  };
  let baseline = store.get('baseline', null);
  if (!baseline) { baseline = Date.now(); store.set('baseline', baseline); }
  const readSet = new Set(store.get('read', []));
  const saveRead = () => store.set('read', [...readSet].slice(-5000));

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = (s) => new Date(s.length === 10 ? s + 'T12:00:00' : s);
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const monthStartStr = () => todayStr().slice(0, 8) + '01';
  const fmtDay = (s) => D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtDate = (s) => D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtMonth = (s) => D(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const fmtMonthShort = (s) => D(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const cleanTitle = (t) => (t || '')
    .replace(/^\s*(Microsoft\s+Copilot\s*\(Microsoft 365\)|Microsoft 365 Copilot( Chat)?|M365 Copilot|Microsoft Copilot)\s*[:|-]\s*/i, '')
    .replace(/^./, (c) => c.toUpperCase());

  // ---------- state ----------
  const S = { roadmap: [], mc: [], meta: {}, view: 'upcoming', theme: '', soon: false, shown: PAGE, liveAt: null, all: [] };

  // Normalize both sources into one shape, and work out *when* each item lands
  function normRoadmap(x) {
    const it = {
      src: 'rm', id: x.id, key: `rm:${x.id}:${x.modified}`, title: x.title, description: x.description, url: x.url,
      status: x.status, date: x.modified, themes: x.themes || [], preview: x.preview, ga: x.ga,
      previewLabel: x.previewDate, gaLabel: x.gaDate, platforms: x.platforms || [], action: false,
    };
    if (x.status === 'In development' || x.status === 'Rolling out') {
      const ms = monthStartStr();
      const next = [['Preview', x.preview], ['GA', x.ga]].filter(([, d]) => d && d >= ms).sort((a, b) => a[1].localeCompare(b[1]))[0];
      if (next) {
        it.bucket = next[1].slice(0, 7); it.sortDate = next[1];
        it.when = `${next[0]} ${fmtMonthShort(next[1])}`;
        if (next[0] === 'Preview' && x.ga && x.ga > next[1]) it.when += ` · GA ${fmtMonthShort(x.ga)}`;
      } else if (x.status === 'Rolling out') { it.bucket = 'now'; it.sortDate = x.modified; it.when = 'Rolling out'; }
      else { it.bucket = 'tbd'; it.sortDate = x.modified; it.when = 'Date to be confirmed'; }
    }
    return it;
  }

  function normMc(x) {
    const it = {
      src: 'mc', id: x.id, key: `mc:${x.id}`, title: x.title, description: x.description, url: x.url,
      status: null, date: x.published, themes: [...(x.themes || [])], schedule: x.schedule, prep: x.action,
      action: !!x.actionRequired || /action (may be |is )?required/i.test(x.title), tags: x.tags || [], major: !!x.major, live: x.live,
    };
    if (it.action && !it.themes.includes('action')) it.themes.push('action');
    const today = todayStr();
    const dates = x.dates || [];
    const future = dates.filter((d) => d >= today);
    it.next = future[0] || null;
    // Urgent = needs admin action, is a retirement, or is flagged as a major change by Microsoft,
    // and is still ahead of us (a future date, or a recent post with no date yet)
    it.urgent = (it.action || it.themes.includes('retirement') || it.major) &&
      (future.length > 0 || (!dates.length && Date.now() - D(x.published) < URGENT_RECENT_DAYS * DAY));
    if (future.length && dates[0] >= today) {
      it.bucket = dates[0].slice(0, 7); it.sortDate = dates[0];
      it.when = `${it.themes.includes('retirement') ? 'Changes' : 'Starts'} ${fmtDay(dates[0])}`;
    } else if (future.length) {
      it.bucket = 'now'; it.sortDate = future[future.length - 1];
      it.when = `Until ${fmtDay(future[future.length - 1])}`;
    } else if (!dates.length && Date.now() - D(x.published) < NO_DATE_DAYS * DAY && !/available now|is now (available|live|rolling)/i.test(`${x.schedule} ${x.title}`)) {
      it.bucket = 'tbd'; it.sortDate = x.published; it.when = 'Date not announced';
    }
    return it;
  }

  function rebuild() {
    S.all = [...S.roadmap.map(normRoadmap), ...S.mc.map(normMc)];
  }

  const isNew = (it) => D(it.date).getTime() > baseline && !readSet.has(it.key);
  const isSoon = (it) => it.bucket && it.bucket !== 'tbd' && it.bucket !== 'now' && D(it.sortDate) - Date.now() <= 30 * DAY;
  const upcoming = () => S.all.filter((i) => i.bucket);
  const adminFeed = () => S.all.filter((i) => i.src === 'mc' && Date.now() - D(i.date) <= ADMIN_DAYS * DAY);
  const urgentSet = () => S.all.filter((i) => i.urgent);

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
    rebuild();
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
      const title = m ? m[2] : full;
      const copilot = cats.some((c) => COPILOT_CATS.includes(c)) || (/\bcopilot\b/i.test(title) && !NON_M365.test(title) && !cats.some((c) => NON_M365.test(c)));
      const id = m ? m[1] : t('guid');
      if (!copilot || known.has(id)) continue;
      const description = t('description');
      S.mc.push({ id, title, description, published: new Date(t('pubDate')).toISOString(), url: t('link'), live: true,
        themes: Object.keys(THEME_RE).filter((k) => THEME_RE[k].test(`${title} ${description}`)), dates: [] });
      known.add(id); added++;
    }
    S.mc.sort((a, b) => String(b.published).localeCompare(String(a.published)));
    S.liveAt = Date.now();
    rebuild();
    return added;
  }

  // ---------- rendering ----------
  function toast(msg, err) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function renderSummary() {
    const up = upcoming();
    const urgent = urgentSet().length;
    $('urgentCount').textContent = urgent || '';
    const stats = [
      { v: up.filter(isSoon).length, l: 'Landing in the next 30 days', view: 'upcoming', on: S.view === 'upcoming' && S.soon && !S.theme, go: () => { S.soon = true; S.theme = ''; } },
      { v: urgent, l: 'Urgent for admins', alert: true, view: 'urgent', on: S.view === 'urgent' && !S.theme, go: () => { S.soon = false; S.theme = ''; } },
      { v: up.filter((i) => i.themes.includes('frontier')).length, l: 'Frontier releases ahead', view: 'upcoming', on: S.view === 'upcoming' && S.theme === 'frontier', go: () => { S.soon = false; S.theme = 'frontier'; } },
    ];
    $('summary').innerHTML = stats.map((s, i) =>
      `<button class="stat${s.alert && s.v ? ' alert' : ''}${s.on ? ' on' : ''}" type="button" data-stat="${i}"><span class="v">${s.v}</span><span class="l">${s.l}</span></button>`).join('');
    $('summary').querySelectorAll('[data-stat]').forEach((b) => b.onclick = () => {
      const s = stats[b.dataset.stat]; s.go(); setView(s.view); S.shown = PAGE; renderAll();
      $('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function baseSet() {
    const q = $('q').value.trim().toLowerCase();
    const set = S.view === 'upcoming' ? upcoming() : S.view === 'urgent' ? urgentSet() : adminFeed();
    return set.filter((i) => !q || `${i.id} ${i.title} ${i.description} ${i.schedule || ''}`.toLowerCase().includes(q));
  }

  // One quiet dropdown instead of a row of theme chips
  function renderTopics(set) {
    const count = (k) => set.filter((i) => i.themes.includes(k)).length;
    const opts = [['', `All topics`]];
    if (S.view === 'upcoming') opts.push(['__soon', `Next 30 days (${set.filter(isSoon).length})`]);
    THEMES.forEach(([k, l]) => { const n = count(k); if (n || S.theme === k) opts.push([k, `${l} (${n})`]); });
    $('fTopic').innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    $('fTopic').value = S.soon ? '__soon' : S.theme;
    if ($('fTopic').value !== (S.soon ? '__soon' : S.theme)) { S.soon = false; S.theme = ''; $('fTopic').value = ''; }
  }

  function groupOf(i) {
    if (S.view === 'upcoming') {
      if (i.bucket === 'now') return ['now', 'Already rolling out'];
      if (i.bucket === 'tbd') return ['tbd', 'Date to be confirmed'];
      return [i.bucket, i.bucket === todayStr().slice(0, 7) ? `This month · ${fmtMonth(i.bucket + '-01')}` : fmtMonth(i.bucket + '-01')];
    }
    if (S.view === 'urgent') {
      if (!i.next) return ['u9', 'Date not announced'];
      const days = (D(i.next) - Date.now()) / DAY;
      if (days <= 7) return ['u0', 'Next 7 days'];
      if (days <= 30) return ['u1', 'Next 30 days'];
      return ['u2', 'Later'];
    }
    const days = (Date.now() - D(i.date)) / DAY;
    if (days < 7) return ['w0', 'This week'];
    if (days < 14) return ['w1', 'Last week'];
    return [i.date.slice(0, 7), fmtMonth(i.date.slice(0, 7) + '-01')];
  }

  function itemHtml(i) {
    // Second line only when it matters: why it is urgent, or that admins must act
    const sub = S.view === 'urgent'
      ? [i.action ? '<span class="act">Action needed</span>' : '', i.themes.includes('retirement') ? 'Retirement' : '', i.major ? 'Major change' : ''].filter(Boolean).join('<i>·</i>')
      : i.action ? '<span class="act">Action needed</span>' : '';
    let when;
    if (S.view === 'upcoming') when = `<span class="when">${esc(i.when)}</span>`;
    else if (S.view === 'urgent') {
      const soon = i.next && D(i.next) - Date.now() <= 7 * DAY;
      const label = i.next ? fmtDay(i.next) : 'No date yet';  // next key date from the rollout schedule
      when = `<span class="when${soon ? ' urgent' : ''}">${esc(label)}</span>`;
    } else when = `<span class="when">${fmtDay(i.date)}</span>`;
    const meta = [
      `<span>${i.src === 'rm' ? 'Roadmap' : 'Message Center'} ${esc(i.id)}</span>`,
      i.status ? `<span class="${STATUS_CLS[i.status] || ''}">${esc(i.status)}</span>` : '',
      i.previewLabel ? `<span>Preview ${esc(i.previewLabel.replace(' CY', ' '))}</span>` : '',
      i.gaLabel ? `<span>GA ${esc(i.gaLabel.replace(' CY', ' '))}</span>` : '',
      `<span>${i.src === 'rm' ? 'Updated' : 'Published'} ${fmtDate(i.date)}</span>`,
      `<span><a href="${esc(i.url)}" target="_blank" rel="noopener">Open ↗</a></span>`,
      i.src === 'mc' ? `<span><a href="https://admin.microsoft.com/#/MessageCenter/:/messages/${esc(i.id)}" target="_blank" rel="noopener">Admin center ↗</a></span>` : '',
    ].join('');
    return `<div class="item" data-key="${esc(i.key)}">
      <button class="row" type="button" aria-expanded="false">
        <span><span class="t">${isNew(i) ? '<span class="dot" title="New since your last visit"></span>' : ''}${esc(cleanTitle(i.title))}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</span>${when}
      </button>
      <div class="detail" hidden>
        ${i.description ? `<p>${esc(i.description)}</p>` : ''}
        ${i.schedule ? `<h4>Rollout</h4><p>${esc(i.schedule)}</p>` : ''}
        ${i.prep ? `<h4>How to prepare</h4><p>${esc(i.prep)}</p>` : ''}
        <div class="meta">${meta}</div>
      </div>
    </div>`;
  }

  function renderList(set) {
    let list = set;
    if (S.soon) list = list.filter(isSoon);
    if (S.theme) list = list.filter((i) => i.themes.includes(S.theme));
    // Future months first (soonest at the top), then what is already rolling out, then undated
    const order = (i) => i.bucket === 'now' ? '8' : i.bucket === 'tbd' ? '9' : '1' + i.sortDate;
    if (S.view === 'upcoming') list.sort((a, b) => order(a).localeCompare(order(b)) || String(b.date).localeCompare(String(a.date)));
    else if (S.view === 'urgent') list.sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999') || Number(b.action) - Number(a.action) || String(b.date).localeCompare(String(a.date)));
    else list.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const counts = {};
    list.forEach((i) => { const [k] = groupOf(i); counts[k] = (counts[k] || 0) + 1; });
    const shown = list.slice(0, S.shown);
    let html = '', last = '';
    for (const i of shown) {
      const [k, label] = groupOf(i);
      if (k !== last) { html += `<div class="group"><h2>${label}</h2><span>${counts[k]}</span></div>`; last = k; }
      html += itemHtml(i);
    }
    $('list').innerHTML = html || `<div class="empty">Nothing here with these filters.<br><button class="text-btn" type="button" data-clear>Show everything</button></div>`;
    $('btnMore').hidden = list.length <= shown.length;
    $('btnMore').textContent = `Show more (${list.length - shown.length})`;
  }

  function renderHeader() {
    const r = S.meta?.lastRun;
    const t = S.liveAt && (!r || S.liveAt > D(r)) ? S.liveAt : r;
    $('lastUpdate').textContent = t ? `Updated ${new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  }

  function renderAll() {
    renderHeader(); renderSummary();
    const set = baseSet();
    renderTopics(set); renderList(set);
  }

  function setView(v) {
    S.view = v;
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  }

  async function check() {
    const b = $('btnCheck'); b.disabled = true; b.classList.add('spin');
    const before = S.roadmap.length + S.mc.length;
    let err = false;
    try { await loadData(); } catch { err = true; }
    try { await liveMessageCenter(); } catch { err = true; }
    const found = S.roadmap.length + S.mc.length - before;
    renderAll(); b.disabled = false; b.classList.remove('spin');
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

  // ---------- theme (light/dark) ----------
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store.get('theme', null));
  $('btnTheme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; applyTheme(next); store.set('theme', next);
  };

  // ---------- events ----------
  document.querySelectorAll('.seg button').forEach((b) => b.onclick = () => { setView(b.dataset.view); S.soon = false; S.shown = PAGE; renderAll(); });
  $('q').addEventListener('input', () => { S.shown = PAGE; renderAll(); });
  $('fTopic').addEventListener('change', () => {
    const v = $('fTopic').value;
    S.soon = v === '__soon'; S.theme = S.soon ? '' : v;
    S.shown = PAGE; renderAll();
  });
  $('btnMore').onclick = () => { S.shown += PAGE; renderAll(); };
  $('btnCheck').onclick = check;
  $('list').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { $('q').value = ''; S.theme = ''; S.soon = false; renderAll(); return; }
    const row = e.target.closest('.row'); if (!row) return;
    const it = row.parentElement, d = it.querySelector('.detail');
    d.hidden = !d.hidden; row.setAttribute('aria-expanded', String(!d.hidden));
    if (!readSet.has(it.dataset.key)) { readSet.add(it.dataset.key); saveRead(); row.querySelector('.dot')?.remove(); }
  });

  // ---------- start ----------
  setupWorkflowLink();
  loadData().then(renderAll).catch((e) => { toast(`Could not load data (${e.message}).`, true); renderAll(); });
})();

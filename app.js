/* Copilot Roadmap Tracker — site estático (GitHub Pages).
 * Dados: /data/*.json, gerados pelo GitHub Action (scripts/fetch-data.mjs).
 * "Verificar agora": recarrega os JSON e consulta ao vivo o RSS do mc.merill.net (que permite CORS).
 * A API do Roadmap oficial não permite CORS, por isso ela só é atualizada pelo Action.
 */
(() => {
  'use strict';

  const MC_RSS = 'https://mc.merill.net/rss.xml';
  const COPILOT_CATS = ['Microsoft Copilot (Microsoft 365)', 'Microsoft 365 Copilot Chat', 'Microsoft 365 Copilot'];
  const NON_M365 = /power platform|copilot studio|dynamics|github copilot|security copilot/i;
  const PAGE = 40;
  const DAY = 864e5;

  const STATUS_PT = { 'Launched': 'Lançado', 'Rolling out': 'Em implantação', 'In development': 'Em desenvolvimento', 'Cancelled': 'Cancelado' };
  const STATUS_CLS = { 'Launched': 'b-launched', 'Rolling out': 'b-rolling', 'In development': 'b-dev', 'Cancelled': 'b-cancel' };
  const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  // ---------- armazenamento local (por navegador) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('crt:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('crt:' + k, JSON.stringify(v)); } catch { /* indisponível */ } },
  };
  let baseline = store.get('baseline', null);
  if (!baseline) { baseline = Date.now() - 14 * DAY; store.set('baseline', baseline); }
  const readSet = new Set(store.get('read', []));
  const saveRead = () => store.set('read', [...readSet].slice(-5000));

  // ---------- estado ----------
  const S = { roadmap: [], mc: [], meta: {}, tab: 'news', shown: PAGE, liveAt: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ptMonth = (s) => (s || '').replace(/CY/g, '').replace(/\b(\w+)\b/, (m) => {
    const i = MONTHS[m.toLowerCase()]; return i == null ? m : new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  });
  const gaSortKey = (s) => { const m = (s || '').match(/(\w+)\s+CY(\d{4})/); return m && MONTHS[m[1].toLowerCase()] != null ? Number(m[2]) * 12 + MONTHS[m[1].toLowerCase()] : 1e9; };

  // Normaliza para um formato comum usado pela lista
  const normRoadmap = (x) => ({
    src: 'rm', id: x.id, key: `rm:${x.id}:${x.modified}`, title: x.title, description: x.description, url: x.url,
    status: x.status, groups: x.products, date: x.modified, created: x.created, ga: x.gaDate, preview: x.previewDate,
    platforms: x.platforms, cloud: x.cloud, previousStatus: x.previousStatus, isUpdate: x.modified && x.created && x.modified.slice(0, 10) !== x.created.slice(0, 10),
  });
  const normMc = (x) => ({
    src: 'mc', id: x.id, key: `mc:${x.id}`, title: x.title, description: x.description, url: x.url,
    status: null, groups: x.categories, date: x.published, live: x.live,
  });

  const items = () => {
    if (S.tab === 'roadmap') return S.roadmap.map(normRoadmap);
    if (S.tab === 'mc') return S.mc.map(normMc);
    return [...S.roadmap.map(normRoadmap), ...S.mc.map(normMc)];
  };
  const isUnread = (it) => new Date(it.date).getTime() > baseline && !readSet.has(it.key);

  // ---------- carga de dados ----------
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

  // Consulta ao vivo o Message Center (mc.merill.net) e adiciona o que ainda não está no snapshot
  async function liveMessageCenter() {
    const r = await fetch(MC_RSS, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Message Center: HTTP ${r.status}`);
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
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 7000);
  }

  function setupFilters() {
    const all = items();
    const st = $('fStatus'); const prev = st.value;
    const statuses = [...new Set(all.map((i) => i.status).filter(Boolean))];
    st.innerHTML = `<option value="">Todos os status</option>` + statuses.map((s) => `<option value="${esc(s)}">${esc(STATUS_PT[s] || s)}</option>`).join('');
    st.value = statuses.includes(prev) ? prev : ''; st.hidden = S.tab === 'mc';

    const fp = $('fProduct'); const pv = fp.value;
    const cnt = {}; all.forEach((i) => (i.groups || []).forEach((g) => { cnt[g] = (cnt[g] || 0) + 1; }));
    const groups = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    fp.innerHTML = `<option value="">Todos os produtos</option>` + groups.map((g) => `<option value="${esc(g)}">${esc(g)} (${cnt[g]})</option>`).join('');
    fp.value = groups.includes(pv) ? pv : '';
  }

  function filtered() {
    const q = $('q').value.trim().toLowerCase();
    const st = $('fStatus').value, pr = $('fProduct').value, days = Number($('fPeriod').value), unread = $('fUnread').checked, sort = $('fSort').value;
    const since = days ? Date.now() - days * DAY : 0;
    const list = items().filter((i) =>
      (!q || `${i.id} ${i.title} ${i.description} ${(i.groups || []).join(' ')}`.toLowerCase().includes(q)) &&
      (!st || S.tab === 'mc' || i.status === st) &&
      (!pr || (i.groups || []).includes(pr)) &&
      (!since || new Date(i.date).getTime() >= since) &&
      (!unread || isUnread(i)));
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'ga') list.sort((a, b) => gaSortKey(a.ga) - gaSortKey(b.ga) || String(b.date).localeCompare(String(a.date)));
    else list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return list;
  }

  function card(i) {
    const unread = isUnread(i);
    const badges = [
      `<span class="badge ${i.src === 'rm' ? 'b-src-rm' : 'b-src-mc'}">${i.src === 'rm' ? 'Roadmap' : 'Message Center'}</span>`,
      `<span class="badge">${esc(i.id)}</span>`,
      i.status ? `<span class="badge ${STATUS_CLS[i.status] || ''}">${esc(STATUS_PT[i.status] || i.status)}</span>` : '',
      unread ? `<span class="badge b-new">Novo</span>` : '',
      i.previousStatus ? `<span class="badge b-changed" title="Status anterior">antes: ${esc(STATUS_PT[i.previousStatus] || i.previousStatus)}</span>` : '',
      i.live ? `<span class="badge b-changed" title="Encontrado na verificação ao vivo">ao vivo</span>` : '',
    ].join('');
    const dates = i.src === 'rm'
      ? `${i.isUpdate ? 'Atualizado' : 'Adicionado'} em ${fmtDate(i.date)}${i.preview ? ` · Preview: ${esc(ptMonth(i.preview))}` : ''}${i.ga ? ` · GA: ${esc(ptMonth(i.ga))}` : ''}`
      : `Publicado em ${fmtDate(i.date)}`;
    const groups = (i.groups || []).slice(0, 3).map((g) => `<span class="badge">${esc(g)}</span>`).join('');
    const extra = i.src === 'rm' && i.platforms?.length ? `<span>${esc(i.platforms.join(', '))}</span>` : '';
    return `<article class="card${unread ? ' unread' : ''}" data-key="${esc(i.key)}">
      <div class="card-head">
        <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
        <button class="read-btn" type="button" data-read="${esc(i.key)}">${readSet.has(i.key) ? 'Lido ✓' : 'Marcar lido'}</button>
      </div>
      <div class="meta">${badges}</div>
      <div class="meta"><span>${dates}</span>${groups}${extra}</div>
      ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
      <div class="card-foot">
        ${i.description && i.description.length > 220 ? `<button class="link-btn" type="button" data-toggle>Ver mais</button>` : ''}
        <a href="${esc(i.url)}" target="_blank" rel="noopener">Abrir na fonte ↗</a>
        ${i.src === 'mc' ? `<a href="https://admin.microsoft.com/#/MessageCenter/:/messages/${esc(i.id)}" target="_blank" rel="noopener">Abrir no Admin Center ↗</a>` : ''}
      </div>
    </article>`;
  }

  function renderKpis() {
    const rm = S.roadmap, mc = S.mc;
    const by = (s) => rm.filter((x) => x.status === s).length;
    const last30 = Date.now() - 30 * DAY;
    const all = [...rm.map(normRoadmap), ...mc.map(normMc)];
    const k = [
      { v: all.filter(isUnread).length, l: 'Não lidos (novos p/ você)', hl: true, go: () => { S.tab = 'news'; $('fUnread').checked = true; $('fPeriod').value = '0'; } },
      { v: mc.filter((x) => new Date(x.published) >= last30).length, l: 'Message Center · 30 dias', go: () => { S.tab = 'mc'; $('fPeriod').value = '30'; } },
      { v: by('Rolling out'), l: 'Roadmap · em implantação', go: () => { S.tab = 'roadmap'; $('fStatus').value = 'Rolling out'; $('fPeriod').value = '0'; } },
      { v: by('In development'), l: 'Roadmap · em desenvolvimento', go: () => { S.tab = 'roadmap'; $('fStatus').value = 'In development'; $('fPeriod').value = '0'; } },
      { v: by('Launched'), l: 'Roadmap · lançados', go: () => { S.tab = 'roadmap'; $('fStatus').value = 'Launched'; $('fPeriod').value = '0'; } },
    ];
    $('kpis').innerHTML = k.map((x, n) => `<button class="kpi${x.hl ? ' hl' : ''}" type="button" data-kpi="${n}"><div class="v">${x.v.toLocaleString('pt-BR')}</div><div class="l">${x.l}</div></button>`).join('');
    $('kpis').querySelectorAll('[data-kpi]').forEach((b) => b.onclick = () => {
      const keepStatus = k[b.dataset.kpi];
      $('fStatus').value = ''; $('fUnread').checked = false;
      keepStatus.go(); const s = $('fStatus').value; setTab(S.tab, true); if (s) $('fStatus').value = s; render();
    });
    $('cRoadmap').textContent = rm.length; $('cMc').textContent = mc.length;
  }

  function render() {
    const list = filtered();
    const shown = list.slice(0, S.shown);
    $('resultInfo').textContent = `${list.length.toLocaleString('pt-BR')} ${list.length === 1 ? 'item' : 'itens'}${list.length > shown.length ? ` · exibindo ${shown.length}` : ''}`;
    $('list').innerHTML = shown.length ? shown.map(card).join('') : `<div class="empty">Nenhum item encontrado com esses filtros.</div>`;
    $('btnMore').hidden = list.length <= shown.length;
  }

  function renderHeader() {
    const r = S.meta?.lastRun;
    const parts = [];
    if (r) parts.push(`Dados: ${fmtDateTime(r)}`);
    if (S.liveAt) parts.push(`MC ao vivo: ${fmtDateTime(S.liveAt)}`);
    const errs = Object.entries(S.meta?.sources || {}).filter(([, s]) => !s.ok).map(([k]) => k === 'roadmap' ? 'Roadmap' : 'Message Center');
    if (errs.length) parts.push(`⚠ última coleta falhou: ${errs.join(', ')}`);
    $('lastUpdate').textContent = parts.join(' · ');
  }

  function setTab(tab, keepFilters) {
    S.tab = tab; S.shown = PAGE;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    if (!keepFilters) { $('fStatus').value = ''; $('fProduct').value = ''; }
    setupFilters();
  }

  function refreshAll() { renderHeader(); renderKpis(); setupFilters(); render(); }

  async function check() {
    const b = $('btnCheck'); b.disabled = true; b.classList.add('spin');
    const beforeRm = S.roadmap.length, beforeMc = S.mc.length;
    const msgs = []; let err = false;
    try { await loadData(); } catch (e) { msgs.push('Não foi possível recarregar os dados do site (' + e.message + ').'); err = true; }
    try {
      const n = await liveMessageCenter();
      msgs.push(n ? `${n} mensagem(ns) nova(s) do Message Center encontrada(s) ao vivo.` : 'Message Center ao vivo: nada novo além do que já está aqui.');
    } catch (e) { msgs.push('Message Center ao vivo indisponível (' + e.message + ').'); err = true; }
    const dRm = S.roadmap.length - beforeRm;
    if (dRm > 0) msgs.unshift(`${dRm} item(ns) novo(s) no Roadmap.`);
    if (S.meta?.lastRun) msgs.push(`Roadmap oficial coletado em ${fmtDateTime(S.meta.lastRun)} (atualizado pelo GitHub Action).`);
    refreshAll(); b.disabled = false; b.classList.remove('spin');
    toast(msgs.join(' '), err && S.mc.length === beforeMc);
  }

  // Link para disparar o workflow manualmente (quando hospedado em *.github.io)
  function setupWorkflowLink() {
    const h = location.hostname;
    if (!h.endsWith('.github.io')) return;
    const owner = h.replace('.github.io', '');
    const seg = location.pathname.split('/').filter(Boolean)[0];
    const repo = seg && !seg.includes('.') ? seg : h;
    const a = $('btnWorkflow');
    a.href = `https://github.com/${owner}/${repo}/actions/workflows/update-data.yml`;
    a.title = 'Abre o GitHub Actions para rodar a coleta completa (Roadmap + Message Center) agora. Requer permissão de escrita no repositório.';
    a.hidden = false;
  }

  // ---------- tema ----------
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store.get('theme', null));
  $('btnTheme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; applyTheme(next); store.set('theme', next);
  };

  // ---------- eventos ----------
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { setTab(t.dataset.tab); render(); });
  ['q', 'fStatus', 'fProduct', 'fPeriod', 'fSort', 'fUnread'].forEach((id) => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => { S.shown = PAGE; render(); }));
  $('btnMore').onclick = () => { S.shown += PAGE; render(); };
  $('btnCheck').onclick = check;
  $('btnMarkAll').onclick = () => { filtered().slice(0, S.shown).forEach((i) => readSet.add(i.key)); saveRead(); renderKpis(); render(); };
  $('list').addEventListener('click', (e) => {
    const r = e.target.closest('[data-read]');
    if (r) { const k = r.dataset.read; readSet.has(k) ? readSet.delete(k) : readSet.add(k); saveRead(); renderKpis(); render(); return; }
    const t = e.target.closest('[data-toggle]');
    if (t) { const c = t.closest('.card'); c.classList.toggle('open'); t.textContent = c.classList.contains('open') ? 'Ver menos' : 'Ver mais'; }
  });

  // ---------- início ----------
  setupWorkflowLink();
  loadData().then(refreshAll).catch((e) => {
    toast('Não foi possível carregar os dados (' + e.message + '). Se abriu o arquivo direto do disco, use um servidor local ou o GitHub Pages.', true);
    refreshAll();
  });
})();

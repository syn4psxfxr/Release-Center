// Builds the Microsoft 365 Copilot release data used by the site, from two sources:
//  1) Official Microsoft 365 Roadmap API -> https://www.microsoft.com/releasecommunications/api/v1/m365
//  2) Message Center (admin center), via the public mc.merill.net archive:
//       - https://mc.merill.net/messages-index.json  (structured index of all active messages)
//       - https://mc.merill.net/message/<MC id>       (detail page: rollout schedule + admin actions)
// Output: data/roadmap.json, data/messagecenter.json, data/meta.json
// No dependencies: runs on Node 18+ (native fetch). Detail pages are cached and only re-read when a message changes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const ROADMAP_API = 'https://www.microsoft.com/releasecommunications/api/v1/m365';
const MC_INDEX = 'https://mc.merill.net/messages-index.json';
const MC_PAGE = (id) => `https://mc.merill.net/message/${id}`;
const UA = { 'User-Agent': 'copilot-release-center (GitHub Actions)', Accept: '*/*' };

// Message Center posts older than this are kept but not re-scanned for a rollout schedule
const DETAIL_WINDOW_DAYS = 240;
const DETAIL_CONCURRENCY = 4;
// Bump when the detail-page parser changes, so cached pages are read again
const PARSER_VERSION = 2;

// ---------- what counts as "Microsoft 365 Copilot" ----------
const COPILOT_PRODUCTS = ['Microsoft Copilot (Microsoft 365)', 'Microsoft 365 Copilot Chat', 'Microsoft 365 Copilot'];
const NON_M365 = /power platform|power automate|power apps|power pages|copilot studio|dynamics|github copilot|security copilot|power bi|dataverse|fabric/i;
const isCopilot = (title, services) =>
  services.some((s) => COPILOT_PRODUCTS.includes(s)) ||
  (/\bcopilot\b/i.test(title) && !NON_M365.test(title) && !services.some((s) => NON_M365.test(s)));

// ---------- themes ----------
const THEMES = [
  ['frontier', /\bfrontier\b/i],
  ['cowork', /\bcowork\b/i],
  ['agents', /\bagents?\b|autopilot|researcher|analyst agent|facilitator/i],
  ['models', /\bgpt[- ]?\d|claude|\bmodels?\b|anthropic|openai/i],
  ['admin', /\badmins?\b|admin center|polic(y|ies)|governance|controls?\b|settings?\b|licens|billing|credits|compliance|purview|data boundary|retention|audit|security|permissions?/i],
  ['retirement', /retir|deprecat|end of support|no longer (be )?(available|supported)|sunset/i],
];
const themesOf = (text, extra = []) => [...new Set([...THEMES.filter(([, re]) => re.test(text)).map(([k]) => k), ...extra])];

// ---------- dates ----------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// "December CY2026" -> "2026-12-01"
function roadmapDate(s) {
  const m = (s || '').match(/([A-Za-z]+)\s+CY(\d{4})/);
  const i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return i < 0 ? null : ymd(Number(m[2]), i, 1);
}

// All dates mentioned in free text: "December 9, 2026", "mid-December 2026", "early January 2027", "December 2026"
function textDates(text) {
  const re = /\b(?:(early|mid|late|end of|beginning of|the end of|the beginning of)[\s-]+)?(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?,?\s+(20\d{2})\b/gi;
  const out = [];
  for (const m of (text || '').matchAll(re)) {
    const q = (m[1] || '').toLowerCase();
    const day = m[3] ? Number(m[3]) : q.includes('early') || q.includes('beginning') ? 5 : q.includes('mid') ? 15 : q.includes('late') || q.includes('end') ? 25 : 1;
    out.push(ymd(Number(m[4]), MONTHS.indexOf(m[2].toLowerCase()), Math.min(day, 28)));
  }
  return [...new Set(out)].sort();
}

// ---------- helpers ----------
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function get(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}
const decode = (s) => (s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const htmlToText = (h) => decode((h || '')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
  .replace(/<\/?(h[1-6]|p|li|br|div|tr|ul|ol)[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

// ---------- Roadmap ----------
async function fetchRoadmap() {
  const all = await (await get(ROADMAP_API)).json();
  return all
    .filter((x) => isCopilot(x.title, (x.tagsContainer?.products || []).map((p) => p.tagName)))
    .map((x) => {
      const tc = x.tagsContainer || {};
      const description = htmlToText(x.description);
      return {
        id: String(x.id),
        title: x.title,
        description,
        status: x.status,
        products: (tc.products || []).map((t) => t.tagName),
        platforms: (tc.platforms || []).map((t) => t.tagName),
        cloud: (tc.cloudInstances || []).map((t) => t.tagName),
        phase: (tc.releasePhase || []).map((t) => t.tagName),
        previewDate: x.publicPreviewDate || null,
        gaDate: x.publicDisclosureAvailabilityDate || null,
        preview: roadmapDate(x.publicPreviewDate),
        ga: roadmapDate(x.publicDisclosureAvailabilityDate),
        themes: themesOf(`${x.title} ${description}`),
        created: x.created,
        modified: x.modified,
        url: `https://www.microsoft.com/microsoft-365/roadmap?id=${x.id}`,
      };
    });
}

// ---------- Message Center ----------
function section(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s).replace(startRe, '').replace(/^[\s:]+/, '');
  const e = rest.search(endRe);
  return (e < 0 ? rest : rest.slice(0, e)).trim().slice(0, 1200);
}

async function messageDetail(id) {
  const text = htmlToText(await (await get(MC_PAGE(id))).text());
  const body = text.slice(Math.max(0, text.indexOf('More information')));
  // Section headings must start a line, so words like "timeline" inside a sentence are not mistaken for one
  const schedule = section(body, /(^|\n)[ \t]*(Rollout schedule|Rollout timeline|When this will happen|Timeline)/i,
    /\n(Impact on your organization|How this will affect|Who is affected|What will happen|What you need to do|Action required|What you can do|Compliance considerations|Discussion)/i);
  const action = section(body, /(^|\n)[ \t]*(Action required( and recommendations| \/ Recommendations)?|What you need to do to prepare|What you can do to prepare)/i,
    /\n(Compliance considerations|Learn more|Additional information|Discussion)/i);
  return { schedule, action };
}

async function fetchMessageCenter(previous) {
  const index = await (await get(MC_INDEX)).json();
  const prevById = new Map(previous.map((m) => [m.id, m]));
  const since = new Date(Date.now() - DETAIL_WINDOW_DAYS * 864e5).toISOString();

  const msgs = index
    .filter((r) => r.Source === 'messageCenter' && isCopilot(r.Title, r.Services || []))
    .map((r) => ({
      id: r.Id,
      title: r.Title,
      description: r.Summary || '',
      services: r.Services || [],
      tags: r.Tags || [],
      category: r.Category,
      major: !!r.IsMajorChange,
      published: r.StartDateTime,
      expires: r.EndDateTime,
      modified: r.LastModifiedDateTime,
      url: r.Url || MC_PAGE(r.Id),
    }));

  // Detail pages: only recent messages, and only when new or modified since last run
  const todo = msgs.filter((m) => {
    const p = prevById.get(m.id);
    const ver = `${m.modified}|v${PARSER_VERSION}`;
    if (p && p.detailFor === ver) { Object.assign(m, { schedule: p.schedule, action: p.action, detailFor: p.detailFor }); return false; }
    if (p) Object.assign(m, { schedule: p.schedule, action: p.action });
    return m.published >= since;
  });
  let done = 0, failed = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    for (let m; (m = queue.shift());) {
      try { Object.assign(m, await messageDetail(m.id), { detailFor: `${m.modified}|v${PARSER_VERSION}` }); done++; }
      catch { failed++; }
      await new Promise((r) => setTimeout(r, 150));
    }
  }));
  console.log(`messageCenter: read ${done} detail pages${failed ? ` (${failed} failed, will retry next run)` : ''}`);

  for (const m of msgs) {
    m.dates = textDates(m.schedule || m.description);
    m.action = (m.action || '').replace(/^[\s\/:]*(Recommendations?)?[\s\/:]*/i, '').trim();
    const noAction = /no (immediate |additional |further )?(admin(istrator)? )?action (is )?(required|needed)|no action required|there is no action|nothing (you need|is required)/i.test(m.action.slice(0, 200));
    m.actionRequired = !!m.action && !noAction && (m.category === 'planForChange' || m.tags.includes('Admin impact'));
    m.themes = themesOf(`${m.title} ${m.description}`, m.tags.includes('Retirement') ? ['retirement'] : []);
  }
  return msgs;
}

// ---------- merge with history ----------
// ---------- date change tracking ----------
// Which dates to watch per source. Roadmap: Preview and GA months. Message Center: when the rollout starts and completes.
const WATCH = {
  roadmap: (i) => ({ preview: i.preview, ga: i.ga }),
  messageCenter: (i) => (i.dates?.length ? { start: i.dates[0], end: i.dates[i.dates.length - 1] } : {}),
};

function dateChanges(source, prev, it, at) {
  const a = WATCH[source](prev), b = WATCH[source](it);
  return Object.keys(b)
    .filter((k) => a[k] && b[k] && a[k] !== b[k])
    .map((field) => ({ field, from: a[field], to: b[field], at, direction: b[field] > a[field] ? 'later' : 'earlier' }));
}

// ---------- merge with history ----------
function merge(source, oldItems, newItems, changedKey) {
  const now = new Date().toISOString();
  const map = new Map(oldItems.map((i) => [i.id, i]));
  let added = 0, changed = 0, moved = 0;
  for (const it of newItems) {
    const prev = map.get(it.id);
    if (!prev) { added++; map.set(it.id, { ...it, firstSeen: now, lastChanged: now }); continue; }
    const isChanged = prev[changedKey] !== it[changedKey];
    if (isChanged) changed++;
    // Only compare dates when Microsoft actually updated the item (avoids noise from parser changes)
    const newMoves = isChanged ? dateChanges(source, prev, it, now) : [];
    moved += newMoves.length ? 1 : 0;
    map.set(it.id, {
      ...it,
      firstSeen: prev.firstSeen || now,
      lastChanged: isChanged ? now : prev.lastChanged,
      previousStatus: isChanged && prev.status && prev.status !== it.status ? prev.status : prev.previousStatus,
      dateChanges: [...(prev.dateChanges || []), ...newMoves].slice(-8),
    });
  }
  return { items: [...map.values()], added, changed, moved };
}

// ---------- readiness tasks (GitHub issues in this repository) ----------
// Issues titled "[MC1234567] ..." or "[RM498765] ..." are linked to that item.
async function fetchTasks() {
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
  if (!repo) return null;  // running locally: the page reads issues live instead
  const tasks = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA['User-Agent'], ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub issues -> HTTP ${res.status}`);
    const batch = await res.json();
    for (const i of batch) {
      const m = !i.pull_request && (i.title || '').match(/^\s*\[(MC\d+|RM\d+)\]/i);
      if (m) tasks.push({
        item: m[1].toUpperCase(), number: i.number, url: i.html_url, state: i.state, title: i.title,
        assignees: (i.assignees || []).map((a) => a.login), labels: (i.labels || []).map((l) => l.name),
        updated: i.updated_at, closed: i.closed_at, stateReason: i.state_reason,
      });
    }
    if (batch.length < 100) break;
  }
  return tasks;
}

async function main() {
  await mkdir(DATA, { recursive: true });
  const meta = await readJson(join(DATA, 'meta.json'), {});
  const result = { lastRun: new Date().toISOString(), sources: {} };

  for (const [key, file, fn, sortKey] of [
    ['roadmap', 'roadmap.json', fetchRoadmap, 'modified'],
    ['messageCenter', 'messagecenter.json', fetchMessageCenter, 'published'],
  ]) {
    try {
      const old = await readJson(join(DATA, file), []);
      const fresh = await fn(old);
      // History is kept, but items that no longer match the Copilot filter are dropped
      const keep = (i) => isCopilot(i.title, i.products || i.services || []);
      const { items: merged, added, changed, moved } = merge(key, old.filter(keep), fresh, 'modified');
      const items = merged.filter(keep);
      items.sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey])));
      await writeFile(join(DATA, file), JSON.stringify(items, null, 1));
      result.sources[key] = { ok: true, total: items.length, fetched: fresh.length, added, changed, moved, updated: result.lastRun };
      console.log(`${key}: ${fresh.length} Copilot items (${added} new, ${changed} changed, ${moved} with new dates, ${items.length} in history)`);
    } catch (e) {
      console.error(`${key}: failed ->`, e.message);
      result.sources[key] = { ...(meta.sources?.[key] || {}), ok: false, error: e.message };
    }
  }
  try {
    const tasks = await fetchTasks();
    if (tasks) {
      await writeFile(join(DATA, 'tasks.json'), JSON.stringify(tasks, null, 1));
      result.sources.tasks = { ok: true, total: tasks.length, updated: result.lastRun };
      console.log(`tasks: ${tasks.length} readiness issues`);
    }
  } catch (e) {
    console.error('tasks: failed ->', e.message);
    result.sources.tasks = { ...(meta.sources?.tasks || {}), ok: false, error: e.message };
  }
  await writeFile(join(DATA, 'meta.json'), JSON.stringify(result, null, 1));
  if (!result.sources.roadmap?.ok && !result.sources.messageCenter?.ok) process.exit(1);
}

main();

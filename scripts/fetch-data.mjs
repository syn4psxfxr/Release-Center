// Fetches Microsoft 365 Copilot updates from two sources and writes them to /data:
//  1) Official Microsoft 365 Roadmap -> https://www.microsoft.com/releasecommunications/api/v1/m365
//  2) Message Center (admin center) via the public mc.merill.net archive -> https://mc.merill.net/rss.xml
// No dependencies: runs on Node 18+ (native fetch).
// Keeps history: items already seen stay in the file, and each item gets "firstSeen".

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const ROADMAP_API = 'https://www.microsoft.com/releasecommunications/api/v1/m365';
const MC_RSS = 'https://mc.merill.net/rss.xml';

// Products/categories treated as "Microsoft 365 Copilot"
const COPILOT_PRODUCTS = ['Microsoft Copilot (Microsoft 365)', 'Microsoft 365 Copilot Chat', 'Microsoft 365 Copilot'];
const isCopilotText = (s) => /\bcopilot\b/i.test(s || '');
// Copilot from other product lines (Power Platform, Dynamics, Security, GitHub...) is excluded unless the product is M365 Copilot
const NON_M365 = /power platform|copilot studio|dynamics|github copilot|security copilot/i;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'copilot-roadmap-tracker (GitHub Actions)', Accept: '*/*' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

const stripHtml = (h) => (h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

// ---------- Roadmap ----------
async function fetchRoadmap() {
  const all = await (await get(ROADMAP_API)).json();
  return all
    .filter((x) => {
      const products = (x.tagsContainer?.products || []).map((p) => p.tagName);
      if (products.some((p) => COPILOT_PRODUCTS.includes(p))) return true;
      return isCopilotText(x.title) && !NON_M365.test(x.title + ' ' + products.join(' '));
    })
    .map((x) => {
      const tc = x.tagsContainer || {};
      return {
        id: String(x.id),
        title: x.title,
        description: stripHtml(x.description),
        status: x.status,
        products: (tc.products || []).map((t) => t.tagName),
        platforms: (tc.platforms || []).map((t) => t.tagName),
        cloud: (tc.cloudInstances || []).map((t) => t.tagName),
        phase: (tc.releasePhase || []).map((t) => t.tagName),
        gaDate: x.publicDisclosureAvailabilityDate || null,
        previewDate: x.publicPreviewDate || null,
        created: x.created,
        modified: x.modified,
        url: `https://www.microsoft.com/microsoft-365/roadmap?id=${x.id}`,
      };
    });
}

// ---------- Message Center (mc.merill.net) ----------
function parseRss(xml) {
  const decode = (s) => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').trim();
  const tag = (block, t) => decode((block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, b]) => {
    const title = tag(b, 'title');
    const m = title.match(/^(MC\d+):\s*(.*)$/);
    return {
      id: m ? m[1] : tag(b, 'guid'),
      title: m ? m[2] : title,
      description: tag(b, 'description'),
      categories: [...b.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((c) => decode(c[1])).filter((c) => c !== 'Message Center'),
      published: new Date(tag(b, 'pubDate')).toISOString(),
      url: tag(b, 'link'),
    };
  });
}

const isCopilotMessage = (m) =>
  m.categories.some((c) => COPILOT_PRODUCTS.includes(c)) ||
  (isCopilotText(m.title) && !NON_M365.test(m.title) && !m.categories.some((c) => /power platform|power bi|dynamics|dataverse/i.test(c)));

async function fetchMessageCenter() {
  return parseRss(await (await get(MC_RSS)).text()).filter(isCopilotMessage);
}

// ---------- Merge with history ----------
function merge(oldItems, newItems, changedKey) {
  const now = new Date().toISOString();
  const map = new Map(oldItems.map((i) => [i.id, i]));
  let added = 0, changed = 0;
  for (const it of newItems) {
    const prev = map.get(it.id);
    if (!prev) { added++; map.set(it.id, { ...it, firstSeen: now, lastChanged: now }); continue; }
    const isChanged = changedKey && prev[changedKey] !== it[changedKey];
    if (isChanged) changed++;
    map.set(it.id, { ...it, firstSeen: prev.firstSeen, lastChanged: isChanged ? now : prev.lastChanged, previousStatus: isChanged && prev.status !== it.status ? prev.status : prev.previousStatus });
  }
  return { items: [...map.values()], added, changed };
}

async function main() {
  await mkdir(DATA, { recursive: true });
  const meta = await readJson(join(DATA, 'meta.json'), {});
  const result = { lastRun: new Date().toISOString(), sources: {} };

  for (const [key, file, fn, changedKey, sortKey] of [
    ['roadmap', 'roadmap.json', fetchRoadmap, 'modified', 'modified'],
    ['messageCenter', 'messagecenter.json', fetchMessageCenter, null, 'published'],
  ]) {
    try {
      const fresh = await fn();
      const old = await readJson(join(DATA, file), []);
      const { items, added, changed } = merge(old, fresh, changedKey);
      items.sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey])));
      await writeFile(join(DATA, file), JSON.stringify(items, null, 1));
      result.sources[key] = { ok: true, total: items.length, fetched: fresh.length, added, changed, updated: result.lastRun };
      console.log(`${key}: ${fresh.length} Copilot items (${added} new, ${changed} changed, ${items.length} in history)`);
    } catch (e) {
      console.error(`${key}: failed ->`, e.message);
      result.sources[key] = { ...(meta.sources?.[key] || {}), ok: false, error: e.message };
    }
  }
  await writeFile(join(DATA, 'meta.json'), JSON.stringify(result, null, 1));
  if (!Object.values(result.sources).some((s) => s.ok)) process.exit(1);
}

main();

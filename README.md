# Copilot Release Center

A static GitHub Pages site that shows **what's coming to Microsoft 365 Copilot**, so the organization can prepare for it.

| Source | What it adds | How it is read |
|---|---|---|
| [Microsoft 365 Roadmap](https://www.microsoft.com/microsoft-365/roadmap) (official) | Features in development or rolling out, with Preview and GA months | Public API `releasecommunications/api/v1/m365`, filtered to Copilot (Action only: the API blocks browser/CORS requests) |
| [Message Center Archive (mc.merill.net)](https://mc.merill.net/) | Admin center announcements: rollout schedule per phase (Frontier, Targeted, GA), admin impact and "how to prepare" | `messages-index.json` for every active Copilot message, plus each recent message page (cached, re-read only when the message changes). The page also checks the RSS feed live |

Live site: https://syn4psxfxr.github.io/Release-Center/

## What the page shows

- **At a glance:** releases landing in the next 30 days, urgent items for admins, and Frontier releases ahead.
- **Upcoming:** a timeline by month (soonest first), then what is already rolling out, then items with no date yet. Each item opens to show the description, the rollout schedule and how to prepare.
- **Topics** (dropdown): Action needed, Frontier, Cowork, Agents, AI models, Admin & governance, Retirements (keyword and tag based).
- **Admin Center:** Message Center posts from the last 90 days, newest first, with their impact tags.
- **Urgent:** posts that need admin action, retirements and changes Microsoft flags as major that are still ahead, ordered by their next key date (next 7 days, next 30 days, later).

## How it works

- `scripts/fetch-data.mjs` (Node 18+, no dependencies) builds `data/roadmap.json`, `data/messagecenter.json` and `data/meta.json`. Dates in rollout text ("mid-December 2026", "December 9, 2026") are turned into calendar dates. History is preserved, and Roadmap status changes are recorded (`previousStatus`).
- `.github/workflows/update-data.yml` runs the script **every 6 hours** and on demand (Actions → *Update Copilot data* → *Run workflow*), then commits the new data. GitHub Pages republishes automatically.
- New-item dots are per browser (localStorage): they mark updates that arrived after your first visit.

## Date changes

Every run compares each item's dates with the previous run: Preview and GA months for Roadmap items, and the rollout start and completion dates for Message Center posts. Dates are only compared when Microsoft actually updated the item. A change is stored in `dateChanges` and shown on the page for 60 days as **Delayed** or **Moved earlier** (with the previous date), and under the **Date changed** topic. History starts from the first run, so the list fills up over time.

## Readiness tasks (GitHub issues)

- Open any item and click **Create task**: it opens a new issue in this repository, prefilled with the links, key date, rollout schedule, how to prepare and a readiness checklist. The title starts with the item ID, for example `[MC1546438]` or `[RM498765]`, which is how the page links them.
- The page shows each item's task status: **To do** (open, no assignee), **In progress** (open, with the assignee), **Done** (closed), **N/A** (closed as "not planned" or labelled `not applicable`). On the Urgent tab, the **No task yet** topic lists what still has no owner.
- The page reads issues live from the GitHub API (60 requests per hour per visitor without sign-in). The Action also saves them to `data/tasks.json` as a fallback, and runs again when an issue changes.
- This repository is public, so its issues are public too. Keep internal details out of them, or make the repository private (Pages for private repositories needs a paid GitHub plan).

## Setup

1. Push this repository to GitHub (branch `main`).
2. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions**.
4. Run the workflow once from **Actions → Update Copilot data → Run workflow**.

## Run locally

```powershell
node scripts/fetch-data.mjs
python -m http.server 8000
```

## Adjust the filter

Edit `COPILOT_PRODUCTS`, `NON_M365` and `THEMES` in `scripts/fetch-data.mjs` (and the matching constants in `app.js`).

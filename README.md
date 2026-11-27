# Copilot Release Center

A static GitHub Pages site that tracks **Microsoft 365 Copilot** updates from two sources:

| Source | What it covers | How it is read |
|---|---|---|
| [Microsoft 365 Roadmap](https://www.microsoft.com/microsoft-365/roadmap) (official) | Planned, rolling out and launched features | Public API `releasecommunications/api/v1/m365`, filtered to Copilot. **Action only**, since the API does not allow browser (CORS) requests |
| [Message Center Archive (mc.merill.net)](https://mc.merill.net/) | Public mirror of the admin center Message Center | Public RSS feed, filtered to Copilot. Read by the Action **and** live by the "Check for updates" button |

Live site: https://syn4psxfxr.github.io/Release-Center/

## How it works

- `scripts/fetch-data.mjs` (Node 18+, no dependencies) downloads both sources, keeps only M365 Copilot items, and writes `data/roadmap.json`, `data/messagecenter.json` and `data/meta.json`. History is preserved: messages that drop out of the RSS feed stay in the file, and Roadmap status changes are recorded (`previousStatus`).
- `.github/workflows/update-data.yml` runs the script **every 6 hours** and on demand (Actions → *Update Copilot data* → *Run workflow*), then commits the new data. GitHub Pages republishes automatically.
- On the page, **Check for updates** reloads the published data and queries the Message Center live.
- Read/new state is stored per browser (localStorage). Items from the 14 days before your first visit show as new.

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

Edit `COPILOT_PRODUCTS` and `NON_M365` in `scripts/fetch-data.mjs` (and the matching constants in `app.js` for the live check).

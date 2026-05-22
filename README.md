# MOEX AI Trade Agent — Static Leaderboard

A fully **static, no-backend** clone of the [ArenaGo MOEX AI Trade Agent](https://arenago.ru/competitions/moex-ai-agent/leaderboard) competition leaderboard, deployed on **GitHub Pages** and automatically updated via **GitHub Actions every 5 minutes**.

## ✨ Features

| Feature | Detail |
|---------|--------|
| Leaderboard table | All columns, responsive, IMOEX benchmark row |
| Column sorting | Click any header ↑↓; numeric-aware, stable secondary sort by rank |
| Live search | Filter by team name or captain in real time |
| Stat cards | Participants · Best capital · Total trades · IMOEX benchmark |
| Rank delta badges | ▲▼ vs previous snapshot, shown inline |
| Trend sparklines | Colour-coded mini SVG per row (green = rising, red = falling) |
| History tab | Multi-select team checkboxes + "Select All" |
| History chart | Chart.js multi-line (rank over time, Y-axis inverted) |
| Hover/dim | Hovered line stays full opacity; all others dim to ~12% |
| Tooltip | Shows team name + rank at the hovered point |
| No CDN | Bootstrap CSS and Chart.js vendored in `vendor/` |
| Auto-snapshots | GitHub Actions cron `*/5 7-16 * * 1-5` (every 5 min, weekdays) |
| Change detection | Commits only when ranks/capitals actually change |

---

## 📁 Repo Layout

```
moex_leaderboard/
├── index.html                        ← Single-page app (Таблица + История)
├── vendor/
│   ├── bootstrap.min.css             ← Bootstrap 5.3.0 (vendored, no CDN)
│   └── chart.umd.min.js              ← Chart.js 4.4.0 (vendored, no CDN)
├── data/
│   ├── timeseries.json               ← Full rank/capital history for all teams
│   └── snapshots/
│       └── latest.json               ← Most recent leaderboard snapshot
├── scripts/
│   ├── extract_snapshot.js           ← HTML → JSON (Node.js, zero npm deps)
│   └── update_timeseries.js          ← Merge snapshot + change detection
├── .github/
│   └── workflows/
│       └── snapshot.yml              ← Scheduled GH Actions pipeline
└── README.md
```

---

## 🚀 Deploy to GitHub Pages

- [ ] Push this repo to GitHub.
- [ ] **Settings → Pages → Source** → `main` branch, `/` root → **Save**.
- [ ] **Settings → Actions → General → Workflow permissions** → "Read and write".
- [ ] Visit `https://<you>.github.io/<repo>/` (allow ~1 min for first build).
- [ ] The `snapshot.yml` workflow will auto-run on schedule — check the **Actions** tab.

---

## ⚙️ GitHub Actions Pipeline

```
Every 5 min (*/5 7-16 * * 1-5):

  curl https://arenago.ru/.../leaderboard → /tmp/lb.html

  node scripts/extract_snapshot.js /tmp/lb.html → /tmp/new_snap.json
       (outputs SNAP_ID + SNAP_HASH to stderr)

  node scripts/update_timeseries.js /tmp/new_snap.json
       → compares entries vs last stored snapshot
       → if changed: appends to data/timeseries.json
                     overwrites data/snapshots/latest.json
       → prints "true" | "false"

  if changed → git commit -m "snapshot: <ID>" && git push
```

**Change detection logic (`update_timeseries.js`):**
```js
// Skip if snapshot_id already exists in timeseries
if (ts.snapshots.some(s => s.sid === newSnap.snapshot_id)) return false;

// Compare rank + capital for every team vs last stored value
for (const entry of newSnap.entries) {
  const prev = ts.teams[entry.captain]?.history.at(-1);
  if (!prev || prev.rank !== entry.rank || prev.capital !== entry.capital)
    return true;   // something changed → commit
}
return false;      // identical → skip commit
```

---

## 📊 Data Model

### `data/timeseries.json`  (the history store)
```jsonc
{
  "last_updated":      "2026-05-21T10:24:00+03:00",
  "last_snapshot_id":  "20260521T1024",
  "competition":       "moex-ai-agent",
  "snapshots": [
    { "sid": "20260521T1024", "timestamp": "…", "label": "21 мая 2026, 10:24",
      "total_participants": 47, "benchmark_capital": 974028 }
  ],
  "teams": {
    "vpack20": {
      "team": "Команда",
      "history": [
        { "sid": "20260521T1024", "rank": 1, "capital": 1014914,
          "commission": 5179, "load_pct": 49, "days": 5,
          "trades": 197, "turnover": 10358523, "activity": "today" }
      ]
    }
  }
}
```

### `data/snapshots/latest.json`  (current leaderboard, used by Таблица tab)
Standard snapshot JSON with `benchmark`, `entries[]`, `total_participants`.

---

## 📈 History: rank computation

```js
// Build per-team history array from timeseries
function buildTeamHistory(captain, ts) {
  const td = ts.teams[captain];
  return ts.snapshots.map(snap => {
    const h = td?.history.find(h => h.sid === snap.sid);
    return h ? { x: new Date(snap.timestamp).getTime(), y: h.rank, label: snap.label } : null;
  }).filter(Boolean);
}

// Rank delta vs previous snapshot
function rankDelta(captain, ts) {
  const hist = ts.teams[captain]?.history;
  if (!hist || hist.length < 2) return null;
  return hist.at(-1).rank - hist.at(-2).rank;   // negative = improved ▲
}
```

---

## 🖱️ Hover/dim implementation

```js
// Chart.js plugin — dims all lines except the nearest hovered one
const DimPlugin = {
  id: 'lineDim',
  afterEvent(chart, args) {
    const ev = args.event;
    if (ev.type !== 'mousemove' && ev.type !== 'mouseleave') return;

    const activeEls = chart.getActiveElements();
    const hovIdx = (ev.type === 'mouseleave' || !activeEls.length)
      ? -1 : activeEls[0].datasetIndex;

    if (hovIdx === chart._dimIdx) return;   // nothing changed
    chart._dimIdx = hovIdx;

    chart.data.datasets.forEach((ds, i) => {
      const orig = ds._oc;                  // original color stored at chart build time
      if (hovIdx === -1 || i === hovIdx) {
        ds.borderColor = orig;  ds.borderWidth = 2.5;  ds.pointRadius = 4;
      } else {
        ds.borderColor = hexA(orig, 0.12);  ds.borderWidth = 1;  ds.pointRadius = 2;
      }
    });
    chart.update('none');   // 'none' = skip animations, avoids re-triggering plugin
    args.changed = true;
  }
};
```

---

## 🔒 CORS / Network Notes

- **GitHub Actions** runners use GitHub's external IPs — they access `arenago.ru` directly, bypassing any corporate proxy.
- `index.html` fetches **only same-origin JSON** (`data/…`) — no CORS issues on GitHub Pages.
- All JS/CSS is vendored in `vendor/` — no CDN requests at runtime.

---

## 📦 Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Vanilla JS | Zero build step |
| CSS | Bootstrap 5.3.0 (vendored) | Responsive utilities |
| Chart | Chart.js 4.4.0 (vendored) | Multi-line, plugin API |
| Sparklines | Inline SVG | No extra dependency |
| Parsing | Node.js stdlib only | No `npm install` in CI |
| Storage | `timeseries.json` | Single fetch for all history |
| Hosting | GitHub Pages | Free, HTTPS, CDN-backed |

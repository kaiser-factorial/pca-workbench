# Scatter Lab

See the shape of your data. Scatter Lab is a fully client-side workbench for
exploring tabular datasets as interactive 2D/3D scatter plots — built for
survey and questionnaire research, useful for any table of numbers.

**Everything runs in the browser.** Parsing, PCA projection, clustering, and
persistence all happen locally — your data never leaves your machine. There is
no backend.

## Features

- **Drop in CSV, XLSX, or Parquet** — columns are profiled automatically
  (type, range, missing values, live mini-histograms)
- **One-click plotting** — assign any numeric column to X / Y / Z and color by
  any column from the Variables panel
- **PCA projection** — optionally project through a components/loadings file;
  top contributors per PC are reported
- **Clustering** — DBSCAN and K-Means (k-means++, deterministic) with live
  parameter sliders and per-cluster composition breakdowns
- **Compare views** — pin up to 4 views in a tmux-style grid; transfer columns
  (e.g. cluster labels) between datasets by row order or key match
- **Export** — PNG, rotating GIF, or a fully self-contained interactive HTML
  file that works offline
- **Workspaces** — save/load full sessions locally (IndexedDB), or export a
  workspace file to share with a collaborator
- **Two themes** — Bauhaus and Terminal

## Development

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Built with Next.js, Plotly, and Tailwind CSS.

The original FastAPI/pandas backend (removed after the client-side migration)
lives in git history for reference.

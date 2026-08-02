# Scatter Lab

See the shape of your data. Scatter Lab is a fully client-side workbench for
exploring tabular datasets as interactive 2D/3D scatter plots — built for
survey and questionnaire research, useful for any table of numbers.

**Live:** [scatter-lab.vercel.app](https://scatter-lab.vercel.app)

**Everything runs in the browser.** Parsing, PCA, clustering, statistics, and
persistence all happen locally — your data never leaves your machine. There is
no backend; the app deploys as a static site.

## Features

- **Drop in CSV, XLSX, or Parquet** — every column is profiled automatically
  (type, range, missing values, live mini-histograms) with one-click X/Y/Z/color
  assignment from the Variables panel
- **In-app PCA** — pick variables, pick components, run: a browser-side
  eigensolver produces scores, loadings, and a scree chart (correlation- or
  covariance-based). A precomputed components/loadings file works too
- **Clustering** — DBSCAN and K-Means (k-means++, deterministic) with live
  parameter sliders, per-cluster composition breakdowns, and diagnostics
  (silhouette-by-k, k-distance percentiles for eps)
- **Compare views** — pin up to 4 views in a tiled grid; transfer columns
  (e.g. cluster labels) between datasets by row order or key match, with
  alignment guards
- **Exports** — PNG, rotating GIF, or a fully self-contained interactive HTML
  file that works offline
- **Workspaces** — sessions persist locally (IndexedDB) and export/import as
  shareable files
- **Two themes** — Bauhaus and Terminal

## The assistant (optional, bring-your-own-key)

An in-app AI copilot that drives the workbench through tool calls: assign axes,
run PCA and clustering, read cluster compositions, compute correlations and
group comparisons, give a guided tour — and literally point at the interface
with an ephemeral highlight while explaining it. Interpretation questions are
grounded in a curated, citation-backed methods reference that ships with the
app.

- **One-click OpenRouter connect** (OAuth PKCE) or paste any key; any
  OpenAI-compatible endpoint works, including local runtimes (Ollama) for a
  fully offline assistant. Keys live in your browser only
- **Privacy contract:** requests carry column names and aggregate statistics —
  never raw data rows
- **Undo** for anything the assistant changes; optional thumbs-up/down feedback
  per reply (stored write-only, used to improve the assistant)
- Dockable right/bottom or floating, resizable, markdown-rendering chat

## Development

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npx vitest run     # unit tests (PCA math, statistics, methods retrieval)
```

Feedback storage is env-gated: copy `.env.local.example` to `.env.local` and
fill the Supabase values to enable it (unset = feedback UI hidden). Pushes to
`main` deploy to production via Vercel; tests run in GitHub Actions.

Built with Next.js, Plotly (WebGL), Tailwind CSS, PapaParse, SheetJS, and
hyparquet. See [HANDOFF.md](HANDOFF.md) for architecture and project state.

The original FastAPI/pandas backend (removed in the client-side migration)
lives in git history for reference.

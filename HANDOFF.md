# Scatter Lab — Handoff

**Date:** 2026-08-02 (covering the build sprint of Aug 1–2, 2026)
**Live:** https://scatter-lab.vercel.app · **Repo:** https://github.com/kaiser-factorial/pca-workbench (public)
**Deploy:** push to `main` → Vercel auto-builds (project `scatter-lab`, team `factorial-ai`, Root Directory `frontend`, ~35s builds)

## What this is

Scatter Lab (formerly "PCA Workbench") is a fully client-side workbench for exploring
tabular research data as interactive 2D/3D scatter plots — built for survey research,
general-purpose in practice. **All compute runs in the browser; data never leaves the
machine.** There is no backend; the deployed app is a static site.

## Architecture

Everything lives in `frontend/` (Next.js 16 / React 19 / TS / Tailwind 4 / Plotly WebGL).
The app is one page ([src/app/page.tsx](frontend/src/app/page.tsx)) plus libraries:

| File | Responsibility |
|---|---|
| `src/lib/parse.ts` | CSV (PapaParse), XLSX (SheetJS), Parquet (hyparquet) → columnar table |
| `src/lib/engine.ts` | Median imputation, z-scaling, projection through a components file |
| `src/lib/pca.ts` | In-app PCA: Jacobi eigensolver, scores/loadings/scree (sklearn-equivalent) |
| `src/lib/cluster.ts` | DBSCAN + K-Means (k-means++, seeded/deterministic) |
| `src/lib/stats.ts` | Pearson/Spearman, group comparison + eta², silhouette-by-k, k-distance |
| `src/lib/workspaces.ts` | Session persistence (IndexedDB `scatter-lab`) + file export/import |
| `src/lib/assistant.ts` | Assistant client (OpenAI-compatible), tool definitions, tool loop |
| `src/lib/methods.ts` | Curated, cited methods-reference chunks + lexical retrieval |
| `src/lib/openrouterAuth.ts` | OpenRouter OAuth PKCE (one-click key issuance) |
| `src/lib/feedback.ts` | Thumbs feedback → IndexedDB buffer → Supabase (insert-only) |
| `src/components/AssistantPanel.tsx` | Chat UI: dock modes, markdown rendering, feedback UI |

Two full visual themes (Bauhaus "primary" / Terminal) via `next-themes`; theme-aware
plot chrome throughout.

## The assistant

Bring-your-own-key via **OpenRouter** (one-click OAuth PKCE, or manual key; any
OpenAI-compatible endpoint works, incl. Ollama for offline). Key in localStorage only,
never in exported workspaces. Model picker: curated flagship chips + type-to-search over
tool-capable models only (filtered via `supported_parameters`).

**Tools** (all validated, instructive error strings): `get_app_state`, `set_plot`,
`run_clustering`, `get_cluster_breakdown`, `pin_view` / `remove_pin`, `load_demo_data`
(idempotent), `run_pca`, `correlate`, `compare_groups`, `suggest_k`, `suggest_eps`,
`switch_dataset`, `set_category_visibility`, `transfer_column`, `save_workspace`,
`get_tutorial` (curated tour chunks), `get_methods_reference` (cited interpretation
chunks), `highlight_ui` (ephemeral ring+arrow pointer at sidebar anchors),
`control_view` (3D rotation/zoom/reset).

**Privacy contract:** requests carry column metadata + aggregates only — never raw rows;
stated in the panel UI. **Undo:** view-state snapshot before each mutating turn; one-click
revert (workspace saves excluded, flagged in tool result). **Critical invariant:** the tool
loop receives the bridge *ref* and dereferences `.current` per call, with a paint-aware
yield between calls — passing the object itself froze a whole turn at send-time state
(the `GET APP STATE` polling bug, fixed in `4a5018d`). Don't regress this.

## Feedback pipeline (eval data)

Thumbs per assistant reply → instant metadata-only row; optional "why" box (rating-matched
example text, consent checkbox for including the exchange) → second row sharing `event_id`.
Sink: Supabase project `mdkjiyatfavavqkpvngh` (its own free org — **not** the main org),
table `assistant_feedback`, **insert-only RLS** for the anon key (SELECT/UPDATE/DELETE
verified to touch zero rows). Buffered through IndexedDB, background-flushed. Env:
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel: all three
environments; local: `frontend/.env.local`, see `.env.local.example`). Unset = feedback UI
hidden. Repo is `supabase link`ed. Analysis query:

```sql
select distinct on (event_id) * from assistant_feedback
order by event_id, created_at desc;
```

## Data hygiene (repo is PUBLIC)

- `LS_pca_workbench_views copy/` holds real participant-derived data — **gitignored,
  never commit** (it has never entered git history).
- Demo data (synthetic, 300 rows) ships in `frontend/public/demo/`.
- Only the Supabase **anon** key is in env/bundle (public by design); `service_role`
  must never appear anywhere.

## Outstanding

1. ~~Unit tests are not in the repo~~ **Done (2026-08-02):** stats, PCA, and
   methods-retrieval suites live in `frontend/src/lib/__tests__/` (vitest,
   `npm test`, 24 cases) and run in GitHub Actions on every push/PR
   (`.github/workflows/test.yml`).
2. **Methods library editorial pass** (`src/lib/methods.ts`): content synthesized from
   model knowledge + the NYU CDS Lab 13 notebook, with named citations. The intended
   vetting step is a ten-minute read/edit by Corina — not yet done.
3. **Local dev machine is severely degraded** (25-min Next compiles, minutes to hydrate).
   Current workflow: push and let Vercel build (33s there). Investigate the Mac
   (Activity Monitor, disk space, thermals) before trusting local builds again.
4. **Supabase table has test junk** to delete: rows with `model = 'setup-test'` and
   `model = 'mock/model'`. Free-tier projects pause after ~1 week idle (restore from
   dashboard). Write-only anon key means spam inserts are possible — acceptable at this
   scale; revisit (edge-function rate limit) if it ever matters.
5. **2D zoom/pan is not assistant-controllable** (`control_view` is 3D-only).
6. **Roadmap file** (`PCA_workbench_ROADMAP.md`) has one stale unchecked item —
   upload-error explanation now exists (the "Ask the assistant about this error" chip).
7. **Portfolio writeup** was delivered as a file (not in repo); its "in progress" line
   about the assistant is now outdated — update before publishing.
8. **Possible future directions** discussed but not committed: embeddings-based RAG for
   user-supplied papers (only worth it beyond the curated corpus), OpenRouter spend-limit
   note in settings, silhouette/elbow charts in the Cluster section UI.

## Working on it

```
cd frontend && npm install && npm run dev     # http://localhost:3000
cp .env.local.example .env.local              # fill Supabase values to enable feedback
```

Push to `main` deploys production. LocalStorage keys are all namespaced
`scatterlab.*`; workspaces in IndexedDB `scatter-lab`; feedback buffer in
IndexedDB `scatter-lab-feedback`.

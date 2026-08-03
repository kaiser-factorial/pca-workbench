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

**Visual channels:** position (X/Y/Z), colour (`colorBy`, categorical palette or Viridis
ramp), and marker shape (`shapeBy`, added 2026-08-02). Shape is capped at 6 levels
(`SHAPE_SYMBOLS`: filled circle/square/diamond then their open twins — cross/x are
excluded because scatter3d draws them at a much heavier visual weight, which reads as
size). Plotly takes one symbol per trace, so an active shape variable subdivides every
colour group; palette indices are keyed to the colour categories alone so nobody's
colour shifts. Legend shows a colour key (clickable: mute → hide) plus a display-only
shape key — muting stays a colour concept, since `mutedMap` is keyed by colour value.

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

**Cross-project review (2026-08-02, from the joint-session side).** Scatter Lab's
feedback design was ported to joint-session the same day (per-message 👍/👎 + optional
reason), which prompted a read of `feedback.ts` from outside. Two robustness gaps and a
convergence plan came out of it — the gaps are Outstanding #11, the plan is below.

Joint-session stores its ratings differently on purpose: it has Firebase auth and the
rated message is itself a Firestore document, so the rating lives *on* the message
(`ratings`/`ratingNotes` maps keyed by uid) instead of in a snapshot row — no
`user_message`/`assistant_message` copies needed. Scatter Lab's snapshot-row model is
right for *this* app (no backend, nothing to join against); neither should adopt the
other's storage. The convergence point is the **warehouse**: this Supabase project's
`assistant_feedback` table becomes the shared eval sink by (a) adding a `source_app`
column defaulting to `'scatter-lab'`, and (b) a small offline export script (service
role, runs locally — never in an app bundle) that pulls joint-session's ratings via a
collection-group query and inserts them with `source_app = 'joint-session'`. Shared
record shape: `source_app, event_id, model, rating, reason, tools?, created_at`. Apps
keep their native storage; analysis gets one table.

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
5. ~~2D zoom/pan is not assistant-controllable~~ **Done (2026-08-02):** `control_view`
   now covers both modes — in 2D, `zoom` scales the visible x/y window around its
   centre, `pan` (left/right/up/down, `pan_amount` as a fraction of the span) slides
   it, and `reset_camera` refits to all points. The viewport lives in `range2d` state
   (null = autorange), is applied to the active view only (pinned views are framed on
   their own columns), and now also captures the user's own mouse zoom via
   `onRelayout` — previously any re-render snapped a manual 2D zoom back to full
   extent. Persisted in workspaces and carried into the HTML export, mirroring `camera`.
6. ~~Roadmap file has one stale unchecked item~~ **Done (2026-08-02):** the
   upload-error item is checked off (the "Ask the assistant about this error" chip).
7. **Portfolio writeup** was delivered as a file (not in repo); its "in progress" line
   about the assistant is now outdated — update before publishing.
8. **Assistant "show me *that* region" (Corina's idea, 2026-08-02)** — the natural next
   step past directional pan. Two halves, useful separately:
   - *Center + frame:* let the assistant name a region in data coordinates and have the
     plot centre on it and draw around it (a box/ellipse annotation, the plot-space
     sibling of `highlight_ui`'s sidebar ring). 2D is straightforward — Plotly shapes
     plus an explicit x/y range, and `range2d` already exists to hold the framing. 3D is
     the harder half: no shape layer in `scene`, so it likely means a wireframe-box
     mesh trace plus aiming `camera.center`.
   - *Highlight by rule:* recolor points matching a condition — e.g. "everything with
     positive PC1, PC2 and PC3" — rather than by a column. Cuts across the current
     `colorBy` model, so it probably wants a transient "selection" overlay trace (or a
     synthetic boolean column) that leaves `colorBy` intact and clears on the next turn.
     Would pair well with the undo snapshot already taken per mutating turn.
9. **Clustering: the gap is inputs, not algorithms (reviewed 2026-08-02).** Two findings
   worth acting on before any new method is added:
   - *No standardization.* `imputeColumns` in `cluster.ts` median-imputes but never
     z-scales, unlike the PCA path. On raw columns of different scales (Age 18–65 vs a
     1–7 Likert) Euclidean distance is almost entirely the wider column, and every
     distance-based method inherits this. A "standardize before clustering" toggle
     would improve DBSCAN/K-Means today more than a new algorithm would.
   - *Axes are the feature selection.* Clustering runs on the 2–3 **plotted** columns
     ([page.tsx](frontend/src/app/page.tsx) `handleCluster`). Fine for PC axes; weak for
     two arbitrary raw ones. Letting users pick cluster variables independently of the
     plotted axes is the bigger win.
   Methods ranked by fit, if one is added anyway: **Ward agglomerative** (~60 lines,
   deterministic, one run yields every k plus a dendrogram — best pure fit to the
   `(number|null)[][] → string[]` contract); **Gaussian mixtures/EM** (elliptical
   clusters, soft assignments that could drive opacity or the new shape channel, BIC as
   a companion to the silhouette `suggest_k`); **k-medoids + Gower** (mixed
   numeric/categorical, so survey categoricals become clusterable — but needs the
   decoupled-variables work first); **HDBSCAN** (removes `eps`, the most annoying
   parameter, but 250–400 lines and no small JS implementation worth trusting).
   Ruled out: spectral (needs an n×n Laplacian eigendecomposition; the Jacobi solver in
   `pca.ts` is O(n³) per sweep and would hang the tab) and affinity propagation.
10. **Possible future directions** discussed but not committed: embeddings-based RAG for
   user-supplied papers (only worth it beyond the curated corpus), OpenRouter spend-limit
   note in settings, silhouette/elbow charts in the Cluster section UI.
11. **Feedback queue robustness — FIXED in code (2026-08-02), one console step left.**
   The review gaps became a live incident the same day: the table filled with duplicate
   rows. Root cause, confirmed by reading the flush path: delivery is at-least-once
   (AssistantPanel mount-flushes the SHARED IndexedDB queue in every tab while the
   `flushing` guard is per-tab → two open tabs double-post every drained row; and a
   POST that lands right before tab close never gets its queue-delete → re-sent next
   session), and the insert-only table had no idempotency key, so every redelivery was
   a visible duplicate. `feedback.ts` is rewritten:
   - `client_key` (uuid, stamped at enqueue) + `on_conflict=client_key` with
     `Prefer: resolution=ignore-duplicates` → redelivery is a server-side no-op;
   - a Web Lock serializes flushes across tabs;
   - `pagehide` flush with `keepalive` so last-moment records don't wait a session;
   - per-row fallback on batch rejection, attempts counter, drop after 5 rejections
     (network failures stay queued and cost no attempts), plus a bridge that retries
     without `on_conflict` against a pre-migration server.
   Remaining steps, in order (the client has a bridge that keeps working against a
   pre-migration server, but idempotency — the actual dupe protection — only starts
   once the index exists, so do the migration first):
   - [ ] **Run the migration** `supabase/migrations/20260802000000_feedback_idempotency.sql`
         (adds `client_key` + unique index + `source_app`). Repo is linked:
         `supabase db push` — or paste it into the dashboard SQL editor.
   - [ ] **Clear the existing dupes** with `supabase/dedupe_assistant_feedback.sql`:
         run the preview query, eyeball the groups, then uncomment and run the
         delete (keeps the earliest copy of each identical row). Destructive — by
         hand only, deliberately not a migration.
   - [ ] **Push to `main`** so Vercel ships the new client (idempotent inserts,
         cross-tab flush lock, pagehide flush, poison-row handling).
   - [ ] Optional sanity check afterwards: re-run the preview query — new dupes
         should be structurally impossible now.
   Verified fine on review: insert-only RLS, the two-row `event_id` pattern with the
   `distinct on` analysis query, and metadata-only rows without consent.

## Working on it

```
cd frontend && npm install && npm run dev     # http://localhost:3000
cp .env.local.example .env.local              # fill Supabase values to enable feedback
```

Push to `main` deploys production. LocalStorage keys are all namespaced
`scatterlab.*`; workspaces in IndexedDB `scatter-lab`; feedback buffer in
IndexedDB `scatter-lab-feedback`.

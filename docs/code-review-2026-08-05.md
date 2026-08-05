# Scatter Lab — code review

**Date:** 2026-08-05 · **Reviewed at:** commit `42e30dd` on `claude/code-review-menu-analytics-ui-f7llud`
**Scope:** whole project, with two requested deep focuses — (1) the menu bar from import to export, including
assistant integration; (2) the accuracy of the local analytics and whether the UI represents them honestly.
**Styled version:** https://claude.ai/code/artifact/2e6fb89b-b69a-4ea0-9f78-fbcbbbe3eff0

71 findings. No source files were changed by this review. Severity legend:

| Mark | Meaning |
|---|---|
| **WRONG** | Produces wrong output or silently loses data |
| **OPAQUE** | Output is right; the app doesn't tell the user what it did |
| **EDGE** | Edge case, hardening, or scale ceiling |
| **OK** | Checked and verified correct — do not "fix" |

---

## Verdict

The library/UI split is real rather than nominal. `pca.ts`, `cluster.ts`, `stats.ts` and `clusterBreakdown.ts`
are pure, tested, and free of React, which is the only reason the analytics could be audited at all. The privacy
contract holds under inspection: all 24 assistant tools were traced and none can put a raw row in a request.
Determinism is genuinely implemented, not merely claimed. The PCA run-label registry solves a real workflow
problem correctly.

`methods.ts` is the strongest thing in the repo. It is honest about median imputation shrinking variance, about
η² being upwardly biased with small groups, about survey data in PC space living in the weak-silhouette range. It
states plainly that this app's k-means is deterministic.

Almost none of that reaches the sidebar. `grep -i determinis src/` hits three code comments and one methods
chunk, and zero user-visible strings. `grep -i imput` is the same story. Since users don't see the code, that
documentation currently serves only readers with the source open — or a model that happens to retrieve the right
chunk.

### Fix these ten first

1. **A3** — `suggest_eps` is off by one, and contradicts the app's own methods reference.
2. **C1** — PapaParse errors are discarded; ragged rows, unterminated quotes and Qualtrics title rows destroy data silently.
3. **A7** — `compare_groups` reports η² = 1.000 on an ID column.
4. **B1–B3** — the four disclosures (deterministic k-means, median imputation, plotted-axes-only clustering, population sd). All four are already written down elsewhere in the repo.
5. **A4** — cluster diagnostics subsample by stride, not at random.
6. **E1** — `xlsx@0.18.5` has an unfixable-on-npm high-severity advisory, and it parses untrusted user files.
7. **F1** — the OpenAI SDK and markdown stack ship in the initial bundle.
8. **F9 + F10** — the rotation loop: drive the camera with `Plotly.relayout` instead of React state, and memoize the assistant panel. Dataset-size-independent.
9. **F7** — 2D scatter is SVG; the bundle has no `scattergl` module.
10. **F18, F20, F21** — three near-free wins that change no behaviour.

---

## A. Analytic accuracy

### A1 · OK — the eigensolver is correct, verified independently

The iris correlation matrix was recomputed from `frontend/public/demo/iris.csv` and eigendecomposed with power
iteration plus deflation — an algorithm sharing nothing with the Jacobi rotation in `pca.ts`. The two agree to
eight decimal places.

| Method | PC1 | PC2 | PC3 | PC4 |
|---|---|---|---|---|
| Scatter Lab (Jacobi) | 72.7705% | 23.0305% | 3.6838% | 0.5152% |
| Power iteration + deflation | 72.7705% | 23.0305% | 3.6838% | 0.5152% |
| R `prcomp(iris, scale.=TRUE)` | 72.9624% | 22.8508% | 3.6689% | 0.5179% |

Those first two rows were measured on the demo file **as originally committed** — the errata mirror. The point of
the table is that the two independent solvers agree exactly with each other while both differ from R, which
localises the discrepancy to the data rather than the math. Since A2 has now been fixed, all three rows read
72.9624 / 22.8508 / 3.6689 / 0.5179, and `demoData.test.ts` asserts it.

Also confirmed: scores exactly mean-centred, score variance equals the eigenvalue, components orthonormal,
eigenvalues descending, sign convention deterministic, covariance mode correct. The Jacobi rotation is a correct
`JᵀAJ` similarity transform using the numerically stable root for `t`. **The PCA math is sound.** The third row
of that table is finding A2, not a solver bug.

### A2 · FIXED (2026-08-05) — the demo dataset was the errata iris

The Kaggle/UCI `Iris.csv` differs from Fisher's original in two rows. In this file, row 35 was
`4.9,3.1,1.5,0.1` (Fisher: `…,0.2`) and row 38 was `4.9,3.1,1.5,0.1` (Fisher: `4.9,3.6,1.4,0.1`). R's `iris` and
scikit-learn ≥ 0.23 use the original, so anyone sanity-checking Scatter Lab against a tutorial saw 72.77% where
the tutorial says 72.96% and could reasonably conclude the PCA was broken.

**Resolved.** The demo file is now regenerated from UCI's own corrected copy, `bezdekIris.data`, rather than the
`iris.data` mirror Kaggle reproduces — UCI ships both, and `iris.names` documents the discrepancy verbatim.
`iris.SOURCE.md` records the URL, the upstream checksum, the citation
(<https://doi.org/10.24432/C56C76>), the two presentational transformations applied, and a one-line command that
reproduces the shipped file byte-identically.

Verified three ways: `bezdekIris.data` differs from `iris.data` at exactly rows 35 and 38 and nowhere else; it
agrees measurement-for-measurement with scikit-learn's `load_iris` (corrected in 0.23) and `seaborn-data`, all 600
values; and the result matches four independent sets of published R statistics — column means, sample sds,
`prcomp` sdev, and variance explained on both scales — to six decimal places. A new suite, `demoData.test.ts`,
pins the two rows and asserts `runPCA` against R, so re-downloading `iris.data` by mistake fails the build rather
than silently regressing the demo.

Side benefit worth noting for E4: this is the suite's first *external* ground truth for `runPCA`. Every other PCA
test checks analytic or self-consistency properties, which by construction cannot catch an error shared between
the implementation and its own assumptions.

`frontend/public/demo/iris.csv` rows 35, 38 · `iris.SOURCE.md` · `frontend/src/lib/__tests__/demoData.test.ts`

### A3 · FIXED (2026-08-05) — `suggest_eps` was off by one against the app's own DBSCAN core rule

`neighbors(i)` includes `i` itself, so a point becomes core once `min_samples − 1` *other* points are within eps —
the sklearn convention. But `kDistancePercentiles` takes `sorted[k-1]` with `k = min_samples`, the distance to the
`min_samples`-th *other* point: one neighbour too far.

Demonstrated on 40 unit-spaced 1-D points with `min_samples = 3`: DBSCAN clusters every point at `eps = 1.0`,
while `suggest_eps` reports `p50 = 2.0`. Every recommendation is systematically too generous, merging clusters
that should stay separate. `methods.ts:40` already states the correct rule — *"the k-distance curve computed at
k = min_samples − 1"* — so the reference and the implementation disagree, and the tool description matches the
implementation.

**Resolved.** `kDistancePercentiles` now takes `minSamples` rather than a neighbour rank and converts internally
to `minSamples - 1`, so the DBSCAN convention lives in one place and a caller cannot repeat the mistake — it had
exactly one production caller, whose only purpose was this. It returns the resolved `kthNeighbor` so the tool
result can state which curve it read, and returns `null` for `minSamples < 2`, where eps stops controlling
anything because every point is its own core point. The `suggest_eps` result string and the tool description now
say the same thing the code does, and disclose the 2,000-row sampling cap.

`methods.ts` needed no change: its stated convention — *"the k-distance curve computed at k = min_samples − 1"* —
was right all along. The implementation now matches the documentation rather than the reverse.

Regression tests were checked against the old behaviour before being trusted: reintroducing the off-by-one fails
all three. The key one asserts the property whose absence let this survive — that the eps the diagnostic names is
an eps at which DBSCAN really does form clusters, and that a hair under it does not.

`stats.ts:171-206` · `page.tsx:2467-2479` · `assistant.ts:362` · tests in `stats.test.ts`, `cluster.test.ts`

### A4 · WRONG — cluster diagnostics subsample by stride, not at random

`toMatrix` caps at 1,200 rows for silhouette and 2,000 for the k-distance curve, then keeps
`rows[Math.floor(i * step)]`. Even striding is fine on shuffled data and wrong on periodic data — four rows per
participant, blocks per condition, one row per longitudinal wave. At n = 4,800 the step is exactly 4, so the
diagnostic sees one wave while the clustering runs on all four. Fix: seeded random sample using the
`mulberry32` generator already in `cluster.ts`.

`stats.ts:127-139` · callers `stats.ts:191, 210`

### A5 · OPAQUE — mean silhouette skips singleton clusters instead of scoring them zero

`if (own.length <= 1) continue` excludes singletons from the average. Rousseeuw's definition assigns them `s = 0`.
Excluding rather than zeroing inflates the mean, hardest at high k and with outliers — precisely where
`suggest_k` should be discouraging the user.

`stats.ts:156-183` (line 167)

### A6 · OPAQUE — group and overall "sd" are population sd, labelled only "sd"

Verified: `compareGroups([1,2,3,4], …)` reports `sd = 1.11803` (population, ÷n). Sample sd is `1.29099`.
Population sd is defensible for a descriptive summary and correct inside the PCA, but for group means a
researcher will paste into a manuscript, n − 1 is the reporting convention. Either switch it or write
"sd (population)" in the tool output. The same ÷n choice in `pca.ts:150` and `engine.ts:239` matches sklearn —
leave those.

`stats.ts:107-111` · `page.tsx:2449`

### A7 · WRONG — `compare_groups` has no cardinality guard, so η² = 1.000 on an identifier column

Verified: 50 rows, 50 distinct group values → `etaSquared = 1.0`, every group `n = 1`, every `sd = 0`. The bridge
passes that through as *"eta-squared=1.000 (share of variance explained by group)"* and the assistant will relay
it. Nothing stops `compare_groups(PetalLengthCm, Id)`. Refuse when the group count approaches the row count or
any group has `n < 2`, and return `nGroups` and the minimum group size alongside η².

`stats.ts:93-121` (line 120) · `page.tsx:2442-2451` · `assistant.ts:328-340`

### A8 · OPAQUE — "loadings" are unit-norm eigenvector weights, and the methods reference gives a threshold for the other quantity

`runPCA` reports raw eigenvector entries — sklearn's `components_`. In psychometrics, this app's audience,
"loading" ordinarily means the variable–component correlation, the eigenvector scaled by √eigenvalue. Both are
legitimate; the problem is that `methods.ts` hands the user the *"roughly |loading| ≥ 0.3–0.4"* rule of thumb,
which is calibrated for the correlation-scaled version, and then in `loadings_vs_scores` tells them to "check
whether loadings were scaled by the eigenvalue" without ever saying which one this app produces. Name the
convention in both the UI and the chunk. (`loadings_vs_scores` also has an unbalanced parenthesis — worth
catching in the editorial pass queued as HANDOFF Outstanding #2.)

`pca.ts:203-208` · `methods.ts:12, 20` · `page.tsx:2878-2892`

### A9 · OPAQUE — mean and sd are computed *after* median imputation, with no report of how much was imputed

Imputed cells are pulled to the centre and then counted in the mean and sd, so sd is understated and correlations
attenuated in proportion to missingness. Standard simple-imputation behaviour, and `pca_caveats` warns about it —
but the app never states the magnitude. A PCA over a column that is 40% missing looks identical to one over a
complete column. Report imputed-cell counts per run in the `PcaRun` registry, surfaced in the run message and
`get_app_state`.

`pca.ts:130-154` · `engine.ts:227-241` · `page.tsx:2143-2146`

### A10 · EDGE — k is clamped to p but not to rank

With n = 3 and p = 5, components 3–5 are numerically zero and their scores are noise. Clamp to `min(p, n − 1)`.

`pca.ts:128`

### A11 · EDGE — a fully non-numeric axis column clusters silently on a constant

`median([])` returns `0`, so `imputeColumns` fills such a column entirely with zeros; it contributes nothing to
distance, and `runClustering` still reports success with cluster sizes. Verified: a text second axis produced six
labels and no warning. (A genuinely *missing* column throws, which is correct — that path is fine.) Guard before
the run: if an axis column has no numeric values, refuse and name it.

`cluster.ts:51-56` · `table.ts:28-33` · `page.tsx:1741-1768, 2299-2330`

### A12 · EDGE — empty k-means clusters keep their centre

sklearn relocates them. Keeping means a k = 8 run can yield six non-empty labels with gaps in the numbering, and
the reported size list quietly has fewer entries than k.

`cluster.ts:152-155`

### A13 · EDGE — the Jacobi convergence test is absolute, not norm-relative

`Math.sqrt(off) < 1e-12` can never be satisfied for covariance PCA on large-magnitude columns, so it burns all
100 sweeps. Results verified still correct and finite; at p ≈ 200 that is ~10⁹ operations on the main thread.

`pca.ts:74-78`

### A14 · WRONG — missing-value sentinels are never detected

Verified: a column containing `-99`, `-999` or `9999` parses those as ordinary numbers. They then enter the PCA
correlation matrix, Euclidean distances, Pearson/Spearman, and the mini-histogram as genuine measurements. SPSS
and Qualtrics exports use these codes routinely and this app's stated audience is survey research — so of
everything in this review, this is the most likely to silently produce a wrong published number.

A cheap, honest version: at profile time flag any numeric column whose extreme values are sentinel-shaped and far
from the rest of the distribution, and show a dismissible warning in the Variables row. Don't auto-strip them —
just don't let them pass unremarked.

`parse.ts:305-318` · `table.ts:6-13` · `page.tsx:582-592`

---

## B. What the UI says — transparency

Every fact in this section is already written down somewhere in the repo. None is on screen.

| Method fact | Documented in | Visible in the app |
|---|---|---|
| K-Means is deterministic (k-means++, 10 inits, seeds 42–51, 300 iters) | `cluster.ts:94`, `methods.ts:36`, README | **No** |
| Missing values are median-imputed before PCA and clustering | `pca.ts:130`, `methods.ts:28`, TUTORIAL | **No** |
| Clustering uses only the 2–3 *plotted* axes | `assistant.ts:109, 165` | **No** |
| Group "sd" is population sd; η² is descriptive, not a test | `methods.ts:64` | **No** |
| "Loading" means unit-norm eigenvector weight | nowhere | **No** |
| Diagnostics run on ≤1,200 / ≤2,000 sampled rows | `stats.ts:126` | partly — `suggest_k` result only |
| Standardize = correlation vs covariance PCA | `methods.ts:24` | **Yes** — checkbox label + tooltip |
| Standardize-before-clustering, by data regime | `cluster.ts:25`, `methods.ts:32` | **Yes** — checkbox tooltip |

The last two rows are the model to copy: an honest label *and* a tooltip explaining the methodological trade-off.

### B1 · FIXED (2026-08-05) — say that K-Means is the deterministic variant

The `<select>` option reads *"K-Means"*. Nothing on screen says repeated runs give byte-identical clusters, which
is unusual enough that a researcher will assume the opposite and may re-run "to check stability" while learning
nothing. Suggested: *"K-Means (k-means++, deterministic)"*, with a tooltip in the register of the standardize one —
10 seeded initialisations, best inertia kept, up to 300 iterations, same input → same output. The corollary
belongs there too: determinism is reproducibility, not evidence of stable structure; varying k and re-running on
subsamples is still the check that matters.

`page.tsx:2970-2974` · facts at `cluster.ts:94, 116, 119`

### B2 · FIXED (2026-08-05) — say that missing values are median-imputed

The Variables panel already shows *"· 12 NA"* per column — the one place a user meets their missingness. It never
says what becomes of those 12 on Run PCA or Run Clustering. One line under each Run button, plus the imputed
count from A9.

`page.tsx:627-632` · `page.tsx:862-868, 2999-3003`

### B3 · FIXED (2026-08-05) — the Cluster section never said which columns it clusters on

Method, parameters, standardize, Run — and no statement that the input is the 2–3 columns currently on the axes.
The assistant's tool result *does* say it ("DBSCAN done on 3 axes (PC1, PC2, PC3)"); a user who never opens the
assistant has no way to know. This is also the app's biggest acknowledged analytic limitation (HANDOFF
Outstanding #9: "axes are the feature selection"), so naming it is both a transparency fix and honest framing of a
real constraint. Suggested: a live line above the Run button — *"Clusters on the plotted axes: PC1 · PC2 · PC3"* —
which also makes the limitation self-evident the moment someone plots two arbitrary raw columns.

**Resolved (B1–B3).** The method-vs-result split turned out to be the important design call, so it is recorded
here: facts *about the method* (k-means determinism, what eps does, correlation vs covariance PCA) sit behind an
"(i)"; facts *about this run* (which columns were clustered) are inline and unmissable. A tooltip cannot tell you
that 40% of a column was imputed, so putting run-specific facts behind hover would have reproduced the exact
failure this section describes.

- **B1** — the method dropdown reads "K-Means (deterministic)" and "DBSCAN (density-based)", with the full
  seeding/initialisation detail behind the (i) next to k, including the corollary that determinism is
  reproducibility rather than evidence of stable structure.
- **B2** — a line under both Run buttons states that missing values are filled with the column median, with the
  variance/attenuation caveat behind the (i). Per-run imputed counts remain open as A9.
- **B3** — a live line above Run Clustering: *"Clusters on the plotted axes: PetalLengthCm · PetalWidthCm ·
  SepalLengthCm"*. It updates with the axes, which makes the limitation self-evident the moment someone plots two
  arbitrary raw columns.
- Also: the eps slider now labels its unit ("SD units" / "axis units") per B5, and warns at min samples = 1.

New `src/lib/disclosures.ts` is the single source for these strings, so the sidebar, a future information page and
the assistant cannot drift apart — which is how A3 happened. `src/components/InfoTip.tsx` replaces the
`<span title>` in `AssistantPanel.tsx`: `title` never fires on touch and a span is not keyboard-focusable, so the
old one was invisible to anyone not using a mouse.

Verified on screen rather than by compilation, which caught two bugs the type-checker could not: the panel was
being painted over by later siblings, and clipped by the sidebar's `overflow-y-auto`. It is now portalled to
`<body>` with fixed positioning and clamped to the viewport.

`page.tsx` Cluster and PCA sections · `disclosures.ts` · `InfoTip.tsx`

### B4 · OPAQUE — the scree chart is truncated at k, so it cannot be used to choose k

The "Variance explained" bars plot `varianceExplained`, which has length k. Keep 3 components and you see 3 bars.
But `methods.ts` teaches the Cattell scree test and the Kaiser eigenvalue > 1 criterion, and both need the *full*
spectrum — the elbow is invisible if the plot stops at the elbow. Return all p eigenvalues from `runPCA`, plot
them all, and mark the kept ones.

`page.tsx:907-921` · `pca.ts:210` · `methods.ts:16`

### B5 · OPAQUE — the eps slider maxes at 5, in unlabelled data units

`min=0.1 max=5 step=0.1`. With standardize off, eps is in raw data units. Verified: on income-scale axes,
`eps = 5` — the slider's maximum — labels 100% of points Noise, and the UI offers no way to go higher; only the
assistant's `run_clustering` can pass a larger value. Three fixes: scale the slider range to the data (or accept a
typed value), label the current unit next to it ("SD" when standardize is on, the axis unit when off), and either
exclude `min_samples = 1` or warn that it makes every point a core point.

`page.tsx:2976-2983`

### B6–B9 · four smaller labelling gaps

- **B6** — scree bars and the summary line are hard-coded to `PC${i+1}`, so a `COMP_openness` run shows a bar labelled "PC1". `page.tsx:912, 919`
- **B7** — `suggest_k`'s result discloses the 1,200-row sample; `suggest_eps` prints `n=<sampled>` without saying it is a sample of up to 2,000, which reads as the row count. `page.tsx:2464` vs `2477`
- **B8** — exported PC scores and Cluster labels for rows with missing inputs are imputation-derived and the CSV carries no marker. `page.tsx:2085-2108`
- **B9** — heatmap PNG cells are individually rounded, so rows need not sum to 100%. `clusterBreakdown.ts:161`

---

## C. Import → export

Tested empirically against the pinned versions — PapaParse 5.5.4 and SheetJS 0.18.5 — not reasoned about.
Everything below is a confirmed behaviour.

### C1 · FIXED (2026-08-05) — `res.errors` from PapaParse was discarded entirely

The `complete` callback reads `res.meta.fields` and `res.data` and never looks at `res.errors`.

| Input | Reported error | What the user gets |
|---|---|---|
| ragged rows | `TooFewFields` / `TooManyFields` | extra fields land in `__parsed_extra`, which is not in `meta.fields`, so they are dropped; short rows silently become nulls |
| unterminated quote | `MissingQuotes` | the rest of the file collapses into one cell → 1 row → a confusing "needs at least two numeric columns" |
| leading title line (Qualtrics/SPSS) | `TooManyFields` | the title becomes the only column name, the real header row becomes data, everything after is discarded |
| no header row | none | the first data row silently becomes the column names; one row of data is lost |

**Resolved.** `readTable` now returns `{ table, warnings }` and the parsers report anything that silently changed
the data. The upload handler puts warnings *above* the success message, the sidebar renders them with
`whitespace-pre-line`, and the "✳ Ask the assistant" chip now fires on warnings too — with wording that
distinguishes a warning from a failure, so the assistant is asked the right question.

Covered: unterminated quotes (naming the line, since everything after is swallowed), ragged rows in both
directions (extras discarded / gaps blanked, with line numbers), undetectable delimiter on a single-column result,
blank header cells, repeated header names (C2), an all-numeric header meaning no header row, and numeric-looking
text (C3).

**This commit changes no parsing behaviour** — it is purely additive, so it cannot regress data handling. The
remaining C-series items (C4, C5, C7, C8, C10) do change behaviour and are separate.

Two things worth recording from doing it. First, `parseCSVText(text)` is now split out from the `File` plumbing:
PapaParse reaches for `FileReaderSync` when handed a `File`, which only exists in a Worker, so the warning logic
was untestable as written. It costs nothing — with no `chunk` config PapaParse's own `FileReader` path already
materialised the whole file as one string. Second, duplicate-header detection uses PapaParse's own
`meta.renamedHeaders` rather than pattern-matching the result; a column genuinely named `Q1_1` alongside `Q1` is
ordinary in survey exports, and there is a test asserting that case stays quiet.

`parse.ts` · `page.tsx:1474-1489, 2846-2861` · tests in `parse.test.ts`

### C2 · FIXED (2026-08-05) — duplicate headers were renamed silently

`Q1,Q1,Age` becomes `["Q1","Q1_1","Age"]`. PapaParse logs it to the console; the app didn't, so the user
analysed a column under a name they never wrote. Now reported via `meta.renamedHeaders`, naming both the original
and the rename. Still relevant to F19: taking `header: false` means inheriting this dedupe by hand.

`parse.ts` · `parse.test.ts`

### C3 · FIXED (2026-08-05, detection) — European decimal commas turn every measure into a text column

Verified with `Q1;Q2;Age` / `1,5;2,5;30`: PapaParse auto-detects the semicolon delimiter correctly, but
`dynamicTyping` leaves `"1,5"` a string. Those columns then fail `numericColumns()`, and `processUpload` throws
*"Dataset needs at least two numeric columns to plot"* with no hint about the cause. A German or French Excel
export — the canonical alternatively-formatted dataset — is unusable and the error points the wrong way.
Thousands separators (`"1,234"`) fail identically.

**Resolved by naming it, not by converting it.** A column arriving entirely as text is now checked against decimal
commas, thousands separators and percent signs; at ≥80% match the warning names the affected columns and how to
fix the file. Deliberately not auto-converting: silently reinterpreting text as numbers can corrupt genuine
strings, and the user is the one who knows their locale. The grouped form (`1,234`) is tested before the decimal
form because it satisfies both readings.

Still open: the downstream message from `engine.ts:291` ("needs at least two numeric columns") remains
uninformative on its own — it is now preceded by a warning that explains the cause, but the message itself could
name the text columns it rejected.

`parse.ts` · `engine.ts:289-293` · `parse.test.ts`

### C4 · WRONG — XLSX reads only the first sheet, silently

`wb.Sheets[wb.SheetNames[0]]`, unconditionally. Verified on a `["Readme","Data"]` workbook — an extremely common
shape — the app reads `Readme`, gets zero rows, and reports *"First sheet is empty"* without mentioning that a
`Data` sheet exists. At minimum list the sheet names in that error; better, offer a picker when there is more than
one.

`parse.ts:320-329`

### C5 · WRONG — XLSX dates become Excel serial numbers

`XLSX.read` is called without `cellDates: true`, so a date column arrives as `46024`: a plottable, PCA-able,
clusterable "measurement" with no indication it is a date. The `v instanceof Date` branch in `sanitizeCell` is
dead code on this path. Verified.

`parse.ts:320-329` · `table.ts:10`

### C6 · OPAQUE — Excel columns formatted as Text vanish from the app, though the PCA math handles them

`pca.ts:135` and `engine.ts:214` coerce numeric strings; `numericColumns()`, `numericPairs()` and
`imputeColumns()` do not. Pick one convention.

`page.tsx:273` · `stats.ts:43` · `cluster.ts:55`

### C7 · OPAQUE — a title row above the header yields phantom `__EMPTY` columns and shifted data, with no error

Verified.

`parse.ts:320-329`

### C8 · EDGE — a blank XLSX header cell becomes a column named `""`

The CSV path filters those out; the XLSX path doesn't.

`parse.ts:312` vs `320-329`

### C9 · EDGE — no file-size guard anywhere

Nothing in `uploadFiles` or `readTable` bounds input size, and parsing runs on the main thread with no worker, so
a large CSV freezes the tab showing only "Processing…". See F23.

`page.tsx:1464-1512`

### C10 · OPAQUE — components-file projection truncates, zero-pads, and coerces, all silently

Four silences in one function:

- Only the *intersecting* variables are used, with no renormalisation, so a 50-variable components file matched against 20 present columns produces a truncated dot product that is not the PC score — and the message reports the count used but never how many were missing.
- Matching is case- and whitespace-sensitive (`df.columns.includes(v)`), so `Openness` vs `openness` yields no overlap at all.
- `PC1/PC2/PC3` are always created and zero-padded, so a 2-component file yields an all-zero PC3 that `pickDefaultAxes` then assigns to the Z axis.
- `Number(v) || 0` turns an unparseable loading into a real zero without a word.

Report coverage as "used 20 of 50 components-file variables", warn below some threshold, offer case-insensitive
matching with an explicit note, and create only the PCs the file actually contains.

`engine.ts:197-287` (lines 200-208, 244-260, 262-271) · `defaults.ts:31-39`

### C11 · EDGE — workspace import validates only that `version` is truthy

`importWorkspaceFile` checks `!parsed.version` and nothing else. `applyWorkspace` then rehydrates table references
and hands the result to `setDatasets`, where render dereferences `d.table.nRows` — so a malformed, truncated or
hand-edited workspace file throws during render and white-screens the app with no recovery path. `version: 1` is
written but never read, so there is no forward-compatibility story either.

`workspaces.ts:132-139` · `page.tsx:1560-1578, 1626-1657`

### C12 · EDGE — CSV export has no BOM and no formula-injection guard

Non-ASCII column names mangle when Excel opens the file, and a cell beginning `=` `+` `-` `@` can be interpreted
as a formula.

`page.tsx:2088-2098`

### C13 · EDGE — `exportPNG` doesn't pause auto-rotation the way `exportGIF` does

A PNG saved mid-rotation can capture a moving camera.

`page.tsx:1886-1909` vs `1919-1920`

### OK — what the import/export path gets right

BOM and CRLF handled; semicolon, tab and pipe delimiters auto-detected; Parquet BigInt downcast for plotting; the
HTML export inlines the Plotly bundle from `public/vendor` (generated by the `prebuild`/`predev` hooks — not a
missing file) and neutralises `</script` in both the bundle and the JSON payload; the GIF encoder holds React
still for the whole capture loop and restores the camera in `finally`; export dressing is applied and removed
symmetrically; the column-transfer alignment probe deliberately avoids PC/axis columns as identity checks, which
is a subtle and correct call.

---

## D. The assistant

### D1 · OPAQUE — the assistant can't state the app's own guarantees unless it happens to retrieve the right chunk

"Will I get the same clusters if I run this again?" is the most natural reproducibility question a researcher can
ask, and it is a question about *this app's implementation*, not about statistics. Nothing routes it to
`get_methods_reference`; the system prompt doesn't contain the answer; the `run_clustering` description doesn't
either. The fact lives in exactly one place — `methods.ts:36` — reachable only if the model decides to search for
it. The default prior for k-means is "no, it's randomly initialised", so the likely answer is confidently wrong
about your own software.

Same for "how are missing values handled?" (`methods.ts:28` only) and "what does clustering actually use?" (tool
description only). Fix: four sentences in `buildSystemPrompt` — k-means is deterministic here; missing values are
median-imputed; clustering runs on the plotted axes only; group sd is the population sd. Cheap tokens, and the
facts the assistant is least able to guess.

`assistant.ts:512-546` · `assistant.ts:163-178, 290-307`

### D2 · OPAQUE — `suggest_k` and `suggest_eps` can answer in different units than the run that follows

Neither tool takes a `standardize` parameter, so both read the UI toggle, while `run_clustering` accepts an
explicit override. So `suggest_k` → `run_clustering(standardize: true)` produces a recommendation computed on raw
scales and then a run performed on z-scores — the exact mismatch the comment at `page.tsx:2457` says it exists to
prevent. Add the parameter to both diagnostics and echo the resolved value in the result.

`assistant.ts:342-371` · `page.tsx:2453-2478` vs `2306`

### D3 · OPAQUE — `transfer_column` skips the alignment probe the UI performs

The manual panel computes an identity-column agreement check and shows *"Check (Id): 140/150 agree ⚠"* in red,
with a comment noting that silently mis-joining respondents yields wrong science. The assistant path checks only
that row counts match. It also reports `filled = tgt.table.nRows` unconditionally in order mode, even though
`handleTransfer` already computes the true filled count. Of everything the assistant can do, this is the one
operation that silently produces wrong results rather than a wrong-looking picture — it should be the *best*
guarded, not the least.

`page.tsx:2506-2529` · probe at `page.tsx:1051-1067` · real count at `page.tsx:1680`

### D4–D6 · three places where a tool result overstates what happened

- **D4** — in 2D, `set_plot` writes only `axes2d.x/y` and drops `z`, but the `parts` summary still includes `z=<col>`, so the result claims an axis change that never occurred. `page.tsx:2276-2291`
- **D5** — `snapshot()` omits `camera`, `range2d` and `notes`, and `MUTATING_TOOLS` omits `control_view` and `save_cluster_heatmap`; camera and viewport moves are therefore not undoable, and the heatmap tool changes snapshot-covered state without offering the button — while the README promises "Undo for anything the assistant changes". `page.tsx:2624-2650` · `assistant.ts:89-93`
- **D6** — `onToolUse` fires *before* execution, so a rejected `set_plot` ("Not applied. …") still marks the turn mutated and shows an Undo button for a turn that changed nothing. `AssistantPanel.tsx:187`

### D7 · EDGE — chat history is never truncated, and the full column profile is resent up to 16 times per turn

`historyRef` grows without bound, and `buildSystemPrompt` — which embeds every column's profile — is rebuilt on
every iteration of the tool loop, up to `MAX_LOOPS = 16` per user turn. On a wide dataset during a guided tour
that is a lot of repeated tokens on the user's own key, and a long session will eventually exceed context with no
graceful degradation.

`AssistantPanel.tsx:68, 176` · `assistant.ts:672-681`

### OK — what the assistant integration gets right

The privacy contract holds — all 24 tools checked, none can emit a raw row; `getState`, `correlate`,
`compareGroups` and `getClusterBreakdown` all return aggregates only. The bridge-ref indirection plus the
double-`requestAnimationFrame` yield genuinely solves the stale-state problem, and `freshTableRef` correctly
covers the within-turn case the yield can't. Tool errors are validation-first and instructive, listing the valid
column names. The download tools are all told to wait for explicit consent. The OAuth PKCE flow scrubs `?code=`
from history and ignores a callback with no stored verifier. Model filtering by `supported_parameters` including
`tools`, with a pass-through for endpoints reporting no capabilities, is the right call for Ollama support. The
`iris_demo` tour script is unusually well specified — the "don't set shape before step 5" constraint shows someone
actually ran it.

---

## E. Dependencies, consistency, coverage

### E1 · WRONG — `xlsx@0.18.5` carries a high-severity advisory with no npm fix

`npm audit` on the pinned version reports prototype pollution (`GHSA-4r6h-8v6p-xvw6`) and ReDoS
(`GHSA-5pgg-2g8v-p4x9`), severity high, *"No fix available"* — because the npm `xlsx` package is abandoned and
SheetJS now publishes 0.20.x only from its own registry. This library parses untrusted user-supplied files in the
browser, which is the exposure these advisories describe. Either move to the SheetJS tarball or document the
accepted risk explicitly.

`frontend/package.json` — `"xlsx": "^0.18.5"`

### E2 · OPAQUE — PC-column detection uses three different conventions

Case-sensitive `/^PC\d+(_|$)/` in the PCA panel and the assistant's `runPCA`; case-*insensitive*
`/^PC\d+(_|$)/i` in `suggestStandardize`; and an exact `['PC1','PC2','PC3']` membership test in
`pickDefaultAxes`. `synthetic_pconly_dataset.csv` uses lowercase `pc1`/`pc2` — which therefore gets standardize
*off* (treated as PC scores by the clustering heuristic) while simultaneously being offered as a PCA input
(treated as a raw variable by the PCA panel). One shared predicate in `pca.ts`, used everywhere.

`page.tsx:771, 2423` · `cluster.ts:38` · `defaults.ts:32` · `page.tsx:1056`

### E3 · EDGE — CI runs only the unit tests

The workflow's only step is `npx vitest run`: no `next build`, no `tsc --noEmit`, no `eslint`. A type error or a
broken build reaches Vercel before it reaches CI, which matters more than usual given HANDOFF Outstanding #3
(local builds not trusted).

**Partly unblocked (2026-08-05):** `eslint` was unusable as a gate because `public/vendor/**` — the 1.7 MB
minified Plotly bundle the `prebuild` hook copies in — was being linted, reporting ~4,450 problems on top of the
~135 real ones. It is now in `globalIgnores`. Adding `tsc --noEmit` and `eslint` to the workflow is now a
reasonable next step; the 128 pre-existing errors are almost all deliberate `any` on the columnar cell type, so
they would need either a baseline or a rule exemption first.

`.github/workflows/test.yml` · `eslint.config.mjs`

### E4 · PARTLY FIXED (2026-08-05) — the untested files are where the confirmed bugs are

Zero tests for `dbscan`, `parse.ts`, and `engine.ts`'s components-projection path — the three places every
confirmed correctness bug in this review lives. Spearman's midrank tie handling is also untested. The 45 original
tests are good; they covered the parts that turned out to be right.

**`dbscan` now has coverage** (6 cases): that `minSamples` counts the point itself, blob separation with a lone
outlier labelled Noise, border points being absorbed without expanding through them, determinism, median
imputation of a missing coordinate, and the raw-scale eps failure from B5. Plus the cross-check tying
`kDistancePercentiles` to actual `dbscan` behaviour. **`demoData.test.ts`** adds the suite's first external ground
truth for `runPCA`.

**`parse.ts` now has coverage too** (18 cases): clean input staying silent, BOM/CRLF/quoted delimiters,
semicolon and tab detection, every warning path above, and the negative case where a genuine `Q1_1` must not be
reported as a duplicate.

Still open: `engine.ts`'s components-projection path (C10) and Spearman ties. Suite is now 77 tests.

`frontend/src/lib/__tests__/`

### E5 · EDGE — `isIdentifierColumn`'s `/ID$/` is over-eager

It matches any name ending in capital ID, so `VALID` or `HYBRID` would be excluded from default axes and from the
assistant's default PCA variable list.

`defaults.ts:7-12`

### E6 · EDGE — scale ceilings, for the record

DBSCAN is O(n²) and `queue.push(...jn)` spreads into `push`, which can exceed the argument limit on very large
neighbour sets; `distMatrix` allocates n² doubles. Fine at survey scale — but these are cliffs, not slopes, and
there is no row-count guard keeping users on the right side of them.

`cluster.ts:88` · `stats.ts:141-154`

---

## F. Optimization — import and render

### The import pipeline is fine — start by not optimizing it

Full path, file drop → table in state → first paint, benchmarked on ports of the actual functions (V8, so the
shape holds in Chrome; the browser additionally pays file I/O and cold JIT):

| Rows × cols | Cells | Parse + transpose | Setup | First paint | Total block |
|---|---|---|---|---|---|
| 500 × 20 | 10k | 11 | 3 | 12 | **25 ms** |
| 2,000 × 20 | 40k | 21 | 6 | 10 | **37 ms** |
| 10,000 × 30 | 300k | 102 | 45 | 20 | **166 ms** |
| 25,000 × 50 | 1.25M | 536 | 324 | 97 | **957 ms** |
| 50,000 × 50 | 2.5M | 1,108 | 557 | 199 | **1,864 ms** |
| 200,000 × 30 | 6M | 2,187 | 1,222 | 468 | **3,877 ms** |
| 500,000 × 30 | 15M | 6,452 | 3,621 | 1,377 | **11,450 ms** |

**Cell count, not row count, is the predictor.** One second lands at ~1.3M cells, ten seconds at ~13M. At
"hundreds to low tens of thousands of rows" the entire path is 25–170 ms — so for this app's audience, **no import
optimization is warranted**. Stage split is stable at roughly 56% parse and transpose, 31% setup, 12% first-paint
profiling, and that 31% is almost entirely one function (F18). Items below are conditional on caring about
50k × 50 and up; the three marked *do anyway* are near-free.

### F1 · WRONG — the OpenAI SDK and the whole markdown stack ship in the initial bundle

`assistant.ts:1` is a static `import OpenAI from 'openai'`. `page.tsx:13` statically imports `AssistantPanel`, and
`page.tsx:15` imports `GUIDE_TARGETS` as a *value* from `assistant.ts` — so making the panel lazy would not break
the chain on its own. The result: the OpenAI client, `react-markdown`, `remark-gfm`, `remark-breaks` and the
entire micromark/mdast tree are parsed and evaluated before first interaction, by every visitor, including
everyone who never opens the assistant and everyone without an API key, for whom the panel is inert.

Measured package weights, gzipped (upper bounds — pre-tree-shaking, so real bundle impact is lower): `openai`
224 KB, `micromark` 36 KB, `mdast-util-from-markdown` 10 KB, plus the rest of the remark chain. Realistically
order-of-100 KB gzipped on the critical path, ahead of the 1.65 MB Plotly chunk.

The fix is a pattern this codebase already uses correctly four times over — `xlsx` (7.5 MB unpacked),
`hyparquet`, `gifenc` and Plotly are all behind `await import(...)`. Three steps: move `GUIDE_TARGETS`,
`MUTATING_TOOLS` and the shared types into a dependency-free contract module; wrap `AssistantPanel` in
`dynamic(..., { ssr: false })`; lazy-import the OpenAI client inside `runAssistantTurn`. One wrinkle:
`describeApiError` uses `instanceof OpenAI.AuthenticationError`, so it needs either a cached module handle or a
switch to `err.status` codes.

`assistant.ts:1` · `page.tsx:13, 15` · `AssistantPanel.tsx:5-11` · `assistant.ts:765-772`

### F2 · OPAQUE — first paint is gated on full hydration

`if (!mounted) return null` means the app renders nothing on the server *and* nothing on the first client render,
so the user gets a blank white page until React hydrates — then waits again for the `ssr: false` Plotly chunk,
which has no `loading` fallback. The `mounted` gate exists because `next-themes` can't know the theme
server-side, which is legitimate; the usual mitigation is a theme-neutral shell rather than `null`. Right now the
`EmptyState` component is invisible until the moment it is no longer needed.

`page.tsx:22, 1320, 1439, 2695`

### F3 · OPAQUE — the HTML export is roughly twice the size it needs to be

`exportHTML` serialises whatever `buildTraces` returns, which in 3D includes the decorative ground-shadow trace:
a full copy of every x and y value, plus an n-length array holding the same z-floor constant repeated.
Coordinates also serialise at full double precision. Measured for a 20,000-point 3D export:

| Component | Size | Note |
|---|---|---|
| Real point data | 1,107 KB | x, y, z at full precision |
| Shadow trace | 1,070 KB | duplicate x and y, plus n copies of one constant |
| Inlined Plotly bundle | 1,654 KB | required for offline use |
| **File total today** | **3,831 KB** | |
| Coordinates at 6 sig figs, no shadow | 2,148 KB | **−44%**, visually identical |

Rounding to ~6 significant figures is free — no scatter plot resolves the 17th digit — and the shadow is a nice
touch in the live view that nobody needs in a shared file. Both changes are local to `exportHTML`.

`page.tsx:1999, 2040, 2056` · shadow built at `page.tsx:491-511`

### F4 · OPAQUE — `backdrop-blur` sits directly over the WebGL canvas, in the default theme

The legend and notes panels are `backdrop-blur-md` and positioned absolutely over the plot. `backdrop-filter:
blur()` forces the compositor to re-sample and re-blur the region behind it whenever that region repaints — and
behind it is a continuously repainting WebGL surface. So the blur is paid on every frame of auto-rotation and of
every GIF-export frame capture, in the Bauhaus theme that is the default. The design doesn't need it: a hard 3px
border and a 4px offset shadow already do the separation work, and the background is at 90% opacity anyway.

Same elements also carry `transition-all duration-200`, which transitions layout-affecting properties (`width`,
`maxHeight`) rather than only compositor-friendly ones.

`page.tsx:43, 56, 64` · `AssistantPanel.tsx:257`

### F5–F6 · two smaller wins

- **F5** — both themes' typefaces load unconditionally: `Courier_Prime` at weights 400 and 700 *and* `JetBrains_Mono`, so every visitor downloads and preloads the inactive theme's face. `layout.tsx:5-15`
- **F6** — `bridgeRef.current = { … }` is reassigned during render, allocating around thirty closures every time `Home` renders, which during auto-rotation is sixty times a second. Individually cheap, but it is the hottest loop in the app, and it is also a side effect during render (React 19 strict mode will double-invoke it), as is the `window.__scatterlabBridge` assignment beside it. `page.tsx:2230, 2653`

### F7 · WRONG — 2D scatter is SVG, one DOM node per point; `scattergl` is not in the bundle

Read from the package itself: `plotly.js-gl3d-dist-min@3.7.0` ships `cone, isosurface, mesh3d, scatter,
scatter3d, streamtube, surface, volume`. The `scattergl` strings in the minified file are all `_has("scattergl")`
capability checks in shared cartesian code, not a registered trace module. So `type: 'scatter'` in 2D mode is
Plotly's **SVG** path: one `<path>` element per point, no decimation. At 10,000 points that is 10,000 DOM nodes
rebuilt on every recalculation; at 50,000 it is a frozen tab.

This compounds with F8: in 2D, typing one character into the Notes box rebuilds every one of those paths. Fixing
it is a build decision — `plotly.js-dist-min`, or a custom bundle registering `scattergl` + `scatter3d` +
`mesh3d`, with the `copy-plotly` script and the inlined export bundle following along.

`PlotlyPlot.tsx:5` · trace types at `page.tsx:399, 433` · `package.json:6`

### F8 · WRONG — the trace memo holds in 3D and leaks in 2D, where it costs most

In 3D, `effectiveAxes`/`effectiveLabels` return `d.axes`/`d.labels` *themselves* — the dataset's own sub-objects,
replaced only by an axis edit or a PCA run — so the memo deps hold, `buildTraces` does not re-run during
rotation, and the optimization the comment at `page.tsx:1139` claims is genuinely delivered.

The 2D branch allocates: `{ x: d.axes2d.x, y: d.axes2d.y, z: null }` is a fresh literal every render. So in 2D
every unrelated state change — a slider tick, a Notes keystroke, a streaming assistant token, typing a workspace
name — invalidates the memo, rebuilds every trace, hands Plotly new array references, and triggers a full
recalculation. Combined with F7 that means a full SVG rebuild of every point.

`page.tsx:268-271` · memo at `page.tsx:1302-1305` · `page.tsx:2699`

### F9 · WRONG — the rotation loop drives every plot through React, and the layout object defeats the one guard that would stop it

`setCamera` inside `requestAnimationFrame` re-renders the whole `Home` subtree 60 times a second — sidebar,
Variables panel, PCA section, cluster breakdown, all four panes, and the assistant. `renderView` then calls
`getLayout(...)` **inline and unmemoized**, so each pane gets a fresh layout object. `react-plotly.js` guards on
`prev.layout === layout && prev.data === data`: the data matches, the layout never does, so `Plotly.react` fires
on **all four plots, every frame**, each paying `cleanData` + `supplyDefaults` over every trace. No `revision`
prop is passed anywhere, so the escape hatch that exists for exactly this is unused.

The good news is what the diff then does: `diffData` compares array attributes by *reference*, they all match, and
there is no recalculation and no GPU re-upload. So the waste is React plus four redundant round-trips, not data
churn. Driving the camera with `Plotly.relayout` straight from the rAF loop collapses this to one camera write and
one redraw, and the win is independent of dataset size.

`page.tsx:1442-1460, 2670, 1770`

### F10 · WRONG — the assistant transcript is re-parsed from markdown on every frame of rotation

`AssistantPanel` is not memoized, receives a fresh `onDockChange` closure every `Home` render, and maps its chat
array to a fresh `ReactMarkdown` per message. The remark pipeline measures **1.06 ms per message** for a ~1 KB
reply. So a ten-turn conversation adds **~11 ms per frame** of pure markdown re-parsing during auto-rotation;
twenty turns blows the 16.7 ms frame budget **on the 150-row iris demo**. This is the largest rotation cost at
small and medium dataset sizes and has nothing to do with the data. `React.memo` on the panel plus a memoized
per-message component removes it entirely.

`AssistantPanel.tsx:52, 379-390` · `page.tsx:3062`

### F11 · OPAQUE — pinned 3D views share the live camera, so a pin can never hold its own angle

`getLayout` reads the single `camera` state for every 3D pane, so all pins rotate with the live view — four scene
redraws per frame, and a pin that cannot preserve the viewpoint it was taken from. A UX bug with a performance
tail; the fix pattern already exists two lines away, since the 2D viewport *is* correctly captured per pin.

`page.tsx:1798` vs `page.tsx:2123` · `page.tsx:2670`

### F12 · OPAQUE — adding or removing a pin purges and re-creates *every* plot

`TmuxGrid` returns a structurally different tree per view count — for one view the root's child is
`WrappedView`, for two it is a `div` wrapping them. React sees a changed child type at the same position,
unmounts the subtree, and `react-plotly.js`'s cleanup calls `Plotly.purge` — followed by a fresh `newPlot` for
every pane including the live one, with WebGL contexts destroyed and re-created. There are also no `key`s on the
panes, so pins shuffle identity on removal (and the four-view branch orders them 0, 3, 1, 2).

`TmuxGrid.tsx:43-78`

### F13 · OPAQUE — cluster sliders and Notes keystrokes re-render all four plots, for nothing

The eps, min-samples and k sliders fire `onChange` on every `input` event — 30–60 per second while dragging — and
each re-renders the whole tree and issues four `Plotly.react` calls. **None of those three values affects the plot
at all until Run Clustering is pressed**, so 100% of that work is waste. In 2D, with F7 and F8 in play, each tick
is a multi-hundred-millisecond freeze, and the promise chain in `react-plotly.js` queues them so the freeze
outlives the drag. Same applies to `notes`, `workspaceName`, axis-label typing, `breakdownBy`, `heatmapPalette`
and `includeExportInfo`.

`page.tsx:2979, 2981, 2987` · state at `page.tsx:1351, 1398-1405, 1425`

### F14 · OPAQUE — the column-profiling pass runs three times per table change in render, plus once on demand

The same scan is implemented four times: `VariablesPanel.profiles`, `ClusterBreakdown.candidates`,
`PCASection.numericVars` — all three in render — plus `columnProfiles()` for the assistant bridge, which is
**lazy**: despite sitting inside the per-render `bridgeRef.current` assignment, it only executes when `getState()`
is called, so it is *not* a first-paint cost. Don't wrap it in a `useMemo` expecting a win; just have it read the
shared record.

Measured for one pass: **35 ms at 10k × 30 columns, 138 ms at 50k × 30, 839 ms at 50k × 200**, plus 11–158 ms for
histogram binning. `numericColumns` specifically runs **three times with identical results** — in
`processUpload`, in `pickDefaultAxes`, and in `PCASection` — at 15.5 ms per call on a 200k × 30 table. One
`WeakMap<DataTable, Profile[]>` cache serves every consumer; because tables are replaced wholesale and never
mutated (a deliberate, load-bearing invariant), that cache is automatically correct and self-evicting. A single
fused pass measured **157 ms against 1,699 ms** for the six separate ones.

Two allocations worth killing on their own: `MiniHistogram`'s `values.filter(...)` copies the whole column to
compute 14 bins (7.9 ms of its 12.7 ms at 200k rows; a single no-copy pass is 4.0 ms), and `shapeCategories` does
`vals.map(String)` across every row just to discover at most six distinct values — **8.4 ms → 0.0 ms** with a
Set-first loop that bails past seven. That one is called from both `buildTraces` and `ThemedLegend`.

Also: `ColumnTransfer`'s alignment-probe memo is defeated because its dependency list includes `shared`, computed
inline as a fresh array every render. With two or more datasets loaded, an O(n·C) alignment scan re-runs on every
render.

`page.tsx:582, 2195, 938, 770` · probe at `page.tsx:1046, 1054-1067`

### F15 · EDGE — `buildTraces`, measured, and the two lines worth changing

Because the 3D memo works, this runs on axis/colour/mute/cluster/theme changes rather than per frame. Measured
3D: **1.16 ms** at 10k × 5 categories, **5.93 ms** at 50k × 5, **15.88 ms** at 50k × 50 with shape on (152
traces). The continuous-colour path is the fast one at 3.58 ms because it hands the columnar arrays to Plotly
unreshaped.

Two specifics. The composite shape key `` `${cval}␟${sval}` `` allocates a string per point per call and is **the
single most expensive line in the function — 4.8 ms of the 50k total**; a numeric key into a `Map` removes it. And
the single-pass bounds loop is genuinely almost free at **0.07 ms** — the 2.25 ms attributed to it is entirely the
`shadow_x`/`shadow_y` pushes riding inside it. At `opacity: 0.1, size: 2` a decimated shadow is
indistinguishable, so striding it above a few thousand points costs nothing visually and halves both the copy and
the GPU point count.

`page.tsx:368` · `page.tsx:458-500` · `page.tsx:411-437`

### F16 · EDGE — the GIF export spends 18 seconds asleep in a Plotly constant

`Plotly.toImage` deep-copies every data array, spins up an offscreen `newPlot` with its own WebGL context, and —
because the plot has a gl3d subplot — waits a hard-coded **500 ms** before capturing. Times 36 frames, that is 18
seconds of pure sleeping before any real work. Measured `gifenc` cost on top: 81 ms/frame at 10k points, 313
ms/frame at 50k. Estimated totals: **~27 s at 10k, ~46 s at 50k**, all blocking the main thread.

Two independent wins. Moving quantize/palette/LZW into a Worker with transferable buffers hides 3–11 s behind the
capture (which is 90% idle anyway) and unblocks the UI — low risk. Quantizing once on frame 0 and reusing the
palette turns 313 ms/frame into ~36 ms at 50k, worth offering as a "fast GIF". The larger win — `relayout` plus
the scene's own `gl.readPixels` instead of `toImage`, dropping all 36 sleeps, deep copies and context
create/destroys, ~46 s → ~5 s — depends on `_fullLayout.scene._scene`, a private API. `get2dRange` already takes
that dependency knowingly.

`page.tsx:1940-1963`

### F17 · EDGE — plot chrome may be silently falling back to Plotly defaults; worth one browser check

`getLayout` sets `template: 'plotly_white'` and passes CSS custom properties as Plotly colours (`font: { color:
'var(--foreground)' }`, on axis titles, tick fonts and the legend). Plotly resolves templates only from plain
objects, not name strings, and validates colour attributes with its own parser, which does not understand
`var(...)`. If that reading is right, both are inert: the template does nothing and every one of those font
colours falls back to Plotly's default grey rather than following the theme. Zero performance cost either way,
but it would mean the theme-aware plot chrome the code intends is not applying. Cheap to settle: inspect the
computed fill on an axis title in both themes. Note that `exportHTML` already duplicates this layout logic with
*concrete* hex colours, which is suggestive.

`page.tsx:1776, 1777, 1781, 1794-1795, 1808-1809` vs `page.tsx:2010-2035`

### F18 · OPAQUE — `pickDefaultColorBy` re-scans every column up to six times (*do this one anyway*)

This single function is nearly all of the 31% "setup" share, and the reason is a sort comparator:

- `uniqueNonNull(values).length` is computed **before** the `!isIdentifierColumn(name)` guard, so every column pays a full scan and a full-cardinality `Set` even when its name already disqualifies it.
- `isBooleanLike` then scans again.
- The sort comparator calls `uniqueNonNull` on *both operands of every comparison* — O(k log k) full column scans.

Measured five to six complete passes per qualifying column, and a 200,000-element `Set` per numeric column
(+63 MB transient at 200k × 30).

| Size | As shipped | Guarded + capped + cached | Win |
|---|---|---|---|
| 10k × 30 | 39 ms | 5.4 ms | 7× |
| 50k × 50 | 500 ms | 28 ms | 18× |
| 200k × 30 | 1,194 ms | 65 ms | 18× |

The fix is about thirty lines — name-guard first, one cardinality-capped scan per column that bails past 21
distinct, compute boolean-likeness in the same pass, sort on the cached count — and it was verified to produce
**identical output across 24 test cases** including the 20-vs-21 distinct boundary, all-null columns, ties,
`Cluster`, and identifier-only tables. Pure function, no caller depends on its internals.

`defaults.ts:45-65` (lines 53, 57, 59)

### F19 · EDGE — the rows-of-objects intermediate costs 15–17× the file size in heap, and streaming is *not* the fix

`rowsToTable` is not slow in itself — 84 ns per cell including the transpose write. The cost is that PapaParse
must first materialise one object per row, and row objects get *worse* per cell as tables widen because V8 drops
wide objects to dictionary mode: **28 B/cell at 10 columns, 70 B at 30, 79 B at 50**, against a flat 23.4 B/cell
for the columnar result. At 200k × 30 that is ~420 MB of throwaway intermediate on top of a ~140 MB result.

Parsing with `header: false` and transposing positionally: **−35 to −48% time and −44 to −48% peak memory**
(50k × 50: 1,239 ms / 250 MB → 641 ms / 131 MB). Adding `chunk` streaming on top buys almost nothing — 4% time,
12% memory. Worth stating plainly because streaming is the intuitive answer and it is the wrong one: **the win is
not building row objects, not reading the file in pieces.**

One behaviour change ties straight to **C2**: `header: true` is what makes PapaParse dedupe duplicate column
names (`a,b,a` → `a,b,a_1`). A naive positional transpose collides instead. So taking this means inheriting the
dedupe — a reason to fix C2 deliberately rather than by accident. `res.meta.fields` also disappears; you read row
zero yourself. Nine other edge cases (ragged rows, empty header cells, quoted commas and newlines, blank lines,
BOM, header-only) were byte-identical.

`parse.ts:305-318` · `table.ts:16-23`

### F20 · EDGE — Parquet builds a third full copy and sanitizes every cell twice (*do this one anyway*)

`parseParquet` maps hyparquet's rows into a new `fixed` array of row objects and *then* calls `rowsToTable` on it,
so the original rows, the mapped copy, and the columnar result are all alive at peak — measured **+314 MB for the
extra copy alone**, 359 MB above the original array with all three live — and `sanitizeCell` runs twice per cell
(idempotent, so correct, just wasted: 12M calls for 6M cells).

Two lines: add `if (typeof v === 'bigint') return Number(v)` to `sanitizeCell` and pass `rows` straight through.
Strictly less work, one fewer representation, and it closes the gap where the BigInt branch currently bypasses
`sanitizeCell`'s finite check entirely.

`parse.ts:331-343` (lines 337-342) · `table.ts:6-13`

### F21 · EDGE — saving a workspace serialises the whole payload twice, for a display-only byte count (*do this one anyway*)

`saveWorkspace` calls `new Blob([JSON.stringify(payload)]).size` purely to record a number shown in the workspace
list, then hands the same payload to IndexedDB, which structured-clones it again. Measured on a 200k × 30 table:
**510 ms to stringify** (producing a 38.6 MB string), 20 ms for the Blob, **1,080 ms for the structured clone** —
about **1.6 s of main-thread block and +77 MB transient per save**. Estimate the byte count from dimensions, carry
it forward from the previous save, or drop the exact figure; `bytes` is metadata, not data. The same double-pass
shape is in `exportWorkspaceFile` and `importWorkspaceFile`.

`workspaces.ts:108-112` · callers `page.tsx:1585, 1603, 2545`

### F22 · EDGE — the components projection is row-major for a column-major algorithm

`processUpload`'s components path allocates n small row arrays and then indexes `X[i][j]` inside a j-outer loop:
worst-case locality. Then it allocates n more three-element arrays for coordinates and maps over them three times.
Rewritten column-major over a flat `Float64Array` with a reused scratch buffer: **3.2× faster and 4.5× less
memory** (200k × 30: 1,374 ms / +216 MB → 431 ms / +48 MB) with **bit-identical output**. Only matters if users
supply components files with large datasets — the no-components path is 17 ms at that size.

`engine.ts:226-260`

### F23 · EDGE — nothing is off the main thread

No `Worker`, no `step`, no `chunk`, no progress reporting anywhere in the repo. Two useful facts: PapaParse's
`worker: true` **would work as a near-drop-in** — the config is fully cloneable and, with no `chunk` supplied, the
worker posts exactly one message with all rows (verified; the intuitive fear that it silently truncates is
unfounded). Net main-thread block at 200k × 30 drops from ~2.4 s to ~0.5 s and the tab stays responsive. But it
covers **CSV only** — SheetJS and hyparquet are synchronous with no worker option — and there is a trap if
`chunk` is later added for a progress bar: Papa then hands `complete` only the *last* chunk, so you must
accumulate in the chunk handler and ignore `complete`'s data. Relatedly, because `chunkSize` is currently null,
`FileReader` materialises the entire file as one UTF-16 string — roughly twice the file's bytes — at the same
moment as the row objects and the table.

`parse.ts:305-318, 320-343` · the only yield is `page.tsx:1473`

### OK — already well optimized, don't undo these

The heavy parsers and encoders are all correctly behind `await import(...)`, keeping 7.5 MB of SheetJS out of the
main bundle. Plotly comes in as its own `ssr: false` chunk, and the partial gl3d build is used rather than full
Plotly. No component is defined inline inside `Home` — the comment at `page.tsx:1141` records a lesson learned,
and it still holds across all 3,066 lines. **The trace memo genuinely works in 3D.** `ThemedLegend`'s memo deps
are stable primitives and the stable data array rather than the freshly-built view object — exactly the
discipline `ViewPlot` needs for its 2D case. The continuous-colour path hands columnar arrays to Plotly with zero
copies and three traces instead of fifty-two, measuring nearly twice as fast as the categorical path.
`getColorFieldKind` early-exits at 21/51 distinct values, so a high-cardinality ID column costs O(51) rather than
O(n). Suppressing Plotly's own legend in favour of a custom one avoids a genuinely expensive layout at high trace
counts. Pins share the table reference and the workspace serializer dedupes tables by object identity, so there
is no duplication in the heap or on disk — and because tables are always replaced wholesale rather than mutated,
unchanged columns keep their array identity, so every sparkline survives a clustering run untouched.

The columnar `DataTable` is the right representation and measurably so: flat 23.4 bytes per cell no matter how
wide the table gets, where rows-of-objects degrades to 79 bytes per cell at fifty columns. `sanitizeCell` is
`typeof`-ordered with no regex and no allocation on the numeric fast path; `rowsToTable` totals 84 ns per cell
*including* the transpose write, so it is not the bottleneck — the row objects it reads from are. Every `useMemo`
dependency list in the file is correct except `ViewPlot`'s, and only in 2D. `columnProfiles` is lazy despite
appearances.

The bounds computation is a single pass with a correct comment about why spreading into `Math.min` would blow the
stack, and it measures 0.07 ms for 50,000 points. The upload and cluster handlers both `await` a frame so the busy
state paints before blocking work starts. The scanline animation is transform-only and correctly disabled under
`prefers-reduced-motion`. And the GIF export's refusal to touch React state during its capture loop — writing
progress into the button's `textContent` — is verified-correct hard-won knowledge: `toSVG` really does destroy the
cloned scene, so a `Plotly.react` landing mid-capture really does wedge it.

### Beyond fixing the above

- **Pass a `revision` prop.** `react-plotly.js` skips `Plotly.react` entirely when an integer revision is unchanged, even if object identities churn. One line, and it makes the whole identity-stability question a safety net rather than a tightrope — though not an excuse to skip F8. Its complement, `layout.datarevision`, switches Plotly to "arrays may have mutated" mode, which is what would let you reuse typed-array buffers in place.
- **Use `Plotly.restyle` for mute toggles.** Muting a legend category currently goes through a full `buildTraces` and recalculation, but it only changes `visible` and `marker.*`.
- **Density-preserving decimation, with an honest badge.** Bin to a screen-space grid once per axis/colour change and plot at most one point per cell per category, keeping the full data for hover and export. Caps GPU work at roughly the pixel count regardless of n. A "showing 12,400 of 480,000 points" note turns the arbitrary-upload claim into a real promise. Above ~10⁶ rows in 2D, a density image rather than point marks.
- **Split the state.** `Home` owns plot state, three form states, notes and UI state, which is why every keystroke re-renders the canvas. Two contexts plus `React.memo` on the grid and plot components makes F10, F13 and F14's probe issue disappear structurally rather than one at a time.
- **Move the O(n²) work off the main thread.** The `await new Promise(r => setTimeout(r, 30))` before clustering is a comment admitting the main thread is about to freeze. DBSCAN, k-means, PCA, parsing and profiling in one Worker with transferable typed arrays makes all of it cancellable, non-blocking, and able to report real progress.
- **Typed arrays: viable, and probably skip them.** `sanitizeCell` already maps `NaN` and `±Infinity` to `null`, so NaN is a free null sentinel; memory goes from 23.4 to 8.0 bytes per element and scans measure 2.1× faster. But `JSON.stringify(new Float64Array([1,2]))` produces `{"0":1,"1":2}` — an object, not an array — which would **silently break workspace save, export and import round-tripping**, and the `DataTable` cell type plus anything doing `.push` or spread on a column would need reworking. Meanwhile F19 saves ~70 bytes per cell of *peak* against typed arrays' 15 bytes of *result*. Do F19 first. Dictionary-encoding categoricals as `{ codes: Uint16Array, levels: string[] }` carries none of that risk and would make F15's numeric group key natural.
- **`content-visibility: auto` on Variables rows and collapsed sections.** One CSS line: at 200 columns the panel mounts every row and sparkline while showing about ten.
- **Instrument before optimizing further.** A dev-only counter around `buildTraces` and a monkey-patched `Plotly.react` tally would turn the estimated magnitudes above into measured ones, and say whether F7 or F9 dominates on real datasets. Logging `gd._fullData.length` alongside `nRows` on each rebuild makes the trace-count cliff visible before you are on it.

---

## A note on the framing

The request asked whether the UI accurately represents what is happening, with deterministic k-means as the
example. That instinct generalises further than the one label. The pattern across section B is that every
methodological choice this app makes deliberately — median imputation, population sd, unrotated components,
plotted-axes feature selection, unit-norm loadings, subsampled diagnostics — is documented somewhere a user will
never look, while the two choices that *are* surfaced (both standardize checkboxes) are surfaced well.

So the concrete version of "up to par and transparent" is probably a short methods note attached to each computed
result: what was imputed, what was standardized, which columns went in, which convention the numbers follow. That
prose already exists in `methods.ts`. It needs to be in the sidebar, in the run messages, and in the system
prompt — not only in the retrieval corpus.

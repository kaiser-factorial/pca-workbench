// Aggregate statistics for the assistant's analysis tools. Everything here
// returns summaries, never row-level data — that is the privacy contract.

type Cell = number | null | undefined | string;

const numericPairs = (a: Cell[], b: Cell[]): [number, number][] => {
  const out: [number, number][] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (typeof a[i] === 'number' && typeof b[i] === 'number') out.push([a[i] as number, b[i] as number]);
  }
  return out;
};

const pearsonOfPairs = (pairs: [number, number][]): number | null => {
  const n = pairs.length;
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (const [x, y] of pairs) { sa += x; sb += y; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (const [x, y] of pairs) {
    cov += (x - ma) * (y - mb);
    va += (x - ma) ** 2;
    vb += (y - mb) ** 2;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
};

// Average ranks with ties (midrank), for Spearman
const ranks = (vals: number[]): number[] => {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(vals.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = rank;
    i = j + 1;
  }
  return out;
};

// Pearson + Spearman over pairwise-complete numeric observations
export const correlation = (a: Cell[], b: Cell[]): { n: number; pearson: number | null; spearman: number | null } => {
  const pairs = numericPairs(a, b);
  const pearson = pearsonOfPairs(pairs);
  const ra = ranks(pairs.map(p => p[0]));
  const rb = ranks(pairs.map(p => p[1]));
  const spearman = pearsonOfPairs(ra.map((r, i) => [r, rb[i]] as [number, number]));
  return { n: pairs.length, pearson, spearman };
};

export type GroupStat = { group: string; n: number; mean: number; sd: number };

// Per-group mean/sd of a numeric column plus eta² (share of variance explained
// by group membership) — the standard effect size for "does this differ by group"
export const compareGroups = (
  numeric: Cell[], groups: Cell[],
): { groups: GroupStat[]; overall: { n: number; mean: number; sd: number }; etaSquared: number | null } => {
  const byGroup = new Map<string, number[]>();
  const all: number[] = [];
  const n = Math.min(numeric.length, groups.length);
  for (let i = 0; i < n; i++) {
    const v = numeric[i];
    if (typeof v !== 'number' || groups[i] == null) continue;
    const g = String(groups[i]);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(v);
    all.push(v);
  }
  const stats = (vals: number[]) => {
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
    return { n: vals.length, mean: m, sd };
  };
  if (all.length === 0) return { groups: [], overall: { n: 0, mean: NaN, sd: NaN }, etaSquared: null };
  const overall = stats(all);
  const groupStats: GroupStat[] = Array.from(byGroup.entries())
    .map(([group, vals]) => ({ group, ...stats(vals) }))
    .sort((a, b) => b.mean - a.mean);
  let ssBetween = 0, ssTotal = 0;
  for (const g of groupStats) ssBetween += g.n * (g.mean - overall.mean) ** 2;
  for (const v of all) ssTotal += (v - overall.mean) ** 2;
  return { groups: groupStats, overall, etaSquared: ssTotal > 0 ? ssBetween / ssTotal : null };
};

// --- Clustering diagnostics -------------------------------------------------

// Rows from columnar axis data, dropping incomplete rows; subsampled evenly
// so the O(n²) work below stays fast on large tables
const toMatrix = (cols: Cell[][], cap = 1200): number[][] => {
  const n = Math.min(...cols.map(c => c.length));
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = cols.map(c => c[i]);
    if (row.every(v => typeof v === 'number')) rows.push(row as number[]);
  }
  if (rows.length <= cap) return rows;
  const step = rows.length / cap;
  const sampled: number[][] = [];
  for (let i = 0; i < cap; i++) sampled.push(rows[Math.floor(i * step)]);
  return sampled;
};

const distMatrix = (X: number[][]): Float64Array => {
  const n = X.length, d = X[0]?.length ?? 0;
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += (X[i][k] - X[j][k]) ** 2;
      const dist = Math.sqrt(s);
      D[i * n + j] = dist;
      D[j * n + i] = dist;
    }
  }
  return D;
};

export const meanSilhouette = (D: Float64Array, labels: number[]): number => {
  const n = labels.length;
  const clusters = new Map<number, number[]>();
  labels.forEach((l, i) => {
    if (!clusters.has(l)) clusters.set(l, []);
    clusters.get(l)!.push(i);
  });
  if (clusters.size < 2) return 0;
  let total = 0, counted = 0;
  for (let i = 0; i < n; i++) {
    const own = clusters.get(labels[i])!;
    if (own.length <= 1) continue;
    let a = 0;
    for (const j of own) if (j !== i) a += D[i * n + j];
    a /= own.length - 1;
    let b = Infinity;
    for (const [l, members] of clusters) {
      if (l === labels[i]) continue;
      let m = 0;
      for (const j of members) m += D[i * n + j];
      m /= members.length;
      if (m < b) b = m;
    }
    total += (b - a) / Math.max(a, b);
    counted++;
  }
  return counted ? total / counted : 0;
};

// Silhouette by k for K-Means on the given axis columns
export const silhouetteByK = (
  cols: Cell[][],
  kmeansFn: (cols: (number | null)[][], k: number) => string[],
  maxK: number,
): { k: number; silhouette: number }[] => {
  const X = toMatrix(cols);
  if (X.length < 10) return [];
  const D = distMatrix(X);
  // re-run kmeans on the sampled matrix's columns so labels align with X
  const sampledCols = X[0].map((_, c) => X.map(row => row[c]));
  const out: { k: number; silhouette: number }[] = [];
  for (let k = 2; k <= Math.min(maxK, Math.floor(X.length / 3)); k++) {
    const labels = kmeansFn(sampledCols, k).map(l => Number(l.replace('Cluster ', '')));
    out.push({ k, silhouette: meanSilhouette(D, labels) });
  }
  return out;
};

// k-distance curve for DBSCAN eps selection: each point's distance to its
// k-th nearest neighbor, summarized as percentiles. eps near the "knee"
// (between the 90th and 95th percentile) is a common starting point.
export const kDistancePercentiles = (
  cols: Cell[][], k: number,
): { n: number; percentiles: Record<string, number> } | null => {
  const X = toMatrix(cols, 2000);
  const n = X.length;
  if (n < k + 1) return null;
  const D = distMatrix(X);
  const kd: number[] = [];
  const row = new Float64Array(n - 1);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = 0; j < n; j++) if (j !== i) row[m++] = D[i * n + j];
    const sorted = Array.from(row).sort((a, b) => a - b);
    kd.push(sorted[k - 1]);
  }
  kd.sort((a, b) => a - b);
  const pct = (p: number) => kd[Math.min(n - 1, Math.floor((p / 100) * n))];
  return {
    n,
    percentiles: { p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95), max: kd[n - 1] },
  };
};

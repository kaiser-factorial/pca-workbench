import { median, numericValues } from './table';

// DBSCAN + KMeans over plot coordinates, replacing the sklearn endpoints.
// Sizes here are survey-scale (hundreds to low thousands of points), so the
// O(n²) DBSCAN neighbor search and plain kmeans++ are more than fast enough.

// Column-wise z-scaling, preserving nulls (imputation happens downstream in
// dbscan/kmeans/toMatrix). Applied at the CALL SITE — by the cluster runners
// and by the k/eps diagnostics — so suggestions are always computed in the same
// units the clustering will actually use. An sd-0 column becomes all zeros: a
// variable that does not vary contributes nothing to distance, which is the
// honest reading.
export const zscoreCellColumns = (cols: (number | null)[][]): (number | null)[][] =>
  cols.map(col => {
    let n = 0, sum = 0;
    for (const v of col) if (typeof v === 'number') { n++; sum += v; }
    if (!n) return col;
    const mean = sum / n;
    let ss = 0;
    for (const v of col) if (typeof v === 'number') ss += (v - mean) ** 2;
    const sd = Math.sqrt(ss / n);
    return col.map(v => (typeof v === 'number' ? (sd ? (v - mean) / sd : 0) : v));
  });

// Smart default for the standardize toggle, by data regime:
// - PC scores → off: the variance ordering IS the information PCA produced;
//   z-scoring makes PC3's noise count as much as PC1's structure.
// - shared-scale columns (ranges within 3× of each other) → off: on a common
//   scale, variance differences are themselves signal, and z-scoring inflates
//   near-constant items by dividing by a tiny sd.
// - heterogeneous scales → on: otherwise Euclidean distance is effectively
//   just the widest column.
export const suggestStandardize = (cols: (number | null)[][], names: string[]): boolean => {
  if (names.length > 0 && names.every(nm => /^PC\d+$/i.test(nm))) return false;
  const ranges: number[] = [];
  for (const col of cols) {
    let min = Infinity, max = -Infinity;
    for (const v of col) if (typeof v === 'number') { if (v < min) min = v; if (v > max) max = v; }
    if (max > min) ranges.push(max - min);
  }
  if (ranges.length < 2) return false;
  let lo = Infinity, hi = 0;
  for (const r of ranges) { if (r < lo) lo = r; if (r > hi) hi = r; }
  return hi / lo > 3;
};

// Column-wise median imputation so missing axis values don't break distance math
const imputeColumns = (cols: (number | null)[][]): number[][] => {
  const meds = cols.map(c => median(numericValues(c)));
  const n = cols[0]?.length ?? 0;
  return Array.from({ length: n }, (_, i) => cols.map((c, j) => (typeof c[i] === 'number' ? (c[i] as number) : meds[j])));
};

export const dbscan = (colData: (number | null)[][], eps: number, minSamples: number): string[] => {
  const X = imputeColumns(colData);
  const n = X.length;
  const eps2 = eps * eps;
  const dist2 = (a: number[], b: number[]) => {
    let s = 0;
    for (let d = 0; d < a.length; d++) s += (a[d] - b[d]) ** 2;
    return s;
  };
  const neighbors = (i: number) => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) if (dist2(X[i], X[j]) <= eps2) out.push(j);
    return out;
  };

  const labels = new Array<number>(n).fill(-2); // -2 unvisited, -1 noise
  let cluster = -1;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const nbrs = neighbors(i);
    if (nbrs.length < minSamples) { labels[i] = -1; continue; }
    cluster++;
    labels[i] = cluster;
    const queue = [...nbrs];
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      if (labels[j] === -1) labels[j] = cluster; // noise → border point
      if (labels[j] !== -2) continue;
      labels[j] = cluster;
      const jn = neighbors(j);
      if (jn.length >= minSamples) queue.push(...jn);
    }
  }
  return labels.map(l => (l === -1 ? 'Noise' : `Cluster ${l}`));
};

// Deterministic PRNG so repeated runs give identical clusters (random_state analog)
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const kmeans = (colData: (number | null)[][], k: number): string[] => {
  const X = imputeColumns(colData);
  const n = X.length;
  const dim = X[0]?.length ?? 0;
  if (n === 0 || k < 1) return [];
  k = Math.min(k, n);
  const dist2 = (a: number[], b: number[]) => {
    let s = 0;
    for (let d = 0; d < dim; d++) s += (a[d] - b[d]) ** 2;
    return s;
  };

  let bestLabels: number[] = [];
  let bestInertia = Infinity;
  const N_INIT = 10, MAX_ITER = 300;

  for (let init = 0; init < N_INIT; init++) {
    const rand = mulberry32(42 + init);
    // kmeans++ seeding
    const centers: number[][] = [X[Math.floor(rand() * n)].slice()];
    const minD = new Array<number>(n).fill(Infinity);
    while (centers.length < k) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        minD[i] = Math.min(minD[i], dist2(X[i], centers[centers.length - 1]));
        total += minD[i];
      }
      let target = rand() * total;
      let pick = n - 1;
      for (let i = 0; i < n; i++) { target -= minD[i]; if (target <= 0) { pick = i; break; } }
      centers.push(X[pick].slice());
    }

    const labels = new Array<number>(n).fill(0);
    for (let iter = 0; iter < MAX_ITER; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const d = dist2(X[i], centers[c]);
          if (d < bd) { bd = d; best = c; }
        }
        if (labels[i] !== best) { labels[i] = best; moved = true; }
      }
      const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        counts[labels[i]]++;
        for (let d = 0; d < dim; d++) sums[labels[i]][d] += X[i][d];
      }
      for (let c = 0; c < k; c++) {
        if (!counts[c]) continue; // empty cluster keeps its center
        for (let d = 0; d < dim; d++) centers[c][d] = sums[c][d] / counts[c];
      }
      if (!moved) break;
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += dist2(X[i], centers[labels[i]]);
    if (inertia < bestInertia) { bestInertia = inertia; bestLabels = labels; }
  }

  return bestLabels.map(l => `Cluster ${l}`);
};

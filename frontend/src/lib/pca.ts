import { DataTable, median, numericValues } from './table';

// In-browser PCA: median imputation → (optional) standardization → covariance/
// correlation matrix → Jacobi eigendecomposition → scores + loadings.
// Equivalent to sklearn's PCA on standardized data, up to component sign;
// signs are fixed so each component's largest-|loading| variable is positive.

export type PCAResult = {
  table: DataTable;                       // input table + score columns (see `columns`)
  columns: string[];                      // names of the score columns this run added
  replaced: string[];                     // columns of a previous same-label run this one replaced
  label: string;                          // sanitized run label ('' = the unnamed run)
  loadings: Record<string, { var: string; loading: number }[]>; // per score column, sorted by |loading|
  varianceExplained: number[];            // fraction per kept component
  cumulative: number[];
  variables: string[];
  k: number;
  /**
   * How much of the input was filled in rather than observed. `cells` counts
   * imputed values across the whole variable x row grid; `byVariable` lists only
   * the variables that needed any, worst first. Reported because median
   * imputation shrinks variance and attenuates correlations in proportion to
   * how much was imputed — "we impute" is a disclaimer, "we imputed 47 of 1,800
   * cells" is a disclosure the reader can act on.
   */
  imputed: { cells: number; total: number; byVariable: { var: string; n: number }[] };
};

// Run labels become column-name fragments — keep them word-shaped
export const sanitizeLabel = (s: string): string =>
  s.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');

// Suggest a run label from the selected variable names: the shared prefix or
// suffix once counters are stripped (openness_1..openness_5 → "openness",
// Q1_Need..Q5_Need → "Need"). Returns null when nothing at least two
// characters long is shared — mixed subsets (O1..O5 + N1..N5) on purpose
// yield null so the user (or the assistant) names the run deliberately.
export const deriveRunLabel = (names: string[]): string | null => {
  if (names.length < 2) return null;
  const shared = (get: (s: string, i: number) => string, len: (s: string) => number) => {
    let n = Math.min(...names.map(len));
    let out = '';
    for (let i = 0; i < n; i++) {
      const ch = get(names[0], i);
      if (!names.every(nm => get(nm, i) === ch)) break;
      out += ch;
    }
    return out;
  };
  const prefix = shared((s, i) => s[i], s => s.length).replace(/[\d_\-\s]+$/g, '');
  const suffix = shared((s, i) => s[s.length - 1 - i], s => s.length)
    .split('').reverse().join('').replace(/^[\d_\-\s]+/g, '');
  const best = (suffix.length > prefix.length ? suffix : prefix);
  const clean = sanitizeLabel(best);
  return clean.length >= 2 ? clean : null;
};

// The column names a run owns: COMP_<label> for a single kept component (a
// composite score), PC1_<label>.. for a labeled set, bare PC1.. when unnamed.
export const pcaColumnNames = (label: string, k: number): string[] => {
  if (label && k === 1) return [`COMP_${label}`];
  return Array.from({ length: k }, (_, c) => (label ? `PC${c + 1}_${label}` : `PC${c + 1}`));
};

// Which existing columns a (re-)run of `label` replaces. Covers both shapes
// (COMP_x and PCn_x) so relabeling k between runs never strands columns.
const ownedByLabel = (label: string) => {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return label
    ? new RegExp(`^(PC\\d+_${esc}|COMP_${esc})$`)
    : /^PC\d+$/;
};

// Jacobi eigenvalue iteration for symmetric matrices. Rock-solid for the
// p×p (p ≤ ~200) matrices survey data produces.
const jacobiEigen = (A: number[][]): { values: number[]; vectors: number[][] } => {
  const n = A.length;
  const a = A.map(row => row.slice());
  // V starts as identity; columns accumulate the eigenvectors
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (Math.sqrt(off) < 1e-12) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  // sort by eigenvalue descending
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map(i => a[i][i]),
    vectors: order.map(i => V.map(row => row[i])), // vectors[c] = c-th eigenvector
  };
};

export const runPCA = (
  table: DataTable,
  variables: string[],
  opts: { k?: number; standardize?: boolean; label?: string } = {},
): PCAResult => {
  const standardize = opts.standardize ?? true;
  const label = sanitizeLabel(opts.label ?? '');
  const p = variables.length;
  if (p < 2) throw new Error('Pick at least two numeric variables for a PCA.');
  const n = table.nRows;
  if (n < 3) throw new Error('Too few rows for a PCA.');
  // k = 1 is legitimate: it keeps only the first component, the composite-score
  // workflow (run per item subset, keep the top PC of each as a named score)
  const k = Math.max(1, Math.min(opts.k ?? 3, p));

  // median-impute, center, optionally scale (population sd, sklearn-style)
  const X: number[][] = Array.from({ length: n }, () => new Array(p));
  const missingByVar: { var: string; n: number }[] = [];
  for (let j = 0; j < p; j++) {
    const raw = (table.data[variables[j]] ?? []).map(v => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      return null;
    });
    const nums = numericValues(raw);
    if (nums.length === 0) throw new Error(`"${variables[j]}" has no numeric values.`);
    // Anything not observed as a finite number gets the median, including rows
    // past the end of a short column.
    if (nums.length < n) missingByVar.push({ var: variables[j], n: n - nums.length });
    const med = median(nums);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = raw[i] ?? med;
      X[i][j] = v;
      sum += v;
    }
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) sq += (X[i][j] - mean) ** 2;
    const sd = Math.sqrt(sq / n);
    if (standardize && sd === 0) throw new Error(`"${variables[j]}" is constant — drop it or turn off standardization.`);
    const div = standardize ? sd : 1;
    for (let i = 0; i < n; i++) X[i][j] = (X[i][j] - mean) / div;
  }

  // covariance (= correlation when standardized) matrix
  const C: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += X[r][i] * X[r][j];
      C[i][j] = C[j][i] = s / n;
    }
  }

  const { values, vectors } = jacobiEigen(C);
  const total = values.reduce((s, v) => s + Math.max(v, 0), 0) || 1;

  // deterministic signs: largest-|loading| variable positive per component
  const comps = vectors.slice(0, k).map(vec => {
    let maxIdx = 0;
    for (let j = 1; j < p; j++) if (Math.abs(vec[j]) > Math.abs(vec[maxIdx])) maxIdx = j;
    return vec[maxIdx] < 0 ? vec.map(v => -v) : vec;
  });

  // scores: X̃ · component
  const scoreCols: number[][] = comps.map(vec => {
    const col = new Array<number>(n);
    for (let r = 0; r < n; r++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += X[r][j] * vec[j];
      col[r] = s;
    }
    return col;
  });

  // Replacement is scoped to THIS run's identity: a re-run of "openness"
  // replaces only the openness columns; other labeled runs and the bare
  // PC1..PCk set coexist untouched. (Replacing everything matching ^PC\d+$
  // was the old behavior, and it silently ate earlier subset runs.)
  const owned = ownedByLabel(label);
  const pcNames = pcaColumnNames(label, k);
  const replaced = table.columns.filter(c => owned.test(c));
  const newTable: DataTable = {
    columns: [...table.columns.filter(c => !owned.test(c)), ...pcNames],
    data: {
      ...Object.fromEntries(Object.entries(table.data).filter(([c]) => !owned.test(c))),
      ...Object.fromEntries(pcNames.map((name, c) => [name, scoreCols[c]])),
    },
    nRows: n,
  };

  const loadings: PCAResult['loadings'] = {};
  comps.forEach((vec, c) => {
    loadings[pcNames[c]] = variables
      .map((v, j) => ({ var: v, loading: Math.round(vec[j] * 1000) / 1000 }))
      .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading));
  });

  const varianceExplained = values.slice(0, k).map(v => Math.max(v, 0) / total);
  const cumulative = varianceExplained.reduce<number[]>((acc, v) => {
    acc.push((acc[acc.length - 1] ?? 0) + v);
    return acc;
  }, []);

  const imputed = {
    cells: missingByVar.reduce((s, m) => s + m.n, 0),
    total: n * p,
    byVariable: missingByVar.sort((a, b) => b.n - a.n),
  };

  return { table: newTable, columns: pcNames, replaced, label, loadings, varianceExplained, cumulative, variables, k, imputed };
};

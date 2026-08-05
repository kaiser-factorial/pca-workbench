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
   * What happened to the incomplete rows. Reported because both strategies
   * change the answer: median imputation shrinks variance and attenuates
   * correlations in proportion to how much was filled in, while complete-case
   * changes n and can bias the sample if missingness is not random.
   * "we impute" is a disclaimer; "we imputed 47 of 1,800 cells" is a disclosure
   * the reader can act on.
   */
  missing: MissingReport;
};

export type MissingStrategy = 'median' | 'complete';

export type MissingReport = {
  strategy: MissingStrategy;
  /** Cells filled with a median. Always 0 under complete-case. */
  imputedCells: number;
  totalCells: number;
  /** Rows missing at least one value, per variable, worst first. */
  byVariable: { var: string; n: number }[];
  /** Rows the decomposition actually used. */
  rowsUsed: number;
  /** Rows excluded for having any gap. Always 0 under median imputation. */
  rowsDropped: number;
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
  opts: { k?: number; standardize?: boolean; label?: string; missing?: MissingStrategy } = {},
): PCAResult => {
  const standardize = opts.standardize ?? true;
  const strategy: MissingStrategy = opts.missing ?? 'median';
  const label = sanitizeLabel(opts.label ?? '');
  const p = variables.length;
  if (p < 2) throw new Error('Pick at least two numeric variables for a PCA.');
  const n = table.nRows;
  if (n < 3) throw new Error('Too few rows for a PCA.');
  // k = 1 is legitimate: it keeps only the first component, the composite-score
  // workflow (run per item subset, keep the top PC of each as a named score)
  const k = Math.max(1, Math.min(opts.k ?? 3, p));

  // Coerce every selected variable once: null marks "not observed as a number",
  // which is what both strategies key off.
  const cols: (number | null)[][] = variables.map(v =>
    (table.data[v] ?? []).map(x => {
      if (typeof x === 'number' && Number.isFinite(x)) return x;
      if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
      return null;
    }));
  const missingByVar: { var: string; n: number }[] = [];
  cols.forEach((col, j) => {
    const have = numericValues(col).length;
    if (have === 0) throw new Error(`"${variables[j]}" has no numeric values.`);
    // Rows past the end of a short column count as missing too.
    if (have < n) missingByVar.push({ var: variables[j], n: n - have });
  });

  // Which rows the decomposition runs on. Complete-case keeps only rows with no
  // gap in ANY selected variable, so adding a poorly-covered variable can drop a
  // lot of rows at once — hence rowsDropped is reported, not just inferred.
  const rows: number[] = [];
  for (let i = 0; i < n; i++) {
    if (strategy === 'median' || cols.every(c => typeof c[i] === 'number')) rows.push(i);
  }
  if (strategy === 'complete' && rows.length < 3) {
    throw new Error(
      `Complete-case analysis leaves only ${rows.length} row${rows.length === 1 ? '' : 's'} with no missing values across these ${p} variables — too few for a PCA. Use median imputation, or drop the variables with the most missing data.`
    );
  }
  const m = rows.length;

  // centre, optionally scale (population sd, sklearn-style)
  const X: number[][] = Array.from({ length: m }, () => new Array(p));
  for (let j = 0; j < p; j++) {
    const col = cols[j];
    // Under complete-case the median is never consulted; under imputation it is
    // computed from the observed values only, which is the standard definition.
    const med = median(numericValues(col));
    let sum = 0;
    for (let r = 0; r < m; r++) {
      const v = col[rows[r]] ?? med;
      X[r][j] = v;
      sum += v;
    }
    const mean = sum / m;
    let sq = 0;
    for (let r = 0; r < m; r++) sq += (X[r][j] - mean) ** 2;
    const sd = Math.sqrt(sq / m);
    if (standardize && sd === 0) throw new Error(`"${variables[j]}" is constant${strategy === 'complete' ? ' across the complete cases' : ''} — drop it or turn off standardization.`);
    const div = standardize ? sd : 1;
    for (let r = 0; r < m; r++) X[r][j] = (X[r][j] - mean) / div;
  }

  // covariance (= correlation when standardized) matrix
  const C: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let r = 0; r < m; r++) s += X[r][i] * X[r][j];
      C[i][j] = C[j][i] = s / m;
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

  // scores: X̃ · component, written back at the ORIGINAL row positions so the
  // columnar table keeps its shape. Rows excluded by complete-case get null
  // rather than a fabricated score — they are genuinely unscored.
  const scoreCols: (number | null)[][] = comps.map(vec => {
    const col = new Array<number | null>(n).fill(null);
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += X[r][j] * vec[j];
      col[rows[r]] = s;
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

  const byVariable = missingByVar.sort((a, b) => b.n - a.n);
  const missing: MissingReport = {
    strategy,
    imputedCells: strategy === 'median' ? byVariable.reduce((s, v) => s + v.n, 0) : 0,
    totalCells: n * p,
    byVariable,
    rowsUsed: m,
    rowsDropped: n - m,
  };

  return { table: newTable, columns: pcNames, replaced, label, loadings, varianceExplained, cumulative, variables, k, missing };
};

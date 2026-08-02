import { DataTable, median, numericValues } from './table';

// In-browser PCA: median imputation → (optional) standardization → covariance/
// correlation matrix → Jacobi eigendecomposition → scores + loadings.
// Equivalent to sklearn's PCA on standardized data, up to component sign;
// signs are fixed so each component's largest-|loading| variable is positive.

export type PCAResult = {
  table: DataTable;                       // input table + PC1..PCk score columns
  loadings: Record<string, { var: string; loading: number }[]>; // per PC, sorted by |loading|
  varianceExplained: number[];            // fraction per kept component
  cumulative: number[];
  variables: string[];
  k: number;
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
  opts: { k?: number; standardize?: boolean } = {},
): PCAResult => {
  const standardize = opts.standardize ?? true;
  const p = variables.length;
  if (p < 2) throw new Error('Pick at least two numeric variables for a PCA.');
  const n = table.nRows;
  if (n < 3) throw new Error('Too few rows for a PCA.');
  const k = Math.max(2, Math.min(opts.k ?? 3, p));

  // median-impute, center, optionally scale (population sd, sklearn-style)
  const X: number[][] = Array.from({ length: n }, () => new Array(p));
  for (let j = 0; j < p; j++) {
    const raw = (table.data[variables[j]] ?? []).map(v => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      return null;
    });
    const nums = numericValues(raw);
    if (nums.length === 0) throw new Error(`"${variables[j]}" has no numeric values.`);
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

  const pcNames = comps.map((_, c) => `PC${c + 1}`);
  const newTable: DataTable = {
    columns: [...table.columns.filter(c => !/^PC\d+$/.test(c)), ...pcNames],
    data: {
      ...Object.fromEntries(Object.entries(table.data).filter(([c]) => !/^PC\d+$/.test(c))),
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

  return { table: newTable, loadings, varianceExplained, cumulative, variables, k };
};

import { DataTable, median, numericValues } from './table';

// Ports backend/main.py's process_upload: median imputation, z-scaling,
// projection through a components matrix, and top-|loading| contributors.

export type Contributor = { var: string; loading: number };
export type TopContributors = Record<string, Contributor[]>;
export type ProcessResult = {
  table: DataTable;
  topContributors: TopContributors | null;
  message: string;
};

// Components file: first column (or index) = variable names, remaining
// columns = loadings per PC. Mirrors the pandas set_index handling.
const componentsToMatrix = (comp: DataTable) => {
  let indexCol = comp.columns[0];
  if (!comp.columns.includes('Unnamed: 0')) {
    const firstVals = comp.data[indexCol] ?? [];
    const firstIsNumeric = firstVals.every(v => v == null || typeof v === 'number');
    if (firstIsNumeric) {
      throw new Error('Components file needs variable names in its first column.');
    }
  } else {
    indexCol = 'Unnamed: 0';
  }
  const varNames = (comp.data[indexCol] ?? []).map(v => String(v));
  const pcCols = comp.columns.filter(c => c !== indexCol);
  return { varNames, pcCols, comp };
};

export const processUpload = (df: DataTable, components: DataTable | null): ProcessResult => {
  if (components) {
    const { varNames, pcCols, comp } = componentsToMatrix(components);
    const intersect = varNames
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => df.columns.includes(v));

    if (intersect.length === 0) {
      throw new Error(
        `No overlapping variables between the components file and dataset columns. Components vars found: ${varNames.slice(0, 5).join(', ')}…`
      );
    }

    // Coerce text junk in numeric columns to null so imputation treats it as missing
    const coerced = intersect.map(({ v }) =>
      (df.data[v] ?? []).map(x => {
        if (typeof x === 'number') return x;
        if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
        return null;
      })
    );
    const allNaN = intersect.filter((_, j) => coerced[j].every(x => x == null)).map(({ v }) => v);
    if (allNaN.length) {
      throw new Error(`These columns contain no usable numeric values: ${allNaN.join(', ')}`);
    }

    // Median-impute, then standardize (population std, matching sklearn)
    const n = df.nRows;
    const p = intersect.length;
    const X: number[][] = Array.from({ length: n }, () => new Array(p));
    for (let j = 0; j < p; j++) {
      const col = coerced[j];
      const med = median(numericValues(col));
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = col[i] ?? med;
        X[i][j] = v;
        sum += v;
      }
      const mean = sum / n;
      let sq = 0;
      for (let i = 0; i < n; i++) sq += (X[i][j] - mean) ** 2;
      const std = Math.sqrt(sq / n) || 1;
      for (let i = 0; i < n; i++) X[i][j] = (X[i][j] - mean) / std;
    }

    // Loadings for the intersecting variables, in dataset-intersection order
    const L: number[][] = intersect.map(({ i }) =>
      pcCols.map(pc => {
        const v = comp.data[pc]?.[i];
        return typeof v === 'number' ? v : Number(v) || 0;
      })
    );

    // coords = X (n×p) @ L (p×k), keep up to 3 PCs, zero-pad if fewer
    const k = Math.min(pcCols.length, 3);
    const coords: number[][] = Array.from({ length: n }, () => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < k; c++) {
        let acc = 0;
        for (let j = 0; j < p; j++) acc += X[i][j] * L[j][c];
        coords[i][c] = acc;
      }
    }

    const table: DataTable = {
      columns: [...df.columns.filter(c => !['PC1', 'PC2', 'PC3'].includes(c)), 'PC1', 'PC2', 'PC3'],
      data: {
        ...df.data,
        PC1: coords.map(r => r[0]),
        PC2: coords.map(r => r[1]),
        PC3: coords.map(r => r[2]),
      },
      nRows: n,
    };

    // Per PC: variables ranked by |loading|, signed values kept
    const topContributors: TopContributors = {};
    for (let c = 0; c < k; c++) {
      topContributors[`PC${c + 1}`] = intersect
        .map(({ v }, j) => ({ var: v, loading: Math.round(L[j][c] * 1000) / 1000 }))
        .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading))
        .slice(0, 5);
    }

    return {
      table,
      topContributors,
      message: `Calculated 3D coordinates using ${p} overlapping variables (${n} rows).`,
    };
  }

  // No components: any numeric columns can serve as plot axes
  const numericCols = df.columns.filter(c => (df.data[c] ?? []).some(v => typeof v === 'number'));
  if (numericCols.length < 2) {
    throw new Error('Dataset needs at least two numeric columns to plot (or provide a components file).');
  }
  return {
    table: df,
    topContributors: null,
    message: `Loaded ${df.nRows} rows — assign variables to X · Y · Z in the Variables panel.`,
  };
};

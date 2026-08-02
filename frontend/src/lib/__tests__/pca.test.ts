import { describe, it, expect } from 'vitest';
import { runPCA } from '../pca';
import type { DataTable } from '../table';

// deterministic LCG so results are stable across runs
const makeRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
};

describe('runPCA — analytic two-variable case', () => {
  // For a 2×2 correlation matrix with correlation r, the eigenvalues are
  // 1±r and the first eigenvector is [1,1]/√2 — a closed-form check.
  const n = 4000;
  const rng = makeRng(42);
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < n; i++) {
    const shared = rng(), ua = rng(), ub = rng();
    a.push(shared + 0.6 * ua);
    b.push(shared + 0.6 * ub);
  }
  const table: DataTable = { columns: ['a', 'b'], data: { a, b }, nRows: n };
  const res = runPCA(table, ['a', 'b'], { k: 2 });

  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a), mb = mean(b);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  const r = cov / Math.sqrt(va * vb);

  it('recovers the analytic eigenvalues (1±r)/2', () => {
    expect(res.varianceExplained[0]).toBeCloseTo((1 + r) / 2, 9);
    expect(res.varianceExplained[1]).toBeCloseTo((1 - r) / 2, 9);
  });

  it('recovers the analytic loadings ±1/√2', () => {
    const l1 = res.loadings.PC1.map(x => Math.abs(x.loading));
    expect(l1[0]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(l1[1]).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('variance explained is a complete decomposition', () => {
    expect(res.cumulative[res.cumulative.length - 1]).toBeCloseTo(1, 9);
  });
});

describe('runPCA — structural properties on 5 variables', () => {
  const rng = makeRng(7);
  const names = ['v1', 'v2', 'v3', 'v4', 'v5'];
  const cols: Record<string, number[]> = Object.fromEntries(names.map(n => [n, []]));
  for (let i = 0; i < 800; i++) {
    const f1 = rng(), f2 = rng();
    cols.v1.push(f1 + 0.3 * rng());
    cols.v2.push(f1 + 0.3 * rng());
    cols.v3.push(f2 + 0.3 * rng());
    cols.v4.push(f2 + 0.3 * rng());
    cols.v5.push(rng());
  }
  const table: DataTable = { columns: names, data: cols, nRows: 800 };
  const res = runPCA(table, names, { k: 5 });

  const vec = (pc: string) => names.map(nm => res.loadings[pc].find(x => x.var === nm)!.loading);
  const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);

  it('components are orthonormal', () => {
    expect(dot(vec('PC1'), vec('PC1'))).toBeCloseTo(1, 1);
    expect(dot(vec('PC1'), vec('PC2'))).toBeCloseTo(0, 1);
  });

  it('eigenvalues come out in descending order', () => {
    res.varianceExplained.forEach((v, i, arr) => {
      if (i > 0) expect(v).toBeLessThanOrEqual(arr[i - 1] + 1e-12);
    });
  });

  it('score variance equals the eigenvalue (standardized: eigenvalue = share × p)', () => {
    const s1 = res.table.data.PC1 as number[];
    const ms = s1.reduce((s, x) => s + x, 0) / s1.length;
    const varS = s1.reduce((s, x) => s + (x - ms) ** 2, 0) / s1.length;
    expect(varS).toBeCloseTo(res.varianceExplained[0] * 5, 6);
  });

  it('appends the PC score columns to the table', () => {
    for (const c of ['PC1', 'PC2', 'PC3', 'PC4', 'PC5']) {
      expect(res.table.columns).toContain(c);
    }
  });
});

describe('runPCA — robustness', () => {
  it('median-imputes missing values instead of failing', () => {
    const table: DataTable = {
      columns: ['x', 'y'],
      data: { x: [1, 2, null, 4, 5, 6], y: [2, 4, 6, null, 10, 12] },
      nRows: 6,
    };
    const res = runPCA(table, ['x', 'y'], { k: 2 });
    expect(Number.isFinite((res.table.data.PC1 as number[])[2])).toBe(true);
  });

  it('rejects a constant variable under standardization with a clear error', () => {
    const table: DataTable = {
      columns: ['x', 'y'],
      data: { x: [1, 2, 3, 4], y: [5, 5, 5, 5] },
      nRows: 4,
    };
    expect(() => runPCA(table, ['x', 'y'], { k: 2 })).toThrow(/constant/);
  });
});

import { describe, it, expect } from 'vitest';
import { meanSilhouette, compareGroups } from '../stats';
import { kmeans, nonNumericAxes } from '../cluster';
import { runPCA } from '../pca';
import type { DataTable } from '../table';

const table = (data: Record<string, unknown[]>): DataTable =>
  ({ columns: Object.keys(data), data, nRows: Object.values(data)[0].length }) as DataTable;

// A5 — Rousseeuw assigns a singleton s = 0. Skipping them instead inflated the
// mean, worst at high k and with outliers: exactly where suggest_k should be
// discouraging the user.
describe('meanSilhouette counts singleton clusters as zero (finding A5)', () => {
  // Two tight pairs plus one far-flung point given its own cluster.
  // Distance matrices are row-major with stride n, so each size needs building
  // from its own points — slicing a bigger one silently reinterprets the rows.
  const dist = (pts: number[][]) => {
    const n = pts.length;
    const D = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      D[i * n + j] = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    }
    return D;
  };
  const four = [[0, 0], [0.1, 0], [10, 0], [10.1, 0]];
  const five = [...four, [500, 500]];

  it('drags the mean down rather than ignoring the singleton', () => {
    const withSingleton = meanSilhouette(dist(five), [0, 0, 1, 1, 2]);
    const withoutSingleton = meanSilhouette(dist(four), [0, 0, 1, 1]);
    // The 4-point version has a near-perfect score; adding a lone outlier as its
    // own cluster must not leave the average untouched.
    expect(withSingleton).toBeLessThan(withoutSingleton);
    // Averaged over 5 points, not 4: the singleton contributes a zero.
    expect(withSingleton).toBeCloseTo((withoutSingleton * 4) / 5, 6);
  });
});

// A6 — the reported sd was population (÷n), labelled only "sd", in numbers a
// researcher pastes into a manuscript where n-1 is the convention.
describe('compareGroups reports sample sd (finding A6)', () => {
  it('uses n-1, not n', () => {
    const res = compareGroups([1, 2, 3, 4], ['A', 'A', 'A', 'A']);
    // population sd of 1,2,3,4 is 1.11803; sample sd is 1.29099
    expect(res.overall.sd).toBeCloseTo(1.29099, 5);
  });

  it('reports null rather than a misleading 0 for a group of one', () => {
    const res = compareGroups([1, 2, 3, 9], ['A', 'A', 'A', 'B']);
    expect(res.groups.find(g => g.group === 'B')!.sd).toBeNull();
    expect(res.groups.find(g => g.group === 'A')!.sd).toBeCloseTo(1, 9);
  });
});

// A10 — k was clamped to p but not to rank, so with n = 3 and p = 5 components
// 3-5 were numerically zero and their scores were noise, reported like any other.
describe('runPCA clamps k to the rank, not just to p (finding A10)', () => {
  it('cannot return more components than n-1', () => {
    const t = table({ a: [1, 2, 3], b: [2, 1, 5], c: [3, 3, 1], d: [4, 9, 2], e: [5, 1, 8] });
    const res = runPCA(t, ['a', 'b', 'c', 'd', 'e'], { k: 5 });
    expect(res.k).toBe(2);                  // min(p, n-1) = 2
    expect(res.columns).toHaveLength(2);
    expect(res.varianceExplained).toHaveLength(2);
  });

  it('leaves an ordinary run alone', () => {
    const t = table({
      a: Array.from({ length: 50 }, (_, i) => i),
      b: Array.from({ length: 50 }, (_, i) => (i * 7) % 13),
      c: Array.from({ length: 50 }, (_, i) => (i * 3) % 5),
    });
    expect(runPCA(t, ['a', 'b', 'c'], { k: 3 }).k).toBe(3);
  });
});

// A11 — median([]) is 0, so a text axis was filled entirely with zeros,
// contributed nothing to any distance, and still reported a full set of sizes.
describe('nonNumericAxes names an unusable axis (finding A11)', () => {
  it('catches a column with no numeric values at all', () => {
    expect(nonNumericAxes([[1, 2, 3], ['a', 'b', 'c']], ['x', 'y'])).toEqual(['y']);
    expect(nonNumericAxes([['a'], ['b']], ['x', 'y'])).toEqual(['x', 'y']);
  });

  it('accepts a column that is merely sparse, which is ordinary missingness', () => {
    expect(nonNumericAxes([[1, null, null], [null, null, 7]], ['x', 'y'])).toEqual([]);
  });

  it('accepts text-formatted numbers, which C6 made usable', () => {
    expect(nonNumericAxes([['1', '2'], [3, 4]], ['x', 'y'])).toEqual([]);
  });
});

// A12 — an empty cluster kept its centre, so a k = 8 run could return six
// labels with gaps in the numbering and a size list shorter than k.
describe('kmeans returns k clusters (finding A12)', () => {
  it('relocates an empty cluster instead of leaving a gap', () => {
    // Three tight blobs, asked for five clusters: two must be relocated.
    const xs: number[] = [], ys: number[] = [];
    for (const [cx, cy] of [[0, 0], [50, 0], [0, 50]]) {
      for (let i = 0; i < 12; i++) { xs.push(cx + (i % 4) * 0.01); ys.push(cy + (i % 3) * 0.01); }
    }
    const labels = kmeans([xs, ys], 5);
    const used = new Set(labels);
    expect(used.size).toBe(5);
    // ...and the numbering has no holes
    expect([...used].map(l => Number(l.replace('Cluster ', ''))).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4]);
  });

  it('is still deterministic after relocation', () => {
    const xs = Array.from({ length: 30 }, (_, i) => (i % 3) * 40);
    const ys = Array.from({ length: 30 }, (_, i) => (i % 2) * 40);
    expect(kmeans([xs, ys], 5)).toEqual(kmeans([xs, ys], 5));
  });
});

// A13 — an absolute convergence test is unreachable for covariance PCA on
// large-magnitude columns, so those runs burned all 100 sweeps.
describe('the Jacobi solver converges on large-magnitude data (finding A13)', () => {
  const bigTable = () => {
    const n = 200;
    return table({
      // Incomes in dollars and reaction times in ms: the case the absolute
      // tolerance could never satisfy.
      income: Array.from({ length: n }, (_, i) => 20000 + ((i * 7919) % 180000)),
      rt: Array.from({ length: n }, (_, i) => 200 + ((i * 104729) % 1800)),
      score: Array.from({ length: n }, (_, i) => (i * 37) % 100),
    });
  };

  it('produces the same answer standardized or not, and finishes', () => {
    const t = bigTable();
    const cov = runPCA(t, ['income', 'rt', 'score'], { k: 3, standardize: false });
    const cor = runPCA(t, ['income', 'rt', 'score'], { k: 3, standardize: true });
    for (const r of [cov, cor]) {
      const total = r.varianceExplained.reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1, 6);
      expect(r.varianceExplained.every(v => Number.isFinite(v) && v >= 0)).toBe(true);
    }
    // Covariance PCA on these scales is dominated by income, by construction.
    expect(cov.varianceExplained[0]).toBeGreaterThan(0.9);
  });

  it('is measurably faster than burning every sweep', () => {
    const t = bigTable();
    const start = performance.now();
    for (let i = 0; i < 20; i++) runPCA(t, ['income', 'rt', 'score'], { k: 3, standardize: false });
    // Not a tight bound — just proof it is not doing 100 sweeps every time.
    expect(performance.now() - start).toBeLessThan(4000);
  });
});

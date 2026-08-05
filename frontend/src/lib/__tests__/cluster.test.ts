import { describe, it, expect } from 'vitest';
import { dbscan, kmeans, zscoreCellColumns, suggestStandardize, countImputed } from '../cluster';

describe('zscoreCellColumns', () => {
  it('produces mean ≈ 0, sd ≈ 1 and preserves nulls', () => {
    const [z] = zscoreCellColumns([[10, 20, null, 30, 40]]);
    const nums = z.filter((v): v is number => typeof v === 'number');
    expect(z[2]).toBeNull();
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    expect(mean).toBeCloseTo(0, 9);
    expect(sd).toBeCloseTo(1, 9);
  });

  it('maps a constant column to zeros instead of dividing by zero', () => {
    const [z] = zscoreCellColumns([[7, 7, 7, 7]]);
    expect(z).toEqual([0, 0, 0, 0]);
  });
});

describe('suggestStandardize', () => {
  it('is off for PC scores regardless of their ranges', () => {
    expect(suggestStandardize([[-8, 8], [-1, 1], [-0.2, 0.2]], ['PC1', 'PC2', 'PC3'])).toBe(false);
  });

  it('is off for columns sharing a scale', () => {
    expect(suggestStandardize([[1, 7], [2, 6], [1, 5]], ['Q1', 'Q2', 'Q3'])).toBe(false);
  });

  it('is on for mixed scales (Age vs Likert)', () => {
    expect(suggestStandardize([[18, 65], [1, 7]], ['Age', 'Q1'])).toBe(true);
  });
});

describe('kmeans with pre-scaled columns', () => {
  // Column A: large scale, interleaved so its structure crosses B's groups.
  // Column B: tiny scale, cleanly separated halves — the "real" grouping.
  const A = [0, 900, 100, 800, 200, 700, 300, 600];
  const B = [0, 0, 0, 0, 0.001, 0.001, 0.001, 0.001];

  const partition = (labels: string[]) => {
    const first = labels[0];
    return labels.map(l => (l === first ? 'a' : 'b')).join('');
  };

  it('raw scales: the wide column dictates the clustering', () => {
    // Low-A rows {0,2,4,6} vs high-A rows {1,3,5,7} — alternating pattern
    expect(partition(kmeans([A, B], 2))).toBe('abababab');
  });

  it('z-scored: the structured small column wins instead', () => {
    // First half vs second half — B's split, unreachable at raw scales
    expect(partition(kmeans(zscoreCellColumns([A, B]), 2))).toBe('aaaabbbb');
  });
});

describe('dbscan', () => {
  // A 1-D unit-spaced lattice: every interior point has exactly two neighbours
  // at distance 1, so the eps at which it becomes a core point is exactly 1.0
  // for minSamples=3. Deliberately exact — this is the fixture that pins the
  // minSamples/neighbour-rank relationship the eps suggestion depends on.
  const lattice = Array.from({ length: 40 }, (_, i) => i);

  it('counts the point itself toward minSamples, matching sklearn', () => {
    // minSamples=3 needs self + 2 others, so eps=1 is exactly enough
    expect(new Set(dbscan([lattice], 1.0, 3))).toEqual(new Set(['Cluster 0']));
    // ...and one fewer neighbour than that is not
    expect(dbscan([lattice], 0.99, 3).every(l => l === 'Noise')).toBe(true);
  });

  it('separates well-separated blobs and labels a lone outlier Noise', () => {
    const x = [0, 0.1, 0.2, 0.3, 10, 10.1, 10.2, 10.3, 500];
    const y = x.map(() => 0);
    const labels = dbscan([x, y], 0.5, 3);
    expect(new Set(labels.slice(0, 4))).toEqual(new Set(['Cluster 0']));
    expect(new Set(labels.slice(4, 8))).toEqual(new Set(['Cluster 1']));
    expect(labels[8]).toBe('Noise');
  });

  it('assigns border points to a cluster without expanding through them', () => {
    // 0,1,2 are dense; 3 is within eps of 2 but has too few neighbours itself,
    // so it joins as a border point and must NOT pull in 4.
    const x = [0, 0.1, 0.2, 1.2, 2.4];
    const labels = dbscan([x], 1.0, 3);
    expect(labels[3]).toBe('Cluster 0');   // border, absorbed
    expect(labels[4]).toBe('Noise');       // not reached through the border point
  });

  it('is deterministic — identical input gives identical labels', () => {
    const x = lattice.map(v => v * 0.37);
    expect(dbscan([x], 0.5, 3)).toEqual(dbscan([x], 0.5, 3));
  });

  it('median-imputes a missing coordinate rather than dropping the row', () => {
    const labels = dbscan([[0, 0.1, 0.2, null, 0.3]], 1.0, 3);
    expect(labels).toHaveLength(5);
    expect(labels[3]).not.toBe('Noise'); // imputed to the median, lands in the blob
  });

  it('labels everything Noise when eps is far too small for the scale', () => {
    // The UI slider maxes at eps=5, which is meaningless on income-scale axes.
    const income = Array.from({ length: 60 }, (_, i) => 20000 + i * 900);
    expect(dbscan([income], 5, 5).every(l => l === 'Noise')).toBe(true);
  });
});

describe('countImputed (finding A9)', () => {
  it('counts missing coordinates per axis and in total', () => {
    const imp = countImputed([[1, 2, null, 4], [1, null, null, 4]], ['X', 'Y']);
    expect(imp.cells).toBe(3);
    expect(imp.total).toBe(8);
    expect(imp.byVariable).toEqual([{ var: 'Y', n: 2 }, { var: 'X', n: 1 }]);
  });

  it('counts non-numeric cells, not just nulls — they are imputed the same way', () => {
    const imp = countImputed([[1, 'n/a', 3]], ['X']);
    expect(imp.cells).toBe(1);
  });

  it('says nothing about complete axes', () => {
    expect(countImputed([[1, 2, 3], [4, 5, 6]], ['X', 'Y'])).toMatchObject({ cells: 0, byVariable: [] });
  });
});

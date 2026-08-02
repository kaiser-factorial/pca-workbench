import { describe, it, expect } from 'vitest';
import { correlation, compareGroups, silhouetteByK, kDistancePercentiles } from '../stats';
import { kmeans } from '../cluster';

describe('correlation', () => {
  it('is +1 / -1 for perfectly linear data', () => {
    expect(correlation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]).pearson).toBeCloseTo(1, 9);
    expect(correlation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]).pearson).toBeCloseTo(-1, 9);
  });

  it('matches the hand-computed r = rho = 0.8 case', () => {
    const c = correlation([1, 2, 3, 4, 5], [1, 3, 2, 5, 4]);
    expect(c.pearson).toBeCloseTo(0.8, 9);
    expect(c.spearman).toBeCloseTo(0.8, 9);
    expect(c.n).toBe(5);
  });

  it('drops incomplete pairs (pairwise-complete)', () => {
    const c = correlation([1, 2, null, 4, 5, 'x' as any], [2, 4, 6, 8, 10, 12]);
    expect(c.n).toBe(4);
    expect(c.pearson).toBeCloseTo(1, 9);
  });
});

describe('compareGroups', () => {
  // A=[1,2,3] (mean 2), B=[5,6,7] (mean 6); SS_between=24, SS_total=28
  const g = compareGroups([1, 2, 3, 5, 6, 7], ['A', 'A', 'A', 'B', 'B', 'B']);

  it('sorts groups by mean, descending', () => {
    expect(g.groups[0].group).toBe('B');
    expect(g.groups[0].mean).toBeCloseTo(6, 9);
    expect(g.groups.map(x => x.n)).toEqual([3, 3]);
  });

  it('computes eta-squared and overall stats exactly', () => {
    expect(g.etaSquared).toBeCloseTo(24 / 28, 9);
    expect(g.overall.mean).toBeCloseTo(4, 9);
    expect(g.overall.n).toBe(6);
  });
});

describe('clustering diagnostics', () => {
  // two tight, far-apart blobs
  const blobA = Array.from({ length: 50 }, (_, i) => [0 + (i % 7) * 0.01, 0 + (i % 5) * 0.01]);
  const blobB = Array.from({ length: 50 }, (_, i) => [10 + (i % 7) * 0.01, 10 + (i % 5) * 0.01]);
  const pts = [...blobA, ...blobB];
  const colX = pts.map(p => p[0]);
  const colY = pts.map(p => p[1]);

  it('silhouette prefers k=2 for two clean blobs, with a high score', () => {
    const sil = silhouetteByK([colX, colY], kmeans as any, 5);
    const best = sil.reduce((a, b) => (b.silhouette > a.silhouette ? b : a));
    expect(best.k).toBe(2);
    expect(best.silhouette).toBeGreaterThan(0.8);
  });

  it('k-distance percentiles are positive and monotone', () => {
    const kd = kDistancePercentiles([colX, colY], 5)!;
    expect(kd.n).toBe(100);
    const p = kd.percentiles;
    expect(p.p50).toBeGreaterThan(0);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.p90);
    expect(p.p90).toBeLessThanOrEqual(p.p95);
    expect(p.p95).toBeLessThanOrEqual(p.max);
  });
});

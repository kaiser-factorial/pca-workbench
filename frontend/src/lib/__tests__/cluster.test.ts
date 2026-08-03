import { describe, it, expect } from 'vitest';
import { kmeans, zscoreCellColumns, suggestStandardize } from '../cluster';

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

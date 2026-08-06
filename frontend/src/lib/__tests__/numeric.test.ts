import { describe, it, expect } from 'vitest';
import { asNumber, isNumericColumn } from '../table';
import { kmeans, zscoreCellColumns, suggestStandardize, countImputed } from '../cluster';
import { correlation, compareGroups } from '../stats';
import { runPCA } from '../pca';

// A column Excel formatted as Text arrives as strings. pca.ts and engine.ts
// always coerced those; numericColumns, numericPairs and the clustering imputer
// did not, so one column was a measurement in half the app and missing data in
// the other (finding C6). The clustering case was the damaging one: every row
// of such a column was replaced by the median, so the "cluster" said nothing
// about that variable at all.

describe('asNumber — the single convention', () => {
  it('accepts numbers and numeric text, including padded and signed', () => {
    expect(asNumber(3.5)).toBe(3.5);
    expect(asNumber('3.5')).toBe(3.5);
    expect(asNumber('  42  ')).toBe(42);
    expect(asNumber('-7')).toBe(-7);
    expect(asNumber('1e3')).toBe(1000);
    expect(asNumber('007')).toBe(7);
  });

  it('rejects everything that is not a finite number', () => {
    for (const v of [null, undefined, '', '   ', 'abc', '12abc', NaN, Infinity, -Infinity, {}, []]) {
      expect(asNumber(v as unknown)).toBeNull();
    }
  });

  it('does not let Number("") === 0 through as a real zero', () => {
    // The trap this helper exists to avoid: Number('') and Number(' ') are 0.
    expect(asNumber('')).toBeNull();
    expect(asNumber(' ')).toBeNull();
    expect(asNumber('0')).toBe(0);   // a real zero still is one
  });

  it('isNumericColumn needs only one usable value', () => {
    expect(isNumericColumn(['a', 'b', '3'])).toBe(true);
    expect(isNumericColumn(['a', 'b', null])).toBe(false);
    expect(isNumericColumn([])).toBe(false);
  });
});

describe('a text-formatted column behaves like a numeric one (finding C6)', () => {
  // Same values, one column stored as numbers and one as text.
  const nums = Array.from({ length: 40 }, (_, i) => (i % 2 ? 10 : 0) + (i % 5));
  const text = nums.map(String);
  const other = Array.from({ length: 40 }, (_, i) => i * 0.5);

  it('clusters on it instead of median-filling every row', () => {
    const fromNumbers = kmeans([nums, other], 2);
    const fromText = kmeans([text, other], 2);
    expect(fromText).toEqual(fromNumbers);
    // ...and the labels are not all one cluster, which is what median-filling
    // the whole column used to produce.
    expect(new Set(fromText).size).toBe(2);
  });

  it('is z-scored rather than passed through unscaled', () => {
    const [scaled] = zscoreCellColumns([text]);
    const mean = (scaled as number[]).reduce((s, v) => s + v, 0) / scaled.length;
    expect(mean).toBeCloseTo(0, 9);
    expect(scaled).toEqual(zscoreCellColumns([nums])[0]);
  });

  it('is not counted as missing data', () => {
    expect(countImputed([text], ['t']).cells).toBe(0);
    expect(countImputed([['1', 'x', null]], ['t']).cells).toBe(2);
  });

  it('correlates and compares by group like its numeric twin', () => {
    expect(correlation(text, other).pearson).toBeCloseTo(correlation(nums, other).pearson!, 12);
    const groups = nums.map((_, i) => (i % 2 ? 'B' : 'A'));
    expect(compareGroups(text, groups).etaSquared).toBeCloseTo(compareGroups(nums, groups).etaSquared!, 12);
  });

  it('feeds the standardize heuristic the real ranges', () => {
    // 0–14 against 0–19.5 is within 3x, so no standardizing suggested. Read as
    // all-missing, both ranges would be empty and the answer accidental.
    expect(suggestStandardize([text, other.map(String)], ['a', 'b'])).toBe(false);
    expect(suggestStandardize([text, other.map(v => String(v * 1000))], ['a', 'b'])).toBe(true);
  });

  it('gives the same PCA as the numeric twin', () => {
    const table = (c: unknown[]) => ({
      columns: ['a', 'b'], nRows: 40,
      data: { a: c as number[], b: other },
    });
    const fromText = runPCA(table(text) as never, ['a', 'b'], { k: 2 });
    const fromNums = runPCA(table(nums) as never, ['a', 'b'], { k: 2 });
    expect(fromText.varianceExplained[0]).toBeCloseTo(fromNums.varianceExplained[0], 12);
    expect(fromText.missing.imputedCells).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { detectSentinels, describeSentinels } from '../sentinels';

// A detector nobody trusts is worse than no detector, so the false-positive
// cases below matter more than the true-positive ones. Every "legitimate data"
// case here is a real shape from survey research.

const rep = (v: number, n: number) => Array.from({ length: n }, () => v);
const seq = (lo: number, hi: number, n: number) =>
  Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

describe('detectSentinels — finds the codes that matter (finding A14)', () => {
  it('flags -99 in a 1-7 Likert column', () => {
    const col = [...seq(1, 7, 40), ...rep(-99, 5)];
    expect(detectSentinels(col).map(f => f.value)).toEqual([-99]);
    expect(detectSentinels(col)[0].count).toBe(5);
  });

  it('flags 9999 in an age column', () => {
    expect(detectSentinels([...seq(18, 90, 60), ...rep(9999, 3)]).map(f => f.value)).toEqual([9999]);
  });

  it('flags -999 among percentages', () => {
    expect(detectSentinels([...seq(0, 100, 50), ...rep(-999, 4)]).map(f => f.value)).toEqual([-999]);
  });

  it('flags 9 on a 1-5 scale, a common "don\'t know" code', () => {
    expect(detectSentinels([...seq(1, 5, 40), ...rep(9, 6)]).map(f => f.value)).toEqual([9]);
  });

  it('flags more than one code in the same column, commonest first', () => {
    const col = [...seq(1, 7, 40), ...rep(-99, 2), ...rep(-999, 7)];
    expect(detectSentinels(col).map(f => f.value)).toEqual([-999, -99]);
  });

  it('flags a single occurrence — one bad row still moves a correlation', () => {
    expect(detectSentinels([...seq(1, 7, 30), -9999]).map(f => f.value)).toEqual([-9999]);
  });
});

describe('detectSentinels — stays quiet on legitimate data', () => {
  it('does not flag 99 in a 0-100 score, where it is an ordinary value', () => {
    expect(detectSentinels(seq(0, 100, 101).map(Math.round))).toEqual([]);
  });

  it('does not flag 9 on a 0-9 rating scale', () => {
    expect(detectSentinels(Array.from({ length: 60 }, (_, i) => i % 10))).toEqual([]);
  });

  it('does not flag 99 in an age column reaching 98', () => {
    expect(detectSentinels(Array.from({ length: 90 }, (_, i) => 10 + i))).toEqual([]);
  });

  it('does not flag a value sitting inside the distribution', () => {
    // 88 among 0..200 is neither an extreme nor separated.
    expect(detectSentinels(Array.from({ length: 200 }, (_, i) => i))).toEqual([]);
  });

  it('does not flag ordinary negative measurements', () => {
    // z-scores and PC scores are negative constantly and never sentinel-shaped.
    expect(detectSentinels(seq(-3.2, 3.4, 80))).toEqual([]);
  });

  it('says nothing about a short column, where "far outside" is meaningless', () => {
    expect(detectSentinels([1, 2, 3, -99])).toEqual([]);
  });

  it('says nothing about an empty or all-null column', () => {
    expect(detectSentinels([])).toEqual([]);
    expect(detectSentinels([null, null, null, null, null, null, null, null, null])).toEqual([]);
  });

  it('does not flag a column that is entirely one sentinel-shaped value', () => {
    // No rest to be far from — and a constant column is a different problem.
    expect(detectSentinels(rep(99, 30))).toEqual([]);
  });

  it('does not flag 1000 or 500, which are round but not sentinel-shaped', () => {
    expect(detectSentinels([...seq(1, 7, 40), ...rep(1000, 4)])).toEqual([]);
    expect(detectSentinels([...seq(1, 7, 40), ...rep(500, 4)])).toEqual([]);
  });
});

describe('describeSentinels', () => {
  it('names the values, the counts and what to do', () => {
    const msg = describeSentinels('q1', detectSentinels([...seq(1, 7, 40), ...rep(-99, 5)]))!;
    expect(msg).toMatch(/"q1"/);
    expect(msg).toMatch(/-99 \(5 rows, certain\)/);
    expect(msg).toMatch(/missing-value code/);
    expect(msg).toMatch(/replace them with blanks/);
    // Names the consequence, not just the observation.
    expect(msg).toMatch(/correlations, PCA and clustering/);
  });

  it('returns null when there is nothing to say', () => {
    expect(describeSentinels('q1', [])).toBeNull();
  });
});

// Two limits the sweep found, kept here so they are choices rather than
// surprises. Both are cases where the code is genuinely indistinguishable from
// data, and guessing would produce the false positives this detector cannot
// afford.
describe('detectSentinels — documented blind spots', () => {
  it('cannot see a code that falls inside the range of real values', () => {
    // 9999 among incomes spanning 0–200,000 is a plausible income.
    const income = Array.from({ length: 300 }, (_, i) => (i * 661) % 200000);
    expect(detectSentinels([...income, ...rep(9999, 5)])).toEqual([]);
  });

  it('cannot see -99 in a variable that is negative anyway', () => {
    const negative = Array.from({ length: 300 }, (_, i) => -500 + (i % 499));
    expect(detectSentinels([...negative, ...rep(-99, 5)])).toEqual([]);
  });

  it('but does catch a negative code in a never-negative variable', () => {
    // The rule that closes the wide-spread gap: negative income is not a
    // measurement, however small the gap looks against a 200,000 spread.
    const income = Array.from({ length: 300 }, (_, i) => (i * 661) % 200000);
    expect(detectSentinels([...income, ...rep(-99, 5)]).map(f => f.value)).toEqual([-99]);
  });
});

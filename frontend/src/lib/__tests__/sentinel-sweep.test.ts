import { describe, it, expect } from 'vitest';
import { detectSentinels } from '../sentinels';

// A false-positive sweep for the SMALL codes — 9 and 99 — which were always in
// SENTINEL_CANDIDATES but are the ones most likely to be real data. -99 and 9999
// are implausible as measurements; 9 is a perfectly good rating, count or age.
//
// The gap rule is what separates them: a candidate must sit further from the rest
// of the column than half the column's own spread. These tests pin down exactly
// where that rule succeeds and where it cannot help, so the behaviour is a
// decision on record rather than an accident of one constant.

const found = (vals: number[]) => detectSentinels(vals).map(f => f.value).sort((a, b) => a - b);
const rep = (v: number, n: number) => Array.from({ length: n }, () => v);

describe('9 as a Don\'t Know code — should be caught', () => {
  it('flags 9 in a 1-7 Likert item', () => {
    // The author's own case: Jealousy items with 9 = Don't Know.
    const col = [...rep(1, 12), ...rep(3, 20), ...rep(5, 25), ...rep(7, 15), ...rep(9, 8)];
    expect(found(col)).toContain(9);
  });

  it('flags 9 in a 1-5 Likert item', () => {
    const col = [...rep(1, 10), ...rep(2, 20), ...rep(3, 30), ...rep(4, 20), ...rep(5, 10), ...rep(9, 6)];
    expect(found(col)).toContain(9);
  });

  it('flags 99 in a 1-7 Likert item', () => {
    const col = [...rep(1, 10), ...rep(4, 30), ...rep(7, 10), ...rep(99, 5)];
    expect(found(col)).toContain(99);
  });

  it('flags 9 even when it is common — a third of the column', () => {
    const col = [...rep(1, 20), ...rep(2, 20), ...rep(3, 20), ...rep(9, 30)];
    expect(found(col)).toContain(9);
  });
});

describe('9 as real data — must NOT be flagged', () => {
  it('leaves 9 alone on a 0-10 rating scale', () => {
    const col = Array.from({ length: 110 }, (_, i) => i % 11);
    expect(found(col)).toEqual([]);
  });

  it('leaves 9 alone on a 1-9 Likert', () => {
    const col = Array.from({ length: 90 }, (_, i) => (i % 9) + 1);
    expect(found(col)).toEqual([]);
  });

  it('leaves 99 alone in a 0-100 percentage', () => {
    const col = Array.from({ length: 101 }, (_, i) => i);
    expect(found(col)).toEqual([]);
  });

  it('leaves 9 alone in an age column', () => {
    const col = Array.from({ length: 60 }, (_, i) => 9 + i);
    expect(found(col)).toEqual([]);
  });

  it('leaves 99 alone in an age column reaching 99', () => {
    const col = Array.from({ length: 80 }, (_, i) => 20 + i);
    expect(found(col)).toEqual([]);
  });

});

// The honest edge: a SMALL-RANGE count variable where a real 9 is an outlier.
// "Number of children" running 0-4 with one respondent at 9 has a gap of 5
// against a spread of 4, which clears the ratio — so it IS flagged. That is a
// false positive, and it is the price of catching 9 in a 1-5 Likert, which is
// numerically the same shape. The detector never removes anything, so the cost
// is one dismissable warning; the alternative is missing a real DK code.
describe('the known false positive, recorded deliberately', () => {
  it('flags a real 9 in a skewed 0-5 count, e.g. number of partners', () => {
    // Numerically indistinguishable from a 1-5 Likert carrying a DK code: an
    // all-integer short scale with a hole above it. Catching the Likert case is
    // worth one dismissable warning here, and nothing is ever removed.
    const col = [...rep(0, 20), ...rep(1, 30), ...rep(2, 20), ...rep(3, 10), ...rep(5, 6), ...rep(9, 3)];
    expect(found(col)).toContain(9);
  });

  it('flags a real 9 in a 0-4 count — same shape as a Likert with a DK code', () => {
    const col = [...rep(0, 30), ...rep(1, 25), ...rep(2, 15), ...rep(3, 8), ...rep(4, 4), 9];
    expect(found(col)).toContain(9);
  });

  it('but not when the count fills in the gap', () => {
    const col = [...rep(0, 30), ...rep(1, 25), ...rep(2, 15), ...rep(3, 8), ...rep(4, 4),
                 ...rep(5, 3), ...rep(6, 2), 7, 8, 9];
    expect(found(col)).toEqual([]);
  });
});

// The tier attached to each finding. Nothing is dropped at any tier — it decides
// the wording, and whether the recode dialog pre-ticks the box. So this is where
// the false positive above is paid for: it is still reported, but as a
// possibility, and a user who clicks straight through does not blank it.
describe('how sure the detector claims to be', () => {
  const tier = (vals: number[], v: number) => detectSentinels(vals).find(f => f.value === v)?.confidence;

  it('is certain about a wrong SIGN, whatever the spread', () => {
    const col = [...rep(0, 20), ...rep(50, 20), ...rep(100, 20), ...rep(-99, 4)];
    expect(tier(col, -99)).toBe('certain');
  });

  it('is certain when the gap is an order of magnitude past the spread', () => {
    // 99 against a 1-7 item: the rest spans 6, the gap is 92.
    expect(tier([...rep(1, 10), ...rep(4, 30), ...rep(7, 10), ...rep(99, 5)], 99)).toBe('certain');
  });

  it('says only LIKELY for a Don\'t Know code on a short scale', () => {
    // The commonest real case, and the one the gap ratio cannot see. Evidence is
    // a hole in the scale plus the share of respondents choosing it — good, but
    // not the same thing as a negative age.
    const col = [...rep(1, 12), ...rep(3, 20), ...rep(5, 25), ...rep(7, 15), ...rep(9, 8)];
    expect(tier(col, 9)).toBe('likely');
  });

  it('says only POSSIBLE for the known false positive', () => {
    const col = [...rep(0, 20), ...rep(1, 30), ...rep(2, 20), ...rep(3, 10), ...rep(5, 6), ...rep(9, 3)];
    expect(tier(col, 9)).toBe('possible');
  });

  it('says only POSSIBLE for a single stray value in a count', () => {
    const col = [...rep(0, 30), ...rep(1, 25), ...rep(2, 15), ...rep(3, 8), ...rep(4, 4), 9];
    expect(tier(col, 9)).toBe('possible');
  });

  it('records which rules fired, not just the verdict', () => {
    const col = [...rep(1, 12), ...rep(3, 20), ...rep(5, 25), ...rep(7, 15), ...rep(9, 8)];
    expect(detectSentinels(col)[0].reasons).toEqual(['scale-hole']);
    // A non-integer core, so the scale-hole rule cannot apply and the two that
    // did are the whole story. (On an all-integer core all three fire, which is
    // correct and not what this test is pinning.)
    const neg = [...rep(0.5, 20), ...rep(50.25, 20), ...rep(-99, 4)];
    expect(detectSentinels(neg)[0].reasons).toEqual(['impossible-sign', 'far-outside']);
  });

  it('never claims co-occurrence from a single column', () => {
    // That evidence does not exist at this level — only scanTableForCodes can
    // see it — and a per-column scan must not imply it.
    const col = [...rep(1, 12), ...rep(3, 20), ...rep(9, 8)];
    expect(detectSentinels(col).flatMap(f => f.reasons)).not.toContain('co-occurs');
  });
});

describe('multiple codes and mixed cases', () => {
  it('catches 9 and 99 together in one column', () => {
    const col = [...rep(1, 20), ...rep(4, 30), ...rep(7, 20), ...rep(9, 5), ...rep(99, 4)];
    const f = found(col);
    expect(f).toContain(9);
    expect(f).toContain(99);
  });

  it('catches -99 beside a legitimate 9', () => {
    // 0-10 rating (9 is real) plus a -99 refusal.
    const col = [...Array.from({ length: 88 }, (_, i) => i % 11), ...rep(-99, 6)];
    const f = found(col);
    expect(f).toContain(-99);
    expect(f).not.toContain(9);
  });

  it('says nothing on a column too short to judge', () => {
    expect(found([1, 2, 3, 9])).toEqual([]);
  });

  it('says nothing about a constant column of 9s', () => {
    // No spread, so "far outside the rest" is undefined — and a column that is
    // entirely one code is not missing data, it is a useless variable.
    expect(found(rep(9, 40))).toEqual([]);
  });
});

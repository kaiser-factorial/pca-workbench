// Detection of missing-value codes that arrive as ordinary numbers.
//
// SPSS, Qualtrics and most survey platforms write "refused", "not applicable"
// and "don't know" as out-of-range numbers — -99, -999, 9999 — and a CSV export
// carries no sign that they mean anything special. This app then reads them as
// measurements: they enter the PCA correlation matrix, Euclidean distances,
// Pearson/Spearman and the histograms as if a respondent had scored -99.
// Of everything the review found, this is the one most likely to put a wrong
// number in a paper (finding A14).
//
// Deliberately NOT auto-stripped. Which codes mean what is the researcher's
// knowledge, not ours, and silently dropping data would be a worse sin than
// silently keeping it. The job here is only to refuse to let them pass
// unremarked.

/**
 * Values that are sentinel-SHAPED. Being on this list is necessary but nowhere
 * near sufficient — 99 is a perfectly good percentage and 9 a perfectly good
 * 0–10 rating, so every candidate still has to prove it sits far outside the
 * data before anything is said.
 */
const SENTINEL_CANDIDATES = new Set([
  -1111, -999999, -99999, -9999, -999, -99, -9, -8, -7, -6, -5, -4, -3,
  9, 66, 77, 88, 97, 98, 99, 777, 888, 997, 998, 999, 6666, 7777, 8888, 9997, 9998, 9999,
  99999, 999999,
]);

/**
 * A candidate must be separated from the rest of the column by more than half
 * the column's own spread. That ratio is what distinguishes the two cases the
 * detector exists to tell apart:
 *
 *   1–7 Likert with a 99  → the rest spans 6, the gap is 92. Sentinel.
 *   0–100 score with a 99 → the rest spans 100, the gap is 1. A real score.
 *
 * Set deliberately loose. A missed sentinel leaves things exactly as they were
 * before this existed; a false positive teaches researchers to ignore the
 * warning, which is worse than not having one.
 */
const GAP_RATIO = 0.5;

/** The minimum column length at which "far outside the distribution" means anything. */
const MIN_ROWS = 8;

/**
 * Above this many distinct non-code values a column is being treated as
 * continuous, and the integer-hole rule below stops applying. A response scale
 * has a handful of levels; a measurement has many.
 */
const MAX_SCALE_LEVELS = 20;

import { asNumber } from './table';

export type SentinelFinding = {
  value: number;
  /** How many rows carry it. */
  count: number;
};

/** Everything one pass over a column can tell the code machinery. */
export type ColumnCodeScan = {
  /** The detector's own findings: sentinel-shaped AND suspiciously placed. */
  findings: SentinelFinding[];
  /** Row count for every sentinel-SHAPED value present, flagged or not. */
  candidateCounts: Map<number, number>;
  /** Row count for declared values that are not sentinel-shaped. */
  declaredOnlyCounts: Map<number, number>;
  /** Cells that held a usable number at all. */
  numericCount: number;
};

/**
 * ONE pass over the raw column: coercion, candidate counting, declared-value
 * counting and the core statistics all happen in the same loop, with no
 * intermediate arrays.
 *
 * This used to be map(asNumber) into a fresh array, then a counting pass, then
 * a filter building the core array, then min/max/integer/distinct passes over
 * that — and the import path ran the whole thing twice per column. On a
 * survey-shaped table (the author's is 3,105 x 1,156) those allocations were
 * the visible upload latency.
 */
export const scanColumnForCodes = (
  values: readonly unknown[],
  declared?: ReadonlySet<number>,
): ColumnCodeScan => {
  const candidateCounts = new Map<number, number>();
  const declaredOnlyCounts = new Map<number, number>();
  let numericCount = 0;
  let coreCount = 0;
  let coreMin = Infinity, coreMax = -Infinity;
  let integerCore = true;
  const distinct = new Set<number>();

  for (const cell of values) {
    const v = asNumber(cell);
    if (v === null) continue;
    numericCount++;
    if (SENTINEL_CANDIDATES.has(v)) {
      candidateCounts.set(v, (candidateCounts.get(v) ?? 0) + 1);
      continue;
    }
    // Declared values that are not sentinel-shaped stay in the core: detection
    // is independent of what the user declared, exactly as before the merge.
    if (declared?.has(v)) declaredOnlyCounts.set(v, (declaredOnlyCounts.get(v) ?? 0) + 1);
    coreCount++;
    if (v < coreMin) coreMin = v;
    if (v > coreMax) coreMax = v;
    if (integerCore && !Number.isInteger(v)) integerCore = false;
    if (distinct.size <= MAX_SCALE_LEVELS) distinct.add(v);
  }

  const empty = { candidateCounts, declaredOnlyCounts, numericCount };
  if (numericCount < MIN_ROWS) return { findings: [], ...empty };
  if (!candidateCounts.size) return { findings: [], ...empty };
  if (coreCount < 2) return { findings: [], ...empty };

  const distinctCore = distinct.size;
  const spread = coreMax - coreMin;

  const found: SentinelFinding[] = [];
  for (const [candidate, count] of candidateCounts) {
    // Distance from the data, zero for anything sitting inside it — a
    // sentinel-shaped value in the middle of the distribution is just data.
    const gap = candidate < coreMin ? coreMin - candidate
      : candidate > coreMax ? candidate - coreMax
      : 0;

    // A negative code in a variable that is otherwise never negative is a
    // sentinel whatever the ratio says. The gap rule alone misses these on
    // wide-spread variables: -99 against incomes spanning 200,000 is a gap of
    // 99 and vanishes, though a negative income is plainly not a measurement.
    // Safe because it needs coreMin >= 0 — z-scores, PC scores and temperatures
    // all have genuinely negative data and never reach this branch.
    const impossibleSign = candidate < 0 && coreMin >= 0;

    // A HOLE in a small integer scale. The gap ratio is the wrong instrument for
    // the commonest survey code of all: a 1-7 Likert with 9 = "Don't Know" has a
    // spread of 6 and a gap of only 2, so the ratio rejects it — the exact case
    // this detector exists for went unreported. Measured, not assumed: see
    // sentinel-sweep.test.ts, where that case failed before this rule.
    //
    // What separates a code from data on a short scale is not distance but
    // discontinuity. 1-7 with a 9 leaves 8 unused; a genuine 1-9 Likert or a
    // 0-10 rating runs continuously up to its top and leaves no hole. So the
    // candidate must clear the core by at least 2 on an all-integer scale with
    // few levels.
    const scaleLike = integerCore && distinctCore <= MAX_SCALE_LEVELS && Number.isInteger(candidate);
    const integerHole = scaleLike && gap >= 2;

    if (impossibleSign || integerHole || gap > spread * GAP_RATIO) found.push({ value: candidate, count });
  }

  return { findings: found.sort((a, b) => b.count - a.count || a.value - b.value), ...empty };
};

/**
 * Sentinel-shaped values sitting far outside the rest of a numeric column.
 * Returns [] when there is nothing to say, which is the common case.
 */
export const detectSentinels = (values: readonly unknown[]): SentinelFinding[] =>
  scanColumnForCodes(values).findings;

/** One sentence naming what was found, or null. Shared by every surface. */
export const describeSentinels = (column: string, found: SentinelFinding[]): string | null => {
  if (!found.length) return null;
  const list = found.map(f => `${f.value} (${f.count} row${f.count === 1 ? '' : 's'})`).join(', ');
  return `"${column}" contains ${list}, far outside the rest of its values — the shape of a missing-value code (SPSS and Qualtrics write -99, -999 and 9999 this way). These are being read as real measurements and will pull means, correlations, PCA and clustering toward them. If they are missing-value codes, replace them with blanks before analysing.`;
};

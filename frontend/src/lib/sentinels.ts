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
//
// There is no library for this. The R ecosystem's naniar ships a LIST of common
// codes (`common_na_numbers`) and a counter, but no test of whether a given
// column's 9 is a code or a rating; FAHES (QCRI, VLDB 2018) is a research
// prototype in C; and everything else solves the problem upstream by reading
// DECLARED missing values out of .sav/.dta metadata, which a CSV does not carry.
// So the rules below are ours, and each one states what it costs.

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

/**
 * A gap this many times the core spread is not arguable: -99 against a 1–7
 * Likert is 15× its spread away, and no measurement scale has a value that
 * isolated. Below this the gap rule still fires, but as "likely" rather than
 * "certain".
 */
const FAR_RATIO = 3;

/**
 * The share of a column a code has to occupy before middling evidence counts as
 * more than a possibility.
 *
 * This is the boundary between the two cases the gap and hole rules cannot tell
 * apart — a short Likert with a Don't Know option, and a skewed count with a real
 * value in its tail. It is a heuristic tuned on the shapes in the test suites,
 * not a law: a Don't Know option is a response people actually PICK (6–33% of
 * rows across our cases), whereas a real 9 at the tail of a count is rare (1–3%).
 *
 * It only moves the tier and the default checkbox — nothing is dropped at any
 * tier, and a rare code is still listed for the user to tick.
 */
const CODE_SHARE = 0.05;

/**
 * How much more often the same rows must carry a code across columns than chance
 * would give, before that counts as evidence. Three-fold is a wide margin
 * chosen because the cost of being wrong is a pre-ticked checkbox.
 */
const COOCCUR_LIFT = 3;

/** Below this many co-occurring row-pairs the lift is noise on small numbers. */
const COOCCUR_MIN_PAIRS = 3;

import { asNumber } from './table';

/**
 * How much the detector is willing to claim. Nothing is ever removed at any
 * tier; the tier decides the wording and whether a recode box starts ticked.
 */
export type SentinelConfidence = 'certain' | 'likely' | 'possible';

/** Which rule fired, so the interface can say why rather than just assert. */
export type SentinelReason =
  /** Negative value in a column that is otherwise never negative. */
  | 'impossible-sign'
  /** Sits further outside the column than half its own spread. */
  | 'far-outside'
  /** Leaves a hole in a short all-integer scale (1–7 with a 9 skips 8). */
  | 'scale-hole'
  /** The same rows carry this code in other columns, far more than chance. */
  | 'co-occurs';

export type SentinelFinding = {
  value: number;
  /** How many rows carry it. */
  count: number;
  confidence: SentinelConfidence;
  /** Every rule that fired, in the order they are described to the user. */
  reasons: SentinelReason[];
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
    const farOutside = gap > spread * GAP_RATIO;

    if (!impossibleSign && !integerHole && !farOutside) continue;

    const reasons: SentinelReason[] = [];
    if (impossibleSign) reasons.push('impossible-sign');
    if (farOutside) reasons.push('far-outside');
    if (integerHole) reasons.push('scale-hole');

    // How sure. Two rules are strong enough to stand alone: a value that cannot
    // be a measurement at all (wrong sign), and one separated from the data by an
    // order of magnitude. Everything else — a gap of 4 above a spread of 5, a
    // hole in a short scale — is the shape a Don't Know code and a rare real
    // value SHARE, so it falls to the one thing that still distinguishes them:
    // how many people it accounts for.
    //
    // A ratio needs something to be a ratio OF. On a constant core the spread is
    // 0 and every gap is infinitely many times it, which is arithmetic rather
    // than evidence, so that case goes to the share test too.
    const ratio = spread > 0 ? gap / spread : null;
    const share = count / numericCount;
    const confidence: SentinelConfidence =
      impossibleSign || (ratio !== null && ratio >= FAR_RATIO) ? 'certain'
      : share >= CODE_SHARE ? 'likely'
      : 'possible';

    found.push({ value: candidate, count, confidence, reasons });
  }

  return { findings: found.sort((a, b) => b.count - a.count || a.value - b.value), ...empty };
};

/**
 * Sentinel-shaped values sitting far outside the rest of a numeric column.
 * Returns [] when there is nothing to say, which is the common case.
 */
export const detectSentinels = (values: readonly unknown[]): SentinelFinding[] =>
  scanColumnForCodes(values).findings;

/**
 * Whether the SAME ROWS carry a code in this column as in the others that hold
 * it — the signature of a "Don't Know" block, where a respondent who skips one
 * item of a battery skips the rest.
 */
export type CooccurrenceEvidence = {
  value: number;
  /**
   * Other columns that CARRY this value at all — not the count that shares rows
   * with this one. An id column holding a single 9 is a peer and overlaps with
   * nothing, so this number must never be used to state how much agreement there
   * is. That is what `lift` is for.
   */
  peers: number;
  /** Row-pairs in which this column shares the code with one of those peers. */
  observedPairs: number;
  /** How many such pairs independence would give, from the marginal counts. */
  expectedPairs: number;
  /** observedPairs / expectedPairs. 1 is chance; large means the same people. */
  lift: number;
  /** True when the pattern is strong enough to count as evidence. */
  supports: boolean;
};

export type TableCodeScan = {
  byColumn: Map<string, ColumnCodeScan>;
  /** column -> value -> what the other columns say about it. */
  cooccurrence: Map<string, Map<number, CooccurrenceEvidence>>;
};

const bumped = (c: SentinelConfidence): SentinelConfidence =>
  c === 'possible' ? 'likely' : 'certain';

/**
 * Scan a whole table, then let the columns testify about each other.
 *
 * A single column can only ever argue from shape — a 9 sitting above a 1–7
 * scale. Across columns there is a second, independent kind of evidence, and it
 * is the one a human actually reasons with: if respondents 4, 17 and 92 carry 9
 * in eleven Jealousy items, that is a person choosing "Don't Know" eleven times,
 * not eleven coincidences. If the 9s in `child_age` fall on unrelated rows, the
 * same test says so, which is exactly the discrimination the per-column rules
 * cannot make.
 *
 * The statistic is deliberately elementary. For value v, take every column
 * holding it, with counts nᵢ summing to S over N rows. Count how many of those
 * columns carry v in each row (k). This column's observed pairs are Σ (k − 1)
 * over its own rows; independence predicts nᵢ(S − nᵢ)/N. Their ratio is the
 * lift, computed PER COLUMN rather than for the group, so a real 9 in one
 * variable is not promoted by a Don't Know block running through the other
 * twenty.
 *
 * Co-occurrence only ever RAISES confidence. Its absence is not evidence
 * against a code — a survey may use 9 in exactly one item — so nothing is
 * demoted and no finding is created here that the per-column rules did not
 * already make.
 */
export const scanTableForCodes = (
  columns: readonly string[],
  data: Readonly<Record<string, readonly unknown[]>>,
  nRows: number,
  declared?: ReadonlySet<number>,
): TableCodeScan => {
  const byColumn = new Map<string, ColumnCodeScan>();
  for (const column of columns) {
    byColumn.set(column, scanColumnForCodes(data[column] ?? [], declared));
  }

  const cooccurrence = new Map<string, Map<number, CooccurrenceEvidence>>();
  if (nRows < MIN_ROWS) return { byColumn, cooccurrence };

  // Values worth the second pass: anything a column flagged, plus anything the
  // user declared. Both need at least two columns to have a pattern at all.
  const interesting = new Set<number>(declared ?? []);
  for (const scan of byColumn.values()) for (const f of scan.findings) interesting.add(f.value);

  const rowCount = new Int32Array(nRows);

  for (const value of interesting) {
    const present: string[] = [];
    for (const [column, scan] of byColumn) {
      const n = (scan.candidateCounts.get(value) ?? 0) + (scan.declaredOnlyCounts.get(value) ?? 0);
      if (n > 0) present.push(column);
    }
    if (present.length < 2) continue;

    rowCount.fill(0);
    const rowsOf = new Map<string, number[]>();
    let total = 0;
    for (const column of present) {
      const arr = data[column] ?? [];
      const rows: number[] = [];
      const lim = Math.min(nRows, arr.length);
      for (let r = 0; r < lim; r++) {
        if (asNumber(arr[r]) === value) { rowCount[r]++; rows.push(r); }
      }
      rowsOf.set(column, rows);
      total += rows.length;
    }

    for (const [column, rows] of rowsOf) {
      const n = rows.length;
      if (!n) continue;
      let observedPairs = 0;
      for (const r of rows) observedPairs += rowCount[r] - 1;
      const expectedPairs = (n * (total - n)) / nRows;
      const lift = expectedPairs > 0 ? observedPairs / expectedPairs : 0;
      const supports = observedPairs >= COOCCUR_MIN_PAIRS && lift >= COOCCUR_LIFT;

      let per = cooccurrence.get(column);
      if (!per) cooccurrence.set(column, per = new Map());
      per.set(value, { value, peers: present.length - 1, observedPairs, expectedPairs, lift, supports });

      if (!supports) continue;
      const scan = byColumn.get(column);
      const finding = scan?.findings.find(f => f.value === value);
      if (finding) {
        finding.reasons = [...finding.reasons, 'co-occurs'];
        finding.confidence = bumped(finding.confidence);
      }
    }
  }

  return { byColumn, cooccurrence };
};

/** Plain-language wording for each rule, for tooltips and reports. */
export const REASON_TEXT: Record<SentinelReason, string> = {
  'impossible-sign': 'negative in a column that is otherwise never negative',
  'far-outside': 'far outside the rest of the column',
  'scale-hole': 'leaves a hole in a short integer scale',
  'co-occurs': 'falls on the same rows as the same code in other columns',
};

/** One sentence naming what was found, or null. Shared by every surface. */
export const describeSentinels = (column: string, found: SentinelFinding[]): string | null => {
  if (!found.length) return null;
  const list = found.map(f => `${f.value} (${f.count} row${f.count === 1 ? '' : 's'}, ${f.confidence})`).join(', ');
  return `"${column}" contains ${list} — the shape of a missing-value code (SPSS and Qualtrics write -99, -999 and 9999 this way). These are being read as real measurements and will pull means, correlations, PCA and clustering toward them. If they are missing-value codes, replace them with blanks before analysing.`;
};

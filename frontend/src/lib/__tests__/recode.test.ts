import { describe, it, expect } from 'vitest';
import {
  applyRecode, describeCodeEntry, describeRecode, parseDeclaredCodes, scanForCodes,
  type ColumnCodes,
} from '../recode';
import type { DataTable } from '../table';

// This module CHANGES DATA, which nothing else in the app does on the user's
// behalf. So these tests are written as attacks: try to make it blank the wrong
// cell, mutate the input, lose a row, or misreport what it did.

const t = (data: Record<string, unknown[]>): DataTable => {
  const columns = Object.keys(data);
  return { columns, data, nRows: data[columns[0]].length };
};
const rep = (v: number, n: number) => Array.from({ length: n }, () => v);

describe('it blanks exactly what it was told to', () => {
  it('replaces the named code in the named column', () => {
    const table = t({ likert: [1, 2, 9, 3, 9], age: [20, 30, 9, 40, 50] });
    const r = applyRecode(table, { byColumn: { likert: [9] } });
    expect(r.table.data.likert).toEqual([1, 2, null, 3, null]);
    expect(r.totalReplaced).toBe(2);
  });

  it('leaves every other column alone — including the same code elsewhere', () => {
    // The author's exact requirement: 9 found in two columns, swap in one only.
    const table = t({ likert_1: [1, 9, 3], child_age: [9, 4, 5] });
    const r = applyRecode(table, { byColumn: { likert_1: [9] } });
    expect(r.table.data.likert_1).toEqual([1, null, 3]);
    expect(r.table.data.child_age).toEqual([9, 4, 5]);
    expect(r.effects.map(e => e.column)).toEqual(['likert_1']);
  });

  it('handles several codes in one column', () => {
    const table = t({ x: [1, 9, 2, 99, 3, -99] });
    const r = applyRecode(table, { byColumn: { x: [9, 99, -99] } });
    expect(r.table.data.x).toEqual([1, null, 2, null, 3, null]);
  });

  it('handles several columns at once', () => {
    const table = t({ a: [1, 9], b: [9, 2], c: [9, 9] });
    const r = applyRecode(table, { byColumn: { a: [9], b: [9] } });
    expect(r.table.data.a).toEqual([1, null]);
    expect(r.table.data.b).toEqual([null, 2]);
    expect(r.table.data.c).toEqual([9, 9]);
    expect(r.totalReplaced).toBe(2);
  });

  it('catches a code that arrived as a STRING from a text-formatted sheet', () => {
    const table = t({ x: ['1', '9', '2'] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual(['1', null, '2']);
  });

  it('does not match 9 against "9 " padded text that is not a number', () => {
    const table = t({ x: [1, 'nine', 9, ''] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual([1, 'nine', null, '']);
  });

  it('does not confuse 9 with 9.0001', () => {
    const table = t({ x: [9, 9.0001, 8.9999, 9] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual([null, 9.0001, 8.9999, null]);
  });

  it('does not treat -9 as 9', () => {
    const table = t({ x: [9, -9, 9] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual([null, -9, null]);
  });
});

describe('it never mutates the input', () => {
  it('leaves the original table untouched', () => {
    const table = t({ x: [1, 9, 2] });
    const snapshot = JSON.stringify(table);
    applyRecode(table, { byColumn: { x: [9] } });
    expect(JSON.stringify(table)).toBe(snapshot);
  });

  it('returns a new column array, not the same reference', () => {
    const table = t({ x: [1, 9, 2] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).not.toBe(table.data.x);
  });

  it('keeps row count and column list identical', () => {
    const table = t({ a: [1, 9, 3], b: [4, 5, 6] });
    const r = applyRecode(table, { byColumn: { a: [9] } });
    expect(r.table.nRows).toBe(3);
    expect(r.table.columns).toEqual(['a', 'b']);
    expect((r.table.data.a as unknown[]).length).toBe(3);
  });
});

describe('the safety report', () => {
  it('reports the shift in mean and sd, not just a count', () => {
    // 9s dragging a 1-5 item upward: blanking them must move the mean DOWN.
    const table = t({ x: [1, 2, 3, 4, 5, 9, 9, 9] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    const e = r.effects[0];
    expect(e.replaced).toBe(3);
    expect(e.nBefore).toBe(8);
    expect(e.nAfter).toBe(5);
    expect(e.meanBefore).toBeCloseTo(5.25, 6);
    expect(e.meanAfter).toBeCloseTo(3, 6);
    expect(e.sdAfter as number).toBeLessThan(e.sdBefore as number);
  });

  it('confirms untouched values are byte-identical', () => {
    const table = t({ x: [1, 9, 2.5, 'text', null, 9] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.effects[0].untouchedRowsIdentical).toBe(true);
  });

  it('describes each column in plain language', () => {
    const table = t({ likert: [1, 2, 3, 9, 9] });
    const lines = describeRecode(applyRecode(table, { byColumn: { likert: [9] } }));
    expect(lines[0]).toMatch(/likert: 2 cells blanked/);
    expect(lines[0]).toMatch(/n 5 → 3/);
    expect(lines[0]).toMatch(/mean/);
  });

  it('says so when nothing matched rather than claiming success', () => {
    const table = t({ x: [1, 2, 3] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.totalReplaced).toBe(0);
    expect(describeRecode(r)[0]).toMatch(/nothing matched/);
  });
});

describe('edge cases, and edges of the edges', () => {
  it('an empty code list is a no-op, not a wipe', () => {
    const table = t({ x: [1, 9, 2] });
    const r = applyRecode(table, { byColumn: { x: [] } });
    expect(r.table.data.x).toEqual([1, 9, 2]);
    expect(r.totalReplaced).toBe(0);
  });

  it('an unknown column name is ignored, not a crash', () => {
    const table = t({ x: [1, 9] });
    const r = applyRecode(table, { byColumn: { nope: [9] } });
    expect(r.table.data.x).toEqual([1, 9]);
    expect(r.effects).toEqual([]);
  });

  it('an empty plan returns an equivalent table', () => {
    const table = t({ x: [1, 9] });
    const r = applyRecode(table, { byColumn: {} });
    expect(r.table.data.x).toEqual([1, 9]);
    expect(r.totalReplaced).toBe(0);
  });

  it('blanking every value leaves an empty column, and says so', () => {
    const table = t({ x: [9, 9, 9] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual([null, null, null]);
    expect(r.effects[0].nAfter).toBe(0);
    expect(r.effects[0].meanAfter).toBeNull();
    expect(r.effects[0].sdAfter).toBeNull();
    expect(describeRecode(r)[0]).toMatch(/n 3 → 0/);
  });

  it('a single surviving value reports a mean but no sd', () => {
    const table = t({ x: [4, 9, 9] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.effects[0].meanAfter).toBe(4);
    expect(r.effects[0].sdAfter).toBeNull();
  });

  it('already-blank cells are preserved, not counted as replacements', () => {
    const table = t({ x: [null, 9, undefined, 2, ''] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual([null, null, undefined, 2, '']);
    expect(r.effects[0].replaced).toBe(1);
  });

  it('a column of all non-numeric text is untouched', () => {
    const table = t({ x: ['a', 'b', 'c'] });
    const r = applyRecode(table, { byColumn: { x: [9] } });
    expect(r.table.data.x).toEqual(['a', 'b', 'c']);
    expect(r.effects[0].replaced).toBe(0);
  });

  it('0 is a usable code and is not confused with a falsy blank', () => {
    const table = t({ x: [0, 1, 0, 2] });
    const r = applyRecode(table, { byColumn: { x: [0] } });
    expect(r.table.data.x).toEqual([null, 1, null, 2]);
    expect(r.effects[0].replaced).toBe(2);
  });

  it('a negative code works', () => {
    const table = t({ x: [1, -99, 2, -99] });
    const r = applyRecode(table, { byColumn: { x: [-99] } });
    expect(r.table.data.x).toEqual([1, null, 2, null]);
  });

  it('recoding twice is idempotent', () => {
    const table = t({ x: [1, 9, 2] });
    const once = applyRecode(table, { byColumn: { x: [9] } });
    const twice = applyRecode(once.table, { byColumn: { x: [9] } });
    expect(twice.table.data.x).toEqual(once.table.data.x);
    expect(twice.totalReplaced).toBe(0);
  });
});

const valuesOf = (h: ColumnCodes) => h.entries.map(e => e.value);
const entry = (hits: ColumnCodes[], column: string, value: number) =>
  hits.find(h => h.column === column)?.entries.find(e => e.value === value);

describe('scanForCodes — which columns hold which codes', () => {
  it('finds a declared code in every column that has it', () => {
    const table = t({ likert_1: [1, 9, 3], child_age: [9, 4, 5], name: ['a', 'b', 'c'] });
    const hits = scanForCodes(table, [9]);
    expect(hits.map(h => h.column)).toEqual(['likert_1', 'child_age']);
    expect(entry(hits, 'likert_1', 9)?.count).toBe(1);
  });

  it('takes a declared code LITERALLY, with no plausibility test', () => {
    // 9 on a 0-10 rating is real data and the detector rightly ignores it —
    // but if the user says 9 is a code, that is their knowledge, not ours.
    const table = t({ rating: Array.from({ length: 33 }, (_, i) => i % 11) });
    expect(scanForCodes(table, []).length).toBe(0);
    const hits = scanForCodes(table, [9]);
    expect(hits.length).toBe(1);
    expect(valuesOf(hits[0])).toEqual([9]);
    expect(hits[0].entries[0].confidence).toBeNull();
  });

  it('reports detector findings without any declaration', () => {
    const table = t({ x: [...Array(20).fill(3), ...Array(20).fill(5), ...Array(5).fill(-99)] });
    const hits = scanForCodes(table, []);
    expect(entry(hits, 'x', -99)?.confidence).toBe('certain');
  });

  it('skips columns with nothing numeric in them', () => {
    const table = t({ notes: ['x', 'y', 'z'] });
    expect(scanForCodes(table, [9])).toEqual([]);
  });

  it('merges declared and detected codes in one column', () => {
    const table = t({ x: [...Array(20).fill(2), ...Array(20).fill(4), ...Array(4).fill(-99), 9, 9] });
    const hits = scanForCodes(table, [9]);
    expect(valuesOf(hits[0])).toEqual([-99, 9]);
  });
});

describe('the order columns are offered in', () => {
  it('puts the strongest evidence first, not file order', () => {
    // Declaring 9 in a survey turns up an incidental 9 in the id column. File
    // order put that above the battery the user is actually here for.
    const table = t({
      id: Array.from({ length: 40 }, (_, i) => i + 1),
      likert_1: [...rep(1, 10), ...rep(4, 14), ...rep(7, 12), ...rep(9, 4)],
      refused: [...rep(2, 18), ...rep(5, 18), ...rep(-99, 4)],
    });
    expect(scanForCodes(table, [9]).map(h => h.column)).toEqual(['refused', 'likert_1', 'id']);
  });
});

// The default state of each checkbox, which is the whole safety argument of the
// dialog: a user who clicks straight through must not blank real data, and a user
// with a Don't Know block must not have to tick twenty boxes.
describe('suggested defaults — what a user who just clicks Apply gets', () => {
  it('ticks a code the detector is confident about', () => {
    const table = t({ x: [...Array(20).fill(3), ...Array(20).fill(5), ...Array(5).fill(-99)] });
    expect(entry(scanForCodes(table, []), 'x', -99)?.suggested).toBe(true);
  });

  it('leaves a bare POSSIBILITY unticked — the known false positive', () => {
    // A skewed count (partners 0-5) with a real 9 is numerically identical to a
    // short Likert carrying a DK code, so the detector still raises it. But a
    // real tail value is rare where a response option is not, so it comes in as
    // "possible" and does NOT arrive pre-ticked.
    const col = [...rep(0, 20), ...rep(1, 30), ...rep(2, 20), ...rep(3, 10), ...rep(5, 6), ...rep(9, 3)];
    const e = entry(scanForCodes(t({ partners: col }), []), 'partners', 9);
    expect(e?.confidence).toBe('possible');
    expect(e?.suggested).toBe(false);
  });

  it('ticks the same shape when the code is common enough to be a response option', () => {
    const col = [...rep(1, 12), ...rep(3, 20), ...rep(5, 25), ...rep(7, 15), ...rep(9, 8)];
    const e = entry(scanForCodes(t({ likert_1: col }), []), 'likert_1', 9);
    expect(e?.confidence).toBe('likely');
    expect(e?.suggested).toBe(true);
  });

  it('does NOT tick a declared code in a column the detector never flagged', () => {
    // The reported scenario: declaring 9 finds it in a Likert item AND in a
    // child's age. Blanking the age is the mistake this default exists to stop.
    const table = t({
      likert_1: [...rep(1, 20), ...rep(4, 20), ...rep(7, 12), ...rep(9, 8)],
      child_age: Array.from({ length: 60 }, (_, i) => 2 + (i % 11)),
    });
    const hits = scanForCodes(table, [9]);
    expect(entry(hits, 'likert_1', 9)?.suggested).toBe(true);
    expect(entry(hits, 'child_age', 9)?.suggested).toBe(false);
    expect(entry(hits, 'child_age', 9)?.confidence).toBeNull();
  });
});

// The second, independent kind of evidence: not the shape of one column, but
// whether the SAME PEOPLE carry the code across columns.
describe('cross-column co-occurrence', () => {
  /**
   * `block` rows answer 9 to every item in the battery; the rest answer normally.
   * `decoy` carries the same number of 9s on unrelated rows.
   */
  const survey = (nRows: number, items: number, blockRows: Set<number>) => {
    const data: Record<string, unknown[]> = {};
    for (let c = 0; c < items; c++) {
      data[`item_${c}`] = Array.from({ length: nRows }, (_, r) =>
        blockRows.has(r) ? 9 : 1 + ((r + c) % 7));
    }
    return data;
  };

  it('raises confidence when the same rows carry the code across items', () => {
    const block = new Set([3, 9, 14, 21, 30, 44]);
    const table = t(survey(60, 6, block));
    const hits = scanForCodes(table, []);
    const e = entry(hits, 'item_0', 9);
    expect(e?.reasons).toContain('co-occurs');
    expect(e?.cooccurrence?.supports).toBe(true);
    // 6 rows x 5 peers, every one of them shared.
    expect(e?.cooccurrence?.observedPairs).toBe(30);
    expect(e?.cooccurrence?.lift).toBeGreaterThan(3);
    // On its own this column's 9 is "likely" — a hole in the scale that 10% of
    // respondents chose. The other five items are what make it certain.
    const solo = entry(scanForCodes(t({ item_0: table.data.item_0 }), []), 'item_0', 9);
    expect(solo?.confidence).toBe('likely');
    expect(e?.confidence).toBe('certain');
  });

  it('promotes a mere possibility to likely, and so ticks it', () => {
    // Two 9s in a 60-row item is 3% — too rare for the share rule to call it a
    // response option. Across six items on the SAME two rows it is a Don't Know
    // block, and that is a different claim entirely.
    const block = new Set([22, 41]);
    const table = t(survey(60, 6, block));
    const solo = entry(scanForCodes(t({ item_0: table.data.item_0 }), []), 'item_0', 9);
    expect(solo?.confidence).toBe('possible');
    expect(solo?.suggested).toBe(false);

    const e = entry(scanForCodes(table, []), 'item_0', 9);
    expect(e?.confidence).toBe('likely');
    expect(e?.suggested).toBe(true);
  });

  it('does NOT promote a column whose codes fall on unrelated rows', () => {
    // The discrimination the per-column rules cannot make. A real 9 in one
    // variable must not be carried along by a DK block running through twenty
    // others, so the lift is computed per column, not for the group.
    const block = new Set([3, 9, 14, 21, 30, 44]);
    const data = survey(60, 6, block);
    // Same count of 9s as each item, on rows the block never touches.
    data.decoy = Array.from({ length: 60 }, (_, r) => ([1, 7, 17, 25, 36, 50].includes(r) ? 9 : 3 + (r % 3)));
    const hits = scanForCodes(t(data), []);
    expect(entry(hits, 'item_0', 9)?.cooccurrence?.supports).toBe(true);
    const d = entry(hits, 'decoy', 9);
    expect(d?.cooccurrence?.peers).toBe(6);
    expect(d?.cooccurrence?.observedPairs).toBe(0);
    expect(d?.cooccurrence?.supports).toBe(false);
    expect(d?.reasons).not.toContain('co-occurs');
    // Its own shape still argues for it — 9 above a 3-5 range — so it stays
    // listed at exactly the tier it earned alone, neither raised nor lowered.
    expect(d?.confidence).toBe('likely');
  });

  it('reports the pattern for a DECLARED code the detector never flagged', () => {
    // 9 inside an age range is invisible to every per-column rule. Co-occurrence
    // is the only evidence available, in either direction.
    const block = new Set([3, 9, 14, 21, 30, 44]);
    const data = survey(60, 6, block);
    data.age_dk = Array.from({ length: 60 }, (_, r) => (block.has(r) ? 9 : 2 + (r % 11)));
    data.age_real = Array.from({ length: 60 }, (_, r) => 2 + (r % 11));   // real 9s, unrelated rows
    const hits = scanForCodes(t(data), [9]);

    const dk = entry(hits, 'age_dk', 9);
    expect(dk?.confidence).toBeNull();          // never flagged on shape
    expect(dk?.cooccurrence?.supports).toBe(true);
    expect(dk?.suggested).toBe(true);           // ...but the rows say otherwise

    const real = entry(hits, 'age_real', 9);
    expect(real?.cooccurrence?.supports).toBe(false);
    expect(real?.suggested).toBe(false);
  });

  it('says nothing about a code that appears in only one column', () => {
    const table = t({ x: [...rep(1, 20), ...rep(4, 20), ...rep(7, 12), ...rep(9, 8)], y: rep(2, 60) });
    expect(entry(scanForCodes(table, []), 'x', 9)?.cooccurrence).toBeNull();
  });

  it('stays silent on a table too short to judge', () => {
    const table = t({ a: [1, 9, 3], b: [2, 9, 4] });
    const hits = scanForCodes(table, [9]);
    expect(entry(hits, 'a', 9)?.cooccurrence).toBeNull();
    expect(entry(hits, 'a', 9)?.suggested).toBe(false);
  });

  it('survives a ragged table where a column is shorter than nRows', () => {
    const block = new Set([3, 9, 14, 21, 30, 44]);
    const data = survey(60, 3, block);
    data.stub = [9, 9, 9];                      // 3 values, table claims 60 rows
    expect(() => scanForCodes(t(data), [9])).not.toThrow();
  });
});

// Attacks on the co-occurrence statistic itself: ways to make it claim a pattern
// that is not there, or lose one that is.
describe('attacks on the co-occurrence evidence', () => {
  const block = new Set([3, 9, 14, 21, 30, 44]);
  const items = (n: number, nRows = 60) => {
    const data: Record<string, unknown[]> = {};
    for (let c = 0; c < n; c++) {
      data[`item_${c}`] = Array.from({ length: nRows }, (_, r) => (block.has(r) ? 9 : 1 + ((r + c) % 7)));
    }
    return data;
  };

  it('a column that is ENTIRELY the code cannot manufacture support for a decoy', () => {
    // It co-occurs with everything by construction, so a naive observed-pair
    // count would vouch for any column at all. The expectation is built from the
    // same marginal counts, so it rises with it and the lift does not move.
    const data = items(6);
    data.all_nine = rep(9, 60);
    // A 0-10 rating: its 9s are real data, no per-column rule flags them, and
    // co-occurrence is therefore the ONLY thing that could tick its box.
    data.rating = Array.from({ length: 60 }, (_, r) => r % 11);
    const hits = scanForCodes(t(data), [9]);
    const d = entry(hits, 'rating', 9);
    expect(d?.confidence).toBeNull();
    expect(d?.cooccurrence?.supports).toBe(false);
    expect(d?.suggested).toBe(false);
    expect(entry(hits, 'item_0', 9)?.cooccurrence?.supports).toBe(true);
  });

  it('cannot be evaded by a code stored as text', () => {
    // A spreadsheet exported as text gives "9", not 9. The whole point of
    // matching on the coerced number (finding C6) is that this still works.
    const data = items(6);
    for (const c of Object.keys(data)) data[c] = data[c].map(v => String(v));
    const e = entry(scanForCodes(t(data), []), 'item_0', 9);
    expect(e?.count).toBe(6);
    expect(e?.cooccurrence?.supports).toBe(true);
  });

  it('never CREATES a finding — only raises one the column already made', () => {
    // 9 on a 0-10 rating is real data. Six of them landing on the block's rows is
    // a coincidence the detector must not be talked into by its neighbours.
    const data = items(6);
    data.rating = Array.from({ length: 60 }, (_, r) => (block.has(r) ? 9 : r % 9));
    const hits = scanForCodes(t(data), []);
    // Not listed at all without a declaration: co-occurrence is not a finding.
    expect(hits.map(h => h.column)).not.toContain('rating');
  });

  it('never demotes, and never drops the reasons a column already had', () => {
    const data = items(3);
    // -99 in the same rows: already certain, and must stay certain.
    for (const c of ['item_0', 'item_1']) {
      data[c] = (data[c] as number[]).map((v, r) => (r === 2 || r === 5 || r === 11 || r === 19 ? -99 : v));
    }
    const e = entry(scanForCodes(t(data), []), 'item_0', -99);
    expect(e?.confidence).toBe('certain');
    expect(e?.reasons).toContain('impossible-sign');
    expect(e?.reasons).toContain('co-occurs');
  });

  it('is not fooled by two rows of alignment', () => {
    // Below the minimum pair count the lift is arithmetic on tiny numbers: two
    // rows in two columns is one shared pair, which proves nothing.
    const two = new Set([11, 40]);
    const data: Record<string, unknown[]> = {
      a: Array.from({ length: 60 }, (_, r) => (two.has(r) ? 9 : 1 + (r % 7))),
      b: Array.from({ length: 60 }, (_, r) => (two.has(r) ? 9 : 2 + (r % 5))),
    };
    expect(entry(scanForCodes(t(data), []), 'a', 9)?.cooccurrence?.supports).toBe(false);
  });

  it('ignores blanks rather than counting them as agreement', () => {
    const data = items(4);
    // Punch holes everywhere EXCEPT the block rows.
    for (const c of Object.keys(data)) {
      data[c] = (data[c] as number[]).map((v, r) => (block.has(r) ? v : (r % 2 ? null : v)));
    }
    const e = entry(scanForCodes(t(data), []), 'item_0', 9);
    expect(e?.count).toBe(6);
    expect(e?.cooccurrence?.supports).toBe(true);
  });

  it('does not crash or claim anything when a declared code is absent', () => {
    const hits = scanForCodes(t(items(4)), [77]);
    for (const h of hits) expect(h.entries.every(e => e.value !== 77)).toBe(true);
  });
});

describe('describeCodeEntry — the line under each code', () => {
  it('quantifies co-occurrence so a researcher can check it', () => {
    const block = new Set([3, 9, 14, 21, 30, 44]);
    const data: Record<string, unknown[]> = {};
    for (let c = 0; c < 6; c++) {
      data[`item_${c}`] = Array.from({ length: 60 }, (_, r) => (block.has(r) ? 9 : 1 + ((r + c) % 7)));
    }
    const e = entry(scanForCodes(t(data), []), 'item_0', 9)!;
    expect(describeCodeEntry(e)).toContain('same rows as 9 in other columns');
    expect(describeCodeEntry(e)).toMatch(/\(\d[\d.]*× chance\)/);
    // Never a column count: `peers` counts columns that merely HOLD the value.
    expect(describeCodeEntry(e)).not.toMatch(/in \d+ other columns \(/);
  });

  it('warns plainly when a declared code was not flagged here', () => {
    const table = t({ rating: Array.from({ length: 33 }, (_, i) => i % 11) });
    const e = entry(scanForCodes(table, [9]), 'rating', 9)!;
    expect(describeCodeEntry(e)).toBe('declared; the detector did not flag this column');
  });

  it('says so when a declared code sits on rows unrelated to the others', () => {
    // The discrimination the user asked for, in one line: this column has 9s, the
    // battery has 9s, and they are not the same people.
    const block = new Set([3, 9, 14, 21, 30, 44]);
    const data: Record<string, unknown[]> = {};
    for (let c = 0; c < 4; c++) {
      data[`item_${c}`] = Array.from({ length: 60 }, (_, r) => (block.has(r) ? 9 : 1 + ((r + c) % 7)));
    }
    data.child_age = Array.from({ length: 60 }, (_, r) => 2 + (r % 11));   // real 9s
    const e = entry(scanForCodes(t(data), [9]), 'child_age', 9)!;
    expect(describeCodeEntry(e)).toBe('declared; also in 4 other columns, but on unrelated rows');
  });

  it('names the rule for a detector finding', () => {
    const table = t({ x: [...Array(20).fill(3), ...Array(20).fill(5), ...Array(5).fill(-99)] });
    const e = entry(scanForCodes(table, []), 'x', -99)!;
    expect(describeCodeEntry(e)).toContain('never negative');
  });
});

describe('parseDeclaredCodes — an empty box must declare nothing', () => {
  it('returns nothing for an empty string, NOT [0]', () => {
    // Number('') is 0, so the naive version declared 0 a missing-value code and
    // offered to blank every zero in the file. Found in a browser run.
    expect(parseDeclaredCodes('')).toEqual([]);
  });

  it('returns nothing for whitespace or stray separators', () => {
    expect(parseDeclaredCodes('   ')).toEqual([]);
    expect(parseDeclaredCodes(',')).toEqual([]);
    expect(parseDeclaredCodes(', ,  ,')).toEqual([]);
  });

  it('parses a comma list', () => {
    expect(parseDeclaredCodes('9, 99, -99')).toEqual([9, 99, -99]);
  });

  it('parses whitespace and mixed separators, and trailing commas', () => {
    expect(parseDeclaredCodes('9 99')).toEqual([9, 99]);
    expect(parseDeclaredCodes('9,99,')).toEqual([9, 99]);
    expect(parseDeclaredCodes(' 9 , 99 ')).toEqual([9, 99]);
  });

  it('keeps a genuinely typed 0', () => {
    expect(parseDeclaredCodes('0')).toEqual([0]);
    expect(parseDeclaredCodes('0, 9')).toEqual([0, 9]);
  });

  it('drops non-numbers instead of turning them into NaN codes', () => {
    expect(parseDeclaredCodes('9, abc, 99')).toEqual([9, 99]);
    expect(parseDeclaredCodes('abc')).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(parseDeclaredCodes('9, 9, 9')).toEqual([9]);
  });

  it('handles negatives and decimals', () => {
    expect(parseDeclaredCodes('-99, 9.5')).toEqual([-99, 9.5]);
  });
});

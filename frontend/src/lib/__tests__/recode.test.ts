import { describe, it, expect } from 'vitest';
import { applyRecode, describeRecode, scanForCodes, parseDeclaredCodes } from '../recode';
import type { DataTable } from '../table';

// This module CHANGES DATA, which nothing else in the app does on the user's
// behalf. So these tests are written as attacks: try to make it blank the wrong
// cell, mutate the input, lose a row, or misreport what it did.

const t = (data: Record<string, unknown[]>): DataTable => {
  const columns = Object.keys(data);
  return { columns, data, nRows: data[columns[0]].length };
};

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

describe('scanForCodes — which columns hold which codes', () => {
  it('finds a declared code in every column that has it', () => {
    const table = t({ likert_1: [1, 9, 3], child_age: [9, 4, 5], name: ['a', 'b', 'c'] });
    const hits = scanForCodes(table, [9]);
    expect(hits.map(h => h.column)).toEqual(['likert_1', 'child_age']);
    expect(hits[0].counts[9]).toBe(1);
  });

  it('takes a declared code LITERALLY, with no plausibility test', () => {
    // 9 on a 0-10 rating is real data and the detector rightly ignores it —
    // but if the user says 9 is a code, that is their knowledge, not ours.
    const table = t({ rating: Array.from({ length: 33 }, (_, i) => i % 11) });
    expect(scanForCodes(table, []).length).toBe(0);
    const hits = scanForCodes(table, [9]);
    expect(hits.length).toBe(1);
    expect(hits[0].values).toEqual([9]);
    expect(hits[0].detected).toEqual([]);
  });

  it('reports detector findings without any declaration', () => {
    const table = t({ x: [...Array(20).fill(3), ...Array(20).fill(5), ...Array(5).fill(-99)] });
    const hits = scanForCodes(table, []);
    expect(hits[0].detected).toContain(-99);
  });

  it('skips columns with nothing numeric in them', () => {
    const table = t({ notes: ['x', 'y', 'z'] });
    expect(scanForCodes(table, [9])).toEqual([]);
  });

  it('merges declared and detected codes in one column', () => {
    const table = t({ x: [...Array(20).fill(2), ...Array(20).fill(4), ...Array(4).fill(-99), 9, 9] });
    const hits = scanForCodes(table, [9]);
    expect(hits[0].values).toEqual([-99, 9]);
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

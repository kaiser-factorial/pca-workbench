import { describe, it, expect } from 'vitest';
import { parseCSVText, readTable } from '../parse';

// parse.ts had no tests, which is why every silent-data-loss path in the review
// (C1–C3, C7) went unnoticed. These assert the WARNINGS, not just the table:
// the failure mode was never "it crashed", it was "it loaded and looked fine".

const csv = (body: string, name = 'test.csv') =>
  new File([body], name, { type: 'text/csv' });

// parseCSVText is the pure core; readTable adds only extension dispatch and
// File->text, both covered separately below.
const read = async (body: string) => parseCSVText(body);
const warnsAbout = (warnings: string[], fragment: string) =>
  warnings.some(w => w.toLowerCase().includes(fragment.toLowerCase()));

describe('readTable — clean input stays quiet', () => {
  it('parses a well-formed CSV with no warnings', async () => {
    const { table, warnings } = await read('q1,q2,group\n1,2.5,a\n3,4.5,b\n');
    expect(warnings).toEqual([]);
    expect(table.columns).toEqual(['q1', 'q2', 'group']);
    expect(table.nRows).toBe(2);
    expect(table.data.q1).toEqual([1, 3]);
    expect(table.data.group).toEqual(['a', 'b']);
  });

  it('handles BOM, CRLF and quoted delimiters silently', async () => {
    const { table, warnings } = await read('﻿a,b\r\n1,"x,y"\r\n2,"line\nbreak"\r\n');
    expect(warnings).toEqual([]);
    expect(table.columns).toEqual(['a', 'b']);
    expect(table.data.b).toEqual(['x,y', 'line\nbreak']);
  });

  it('auto-detects semicolon and tab delimiters without complaint', async () => {
    for (const body of ['a;b\n1;2\n3;4\n', 'a\tb\n1\t2\n3\t4\n']) {
      const { table, warnings } = await read(body);
      expect(warnings).toEqual([]);
      expect(table.columns).toEqual(['a', 'b']);
      expect(table.data.a).toEqual([1, 3]);
    }
  });
});

describe('readTable — reports what it silently did (finding C1)', () => {
  it('flags rows with too many values, whose extras are discarded', async () => {
    const { warnings } = await read('a,b,c\n1,2,3\n4,5,6,7\n');
    expect(warnsAbout(warnings, 'more values than the header')).toBe(true);
    expect(warnsAbout(warnings, 'discarded')).toBe(true);
  });

  it('flags rows with too few values, whose gaps become blanks', async () => {
    const { table, warnings } = await read('a,b,c\n1,2,3\n4,5\n');
    expect(warnsAbout(warnings, 'fewer values than the header')).toBe(true);
    expect(table.data.c[1]).toBeNull();
  });

  it('flags an unterminated quote, which swallows the rest of the file', async () => {
    const { warnings } = await read('a,b\n"oops,2\n3,4\n5,6\n');
    expect(warnsAbout(warnings, 'unclosed quotation mark')).toBe(true);
  });

  it('flags a Qualtrics-style title row above the header', async () => {
    // The title becomes the only column name and every real row overflows it.
    const { warnings } = await read('My Survey Export\na,b\n1,2\n3,4\n');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnsAbout(warnings, 'more values than the header')).toBe(true);
  });

  it('flags a missing header row, where an observation became the names', async () => {
    const { warnings } = await read('5.1,3.5,1.4\n4.9,3.0,1.4\n');
    expect(warnsAbout(warnings, 'no header row')).toBe(true);
  });

  it('names repeated header cells rather than renaming them silently (C2)', async () => {
    const { table, warnings } = await read('Q1,Q1,Age\n1,2,30\n');
    expect(warnsAbout(warnings, 'repeats')).toBe(true);
    expect(warnsAbout(warnings, '"Q1"')).toBe(true);
    expect(table.columns).toContain('Q1_1'); // PapaParse's rename, now disclosed
  });

  it('does NOT cry duplicate over a genuine Q1 / Q1_1 pair', async () => {
    // Survey exports really do contain both, so the check reads the raw header
    // rather than pattern-matching the renamed result.
    const { warnings } = await read('Q1,Q1_1,Age\n1,2,30\n');
    expect(warnsAbout(warnings, 'repeats')).toBe(false);
  });

  it('flags blank header cells that caused columns to be skipped', async () => {
    const { warnings } = await read('a,,c\n1,2,3\n');
    expect(warnsAbout(warnings, 'blank')).toBe(true);
  });
});

describe('readTable — numeric text that cannot be plotted (finding C3)', () => {
  it('names columns written with decimal commas', async () => {
    const { table, warnings } = await read('q1;q2;age\n1,5;2,5;30\n3,5;4,5;40\n');
    // The data is genuinely unusable as numbers — the point is saying so.
    expect(table.data.q1).toEqual(['1,5', '3,5']);
    expect(warnsAbout(warnings, 'decimal commas')).toBe(true);
    expect(warnsAbout(warnings, '"q1"')).toBe(true);
    expect(warnsAbout(warnings, '"age"')).toBe(false); // age parsed fine
  });

  it('names columns written with thousands separators', async () => {
    const { warnings } = await read('income,age\n"1,234",30\n"2,345",40\n');
    expect(warnsAbout(warnings, 'thousands separators')).toBe(true);
  });

  it('names columns written with percent signs', async () => {
    const { warnings } = await read('rate,age\n12.5%,30\n40%,40\n');
    expect(warnsAbout(warnings, 'percent')).toBe(true);
  });

  it('leaves genuinely categorical text alone', async () => {
    const { warnings } = await read('group,age\nControl,30\nTreatment,40\n');
    expect(warnings).toEqual([]);
  });
});

describe('readTable — dispatch', () => {
  it('rejects unsupported extensions with the supported list', async () => {
    await expect(readTable(csv('a,b\n1,2\n', 'data.txt'))).rejects.toThrow(/\.csv/);
  });

  it('is case-insensitive about the extension, and reads the File', async () => {
    const { table } = await readTable(csv('a,b\n1,2\n', 'DATA.CSV'));
    expect(table.nRows).toBe(1);
    expect(table.data.a).toEqual([1]);
  });

  it('rejects input with no usable header', () => {
    expect(() => parseCSVText('\n\n')).toThrow(/No columns found/);
  });
});

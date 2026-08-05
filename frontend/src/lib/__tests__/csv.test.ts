import { describe, it, expect } from 'vitest';
import { CSV_BOM, csvCell } from '../csv';
import { readTable, MAX_FILE_BYTES, LARGE_FILE_BYTES } from '../parse';

describe('CSV export encoding (finding C12)', () => {
  it('quotes only what needs quoting, per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('has"quote')).toBe('"has""quote"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('defuses text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('-cmd|calc')).toBe("'-cmd|calc");
  });

  it('leaves negative numbers alone, which is why the guard is number-aware', () => {
    // PC scores, z-scores and correlations are negative constantly. Escaping
    // them to defend against formulas would corrupt the common case.
    expect(csvCell(-3.5)).toBe('-3.5');
    expect(csvCell('-3.5')).toBe('-3.5');
    expect(csvCell('-0.0001')).toBe('-0.0001');
    expect(csvCell('-1e-9')).toBe('-1e-9');
    expect(csvCell(0)).toBe('0');
    expect(csvCell('+42')).toBe('+42');
  });

  it('has a BOM so Excel reads non-ASCII correctly', () => {
    expect(CSV_BOM).toBe('﻿');
    expect(CSV_BOM.length).toBe(1);
  });

  it('round-trips a value that is both numeric-looking and quoted-needing', () => {
    expect(csvCell('1,234')).toBe('"1,234"');   // not numeric to Number(), so quoted
  });
});

describe('file size guard (finding C9)', () => {
  // A File whose size we control without allocating the bytes.
  const sized = (bytes: number, name = 'big.csv') => {
    const f = new File(['a,b\n1,2\n'], name, { type: 'text/csv' });
    Object.defineProperty(f, 'size', { value: bytes });
    return f;
  };

  it('refuses a file past the hard limit, and says why and by how much', async () => {
    await expect(readTable(sized(MAX_FILE_BYTES + 1))).rejects.toThrow(/over the .* limit/);
    await expect(readTable(sized(MAX_FILE_BYTES + 1))).rejects.toThrow(/runs in the browser tab/);
  });

  it('checks size before file type, so the message is the useful one', async () => {
    await expect(readTable(sized(MAX_FILE_BYTES + 1, 'huge.docx'))).rejects.toThrow(/limit/);
  });

  it('warns about a large-but-allowed file instead of refusing it', async () => {
    const { table, warnings } = await readTable(sized(LARGE_FILE_BYTES + 1));
    expect(table.nRows).toBe(1);                      // still parsed
    expect(warnings.some(w => /noticeably slower/.test(w))).toBe(true);
  });

  it('stays quiet about an ordinary file', async () => {
    const { warnings } = await readTable(sized(1000));
    expect(warnings).toEqual([]);
  });
});

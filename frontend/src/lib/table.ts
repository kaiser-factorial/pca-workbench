// Columnar table shared across the app: one array per column.
// Cells are number | string | null — null covers empty, NaN, and ±Infinity,
// mirroring how the old pandas backend serialized missing values.
export type DataTable = { columns: string[]; data: Record<string, any[]>; nRows: number };

export const sanitizeCell = (v: any): number | string | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Rows-of-objects (as parsers emit) → columnar table
export const rowsToTable = (rows: Record<string, any>[], columns: string[]): DataTable => {
  const data: Record<string, any[]> = {};
  for (const c of columns) data[c] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    for (const c of columns) data[c][i] = sanitizeCell(rows[i][c]);
  }
  return { columns, data, nRows: rows.length };
};

export const numericValues = (vals: any[]): number[] =>
  vals.filter((v): v is number => typeof v === 'number');

export const median = (vals: number[]): number => {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

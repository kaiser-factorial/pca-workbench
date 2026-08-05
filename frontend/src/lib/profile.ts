import { asNumber, type DataTable } from './table';

// One scan of a table's columns, shared by everything that needs to know what a
// column contains (finding F14).
//
// The same pass was written three times — the Variables panel, the PCA variable
// list, and the cluster-breakdown candidates — all in render, all recomputed on
// every table change, and measured at 35 ms per pass on 10k × 30, 839 ms on
// 50k × 200. They had also drifted: two decided "numeric" with `typeof v ===
// 'number'` while `numericColumns` had moved to `asNumber` for C6, so a
// text-formatted column was offered as a PCA variable and simultaneously
// displayed as a category list.
//
// Cached in a WeakMap keyed by the table. That is safe because of an invariant
// this codebase already holds deliberately: tables are replaced wholesale and
// never mutated in place. A new table is a new key; the old entry becomes
// garbage with the table it described. No invalidation to get wrong.

export const CONTINUOUS_UNIQUE_THRESHOLD = 20;
export const MAX_CATEGORIES = 50;

export type ColumnScan = {
  col: string;
  missing: number;
  /** True when the column holds at least one value usable as a number (C6). */
  isNumeric: boolean;
  min: number;
  max: number;
  nUnique: number;
  /** How a colour channel should treat it. */
  kind: 'categorical' | 'continuous' | 'too-many';
};

const cache = new WeakMap<DataTable, ColumnScan[]>();

const scanColumn = (col: string, vals: unknown[]): ColumnScan => {
  let missing = 0, isNumeric = false, min = Infinity, max = -Infinity;
  let allNumeric = true;
  const distinct = new Set<unknown>();
  for (const v of vals) {
    if (v == null) { missing++; continue; }
    const num = asNumber(v);
    if (num !== null) {
      isNumeric = true;
      if (num < min) min = num;
      if (num > max) max = num;
    }
    // `kind` follows the raw cell type, not asNumber: a column of numeric
    // STRINGS is a set of labels as far as colouring is concerned, and treating
    // it as continuous would hand Plotly a colourscale over category codes.
    if (typeof v !== 'number') allNumeric = false;
    distinct.add(v);
  }
  const kind: ColumnScan['kind'] =
    allNumeric && distinct.size > CONTINUOUS_UNIQUE_THRESHOLD ? 'continuous'
    : !allNumeric && distinct.size > MAX_CATEGORIES ? 'too-many'
    : 'categorical';
  return { col, missing, isNumeric, min, max, nUnique: distinct.size, kind };
};

/** Every column's scan, computed once per table. */
export const scanTable = (table: DataTable): ColumnScan[] => {
  const hit = cache.get(table);
  if (hit) return hit;
  const scans = table.columns.map(col => scanColumn(col, table.data[col] ?? []));
  cache.set(table, scans);
  return scans;
};

/** Columns usable as a numeric axis or PCA variable. */
export const numericColumnsOf = (table: DataTable): string[] =>
  scanTable(table).filter(s => s.isNumeric).map(s => s.col);

/** Columns usable as a categorical breakdown. */
export const categoricalColumnsOf = (table: DataTable): string[] =>
  scanTable(table).filter(s => s.kind === 'categorical').map(s => s.col);

// SheetJS runs HERE and nowhere else.
//
// XLSX is a zip of XML parsed by a large third-party library, fed a file the
// user was handed by someone else. SheetJS 0.18.5 carried a prototype-pollution
// advisory (GHSA-4r6h-8v6p-xvw6, CVSS 7.8) that this app is on the exposed side
// of: the assistant keeps an API key and a base URL in localStorage, so anything
// that can corrupt Object.prototype in the page realm can reach the request
// options the key is attached to. We are on 0.20.3, which fixes it — but a
// format this complex will produce another one, and because SheetJS publishes
// off the npm registry, `npm audit` will not be the thing that tells us.
//
// A worker realm has no DOM and no localStorage, so pollution here corrupts
// nothing worth stealing, and the realm is discarded when the worker is
// terminated after the parse. What crosses back is structured-cloned plain
// data: own properties are copied as own properties, so a poisoned prototype
// does not travel with it.
//
// The rule this file exists to enforce: nothing that imports `xlsx` may also be
// reachable from the page. Keep this module free of app imports.

import * as XLSX from 'xlsx';

/** One entry per sheet, so the page can offer a choice without re-parsing. */
export type SheetInfo = {
  name: string;
  /** Data rows, excluding the header row. Zero means nothing to read. */
  rows: number;
  columns: number;
};

/** Everything the page needs from a workbook, as plain cloneable values. */
export type WorkbookExtract = {
  sheetNames: string[];
  sheets: SheetInfo[];
  /** The sheet that was actually read. */
  sheetName: string;
  /** True when sheetName was chosen for the user rather than asked for. */
  autoSelected: boolean;
  rows: Record<string, unknown>[];
  columns: string[];
};

export type XlsxRequest = {
  buffer: ArrayBuffer;
  /** Read this sheet instead of the automatic choice. */
  sheet?: string;
  /** Return sheet metadata only — used to populate the picker cheaply. */
  namesOnly?: boolean;
};
export type XlsxResponse =
  | { ok: true; extract: WorkbookExtract }
  | { ok: false; error: string };

// Sheet dimensions come from the stored range rather than from converting the
// sheet, so listing a 12-sheet workbook costs almost nothing.
const describe = (wb: XLSX.WorkBook, name: string): SheetInfo => {
  const ref = wb.Sheets[name]?.['!ref'];
  if (!ref) return { name, rows: 0, columns: 0 };
  const r = XLSX.utils.decode_range(ref);
  return {
    name,
    // The first row is the header, so it is not a data row.
    rows: Math.max(0, r.e.r - r.s.r),
    columns: Math.max(0, r.e.c - r.s.c + 1),
  };
};

const extract = ({ buffer, sheet: wanted, namesOnly }: XlsxRequest): WorkbookExtract => {
  // cellDates: without it a date cell arrives as the Excel serial number (46024)
  // — a plottable, PCA-able "measurement" with nothing marking it as a date.
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  if (!wb.SheetNames.length) throw new Error('Workbook has no sheets');
  const sheets = wb.SheetNames.map(n => describe(wb, n));

  // Reading sheet 1 unconditionally breaks on the very common Readme-then-Data
  // workbook, where the app reported "first sheet is empty" and stopped. Prefer
  // an explicit request, then the first sheet that actually holds data.
  const requested = wanted && wb.SheetNames.includes(wanted) ? wanted : undefined;
  const sheetName = requested ?? (sheets.find(s => s.rows > 0 && s.columns > 0)?.name ?? wb.SheetNames[0]);

  const base = {
    sheetNames: wb.SheetNames,
    sheets,
    sheetName,
    autoSelected: !requested,
  };
  if (namesOnly) return { ...base, rows: [], columns: [] };

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
  return {
    ...base,
    rows,
    // Keys come from the first row, matching sheet_to_json's own header handling.
    columns: Object.keys(rows[0] ?? {}),
  };
};

self.onmessage = (e: MessageEvent<XlsxRequest>) => {
  let res: XlsxResponse;
  try {
    res = { ok: true, extract: extract(e.data) };
  } catch (err) {
    // Error objects do not structured-clone usefully across realms; send text.
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};

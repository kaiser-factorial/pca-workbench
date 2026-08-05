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

/** Everything the page needs from a workbook, as plain cloneable values. */
export type WorkbookExtract = {
  sheetNames: string[];
  /** The sheet that was read — always the first one. */
  sheetName: string;
  rows: Record<string, unknown>[];
  columns: string[];
};

export type XlsxRequest = { buffer: ArrayBuffer };
export type XlsxResponse =
  | { ok: true; extract: WorkbookExtract }
  | { ok: false; error: string };

const extract = (buffer: ArrayBuffer): WorkbookExtract => {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error('Workbook has no sheets');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  return {
    sheetNames: wb.SheetNames,
    sheetName,
    rows,
    // Keys come from the first row, matching sheet_to_json's own header handling.
    columns: Object.keys(rows[0] ?? {}),
  };
};

self.onmessage = (e: MessageEvent<XlsxRequest>) => {
  let res: XlsxResponse;
  try {
    res = { ok: true, extract: extract(e.data.buffer) };
  } catch (err) {
    // Error objects do not structured-clone usefully across realms; send text.
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};

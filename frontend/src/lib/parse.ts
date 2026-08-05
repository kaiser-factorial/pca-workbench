import Papa from 'papaparse';
import { DataTable, asNumber, rowsToTable, sanitizeCell } from './table';
import { detectSentinels, describeSentinels } from './sentinels';
// Types only — importing the worker module for its values would pull SheetJS
// back into the page bundle and undo the isolation it exists to provide.
import type { SheetInfo, WorkbookExtract, XlsxRequest, XlsxResponse } from './xlsx.worker';

export type { SheetInfo };

export const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.parquet'];

// Nothing bounded input size, and parsing a CSV still happens on the main
// thread, so a large file froze the tab on "Processing…" with no explanation
// and no way to cancel (finding C9).
//
// The hard limit is set where the browser would fail anyway: the whole table is
// held in memory as columnar arrays, and a text file becomes several times its
// own size as JS values, so a quarter-gigabyte input is already past what a tab
// can hold alongside a WebGL plot. Refusing with a number beats an OOM crash
// that looks like a bug in the app.
export const MAX_FILE_BYTES = 250 * 1024 * 1024;
// Below the hard limit but big enough that the wait needs explaining.
export const LARGE_FILE_BYTES = 25 * 1024 * 1024;

const formatBytes = (b: number) =>
  b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.round(b / 1024 / 1024)} MB`;

// Parsers report what they silently did to the file alongside the table.
// PapaParse hands back a res.errors array describing ragged rows, unterminated
// quotes and undetectable delimiters; ignoring it meant a malformed CSV loaded
// as a plausible-looking table with rows quietly dropped or nulled. Anything
// that changes what the user's data means belongs in here.
export type ParsedTable = { table: DataTable; warnings: string[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listRows = (rowIdx: number[]) => {
  // PapaParse row indices are 0-based over data rows; +2 to name the file line
  const lines = rowIdx.slice(0, 3).map(r => r + 2);
  return lines.join(', ') + (rowIdx.length > 3 ? `, …` : '');
};

// A column that arrived entirely as strings may be numbers written in a format
// dynamicTyping does not recognise. Worth naming precisely, because the
// downstream symptom ("needs at least two numeric columns") points elsewhere.
// Order matters: "1,234" satisfies both readings, so the stricter grouped form
// (exactly three digits after each comma) is tested first.
const NUMERIC_TEXT_PATTERNS: { test: RegExp; label: string; hint: string }[] = [
  {
    test: /^-?\d{1,3}(,\d{3})+(\.\d+)?$/,
    label: 'thousands separators',
    hint: 'Remove the thousands separators so the values parse as numbers.',
  },
  {
    test: /^-?\d+,\d+$/,
    label: 'decimal commas',
    hint: 'Save the file with a period as the decimal separator, or convert those columns before uploading.',
  },
  {
    test: /^-?[\d.]+\s*%$/,
    label: 'percent signs',
    hint: 'Strip the % and store the value as a number.',
  },
];

const numericTextWarnings = (table: DataTable): string[] => {
  const found = new Map<string, string[]>();
  for (const col of table.columns) {
    const vals = (table.data[col] ?? []).filter(v => v != null);
    if (!vals.length || vals.some(v => typeof v === 'number')) continue;
    for (const { test, label } of NUMERIC_TEXT_PATTERNS) {
      const hits = vals.filter(v => typeof v === 'string' && test.test(v.trim())).length;
      if (hits / vals.length >= 0.8) {
        if (!found.has(label)) found.set(label, []);
        found.get(label)!.push(col);
        break;
      }
    }
  }
  return Array.from(found.entries()).map(([label, cols]) => {
    const hint = NUMERIC_TEXT_PATTERNS.find(p => p.label === label)!.hint;
    return `${cols.length === 1 ? 'Column' : 'Columns'} ${cols.map(c => `"${c}"`).join(', ')} look${cols.length === 1 ? 's' : ''} like numbers written with ${label}, so ${cols.length === 1 ? 'it was' : 'they were'} read as text and cannot be plotted. ${hint}`;
  });
};

// All-numeric header names almost always mean the file has no header row, in
// which case the first observation has been consumed as column names.
const looksHeaderless = (columns: string[]) =>
  columns.length >= 2 && columns.every(c => c.trim() !== '' && Number.isFinite(Number(c)));

// Exported for tests: all the warning logic is pure, and keeping it separate
// from File plumbing means it can be exercised on a string. (PapaParse reaches
// for FileReaderSync when handed a File, which only exists in a Worker.)
//
// Reading the file to text first costs nothing: with no `chunk`/`step` config
// PapaParse's own FileReader path already materialises the whole file as a
// single string before parsing, so peak memory is unchanged.
export const parseCSVText = (text: string): ParsedTable => {
  const res = Papa.parse<Record<string, any>>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: 'greedy',
  });

  const fields = res.meta.fields ?? [];
  const columns = fields.filter(c => c != null && c !== '');
  if (!columns.length) throw new Error('No columns found — is the first row a header?');

  const warnings: string[] = [];

  // Quote damage swallows everything after it, so say so before the user
  // wonders why the file lost 4,000 rows.
  const quoteErrors = res.errors.filter(e => e.type === 'Quotes');
  if (quoteErrors.length) {
    warnings.push(`Unclosed quotation mark near line ${(quoteErrors[0].row ?? 0) + 2}. Everything after it was read as a single value, so most of the file was probably not parsed. Check the quoting around that line.`);
  }

  // Ragged rows: extra cells are dropped (they land outside meta.fields),
  // missing cells become nulls. Both change the data silently.
  const tooMany = res.errors.filter(e => e.code === 'TooManyFields');
  const tooFew = res.errors.filter(e => e.code === 'TooFewFields');
  if (tooMany.length) {
    warnings.push(`${plural(tooMany.length, 'row')} had more values than the header has columns (line ${listRows(tooMany.map(e => e.row ?? 0))}); the extra values were discarded. This usually means an unquoted delimiter inside a value, or a title line above the header.`);
  }
  if (tooFew.length) {
    warnings.push(`${plural(tooFew.length, 'row')} had fewer values than the header has columns (line ${listRows(tooFew.map(e => e.row ?? 0))}); the missing values were read as blank.`);
  }

  if (res.errors.some(e => e.code === 'UndetectableDelimiter') && columns.length === 1) {
    warnings.push(`Only one column was found and the delimiter could not be detected. If this file is not single-column, it may use an unusual separator.`);
  }

  const dropped = fields.length - columns.length;
  if (dropped > 0) {
    warnings.push(`${plural(dropped, 'header cell was', 'header cells were')} blank, so ${dropped === 1 ? 'that column' : 'those columns'} ${dropped === 1 ? 'was' : 'were'} skipped.`);
  }

  // PapaParse reports its own renames, which is exactly what we need and is
  // reliable in a way that pattern-matching the result is not: a column
  // genuinely called "Q1_1" alongside "Q1" is ordinary in survey exports.
  // meta.renamedHeaders maps newName -> originalName.
  const renamed = Object.entries(res.meta.renamedHeaders ?? {});
  if (renamed.length) {
    warnings.push(`The header repeats ${Array.from(new Set(renamed.map(([, orig]) => `"${orig}"`))).join(', ')}. Repeated names were renamed (${renamed.map(([now, orig]) => `"${orig}" → "${now}"`).join(', ')}), so some columns are not named as they are in the file.`);
  }

  if (looksHeaderless(columns)) {
    warnings.push(`Every column name is a number (${columns.slice(0, 4).join(', ')}${columns.length > 4 ? ', …' : ''}), which usually means the file has no header row — in which case the first observation was used as the column names and is missing from the data.`);
  }

  const table = rowsToTable(res.data, columns);
  return { table, warnings: [...warnings, ...numericTextWarnings(table)] };
};

const parseCSV = async (file: File): Promise<ParsedTable> => parseCSVText(await file.text());

// C0 control characters, DEL, and the Unicode replacement character. None of
// these occur in a header a human typed, in any script — so they are the
// signature of bytes being read as text that were never text. Tab, newline and
// carriage return are deliberately excluded: Excel puts them in wrapped headers.
const BINARY_JUNK = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]/;

// Everything below operates on the plain data the worker sends back, never on
// SheetJS objects — see xlsx.worker.ts for why that boundary exists. Split out
// as a pure function for the same reason parseCSVText is: the warnings are the
// part worth testing, and they should not need a Worker to exercise.
export const xlsxExtractToTable = (
  { sheetNames, sheetName, autoSelected, rows, columns: rawColumns }: WorkbookExtract,
): ParsedTable => {
  let columns = rawColumns;
  // SheetJS does not throw on a file that is not a spreadsheet: handed random
  // bytes it returns a plausible-looking workbook whose headers are binary
  // garbage. The failure then surfaced downstream as "needs at least two
  // numeric columns", which sends the user to check their data when the real
  // problem is that the file is corrupt, truncated, or not an XLSX at all.
  const junk = columns.filter(c => BINARY_JUNK.test(c));
  if (junk.length && junk.length >= columns.length / 2) {
    throw new Error(
      `"${sheetName}" does not contain readable spreadsheet data — most of its column names are binary rather than text. The file is probably corrupt, incompletely downloaded, or not really an XLSX. Try re-exporting it, or save it as CSV.`
    );
  }

  // A header cell holding an empty string (rather than being truly blank, which
  // SheetJS names __EMPTY) becomes a column called "". The CSV path has always
  // dropped those; the XLSX path kept them, producing an unnamed, unselectable
  // column in the Variables list (C8).
  const blankNamed = columns.filter(c => c.trim() === '');
  columns = columns.filter(c => c.trim() !== '');

  if (!columns.length) {
    // Naming the other sheets matters: a Readme-then-Data workbook is common,
    // and "This sheet is empty" alone sends the user looking in the wrong place.
    const others = sheetNames.filter(s => s !== sheetName);
    throw new Error(
      `Sheet "${sheetName}" is empty.${others.length ? ` This workbook also contains ${others.map(s => `"${s}"`).join(', ')} — pick one of those from the Sheet list, or save it as its own file.` : ''}`
    );
  }

  const warnings: string[] = [];
  if (sheetNames.length > 1) {
    // Say WHY this sheet, not just which: silently skipping past an empty first
    // sheet is helpful, and is exactly the kind of help that should be visible.
    const skipped = autoSelected && sheetName !== sheetNames[0];
    const lead = skipped
      ? `"${sheetNames[0]}" has no data rows, so "${sheetName}" was read instead`
      : `Only the "${sheetName}" sheet was read`;
    // Don't re-list a sheet the sentence has already named.
    const named = new Set([sheetName, ...(skipped ? [sheetNames[0]] : [])]);
    const others = sheetNames.filter(s => !named.has(s));
    warnings.push(
      `${lead}.${others.length ? ` This workbook also contains ${others.map(s => `"${s}"`).join(', ')}.` : ''} Use the Sheet list to read a different one.`,
    );
  }
  // Below the refusal threshold, say it rather than silently keeping a column
  // the user cannot match to anything in their sheet.
  if (junk.length) {
    warnings.push(`${plural(junk.length, 'column name')} contains characters that are not readable text, which usually means the header row was misread. Check that the columns line up with your sheet.`);
  }
  if (blankNamed.length) {
    warnings.push(`${plural(blankNamed.length, 'header cell was', 'header cells were')} blank, so ${blankNamed.length === 1 ? 'that column' : 'those columns'} ${blankNamed.length === 1 ? 'was' : 'were'} skipped.`);
  }
  // SheetJS invents __EMPTY / __EMPTY_1 keys for header cells that are blank,
  // which is the signature of a title line sitting above the real header.
  const empties = columns.filter(c => /^__EMPTY(_\d+)?$/.test(c));
  if (empties.length) {
    warnings.push(`${plural(empties.length, 'column')} had no header cell and ${empties.length === 1 ? 'was' : 'were'} named ${empties.slice(0, 3).map(c => `"${c}"`).join(', ')}. If the sheet has a title row above the header, the first data row is being used as the column names.`);
  }

  // Date cells survive the worker boundary as Date objects (structured clone
  // preserves them), and rowsToTable is about to render them as ISO strings —
  // so this is the last point at which they are identifiable. Worth saying:
  // reading them as text is a deliberate choice with a real cost, since a date
  // column can no longer go on an axis.
  const dateColumns = columns.filter(c => rows.some(r => r[c] instanceof Date));
  if (dateColumns.length) {
    warnings.push(`${dateColumns.length === 1 ? 'Column' : 'Columns'} ${dateColumns.slice(0, 3).map(c => `"${c}"`).join(', ')}${dateColumns.length > 3 ? ', …' : ''} ${dateColumns.length === 1 ? 'holds dates, which were' : 'hold dates, which were'} read as text (ISO 8601) rather than numbers, so ${dateColumns.length === 1 ? 'it cannot' : 'they cannot'} be plotted on an axis or entered into a PCA. Convert to a number — days since a start date, for instance — if you need to analyse by time.`);
  }

  const table = rowsToTable(rows, columns);
  return { table, warnings: [...warnings, ...numericTextWarnings(table)] };
};

// Parse the workbook in a worker and terminate it, so SheetJS never executes in
// the realm holding the assistant's API key. There is deliberately NO
// main-thread fallback: a silent one would drop the isolation exactly when the
// environment is unusual, which is the wrong direction to fail. Workers are more
// widely supported than the WebGL this app already requires, so a browser that
// cannot run one cannot run the app either.
const runXlsxWorker = async (file: File, req: Omit<XlsxRequest, 'buffer'>): Promise<WorkbookExtract> => {
  if (typeof Worker === 'undefined') {
    throw new Error('This browser cannot read XLSX files (no Web Worker support). Save the sheet as CSV instead.');
  }
  const worker = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module' });
  try {
    const buffer = await file.arrayBuffer();
    const res = await new Promise<XlsxResponse>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<XlsxResponse>) => resolve(e.data);
      // A worker that dies mid-parse resolves nothing; without this the caller
      // waits forever on a spinner rather than seeing the failure.
      worker.onerror = (e) => reject(new Error(e.message || 'The XLSX reader crashed.'));
      worker.onmessageerror = () => reject(new Error('The XLSX reader returned data that could not be read.'));
      worker.postMessage({ ...req, buffer } satisfies XlsxRequest, [buffer]);
    });
    if (!res.ok) throw new Error(res.error);
    return res.extract;
  } finally {
    worker.terminate();
  }
};

const parseXLSX = async (file: File, sheet?: string): Promise<ParsedTable> =>
  xlsxExtractToTable(await runXlsxWorker(file, { sheet }));

/**
 * Sheet names and sizes without converting any of them, for the picker. Costs
 * one workbook read; the dimensions come from each sheet's stored range.
 * Returns [] for anything that is not a workbook, so callers need no branch.
 */
export const listSheets = async (file: File): Promise<SheetInfo[]> => {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return [];
  try {
    return (await runXlsxWorker(file, { namesOnly: true })).sheets;
  } catch {
    // A corrupt file still has to reach the user through the normal parse path,
    // where the error message is specific. Failing the peek silently avoids
    // reporting it twice, in two different voices.
    return [];
  }
};

const parseParquet = async (file: File): Promise<ParsedTable> => {
  const { parquetReadObjects } = await import('hyparquet');
  const rows = await parquetReadObjects({ file: await file.arrayBuffer() });
  if (!rows.length) throw new Error('Parquet file has no rows');
  const columns = Object.keys(rows[0]);
  // Straight to rowsToTable, which sanitizes every cell anyway. The mapped copy
  // this replaces kept the original rows, a second full set of row objects and
  // the columnar result all alive at peak — measured +314 MB for the copy alone
  // — and ran sanitizeCell twice per cell (F20). BigInt now lives in
  // sanitizeCell, so nothing is lost by removing the pass.
  return { table: rowsToTable(rows, columns), warnings: [] };
};

export const readTable = async (file: File, opts: { sheet?: string } = {}): Promise<ParsedTable> => {
  const name = file.name.toLowerCase();
  // Size is checked before the extension so an oversized file gets the useful
  // message rather than a complaint about its suffix.
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)}, over the ${formatBytes(MAX_FILE_BYTES)} limit. Everything here runs in the browser tab, which cannot hold a table that size alongside the plot. Filter or subsample the file first, or split it by group.`,
    );
  }

  const read = async (): Promise<ParsedTable> => {
    if (name.endsWith('.csv')) return parseCSV(file);
    if (name.endsWith('.xlsx')) return parseXLSX(file, opts.sheet);
    if (name.endsWith('.parquet')) return parseParquet(file);
    throw new Error(`Unsupported file type — use one of: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  };

  const parsed = await read();

  // Applied here rather than per-format, so CSV, XLSX and Parquet all get it —
  // an SPSS export is as likely to arrive as a saved .xlsx as a .csv (A14).
  const sentinelNotes = parsed.table.columns
    .map(c => describeSentinels(c, detectSentinels((parsed.table.data[c] ?? []).map(asNumber))))
    .filter((w): w is string => w !== null);
  if (sentinelNotes.length) parsed.warnings.push(...sentinelNotes);
  // Said afterwards on purpose: it explains a wait the user has just sat
  // through, and warns them off the interactions that will be slow next.
  if (file.size > LARGE_FILE_BYTES) {
    return {
      ...parsed,
      warnings: [
        ...parsed.warnings,
        `This file is ${formatBytes(file.size)}. Everything runs in the browser, so rotating, clustering and the k/eps diagnostics will be noticeably slower than usual, and the tab may stop responding while they run.`,
      ],
    };
  }
  return parsed;
};

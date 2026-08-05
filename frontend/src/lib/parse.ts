import Papa from 'papaparse';
import { DataTable, rowsToTable, sanitizeCell } from './table';

export const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.parquet'];

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

const parseXLSX = async (file: File): Promise<ParsedTable> => {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error('Workbook has no sheets');
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
  const columns = Object.keys(rows[0] ?? {});
  if (!columns.length) {
    // Naming the other sheets matters: a Readme-then-Data workbook is common,
    // and "First sheet is empty" alone sends the user looking in the wrong place.
    const others = wb.SheetNames.slice(1);
    throw new Error(
      `Sheet "${sheetName}" is empty.${others.length ? ` This workbook also contains ${others.map(s => `"${s}"`).join(', ')} — only the first sheet is read, so move the data there or save it as its own file.` : ''}`
    );
  }

  const warnings: string[] = [];
  if (wb.SheetNames.length > 1) {
    warnings.push(`Only the first sheet ("${sheetName}") was read. This workbook also contains ${wb.SheetNames.slice(1).map(s => `"${s}"`).join(', ')}.`);
  }
  // SheetJS invents __EMPTY / __EMPTY_1 keys for header cells that are blank,
  // which is the signature of a title line sitting above the real header.
  const empties = columns.filter(c => /^__EMPTY(_\d+)?$/.test(c));
  if (empties.length) {
    warnings.push(`${plural(empties.length, 'column')} had no header cell and ${empties.length === 1 ? 'was' : 'were'} named ${empties.slice(0, 3).map(c => `"${c}"`).join(', ')}. If the sheet has a title row above the header, the first data row is being used as the column names.`);
  }

  const table = rowsToTable(rows, columns);
  return { table, warnings: [...warnings, ...numericTextWarnings(table)] };
};

const parseParquet = async (file: File): Promise<ParsedTable> => {
  const { parquetReadObjects } = await import('hyparquet');
  const rows = await parquetReadObjects({ file: await file.arrayBuffer() });
  if (!rows.length) throw new Error('Parquet file has no rows');
  const columns = Object.keys(rows[0]);
  // hyparquet may hand back BigInt for int64 columns — downcast for plotting
  const fixed = rows.map(r => {
    const o: Record<string, any> = {};
    for (const c of columns) o[c] = typeof r[c] === 'bigint' ? Number(r[c]) : sanitizeCell(r[c]);
    return o;
  });
  return { table: rowsToTable(fixed, columns), warnings: [] };
};

export const readTable = async (file: File): Promise<ParsedTable> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseCSV(file);
  if (name.endsWith('.xlsx')) return parseXLSX(file);
  if (name.endsWith('.parquet')) return parseParquet(file);
  throw new Error(`Unsupported file type — use one of: ${SUPPORTED_EXTENSIONS.join(', ')}`);
};

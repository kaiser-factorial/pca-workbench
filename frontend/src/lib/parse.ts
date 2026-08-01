import Papa from 'papaparse';
import { DataTable, rowsToTable, sanitizeCell } from './table';

export const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.parquet'];

const parseCSV = (file: File): Promise<DataTable> =>
  new Promise((resolve, reject) => {
    Papa.parse<Record<string, any>>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: 'greedy',
      complete: res => {
        const columns = (res.meta.fields ?? []).filter(c => c != null && c !== '');
        if (!columns.length) return reject(new Error('No columns found — is the first row a header?'));
        resolve(rowsToTable(res.data, columns));
      },
      error: err => reject(err),
    });
  });

const parseXLSX = async (file: File): Promise<DataTable> => {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Workbook has no sheets');
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
  const columns = Object.keys(rows[0] ?? {});
  if (!columns.length) throw new Error('First sheet is empty');
  return rowsToTable(rows, columns);
};

const parseParquet = async (file: File): Promise<DataTable> => {
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
  return rowsToTable(fixed, columns);
};

export const readTable = async (file: File): Promise<DataTable> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseCSV(file);
  if (name.endsWith('.xlsx')) return parseXLSX(file);
  if (name.endsWith('.parquet')) return parseParquet(file);
  throw new Error(`Unsupported file type — use one of: ${SUPPORTED_EXTENSIONS.join(', ')}`);
};

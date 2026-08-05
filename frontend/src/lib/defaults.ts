import { isNumericColumn, type DataTable } from './table';

export type DefaultAxes = { x: string; y: string; z: string | null };

// Match unambiguous identifier conventions without guessing from uniqueness:
// measurements can quite reasonably be unique in a small dataset.
export const isIdentifierColumn = (name: string) => {
  const trimmed = name.trim();
  return /^(?:id|uuid|guid)$/i.test(trimmed)
    || /(?:[_\-\s]id)$/i.test(trimmed)
    || /ID$/.test(trimmed);
};

/**
 * Does listing this column's values amount to listing rows?
 *
 * The app's privacy contract is that the assistant sees aggregates, never rows,
 * and the column profile it sends carries each categorical column's most
 * frequent values. On a genuine category ("Species": setosa/versicolor/…) those
 * eight strings ARE the aggregate and are exactly what makes the assistant
 * useful. On an email address, a free-text response or a participant name, every
 * value is unique, so the "top eight by frequency" are eight arbitrary rows with
 * a count of 1 — row-level data, leaving the browser, in the one case where it
 * matters most (finding D8).
 *
 * Name-based identification (`isIdentifierColumn`) is not enough on its own: a
 * column called `email` or `notes` matches no naming convention. Cardinality is
 * the reliable signal — if nearly every row has its own value, the values are
 * not categories.
 */
export const valuesAreRowLevel = (nUnique: number, nRows: number): boolean => {
  if (nRows === 0) return false;
  // Enough distinct values that the list is a sample of rows rather than a set
  // of levels. Both conditions matter: the ratio catches a 200-row file with 200
  // values, the cap catches a 50,000-row file with 4,000.
  return nUnique > 50 || nUnique > nRows / 2;
};

const uniqueNonNull = (values: any[]) =>
  Array.from(new Set(values.filter(v => v != null)));

// The table normalizer represents booleans as 0/1, so this intentionally also
// treats binary 0/1 flags as boolean-like for automatic colour selection.
export const isBooleanLike = (values: any[]) => {
  const valuesPresent = uniqueNonNull(values);
  return valuesPresent.length > 0 && valuesPresent.every(v =>
    v === 0 || v === 1 || v === true || v === false || v === 'true' || v === 'false'
  );
};

const numericColumns = (table: DataTable) =>
  table.columns.filter(c => isNumericColumn(table.data[c] ?? []));

// PC columns (from a components run) win. Otherwise, avoid identifiers when
// there are at least two measured variables to form a meaningful plot.
export const pickDefaultAxes = (table: DataTable): DefaultAxes => {
  // Take whichever PCs exist rather than demanding all three: since C10 stopped
  // zero-padding, a two-component components file legitimately yields PC1/PC2
  // only, and requiring PC3 sent those datasets down the raw-variable path.
  const pcs = ['PC1', 'PC2', 'PC3'].filter(c => table.columns.includes(c));
  if (pcs.length >= 2) {
    return { x: pcs[0], y: pcs[1], z: pcs[2] ?? null };
  }
  const numeric = numericColumns(table);
  const nonIdentifiers = numeric.filter(c => !isIdentifierColumn(c));
  const chosen = nonIdentifiers.length >= 2 ? nonIdentifiers : numeric;
  return { x: chosen[0], y: chosen[1], z: chosen[2] ?? null };
};

// A short categorical legend is usually the most legible first colour channel.
// Twenty is the app's boundary between discrete and continuous numeric colour.
const MAX_DEFAULT_COLOR_CATEGORIES = 20;

export const pickDefaultColorBy = (table: DataTable, current: string) => {
  // A current selection may be deliberate, so preserve it on a dataset switch.
  if (current && table.columns.includes(current)) return current;
  if (table.columns.includes('Cluster')) return 'Cluster';

  const candidates = table.columns
    .map((name, index) => ({ name, index, values: table.data[name] ?? [] }))
    .filter(({ name, values }) => {
      const count = uniqueNonNull(values).length;
      return !isIdentifierColumn(name)
        && count >= 2
        && count <= MAX_DEFAULT_COLOR_CATEGORIES
        && !isBooleanLike(values);
    })
    .sort((a, b) => uniqueNonNull(a.values).length - uniqueNonNull(b.values).length || a.index - b.index);

  return candidates[0]?.name
    ?? table.columns.find(c => !isIdentifierColumn(c))
    ?? table.columns[0]
    ?? '';
};

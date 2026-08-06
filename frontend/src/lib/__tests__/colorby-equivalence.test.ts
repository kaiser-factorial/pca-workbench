import { describe, it, expect } from 'vitest';
import { pickDefaultColorBy } from '../defaults';
import type { DataTable } from '../table';

// F18 rewrote pickDefaultColorBy for speed (5–6 full column scans per column
// down to one capped scan). Speed work on a pure function is only safe if the
// output is provably unchanged, so this file keeps a literal copy of the OLD
// implementation and asserts the two agree — on hand-built edge cases and on
// several hundred randomly generated tables.
//
// If this ever fails, the new implementation is wrong: the reference below is
// the behaviour that shipped.

const isIdentifierColumnOld = (name: string) => {
  const trimmed = name.trim();
  return /^(?:id|uuid|guid)$/i.test(trimmed)
    || /(?:[_\-\s]id)$/i.test(trimmed)
    // E5 fixed this to require a boundary; the reference uses the FIXED form so
    // this file tests F18's rewrite alone rather than both changes at once.
    || /(?:[^A-Z]|^)ID$/.test(trimmed);
};
const uniqueNonNull = (values: unknown[]) => Array.from(new Set(values.filter(v => v != null)));
const isBooleanLikeOld = (values: unknown[]) => {
  const present = uniqueNonNull(values);
  return present.length > 0 && present.every(v =>
    v === 0 || v === 1 || v === true || v === false || v === 'true' || v === 'false');
};
const MAX = 20;

const pickDefaultColorByOld = (table: DataTable, current: string) => {
  if (current && table.columns.includes(current)) return current;
  if (table.columns.includes('Cluster')) return 'Cluster';
  const candidates = table.columns
    .map((name, index) => ({ name, index, values: table.data[name] ?? [] }))
    .filter(({ name, values }) => {
      const count = uniqueNonNull(values).length;
      return !isIdentifierColumnOld(name) && count >= 2 && count <= MAX && !isBooleanLikeOld(values);
    })
    .sort((a, b) => uniqueNonNull(a.values).length - uniqueNonNull(b.values).length || a.index - b.index);
  return candidates[0]?.name
    ?? table.columns.find(c => !isIdentifierColumnOld(c))
    ?? table.columns[0]
    ?? '';
};

const mk = (data: Record<string, unknown[]>): DataTable =>
  ({ columns: Object.keys(data), data, nRows: Object.values(data)[0]?.length ?? 0 }) as DataTable;
const agree = (t: DataTable, current = '') =>
  expect(pickDefaultColorBy(t, current)).toBe(pickDefaultColorByOld(t, current));

describe('pickDefaultColorBy — F18 rewrite is output-identical', () => {
  it('agrees on the distinct-count boundary, which is where a capped scan could drift', () => {
    for (const k of [1, 2, 3, 19, 20, 21, 22, 50]) {
      agree(mk({
        a: Array.from({ length: 200 }, (_, i) => `v${i % k}`),
        b: Array.from({ length: 200 }, (_, i) => `w${i % 7}`),
      }));
    }
  });

  it('agrees on boolean-like columns in every representation', () => {
    for (const vals of [
      [0, 1, 0, 1], [true, false, true], ['true', 'false', 'true'],
      [0, 1, 2], [1, 1, 1], [0, null, 1],
    ]) {
      agree(mk({ flag: vals, other: ['a', 'b', 'c', 'd'] }));
    }
  });

  it('agrees on all-null, empty and single-value columns', () => {
    agree(mk({ a: [null, null, null], b: ['x', 'y', 'z'] }));
    agree(mk({ a: [], b: [] }));
    agree(mk({ a: ['only'], b: ['x', 'y'] }));
    agree(mk({ a: [null, 'x', null], b: ['p', 'q', 'r'] }));
  });

  it('agrees on ties, where index order decides', () => {
    agree(mk({
      z: ['a', 'b', 'a', 'b'], m: ['c', 'd', 'c', 'd'], a: ['e', 'f', 'e', 'f'],
    }));
  });

  it('agrees on identifier-only tables and on the Cluster shortcut', () => {
    agree(mk({ id: [1, 2, 3], user_id: [4, 5, 6], RespondentID: [7, 8, 9] }));
    agree(mk({ Cluster: ['A', 'B'], other: ['x', 'y'] }));
    agree(mk({ VALID: ['x', 'y', 'z'], HYBRID: ['p', 'q', 'r'] }));   // E5 names
  });

  it('agrees when a current selection is already set', () => {
    const t = mk({ a: ['x', 'y'], b: ['p', 'q'] });
    agree(t, 'b');
    agree(t, 'not_a_column');
  });

  it('agrees on mixed types within one column', () => {
    agree(mk({ mixed: [1, 'one', true, null, 1, 'one'], other: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  });

  it('agrees across 400 randomly generated tables', () => {
    let seed = 20260805;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const names = ['id', 'user_id', 'RespondentID', 'VALID', 'score', 'group', 'flag', 'wave', 'Cluster', 'notes'];
    for (let t = 0; t < 400; t++) {
      const nCols = 1 + Math.floor(rnd() * 5);
      const nRows = Math.floor(rnd() * 60);
      const data: Record<string, unknown[]> = {};
      for (let c = 0; c < nCols; c++) {
        const name = names[Math.floor(rnd() * names.length)] + (c ? `_${c}` : '');
        const kind = Math.floor(rnd() * 5);
        data[name] = Array.from({ length: nRows }, (_, i) => {
          if (rnd() < 0.1) return null;
          switch (kind) {
            case 0: return i % 2;                       // boolean-like
            case 1: return `cat${i % (1 + Math.floor(rnd() * 25))}`;
            case 2: return i;                           // all distinct
            case 3: return rnd() < 0.5 ? 'true' : 'false';
            default: return `g${i % 3}`;
          }
        });
      }
      if (Object.keys(data).length === 0) continue;
      agree(mk(data), rnd() < 0.2 ? Object.keys(data)[0] : '');
    }
  });
});

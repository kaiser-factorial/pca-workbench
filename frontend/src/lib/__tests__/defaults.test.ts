import { describe, expect, it } from 'vitest';
import { isBooleanLike, isIdentifierColumn, pickDefaultAxes, pickDefaultColorBy, valueIsTooRare, MIN_AGGREGATE_COUNT } from '../defaults';
import type { DataTable } from '../table';

const table = (columns: Record<string, any[]>): DataTable => ({
  columns: Object.keys(columns),
  data: columns,
  nRows: Object.values(columns)[0]?.length ?? 0,
});

describe('smart upload defaults', () => {
  it('recognizes explicit ID naming conventions without inferring from uniqueness', () => {
    expect(isIdentifierColumn('Id')).toBe(true);
    expect(isIdentifierColumn('participant_id')).toBe(true);
    expect(isIdentifierColumn('RecordID')).toBe(true);
    expect(isIdentifierColumn('valid')).toBe(false);
  });

  it('prefers measured variables and drops an ID rather than using it as Z', () => {
    const input = table({ Id: [1, 2, 3], Height: [160, 165, 170], Weight: [60, 66, 72] });
    expect(pickDefaultAxes(input)).toEqual({ x: 'Height', y: 'Weight', z: null });
  });

  it('keeps PC axes as the explicit projection default', () => {
    const input = table({ Id: [1, 2], PC1: [1, 2], PC2: [3, 4], PC3: [5, 6] });
    expect(pickDefaultAxes(input)).toEqual({ x: 'PC1', y: 'PC2', z: 'PC3' });
  });

  it('uses the lowest-cardinality non-boolean, non-ID grouping for colour', () => {
    const input = table({
      Id: [1, 2, 3, 4, 5, 6],
      is_complete: [1, 0, 1, 0, 1, 0],
      Species: ['setosa', 'setosa', 'versicolor', 'versicolor', 'virginica', 'virginica'],
      Batch: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(isBooleanLike(input.data.is_complete)).toBe(true);
    expect(pickDefaultColorBy(input, '')).toBe('Species');
  });

  it('preserves a user-selected colour and falls back safely when no category exists', () => {
    const input = table({ Id: [1, 2, 3], Score: [10, 20, 30] });
    expect(pickDefaultColorBy(input, 'Score')).toBe('Score');
    expect(pickDefaultColorBy(input, '')).toBe('Score');
  });
});

// The assistant's privacy contract is "aggregates, never rows". The column
// profile it sends carries each categorical column's most frequent values —
// which on an email or free-text column is a handful of rows (finding D8).
//
// The test is per-VALUE rather than per-column on purpose. A column-level
// cardinality rule gets emails right and then withholds an ordinary 60-level
// `school` variable where every level covers 80 rows — a real loss of context
// for no privacy gain. What matters is how many people stand behind a value.
describe('valueIsTooRare — where naming a value stops being an aggregate', () => {
  it('withholds values covering too few rows to be a group', () => {
    expect(valueIsTooRare(1)).toBe(true);      // an email, a name, a free-text answer
    expect(valueIsTooRare(4)).toBe(true);
  });

  it('allows values that genuinely describe a group', () => {
    expect(valueIsTooRare(MIN_AGGREGATE_COUNT)).toBe(false);
    expect(valueIsTooRare(50)).toBe(false);    // Species in iris
    expect(valueIsTooRare(80)).toBe(false);    // one school among sixty
  });

  it('uses the conventional small-cell threshold', () => {
    expect(MIN_AGGREGATE_COUNT).toBe(5);
  });
});

// A bare /ID$/ matched any name ending in capital I-D, so ordinary variables
// were excluded from default axes and from the assistant's default PCA
// variables (finding E5).
describe('isIdentifierColumn — boundaries, not just suffixes', () => {
  it('still catches real identifier conventions', () => {
    for (const n of ['id', 'ID', 'Id', 'uuid', 'GUID', 'user_id', 'participant-id', 'subject id', 'respondentID', 'subjID']) {
      expect(isIdentifierColumn(n)).toBe(true);
    }
  });

  it('no longer swallows ordinary words ending in ID', () => {
    for (const n of ['VALID', 'HYBRID', 'RAPID', 'GRID', 'LIPID', 'ACID']) {
      expect(isIdentifierColumn(n)).toBe(false);
    }
  });

  it('leaves ordinary measures alone', () => {
    for (const n of ['score', 'age', 'PC1', 'openness_1', 'identity']) {
      expect(isIdentifierColumn(n)).toBe(false);
    }
  });
});

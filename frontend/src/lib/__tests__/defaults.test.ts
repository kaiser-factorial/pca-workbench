import { describe, expect, it } from 'vitest';
import { isBooleanLike, isIdentifierColumn, pickDefaultAxes, pickDefaultColorBy, valuesAreRowLevel } from '../defaults';
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
// which on an email or free-text column is eight arbitrary rows with a count of
// 1, i.e. exactly the raw data the contract excludes (finding D8).
describe('valuesAreRowLevel — where a category list stops being an aggregate', () => {
  it('withholds a column with one distinct value per row', () => {
    expect(valuesAreRowLevel(200, 200)).toBe(true);   // emails, names, free text
    expect(valuesAreRowLevel(180, 200)).toBe(true);   // near-unique is the same problem
  });

  it('allows genuine categories, which are what make the assistant useful', () => {
    expect(valuesAreRowLevel(3, 150)).toBe(false);    // Species in iris
    expect(valuesAreRowLevel(2, 200)).toBe(false);    // condition
    expect(valuesAreRowLevel(7, 500)).toBe(false);    // Likert
  });

  it('caps on absolute count too, not just the ratio', () => {
    // 4,000 values across 50,000 rows is a small ratio and still not a category
    // set anyone wants listed.
    expect(valuesAreRowLevel(4000, 50000)).toBe(true);
    expect(valuesAreRowLevel(50, 50000)).toBe(false);
  });

  it('handles an empty table without dividing by zero', () => {
    expect(valuesAreRowLevel(0, 0)).toBe(false);
  });
});

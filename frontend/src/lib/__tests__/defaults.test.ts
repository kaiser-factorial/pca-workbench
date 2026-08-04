import { describe, expect, it } from 'vitest';
import { isBooleanLike, isIdentifierColumn, pickDefaultAxes, pickDefaultColorBy } from '../defaults';
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

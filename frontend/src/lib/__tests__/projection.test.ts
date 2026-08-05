import { describe, it, expect } from 'vitest';
import { processUpload } from '../engine';
import { pickDefaultAxes } from '../defaults';
import type { DataTable } from '../table';

// The components-file projection had four silences (finding C10). Each one
// produced a number that looked like a PC score and was not one, with nothing
// on screen to say so.

const table = (data: Record<string, unknown[]>): DataTable => {
  const columns = Object.keys(data);
  return { columns, data, nRows: data[columns[0]].length } as DataTable;
};

// A components file: first column names the variables, the rest are loadings.
const components = (vars: string[], pcs: Record<string, unknown[]>): DataTable =>
  table({ variable: vars, ...pcs });

const data = table({
  openness: [1, 2, 3, 4, 5],
  neuroticism: [5, 4, 3, 2, 1],
  extraversion: [2, 3, 4, 5, 6],
});

const has = (ws: string[], fragment: string) =>
  ws.some(w => w.toLowerCase().includes(fragment.toLowerCase()));

describe('projection coverage is reported, not implied (finding C10)', () => {
  it('says how many of the file\'s variables were actually found', () => {
    const comp = components(
      ['openness', 'neuroticism', 'extraversion', 'agreeableness', 'conscientiousness'],
      { PC1: [0.5, -0.5, 0.5, 0.4, 0.3], PC2: [0.1, 0.2, -0.3, 0.5, 0.6] },
    );
    const res = processUpload(data, comp);
    expect(has(res.warnings, 'lists 5 variables and this dataset has 3')).toBe(true);
    expect(has(res.warnings, 'partial projection')).toBe(true);
    expect(has(res.warnings, '"agreeableness"')).toBe(true);
    expect(res.message).toContain('3 of the components file\'s 5 variables');
  });

  it('escalates when most of the file is missing', () => {
    const comp = components(
      ['openness', 'a', 'b', 'c', 'd', 'e', 'f'],
      { PC1: [0.5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], PC2: [0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] },
    );
    const res = processUpload(data, comp);
    expect(has(res.warnings, 'fewer than half')).toBe(true);
  });

  it('stays quiet when the file matches the dataset exactly', () => {
    const comp = components(['openness', 'neuroticism', 'extraversion'], {
      PC1: [0.5, -0.5, 0.5], PC2: [0.1, 0.2, -0.3], PC3: [0.3, 0.3, 0.3],
    });
    expect(processUpload(data, comp).warnings).toEqual([]);
  });
});

describe('name matching survives case and stray spaces (finding C10)', () => {
  it('matches "Openness" to "openness" instead of finding no overlap', () => {
    const comp = components(['Openness', ' Neuroticism ', 'Extraversion'], {
      PC1: [0.5, -0.5, 0.5], PC2: [0.1, 0.2, -0.3], PC3: [0.3, 0.3, 0.3],
    });
    const res = processUpload(data, comp);
    expect(res.table.columns).toContain('PC1');
    expect(has(res.warnings, 'ignoring case and surrounding spaces')).toBe(true);
    // Nothing was dropped, so no coverage complaint.
    expect(has(res.warnings, 'partial projection')).toBe(false);
  });

  it('prefers an exact match over a normalised one', () => {
    const d = table({ score: [1, 2, 3], SCORE: [9, 9, 9], other: [1, 1, 2] });
    const comp = components(['score', 'other'], { PC1: [1, 0], PC2: [0, 1] });
    const res = processUpload(d, comp);
    // PC1 is built from `score` (1,2,3 standardized), not `SCORE` (constant).
    expect(new Set(res.table.data.PC1 as number[]).size).toBe(3);
    expect(has(res.warnings, 'ignoring case')).toBe(false);
  });
});

describe('only the components the file contains are created (finding C10)', () => {
  it('does not invent a zero-filled PC3', () => {
    const comp = components(['openness', 'neuroticism', 'extraversion'], {
      PC1: [0.5, -0.5, 0.5], PC2: [0.1, 0.2, -0.3],
    });
    const res = processUpload(data, comp);
    expect(res.table.columns).toContain('PC2');
    expect(res.table.columns).not.toContain('PC3');
    expect(has(res.warnings, 'defines 2 components')).toBe(true);
  });

  it('so an all-zero PC3 can no longer be assigned to the Z axis', () => {
    const comp = components(['openness', 'neuroticism', 'extraversion'], {
      PC1: [0.5, -0.5, 0.5], PC2: [0.1, 0.2, -0.3],
    });
    const axes = pickDefaultAxes(processUpload(data, comp).table);
    expect(axes.x).toBe('PC1');
    expect(axes.y).toBe('PC2');
    expect(axes.z).toBeNull();
  });

  it('still uses all three when the file has three or more', () => {
    const comp = components(['openness', 'neuroticism', 'extraversion'], {
      PC1: [0.5, -0.5, 0.5], PC2: [0.1, 0.2, -0.3], PC3: [0.3, 0.3, 0.3], PC4: [0.1, 0.1, 0.1],
    });
    const res = processUpload(data, comp);
    expect(pickDefaultAxes(res.table)).toEqual({ x: 'PC1', y: 'PC2', z: 'PC3' });
    expect(res.table.columns).not.toContain('PC4');   // capped at 3, as before
  });
});

describe('an unreadable loading is not silently a zero (finding C10)', () => {
  it('reports loadings that could not be read as numbers', () => {
    const comp = components(['openness', 'neuroticism', 'extraversion'], {
      PC1: [0.5, 'n/a', 0.5], PC2: [0.1, 0.2, ''],
    });
    const res = processUpload(data, comp);
    expect(has(res.warnings, '2 loadings')).toBe(true);
    expect(has(res.warnings, 'does not contribute')).toBe(true);
  });

  it('does not mistake a real zero for an unreadable one', () => {
    const comp = components(['openness', 'neuroticism', 'extraversion'], {
      PC1: [0.5, 0, 0.5], PC2: [0.1, 0.2, 0],
    });
    expect(has(processUpload(data, comp).warnings, 'could not be read')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { validateWorkspace, WORKSPACE_VERSION } from '../workspaces';

// The old check was `!parsed.version` and nothing else, so a damaged file
// reached applyWorkspace, rehydrated a dangling table reference to undefined,
// and left render to dereference d.table.nRows — throwing inside React and
// white-screening the app with no way back but a reload (finding C11).

const table = { columns: ['a'], data: { a: [1, 2] }, nRows: 2 };
const good = () => ({
  version: WORKSPACE_VERSION,
  tables: { t0: table },
  datasets: [{ id: 1, name: 'ds', table: 't0' }],
  pinnedViews: [],
});

describe('validateWorkspace (finding C11)', () => {
  it('accepts a workspace this build wrote', () => {
    expect(() => validateWorkspace(good())).not.toThrow();
  });

  it('accepts the minimum: a version and nothing else', () => {
    expect(() => validateWorkspace({ version: 1 })).not.toThrow();
  });

  it('rejects things that are not workspace objects', () => {
    for (const v of [null, undefined, 42, 'text', [], {}]) {
      expect(() => validateWorkspace(v)).toThrow(/Not a workspace file/);
    }
  });

  it('rejects a file from a newer build, by name', () => {
    expect(() => validateWorkspace({ ...good(), version: WORKSPACE_VERSION + 1 }))
      .toThrow(/newer version of Scatter Lab/);
  });

  it('catches the dangling table reference that white-screened the app', () => {
    const ws = good();
    ws.datasets[0].table = 't_missing';
    expect(() => validateWorkspace(ws)).toThrow(/refers to a table \("t_missing"\) that the file does not contain/);
    // and it names the dataset, so the user knows which one
    expect(() => validateWorkspace(ws)).toThrow(/"ds"/);
  });

  it('catches a table that is present but malformed', () => {
    for (const bad of [
      { columns: 'a', data: {}, nRows: 0 },
      { columns: ['a'], data: [], nRows: 0 },
      { columns: ['a'], data: {}, nRows: 'lots' },
      { columns: [1, 2], data: {}, nRows: 0 },
      null,
    ]) {
      expect(() => validateWorkspace({ ...good(), tables: { t0: bad } })).toThrow(/damaged/);
    }
  });

  it('catches wrong-typed top-level sections', () => {
    expect(() => validateWorkspace({ ...good(), datasets: 'nope' })).toThrow(/"datasets" section is not a list/);
    expect(() => validateWorkspace({ ...good(), tables: [] })).toThrow(/"tables" section is not an object/);
    expect(() => validateWorkspace({ ...good(), pinnedViews: {} })).toThrow(/"pinnedViews" section is not a list/);
  });

  it('catches a pinned view whose data went missing', () => {
    expect(() => validateWorkspace({ ...good(), pinnedViews: [{ data: 't_gone' }] }))
      .toThrow(/pinned view #1 has no usable data/);
  });

  it('allows an inline table rather than a reference', () => {
    expect(() => validateWorkspace({
      version: 1, datasets: [{ id: 1, name: 'ds', table }],
    })).not.toThrow();
  });
});

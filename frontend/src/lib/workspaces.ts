// Workspace persistence in IndexedDB (localStorage tops out ~5MB; snapshots
// with embedded tables can exceed that easily). Same four operations the old
// backend REST endpoints exposed, plus file export/import for sharing.

export type WorkspaceMeta = { name: string; saved_at: string; bytes: number };

const DB_NAME = 'scatter-lab';
const STORE = 'workspaces';

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
};

type Stored = { payload: any; saved_at: string; bytes: number };

export const listWorkspaces = async (): Promise<WorkspaceMeta[]> => {
  const [keys, values] = await Promise.all([
    tx<IDBValidKey[]>('readonly', s => s.getAllKeys()),
    tx<Stored[]>('readonly', s => s.getAll()),
  ]);
  return keys
    .map((k, i) => ({ name: String(k), saved_at: values[i]?.saved_at ?? '', bytes: values[i]?.bytes ?? 0 }))
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
};

export const saveWorkspace = async (name: string, payload: any): Promise<void> => {
  const bytes = new Blob([JSON.stringify(payload)]).size;
  const stored: Stored = { payload, saved_at: new Date().toISOString().slice(0, 19), bytes };
  await tx('readwrite', s => s.put(stored, name));
};

export const loadWorkspace = async (name: string): Promise<any | null> => {
  const stored = await tx<Stored | undefined>('readonly', s => s.get(name));
  return stored?.payload ?? null;
};

export const deleteWorkspace = async (name: string): Promise<void> => {
  await tx('readwrite', s => s.delete(name));
};

export const exportWorkspaceFile = (name: string, payload: any) => {
  const blob = new Blob([JSON.stringify({ name, ...payload })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.scatterlab.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** The payload shape this build knows how to apply. */
export const WORKSPACE_VERSION = 1;

// `unknown` rather than `any` throughout: this is the one place in the app that
// handles a value nobody typed, so the narrowing has to be real.
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

const isTable = (t: unknown): boolean => {
  if (!isRecord(t)) return false;
  return Array.isArray(t.columns)
    && t.columns.every((c: unknown) => typeof c === 'string')
    && isRecord(t.data)
    && typeof t.nRows === 'number' && Number.isFinite(t.nRows) && t.nRows >= 0;
};

/**
 * Reject a workspace this build cannot apply, with a reason.
 *
 * The check used to be `!parsed.version` and nothing else, so a truncated,
 * hand-edited or half-written file got as far as `applyWorkspace`, which
 * rehydrated a dangling table reference to `undefined` and left render to
 * dereference `d.table.nRows`. That threw inside React and white-screened the
 * app with no way back except a reload (finding C11). Everything below is
 * cheap; the point is that it happens BEFORE any state is replaced.
 */
export const validateWorkspace = (parsed: unknown): void => {
  if (!isRecord(parsed)) {
    throw new Error('Not a workspace file — expected a JSON object.');
  }
  if (typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) {
    throw new Error('Not a workspace file — it has no version number.');
  }
  // version is written on save and was never read back, so there was no
  // forward-compatibility story either. Now a newer file says so plainly
  // instead of failing somewhere further in.
  if (parsed.version > WORKSPACE_VERSION) {
    throw new Error(`This workspace was saved by a newer version of Scatter Lab (format ${parsed.version}, this build reads ${WORKSPACE_VERSION}).`);
  }

  if (parsed.tables != null && !isRecord(parsed.tables)) {
    throw new Error('Workspace file is damaged: its "tables" section is not an object.');
  }
  const tables: Rec = isRecord(parsed.tables) ? parsed.tables : {};
  for (const [id, t] of Object.entries(tables)) {
    if (!isTable(t)) throw new Error(`Workspace file is damaged: table "${id}" is not a valid table.`);
  }
  // A string is a reference into `tables`; anything else is an inline table.
  const resolve = (ref: unknown) => (typeof ref === 'string' ? tables[ref] : ref);

  if (parsed.datasets != null && !Array.isArray(parsed.datasets)) {
    throw new Error('Workspace file is damaged: its "datasets" section is not a list.');
  }
  // The failure that actually white-screened the app: a dataset naming a table
  // that is not in the file.
  (Array.isArray(parsed.datasets) ? parsed.datasets : []).forEach((d: unknown, i: number) => {
    if (!isRecord(d)) throw new Error(`Workspace file is damaged: dataset #${i + 1} is not an object.`);
    const where = typeof d.name === 'string' && d.name ? `"${d.name}"` : `#${i + 1}`;
    const t = resolve(d.table);
    if (t === undefined) {
      throw new Error(`Workspace file is damaged: dataset ${where} refers to a table ("${String(d.table)}") that the file does not contain.`);
    }
    if (!isTable(t)) throw new Error(`Workspace file is damaged: dataset ${where} has no usable table.`);
  });

  if (parsed.pinnedViews != null && !Array.isArray(parsed.pinnedViews)) {
    throw new Error('Workspace file is damaged: its "pinnedViews" section is not a list.');
  }
  (Array.isArray(parsed.pinnedViews) ? parsed.pinnedViews : []).forEach((v: unknown, i: number) => {
    const t = isRecord(v) ? resolve(v.data) : undefined;
    if (t === undefined || !isTable(t)) {
      throw new Error(`Workspace file is damaged: pinned view #${i + 1} has no usable data.`);
    }
  });
};

export const importWorkspaceFile = async (file: File): Promise<{ name: string; payload: unknown }> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    // JSON.parse's own message ("Unexpected token < in JSON at position 0") is
    // not something to show a researcher who picked the wrong file.
    throw new Error('That file is not valid JSON, so it is not a workspace file.');
  }
  validateWorkspace(parsed);
  // validateWorkspace has established this is a record; narrow for the name.
  const rec = parsed as Rec;
  const name = typeof rec.name === 'string' && rec.name
    ? rec.name
    : file.name.replace(/\.scatterlab\.json$|\.json$/i, '');
  return { name, payload: parsed };
};

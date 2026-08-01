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

export const importWorkspaceFile = async (file: File): Promise<{ name: string; payload: any }> => {
  const parsed = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== 'object' || !parsed.version) {
    throw new Error('Not a workspace file.');
  }
  const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : file.name.replace(/\.scatterlab\.json$|\.json$/i, '');
  return { name, payload: parsed };
};

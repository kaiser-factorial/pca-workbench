// Assistant feedback: thumbs up/down per assistant message, with an optional
// free-text reason. Records go to a Supabase table whose anon key is
// insert-only (RLS) — the app can file feedback but never read it back.
//
// Writes are buffered in IndexedDB and flushed in the background, so a click
// is never lost to a network blip. When Supabase isn't configured (env vars
// unset), the feedback UI stays hidden entirely.

export type FeedbackRecord = {
  event_id: string;
  rating: 'up' | 'down';
  reason?: string | null;
  model?: string;
  tools?: string[];
  user_message?: string | null;
  assistant_message?: string | null;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const feedbackEnabled = (): boolean =>
  SUPABASE_URL.startsWith('https://') && SUPABASE_KEY.length > 20;

// --- IndexedDB buffer -------------------------------------------------------

const DB_NAME = 'scatter-lab-feedback';
const STORE = 'queue';

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const enqueue = async (rec: FeedbackRecord): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(rec);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

const drainQueue = async (): Promise<{ key: IDBValidKey; rec: FeedbackRecord }[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(keysReq.result.map((key, i) => ({ key, rec: valsReq.result[i] })));
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

const removeFromQueue = async (keys: IDBValidKey[]): Promise<void> => {
  if (!keys.length) return;
  const db = await openDB();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const k of keys) tx.objectStore(STORE).delete(k);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
};

// --- Supabase REST insert ---------------------------------------------------

const postRows = async (rows: FeedbackRecord[]): Promise<boolean> => {
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/assistant_feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    return res.ok;
  } catch {
    return false;
  }
};

let flushing = false;
export const flushFeedback = async (): Promise<void> => {
  if (!feedbackEnabled() || flushing) return;
  flushing = true;
  try {
    const pending = await drainQueue();
    if (pending.length && await postRows(pending.map(p => p.rec))) {
      await removeFromQueue(pending.map(p => p.key));
    }
  } catch { /* stays queued for the next flush */ } finally {
    flushing = false;
  }
};

// Queue then flush — the record is durable the moment this resolves
export const submitFeedback = async (rec: FeedbackRecord): Promise<void> => {
  await enqueue(rec);
  void flushFeedback();
};

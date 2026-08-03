// Assistant feedback: thumbs up/down per assistant message, with an optional
// free-text reason. Records go to a Supabase table whose anon key is
// insert-only (RLS) — the app can file feedback but never read it back.
//
// Writes are buffered in IndexedDB and flushed in the background, so a click
// is never lost to a network blip. Delivery is AT-LEAST-ONCE: a tab can close
// between a successful POST and the queue delete, and two open tabs mount-flush
// the same shared queue concurrently. Both used to produce visible duplicates
// in the insert-only table. Every record therefore carries a `client_key` that
// the table unique-indexes (migration 20260802000000_feedback_idempotency):
// redelivery is a server-side no-op. A Web Lock serializes flushes across tabs
// as well, so the common case never even re-sends.
//
// When Supabase isn't configured (env vars unset), the feedback UI stays
// hidden entirely.

export type FeedbackRecord = {
  event_id: string;
  rating: 'up' | 'down';
  reason?: string | null;
  model?: string;
  tools?: string[];
  user_message?: string | null;
  assistant_message?: string | null;
  /** Idempotency key, stamped once at enqueue. Unique-indexed server-side. */
  client_key?: string;
};

/** What sits in the IndexedDB queue. Entries buffered by older builds are bare
 *  FeedbackRecords; normalizeEntry upgrades them on read. */
type QueuedEntry = { rec: FeedbackRecord; attempts: number };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// A row rejected this many times (responses received, not network failures) is
// dropped — one poison row must not wedge everything queued behind it forever.
const MAX_ATTEMPTS = 5;

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

const normalizeEntry = (v: QueuedEntry | FeedbackRecord): QueuedEntry =>
  'rec' in v ? (v as QueuedEntry) : { rec: v as FeedbackRecord, attempts: 0 };

const enqueue = async (rec: FeedbackRecord): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ rec, attempts: 0 } satisfies QueuedEntry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

const drainQueue = async (): Promise<{ key: IDBValidKey; entry: QueuedEntry }[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(keysReq.result.map((key, i) => ({ key, entry: normalizeEntry(valsReq.result[i]) })));
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

const updateEntry = async (key: IDBValidKey, entry: QueuedEntry): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
};

// --- Supabase REST insert ---------------------------------------------------

// 'ok'       — inserted (or already present; duplicates resolve to no-ops)
// 'rejected' — the server answered and said no; retrying identical bytes won't help
// 'network'  — nothing answered; the row stays queued and costs no attempt
type PostResult = 'ok' | 'rejected' | 'network';

const postRows = async (
  rows: FeedbackRecord[],
  opts: { keepalive?: boolean; onConflict?: boolean } = {}
): Promise<PostResult> => {
  const { keepalive = false, onConflict = true } = opts;
  const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/assistant_feedback`;
  try {
    const res = await fetch(onConflict ? `${base}?on_conflict=client_key` : base, {
      method: 'POST',
      keepalive,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: onConflict ? 'return=minimal,resolution=ignore-duplicates' : 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    return res.ok ? 'ok' : 'rejected';
  } catch {
    return 'network';
  }
};

// --- Flush ------------------------------------------------------------------

const flushOnce = async (keepalive: boolean): Promise<void> => {
  const pending = await drainQueue();
  if (!pending.length) return;

  const batch = await postRows(pending.map((p) => p.entry.rec), { keepalive });
  if (batch === 'ok') {
    await removeFromQueue(pending.map((p) => p.key));
    return;
  }
  if (batch === 'network') return; // offline — everything stays queued, no attempts burned

  // The server rejected the batch. Retry per row so one poison row can't wedge
  // the rest, with a one-time bridge for servers that predate the client_key
  // migration (on_conflict against a missing index is itself a 4xx).
  for (const { key, entry } of pending) {
    let result = await postRows([entry.rec], { keepalive });
    if (result === 'rejected') {
      // Pre-migration bridge: that server lacks the client_key COLUMN too, and
      // PostgREST rejects unknown body keys — so the key must leave the body,
      // not just the on_conflict param. Costs idempotency for this one delivery,
      // which is the documented pre-migration trade-off.
      const { client_key: _omit, ...legacy } = entry.rec;
      result = await postRows([legacy], { keepalive, onConflict: false });
    }
    if (result === 'ok') {
      await removeFromQueue([key]);
    } else if (result === 'rejected') {
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.warn('[feedback] dropping row after repeated server rejections:', entry.rec.event_id);
        await removeFromQueue([key]);
      } else {
        await updateEntry(key, { ...entry, attempts });
      }
    }
    // 'network': leave as-is; the next flush retries from the top
  }
};

let flushing = false;
export const flushFeedback = async (opts: { keepalive?: boolean } = {}): Promise<void> => {
  if (!feedbackEnabled() || flushing) return;
  flushing = true;
  try {
    // The queue is shared across tabs but `flushing` isn't — without the lock,
    // two tabs mount-flushing together both drain the same rows and double-post
    // them. The lock serializes; client_key makes any survivor harmless anyway.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('scatter-lab-feedback-flush', () => flushOnce(opts.keepalive ?? false));
    } else {
      await flushOnce(opts.keepalive ?? false);
    }
  } catch { /* stays queued for the next flush */ } finally {
    flushing = false;
  }
};

// Queue then flush — the record is durable the moment this resolves
export const submitFeedback = async (rec: FeedbackRecord): Promise<void> => {
  await enqueue({ ...rec, client_key: rec.client_key ?? crypto.randomUUID() });
  void flushFeedback();
};

// A record queued moments before the tab closes would otherwise wait for the
// NEXT session's mount flush (possibly days). keepalive lets the request
// outlive the page.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushFeedback({ keepalive: true }); });
}

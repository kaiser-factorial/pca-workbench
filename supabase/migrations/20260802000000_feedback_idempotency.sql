-- Idempotent feedback inserts.
--
-- The client buffers records in IndexedDB and delivers at-least-once: a POST
-- that succeeds right before the tab closes gets re-sent next session, and two
-- open tabs both mount-flush the same shared queue and double-post every row.
-- With an insert-only table, every redelivery was a visible duplicate.
--
-- client_key is stamped once per record at enqueue; the unique index plus the
-- client's `on_conflict=client_key` + `Prefer: resolution=ignore-duplicates`
-- turns redelivery into a no-op. Pre-migration rows have NULL client_key,
-- which never collides (Postgres unique indexes ignore NULL duplicates).
alter table public.assistant_feedback add column if not exists client_key uuid;
create unique index if not exists assistant_feedback_client_key_key
  on public.assistant_feedback (client_key);

-- Cross-project eval warehouse tag (HANDOFF.md "Cross-project review"):
-- joint-session's exported ratings will insert with their own source_app.
alter table public.assistant_feedback add column if not exists source_app text
  not null default 'scatter-lab';

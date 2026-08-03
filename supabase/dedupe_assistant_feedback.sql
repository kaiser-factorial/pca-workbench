-- One-time cleanup of duplicated feedback rows (2026-08-02 incident).
--
-- Cause: at-least-once delivery from the IndexedDB buffer into an insert-only
-- table with no idempotency key — two tabs mount-flushing the same queue, and
-- successful POSTs whose queue-delete never ran, both re-inserted identical
-- content. Fixed going forward by client_key (see migration
-- 20260802000000_feedback_idempotency) — this file only clears the backlog.
--
-- NOT a migration on purpose: it deletes data. Run the preview, eyeball it,
-- then run the delete in the dashboard SQL editor.

-- 1. Preview: which (event_id, rating, reason) groups have extra copies?
select event_id, rating, coalesce(reason, '') as reason,
       count(*) as copies,
       min(created_at) as first_seen, max(created_at) as last_seen
from assistant_feedback
group by 1, 2, 3
having count(*) > 1
order by copies desc, first_seen;

-- 2. Delete every copy except the earliest of each identical row.
--    ctid is used so this works regardless of the primary-key column;
--    user_message is included in the identity so a metadata-only row and a
--    consented-exchange row are never treated as copies of each other.
-- delete from assistant_feedback a
-- using assistant_feedback b
-- where a.ctid > b.ctid
--   and a.event_id = b.event_id
--   and a.rating = b.rating
--   and coalesce(a.reason, '') = coalesce(b.reason, '')
--   and coalesce(a.user_message, '') = coalesce(b.user_message, '');

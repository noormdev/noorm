-- =============================================================================
-- 004 — Seed system tags + backfill attachments
-- =============================================================================
-- Idempotent: uses ON CONFLICT DO NOTHING so re-running the change leaves
-- existing data alone. The "system" tag is attached to every pre-existing
-- todo so downstream filters can distinguish user-authored todos from those
-- we expect to exist on every deployment.
-- -----------------------------------------------------------------------------

INSERT INTO tag (name, color)
VALUES
    ('system',   '#4B5563'),
    ('urgent',   '#DC2626'),
    ('deferred', '#9CA3AF')
ON CONFLICT (name) DO NOTHING;


-- Attach the "system" tag to every existing todo. New todos created after
-- this change are NOT auto-tagged — this is a one-time backfill.
INSERT INTO todo_tag (user_id, category_id, todo_created_at, tag_id)
SELECT t.user_id, t.category_id, t.created_at, st.id
FROM todo t
CROSS JOIN (SELECT id FROM tag WHERE name = 'system') st
ON CONFLICT DO NOTHING;

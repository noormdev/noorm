-- =============================================================================
-- Revert 001 — Remove seeded system tags + attachments
-- =============================================================================

DELETE FROM todo_tag
WHERE tag_id IN (SELECT id FROM tag WHERE name IN ('system', 'urgent', 'deferred'));

DELETE FROM tag
WHERE name IN ('system', 'urgent', 'deferred');

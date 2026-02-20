-- =============================================================================
-- Users With Stats View
-- Shows users with their todo and item statistics
-- =============================================================================

CREATE OR REPLACE VIEW v_users_with_stats AS
SELECT
    u.id AS user_id,
    u.username,
    u.email,
    u.created_at,
    u.updated_at,
    (
        SELECT COUNT(*)
        FROM todo t
        WHERE t.user_id = u.id
    ) AS total_todos,
    (
        SELECT COUNT(*)
        FROM todo t
        WHERE t.user_id = u.id
          AND t.status = 'pending'
    ) AS pending_todos,
    (
        SELECT COUNT(*)
        FROM todo t
        WHERE t.user_id = u.id
          AND t.status = 'in_progress'
    ) AS in_progress_todos,
    (
        SELECT COUNT(*)
        FROM todo t
        WHERE t.user_id = u.id
          AND t.status = 'completed'
    ) AS completed_todos,
    (
        SELECT COUNT(*)
        FROM todo_item ti
        WHERE ti.user_id = u.id
    ) AS total_items,
    (
        SELECT COUNT(*)
        FROM todo_item ti
        WHERE ti.user_id = u.id
          AND ti.is_completed = TRUE
    ) AS completed_items,
    (
        SELECT ARRAY_AGG(DISTINCT tg.name ORDER BY tg.name)
        FROM user_tag ut
        JOIN tag tg ON tg.id = ut.tag_id
        WHERE ut.user_id = u.id
    ) AS tags
FROM "user" u;

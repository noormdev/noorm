-- =============================================================================
-- Todos With Details View
-- Shows todos with user, category, and aggregated tag information
-- =============================================================================

CREATE OR REPLACE VIEW v_todos_with_details AS
SELECT
    t.user_id,
    t.category_id,
    t.created_at,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.due_date,
    t.updated_at,
    u.username AS user_username,
    u.email AS user_email,
    c.name AS category_name,
    c.description AS category_description,
    (
        SELECT COUNT(*)
        FROM todo_item ti
        WHERE ti.user_id = t.user_id
          AND ti.category_id = t.category_id
          AND ti.todo_created_at = t.created_at
    ) AS item_count,
    (
        SELECT COUNT(*)
        FROM todo_item ti
        WHERE ti.user_id = t.user_id
          AND ti.category_id = t.category_id
          AND ti.todo_created_at = t.created_at
          AND ti.is_completed = TRUE
    ) AS completed_item_count,
    (
        SELECT ARRAY_AGG(tg.name ORDER BY tg.name)
        FROM todo_tag tt
        JOIN tag tg ON tg.id = tt.tag_id
        WHERE tt.user_id = t.user_id
          AND tt.category_id = t.category_id
          AND tt.todo_created_at = t.created_at
    ) AS tags,
    -- Appended after `tags` so CREATE OR REPLACE VIEW can upgrade existing
    -- databases in place (Postgres only allows appending new columns).
    t.metadata
FROM todo t
JOIN "user" u ON u.id = t.user_id
JOIN category c ON c.id = t.category_id;

-- =============================================================================
-- Todos By Tag View
-- Shows todos associated with each tag
-- =============================================================================

CREATE OR REPLACE VIEW v_todos_by_tag AS
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    tt.user_id,
    tt.category_id,
    tt.todo_created_at,
    t.title AS todo_title,
    t.description AS todo_description,
    t.status AS todo_status,
    t.priority AS todo_priority,
    t.due_date AS todo_due_date,
    u.username AS user_username,
    c.name AS category_name
FROM tag tg
LEFT JOIN todo_tag tt ON tt.tag_id = tg.id
LEFT JOIN todo t ON t.user_id = tt.user_id
    AND t.category_id = tt.category_id
    AND t.created_at = tt.todo_created_at
LEFT JOIN "user" u ON u.id = t.user_id
LEFT JOIN category c ON c.id = t.category_id
ORDER BY tg.name, t.priority DESC, t.due_date ASC NULLS LAST;

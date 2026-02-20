-- =============================================================================
-- Todos By Category View
-- Shows todos grouped by category with category details
-- =============================================================================

CREATE OR REPLACE VIEW v_todos_by_category AS
SELECT
    c.id AS category_id,
    c.name AS category_name,
    c.description AS category_description,
    t.user_id,
    t.created_at AS todo_created_at,
    t.title AS todo_title,
    t.description AS todo_description,
    t.status AS todo_status,
    t.priority AS todo_priority,
    t.due_date AS todo_due_date,
    u.username AS user_username
FROM category c
LEFT JOIN todo t ON t.category_id = c.id
LEFT JOIN "user" u ON u.id = t.user_id
ORDER BY c.name, t.priority DESC, t.due_date ASC NULLS LAST;

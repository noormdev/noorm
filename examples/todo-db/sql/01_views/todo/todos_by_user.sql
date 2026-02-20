-- =============================================================================
-- Todos By User View
-- Shows todos grouped by user with user details
-- =============================================================================

CREATE OR REPLACE VIEW v_todos_by_user AS
SELECT
    u.id AS user_id,
    u.username,
    u.email,
    t.category_id,
    t.created_at AS todo_created_at,
    t.title AS todo_title,
    t.description AS todo_description,
    t.status AS todo_status,
    t.priority AS todo_priority,
    t.due_date AS todo_due_date,
    c.name AS category_name
FROM "user" u
LEFT JOIN todo t ON t.user_id = u.id
LEFT JOIN category c ON c.id = t.category_id
ORDER BY u.username, t.priority DESC, t.due_date ASC NULLS LAST;

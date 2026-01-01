-- PostgreSQL Views for Test Schema

CREATE OR REPLACE VIEW v_active_users AS
SELECT
    id,
    email,
    username,
    display_name,
    avatar_url,
    created_at,
    updated_at
FROM users
WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW v_todo_lists_with_counts AS
SELECT
    tl.id,
    tl.user_id,
    tl.title,
    tl.description,
    tl.color,
    tl.position,
    tl.created_at,
    tl.updated_at,
    COUNT(ti.id) FILTER (WHERE ti.deleted_at IS NULL) AS total_items,
    COUNT(ti.id) FILTER (WHERE ti.deleted_at IS NULL AND ti.is_completed = TRUE) AS completed_items,
    COUNT(ti.id) FILTER (WHERE ti.deleted_at IS NULL AND ti.is_completed = FALSE) AS pending_items
FROM todo_lists tl
LEFT JOIN todo_items ti ON ti.list_id = tl.id
WHERE tl.deleted_at IS NULL
GROUP BY tl.id;

CREATE OR REPLACE VIEW v_active_todo_items AS
SELECT
    ti.id,
    ti.list_id,
    ti.title,
    ti.description,
    ti.is_completed,
    ti.priority,
    ti.due_date,
    ti.completed_at,
    ti.position,
    ti.created_at,
    ti.updated_at,
    tl.user_id,
    tl.title AS list_title
FROM todo_items ti
INNER JOIN todo_lists tl ON tl.id = ti.list_id
WHERE ti.deleted_at IS NULL
  AND tl.deleted_at IS NULL;

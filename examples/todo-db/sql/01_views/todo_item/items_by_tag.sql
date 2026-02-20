-- =============================================================================
-- Items By Tag View
-- Shows todo items associated with each tag
-- =============================================================================

CREATE OR REPLACE VIEW v_items_by_tag AS
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    tit.user_id,
    tit.category_id,
    tit.todo_created_at,
    tit.item_index,
    ti.title AS item_title,
    ti.is_completed,
    t.title AS todo_title,
    u.username AS user_username,
    c.name AS category_name
FROM tag tg
LEFT JOIN todo_item_tag tit ON tit.tag_id = tg.id
LEFT JOIN todo_item ti ON ti.user_id = tit.user_id
    AND ti.category_id = tit.category_id
    AND ti.todo_created_at = tit.todo_created_at
    AND ti.item_index = tit.item_index
LEFT JOIN todo t ON t.user_id = ti.user_id
    AND t.category_id = ti.category_id
    AND t.created_at = ti.todo_created_at
LEFT JOIN "user" u ON u.id = ti.user_id
LEFT JOIN category c ON c.id = ti.category_id
ORDER BY tg.name, ti.todo_created_at, ti.item_index;

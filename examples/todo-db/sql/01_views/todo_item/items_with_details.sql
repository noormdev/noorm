-- =============================================================================
-- Items With Details View
-- Shows todo items with their parent todo and tag information
-- =============================================================================

CREATE OR REPLACE VIEW v_items_with_details AS
SELECT
    ti.user_id,
    ti.category_id,
    ti.todo_created_at,
    ti.item_index,
    ti.title AS item_title,
    ti.is_completed,
    ti.created_at AS item_created_at,
    ti.updated_at AS item_updated_at,
    t.title AS todo_title,
    t.status AS todo_status,
    u.username AS user_username,
    c.name AS category_name,
    (
        SELECT ARRAY_AGG(tg.name ORDER BY tg.name)
        FROM todo_item_tag tit
        JOIN tag tg ON tg.id = tit.tag_id
        WHERE tit.user_id = ti.user_id
          AND tit.category_id = ti.category_id
          AND tit.todo_created_at = ti.todo_created_at
          AND tit.item_index = ti.item_index
    ) AS tags
FROM todo_item ti
JOIN todo t ON t.user_id = ti.user_id
    AND t.category_id = ti.category_id
    AND t.created_at = ti.todo_created_at
JOIN "user" u ON u.id = ti.user_id
JOIN category c ON c.id = ti.category_id;

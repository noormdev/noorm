-- =============================================================================
-- Tags By Entity View
-- Comprehensive view showing all tag-entity relationships
-- =============================================================================

CREATE OR REPLACE VIEW v_tags_by_entity AS

-- Tags on Todos
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    'todo' AS entity_type,
    tt.user_id,
    tt.category_id,
    tt.todo_created_at,
    NULL::INTEGER AS item_index,
    t.title AS entity_title,
    u.username AS user_username,
    tt.created_at AS tagged_at
FROM tag tg
JOIN todo_tag tt ON tt.tag_id = tg.id
JOIN todo t ON t.user_id = tt.user_id
    AND t.category_id = tt.category_id
    AND t.created_at = tt.todo_created_at
JOIN "user" u ON u.id = tt.user_id

UNION ALL

-- Tags on Todo Items
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    'todo_item' AS entity_type,
    tit.user_id,
    tit.category_id,
    tit.todo_created_at,
    tit.item_index,
    ti.title AS entity_title,
    u.username AS user_username,
    tit.created_at AS tagged_at
FROM tag tg
JOIN todo_item_tag tit ON tit.tag_id = tg.id
JOIN todo_item ti ON ti.user_id = tit.user_id
    AND ti.category_id = tit.category_id
    AND ti.todo_created_at = tit.todo_created_at
    AND ti.item_index = tit.item_index
JOIN "user" u ON u.id = tit.user_id

UNION ALL

-- Tags on Users
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    'user' AS entity_type,
    ut.user_id,
    NULL::INTEGER AS category_id,
    NULL::TIMESTAMP WITH TIME ZONE AS todo_created_at,
    NULL::INTEGER AS item_index,
    u.username AS entity_title,
    u.username AS user_username,
    ut.created_at AS tagged_at
FROM tag tg
JOIN user_tag ut ON ut.tag_id = tg.id
JOIN "user" u ON u.id = ut.user_id

ORDER BY tag_name, entity_type, tagged_at;

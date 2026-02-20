-- =============================================================================
-- Tag Usage Summary View
-- Shows tag usage counts across all entity types
-- =============================================================================

CREATE OR REPLACE VIEW v_tag_usage_summary AS
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    tg.created_at,
    (
        SELECT COUNT(*)
        FROM todo_tag tt
        WHERE tt.tag_id = tg.id
    ) AS todo_count,
    (
        SELECT COUNT(*)
        FROM todo_item_tag tit
        WHERE tit.tag_id = tg.id
    ) AS item_count,
    (
        SELECT COUNT(*)
        FROM user_tag ut
        WHERE ut.tag_id = tg.id
    ) AS user_count,
    (
        SELECT COUNT(*) FROM todo_tag tt WHERE tt.tag_id = tg.id
    ) + (
        SELECT COUNT(*) FROM todo_item_tag tit WHERE tit.tag_id = tg.id
    ) + (
        SELECT COUNT(*) FROM user_tag ut WHERE ut.tag_id = tg.id
    ) AS total_usage
FROM tag tg
ORDER BY total_usage DESC, tg.name;

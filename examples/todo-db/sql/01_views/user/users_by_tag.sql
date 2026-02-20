-- =============================================================================
-- Users By Tag View
-- Shows users associated with each tag
-- =============================================================================

CREATE OR REPLACE VIEW v_users_by_tag AS
SELECT
    tg.id AS tag_id,
    tg.name AS tag_name,
    tg.color AS tag_color,
    ut.user_id,
    u.username,
    u.email,
    ut.created_at AS tagged_at
FROM tag tg
LEFT JOIN user_tag ut ON ut.tag_id = tg.id
LEFT JOIN "user" u ON u.id = ut.user_id
ORDER BY tg.name, u.username;

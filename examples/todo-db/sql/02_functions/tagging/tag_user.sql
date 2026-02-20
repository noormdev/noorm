-- =============================================================================
-- Tag User Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION tag_user(
    p_user_id INTEGER,
    p_tag_id INTEGER
)
RETURNS TABLE (
    user_id INTEGER,
    tag_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    INSERT INTO user_tag (user_id, tag_id)
    VALUES (p_user_id, p_tag_id)
    ON CONFLICT DO NOTHING
    RETURNING
        user_tag.user_id,
        user_tag.tag_id,
        user_tag.created_at;
END;
$$;

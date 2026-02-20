-- =============================================================================
-- Tag Todo Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION tag_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_tag_id INTEGER
)
RETURNS TABLE (
    user_id INTEGER,
    category_id INTEGER,
    todo_created_at TIMESTAMP WITH TIME ZONE,
    tag_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    INSERT INTO todo_tag (user_id, category_id, todo_created_at, tag_id)
    VALUES (p_user_id, p_category_id, p_todo_created_at, p_tag_id)
    ON CONFLICT DO NOTHING
    RETURNING
        todo_tag.user_id,
        todo_tag.category_id,
        todo_tag.todo_created_at,
        todo_tag.tag_id,
        todo_tag.created_at;
END;
$$;

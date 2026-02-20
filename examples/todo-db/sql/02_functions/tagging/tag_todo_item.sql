-- =============================================================================
-- Tag Todo Item Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION tag_todo_item(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_item_index INTEGER,
    p_tag_id INTEGER
)
RETURNS TABLE (
    user_id INTEGER,
    category_id INTEGER,
    todo_created_at TIMESTAMP WITH TIME ZONE,
    item_index INTEGER,
    tag_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    INSERT INTO todo_item_tag (user_id, category_id, todo_created_at, item_index, tag_id)
    VALUES (p_user_id, p_category_id, p_todo_created_at, p_item_index, p_tag_id)
    ON CONFLICT DO NOTHING
    RETURNING
        todo_item_tag.user_id,
        todo_item_tag.category_id,
        todo_item_tag.todo_created_at,
        todo_item_tag.item_index,
        todo_item_tag.tag_id,
        todo_item_tag.created_at;
END;
$$;

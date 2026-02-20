-- =============================================================================
-- Get Todo Item Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION get_todo_item(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_item_index INTEGER
)
RETURNS TABLE (
    user_id INTEGER,
    category_id INTEGER,
    todo_created_at TIMESTAMP WITH TIME ZONE,
    item_index INTEGER,
    title VARCHAR(255),
    is_completed BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ti.user_id,
        ti.category_id,
        ti.todo_created_at,
        ti.item_index,
        ti.title,
        ti.is_completed,
        ti.created_at,
        ti.updated_at
    FROM todo_item ti
    WHERE ti.user_id = p_user_id
      AND ti.category_id = p_category_id
      AND ti.todo_created_at = p_todo_created_at
      AND ti.item_index = p_item_index;
END;
$$;

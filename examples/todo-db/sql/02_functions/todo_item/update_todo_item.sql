-- =============================================================================
-- Update Todo Item Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION update_todo_item(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_item_index INTEGER,
    p_title VARCHAR(255),
    p_is_completed BOOLEAN DEFAULT FALSE
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
    UPDATE todo_item
    SET
        title = p_title,
        is_completed = p_is_completed,
        updated_at = CURRENT_TIMESTAMP
    WHERE todo_item.user_id = p_user_id
      AND todo_item.category_id = p_category_id
      AND todo_item.todo_created_at = p_todo_created_at
      AND todo_item.item_index = p_item_index
    RETURNING
        todo_item.user_id,
        todo_item.category_id,
        todo_item.todo_created_at,
        todo_item.item_index,
        todo_item.title,
        todo_item.is_completed,
        todo_item.created_at,
        todo_item.updated_at;
END;
$$;

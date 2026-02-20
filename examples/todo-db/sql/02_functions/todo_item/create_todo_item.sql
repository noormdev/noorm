-- =============================================================================
-- Create Todo Item Procedure
-- Automatically calculates item_index as MAX(item_index) + 1 for the todo
-- =============================================================================

CREATE OR REPLACE FUNCTION create_todo_item(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_title VARCHAR(255)
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
DECLARE
    v_next_index INTEGER;
BEGIN
    -- Calculate next item_index for this todo
    SELECT COALESCE(MAX(ti.item_index), 0) + 1
    INTO v_next_index
    FROM todo_item ti
    WHERE ti.user_id = p_user_id
      AND ti.category_id = p_category_id
      AND ti.todo_created_at = p_todo_created_at;

    RETURN QUERY
    INSERT INTO todo_item (user_id, category_id, todo_created_at, item_index, title)
    VALUES (p_user_id, p_category_id, p_todo_created_at, v_next_index, p_title)
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

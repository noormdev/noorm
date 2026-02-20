-- =============================================================================
-- List Todo Items Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_todo_items()
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
    ORDER BY ti.user_id, ti.category_id, ti.todo_created_at, ti.item_index;
END;
$$;

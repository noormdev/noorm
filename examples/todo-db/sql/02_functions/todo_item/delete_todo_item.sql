-- =============================================================================
-- Delete Todo Item Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_todo_item(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_item_index INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM todo_item
    WHERE user_id = p_user_id
      AND category_id = p_category_id
      AND todo_created_at = p_todo_created_at
      AND item_index = p_item_index;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

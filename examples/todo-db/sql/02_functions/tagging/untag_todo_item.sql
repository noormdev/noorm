-- =============================================================================
-- Untag Todo Item Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION untag_todo_item(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_item_index INTEGER,
    p_tag_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM todo_item_tag
    WHERE user_id = p_user_id
      AND category_id = p_category_id
      AND todo_created_at = p_todo_created_at
      AND item_index = p_item_index
      AND tag_id = p_tag_id;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

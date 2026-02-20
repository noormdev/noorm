-- =============================================================================
-- Untag Todo Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION untag_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_todo_created_at TIMESTAMP WITH TIME ZONE,
    p_tag_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM todo_tag
    WHERE user_id = p_user_id
      AND category_id = p_category_id
      AND todo_created_at = p_todo_created_at
      AND tag_id = p_tag_id;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

-- =============================================================================
-- Delete Todo Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_created_at TIMESTAMP WITH TIME ZONE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM todo
    WHERE user_id = p_user_id
      AND category_id = p_category_id
      AND created_at = p_created_at;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

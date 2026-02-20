-- =============================================================================
-- Delete User Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_user(
    p_user_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM "user"
    WHERE id = p_user_id;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

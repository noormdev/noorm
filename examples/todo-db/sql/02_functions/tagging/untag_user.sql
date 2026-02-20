-- =============================================================================
-- Untag User Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION untag_user(
    p_user_id INTEGER,
    p_tag_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM user_tag
    WHERE user_id = p_user_id
      AND tag_id = p_tag_id;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

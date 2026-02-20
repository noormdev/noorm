-- =============================================================================
-- Delete Tag Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_tag(
    p_tag_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM tag
    WHERE id = p_tag_id;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

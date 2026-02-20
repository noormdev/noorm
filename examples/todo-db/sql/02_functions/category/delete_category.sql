-- =============================================================================
-- Delete Category Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_category(
    p_category_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM category
    WHERE id = p_category_id;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN rows_deleted > 0;
END;
$$;

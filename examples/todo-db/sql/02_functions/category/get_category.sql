-- =============================================================================
-- Get Category Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION get_category(
    p_category_id INTEGER
)
RETURNS TABLE (
    id INTEGER,
    name VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.name,
        c.description,
        c.created_at
    FROM category c
    WHERE c.id = p_category_id;
END;
$$;

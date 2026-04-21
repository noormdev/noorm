-- =============================================================================
-- List Categories Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_categories(
    p_limit INTEGER DEFAULT NULL,
    p_offset INTEGER DEFAULT 0
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
    ORDER BY c.name ASC
    LIMIT p_limit
    OFFSET COALESCE(p_offset, 0);
END;
$$;

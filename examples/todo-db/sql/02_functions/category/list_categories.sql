-- =============================================================================
-- List Categories Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_categories()
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
    ORDER BY c.name ASC;
END;
$$;

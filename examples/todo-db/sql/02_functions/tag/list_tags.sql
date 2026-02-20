-- =============================================================================
-- List Tags Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_tags()
RETURNS TABLE (
    id INTEGER,
    name VARCHAR(50),
    color VARCHAR(7),
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.color,
        t.created_at
    FROM tag t
    ORDER BY t.name ASC;
END;
$$;

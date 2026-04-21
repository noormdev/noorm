-- =============================================================================
-- List Tags Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_tags(
    p_limit INTEGER DEFAULT NULL,
    p_offset INTEGER DEFAULT 0
)
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
    ORDER BY t.name ASC
    LIMIT p_limit
    OFFSET COALESCE(p_offset, 0);
END;
$$;

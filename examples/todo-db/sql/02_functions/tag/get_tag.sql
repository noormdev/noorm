-- =============================================================================
-- Get Tag Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION get_tag(
    p_tag_id INTEGER
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
    WHERE t.id = p_tag_id;
END;
$$;

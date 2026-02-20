-- =============================================================================
-- Create Tag Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION create_tag(
    p_name VARCHAR(50),
    p_color VARCHAR(7) DEFAULT '#808080'
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
    INSERT INTO tag (name, color)
    VALUES (p_name, p_color)
    RETURNING
        tag.id,
        tag.name,
        tag.color,
        tag.created_at;
END;
$$;

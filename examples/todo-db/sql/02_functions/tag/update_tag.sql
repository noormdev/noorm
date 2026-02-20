-- =============================================================================
-- Update Tag Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION update_tag(
    p_tag_id INTEGER,
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
    UPDATE tag
    SET
        name = p_name,
        color = p_color
    WHERE tag.id = p_tag_id
    RETURNING
        tag.id,
        tag.name,
        tag.color,
        tag.created_at;
END;
$$;

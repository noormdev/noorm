-- =============================================================================
-- Update Category Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION update_category(
    p_category_id INTEGER,
    p_name VARCHAR(100),
    p_description TEXT DEFAULT NULL
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
    UPDATE category
    SET
        name = p_name,
        description = p_description
    WHERE category.id = p_category_id
    RETURNING
        category.id,
        category.name,
        category.description,
        category.created_at;
END;
$$;

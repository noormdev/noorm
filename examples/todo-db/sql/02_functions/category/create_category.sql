-- =============================================================================
-- Create Category Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION create_category(
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
    INSERT INTO category (name, description)
    VALUES (p_name, p_description)
    RETURNING
        category.id,
        category.name,
        category.description,
        category.created_at;
END;
$$;

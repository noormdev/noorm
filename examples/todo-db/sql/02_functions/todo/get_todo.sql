-- =============================================================================
-- Get Todo Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION get_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_created_at TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    user_id INTEGER,
    category_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    title VARCHAR(255),
    description TEXT,
    status VARCHAR(20),
    priority INTEGER,
    due_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.user_id,
        t.category_id,
        t.created_at,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.updated_at
    FROM todo t
    WHERE t.user_id = p_user_id
      AND t.category_id = p_category_id
      AND t.created_at = p_created_at;
END;
$$;

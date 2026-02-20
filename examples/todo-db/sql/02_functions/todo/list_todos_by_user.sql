-- =============================================================================
-- List Todos By User Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_todos_by_user(
    p_user_id INTEGER
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
    ORDER BY t.priority DESC, t.due_date ASC NULLS LAST, t.created_at DESC;
END;
$$;

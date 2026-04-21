-- =============================================================================
-- List Todos By Category Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_todos_by_category(
    p_category_id INTEGER,
    p_limit INTEGER DEFAULT NULL,
    p_offset INTEGER DEFAULT 0
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
    metadata JSONB,
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
        t.metadata,
        t.updated_at
    FROM todo t
    WHERE t.category_id = p_category_id
    ORDER BY t.priority DESC, t.due_date ASC NULLS LAST, t.created_at DESC
    LIMIT p_limit
    OFFSET COALESCE(p_offset, 0);
END;
$$;

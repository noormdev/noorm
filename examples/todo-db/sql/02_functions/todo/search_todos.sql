-- =============================================================================
-- Search Todos (Table-Valued Function)
-- Free-text search across todo title/description with joined user + category
-- context and tag aggregation. Returns the same shape as v_todos_with_details
-- but filtered + paginated. Illustrates a "pure" Postgres TVF — no INSERT,
-- just a SETOF record over a JOIN.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_todos(
    p_keyword TEXT DEFAULT NULL,
    p_status VARCHAR(20) DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
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
    user_username VARCHAR(50),
    category_name VARCHAR(100),
    tags TEXT[]
)
LANGUAGE sql
STABLE
AS $$
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
        u.username AS user_username,
        c.name AS category_name,
        COALESCE(
            (
                SELECT ARRAY_AGG(tg.name ORDER BY tg.name)
                FROM todo_tag tt
                JOIN tag tg ON tg.id = tt.tag_id
                WHERE tt.user_id = t.user_id
                  AND tt.category_id = t.category_id
                  AND tt.todo_created_at = t.created_at
            ),
            ARRAY[]::TEXT[]
        ) AS tags
    FROM todo t
    JOIN "user" u ON u.id = t.user_id
    JOIN category c ON c.id = t.category_id
    WHERE (p_keyword IS NULL
           OR t.title ILIKE '%' || p_keyword || '%'
           OR t.description ILIKE '%' || p_keyword || '%')
      AND (p_status IS NULL OR t.status = p_status)
      AND u.deleted_at IS NULL
    ORDER BY t.created_at DESC
    LIMIT COALESCE(p_limit, 50)
    OFFSET COALESCE(p_offset, 0);
$$;

-- =============================================================================
-- List Users Procedure
-- Set p_include_deleted = TRUE to include soft-deleted rows.
-- =============================================================================

CREATE OR REPLACE FUNCTION list_users(
    p_include_deleted BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT NULL,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id INTEGER,
    username VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.username,
        u.email,
        u.created_at,
        u.updated_at,
        u.deleted_at
    FROM "user" u
    WHERE p_include_deleted OR u.deleted_at IS NULL
    ORDER BY u.created_at DESC
    LIMIT p_limit
    OFFSET COALESCE(p_offset, 0);
END;
$$;

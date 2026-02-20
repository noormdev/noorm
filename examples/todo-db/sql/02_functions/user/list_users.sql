-- =============================================================================
-- List Users Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION list_users()
RETURNS TABLE (
    id INTEGER,
    username VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
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
        u.updated_at
    FROM "user" u
    ORDER BY u.created_at DESC;
END;
$$;

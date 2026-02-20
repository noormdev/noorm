-- =============================================================================
-- Create User Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION create_user(
    p_username VARCHAR(50),
    p_email VARCHAR(255)
)
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
    INSERT INTO "user" (username, email)
    VALUES (p_username, p_email)
    RETURNING
        "user".id,
        "user".username,
        "user".email,
        "user".created_at,
        "user".updated_at;
END;
$$;

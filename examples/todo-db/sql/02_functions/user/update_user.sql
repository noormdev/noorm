-- =============================================================================
-- Update User Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION update_user(
    p_user_id INTEGER,
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
    UPDATE "user"
    SET
        username = p_username,
        email = p_email,
        updated_at = CURRENT_TIMESTAMP
    WHERE "user".id = p_user_id
    RETURNING
        "user".id,
        "user".username,
        "user".email,
        "user".created_at,
        "user".updated_at;
END;
$$;

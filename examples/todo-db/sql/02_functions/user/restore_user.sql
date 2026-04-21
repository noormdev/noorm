-- =============================================================================
-- Restore User
-- Reverses a soft-delete. Raises if the user does not exist; silently
-- succeeds if the user was never archived. Returns the refreshed row so
-- callers can confirm state.
-- =============================================================================

CREATE OR REPLACE FUNCTION restore_user(
    p_user_id INTEGER
)
RETURNS TABLE (
    id INTEGER,
    username VARCHAR(50),
    deleted_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = p_user_id) THEN
        RAISE EXCEPTION 'User % not found', p_user_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE "user"
    SET deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE "user".id = p_user_id
      AND "user".deleted_at IS NOT NULL;

    RETURN QUERY
    SELECT u.id, u.username, u.deleted_at
    FROM "user" u
    WHERE u.id = p_user_id;
END;
$$;

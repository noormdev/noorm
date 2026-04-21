-- =============================================================================
-- Soft Delete User
-- Archives a user by stamping deleted_at instead of removing the row. Keeps
-- history and FK'd todos intact. Idempotent — a second call is a no-op and
-- returns the original deletion timestamp so callers can detect "already
-- deleted" without a race.
-- =============================================================================

CREATE OR REPLACE FUNCTION soft_delete_user(
    p_user_id INTEGER
)
RETURNS TABLE (
    id INTEGER,
    username VARCHAR(50),
    deleted_at TIMESTAMP WITH TIME ZONE,
    was_already_deleted BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_deleted_at TIMESTAMP WITH TIME ZONE;
    v_found BOOLEAN;
BEGIN
    SELECT u.deleted_at, TRUE INTO v_existing_deleted_at, v_found
    FROM "user" u
    WHERE u.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_existing_deleted_at IS NOT NULL THEN
        RETURN QUERY
        SELECT u.id, u.username, u.deleted_at, TRUE AS was_already_deleted
        FROM "user" u
        WHERE u.id = p_user_id;
        RETURN;
    END IF;

    UPDATE "user"
    SET deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE "user".id = p_user_id;

    RETURN QUERY
    SELECT u.id, u.username, u.deleted_at, FALSE AS was_already_deleted
    FROM "user" u
    WHERE u.id = p_user_id;
END;
$$;

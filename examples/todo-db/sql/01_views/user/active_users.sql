-- =============================================================================
-- Active Users View
-- Canonical way to read live users. Hides soft-deleted rows so application
-- code does not need to remember "WHERE deleted_at IS NULL" on every query.
-- =============================================================================

CREATE OR REPLACE VIEW v_active_users AS
SELECT
    id,
    username,
    email,
    created_at,
    updated_at
FROM "user"
WHERE deleted_at IS NULL;

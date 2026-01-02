-- SQLite View for CI Test

CREATE VIEW IF NOT EXISTS v_active_users AS
SELECT
    id,
    email,
    username,
    display_name,
    created_at,
    updated_at
FROM users

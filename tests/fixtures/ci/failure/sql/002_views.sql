-- SQLite Views with INTENTIONAL SYNTAX ERROR for CI failure testing
-- This file is designed to cause a parse error when executed

DROP VIEW IF EXISTS v_active_users;
CREATE VIEW v_active_users AS
SELECT
    id,
    email,
    username
    display_name  -- INTENTIONAL ERROR: missing comma above
FROM users
WHERE deleted_at IS NULL;

-- =============================================================================
-- Revert 002 — Drop new views and functions
-- =============================================================================
-- The signature-changed functions (create_todo / update_todo / get_todo /
-- list_*) stay with their new signatures — see changelog.md for why. Fully
-- reverting those requires checking out the previous sql/ revision and
-- re-running `noorm run build`.
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS v_active_users;

DROP FUNCTION IF EXISTS complete_todo(INTEGER, INTEGER, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS search_todos(TEXT, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS bulk_create_tags(tag_input[]);
DROP FUNCTION IF EXISTS soft_delete_user(INTEGER);
DROP FUNCTION IF EXISTS restore_user(INTEGER);

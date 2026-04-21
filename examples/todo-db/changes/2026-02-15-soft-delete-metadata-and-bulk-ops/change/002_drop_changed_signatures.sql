-- =============================================================================
-- 002 — Drop functions whose signature or return type changed
-- =============================================================================
-- CREATE OR REPLACE FUNCTION cannot change return type or argument list, so
-- functions that now return `metadata` or take new pagination parameters must
-- be dropped before they can be recreated from the updated files in stage 003.
--
-- DROP FUNCTION IF EXISTS with a full argument type list targets only the old
-- signatures. If the old signature is already gone (fresh DB), this is a
-- no-op.
-- -----------------------------------------------------------------------------

-- todo
DROP FUNCTION IF EXISTS create_todo(INTEGER, INTEGER, VARCHAR, TEXT, INTEGER, DATE);
DROP FUNCTION IF EXISTS update_todo(INTEGER, INTEGER, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT, VARCHAR, INTEGER, DATE);
DROP FUNCTION IF EXISTS get_todo(INTEGER, INTEGER, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS list_todos();
DROP FUNCTION IF EXISTS list_todos_by_user(INTEGER);
DROP FUNCTION IF EXISTS list_todos_by_category(INTEGER);

-- todo_item
DROP FUNCTION IF EXISTS list_todo_items();
DROP FUNCTION IF EXISTS list_todo_items_by_todo(INTEGER, INTEGER, TIMESTAMP WITH TIME ZONE);

-- user
DROP FUNCTION IF EXISTS list_users();

-- category / tag
DROP FUNCTION IF EXISTS list_categories();
DROP FUNCTION IF EXISTS list_tags();

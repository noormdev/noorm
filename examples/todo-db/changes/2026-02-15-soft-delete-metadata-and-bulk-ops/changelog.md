# Changelog


## Description

Evolves the schema with soft-delete semantics, JSONB `metadata` on todos, a
composite type for bulk tag input, idempotent cron tables, a feature-flag
table, and a transactional `complete_todo` stored procedure. Also seeds
three system tags and attaches the `system` tag to every existing todo.


## Changes

- `user.deleted_at` column + `idx_user_active` partial index
- `todo.metadata` JSONB column + GIN index
- `tag_input` composite type (TVP-style input for `bulk_create_tags`)
- `cron_job`, `cron_schedule`, `cron_job_schedule` tables (created idempotently)
- `feature_flag` table (paired with a vault-aware seed template)
- `v_active_users` view (canonical read path for live users)
- `v_todos_with_details` — adds `metadata` at the end of the column list
- New functions:
    - `complete_todo(...)` — transactional SP that flips a todo + all its items
    - `search_todos(...)` — TVF over todos with join + pagination
    - `bulk_create_tags(tag_input[])` — TVP-style bulk upsert
    - `soft_delete_user(...)` / `restore_user(...)`
- Signature updates (return type or parameters changed, hence DROP + recreate):
    - `create_todo`, `update_todo`, `get_todo` — added `metadata` column / parameter
    - `list_todos`, `list_todos_by_user`, `list_todos_by_category` — pagination + `metadata`
    - `list_todo_items`, `list_todo_items_by_todo` — pagination
    - `list_users` — pagination + `p_include_deleted` flag + `deleted_at` column
    - `list_categories`, `list_tags` — pagination
- Seed: system tags (`system`, `urgent`, `deferred`) + attach `system` to every existing todo


## Impact

- All table changes are idempotent (`ADD COLUMN IF NOT EXISTS`, guarded `CREATE TYPE`, `CREATE TABLE IF NOT EXISTS`).
- Signature-changed functions are DROPped before recreation — in-flight clients
  will see a brief gap where those functions do not exist. Apply during a
  quiet window or wrap the whole change in a transaction (noorm does this by
  default for single-stage DDL).
- Revert removes the new columns, types, tables, views, functions, and the
  seeded system tags. It does **not** restore the pre-metadata signatures of
  `create_todo`, `update_todo`, `get_todo`, or the non-paginated `list_*`
  functions — those are tied to the v1 file contents in git. If you need to
  roll all the way back, check out the previous revision of `sql/02_functions/`
  and re-run `noorm run build`.

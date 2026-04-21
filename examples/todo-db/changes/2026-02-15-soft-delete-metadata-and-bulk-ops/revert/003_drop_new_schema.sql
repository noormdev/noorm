-- =============================================================================
-- Revert 003 — Drop new columns, composite type, and new tables
-- =============================================================================
-- Runs last so dependent objects (views, functions) are already gone.
-- -----------------------------------------------------------------------------

-- Drop new tables (cron + feature_flag).
DROP TABLE IF EXISTS cron_job_schedule;
DROP TABLE IF EXISTS cron_schedule;
DROP TABLE IF EXISTS cron_job;
DROP TABLE IF EXISTS feature_flag;

-- Drop composite type used by bulk_create_tags.
DROP TYPE IF EXISTS tag_input;

-- Drop metadata column + its GIN index (index drops implicitly with the column).
ALTER TABLE todo DROP COLUMN IF EXISTS metadata;

-- Drop soft-delete column + the partial "active" index.
DROP INDEX IF EXISTS idx_user_active;
ALTER TABLE "user" DROP COLUMN IF EXISTS deleted_at;

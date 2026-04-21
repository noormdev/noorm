-- =============================================================================
-- Composite Types
-- =============================================================================
-- Composite types used as structured inputs to set-returning and "TVP-style"
-- functions. Creating them at the top of the schema build keeps the rest of
-- the SQL files able to reference them without ordering headaches.
-- -----------------------------------------------------------------------------

-- tag_input
-- Used by bulk_create_tags() to accept an array of (name, color) pairs
-- in a single call (Postgres' closest analog to a SQL Server TVP).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tag_input') THEN
        CREATE TYPE tag_input AS (
            name  VARCHAR(50),
            color VARCHAR(7)
        );
    END IF;
END
$$;

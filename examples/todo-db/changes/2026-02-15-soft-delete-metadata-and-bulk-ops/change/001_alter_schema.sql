-- =============================================================================
-- 001 — Additive schema changes
-- =============================================================================
-- All statements are idempotent so re-running this change (or applying it on
-- top of an already-migrated database) is a no-op.
-- -----------------------------------------------------------------------------

-- Soft-delete column + partial index for fast "active" reads.
ALTER TABLE "user"
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS idx_user_active
    ON "user" (id)
    WHERE deleted_at IS NULL;


-- JSONB metadata on todo + GIN index for membership / path queries.
ALTER TABLE todo
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_todo_metadata
    ON todo USING GIN (metadata);


-- Composite type used as a TVP-style input to bulk_create_tags().
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


-- Cron tables (stand-in for pg_cron so the schema installs on any Postgres).
CREATE TABLE IF NOT EXISTS cron_job (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_cron_job_steps_is_array
        CHECK (jsonb_typeof(steps) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_cron_job_enabled ON cron_job (enabled);

CREATE TABLE IF NOT EXISTS cron_schedule (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    active_start_time CHAR(6) NOT NULL,
    frequency VARCHAR(20) NOT NULL,
    interval VARCHAR(20),
    every VARCHAR(20),
    every_n INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_cron_schedule_frequency
        CHECK (frequency IN ('Once', 'Daily', 'Weekly', 'Monthly', 'MonthlyRelative', 'OnStart', 'OnIdle')),

    CONSTRAINT chk_cron_schedule_every
        CHECK (every IS NULL OR every IN ('Seconds', 'Minutes', 'Hours')),

    CONSTRAINT chk_cron_schedule_time_format
        CHECK (active_start_time ~ '^[0-9]{6}$')
);

CREATE TABLE IF NOT EXISTS cron_job_schedule (
    job_id INTEGER NOT NULL,
    schedule_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (job_id, schedule_id),

    CONSTRAINT cron_job_schedule_references_job
        FOREIGN KEY (job_id) REFERENCES cron_job (id)
        ON DELETE CASCADE,

    CONSTRAINT cron_job_schedule_references_schedule
        FOREIGN KEY (schedule_id) REFERENCES cron_schedule (id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cron_job_schedule_schedule_id
    ON cron_job_schedule (schedule_id);


-- Feature flag table. Seeded by 10_seeds/feature_flags.sql.tmpl (vault-aware).
CREATE TABLE IF NOT EXISTS feature_flag (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_feature_flag_config_is_object
        CHECK (jsonb_typeof(config) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_enabled ON feature_flag (enabled);

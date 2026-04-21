-- =============================================================================
-- Cron Tables
-- =============================================================================
-- Internal cron tables used in place of pg_cron so the schema builds on any
-- stock Postgres image (CI, laptops, managed clouds). A real deployment can
-- swap these out for pg_cron or a job runner — the YAML-driven template in
-- sql/10_seeds/cron/ targets the same shape either way.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Cron Job
-- A logical unit of work. One job can be attached to many schedules.
-- -----------------------------------------------------------------------------
CREATE TABLE cron_job (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    -- Ordered list of steps to run. Each step is { name, command }.
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_cron_job_steps_is_array
        CHECK (jsonb_typeof(steps) = 'array')
);

CREATE INDEX idx_cron_job_enabled ON cron_job (enabled);

-- -----------------------------------------------------------------------------
-- Cron Schedule
-- A recurrence rule. Mirrors the human-friendly YAML vocabulary
-- (frequency=Daily|Weekly|Monthly, interval=Monday|6, every=Minutes|Hours).
-- -----------------------------------------------------------------------------
CREATE TABLE cron_schedule (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    -- 'HHMMSS' (e.g. '030000' = 03:00:00).
    active_start_time CHAR(6) NOT NULL,
    frequency VARCHAR(20) NOT NULL,
    -- Day name for Weekly, day-of-month number-as-text for Monthly, NULL for Daily.
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

-- -----------------------------------------------------------------------------
-- Cron Job Schedule (junction)
-- Attaches jobs to schedules. One schedule runs many jobs; one job can be
-- triggered by many schedules.
-- -----------------------------------------------------------------------------
CREATE TABLE cron_job_schedule (
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

CREATE INDEX idx_cron_job_schedule_schedule_id ON cron_job_schedule (schedule_id);

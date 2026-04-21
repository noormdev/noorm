-- =============================================================================
-- Feature Flag Table
-- =============================================================================
-- Runtime-toggleable flags. Seed values are provided by the
-- sql/10_seeds/feature_flags.sql.tmpl template, which pulls secret-backed
-- values from the noorm vault when available and falls back to safe defaults
-- when running outside a vault context (e.g. ephemeral test configs).
-- -----------------------------------------------------------------------------

CREATE TABLE feature_flag (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Opaque per-flag payload (audience, rollout %, provider tokens, etc.).
    -- Templates may write vault secrets in here; clients should treat it as
    -- sensitive and not log it verbatim.
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_feature_flag_config_is_object
        CHECK (jsonb_typeof(config) = 'object')
);

CREATE INDEX idx_feature_flag_enabled ON feature_flag (enabled);

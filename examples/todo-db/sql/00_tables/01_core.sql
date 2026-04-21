-- =============================================================================
-- Core Domain Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- User Table
-- The primary entity that manages todos
-- -----------------------------------------------------------------------------
CREATE TABLE "user" (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Soft-delete marker. NULL = active; a timestamp = archived.
    -- Consumers should read through v_active_users instead of filtering manually.
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);

-- Indexes
CREATE INDEX idx_user_username ON "user" (username);
CREATE INDEX idx_user_email ON "user" (email);
CREATE INDEX idx_user_created_at ON "user" (created_at);
-- Partial index: only live rows need the fast path.
CREATE INDEX idx_user_active ON "user" (id) WHERE deleted_at IS NULL;


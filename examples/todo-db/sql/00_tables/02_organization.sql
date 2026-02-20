-- =============================================================================
-- Organization Domain Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Category Table
-- Categorizes todos into logical groupings
-- -----------------------------------------------------------------------------
CREATE TABLE category (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_category_name ON category (name);

-- -----------------------------------------------------------------------------
-- Tag Table
-- Labels that can be applied to users, todos, and todo items
-- -----------------------------------------------------------------------------
CREATE TABLE tag (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#808080',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_tag_name ON tag (name);


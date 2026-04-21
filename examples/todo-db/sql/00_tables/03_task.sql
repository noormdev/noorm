-- =============================================================================
-- Task Domain Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Todo Table
-- The main task entity, managed by a user and categorized
-- Composite PK: (user_id, category_id, created_at)
-- -----------------------------------------------------------------------------
CREATE TABLE todo (
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    due_date DATE,
    -- Structured side-band data for a todo. Clients treat this as a free-form
    -- extension point (labels, source info, external IDs). Indexed with GIN
    -- below for membership / path queries.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Composite Primary Key (inherited identity)
    PRIMARY KEY (user_id, category_id, created_at),

    -- Foreign Keys with business verbiage
    CONSTRAINT user_manages_todo
        FOREIGN KEY (user_id) REFERENCES "user" (id)
        ON DELETE CASCADE,

    CONSTRAINT todo_is_categorized_by_category
        FOREIGN KEY (category_id) REFERENCES category (id)
        ON DELETE RESTRICT,

    -- Check constraints
    CONSTRAINT chk_todo_status
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),

    CONSTRAINT chk_todo_priority
        CHECK (priority >= 0 AND priority <= 5)
);

-- Indexes
CREATE INDEX idx_todo_user_id ON todo (user_id);
CREATE INDEX idx_todo_category_id ON todo (category_id);
CREATE INDEX idx_todo_status ON todo (status);
CREATE INDEX idx_todo_priority ON todo (priority);
CREATE INDEX idx_todo_due_date ON todo (due_date);
CREATE INDEX idx_todo_metadata ON todo USING GIN (metadata);

-- -----------------------------------------------------------------------------
-- Todo Item Table
-- Individual items within a todo, ordered by item_index
-- Composite PK: (user_id, category_id, todo_created_at, item_index)
-- -----------------------------------------------------------------------------
CREATE TABLE todo_item (
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    todo_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    item_index INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Composite Primary Key (inherited from todo + item_index)
    PRIMARY KEY (user_id, category_id, todo_created_at, item_index),

    -- Foreign Key with business verbiage
    CONSTRAINT todo_is_comprised_of_items
        FOREIGN KEY (user_id, category_id, todo_created_at)
        REFERENCES todo (user_id, category_id, created_at)
        ON DELETE CASCADE,

    -- Check constraint
    CONSTRAINT chk_item_index_positive
        CHECK (item_index > 0)
);

-- Indexes
CREATE INDEX idx_todo_item_todo ON todo_item (user_id, category_id, todo_created_at);
CREATE INDEX idx_todo_item_is_completed ON todo_item (is_completed);


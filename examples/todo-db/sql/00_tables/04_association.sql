-- =============================================================================
-- Association (Junction) Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Todo Tag Junction Table
-- Associates tags with todos
-- -----------------------------------------------------------------------------
CREATE TABLE todo_tag (
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    todo_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Composite Primary Key
    PRIMARY KEY (user_id, category_id, todo_created_at, tag_id),

    -- Foreign Keys with business verbiage
    CONSTRAINT todo_has_tag
        FOREIGN KEY (user_id, category_id, todo_created_at)
        REFERENCES todo (user_id, category_id, created_at)
        ON DELETE CASCADE,

    CONSTRAINT todo_tag_references_tag
        FOREIGN KEY (tag_id) REFERENCES tag (id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_todo_tag_todo ON todo_tag (user_id, category_id, todo_created_at);
CREATE INDEX idx_todo_tag_tag_id ON todo_tag (tag_id);

-- -----------------------------------------------------------------------------
-- Todo Item Tag Junction Table
-- Associates tags with todo items
-- -----------------------------------------------------------------------------
CREATE TABLE todo_item_tag (
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    todo_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    item_index INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Composite Primary Key
    PRIMARY KEY (user_id, category_id, todo_created_at, item_index, tag_id),

    -- Foreign Keys with business verbiage
    CONSTRAINT item_has_tag
        FOREIGN KEY (user_id, category_id, todo_created_at, item_index)
        REFERENCES todo_item (user_id, category_id, todo_created_at, item_index)
        ON DELETE CASCADE,

    CONSTRAINT item_tag_references_tag
        FOREIGN KEY (tag_id) REFERENCES tag (id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_todo_item_tag_item ON todo_item_tag (user_id, category_id, todo_created_at, item_index);
CREATE INDEX idx_todo_item_tag_tag_id ON todo_item_tag (tag_id);

-- -----------------------------------------------------------------------------
-- User Tag Junction Table
-- Associates tags with users
-- -----------------------------------------------------------------------------
CREATE TABLE user_tag (
    user_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Composite Primary Key
    PRIMARY KEY (user_id, tag_id),

    -- Foreign Keys with business verbiage
    CONSTRAINT user_is_associated_with_tag
        FOREIGN KEY (user_id) REFERENCES "user" (id)
        ON DELETE CASCADE,

    CONSTRAINT user_tag_references_tag
        FOREIGN KEY (tag_id) REFERENCES tag (id)
        ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_user_tag_user_id ON user_tag (user_id);
CREATE INDEX idx_user_tag_tag_id ON user_tag (tag_id);


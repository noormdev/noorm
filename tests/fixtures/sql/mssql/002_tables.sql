-- MSSQL Tables - Test Fixtures
-- Adapted from PostgreSQL: UUID→UNIQUEIDENTIFIER, TIMESTAMPTZ→DATETIMEOFFSET

CREATE TABLE users (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    avatar_url VARCHAR(MAX),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    deleted_at DATETIMEOFFSET NULL
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_username ON users(username) WHERE deleted_at IS NULL;

CREATE TABLE todo_lists (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description VARCHAR(MAX),
    color VARCHAR(7),
    position INT NOT NULL DEFAULT 0,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    deleted_at DATETIMEOFFSET NULL,
    CONSTRAINT FK_todo_lists_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_todo_lists_user_id ON todo_lists(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_todo_lists_position ON todo_lists(user_id, position) WHERE deleted_at IS NULL;

CREATE TABLE todo_items (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    list_id UNIQUEIDENTIFIER NOT NULL,
    title VARCHAR(500) NOT NULL,
    description VARCHAR(MAX),
    is_completed BIT NOT NULL DEFAULT 0,
    priority TINYINT NOT NULL DEFAULT 0,
    due_date DATETIMEOFFSET NULL,
    completed_at DATETIMEOFFSET NULL,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    deleted_at DATETIMEOFFSET NULL,
    CONSTRAINT FK_todo_items_list FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE,
    CONSTRAINT CK_todo_items_priority CHECK (priority >= 0 AND priority <= 3)
);

CREATE INDEX idx_todo_items_list_id ON todo_items(list_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_todo_items_position ON todo_items(list_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_todo_items_due_date ON todo_items(due_date) WHERE deleted_at IS NULL AND is_completed = 0;

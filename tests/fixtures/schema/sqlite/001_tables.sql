-- SQLite Tables for Test Schema
-- Adapted from PostgreSQL: UUID→TEXT, TIMESTAMPTZ→TEXT (ISO 8601)

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS todo_lists (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_todo_lists_user_id ON todo_lists(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_lists_position ON todo_lists(user_id, position) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS todo_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    list_id TEXT NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    is_completed INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 3),
    due_date TEXT,
    completed_at TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_todo_items_list_id ON todo_items(list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_items_position ON todo_items(list_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_items_due_date ON todo_items(due_date) WHERE deleted_at IS NULL AND is_completed = 0;

-- SQLite Triggers - Test Fixtures
-- Audit triggers for tracking changes

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    row_id TEXT NOT NULL,
    old_data TEXT,
    new_data TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trigger for user inserts
CREATE TRIGGER IF NOT EXISTS users_audit_insert
AFTER INSERT ON users
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, new_data)
    VALUES ('users', 'INSERT', NEW.id, json_object(
        'id', NEW.id,
        'email', NEW.email,
        'username', NEW.username,
        'display_name', NEW.display_name,
        'avatar_url', NEW.avatar_url,
        'created_at', NEW.created_at,
        'updated_at', NEW.updated_at,
        'deleted_at', NEW.deleted_at
    ));
END;

CREATE TRIGGER IF NOT EXISTS users_audit_update
AFTER UPDATE ON users
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
    VALUES ('users', 'UPDATE', NEW.id,
        json_object(
            'id', OLD.id,
            'email', OLD.email,
            'username', OLD.username,
            'display_name', OLD.display_name,
            'avatar_url', OLD.avatar_url,
            'created_at', OLD.created_at,
            'updated_at', OLD.updated_at,
            'deleted_at', OLD.deleted_at
        ),
        json_object(
            'id', NEW.id,
            'email', NEW.email,
            'username', NEW.username,
            'display_name', NEW.display_name,
            'avatar_url', NEW.avatar_url,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at,
            'deleted_at', NEW.deleted_at
        )
    );
END;

CREATE TRIGGER IF NOT EXISTS users_audit_delete
AFTER DELETE ON users
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, old_data)
    VALUES ('users', 'DELETE', OLD.id, json_object(
        'id', OLD.id,
        'email', OLD.email,
        'username', OLD.username,
        'display_name', OLD.display_name,
        'avatar_url', OLD.avatar_url,
        'created_at', OLD.created_at,
        'updated_at', OLD.updated_at,
        'deleted_at', OLD.deleted_at
    ));
END;

-- Audit trigger for todo_items
CREATE TRIGGER IF NOT EXISTS todo_items_audit_insert
AFTER INSERT ON todo_items
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, new_data)
    VALUES ('todo_items', 'INSERT', NEW.id, json_object(
        'id', NEW.id,
        'list_id', NEW.list_id,
        'title', NEW.title,
        'is_completed', NEW.is_completed,
        'created_at', NEW.created_at
    ));
END;

CREATE TRIGGER IF NOT EXISTS todo_items_before_delete
BEFORE DELETE ON todo_items
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, old_data)
    VALUES ('todo_items', 'DELETE', OLD.id, json_object(
        'id', OLD.id,
        'list_id', OLD.list_id,
        'title', OLD.title,
        'is_completed', OLD.is_completed,
        'deleted_at', OLD.deleted_at
    ));
END;

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS users_update_timestamp
AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS todo_lists_update_timestamp
AFTER UPDATE ON todo_lists
BEGIN
    UPDATE todo_lists SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS todo_items_update_timestamp
AFTER UPDATE ON todo_items
BEGIN
    UPDATE todo_items SET updated_at = datetime('now') WHERE id = NEW.id;
END;

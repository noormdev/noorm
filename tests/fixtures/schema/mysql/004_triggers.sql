-- MySQL Triggers for Test Schema
-- Audit triggers for tracking changes

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(10) NOT NULL,
    row_id TEXT NOT NULL,
    old_data JSON,
    new_data JSON,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Audit trigger for user inserts
DELIMITER //
CREATE TRIGGER users_audit_insert
AFTER INSERT ON users
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, new_data)
    VALUES ('users', 'INSERT', NEW.id, JSON_OBJECT(
        'id', NEW.id,
        'email', NEW.email,
        'username', NEW.username,
        'display_name', NEW.display_name,
        'avatar_url', NEW.avatar_url,
        'created_at', NEW.created_at,
        'updated_at', NEW.updated_at,
        'deleted_at', NEW.deleted_at
    ));
END//

CREATE TRIGGER users_audit_update
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
    VALUES ('users', 'UPDATE', NEW.id,
        JSON_OBJECT(
            'id', OLD.id,
            'email', OLD.email,
            'username', OLD.username,
            'display_name', OLD.display_name,
            'avatar_url', OLD.avatar_url,
            'created_at', OLD.created_at,
            'updated_at', OLD.updated_at,
            'deleted_at', OLD.deleted_at
        ),
        JSON_OBJECT(
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
END//

CREATE TRIGGER users_audit_delete
AFTER DELETE ON users
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, old_data)
    VALUES ('users', 'DELETE', OLD.id, JSON_OBJECT(
        'id', OLD.id,
        'email', OLD.email,
        'username', OLD.username,
        'display_name', OLD.display_name,
        'avatar_url', OLD.avatar_url,
        'created_at', OLD.created_at,
        'updated_at', OLD.updated_at,
        'deleted_at', OLD.deleted_at
    ));
END//

CREATE TRIGGER todo_items_audit_insert
AFTER INSERT ON todo_items
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, new_data)
    VALUES ('todo_items', 'INSERT', NEW.id, JSON_OBJECT(
        'id', NEW.id,
        'list_id', NEW.list_id,
        'title', NEW.title,
        'is_completed', NEW.is_completed,
        'created_at', NEW.created_at
    ));
END//

CREATE TRIGGER todo_items_audit_delete
BEFORE DELETE ON todo_items
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, operation, row_id, old_data)
    VALUES ('todo_items', 'DELETE', OLD.id, JSON_OBJECT(
        'id', OLD.id,
        'list_id', OLD.list_id,
        'title', OLD.title,
        'is_completed', OLD.is_completed,
        'deleted_at', OLD.deleted_at
    ));
END//
DELIMITER ;

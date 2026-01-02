-- MSSQL Triggers - Test Fixtures
-- Audit triggers for tracking changes

-- Audit log table
CREATE TABLE audit_log (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(10) NOT NULL,
    row_id VARCHAR(MAX) NOT NULL,
    old_data VARCHAR(MAX),
    new_data VARCHAR(MAX),
    changed_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- Audit trigger for users
CREATE TRIGGER users_audit_trigger
ON users
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT * FROM inserted) AND EXISTS (SELECT * FROM deleted)
    BEGIN
        -- UPDATE
        INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
        SELECT
            'users',
            'UPDATE',
            CAST(i.id AS VARCHAR(MAX)),
            (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i
        INNER JOIN deleted d ON i.id = d.id;
    END
    ELSE IF EXISTS (SELECT * FROM inserted)
    BEGIN
        -- INSERT
        INSERT INTO audit_log (table_name, operation, row_id, new_data)
        SELECT
            'users',
            'INSERT',
            CAST(i.id AS VARCHAR(MAX)),
            (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i;
    END
    ELSE IF EXISTS (SELECT * FROM deleted)
    BEGIN
        -- DELETE
        INSERT INTO audit_log (table_name, operation, row_id, old_data)
        SELECT
            'users',
            'DELETE',
            CAST(d.id AS VARCHAR(MAX)),
            (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM deleted d;
    END
END;
GO

-- Audit trigger for todo_items
CREATE TRIGGER todo_items_audit_trigger
ON todo_items
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT * FROM inserted) AND EXISTS (SELECT * FROM deleted)
    BEGIN
        INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
        SELECT
            'todo_items',
            'UPDATE',
            CAST(i.id AS VARCHAR(MAX)),
            (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i
        INNER JOIN deleted d ON i.id = d.id;
    END
    ELSE IF EXISTS (SELECT * FROM inserted)
    BEGIN
        INSERT INTO audit_log (table_name, operation, row_id, new_data)
        SELECT
            'todo_items',
            'INSERT',
            CAST(i.id AS VARCHAR(MAX)),
            (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i;
    END
    ELSE IF EXISTS (SELECT * FROM deleted)
    BEGIN
        INSERT INTO audit_log (table_name, operation, row_id, old_data)
        SELECT
            'todo_items',
            'DELETE',
            CAST(d.id AS VARCHAR(MAX)),
            (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM deleted d;
    END
END;
GO

-- Update timestamp trigger for users
CREATE TRIGGER users_update_timestamp
ON users
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE users
    SET updated_at = SYSDATETIMEOFFSET()
    FROM users u
    INNER JOIN inserted i ON u.id = i.id;
END;
GO

-- Update timestamp trigger for todo_lists
CREATE TRIGGER todo_lists_update_timestamp
ON todo_lists
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE todo_lists
    SET updated_at = SYSDATETIMEOFFSET()
    FROM todo_lists tl
    INNER JOIN inserted i ON tl.id = i.id;
END;
GO

-- Update timestamp trigger for todo_items
CREATE TRIGGER todo_items_update_timestamp
ON todo_items
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE todo_items
    SET updated_at = SYSDATETIMEOFFSET()
    FROM todo_items ti
    INNER JOIN inserted i ON ti.id = i.id;
END;
GO

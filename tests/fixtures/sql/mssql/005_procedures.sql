-- MSSQL Stored Procedures - Test Fixtures
-- CRUD operations for users, todo_lists, and todo_items

-- User Procedures

CREATE OR ALTER PROCEDURE create_user
    @p_email VARCHAR(255),
    @p_username VARCHAR(100),
    @p_password_hash VARCHAR(255),
    @p_display_name VARCHAR(255) = NULL,
    @p_avatar_url VARCHAR(MAX) = NULL
AS
BEGIN
    DECLARE @v_id UNIQUEIDENTIFIER = NEWID();
    INSERT INTO users (id, email, username, password_hash, display_name, avatar_url)
    VALUES (@v_id, @p_email, @p_username, @p_password_hash, @p_display_name, @p_avatar_url);
    SELECT @v_id AS id;
END;
GO

CREATE OR ALTER PROCEDURE get_user_by_id
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    SELECT id, email, username, display_name, avatar_url, created_at, updated_at
    FROM users
    WHERE id = @p_id AND deleted_at IS NULL;
END;
GO

CREATE OR ALTER PROCEDURE get_user_by_email
    @p_email VARCHAR(255)
AS
BEGIN
    SELECT id, email, username, password_hash, display_name, avatar_url
    FROM users
    WHERE email = @p_email AND deleted_at IS NULL;
END;
GO

CREATE OR ALTER PROCEDURE update_user
    @p_id UNIQUEIDENTIFIER,
    @p_display_name VARCHAR(255) = NULL,
    @p_avatar_url VARCHAR(MAX) = NULL
AS
BEGIN
    UPDATE users
    SET display_name = COALESCE(@p_display_name, display_name),
        avatar_url = COALESCE(@p_avatar_url, avatar_url),
        updated_at = SYSDATETIMEOFFSET()
    WHERE id = @p_id AND deleted_at IS NULL;
    SELECT CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS success;
END;
GO

CREATE OR ALTER PROCEDURE delete_user
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    UPDATE users
    SET deleted_at = SYSDATETIMEOFFSET(), updated_at = SYSDATETIMEOFFSET()
    WHERE id = @p_id AND deleted_at IS NULL;
    SELECT CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS success;
END;
GO

-- Todo List Procedures

CREATE OR ALTER PROCEDURE create_todo_list
    @p_user_id UNIQUEIDENTIFIER,
    @p_title VARCHAR(255),
    @p_description VARCHAR(MAX) = NULL,
    @p_color VARCHAR(7) = NULL
AS
BEGIN
    DECLARE @v_id UNIQUEIDENTIFIER = NEWID();
    DECLARE @v_position INT;
    SELECT @v_position = COALESCE(MAX(position), -1) + 1
    FROM todo_lists WHERE user_id = @p_user_id AND deleted_at IS NULL;
    INSERT INTO todo_lists (id, user_id, title, description, color, position)
    VALUES (@v_id, @p_user_id, @p_title, @p_description, @p_color, @v_position);
    SELECT @v_id AS id;
END;
GO

CREATE OR ALTER PROCEDURE get_todo_list_by_id
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    SELECT id, user_id, title, description, color, position, created_at, updated_at
    FROM todo_lists
    WHERE id = @p_id AND deleted_at IS NULL;
END;
GO

CREATE OR ALTER PROCEDURE get_todo_lists_by_user
    @p_user_id UNIQUEIDENTIFIER
AS
BEGIN
    SELECT id, title, description, color, position, created_at, updated_at
    FROM todo_lists
    WHERE user_id = @p_user_id AND deleted_at IS NULL
    ORDER BY position;
END;
GO

CREATE OR ALTER PROCEDURE update_todo_list
    @p_id UNIQUEIDENTIFIER,
    @p_title VARCHAR(255) = NULL,
    @p_description VARCHAR(MAX) = NULL,
    @p_color VARCHAR(7) = NULL
AS
BEGIN
    UPDATE todo_lists
    SET title = COALESCE(@p_title, title),
        description = COALESCE(@p_description, description),
        color = COALESCE(@p_color, color),
        updated_at = SYSDATETIMEOFFSET()
    WHERE id = @p_id AND deleted_at IS NULL;
    SELECT CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS success;
END;
GO

CREATE OR ALTER PROCEDURE delete_todo_list
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    UPDATE todo_lists
    SET deleted_at = SYSDATETIMEOFFSET(), updated_at = SYSDATETIMEOFFSET()
    WHERE id = @p_id AND deleted_at IS NULL;
    SELECT CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS success;
END;
GO

-- Todo Item Procedures

CREATE OR ALTER PROCEDURE create_todo_item
    @p_list_id UNIQUEIDENTIFIER,
    @p_title VARCHAR(500),
    @p_description VARCHAR(MAX) = NULL,
    @p_priority TINYINT = 0,
    @p_due_date DATETIMEOFFSET = NULL
AS
BEGIN
    DECLARE @v_id UNIQUEIDENTIFIER = NEWID();
    DECLARE @v_position INT;
    SELECT @v_position = COALESCE(MAX(position), -1) + 1
    FROM todo_items WHERE list_id = @p_list_id AND deleted_at IS NULL;
    INSERT INTO todo_items (id, list_id, title, description, priority, due_date, position)
    VALUES (@v_id, @p_list_id, @p_title, @p_description, @p_priority, @p_due_date, @v_position);
    SELECT @v_id AS id;
END;
GO

CREATE OR ALTER PROCEDURE get_todo_item_by_id
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    SELECT id, list_id, title, description, is_completed, priority, due_date, completed_at, position, created_at, updated_at
    FROM todo_items
    WHERE id = @p_id AND deleted_at IS NULL;
END;
GO

CREATE OR ALTER PROCEDURE get_todo_items_by_list
    @p_list_id UNIQUEIDENTIFIER
AS
BEGIN
    SELECT id, title, description, is_completed, priority, due_date, completed_at, position, created_at, updated_at
    FROM todo_items
    WHERE list_id = @p_list_id AND deleted_at IS NULL
    ORDER BY position;
END;
GO

CREATE OR ALTER PROCEDURE update_todo_item
    @p_id UNIQUEIDENTIFIER,
    @p_title VARCHAR(500) = NULL,
    @p_description VARCHAR(MAX) = NULL,
    @p_priority TINYINT = NULL,
    @p_due_date DATETIMEOFFSET = NULL
AS
BEGIN
    UPDATE todo_items
    SET title = COALESCE(@p_title, title),
        description = COALESCE(@p_description, description),
        priority = COALESCE(@p_priority, priority),
        due_date = COALESCE(@p_due_date, due_date),
        updated_at = SYSDATETIMEOFFSET()
    WHERE id = @p_id AND deleted_at IS NULL;
    SELECT CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS success;
END;
GO

CREATE OR ALTER PROCEDURE toggle_todo_item
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    DECLARE @v_is_completed BIT;
    SELECT @v_is_completed = is_completed FROM todo_items WHERE id = @p_id AND deleted_at IS NULL;
    IF @v_is_completed IS NOT NULL
    BEGIN
        UPDATE todo_items
        SET is_completed = CASE WHEN @v_is_completed = 0 THEN 1 ELSE 0 END,
            completed_at = CASE WHEN @v_is_completed = 0 THEN SYSDATETIMEOFFSET() ELSE NULL END,
            updated_at = SYSDATETIMEOFFSET()
        WHERE id = @p_id;
        SELECT 1 AS success;
    END
    ELSE
        SELECT 0 AS success;
END;
GO

CREATE OR ALTER PROCEDURE delete_todo_item
    @p_id UNIQUEIDENTIFIER
AS
BEGIN
    UPDATE todo_items
    SET deleted_at = SYSDATETIMEOFFSET(), updated_at = SYSDATETIMEOFFSET()
    WHERE id = @p_id AND deleted_at IS NULL;
    SELECT CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS success;
END;
GO

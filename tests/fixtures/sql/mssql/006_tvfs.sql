-- MSSQL Inline Table-Valued Functions - Test Fixtures
-- Used to test ctx.tvf() against real database

-- Get todo items by list (inline TVF)
CREATE OR ALTER FUNCTION fn_GetTodoItemsByList(@list_id UNIQUEIDENTIFIER)
RETURNS TABLE AS
RETURN (
    SELECT id, list_id, title, description, is_completed, priority, position
    FROM todo_items
    WHERE list_id = @list_id AND deleted_at IS NULL
);
GO

-- Get todo lists by user (inline TVF)
CREATE OR ALTER FUNCTION fn_GetTodoListsByUser(@user_id UNIQUEIDENTIFIER)
RETURNS TABLE AS
RETURN (
    SELECT id, user_id, title, description, color, position
    FROM todo_lists
    WHERE user_id = @user_id AND deleted_at IS NULL
);
GO

-- Get active users (no params, inline TVF)
CREATE OR ALTER FUNCTION fn_GetActiveUsers()
RETURNS TABLE AS
RETURN (
    SELECT id, email, username, display_name
    FROM users
    WHERE deleted_at IS NULL
);
GO

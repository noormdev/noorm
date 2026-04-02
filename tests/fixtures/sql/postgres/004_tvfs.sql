-- PostgreSQL Table-Valued Functions - Test Fixtures
-- Used to test ctx.tvf() against real database

-- Get todo items by list (table-returning function)
CREATE OR REPLACE FUNCTION fn_get_todo_items_by_list(p_list_id UUID)
RETURNS TABLE (
    id UUID,
    list_id UUID,
    title VARCHAR(500),
    description TEXT,
    is_completed BOOLEAN,
    priority SMALLINT,
    "position" INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT ti.id, ti.list_id, ti.title, ti.description, ti.is_completed, ti.priority, ti.position
    FROM todo_items ti
    WHERE ti.list_id = p_list_id AND ti.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Get todo lists by user (table-returning function)
CREATE OR REPLACE FUNCTION fn_get_todo_lists_by_user(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    title VARCHAR(255),
    description TEXT,
    color VARCHAR(7),
    "position" INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT tl.id, tl.user_id, tl.title, tl.description, tl.color, tl.position
    FROM todo_lists tl
    WHERE tl.user_id = p_user_id AND tl.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Get active users (no params, table-returning function)
CREATE OR REPLACE FUNCTION fn_get_active_users()
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    username VARCHAR(100),
    display_name VARCHAR(255)
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.username, u.display_name
    FROM users u
    WHERE u.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

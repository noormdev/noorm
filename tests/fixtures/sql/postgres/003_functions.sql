-- PostgreSQL Functions for Test Schema
-- CRUD operations using plpgsql

-- User Functions

CREATE OR REPLACE FUNCTION create_user(
    p_email VARCHAR(255),
    p_username VARCHAR(100),
    p_password_hash VARCHAR(255),
    p_display_name VARCHAR(255) DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO users (email, username, password_hash, display_name, avatar_url)
    VALUES (p_email, p_username, p_password_hash, p_display_name, p_avatar_url)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_by_id(p_id UUID)
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    username VARCHAR(100),
    display_name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.username, u.display_name, u.avatar_url, u.created_at, u.updated_at
    FROM users u
    WHERE u.id = p_id AND u.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_by_email(p_email VARCHAR(255))
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    username VARCHAR(100),
    password_hash VARCHAR(255),
    display_name VARCHAR(255),
    avatar_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.username, u.password_hash, u.display_name, u.avatar_url
    FROM users u
    WHERE u.email = p_email AND u.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_user(
    p_id UUID,
    p_display_name VARCHAR(255) DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE users
    SET display_name = COALESCE(p_display_name, display_name),
        avatar_url = COALESCE(p_avatar_url, avatar_url),
        updated_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_user(p_id UUID) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE users SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Todo List Functions

CREATE OR REPLACE FUNCTION create_todo_list(
    p_user_id UUID,
    p_title VARCHAR(255),
    p_description TEXT DEFAULT NULL,
    p_color VARCHAR(7) DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_position INTEGER;
BEGIN
    SELECT COALESCE(MAX(position), -1) + 1 INTO v_position
    FROM todo_lists WHERE user_id = p_user_id AND deleted_at IS NULL;

    INSERT INTO todo_lists (user_id, title, description, color, position)
    VALUES (p_user_id, p_title, p_description, p_color, v_position)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_todo_list_by_id(p_id UUID)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    title VARCHAR(255),
    description TEXT,
    color VARCHAR(7),
    position INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT tl.id, tl.user_id, tl.title, tl.description, tl.color, tl.position, tl.created_at, tl.updated_at
    FROM todo_lists tl
    WHERE tl.id = p_id AND tl.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_todo_lists_by_user(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    title VARCHAR(255),
    description TEXT,
    color VARCHAR(7),
    position INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT tl.id, tl.title, tl.description, tl.color, tl.position, tl.created_at, tl.updated_at
    FROM todo_lists tl
    WHERE tl.user_id = p_user_id AND tl.deleted_at IS NULL
    ORDER BY tl.position;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_todo_list(
    p_id UUID,
    p_title VARCHAR(255) DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_color VARCHAR(7) DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE todo_lists
    SET title = COALESCE(p_title, title),
        description = COALESCE(p_description, description),
        color = COALESCE(p_color, color),
        updated_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_todo_list(p_id UUID) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE todo_lists SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Todo Item Functions

CREATE OR REPLACE FUNCTION create_todo_item(
    p_list_id UUID,
    p_title VARCHAR(500),
    p_description TEXT DEFAULT NULL,
    p_priority SMALLINT DEFAULT 0,
    p_due_date TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_position INTEGER;
BEGIN
    SELECT COALESCE(MAX(position), -1) + 1 INTO v_position
    FROM todo_items WHERE list_id = p_list_id AND deleted_at IS NULL;

    INSERT INTO todo_items (list_id, title, description, priority, due_date, position)
    VALUES (p_list_id, p_title, p_description, p_priority, p_due_date, v_position)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_todo_item_by_id(p_id UUID)
RETURNS TABLE (
    id UUID,
    list_id UUID,
    title VARCHAR(500),
    description TEXT,
    is_completed BOOLEAN,
    priority SMALLINT,
    due_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    position INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT ti.id, ti.list_id, ti.title, ti.description, ti.is_completed, ti.priority,
           ti.due_date, ti.completed_at, ti.position, ti.created_at, ti.updated_at
    FROM todo_items ti
    WHERE ti.id = p_id AND ti.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_todo_items_by_list(p_list_id UUID)
RETURNS TABLE (
    id UUID,
    title VARCHAR(500),
    description TEXT,
    is_completed BOOLEAN,
    priority SMALLINT,
    due_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    position INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT ti.id, ti.title, ti.description, ti.is_completed, ti.priority,
           ti.due_date, ti.completed_at, ti.position, ti.created_at, ti.updated_at
    FROM todo_items ti
    WHERE ti.list_id = p_list_id AND ti.deleted_at IS NULL
    ORDER BY ti.position;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_todo_item(
    p_id UUID,
    p_title VARCHAR(500) DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_priority SMALLINT DEFAULT NULL,
    p_due_date TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE todo_items
    SET title = COALESCE(p_title, title),
        description = COALESCE(p_description, description),
        priority = COALESCE(p_priority, priority),
        due_date = COALESCE(p_due_date, due_date),
        updated_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION toggle_todo_item(p_id UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_is_completed BOOLEAN;
BEGIN
    SELECT is_completed INTO v_is_completed FROM todo_items WHERE id = p_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE todo_items
    SET is_completed = NOT v_is_completed,
        completed_at = CASE WHEN NOT v_is_completed THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_todo_item(p_id UUID) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE todo_items SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

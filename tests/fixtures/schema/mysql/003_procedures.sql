-- MySQL Procedures for Test Schema
-- Adapted from PostgreSQL functions to procedures (MySQL functions have limitations)

DELIMITER //

-- User Procedures

CREATE PROCEDURE create_user(
    IN p_email VARCHAR(255),
    IN p_username VARCHAR(100),
    IN p_password_hash VARCHAR(255),
    IN p_display_name VARCHAR(255),
    IN p_avatar_url TEXT
)
BEGIN
    DECLARE v_id CHAR(36);
    SET v_id = UUID();
    INSERT INTO users (id, email, username, password_hash, display_name, avatar_url)
    VALUES (v_id, p_email, p_username, p_password_hash, p_display_name, p_avatar_url);
    SELECT v_id AS id;
END//

CREATE PROCEDURE get_user_by_id(IN p_id CHAR(36))
BEGIN
    SELECT id, email, username, display_name, avatar_url, created_at, updated_at
    FROM users
    WHERE id = p_id AND deleted_at IS NULL;
END//

CREATE PROCEDURE get_user_by_email(IN p_email VARCHAR(255))
BEGIN
    SELECT id, email, username, password_hash, display_name, avatar_url
    FROM users
    WHERE email = p_email AND deleted_at IS NULL;
END//

CREATE PROCEDURE update_user(
    IN p_id CHAR(36),
    IN p_display_name VARCHAR(255),
    IN p_avatar_url TEXT
)
BEGIN
    UPDATE users
    SET display_name = COALESCE(p_display_name, display_name),
        avatar_url = COALESCE(p_avatar_url, avatar_url)
    WHERE id = p_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() > 0 AS success;
END//

CREATE PROCEDURE delete_user(IN p_id CHAR(36))
BEGIN
    UPDATE users SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = p_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() > 0 AS success;
END//

-- Todo List Procedures

CREATE PROCEDURE create_todo_list(
    IN p_user_id CHAR(36),
    IN p_title VARCHAR(255),
    IN p_description TEXT,
    IN p_color VARCHAR(7)
)
BEGIN
    DECLARE v_id CHAR(36);
    DECLARE v_position INT;
    SET v_id = UUID();
    SELECT COALESCE(MAX(position), -1) + 1 INTO v_position
    FROM todo_lists WHERE user_id = p_user_id AND deleted_at IS NULL;
    INSERT INTO todo_lists (id, user_id, title, description, color, position)
    VALUES (v_id, p_user_id, p_title, p_description, p_color, v_position);
    SELECT v_id AS id;
END//

CREATE PROCEDURE get_todo_list_by_id(IN p_id CHAR(36))
BEGIN
    SELECT id, user_id, title, description, color, position, created_at, updated_at
    FROM todo_lists
    WHERE id = p_id AND deleted_at IS NULL;
END//

CREATE PROCEDURE get_todo_lists_by_user(IN p_user_id CHAR(36))
BEGIN
    SELECT id, title, description, color, position, created_at, updated_at
    FROM todo_lists
    WHERE user_id = p_user_id AND deleted_at IS NULL
    ORDER BY position;
END//

CREATE PROCEDURE update_todo_list(
    IN p_id CHAR(36),
    IN p_title VARCHAR(255),
    IN p_description TEXT,
    IN p_color VARCHAR(7)
)
BEGIN
    UPDATE todo_lists
    SET title = COALESCE(p_title, title),
        description = COALESCE(p_description, description),
        color = COALESCE(p_color, color)
    WHERE id = p_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() > 0 AS success;
END//

CREATE PROCEDURE delete_todo_list(IN p_id CHAR(36))
BEGIN
    UPDATE todo_lists SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = p_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() > 0 AS success;
END//

-- Todo Item Procedures

CREATE PROCEDURE create_todo_item(
    IN p_list_id CHAR(36),
    IN p_title VARCHAR(500),
    IN p_description TEXT,
    IN p_priority TINYINT,
    IN p_due_date TIMESTAMP
)
BEGIN
    DECLARE v_id CHAR(36);
    DECLARE v_position INT;
    SET v_id = UUID();
    SELECT COALESCE(MAX(position), -1) + 1 INTO v_position
    FROM todo_items WHERE list_id = p_list_id AND deleted_at IS NULL;
    INSERT INTO todo_items (id, list_id, title, description, priority, due_date, position)
    VALUES (v_id, p_list_id, p_title, p_description, COALESCE(p_priority, 0), p_due_date, v_position);
    SELECT v_id AS id;
END//

CREATE PROCEDURE get_todo_item_by_id(IN p_id CHAR(36))
BEGIN
    SELECT id, list_id, title, description, is_completed, priority, due_date, completed_at, position, created_at, updated_at
    FROM todo_items
    WHERE id = p_id AND deleted_at IS NULL;
END//

CREATE PROCEDURE get_todo_items_by_list(IN p_list_id CHAR(36))
BEGIN
    SELECT id, title, description, is_completed, priority, due_date, completed_at, position, created_at, updated_at
    FROM todo_items
    WHERE list_id = p_list_id AND deleted_at IS NULL
    ORDER BY position;
END//

CREATE PROCEDURE update_todo_item(
    IN p_id CHAR(36),
    IN p_title VARCHAR(500),
    IN p_description TEXT,
    IN p_priority TINYINT,
    IN p_due_date TIMESTAMP
)
BEGIN
    UPDATE todo_items
    SET title = COALESCE(p_title, title),
        description = COALESCE(p_description, description),
        priority = COALESCE(p_priority, priority),
        due_date = COALESCE(p_due_date, due_date)
    WHERE id = p_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() > 0 AS success;
END//

CREATE PROCEDURE toggle_todo_item(IN p_id CHAR(36))
BEGIN
    DECLARE v_is_completed BOOLEAN;
    SELECT is_completed INTO v_is_completed FROM todo_items WHERE id = p_id AND deleted_at IS NULL;
    IF v_is_completed IS NOT NULL THEN
        UPDATE todo_items
        SET is_completed = NOT v_is_completed,
            completed_at = CASE WHEN NOT v_is_completed THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = p_id;
        SELECT TRUE AS success;
    ELSE
        SELECT FALSE AS success;
    END IF;
END//

CREATE PROCEDURE delete_todo_item(IN p_id CHAR(36))
BEGIN
    UPDATE todo_items SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = p_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() > 0 AS success;
END//

DELIMITER ;

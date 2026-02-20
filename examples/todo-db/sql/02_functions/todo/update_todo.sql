-- =============================================================================
-- Update Todo Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION update_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_created_at TIMESTAMP WITH TIME ZONE,
    p_title VARCHAR(255),
    p_description TEXT DEFAULT NULL,
    p_status VARCHAR(20) DEFAULT 'pending',
    p_priority INTEGER DEFAULT 0,
    p_due_date DATE DEFAULT NULL
)
RETURNS TABLE (
    user_id INTEGER,
    category_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    title VARCHAR(255),
    description TEXT,
    status VARCHAR(20),
    priority INTEGER,
    due_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE todo
    SET
        title = p_title,
        description = p_description,
        status = p_status,
        priority = p_priority,
        due_date = p_due_date,
        updated_at = CURRENT_TIMESTAMP
    WHERE todo.user_id = p_user_id
      AND todo.category_id = p_category_id
      AND todo.created_at = p_created_at
    RETURNING
        todo.user_id,
        todo.category_id,
        todo.created_at,
        todo.title,
        todo.description,
        todo.status,
        todo.priority,
        todo.due_date,
        todo.updated_at;
END;
$$;

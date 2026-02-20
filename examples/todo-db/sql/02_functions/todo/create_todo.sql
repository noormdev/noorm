-- =============================================================================
-- Create Todo Procedure
-- =============================================================================

CREATE OR REPLACE FUNCTION create_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_title VARCHAR(255),
    p_description TEXT DEFAULT NULL,
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
    INSERT INTO todo (user_id, category_id, title, description, priority, due_date)
    VALUES (p_user_id, p_category_id, p_title, p_description, p_priority, p_due_date)
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

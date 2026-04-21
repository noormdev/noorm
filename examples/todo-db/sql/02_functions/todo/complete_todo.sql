-- =============================================================================
-- Complete Todo Procedure
-- Marks a todo as completed AND flips every one of its items to completed,
-- in a single transaction. If the todo is missing or already completed the
-- caller gets a clear exception instead of a silent no-op — makes tests
-- easy to write around.
-- =============================================================================

CREATE OR REPLACE FUNCTION complete_todo(
    p_user_id INTEGER,
    p_category_id INTEGER,
    p_created_at TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    user_id INTEGER,
    category_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20),
    items_completed INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_status VARCHAR(20);
    v_items_completed INTEGER;
BEGIN
    SELECT t.status INTO v_current_status
    FROM todo t
    WHERE t.user_id = p_user_id
      AND t.category_id = p_category_id
      AND t.created_at = p_created_at
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Todo not found (user=%, category=%, created_at=%)',
            p_user_id, p_category_id, p_created_at
            USING ERRCODE = 'P0002';
    END IF;

    IF v_current_status = 'completed' THEN
        RAISE EXCEPTION 'Todo already completed'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE todo
    SET status = 'completed',
        updated_at = CURRENT_TIMESTAMP
    WHERE todo.user_id = p_user_id
      AND todo.category_id = p_category_id
      AND todo.created_at = p_created_at;

    UPDATE todo_item
    SET is_completed = TRUE,
        updated_at = CURRENT_TIMESTAMP
    WHERE todo_item.user_id = p_user_id
      AND todo_item.category_id = p_category_id
      AND todo_item.todo_created_at = p_created_at
      AND todo_item.is_completed = FALSE;

    GET DIAGNOSTICS v_items_completed = ROW_COUNT;

    RETURN QUERY
    SELECT
        t.user_id,
        t.category_id,
        t.created_at,
        t.status,
        v_items_completed
    FROM todo t
    WHERE t.user_id = p_user_id
      AND t.category_id = p_category_id
      AND t.created_at = p_created_at;
END;
$$;

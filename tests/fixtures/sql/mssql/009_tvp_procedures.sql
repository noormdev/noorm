-- MSSQL TVP-accepting Stored Procedures, Functions & TVFs - Test Fixtures
-- Routines that accept Table-Valued Parameters for integration testing

-- Proc: insert items from TVP, return count
CREATE OR ALTER PROCEDURE batch_create_todo_items
    @p_user_id UNIQUEIDENTIFIER,
    @p_items TodoItemBatch READONLY
AS
BEGIN
    INSERT INTO todo_items (id, list_id, title, priority, position)
    SELECT
        NEWID(),
        i.list_id,
        i.title,
        COALESCE(i.priority, 0),
        0
    FROM @p_items i;

    SELECT @@ROWCOUNT AS items_created;
END;
GO

-- Scalar function: sum priorities from TVP, multiplied by scalar
CREATE OR ALTER FUNCTION fn_SumBatchPriorities(
    @p_multiplier INT,
    @p_items TodoItemBatch READONLY
)
RETURNS INT
AS
BEGIN
    DECLARE @total INT;
    SELECT @total = COALESCE(SUM(priority), 0) * @p_multiplier FROM @p_items;
    RETURN @total;
END;
GO

-- Inline TVF: return existing todo_items that match titles in the TVP
CREATE OR ALTER FUNCTION fn_MatchBatchItems(
    @p_user_id UNIQUEIDENTIFIER,
    @p_items TodoItemBatch READONLY
)
RETURNS TABLE AS
RETURN (
    SELECT ti.id, ti.list_id, ti.title, ti.priority
    FROM todo_items ti
    INNER JOIN todo_lists tl ON ti.list_id = tl.id
    INNER JOIN @p_items b ON ti.title = b.title
    WHERE tl.user_id = @p_user_id AND ti.deleted_at IS NULL
);
GO

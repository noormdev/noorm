-- MSSQL Table-Valued Parameters (TVPs) - Test Fixtures
-- Table types that reference scalar custom types, used to test teardown dependency ordering

-- TVP referencing EmailAddress and Username scalar types
CREATE TYPE UserBatchInsert AS TABLE (
    email EmailAddress,
    username Username,
    display_name VARCHAR(255) NULL
);
GO

-- TVP referencing Priority scalar type
CREATE TYPE TodoItemBatch AS TABLE (
    title VARCHAR(500) NOT NULL,
    priority Priority,
    list_id UNIQUEIDENTIFIER NOT NULL
);
GO

-- MSSQL Scalar Functions - Test Fixtures
-- These are used to test explore module function detection

-- Validate email format (basic check for @ and .)
CREATE OR ALTER FUNCTION fn_IsValidEmail(@email VARCHAR(255))
RETURNS BIT
AS
BEGIN
    IF @email IS NULL RETURN 0;
    IF CHARINDEX('@', @email) = 0 RETURN 0;
    IF CHARINDEX('.', @email, CHARINDEX('@', @email)) = 0 RETURN 0;
    RETURN 1;
END;
GO

-- Validate hex color format (#RRGGBB)
CREATE OR ALTER FUNCTION fn_IsValidHexColor(@color CHAR(7))
RETURNS BIT
AS
BEGIN
    IF @color IS NULL RETURN 1; -- NULL is valid (optional field)
    IF LEN(@color) <> 7 RETURN 0;
    IF LEFT(@color, 1) <> '#' RETURN 0;
    -- Check remaining 6 chars are hex digits
    IF PATINDEX('%[^0-9A-Fa-f]%', SUBSTRING(@color, 2, 6)) > 0 RETURN 0;
    RETURN 1;
END;
GO

-- Get human-readable priority label
CREATE OR ALTER FUNCTION fn_GetPriorityLabel(@priority TINYINT)
RETURNS VARCHAR(10)
AS
BEGIN
    RETURN CASE @priority
        WHEN 0 THEN 'None'
        WHEN 1 THEN 'Low'
        WHEN 2 THEN 'Medium'
        WHEN 3 THEN 'High'
        ELSE 'Unknown'
    END;
END;
GO
